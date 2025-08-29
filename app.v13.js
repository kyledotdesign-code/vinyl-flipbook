// VERSION: v13 (better CSV key mapping + sane arrow scroll + cleaner placeholders)
'use strict';

const state = { all: window.INIT_DATA || [], filtered: [] };
let fuse = null;
let currentQuery = "";

// --- Utility: flexible, case-insensitive key getter with synonyms
const NORMALIZE = s => (s||'').toString().toLowerCase().replace(/[^a-z0-9]+/g,'').trim();
function buildKeyIndex(rec){
  const idx = {};
  Object.keys(rec || {}).forEach(k => { idx[NORMALIZE(k)] = k; });
  return idx;
}
function pick(rec, idx, names){
  for (let i=0;i<names.length;i++){
    const key = idx[NORMALIZE(names[i])];
    if (key != null && rec[key] != null && String(rec[key]).trim() !== "") return String(rec[key]).trim();
  }
  return "";
}

// Data mapping
function mapRecord(r, idx){
  const keyIndex = buildKeyIndex(r);
  const title = pick(r, keyIndex, ['title','album','record','release','name']);
  const artist = pick(r, keyIndex, ['artist','band','composer','performer','musician']);
  const year   = pick(r, keyIndex, ['year','date']);
  const genre  = pick(r, keyIndex, ['genre','category','style']);
  const label  = pick(r, keyIndex, ['label','publisher']);
  const format = pick(r, keyIndex, ['format','media','pressing']);
  const color  = pick(r, keyIndex, ['color','variant']);
  const notes  = [ pick(r, keyIndex, ['notes','special notes','comments','comment']),
                   pick(r, keyIndex, ['soundtrack/compilations','compilations','soundtrack']) ]
                   .filter(Boolean).join(' • ');
  const cover  = pick(r, keyIndex, ['cover_url','cover','image','art','artwork']);
  const url    = pick(r, keyIndex, ['url','discogs_url','link']);
  return {
    title: title || `Untitled #${idx+1}`,
    artist: artist || 'Unknown Artist',
    year, genre, label, format, color, notes, cover, url, _raw: r
  };
}
function normalizeData(arr){ return arr.map(mapRecord); }

// Fuzzy search
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
    return text.replace(new RegExp('(' + esc + ')', 'ig'), '<mark class="search-hit">$1</mark>');
  }catch{ return text; }
}

// Artwork (CORS-safe: iTunes only), skip weak records
const cache = {
  get: (k)=>{ try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch{ return null; } },
  set: (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
};
function cacheKey(rec){ return 'art:' + (rec.artist||'').toLowerCase() + '|' + (rec.title||'').toLowerCase(); }
function hasMinInfo(rec){
  const a = (rec.artist||'').trim().toLowerCase();
  const t = (rec.title||'').trim().toLowerCase();
  if(!a || !t) return false;
  if(a === 'unknown artist') return false;
  if(/^untitled/.test(t)) return false;
  return true;
}
async function attemptArtwork(rec, coverEl){
  if(rec.cover){ applyCover(coverEl, rec.cover); return; }
  if(!hasMinInfo(rec)) return;
  const key = cacheKey(rec);
  const cached = cache.get(key);
  if(cached){ applyCover(coverEl, cached); rec.cover = cached; return; }
  try{
    const url = await fetchITunes(rec);
    if(url){ applyCover(coverEl, url); rec.cover = url; cache.set(key, url); }
  }catch{}
}
function applyCover(el, url){ el.innerHTML=''; el.style.backgroundImage = "url('" + url + "')"; }

async function fetchITunes(rec){
  const q = encodeURIComponent((rec.artist||'') + ' ' + (rec.title||''));
  const url = 'https://itunes.apple.com/search?term=' + q + '&entity=album&limit=5';
  const res = await fetch(url, {mode:'cors'});
  if(!res.ok) return null;
  const data = await res.json();
  if(!data.results || !data.results.length) return null;
  const norm = s => (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const wantA = norm(rec.artist), wantT = norm(rec.title);
  let best = data.results.find(r=> norm(r.artistName).includes(wantA) && norm(r.collectionName).includes(wantT));
  if(!best) best = data.results[0];
  let art = best.artworkUrl100; if(!art) return null;
  return art.replace(/100x100bb\.(jpg|png)$/,'1200x1200bb.$1');
}

// UI helpers
function getScroller(){ return document.getElementById('scroller'); }
function getCards(){ const s=getScroller(); return s ? Array.from(s.querySelectorAll('.card')) : []; }

// Arrow behavior: move by exactly one card (+gap), not jump-to-center
function getStep(){
  const scroller = getScroller(); const cards = getCards();
  if(!scroller || !cards.length) return 0;
  const style = getComputedStyle(scroller);
  const gap = parseFloat(style.gap || '24') || 24;
  const w = cards[0].getBoundingClientRect().width;
  return Math.round(w + gap);
}
function page(direction){
  const scroller = getScroller(); if(!scroller) return;
  const step = getStep() || scroller.clientWidth * 0.9;
  scroller.scrollBy({ left: direction * step, behavior: 'smooth' });
}

// Lazy-load artwork on visibility
let _io = null;
function getIO(){
  if(_io !== null) return _io;
  if(!('IntersectionObserver' in window)){
    _io = { observe(){}, unobserve(){} };
    return _io;
  }
  const root = getScroller();
  _io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        const card = entry.target;
        const rec = card.__rec;
        const cover = card.querySelector('.cover');
        if(cover && rec && !cover.style.backgroundImage){
          attemptArtwork(rec, cover);
        }
        _io.unobserve(card);
      }
    });
  }, { root, threshold: 0.45 });
  return _io;
}

