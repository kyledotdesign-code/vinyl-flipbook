
/* Vinyl Flipbook (scrollable + auto artwork) */
const state = {
  all: window.INIT_DATA || [],
  filtered: [],
};

function mapRecord(r, idx){
  const g = (k)=>r[k] ?? r[k.replace(/-/g,'_')] ?? r[k.replace(/\s+/g,'_')] ?? r[k.toLowerCase?.()] ?? r[k.toUpperCase?.()];
  const title = g('album') || g('title') || g('record') || g('release') || `Untitled #${idx+1}`;
  const artist = g('artist') || g('band') || g('composer') || 'Unknown Artist';
  const year = String(g('year') || '').replace(/\..*$/,'') || '';
  const genre = g('genre') || '';
  const label = g('label') || '';
  const format = g('format') || g('media') || '';
  const color = g('color') || g('variant') || '';
  const notes = g('notes') || g('comments') || '';
  const cover = g('cover_url') || g('cover') || g('image') || g('art') || '';
  const url = g('url') || g('discogs_url') || '';
  return {title, artist, year, genre, label, format, color, notes, cover, url, _raw:r};
}

function normalizeData(arr){ return arr.map(mapRecord); }

let fuse = null;
let currentQuery = "";

// Build FUSE index
function buildFuse(items){
  if(!window.Fuse) { fuse = null; return; }
  fuse = new Fuse(items, {
    keys: [
      {name:'title', weight:0.45},
      {name:'artist', weight:0.45},
      {name:'genre', weight:0.08},
      {name:'label', weight:0.06},
      {name:'year', weight:0.06},
    ],
    includeScore: true,
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });
}

// Highlight helper
function hi(text, query){
  if(!query || !text) return text;
  try{
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/).filter(Boolean).join('|');
    if(!esc) return text;
    return text.replace(new RegExp(`(${esc})`, 'ig'), '<mark class="search-hit">$1</mark>');
  }catch{ return text; }
}

function build(){
  state.filtered = normalizeData(state.all);
  sortBy(document.querySelector('#sort').value);
  buildFuse(state.filtered);
  applySearch(document.querySelector('#search').value.trim());
  render();
  prefetchArtwork(state.filtered);
}

