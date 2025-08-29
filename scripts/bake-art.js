#!/usr/bin/env node
/**
 * Bake album art + genres into a static index.
 * Usage:
 *   node scripts/bake-art.js --sheet "<CSV_URL>" [--download]
 * Env alternative:
 *   SHEET_CSV_URL=<CSV_URL> node scripts/bake-art.js --download
 *
 * Outputs:
 *   public/art-index.json  (map: "Artist|||Title" -> { url, src, genre })
 *   public/covers/*        (only when --download used)
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
      const art = cand.artworkUrl100?.replace('100x100bb','1200x1200bb') || null;
      const genre = cand.primaryGenreName || null;
      return { art, genre, apple: cand };
    }
  }catch{}
  return { art:null, genre:null };
}

async function deezerLookup(artist, album){
  try {
    const q = encodeURIComponent(`artist:"${artist}" album:"${album}"`);
    const r = await fetch(`https://api.deezer.com/search/album?q=${q}`);
    const j = await r.json();
    const keyA = norm(artist), keyT = norm(album);
    const cand=(j.data||[]).find(x=> norm(x.artist?.name||'')===keyA && norm(x.title)===keyT);
    if (cand){
      const art = cand.cover_xl || cand.cover_big || cand.cover_medium || cand.cover || null;
      // deezer's album search object doesn't always carry genre; skip second fetch to avoid rate hits
      return { art, genre:null, deezer: cand };
    }
  }catch{}
  return { art:null, genre:null };
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

const TAG_MAP = {
  'rock':'Rock','pop':'Pop','hip hop':'Hip-Hop','rap':'Hip-Hop','r&b':'R&B','soul':'Soul','jazz':'Jazz',
  'classical':'Classical','electronic':'Electronic','edm':'Electronic','dance':'Electronic','house':'Electronic',
  'techno':'Electronic','metal':'Metal','punk':'Punk','indie':'Indie','alternative':'Alternative',
  'folk':'Folk','country':'Country','blues':'Blues','reggae':'Reggae','soundtrack':'Soundtrack','score':'Soundtrack'
};

function mapTagToGenre(tag){
  if (!tag) return null;
  const t = tag.toLowerCase();
  // exact or startsWith match
  for (const k of Object.keys(TAG_MAP)){
    if (t===k || t.startsWith(k)) return TAG_MAP[k];
  }
  // common fallbacks
  if (t.includes('alt')) return 'Alternative';
  if (t.includes('singer-songwriter')) return 'Folk';
  return null;
}

async function mbGenreByRG(mbid){
  if (!mbid) return null;
  try {
    const r = await fetch(`http://musicbrainz.org/ws/2/release-group/${mbid}?inc=tags&fmt=json`,
      { headers: { 'User-Agent': 'vinyl-collection-bake/1.0 (vercel)' }});
    const j = await r.json();
    const tags = (j.tags||[]).sort((a,b)=>(b.count||0)-(a.count||0));
    for (const t of tags){
      const g = mapTagToGenre(t.name);
      if (g) return g;
    }
  } catch {}
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

async function resolveCoverAndGenre(artist, album, sheetUrl){
  // 0) Sheet URL (direct/proxy)
  const direct = toDirectUrl(sheetUrl || '');
  const proxy  = direct ? `https://images.weserv.nl/?url=${encodeURIComponent(direct.replace(/^https?:\/\//,''))}` : null;
  const fromSheet = await firstOk([direct, proxy]);

  // 1) Apple (art + genre)
  const apple = await appleLookup(artist, album);
  let art = fromSheet || (await firstOk([apple.art]));
  let genre = apple.genre;

  // 2) Deezer (art only; keep genre if still null later)
  if (!art){
    const dz = await deezerLookup(artist, album);
    art = await firstOk([dz.art]);
  }

  // 3) MusicBrainz/CAA (art), and MB tags if genre missing
  const mbid = await mbidFor(artist, album);
  if (!art){
    const caa = await caaCover(mbid);
    art = caa || art;
  }
  if (!genre){
    genre = await mbGenreByRG(mbid);
  }

  return { url: art || null, src: art ? (fromSheet ? 'sheet' : (apple.art && art===apple.art ? 'apple' : 'caa_or_dz')) : 'none', genre: genre || null };
}

(async function main(){
  console.log('Fetching sheet CSV...');
  const rs = await fetch(SHEET);
  const csv = await rs.text();
  const rows = parse(csv, { columns: true, skip_empty_lines: true });

  const out = {};
  for (const row of rows){
    const title = (row['Title'] || row['Album'] || row['album'] || '').trim();
    const artist = (row['Artist'] || row['artist'] || '').trim();
    const cover  = (row['Cover']  || row['Image']  || row['Art']    || '').trim();
    const preset = (row['Genre']  || row['genre']  || '').trim();
    if (!title || !artist) continue;

    const key = `${artist}|||${title}`;
    const slug = `${slugify(artist)}__${slugify(title)}__${hash(key)}`;

    console.log('→', artist, '-', title);
    let rec = { url:null, src:'none', genre: preset || null };

    // Only resolve if we need art or genre
    const needArt = true;
    const needGenre = !rec.genre;

    if (needArt || needGenre){
      const resolved = await resolveCoverAndGenre(artist, title, cover);
      rec.url = resolved.url || rec.url;
      rec.src = resolved.src || rec.src;
      rec.genre = rec.genre || resolved.genre || null;
    }

    if (rec.url && SHOULD_DL){
      const ext = rec.url.split('?')[0].split('.').pop().toLowerCase();
      const safeExt = ['jpg','jpeg','png','webp'].includes(ext) ? ext : 'jpg';
      const dest = path.join(coversDir, `${slug}.${safeExt}`);
      try {
        const rr = await fetch(rec.url);
        if (rr.ok){
          const buf = Buffer.from(await rr.arrayBuffer());
          fs.writeFileSync(dest, buf);
          rec.url = `/covers/${path.basename(dest)}`;
          rec.src = 'local';
        }
      } catch(e){
        console.warn('   download failed, keeping remote URL');
      }
    }

    out[key] = rec;
    await sleep(120); // polite to public APIs
  }

  const outPath = path.join(outDir, 'art-index.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Wrote', outPath);
  if (SHOULD_DL) console.log('Local covers saved to', coversDir);
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
