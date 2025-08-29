// VERSION: v29 — View label swap, stricter album mapping, single Refresh Art (deep), iOS install help
'use strict';

const state = { all: window.INIT_DATA || [], filtered: [], view: 'flip' };
let fuse = null;
let currentQuery = "";
let deferredPrompt = null;

// ---------- utils & mapping ----------
const NORMALIZE = s => (s||'').toString().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const TIDY = s => (s||'').toString()
  .replace(/^[“”"']+|[“”"']+$/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function buildKeyIndex(rec){ const idx={}; Object.keys(rec||{}).forEach(k=>idx[NORMALIZE(k)]=k); return idx; }
function pick(rec, idx, names){
  for (let i=0;i<names.length;i++){
    const key = idx[NORMALIZE(names[i])];
    if (key != null && rec[key] != null && String(rec[key]).trim() !== "") return TIDY(String(rec[key]));
  }
  return "";
}
function mapRecord(r, i){
  const idx = buildKeyIndex(r);
  // Prefer strict Album, then Title — avoid generic "Name" unless both missing
  let album = pick(r,idx,['album']);
  if(!album) album = pick(r,idx,['title','record','release']);
  const artist= pick(r,idx,['artist','band','composer','performer','musician']);
  const genre = pick(r,idx,['genre','category','style']);
  const label = pick(r,idx,['label','publisher']);
  const format= pick(r,idx,['format','media','pressing']);
  const color = pick(r,idx,['color','variant']);
  const notes = [ pick(r,idx,['notes','special notes','comments','comment']),
                  pick(r,idx,['soundtrack/compilations','compilations','soundtrack'])].filter(Boolean).join(' • ');
  const cover = pick(r,idx,['cover_url','cover','image','art','artwork']);
  const url   = pick(r,idx,['url','discogs_url','link']);
  const fallback = album || `Untitled #${i+1}`;
  return { title: fallback, artist: artist||'Unknown Artist', genre, label, format, color, notes, cover, url, _raw:r };
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

function withTimeout(promise, ms=7000){
  const ctl = new AbortController();
  const t = setTimeout(()=>ctl.abort(), ms);
  return Promise.race([
    promise(ctl),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms+50))
  ]).finally(()=>clearTimeout(t));
}
function fetchJson(url, ctl){ return fetch(url, {mode:'cors', cache:'no-store', signal:ctl.signal}).then(r=>r.ok?r.json():null); }

function loadImage(url){ return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(url); img.onerror=reject; img.referrerPolicy='no-referrer'; img.src = url + (url.includes('?')?'&':'?') + 'v=' + Date.now(); }); }
function sizedArt(url, size){ return url.replace(/\/[0-9]+x[0-9]+bb\.(jpg|png)/, `/${size}x${size}bb.$1`); }

function cleanTitle(s){ return (s||'').replace(/\b(deluxe|remaster(?:ed)?|anniversary|expanded|edition|mono|stereo)\b/ig,'').replace(/\(.*?\)|\[.*?\]/g,'').trim(); }

async function attemptArtworkWithPreload(rec, coverEl, force=false){
  if(!hasMinInfo(rec)) return;
  if(!force && rec.cover){ try{ await loadImage(rec.cover); applyCover(coverEl, rec.cover); }catch{} return; }
  const key = cacheKey(rec);
  if(!force){
    const cached = cache.get(key);
    if(cached){ try{ await loadImage(cached); applyCover(coverEl, cached); rec.cover=cached; return; }catch{} }
  }
  // Try iTunes first, then Deezer (via JSONP). No Wikipedia.
  let found = null;
  try{ found = await fetchITunes(rec); }catch{}
  if(!found){ try{ found = await fetchDeezer(rec); }catch{} }
  if(!found) return;

  const sizes=[1200,600,300];
  for(const s of sizes){
    const candidate = /mzstatic/.test(found) ? sizedArt(found, s) : found;
    try{ await loadImage(candidate); applyCover(coverEl, candidate); rec.cover=candidate; cache.set(key, candidate); return; }catch{} }
}

function applyCover(el, url){ if(!el) return; el.innerHTML=''; el.style.backgroundImage = "url('" + url + "')"; }

