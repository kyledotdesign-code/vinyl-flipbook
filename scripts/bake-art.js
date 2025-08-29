#!/usr/bin/env node
/**
 * Bake album art once into a static index (and optionally download images).
 * Usage:
 *   node scripts/bake-art.js --sheet "https://docs.google.com/spreadsheets/.../output=csv" [--download]
 * Or:
 *   SHEET_CSV_URL=... node scripts/bake-art.js --download
 *
 * Writes: public/art-index.json
 * If --download given, downloads images to public/covers/*.jpg and rewrites URLs to those local files.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public');
const coversDir = path.join(outDir, 'covers');

const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  if (i>=0) return args[i+1];
  return null;
};
const SHEET = getArg('--sheet') || process.env.SHEET_CSV_URL;
const SHOULD_DL = args.includes('--download');

if (!SHEET) {
  console.error('Missing --sheet CSV URL (or SHEET_CSV_URL env).');
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
if (SHOULD_DL && !fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });

const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
const norm = (s='') => s.toLowerCase()
  .replace(/deluxe|remaster(ed)?|edition|original|explicit|clean|mono|stereo|score|soundtrack|ost/g,'')
  .replace(/volume|vol\./g,'vol')
  .replace(/\([^)]*\)/g,'')
  .replace(/[^a-z0-9]/g,'');

const slugify = (s='') => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
const hash = (s)=> crypto.createHash('md5').update(s).digest('hex').slice(0,10);

function toDirectUrl(u=''){
  // Google Drive
  const m = u.match(/[-\w]{25,}/);
  if (u.includes('drive.google.com') && m) {
    return `https://drive.google.com/uc?export=download&id=${m[0]}`;
  }
  // Dropbox
  if (u.includes('dropbox.com')) {
    return u.replace('www.dropbox.com','dl.dropboxusercontent.com').replace('?dl=0','');
  }
  return u;
}

async function okImage(url){
  try {
    const r = await fetch(url, { method:'HEAD' });
    return r.ok;
  } catch { return false; }
}

async function firstOk(urls){
  for (const u of urls){
    if (!u) continue;
    if (await okImage(u)) return u;
    await sleep(50);
  }
  return null;
}

async function appleLookup(artist, album){
  try {
    const term = encodeURIComponent(`${artist} ${album}`);
    const r = await fetch(`https://itunes.apple.com/search?media=music&entity=album&limit=50&term=${term}`);
    const j = await r.json();
    const keyA = norm(artist), keyT = norm(album);
    const cand = (j.results||[]).find(x => norm(x.artistName)===keyA && norm(x.collectionName)===keyT);
    if (cand){
      return cand.artworkUrl100?.replace('100x100bb','1200x1200bb');
    }
  }catch{}
  return null;
}

async function deezerLookup(artist, album){
  try {
    const q = encodeURIComponent(`artist:"${artist}" album:"${album}"`);
    const r = await fetch(`https://api.deezer.com/search/album?q=${q}`);
    const j = await r.json();
    const keyA = norm(artist), keyT = norm(album);
    const cand=(j.data||[]).find(x=> norm(x.artist?.name||'')===keyA && norm(x.title)===keyT);
    if (cand) return cand.cover_xl || cand.cover_big || cand.cover_medium || cand.cover;
  }catch{}
  return null;
}

async function mbidFor(artist, album){
  try {
    const q = `artist:"${artist}" AND release:"${album}"`;
    const r = await fetch(`http://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=1`,
      { headers: { 'User-Agent': 'vinyl-collection-bake/1.0 (vercel)' }});
    const j = await r.json();
    const rg = (j['release-groups']||[])[0];
    return rg?.id || null;
  }catch{}
  return null;
}

async function caaCover(mbid){
  if (!mbid) return null;
  const sizes = ['1200','1000','800','500','250'];
  for (const s of sizes){
    const u = `https://coverartarchive.org/release-group/${mbid}/front-${s}`;
    if (await okImage(u)) return u;
    await sleep(50);
  }
  const u = `https://coverartarchive.org/release-group/${mbid}/front`;
  if (await okImage(u)) return u;
  return null;
}

async function resolveCover(artist, album, sheetUrl){
  // 1) sheet
  const direct = toDirectUrl(sheetUrl || '');
  const proxy = direct ? `https://images.weserv.nl/?url=${encodeURIComponent(direct.replace(/^https?:\/\//,''))}` : null;
  const u1 = await firstOk([direct, proxy]);
  if (u1) return { url: u1, src: 'sheet' };

  // 2) apple
  const apple = await appleLookup(artist, album);
  if (apple && await okImage(apple)) return { url: apple, src: 'apple' };

  // 3) deezer
  const dz = await deezerLookup(artist, album);
  if (dz && await okImage(dz)) return { url: dz, src: 'deezer' };

  // 4) CAA
  const mbid = await mbidFor(artist, album);
  const caa = await caaCover(mbid);
  if (caa) return { url: caa, src: 'caa' };

  return { url: null, src: 'none' };
}

async function downloadTo(url, destPath){
  const r = await fetch(url);
  if (!r.ok) throw new Error('download failed');
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

(async function main(){
  console.log('Fetching sheet CSV...');
  const rs = await fetch(SHEET);
  const csv = await rs.text();
  const rows = parse(csv, { columns: true, skip_empty_lines: true });

  // Expect columns: Title, Artist, Genre (optional), Cover (optional), Year (optional)
  const out = {};
  for (const row of rows){
    const title = (row['Title'] || row['Album'] || row['album'] || '').trim();
    const artist = (row['Artist'] || row['artist'] || '').trim();
    const cover  = (row['Cover']  || row['Image']  || row['Art']    || '').trim();
    if (!title || !artist) continue;

    const key = `${artist}|||${title}`;
    const slug = `${slugify(artist)}__${slugify(title)}__${hash(key)}`;

    console.log('→', artist, '-', title);
    let rec = await resolveCover(artist, title, cover);
    if (rec.url && SHOULD_DL){
      const ext = rec.url.split('?')[0].split('.').pop().toLowerCase();
      const safeExt = ['jpg','jpeg','png','webp'].includes(ext) ? ext : 'jpg';
      const dest = path.join(coversDir, `${slug}.${safeExt}`);
      try {
        await downloadTo(rec.url, dest);
        rec.url = `/covers/${path.basename(dest)}`;
      } catch(e){
        console.warn('   download failed, keeping remote URL');
      }
    }
    out[key] = rec;
    await sleep(120); // be gentle with public APIs
  }

  const outPath = path.join(outDir, 'art-index.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Wrote', outPath);
  if (SHOULD_DL) console.log('Local covers saved to', coversDir);
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
