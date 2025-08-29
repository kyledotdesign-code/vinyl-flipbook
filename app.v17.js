// VERSION: v17 — center nav icons; hard-bind nav events; better iTunes match for 'Blue' (Joni Mitchell)
'use strict';

const state = { all: window.INIT_DATA || [], filtered: [] };
let fuse = null;
let currentQuery = "";

// Helpers to map incoming records
const NORMALIZE = s => (s||'').toString().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function buildKeyIndex(rec){ const idx={}; Object.keys(rec||{}).forEach(k=>idx[NORMALIZE(k)]=k); return idx; }
function pick(rec, idx, names){
  for (let i=0;i<names.length;i++){
    const key = idx[NORMALIZE(names[i])];
    if (key != null && rec[key] != null && String(rec[key]).trim() !== "") return String(rec[key]).trim();
  }
  return "";
}

function mapRecord(r, i){
  const idx = buildKeyIndex(r);
  const title = pick(r,idx,['title','album','record','release','name']);
  const artist= pick(r,idx,['artist','band','composer','performer','musician']);
  const genre = pick(r,idx,['genre','category','style']);
  const label = pick(r,idx,['label','publisher']);
  const format= pick(r,idx,['format','media','pressing']);
  const color = pick(r,idx,['color','variant']);
  const notes = [ pick(r,idx,['notes','special notes','comments','comment']),
                  pick(r,idx,['soundtrack/compilations','compilations','soundtrack'])].filter(Boolean).join(' • ');
  const cover = pick(r,idx,['cover_url','cover','image','art','artwork']);
  const url   = pick(r,idx,['url','discogs_url','link']);
  return { title: title||`Untitled #${i+1}`, artist: artist||'Unknown Artist', genre, label, format, color, notes, cover, url, _raw:r };
}
function normalizeData(arr){ return (arr||[]).map(mapRecord); }

// Fuzzy search
function buildFuse(items){
  if(!window.Fuse){ fuse = null; return; }
  fuse = new Fuse(items, {
    keys: [{name:'title',weight:0.5},{name:'artist',weight:0.48},{name:'genre',weight:0.02}],
    includeScore:true, threshold:0.35, ignoreLocation:true, minMatchCharLength:2,
  });
}
function hi(text, q){
  if(!q || !text) return text;
  try{
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/).filter(Boolean).join('|');
    if(!esc) return text;
    return text.replace(new RegExp('(' + esc + ')', 'ig'), '<mark class="search-hit">$1</mark>');
  }catch{ return text; }
}

// Cover art (iTunes only, improved matching)
const cache = { get:(k)=>{ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch{ return null; } }, set:(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} } };
function cacheKey(rec){ return 'art:' + (rec.artist||'').toLowerCase() + '|' + (rec.title||'').toLowerCase(); }
function hasMinInfo(rec){ const a=(rec.artist||'').trim().toLowerCase(), t=(rec.title||'').trim().toLowerCase(); return !!(a && t && a!=='unknown artist' && !/^untitled/.test(t)); }
async function attemptArtwork(rec, coverEl){
  if(rec.cover){ applyCover(coverEl, rec.cover); return; }
  if(!hasMinInfo(rec)) return;
  const key = cacheKey(rec); const cached = cache.get(key);
  if(cached){ applyCover(coverEl, cached); rec.cover = cached; return; }
  try{
    const url = await fetchITunes(rec);
    if(url){ applyCover(coverEl, url); rec.cover = url; cache.set(key, url); }
  }catch{}
}
function applyCover(el, url){ if(!el) return; el.innerHTML=''; el.style.backgroundImage = "url('" + url + "')"; }

async function itunesSearch(term, attribute){
  const q = encodeURIComponent(term);
  const attr = attribute ? `&attribute=${attribute}` : '';
  const url = `https://itunes.apple.com/search?media=music&entity=album&limit=10&term=${q}${attr}`;
  const res = await fetch(url, {mode:'cors'});
  if(!res.ok) return null;
  return await res.json();
}
function scoreCandidate(rec, cand){
  const a = NORMALIZE(rec.artist), t = NORMALIZE(rec.title);
  const ca = NORMALIZE(cand.artistName), ct = NORMALIZE(cand.collectionName);
  let score = 0;
  if (ca === a) score += 4; else if (ca.includes(a) || a.includes(ca)) score += 2;
  if (ct === t) score += 4; else if (ct.includes(t) || t.includes(ct)) score += 2;
  if (/remaster|deluxe|anniversary|2014|2015|2019/.test(ct)) score -= 0.3;
  return score;
}
async function fetchITunes(rec){
  const term = `${rec.title} ${rec.artist}`;
  const attempts = [
    await itunesSearch(term, 'albumTerm'),
    await itunesSearch(term, ''),
  ];
  for (const data of attempts){
    if(!data || !data.results || !data.results.length) continue;
    let best = null, bestScore = -1;
    for (const r of data.results){
      const sc = scoreCandidate(rec, r);
      if (sc > bestScore){ bestScore = sc; best = r; }
    }
    if(best && best.artworkUrl100){
      return best.artworkUrl100.replace(/100x100bb\.(jpg|png)$/,'1200x1200bb.$1');
    }
  }
  return null;
}