// iTunes
async function itunesSearch(term, attribute){
  const q = encodeURIComponent(term); const attr = attribute ? `&attribute=${attribute}` : '';
  const url = `https://itunes.apple.com/search?media=music&entity=album&limit=25&term=${q}${attr}`;
  return withTimeout((ctl)=>fetchJson(url, ctl), 7000);
}
function scoreCandidate(rec, cand){
  const a=NORMALIZE(rec.artist), t=NORMALIZE(rec.title), ca=NORMALIZE(cand.artistName), ct=NORMALIZE(cand.collectionName);
  let s=0; if(ca===a) s+=4; else if(ca.includes(a)||a.includes(ca)) s+=2; if(ct===t) s+=4; else if(ct.includes(t)||t.includes(ct)) s+=2;
  if(/remaster|deluxe|anniversary|2014|2015|2019|2021/.test(ct)) s-=0.3; return s;
}
async function fetchITunes(rec){
  const titleClean = cleanTitle(rec.title);
  const tries = [
    await itunesSearch(`${titleClean} ${rec.artist}`, ''),
    await itunesSearch(`${rec.artist} ${titleClean}`, 'albumTerm'),
    await itunesSearch(`${rec.artist}`, 'artistTerm'),
    await itunesSearch(`${titleClean}`, 'albumTerm'),
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

// Deezer via JSONP (CORS-safe)
function deezerJSONP(url, timeout=9000){
  return new Promise((resolve, reject)=>{
    const cb = '__dz_cb_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const cleanup = ()=>{ try{ delete window[cb]; }catch{}; if(s.parentNode) s.parentNode.removeChild(s); clearTimeout(tid); };
    const tid = setTimeout(()=>{ cleanup(); reject(new Error('timeout')); }, timeout);
    window[cb] = (data)=>{ cleanup(); resolve(data); };
    s.src = url + (url.includes('?')?'&':'?') + 'output=jsonp&callback=' + cb;
    s.onerror = ()=>{ cleanup(); reject(new Error('script error')); };
    document.head.appendChild(s);
  });
}
async function fetchDeezer(rec){
  const q = encodeURIComponent(`artist:"${rec.artist}" album:"${cleanTitle(rec.title)}"`);
  const url = `https://api.deezer.com/search/album?q=${q}`;
  const data = await deezerJSONP(url, 9000);
  const list = data && data.data || [];
  if(!list.length) return null;
  // Score by similarity
  let best=null, bestScore=-1;
  const ar = NORMALIZE(rec.artist);
  const tt = NORMALIZE(rec.title);
  for(const a of list){
    const ca = NORMALIZE(a.artist && a.artist.name);
    const ct = NORMALIZE(a.title);
    let s=0; if(ca===ar) s+=4; else if(ca.includes(ar)||ar.includes(ca)) s+=2;
    if(ct===tt) s+=4; else if(ct.includes(tt)||tt.includes(ct)) s+=2;
    if(/best of|greatest hits|remaster|deluxe/.test(ct) && !/best of|greatest hits/.test(tt)) s-=0.5;
    if(s>bestScore){ bestScore=s; best=a; }
  }
  if(best && (best.cover_xl || best.cover_big || best.cover_medium)){
    return best.cover_xl || best.cover_big || best.cover_medium;
  }
  return null;
}

// concurrency queue
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
  }else{ schedule(false); }
}

// ---------- layout & rendering ----------
const lane = () => document.getElementById('lane');
function step(){
  const firstTile = lane().querySelector('.tile');
  if(!firstTile) return 0;
  const w = firstTile.getBoundingClientRect().width;
  const gap = getComputedStyle(lane()).display==='grid' ? 18 : 24;
  return Math.round(w + gap);
}
function page(dir){ const l=lane(); if(!l) return; if(state.view==='flip'){ l.scrollBy({left: dir * (step() || Math.round(l.clientWidth*0.85)), behavior:'smooth'}); } else { window.scrollBy({top: dir * window.innerHeight*0.8, behavior:'smooth'}); } }