function render(){
  const root = document.querySelector('#carousel');
  root.innerHTML = '';
  const scroller = document.createElement('div');
  scroller.id = 'scroller';
  root.appendChild(scroller);

  state.filtered.forEach((rec, i)=>{
    scroller.appendChild(createCard(rec, i));
  });

  // Make wheel scroll horizontal
  scroller.addEventListener('wheel', (e)=>{
    if(Math.abs(e.deltaY) > Math.abs(e.deltaX)){
      scroller.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, {passive:false});
}

function createCard(rec, index){
  const card = document.createElement('div');
  card.className = 'card';
  const inner = document.createElement('div');
  inner.className = 'inner';
  const sleeve = document.createElement('div'); sleeve.className = 'sleeve';
  const back = document.createElement('div'); back.className = 'back';

  // FRONT
  const cover = document.createElement('div'); cover.className = 'cover';
  if(rec.cover){ cover.style.backgroundImage = `url('${rec.cover}')`; }
  else { cover.appendChild(makePlaceholder(rec)); attemptArtwork(rec, cover); }

  const meta = document.createElement('div'); meta.className = 'meta';
  const left = document.createElement('div');
  const title = document.createElement('div'); title.className='title'; title.innerHTML = hi(rec.title, currentQuery);
  const artist = document.createElement('div'); artist.className='artist'; artist.innerHTML = hi(rec.artist, currentQuery);
  left.appendChild(title); left.appendChild(artist);
  const yearChip = document.createElement('div'); yearChip.className = 'year-chip'; yearChip.textContent = rec.year || '';
  meta.appendChild(left); meta.appendChild(yearChip);

  sleeve.appendChild(cover); sleeve.appendChild(meta);

  // BACK
  const details = document.createElement('div'); details.className = 'details';
  [
    ['Artist', rec.artist],
    ['Album', rec.title],
    ['Year', rec.year],
    ['Genre', rec.genre],
    ['Label', rec.label],
    ['Format', rec.format],
    ['Color', rec.color],
    ['Notes', rec.notes],
  ].forEach(([k,v])=>{
    if(!v) return;
    const row = document.createElement('div'); row.className='kv';
    const kEl = document.createElement('div'); kEl.className='k'; kEl.textContent=k;
    const vEl = document.createElement('div'); vEl.className='v'; vEl.textContent=v;
    row.appendChild(kEl); row.appendChild(vEl); details.appendChild(row);
  });
  if(rec.url){
    const row = document.createElement('div'); row.className='kv';
    const kEl = document.createElement('div'); kEl.className='k'; kEl.textContent='Link';
    const vEl = document.createElement('div'); vEl.className='v';
    const a = document.createElement('a'); a.href = rec.url; a.target='_blank'; a.rel='noreferrer noopener'; a.textContent='Open';
    vEl.appendChild(a); row.appendChild(kEl); row.appendChild(vEl); details.appendChild(row);
  }
  back.appendChild(details);

  inner.appendChild(sleeve); inner.appendChild(back); card.appendChild(inner);

  card.addEventListener('click', ()=> card.classList.toggle('flipped'));
  return card;
}

function makePlaceholder(rec){
  const ph = document.createElement('div'); ph.className='placeholder';
  const initials = document.createElement('div'); initials.className='initials';
  const a = (rec.title || 'Untitled').trim().split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()||'').join('');
  initials.textContent = a || '🎵'; ph.appendChild(initials); return ph;
}

/* ---------- Artwork fetching ---------- */
const cache = {
  get(key){ try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null} },
  set(key,val){ try{localStorage.setItem(key, JSON.stringify(val))}catch{} }
};

function cacheKey(rec){ return `art:${(rec.artist||'').toLowerCase()}|${(rec.title||'').toLowerCase()}`; }

async function attemptArtwork(rec, coverEl){
  const key = cacheKey(rec);
  const cached = cache.get(key);
  if(cached){ applyCover(coverEl, cached); rec.cover = cached; return; }

  const providers = [fetchITunes, fetchMusicBrainzCover];
  for (const p of providers){
    try{
      const url = await p(rec);
      if(url){ applyCover(coverEl, url); rec.cover = url; cache.set(key, url); return; }
    }catch{ /* continue */ }
  }
}

function applyCover(el, url){
  el.innerHTML = '';
  el.style.backgroundImage = `url('${url}')`;
}