// UI helpers & navigation
function getScroller(){ return document.getElementById('scroller'); }
function getCards(){ const s=getScroller(); return s ? Array.from(s.querySelectorAll('.card')) : []; }
function getStep(){
  const s=getScroller(), cards=getCards();
  if(!s || !cards.length) return 0;
  const gap = parseFloat(getComputedStyle(s).gap || '24') || 24;
  const w = cards[0].getBoundingClientRect().width || 0;
  return Math.max(0, Math.round(w + gap));
}
function page(dir){
  const s=getScroller(); if(!s) return;
  const step = getStep() || Math.round(s.clientWidth * 0.85);
  s.scrollBy({left: dir*step, behavior:'smooth'});
}

function enableDragScroll(scroller){
  let down=false, startX=0, startLeft=0;
  const onDown = (e)=>{ down=true; startX=(e.touches?e.touches[0].clientX:e.clientX)||0; startLeft=scroller.scrollLeft; };
  const onMove = (e)=>{ if(!down) return; const x=(e.touches?e.touches[0].clientX:e.clientX)||0; scroller.scrollLeft=startLeft-(x-startX); if(e.cancelable) e.preventDefault(); };
  const onUp   = ()=>{ down=false; };
  scroller.addEventListener('mousedown', onDown, {passive:true});
  scroller.addEventListener('mousemove', onMove, {passive:false});
  scroller.addEventListener('mouseup', onUp, {passive:true});
  scroller.addEventListener('mouseleave', onUp, {passive:true});
  scroller.addEventListener('touchstart', onDown, {passive:true});
  scroller.addEventListener('touchmove', onMove, {passive:false});
  scroller.addEventListener('touchend', onUp, {passive:true});
}

// Build & render
function build(){
  state.filtered = normalizeData(state.all);
  sortBy('title'); buildFuse(state.filtered); render();
}
function render(){
  const root = document.getElementById('carousel'); if(!root) return;
  root.innerHTML = '';
  const scroller = document.createElement('div'); scroller.id='scroller';
  root.appendChild(scroller);

  // Cards
  for (let i=0;i<state.filtered.length;i++){ scroller.appendChild(createCard(state.filtered[i], i)); }

  // Eager covers for first 10 (helps Joni Mitchell 'Blue')
  Array.from(scroller.querySelectorAll('.card .cover')).slice(0,10).forEach(el => {
    const card = el.closest('.card'); attemptArtwork(card.__rec, el);
  });

  // Trackpad vertical -> horizontal
  scroller.addEventListener('wheel', (e)=>{
    if(Math.abs(e.deltaY) > Math.abs(e.deltaX)){ scroller.scrollLeft += e.deltaY; if(e.cancelable) e.preventDefault(); }
  }, {passive:false});

  enableDragScroll(scroller);

  // Bind nav buttons with strong handlers to avoid scroller stealing events
  const prev = document.getElementById('prevBtn'), next = document.getElementById('nextBtn');
  function bindNav(btn, dir){
    if(!btn) return;
    ['pointerdown','touchstart','mousedown','click'].forEach(type=>{
      btn.addEventListener(type, (e)=>{ e.stopPropagation(); e.preventDefault(); page(dir); }, {passive:false});
    });
  }
  bindNav(prev, -1); bindNav(next, 1);
}