function render(){
  const root = lane(); if(!root) return; root.innerHTML='';
  document.body.classList.toggle('view-grid', state.view==='grid');
  if(!state.filtered.length){
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No records yet — open the Google Sheet to edit.';
    root.appendChild(empty);
    return;
  }
  state.filtered.forEach((rec,i)=>{ root.appendChild(tile(rec,i)); });
  const covers = root.querySelectorAll('.cover');
  covers.forEach(el=>{
    const rec = el.closest('.tile').querySelector('.card').__rec;
    lazyScheduleCover(el, rec);
  });
}
function tile(rec, idx){
  const wrap = document.createElement('div'); wrap.className='tile'; wrap.dataset.key = cacheKey(rec);
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
      if(!drag && Date.now()-t0 < 700 && state.view==='flip'){ card.classList.toggle('flipped'); }
    }, {passive:true});
  }else{
    card.addEventListener('click', ()=> state.view==='flip' && card.classList.toggle('flipped'));
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

// ---------- stats ----------
function buildStats(items){
  const all = normalizeData(items);
  const total = all.length;
  const withCover = all.filter(r=>r.cover && String(r.cover).trim()!=='').length;
  const artistCount = new Map();
  const genreCount = new Map();
  for(const r of all){
    if(r.artist) artistCount.set(r.artist, (artistCount.get(r.artist)||0)+1);
    if(r.genre){
      const parts = r.genre.split(/[\/,;&]/).map(s=>s.trim()).filter(Boolean);
      for(const g of parts) genreCount.set(g, (genreCount.get(g)||0)+1);
    }
  }
  const topArtists = Array.from(artistCount.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const genres = Array.from(genreCount.entries()).sort((a,b)=>b[1]-a[1]).slice(0,12);
  return { total, withCover, missing: total-withCover, topArtists, genres };
}
function openStats(){
  const m = document.getElementById('statsModal');
  const s = buildStats(state.all);
  const sum = document.getElementById('statsSummary');
  sum.innerHTML = ''
    + cardStat(s.total, 'Total records')
    + cardStat(s.withCover, 'With cover art')
    + cardStat(s.missing, 'Missing cover art');
  const ta = document.getElementById('topArtists');
  const gg = document.getElementById('genres');
  ta.innerHTML = barsHtml(s.topArtists);
  gg.innerHTML = barsHtml(s.genres);
  m.classList.remove('hidden');
}
function cardStat(num, lbl){ return `<div class="stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`; }
function barsHtml(pairs){
  const max = pairs.length ? Math.max(...pairs.map(p=>p[1])) : 1;
  return pairs.map(([name,count])=>`
    <div class="row">
      <div class="bar-wrap" title="${name}">
        <div class="bar" style="width:${Math.max(8,(count/max)*100)}%"></div>
      </div>
      <div class="count">${count}</div>
    </div>
    <div class="label" style="font-size:12px;color:var(--muted);margin-top:-2px;margin-bottom:4px">${name}</div>
  `).join('');
}

// ---------- sheet fetch ----------
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

// ---------- refresh (single button = deep) ----------
async function refreshAllArt(){
  const btn = document.getElementById('refreshArt');
  const laneEl = document.getElementById('lane');
  try{
    if(btn){ btn.disabled = true; btn.textContent = 'Refreshing…'; }
    cache.keys().filter(k=>k.startsWith('art:')).forEach(k=>localStorage.removeItem(k));
    state.filtered.forEach(r=>{ if(!r._raw || !r._raw.cover_url) r.cover=''; });
    render();
    const covers = Array.from(laneEl.querySelectorAll('.cover')).map(el=>({el, rec: el.closest('.tile').querySelector('.card').__rec}));
    let done = 0, total = covers.length;
    await Promise.all(covers.map(({el, rec})=> new Promise(resolve=>{
      loaderQ.push(async ()=>{
        await attemptArtworkWithPreload(rec, el, true);
        done++; if(btn){ btn.textContent = 'Refreshing… ' + `${done}/${total}`; }
        resolve();
      });
    })));
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Refresh Art'; }
  }
}

// ---------- PWA: SW + install ----------
function registerSW(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.v28.js').catch(()=>{});
  }
}
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('installBtn');
  if(btn){ btn.hidden = false; btn.textContent='Install App'; btn.onclick = handleInstall; }
});
function handleInstall(){
  if(!deferredPrompt){ openInstallHelp(); return; }
  deferredPrompt.prompt();
  deferredPrompt.userChoice.finally(()=>{
    const btn = document.getElementById('installBtn');
    if(btn) btn.hidden = true;
    deferredPrompt = null;
  });
}
function isiOSSafari(){
  const ua = window.navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const safari = /^((?!chrome|android).)*safari/i.test(ua);
  return iOS && safari;
}
function inStandalone(){
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (window.navigator.standalone === true);
}
function setupIOSInstallHint(){
  const hint = document.getElementById('installHint');
  const how = document.getElementById('howInstall');
  const btn = document.getElementById('installBtn');
  if(isiOSSafari() && !inStandalone()){
    if(hint) hint.hidden = false;
    if(btn){ btn.hidden = false; btn.textContent='Install App'; btn.onclick = openInstallHelp; }
    if(how){ how.addEventListener('click', openInstallHelp); }
  }
}
function openInstallHelp(){
  const m = document.getElementById('installModal');
  const steps = document.getElementById('installSteps');
  if(isiOSSafari()){
    steps.innerHTML = `<ol>
      <li>Tap the <b>Share</b> button in Safari (square with arrow).</li>
      <li>Scroll and tap <b>Add to Home Screen</b>.</li>
      <li>Tap <b>Add</b> to install.</li>
    </ol>`;
  } else {
    steps.innerHTML = `<ol>
      <li>Open the browser menu (⋮ or ⋯).</li>
      <li>Choose <b>Install app</b> or <b>Add to Home Screen</b>.</li>
    </ol>`;
  }
  m.classList.remove('hidden');
}

