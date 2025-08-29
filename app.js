
const state = { all: window.INIT_DATA || [], filtered: [] };
let fuse = null;
let currentQuery = "";

// Data mapping
function mapRecord(r, idx){
  const g = (k)=>r[k] ?? r[k?.replace?.(/-/g,'_')] ?? r[k?.replace?.(/\s+/g,'_')] ?? r[k?.toLowerCase?.()] ?? r[k?.toUpperCase?.()];
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

// Fuse
function buildFuse(items){
  if(!window.Fuse){ fuse = null; return; }
  fuse = new Fuse(items, {
    keys: [
      {name:'title', weight:0.45},
      {name:'artist', weight:0.45},
      {name:'genre', weight:0.08},
      {name:'label', weight:0.06},
      {name:'year', weight:0.06},
    ],
    includeScore:true, threshold:0.35, ignoreLocation:true, minMatchCharLength:2,
  });
}
function hi(text, query){
  if(!query || !text) return text;
  try{
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/).filter(Boolean).join('|');
    if(!esc) return text;
    return text.replace(new RegExp(`(${esc})`, 'ig'), '<mark class="search-hit">$1</mark>');
  }catch{ return text; }
}

// Artwork
const cache = {
  get(key){ try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null} },
  set(key,val){ try{localStorage.setItem(key, JSON.stringify(val))}catch{} }
};
function cacheKey(rec){ return `art:${(rec.artist||'').toLowerCase()}|${(rec.title||'').toLowerCase()}`; }
async function attemptArtwork(rec, coverEl){
  if(rec.cover){ applyCover(coverEl, rec.cover); return; }
  const key = cacheKey(rec);
  const cached = cache.get(key);
  if(cached){ applyCover(coverEl, cached); rec.cover = cached; return; }
  const providers = [fetchITunes, fetchMusicBrainzCover];
  for (const p of providers){
    try{ const url = await p(rec); if(url){ applyCover(coverEl, url); rec.cover=url; cache.set(key,url); return; } }catch{}
  }
}
function applyCover(el, url){ el.innerHTML=''; el.style.backgroundImage = `url('${url}')`; }
async function fetchITunes(rec){
  const q = encodeURIComponent(`${rec.artist} ${rec.title}`);
  const url = `https://itunes.apple.com/search?term=${q}&entity=album&limit=5`;
  const res = await fetch(url, {mode:'cors'});
  if(!res.ok) return null;
  const data = await res.json();
  if(!data.results?.length) return null;
  const norm = s => (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const wantA = norm(rec.artist), wantT = norm(rec.title);
  let best = data.results.find(r=> norm(r.artistName).includes(wantA) && norm(r.collectionName).includes(wantT));
  if(!best) best = data.results[0];
  let art = best.artworkUrl100; if(!art) return null;
  return art.replace(/100x100bb\.(jpg|png)$/, '1200x1200bb.$1');
}
async function fetchMusicBrainzCover(rec){
  const q = encodeURIComponent(`artist:"${rec.artist}" AND release:"${rec.title}"`);
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${q}&fmt=json&limit=1`;
  const res = await fetch(url, {headers: {'User-Agent': 'VinylFlipbook/1.0'}});
  if(!res.ok) return null;
  const data = await res.json();
  const id = data['release-groups']?.[0]?.id;
  if(!id) return null;
  const art1200 = `https://coverartarchive.org/release-group/${id}/front-1200`;
  const art500 = `https://coverartarchive.org/release-group/${id}/front-500`;
  const ok1200 = await fetchHeadOK(art1200);
  if(ok1200) return art1200;
  const ok500 = await fetchHeadOK(art500);
  return ok500 ? art500 : null;
}
async function fetchHeadOK(url){ try{ const r = await fetch(url, {method:'HEAD'}); return r.ok; }catch{ return false; }}

// UI helpers
function getScroller(){ return document.getElementById('scroller'); }
function getCards(){ return Array.from(getScroller().querySelectorAll('.card')); }
function getCurrentIndex(){
  const scroller = getScroller();
  const center = scroller.scrollLeft + scroller.clientWidth/2;
  const cards = getCards(); if(!cards.length) return 0;
  let bestI = 0, bestD = Infinity;
  cards.forEach((el,i)=>{
    const rect = el.getBoundingClientRect();
    const left = rect.left + scroller.scrollLeft - scroller.getBoundingClientRect().left;
    const mid = left + rect.width/2;
    const d = Math.abs(mid - center);
    if(d < bestD){ bestD = d; bestI = i; }
  });
  return bestI;
}
function scrollToIndex(i){
  const cards = getCards();
  if(!cards.length) return;
  const clamped = Math.max(0, Math.min(cards.length-1, i));
  cards[clamped].scrollIntoView({behavior:'smooth', inline:'center', block:'nearest'});
}

// Build & render
function build(){
  state.filtered = normalizeData(state.all);
  sortBy(document.querySelector('#sort').value);
  buildFuse(state.filtered);
  applySearch(document.querySelector('#search').value?.trim() || '');
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

  scroller.addEventListener('wheel', (e)=>{
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    scroller.scrollLeft += delta;
    e.preventDefault();
  }, {passive:false});

  const prev = document.getElementById('prevBtn');
  const next = document.getElementById('nextBtn');
  if(prev && next){
    prev.onclick = ()=> scrollToIndex(getCurrentIndex()-1);
    next.onclick = ()=> scrollToIndex(getCurrentIndex()+1);
  }
}
function createCard(rec, index){
  const card = document.createElement('div'); card.className='card';
  const inner = document.createElement('div'); inner.className='inner';
  const sleeve = document.createElement('div'); sleeve.className='sleeve';
  const back = document.createElement('div'); back.className='back';

  const cover = document.createElement('div'); cover.className='cover';
  if(rec.cover){ cover.style.backgroundImage = `url('${rec.cover}')`; }
  else { cover.appendChild(makePlaceholder(rec)); attemptArtwork(rec, cover); }

  const meta = document.createElement('div'); meta.className='meta';
  const left = document.createElement('div');
  const title = document.createElement('div'); title.className='title'; title.innerHTML = hi(rec.title, currentQuery);
  const artist = document.createElement('div'); artist.className='artist'; artist.innerHTML = hi(rec.artist, currentQuery);
  left.appendChild(title); left.appendChild(artist);
  const yearChip = document.createElement('div'); yearChip.className='year-chip'; yearChip.textContent = rec.year || '';
  meta.appendChild(left); meta.appendChild(yearChip);

  sleeve.appendChild(cover); sleeve.appendChild(meta);

  const details = document.createElement('div'); details.className='details';
  [['Artist',rec.artist],['Album',rec.title],['Year',rec.year],['Genre',rec.genre],['Label',rec.label],['Format',rec.format],['Color',rec.color],['Notes',rec.notes]].forEach(([k,v])=>{
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
    const a = document.createElement('a'); a.href=rec.url; a.target='_blank'; a.rel='noreferrer noopener'; a.textContent='Open';
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
function prefetchArtwork(list){
  const max = Math.min(list.length, 50);
  let i = 0;
  const tick = async () => {
    if(i>=max) return;
    const rec = list[i++];
    if(!rec.cover) { const el = document.createElement('div'); await attemptArtwork(rec, el); }
    setTimeout(tick, 120);
  };
  tick();
}

// Controls
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
    const res = fuse.search(q); state.filtered = res.map(r => r.item);
  }else{
    state.filtered = normalizeData(state.all).filter(r=>{
      const hay = [r.title, r.artist, r.genre, r.label, r.year, r.format].join(' ').toLowerCase();
      return parts.every(p=> hay.includes(p));
    });
  }
  sortBy(document.querySelector('#sort').value);
}

// Boot
document.addEventListener('DOMContentLoaded', ()=>{
  const menuToggle = document.getElementById('menuToggle');
  const controls = document.getElementById('controls');
  if(menuToggle && controls){
    menuToggle.addEventListener('click', ()=>{
      const open = controls.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  document.querySelector('#search').addEventListener('input', (e)=>{ applySearch(e.target.value); render(); });
  document.querySelector('#sort').addEventListener('change', (e)=>{ sortBy(e.target.value); render(); });
  document.querySelector('#shuffle').addEventListener('click', ()=>{ state.filtered.sort(()=>Math.random()-.5); render(); });
  document.querySelector('#fileInput').addEventListener('change', (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if(ext==='json'){
      f.text().then(t=>{ const parsed = JSON.parse(t); state.all = Array.isArray(parsed)?parsed:(parsed.values||[]); build(); });
    }else{
      if(window.Papa){
        Papa.parse(f, {header:true, skipEmptyLines:true, complete:(r)=>{ state.all=r.data; build(); }});
      }else{
        f.text().then(text=>{
          const lines = text.split(/\\r?\\n/).filter(Boolean);
          const headers = lines.shift().split(',').map(s=>s.trim());
          const rows = lines.map(line=>{const cols=line.split(',');const o={};headers.forEach((h,i)=>o[h]=cols[i]);return o;});
          state.all = rows; build();
        });
      }
    }
  });
  build();
});