function createCard(rec, idx){
  const card = document.createElement('div'); card.className='card'; card.__rec=rec;
  const inner = document.createElement('div'); inner.className='inner';
  const sleeve= document.createElement('div'); sleeve.className='sleeve';
  const back  = document.createElement('div'); back.className='back';

  const cover = document.createElement('div'); cover.className='cover';
  if(rec.cover){ cover.style.backgroundImage="url('"+rec.cover+"')"; }
  else { cover.appendChild(makePlaceholder(rec)); }

  const meta = document.createElement('div'); meta.className='meta';
  const left = document.createElement('div');
  const title= document.createElement('div'); title.className='title'; title.innerHTML = hi(rec.title, currentQuery);
  const artist=document.createElement('div'); artist.className='artist'; artist.innerHTML = hi(rec.artist, currentQuery);
  left.appendChild(title); left.appendChild(artist); meta.appendChild(left);
  sleeve.appendChild(cover); sleeve.appendChild(meta);

  const details = document.createElement('div'); details.className='details';
  [['Artist',rec.artist],['Album',rec.title],['Genre',rec.genre],['Label',rec.label],['Format',rec.format],['Color',rec.color],['Notes',rec.notes]].forEach(([k,v])=>{
    if(!v) return; const row=document.createElement('div'); row.className='kv';
    const kEl=document.createElement('div'); kEl.className='k'; kEl.textContent=k;
    const vEl=document.createElement('div'); vEl.className='v'; vEl.textContent=v;
    row.appendChild(kEl); row.appendChild(vEl); details.appendChild(row);
  });
  if(rec.url){
    const row=document.createElement('div'); row.className='kv';
    const kEl=document.createElement('div'); kEl.className='k'; kEl.textContent='Link';
    const vEl=document.createElement('div'); vEl.className='v';
    const a=document.createElement('a'); a.href=rec.url; a.target='_blank'; a.rel='noreferrer noopener'; a.textContent='Open';
    vEl.appendChild(a); row.appendChild(kEl); row.appendChild(vEl); details.appendChild(row);
  }

  back.appendChild(details);
  inner.appendChild(sleeve); inner.appendChild(back); card.appendChild(inner);
  card.addEventListener('click', ()=>{ card.classList.toggle('flipped'); });
  return card;
}

function makePlaceholder(rec){
  const base = (rec.artist && rec.artist!=='Unknown Artist' ? rec.artist : rec.title) || 'LP';
  const letters = base.trim().split(/\s+/).slice(0,2).map(s=>s[0]?s[0].toUpperCase():'').join('');
  const ph = document.createElement('div'); ph.className='placeholder';
  const initials = document.createElement('div'); initials.className='initials';
  initials.textContent = letters || 'LP'; ph.appendChild(initials); return ph;
}

// Controls
function sortBy(mode){
  if(mode==='random'){ state.filtered.sort(()=>Math.random()-.5); }
  else if(mode==='artist'){ state.filtered.sort((a,b)=>(a.artist||'').localeCompare(b.artist||'')); }
  else { state.filtered.sort((a,b)=>(a.title||'').localeCompare(b.title||'')); }
}
function applySearch(q){
  currentQuery = q || '';
  const parts = currentQuery.toLowerCase().split(/\s+/).filter(Boolean);
  if(parts.length >= 2 && fuse){
    const res = fuse.search(currentQuery); state.filtered = res.map(r=>r.item);
  }else{
    const all = normalizeData(state.all);
    state.filtered = all.filter(r=>{
      const hay = [r.title, r.artist, r.genre, r.label, r.format, r.notes].join(' ').toLowerCase();
      return parts.every(p => hay.indexOf(p) !== -1);
    });
  }
  const sortSel = document.getElementById('sort'); sortBy(sortSel ? sortSel.value : 'title');
}

// Boot
(function(){
  function onReady(fn){ if(document.readyState !== 'loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }
  onReady(function(){
    const menuToggle = document.getElementById('menuToggle');
    const controls = document.getElementById('controls');
    if(menuToggle && controls){
      menuToggle.addEventListener('click', function(){
        const open = controls.classList.toggle('open');
        menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      }, {passive:true});
    }
    const searchEl = document.getElementById('search'); if(searchEl){ searchEl.addEventListener('input', e=>{ applySearch(e.target.value||''); render(); }); }
    const sortEl = document.getElementById('sort'); if(sortEl){ sortEl.addEventListener('change', e=>{ sortBy(e.target.value); render(); }); }
    const shuffleEl = document.getElementById('shuffle'); if(shuffleEl){ shuffleEl.addEventListener('click', ()=>{ state.filtered.sort(()=>Math.random()-.5); render(); }); }
    const fileEl = document.getElementById('fileInput'); if(fileEl){
      fileEl.addEventListener('change', e=>{
        const f = (e.target.files && e.target.files[0]) || null; if(!f) return;
        const ext = (f.name.split('.').pop()||'').toLowerCase();
        if(ext === 'json'){
          f.text().then(t=>{ const parsed = JSON.parse(t); state.all = Array.isArray(parsed)?parsed:(parsed.values||[]); build(); });
        }else if(window.Papa){
          Papa.parse(f, {header:true, skipEmptyLines:true, complete:r=>{ state.all=r.data; build(); }});
        }else{
          f.text().then(text=>{
            const lines = text.split(/\r?\n/).filter(Boolean);
            const headers = (lines.shift()||'').split(',').map(s=>s.trim());
            const rows = lines.map(line=>{ const cols=line.split(','); const o={}; headers.forEach((h,i)=>o[h]=cols[i]); return o; });
            state.all = rows; build();
          });
        }
      });
    }
    build();
  });
})();