// Build & render
function build(){
  state.filtered = normalizeData(state.all);
  const sortSel = document.getElementById('sort');
  sortBy(sortSel ? sortSel.value : 'title');
  buildFuse(state.filtered);
  const searchEl = document.getElementById('search');
  applySearch(searchEl && searchEl.value ? searchEl.value.trim() : '');
  render();
}

function render(){
  const root = document.getElementById('carousel'); if(!root) return;
  root.innerHTML = '';
  const scroller = document.createElement('div'); scroller.id = 'scroller';
  root.appendChild(scroller);
  const io = getIO();

  for(let i=0;i<state.filtered.length;i++){
    const card = createCard(state.filtered[i], i);
    scroller.appendChild(card);
    io.observe(card);
  }

  scroller.addEventListener('wheel', function(e){
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    scroller.scrollLeft += delta; e.preventDefault();
  }, {passive:false});

  const prev = document.getElementById('prevBtn'); const next = document.getElementById('nextBtn');
  if(prev) prev.onclick = function(){ page(-1); };
  if(next) next.onclick = function(){ page(1); };
}

function createCard(rec, index){
  const card = document.createElement('div'); card.className='card'; card.__rec = rec;
  const inner = document.createElement('div'); inner.className='inner';
  const sleeve = document.createElement('div'); sleeve.className='sleeve';
  const back = document.createElement('div'); back.className='back';

  const cover = document.createElement('div'); cover.className='cover';
  if(rec.cover){ cover.style.backgroundImage = "url('" + rec.cover + "')"; }
  else { cover.appendChild(makePlaceholder(rec)); /* artwork will load when visible */ }

  const meta = document.createElement('div'); meta.className='meta';
  const left = document.createElement('div');
  const title = document.createElement('div'); title.className='title'; title.innerHTML = hi(rec.title, currentQuery);
  const artist = document.createElement('div'); artist.className='artist'; artist.innerHTML = hi(rec.artist, currentQuery);
  left.appendChild(title); left.appendChild(artist);
  meta.appendChild(left);
  sleeve.appendChild(cover); sleeve.appendChild(meta);

  const details = document.createElement('div'); details.className='details';
  const rows = [['Artist',rec.artist],['Album',rec.title],['Genre',rec.genre],['Label',rec.label],['Format',rec.format],['Color',rec.color],['Notes',rec.notes]];
  for(let i=0;i<rows.length;i++){ const k=rows[i][0], v=rows[i][1]; if(!v) continue;
    const row = document.createElement('div'); row.className='kv';
    const kEl = document.createElement('div'); kEl.className='k'; kEl.textContent=k;
    const vEl = document.createElement('div'); vEl.className='v'; vEl.textContent=v;
    row.appendChild(kEl); row.appendChild(vEl); details.appendChild(row);
  }
  if(rec.url){
    const row = document.createElement('div'); row.className='kv';
    const kEl = document.createElement('div'); kEl.className='k'; kEl.textContent='Link';
    const vEl = document.createElement('div'); vEl.className='v';
    const a = document.createElement('a'); a.href=rec.url; a.target='_blank'; a.rel='noreferrer noopener'; a.textContent='Open';
    vEl.appendChild(a); row.appendChild(kEl); row.appendChild(vEl); details.appendChild(row);
  }
  back.appendChild(details);

  inner.appendChild(sleeve); inner.appendChild(back); card.appendChild(inner);
  card.addEventListener('click', function(){ card.classList.toggle('flipped'); });
  return card;
}

