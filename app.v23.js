// VERSION: v23 — lazy-loaded artwork + preload + retry + concurrency
'use strict';

const state = { all: window.INIT_DATA || [], filtered: [] };
let fuse = null;
let currentQuery = "";

// ---------- utils & mapping ----------
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

// ---------- search ----------
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

// ---------- artwork loader ----------
const cache = { get:(k)=>{ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch{ return null; } }, set:(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }, keys:()=>Object.keys(localStorage||{}) };
function cacheKey(rec){ return 'art:' + (rec.artist||'').toLowerCase() + '|' + (rec.title||'').toLowerCase(); }
function hasMinInfo(rec){ const a=(rec.artist||'').trim().toLowerCase(), t=(rec.title||'').trim().toLowerCase(); return !!(a && t && a!=='unknown artist' && !/^untitled/.test(t)); }

function loadImage(url){ return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(url); img.onerror=reject; img.referrerPolicy='no-referrer'; img.src = url + (url.includes('?')?'&':'?') + 'v=' + Date.now(); }); }
function sizedArt(url, size){ return url.replace(/\/[0-9]+x[0-9]+bb\.(jpg|png)/, `/${size}x${size}bb.$1`); }

async function attemptArtworkWithPreload(rec, coverEl, force=false){
  if(!hasMinInfo(rec)) return;
  if(!force && rec.cover){ // if already set on record, just ensure it's painted
    try{ await loadImage(rec.cover); applyCover(coverEl, rec.cover); }catch{} return;
  }
  const key = cacheKey(rec);
  if(!force){
    const cached = cache.get(key);
    if(cached){ try{ await loadImage(cached); applyCover(coverEl, cached); rec.cover=cached; return; }catch{ /* fall through */ } }
  }
  try{
    const url = await fetchITunes(rec);
    if(!url) return;
    const sizes=[1200,600,300];
    for(const s of sizes){
      const candidate = sizedArt(url, s);
      try{ await loadImage(candidate); applyCover(coverEl, candidate); rec.cover=candidate; cache.set(key, candidate); return; }catch{}
    }
  }catch{}
}

function applyCover(el, url){ if(!el) return; el.innerHTML=''; el.style.backgroundImage = "url('" + url + "')"; }

async function itunesSearch(term, attribute){
  const q = encodeURIComponent(term); const attr = attribute ? `&attribute=${attribute}` : '';
  const url = `https://itunes.apple.com/search?media=music&entity=album&limit=25&term=${q}${attr}`;
  const res = await fetch(url, {mode:'cors', cache:'no-store'}); if(!res.ok) return null; return await res.json();
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
      return best.artworkUrl100;
    }
  }
  return null;
}

// concurrency queue so we don't hammer the API/CDN
const loaderQ = { q:[], active:0, max:4, push(task){ this.q.push(task); this.pump(); }, pump(){ while(this.active<this.max && this.q.length){ const t=this.q.shift(); this.active++; Promise.resolve().then(t).catch(()=>{}).finally(()=>{ this.active--; setTimeout(()=>this.pump(), 60); }); } } };

function lazyScheduleCover(coverEl, rec){
  const schedule = (force=false)=> loaderQ.push(()=> attemptArtworkWithPreload(rec, coverEl, force));
  if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(ent=>{
        if(ent.isIntersecting){ io.unobserve(ent.target); schedule(false); }
      });
    }, { root: document.getElementById('lane'), rootMargin:'200px', threshold:0.1 });
    io.observe(coverEl);
  }else{
    // fallback: schedule immediately but queued
    schedule(false);
  }
}

// ---------- layout & rendering ----------
const lane = () => document.getElementById('lane');
function step(){
  const firstTile = lane().querySelector('.tile');
  if(!firstTile) return 0;
  const w = firstTile.getBoundingClientRect().width;
  const gap = 24;
  return Math.round(w + gap);
}
function page(dir){ const l=lane(); if(!l) return; l.scrollBy({left: dir * (step() || Math.round(l.clientWidth*0.85)), behavior:'smooth'}); }