/* iTunes Search API (no key): album art 600/1200 */
async function fetchITunes(rec){
  const q = encodeURIComponent(`${rec.artist} ${rec.title}`);
  const url = `https://itunes.apple.com/search?term=${q}&entity=album&limit=5`;
  const res = await fetch(url, {mode:'cors'});
  if(!res.ok) return null;
  const data = await res.json();
  if(!data.results?.length) return null;
  // Try to match both artist and collection name loosely
  const norm = s => (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const wantA = norm(rec.artist), wantT = norm(rec.title);
  let best = data.results.find(r=> norm(r.artistName).includes(wantA) && norm(r.collectionName).includes(wantT));
  if(!best) best = data.results[0];
  let art = best.artworkUrl100;
  if(!art) return null;
  // upscale to 1200x1200 if available
  art = art.replace(/100x100bb\.jpg$/, '1200x1200bb.jpg').replace(/100x100bb\.png$/, '1200x1200bb.png');
  return art;
}

/* MusicBrainz + Cover Art Archive */
async function fetchMusicBrainzCover(rec){
  const a = encodeURIComponent(`artist:"${rec.artist}" AND release:"${rec.title}"`);
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${a}&fmt=json&limit=1`;
  const res = await fetch(url, {headers: {'User-Agent': 'VinylFlipbook/1.0 (https://example.com)'}});
  if(!res.ok) return null;
  const data = await res.json();
  const id = data['release-groups']?.[0]?.id;
  if(!id) return null;
  // Try 1200 then 500
  const art1200 = `https://coverartarchive.org/release-group/${id}/front-1200`;
  const art500 = `https://coverartarchive.org/release-group/${id}/front-500`;
  const ok1200 = await fetchHeadOK(art1200);
  if(ok1200) return art1200;
  const ok500 = await fetchHeadOK(art500);
  return ok500 ? art500 : null;
}

async function fetchHeadOK(url){
  try{
    const res = await fetch(url, {method:'HEAD'});
    return res.ok;
  }catch{ return false; }
}

function prefetchArtwork(list){
  // progressively fetch in the background
  const max = Math.min(list.length, 50); // sanity cap
  let i = 0;
  const tick = async () => {
    if(i>=max) return;
    const rec = list[i++];
    if(!rec.cover) { const el = document.createElement('div'); await attemptArtwork(rec, el); }
    setTimeout(tick, 120);
  };
  tick();
}

/* ---------- Controls ---------- */
function sortBy(mode){
  if(mode === 'random') state.filtered.sort(()=>Math.random()-.5);
  else if(mode==='artist') state.filtered.sort((a,b)=> (a.artist||'').localeCompare(b.artist||''));
  else if(mode==='year') state.filtered.sort((a,b)=> parseInt(a.year||0)-parseInt(b.year||0));
  else state.filtered.sort((a,b)=> (a.title||'').localeCompare(b.title||''));
}

function applySearch(q){
  currentQuery = q;
  const parts = (q||'').toLowerCase().split(/\s+/).filter(Boolean);
  if(parts.length >= 2 && fuse){
    const res = fuse.search(q);
    state.filtered = res.map(r => r.item);
  }else{
    state.filtered = normalizeData(state.all).filter(r=>{
      const hay = [r.title, r.artist, r.genre, r.label, r.year, r.format].join(' ').toLowerCase();
      return parts.every(p=> hay.includes(p));
    });
  }
  sortBy(document.querySelector('#sort').value);
}

async function importFile(file){
  const ext = file.name.split('.').pop().toLowerCase();
  if(ext === 'json'){
    const text = await file.text(); const parsed = JSON.parse(text);
    state.all = Array.isArray(parsed) ? parsed : parsed.values || []; build();
  }else if(ext === 'csv'){
    if(window.Papa){
      Papa.parse(file,{header:true,skipEmptyLines:true,complete:(r)=>{state.all=r.data; build();}});
    }else{
      const text = await file.text(); const lines = text.split(/\r?\n/).filter(Boolean);
      const headers = lines.shift().split(',').map(s=>s.trim());
      const rows = lines.map(line=>{const cols=line.split(',');const o={};headers.forEach((h,i)=>o[h]=cols[i]);return o;});
      state.all = rows; build();
    }
  }
}

document.addEventListener('DOMContentLoaded', ()=>{
  document.querySelector('#search').addEventListener('input', (e)=>{ applySearch(e.target.value); render(); });
  document.querySelector('#sort').addEventListener('change', (e)=>{ sortBy(e.target.value); render(); });
  document.querySelector('#shuffle').addEventListener('click', ()=>{ state.filtered.sort(()=>Math.random()-.5); render(); });
  document.querySelector('#fileInput').addEventListener('change', (e)=>{ const f=e.target.files?.[0]; if(f) importFile(f); });
  document.querySelector('#fullscreen').addEventListener('click', ()=>{
    if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
    else document.exitFullscreen();
  });
  state.all = window.INIT_DATA || [];
  if(!state.all.length){
    fetch('./vinyl_collection.cleaned.json').then(r=>r.json()).then(arr=>{ state.all=arr; build(); }).catch(()=> build());
  }else build();
});