// ---------- init & events ----------
function build(){ state.filtered = normalizeData(state.all); sortBy('title'); buildFuse(state.filtered); render(); }
(function(){
  function onReady(fn){ if(document.readyState!=='loading'){fn();} else {document.addEventListener('DOMContentLoaded', fn);} }
  onReady(async function(){
    const searchEl=document.getElementById('search'); if(searchEl){ searchEl.addEventListener('input', e=>{ applySearch(e.target.value||''); render(); }); }
    const sortEl=document.getElementById('sort'); if(sortEl){ sortEl.addEventListener('change', e=>{ sortBy(e.target.value); render(); }); }
    const shuffleEl=document.getElementById('shuffle'); if(shuffleEl){ shuffleEl.addEventListener('click', ()=>{ state.filtered.sort(()=>Math.random()-.5); render(); }); }
    const refreshBtn=document.getElementById('refreshArt'); if(refreshBtn){ refreshBtn.addEventListener('click', refreshAllArt); }
    const statsBtn=document.getElementById('statsBtn'); if(statsBtn){ statsBtn.addEventListener('click', openStats); }
    const closeStats=document.getElementById('closeStats'); if(closeStats){ closeStats.addEventListener('click', ()=>document.getElementById('statsModal').classList.add('hidden')); }
    const closeInstall=document.getElementById('closeInstall'); if(closeInstall){ closeInstall.addEventListener('click', ()=>document.getElementById('installModal').classList.add('hidden')); }

    // View Toggle (label swap: Scroll ↔ Grid)
    const viewToggle=document.getElementById('viewToggle');
    const updateViewLabel = ()=>{ viewToggle.textContent = 'View: ' + (state.view==='flip' ? 'Scroll' : 'Grid'); };
    if(viewToggle){
      viewToggle.addEventListener('click', ()=>{
        state.view = state.view==='flip' ? 'grid' : 'flip';
        updateViewLabel();
        render();
      });
      updateViewLabel();
    }

    // Nav buttons and wheel only matter in flip view
    const bindNav=(btn,dir)=>{
      if(!btn) return;
      ['click','pointerdown','touchstart','mousedown'].forEach(type=>{
        btn.addEventListener(type,(e)=>{ if(state.view!=='flip') return; e.stopPropagation(); e.preventDefault(); page(dir); }, {passive:false});
      });
    };
    bindNav(document.getElementById('prevBtn'), -1);
    bindNav(document.getElementById('nextBtn'),  1);

    const l=document.getElementById('lane');
    l.addEventListener('wheel', (e)=>{
      if(state.view==='flip' && Math.abs(e.deltaY) > Math.abs(e.deltaX)){ l.scrollLeft += e.deltaY; if(e.cancelable) e.preventDefault(); }
    }, {passive:false});

    registerSW();
    setupIOSInstallHint();
    build();
    await fetchSheetCsv();
  });
})();