function render(){
  const root = lane(); if(!root) return; root.innerHTML='';
  if(!state.filtered.length){
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No records yet — click Import to load your CSV/JSON.';
    root.appendChild(empty);
    return;
  }
  state.filtered.forEach((rec,i)=>{ root.appendChild(tile(rec,i)); });
  // Lazy-load artwork for all covers with concurrency; previously only first 12 loaded.
  const covers = root.querySelectorAll('.cover');
  covers.forEach(el=>{
    const rec = el.closest('.tile').querySelector('.card').__rec;
    lazyScheduleCover(el, rec);
  });
  console.log(`Rendered ${state.filtered.length} records; queued ${covers.length} covers`);
}
function tile(rec, idx){
  const wrap = document.createElement('div'); wrap.className='tile';
  const card = document.createElement('div'); card.className='card'; card.__rec=rec;
  const inner = document.createElement('div'); inner.className='inner';
  const sleeve= document.createElement('div'); sleeve.className='sleeve';
  const back  = document.createElement('div'); back.className='back';
  const cover = document.createElement('div'); cover.className='cover';
  if(rec.cover){ cover.style.backgroundImage="url('"+rec.cover+"')"; }
  else { cover.appendChild(placeholder(rec)); }
  sleeve.appendChild(cover);

  const details=document.createElement('div'); details.className='details';
  [['Artist',rec.artist],['Album',rec.title],['Genre',rec.genre],['Label',rec.label],['Format',rec.format],['Color',rec.color],['Notes',rec.notes]].forEach(([k,v])=>{
    if(!v) return; const row=document.createElement('div'); row.className='kv';
    const kEl=document.createElement('div'); kEl.className='k'; kEl.textContent=k;
    const vEl=document.createElement('div'); vEl.className='v'; vEl.textContent=v;
    row.appendChild(kEl); row.appendChild(vEl); details.appendChild(row);
  });
  back.appendChild(details);
  inner.appendChild(sleeve); inner.appendChild(back); card.appendChild(inner);

  if(window.PointerEvent){
    let downX=0, downY=0, drag=false, t0=0;
    card.addEventListener('pointerdown', (e)=>{
      t0=Date.now(); drag=false; downX=e.clientX; downY=e.clientY; try{ card.setPointerCapture(e.pointerId); }catch{}
    }, {passive:true});
    card.addEventListener('pointermove', (e)=>{
      if(Math.hypot(e.clientX-downX, e.clientY-downY) > 8) drag=true;
    }, {passive:true});
    card.addEventListener('pointerup', (e)=>{
      try{ card.releasePointerCapture(e.pointerId); }catch{}
      if(!drag && Date.now()-t0 < 700){ card.classList.toggle('flipped'); }
    }, {passive:true});
  }else{
    card.addEventListener('click', ()=> card.classList.toggle('flipped'));
  }

  const caption = document.createElement('div'); caption.className='caption';
  const title=document.createElement('div'); title.className='title'; title.innerHTML=hi(rec.title,currentQuery);
  const artist=document.createElement('div'); artist.className='artist'; artist.innerHTML=hi(rec.artist,currentQuery);
  caption.appendChild(title); caption.appendChild(artist);

  wrap.appendChild(card); wrap.appendChild(caption);
  return wrap;
}
function placeholder(rec){
  const base=(rec.artist && rec.artist!=='Unknown Artist'?rec.artist:rec.title)||'LP';
  const letters = base.trim().split(/\s+/).slice(0,2).map(s=>s[0]?s[0].toUpperCase():'').join('');
  const ph=document.createElement('div'); ph.className='placeholder';
  const i=document.createElement('div'); i.className='initials'; i.textContent=letters||'LP'; ph.appendChild(i); return ph;
}

// ---------- sort & search ----------
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

async function fetchSheetCsv(){
  const url = (window.SHEET_CSV_URL||'').trim();
  if(!url) return false;
  try{
    const res = await fetch(url, {mode:'cors', cache:'no-store'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const text = await res.text();
    const parsed = Papa.parse(text, {header:true, skipEmptyLines:true});
    if(parsed && parsed.data && parsed.data.length){
      state.all = parsed.data;
      build();
      console.log(`Loaded ${parsed.data.length} rows from Google Sheets`);
      return true;
    }
  }catch(e){
    console.warn('Sheet fetch failed:', e);
  }
  return false;
}

// ---------- init & events ----------
(function(){
  function onReady(fn){ if(document.readyState!=='loading'){fn();} else {document.addEventListener('DOMContentLoaded', fn);} }
  onReady(async function(){
    const searchEl=document.getElementById('search'); if(searchEl){ searchEl.addEventListener('input', e=>{ applySearch(e.target.value||''); render(); }); }
    const sortEl=document.getElementById('sort'); if(sortEl){ sortEl.addEventListener('change', e=>{ sortBy(e.target.value); render(); }); }
    const shuffleEl=document.getElementById('shuffle'); if(shuffleEl){ shuffleEl.addEventListener('click', ()=>{ state.filtered.sort(()=>Math.random()-.5); render(); }); }
    const refreshBtn=document.getElementById('refreshArt'); if(refreshBtn){ refreshBtn.addEventListener('click', ()=>{
      // clear all cached covers and retry visible + near-visible
      cache.keys().filter(k=>k.startsWith('art:')).forEach(k=>localStorage.removeItem(k));
      document.querySelectorAll('.cover').forEach(el=>{
        const rec = el.closest('.tile').querySelector('.card').__rec;
        el.style.backgroundImage=''; el.innerHTML=''; el.appendChild(placeholder(rec));
        loaderQ.push(()=> attemptArtworkWithPreload(rec, el, true));
      });
    }); }
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
    const bindNav=(btn,dir)=>{
      if(!btn) return;
      ['click','pointerdown','touchstart','mousedown'].forEach(type=>{
        btn.addEventListener(type,(e)=>{ e.stopPropagation(); e.preventDefault(); page(dir); }, {passive:false});
      });
    };
    bindNav(document.getElementById('prevBtn'), -1);
    bindNav(document.getElementById('nextBtn'),  1);
    const l=document.getElementById('lane');
    l.addEventListener('wheel', (e)=>{
      if(Math.abs(e.deltaY) > Math.abs(e.deltaX)){ l.scrollLeft += e.deltaY; if(e.cancelable) e.preventDefault(); }
    }, {passive:false});

    // Boot with fallback data, then load your Google Sheet.
    build();
    await fetchSheetCsv();
  });
})();