function makePlaceholder(rec){
  // Use 2-letter initials from Artist or Title; avoid emojis that render as 'J#' on some systems
  const base = (rec.artist && rec.artist !== 'Unknown Artist' ? rec.artist : rec.title) || 'LP';
  const letters = base.trim().split(/\s+/).slice(0,2).map(s => s[0] ? s[0].toUpperCase() : '').join('');
  const ph = document.createElement('div'); ph.className='placeholder';
  const initials = document.createElement('div'); initials.className='initials';
  initials.textContent = letters || 'LP';
  ph.appendChild(initials); return ph;
}

// Controls
function sortBy(mode){
  if(mode === 'random'){ state.filtered.sort(function(){return Math.random()-.5;}); }
  else if(mode==='artist'){ state.filtered.sort(function(a,b){ return (a.artist||'').localeCompare(b.artist||''); }); }
  else if(mode==='year'){ state.filtered.sort(function(a,b){ return (parseInt(a.year||0)||0) - (parseInt(b.year||0)||0); }); }
  else { state.filtered.sort(function(a,b){ return (a.title||'').localeCompare(b.title||''); }); }
}
function applySearch(q){
  currentQuery = q || '';
  const parts = currentQuery.toLowerCase().split(/\s+/).filter(Boolean);
  if(parts.length >= 2 && fuse){
    const res = fuse.search(currentQuery); state.filtered = res.map(function(r){ return r.item; });
  }else{
    const all = normalizeData(state.all);
    state.filtered = all.filter(function(r){
      const hay = [r.title, r.artist, r.genre, r.label, r.year, r.format, r.notes].join(' ').toLowerCase();
      return parts.every(function(p){ return hay.indexOf(p) !== -1; });
    });
  }
  const sortSel = document.getElementById('sort'); sortBy(sortSel ? sortSel.value : 'title');
}

// Boot
(function(){
  function onReady(fn){ if(document.readyState !== 'loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }
  onReady(function(){
    try{
      var menuToggle = document.getElementById('menuToggle');
      var controls = document.getElementById('controls');
      if(menuToggle && controls){
        menuToggle.addEventListener('click', function(){
          var open = controls.classList.toggle('open');
          menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      }
      var searchEl = document.getElementById('search'); if(searchEl){ searchEl.addEventListener('input', function(e){ applySearch(e.target.value || ''); render(); }); }
      var sortEl = document.getElementById('sort'); if(sortEl){ sortEl.addEventListener('change', function(e){ sortBy(e.target.value); render(); }); }
      var shuffleEl = document.getElementById('shuffle'); if(shuffleEl){ shuffleEl.addEventListener('click', function(){ state.filtered.sort(function(){return Math.random()-.5}); render(); }); }
      var fileEl = document.getElementById('fileInput'); if(fileEl){
        fileEl.addEventListener('change', function(e){
          var f = (e.target.files && e.target.files[0]) || null; if(!f) return;
          var ext = (f.name.split('.').pop() || '').toLowerCase();
          if(ext === 'json'){
            f.text().then(function(t){ var parsed = JSON.parse(t); state.all = Array.isArray(parsed)?parsed:(parsed.values||[]); build(); });
          }else{
            if(window.Papa){ Papa.parse(f, {header:true, skipEmptyLines:true, complete:function(r){ state.all=r.data; build(); }}); }
            else{
              f.text().then(function(text){
                var lines = text.split(/\r?\n/).filter(Boolean);
                var headers = (lines.shift() || '').split(',').map(function(s){return s.trim()});
                var rows = lines.map(function(line){ var cols=line.split(','); var o={}; headers.forEach(function(h,i){o[h]=cols[i]}); return o; });
                state.all = rows; build();
              });
            }
          }
        });
      }
      build();
    }catch(err){ console.error('Boot error:', err); }
  });
})();