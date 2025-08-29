// VERSION: v18 — simpler lane, no mobile menu, stronger button binding, tap-vs-drag flip, better iTunes search
'use strict';

const state = { all: window.INIT_DATA || [], filtered: [] };
let fuse = null;
let currentQuery = "";

// Map records irrespective of CSV header names
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

// Search
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

// iTunes cover art
const cache = { get:(k)=>{ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch{ return null; } }, set:(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} } };
function cacheKey(rec){ return 'art:' + (rec.artist||'').toLowerCase() + '|' + (rec.title||'').toLowerCase(); }
function hasMinInfo(rec){ const a=(rec.artist||'').trim().toLowerCase(), t=(rec.title||'').trim().toLowerCase(); return !!(a && t && a!=='unknown artist' && !/^untitled/.test(t)); }
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
function applyCover(el, url){ if(!el) return; el.innerHTML=''; el.style.backgroundImage = "url('" + url + "')"; }
async function itunesSearch(term, attribute){
  const q = encodeURIComponent(term); const attr = attribute ? `&attribute=${attribute}` : '';
  const url = `https://itunes.apple.com/search?media=music&entity=album&limit=25&term=${q}${attr}`;
  const res = await fetch(url, {mode:'cors'}); if(!res.ok) return null; return await res.json();
}
function scoreCandidate(rec, cand){
  const a=NORMALIZE(rec.artist), t=NORMALIZE(rec.title), ca=NORMALIZE(cand.artistName), ct=NORMALIZE(cand.collectionName);
  let s=0; if(ca===a) s+=4; else if(ca.includes(a)||a.includes(ca)) s+=2; if(ct===t) s+=4; else if(ct.includes(t)||t.includes(ct)) s+=2;
  if(/remaster|deluxe|anniversary|2014|2015|2019|2021/.test(ct)) s-=0.3; return s;
}
async function fetchITunes(rec){
  const tries = [
    await itunesSearch(`${rec.title} ${rec.artist}`, ''),
    await itunesSearch(`${rec.artist} ${rec.title}`, 'albumTerm'),
    await itunesSearch(`${rec.artist}`, 'artistTerm'),
  ];
  for(const d of tries){
    if(!d||!d.results||!d.results.length) continue;
    let best=null, bestScore=-1;
    for(const r of d.results){ const sc=scoreCandidate(rec,r); if(sc>bestScore){bestScore=sc; best=r;} }
    if(best && best.artworkUrl100){
      return best.artworkUrl100.replace(/100x100bb\.(jpg|png)$/,'1200x1200bb.$1');
    }
  }
  return null;
}

// UI helpers
const lane = () => document.getElementById('lane');
const cards = () => Array.from(lane().querySelectorAll('.card'));
function step(){ const c=cards()[0]; if(!c) return 0; const gap=24; const w=c.getBoundingClientRect().width; return Math.round(w+gap); }
function page(dir){ const l=lane(); if(!l) return; l.scrollBy({left: dir* (step() || Math.round(l.clientWidth*0.85)), behavior:'smooth'}); }

