// VERSION: v11 (Vinyl Collection; year tag removed)
'use strict';

const state = { all: window.INIT_DATA || [], filtered: [] };
let fuse = null;
let currentQuery = "";

// Data mapping
function mapRecord(r, idx){
  const k = (key)=> r[key] ?? r[key && key.replace && key.replace(/-/g,'_')] ?? r[key && key.replace && key.replace(/\s+/g,'_')] ?? r[key && key.toLowerCase && key.toLowerCase()] ?? r[key && key.toUpperCase && key.toUpperCase()];
  const title = k('album') || k('title') || k('record') || k('release') || `Untitled #${idx+1}`;
  const artist = k('artist') || k('band') || k('composer') || 'Unknown Artist';
  const year = String(k('year') || '').replace(/\..*$/,'') || '';
  const genre = k('genre') || '';
  const label = k('label') || '';
  const format = k('format') || k('media') || '';
  const color = k('color') || k('variant') || '';
  const notes = k('notes') || k('comments') || '';
  const cover = k('cover_url') || k('cover') || k('image') || k('art') || '';
  const url = k('url') || k('discogs_url') || '';
  return {title, artist, year, genre, label, format, color, notes, cover, url, _raw:r};
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

// Artwork
const cache = {
  get: (k)=>{ try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch{ return null; } },
  set: (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
};
function cacheKey(rec){ return 'art:' + (rec.artist||'').toLowerCase() + '|' + (rec.title||'').toLowerCase(); }

async function attemptArtwork(rec, coverEl){
  if(rec.cover){ applyCover(coverEl, rec.cover); return; }
  const key = cacheKey(rec);
  const cached = cache.get(key);
  if(cached){ applyCover(coverEl, cached); rec.cover = cached; return; }
  const providers = [fetchITunes, fetchMusicBrainzCover];
  for (let p of providers){
    try{
      const url = await p(rec);
      if(url){ applyCover(coverEl, url); rec.cover = url; cache.set(key, url); return; }
    }catch{}
  }
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
async function fetchMusicBrainzCover(rec){
  const q = encodeURIComponent('artist:"' + (rec.artist||'') + '" AND release:"' + (rec.title||'') + '"');
  const url = 'https://musicbrainz.org/ws/2/release-group/?query=' + q + '&fmt=json&limit=1';
  const res = await fetch(url, {headers: {'User-Agent': 'VinylCollection/1.0'}});
  if(!res.ok) return null;
  const data = await res.json();
  const id = data['release-groups'] && data['release-groups'][0] && data['release-groups'][0].id;
  if(!id) return null;
  const art1200 = 'https://coverartarchive.org/release-group/' + id + '/front-1200';
  const art500  = 'https://coverartarchive.org/release-group/' + id + '/front-500';
  const ok1200 = await fetchHeadOK(art1200);
  if(ok1200) return art1200;
  const ok500 = await fetchHeadOK(art500);
  return ok500 ? art500 : null;
}
async function fetchHeadOK(url){ try{ const r = await fetch(url, {method:'HEAD'}); return r.ok; }catch{ return false; }}

// UI helpers
function getScroller(){ return document.getElementById('scroller'); }
function getCards(){ const s=getScroller(); return s ? Array.from(s.querySelectorAll('.card')) : []; }
function getCurrentIndex(){
  const scroller = getScroller(); if(!scroller) return 0;
  const center = scroller.scrollLeft + scroller.clientWidth/2;
  const cards = getCards(); if(!cards.length) return 0;
  let bestI = 0, bestD = Infinity;
  for(let i=0;i<cards.length;i++){
    const el = cards[i];
    const rect = el.getBoundingClientRect();
    const left = rect.left + scroller.scrollLeft - scroller.getBoundingClientRect().left;
    const mid = left + rect.width/2;
    const d = Math.abs(mid - center);
    if(d < bestD){ bestD = d; bestI = i; }
  }
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
  const sortSel = document.getElementById('sort');
  sortBy(sortSel ? sortSel.value : 'title');
  buildFuse(state.filtered);
  const searchEl = document.getElementById('search');
  applySearch(searchEl && searchEl.value ? searchEl.value.trim() : '');
  render();
  prefetchArtwork(state.filtered);
}
function render(){
  const root = document.getElementById('carousel'); if(!root) return;
  root.innerHTML = '';
  const scroller = document.createElement('div'); scroller.id = 'scroller';
  root.appendChild(scroller);
  for(let i=0;i<state.filtered.length;i++){ scroller.appendChild(createCard(state.filtered[i], i)); }
  scroller.addEventListener('wheel', function(e){
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    scroller.scrollLeft += delta; e.preventDefault();
  }, {passive:false});
  const prev = document.getElementById('prevBtn'); const next = document.getElementById('nextBtn');
  if(prev) prev.onclick = function(){ scrollToIndex(getCurrentIndex()-1); };
  if(next) next.onclick = function(){ scrollToIndex(getCurrentIndex()+1); };
}
function createCard(rec, index){
  const card = document.createElement('div'); card.className='card';
  const inner = document.createElement('div'); inner.className='inner';
  const sleeve = document.createElement('div'); sleeve.className='sleeve';
  const back = document.createElement('div'); back.className='back';

  const cover = document.createElement('div'); cover.className='cover';
  if(rec.cover){ cover.style.backgroundImage = "url('" + rec.cover + "')"; }
  else { cover.appendChild(makePlaceholder(rec)); attemptArtwork(rec, cover); }

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
  const ph = document.createElement('div'); ph.className='placeholder';
  const initials = document.createElement('div'); initials.className='initials';
  const a = (rec.title || 'Untitled').trim().split(/\s+/).slice(0,2).map(function(s){return (s && s[0]) ? s[0].toUpperCase() : ''}).join('');
  initials.textContent = a || '🎵'; ph.appendChild(initials); return ph;
}
function prefetchArtwork(list){
  const max = Math.min(list.length, 50); let i = 0;
  function tick(){ if(i>=max) return; const rec = list[i++]; if(!rec.cover){ const el = document.createElement('div'); attemptArtwork(rec, el).then(function(){}); } setTimeout(tick, 120); }
  tick();
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
      const hay = [r.title, r.artist, r.genre, r.label, r.year, r.format].join(' ').toLowerCase();
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