function render(){
  const root = lane(); if(!root) return; root.innerHTML='';
  state.filtered.forEach((rec,i)=>{ root.appendChild(card(rec,i)); });
  // eager covers for first 12
  Array.from(root.querySelectorAll('.cover')).slice(0,12).forEach(el=>{ const c = el.closest('.card'); attemptArtwork(c.__rec, el); });
}
function card(rec, idx){
  const card = document.createElement('div'); card.className='card'; card.__rec=rec;
  const inner = document.createElement('div'); inner.className='inner';
  const sleeve= document.createElement('div'); sleeve.className='sleeve';
  const back  = document.createElement('div'); back.className='back';
  const cover = document.createElement('div'); cover.className='cover';
  if(rec.cover){ cover.style.backgroundImage="url('"+rec.cover+"')"; }
  else { cover.appendChild(placeholder(rec)); }
  const meta=document.createElement('div'); meta.className='meta';
  const left=document.createElement('div');
  const title=document.createElement('div'); title.className='title'; title.innerHTML=hi(rec.title,currentQuery);
  const artist=document.createElement('div'); artist.className='artist'; artist.innerHTML=hi(rec.artist,currentQuery);
  left.appendChild(title); left.appendChild(artist); meta.appendChild(left);
  sleeve.appendChild(cover); sleeve.appendChild(meta);
  const details=document.createElement('div'); details.className='details';
  [['Artist',rec.artist],['Album',rec.title],['Genre',rec.genre],['Label',rec.label],['Format',rec.format],['Color',rec.color],['Notes',rec.notes]].forEach(([k,v])=>{
    if(!v) return; const row=document.createElement('div'); row.className='kv';
    const kEl=document.createElement('div'); kEl.className='k'; kEl.textContent=k;
    const vEl=document.createElement('div'); vEl.className='v'; vEl.textContent=v;
    row.appendChild(kEl); row.appendChild(vEl); details.appendChild(row);
  });
  back.appendChild(details);
  inner.appendChild(sleeve); inner.appendChild(back); card.appendChild(inner);

  // Tap vs drag flip
  let downX=0, downY=0, moved=false;
  const down = (e)=>{ const t=e.touches?e.touches[0]:e; downX=t.clientX; downY=t.clientY; moved=false; };
  const move = (e)=>{ const t=e.touches?e.touches[0]:e; if(Math.hypot(t.clientX-downX, t.clientY-downY) > 8) moved=true; };
  const up   = (e)=>{ if(!moved) card.classList.toggle('flipped'); };
  card.addEventListener('touchstart', down, {passive:true});
  card.addEventListener('touchmove', move, {passive:true});
  card.addEventListener('touchend', up, {passive:true});
  card.addEventListener('mousedown', down, {passive:true});
  card.addEventListener('mousemove', move, {passive:true});
  card.addEventListener('mouseup', up, {passive:true});

  return card;
}
function placeholder(rec){
  const base=(rec.artist && rec.artist!=='Unknown Artist'?rec.artist:rec.title)||'LP';
  const letters = base.trim().split(/\s+/).slice(0,2).map(s=>s[0]?s[0].toUpperCase():'').join('');
  const ph=document.createElement('div'); ph.className='placeholder';
  const i=document.createElement('div'); i.className='initials'; i.textContent=letters||'LP'; ph.appendChild(i); return ph;
}

// Data ops
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
  sortBy(document.getElementById('sort')?.value || 'title');
}

function build(){ state.filtered = normalizeData(state.all); sortBy('title'); buildFuse(state.filtered); render(); }

// Boot
(function(){
  function onReady(fn){ if(document.readyState!=='loading'){fn();} else {document.addEventListener('DOMContentLoaded', fn);} }
  onReady(function(){
    // Controls
    const searchEl=document.getElementById('search'); if(searchEl){ searchEl.addEventListener('input', e=>{ applySearch(e.target.value||''); render(); }); }
    const sortEl=document.getElementById('sort'); if(sortEl){ sortEl.addEventListener('change', e=>{ sortBy(e.target.value); render(); }); }
    const shuffleEl=document.getElementById('shuffle'); if(shuffleEl){ shuffleEl.addEventListener('click', ()=>{ state.filtered.sort(()=>Math.random()-.5); render(); }); }
    const fileEl=document.getElementById('fileInput');
    if(fileEl){
      fileEl.addEventListener('change', e=>{
        const f=(e.target.files&&e.target.files[0])||null; if(!f) return;
        const ext=(f.name.split('.').pop()||'').toLowerCase();
        if(ext==='json'){
          f.text().then(t=>{ const p=JSON.parse(t); state.all=Array.isArray(p)?p:(p.values||[]); build(); });
        }else if(window.Papa){
          Papa.parse(f,{header:true,skipEmptyLines:true,complete:r=>{ state.all=r.data; build(); }});
        }
      });
    }
    // Buttons — bind on multiple event types
    const bindNav=(btn,dir)=>{
      if(!btn) return;
      ['click','pointerdown','touchstart','mousedown'].forEach(type=>{
        btn.addEventListener(type,(e)=>{ e.stopPropagation(); e.preventDefault(); page(dir); }, {passive:false});
      });
    };
    bindNav(document.getElementById('prevBtn'), -1);
    bindNav(document.getElementById('nextBtn'),  1);

    // Trackpad vertical -> horizontal (gentle)
    const l=lane();
    l.addEventListener('wheel', (e)=>{
      if(Math.abs(e.deltaY) > Math.abs(e.deltaX)){ l.scrollLeft += e.deltaY; if(e.cancelable) e.preventDefault(); }
    }, {passive:false});

    build();
  });
})();