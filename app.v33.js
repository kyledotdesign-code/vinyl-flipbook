// VERSION: v33
'use strict';

const SMART_FALLBACK = true;
const USE_PROXY_ON_FAIL = true;

const state = { all: window.INIT_DATA || [], filtered: [], view: 'flip' };

// Pre-baked cover index loaded from /public/art-index.json
let ART_MAP = null;
async function loadArtIndex(){
  if (ART_MAP) return ART_MAP;
  try {
    const res = await fetch('art-index.json', { cache: 'no-store' });
    if (res.ok){
      ART_MAP = await res.json();
    } else {
      ART_MAP = {};
    }
  } catch {
    ART_MAP = {};
  }
  return ART_MAP;
}

let _softTimer=null;

function applyCachedGenre(rec){
  const gKey = 'genre:' + (rec.artist||'').toLowerCase() + '|' + (rec.title||'').toLowerCase();
  const cached = cache.get(gKey);
  if((!rec.genre || !rec.genre.trim()) && cached){ rec.genre = cached; }
  return rec;
}

function scheduleSoftRender(){ if(_softTimer) return; _softTimer=setTimeout(()=>{ _softTimer=null; try{ render(); }catch(e){} }, 500); }
let fuse = null;
let currentQuery = "";

// utils
const NORMALIZE = s => (s||'').toString().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const TIDY = s => (s||'').toString().replace(/^[“”"']+|[“”"']+$/g, '').replace(/\s+/g, ' ').trim();
const NOR_FLAT = s => (s||'').toString().toLowerCase().replace(/(volume|vol|vol\.)/g,'vol').replace(/[^a-z0-9]/g,'');
function buildKeyIndex(rec){ const idx={}; Object.keys(rec||{}).forEach(k=>idx[NORMALIZE(k)]=k); return idx; }
function pick(rec, idx, names){ for (let i=0;i<names.length;i++){ const key = idx[NORMALIZE(names[i])]; if (key!=null && rec[key]!=null && String(rec[key]).trim()!=="") return TIDY(String(rec[key])); } return ""; }
function fourthColumnFallback(rec){ const keys=Object.keys(rec||{}); if(keys.length>=4){ const k=keys[3]; const v=rec[k]; if(typeof v==='string' && v.trim().startsWith('http')) return v.trim(); } return ""; }
function mapRecord(r, i){
  const idx = buildKeyIndex(r);
  let album = pick(r,idx,['album']); if(!album) album = pick(r,idx,['title','record','release']);
  const artist= pick(r,idx,['artist','band','composer','performer','musician']);
  const genre = pick(r,idx,['genre','category','style']);
  const label = pick(r,idx,['label','publisher']);
  const format= pick(r,idx,['format','media','pressing']);
  const color = pick(r,idx,['color','variant']);
  const notes = [ pick(r,idx,['notes','special notes','comments','comment']),
                  pick(r,idx,['soundtrack/compilations','compilations','soundtrack'])].filter(Boolean).join(' • ');
  let cover = pick(r,idx,['cover url','cover_url','cover','image','art','artwork']); if(!cover) cover = fourthColumnFallback(r);
  const url   = pick(r,idx,['url','discogs_url','link']);
  const fallback = album || `Untitled #${i+1}`;
  return { title: fallback, artist: artist||'Unknown Artist', genre, label, format, color, notes, cover, url, _raw:r };
}
function normalizeData(arr){ return (arr||[]).map(mapRecord).map(applyCachedGenre); }

// search
function buildFuse(items){ if(!window.Fuse){ fuse = null; return; } fuse = new Fuse(items, {keys:[{name:'title',weight:0.5},{name:'artist',weight:0.48},{name:'genre',weight:0.02}], includeScore:true, threshold:0.35, ignoreLocation:true, minMatchCharLength:2}); }
function hi(text,q){ if(!q||!text) return text; try{ const esc=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').split(/\s+/).filter(Boolean).join('|'); if(!esc) return text; return text.replace(new RegExp('('+esc+')','ig'),'<mark class="search-hit">$1</mark>'); }catch{ return text; } }

// artwork loader helpers
const cache = { get:(k)=>{ try{return JSON.parse(localStorage.getItem(k)||'null');}catch{return null;} }, set:(k,v)=>{ try{localStorage.setItem(k, JSON.stringify(v));}catch{} }, keys:()=>Object.keys(localStorage||{}) };
function cacheKey(rec){ return 'art:' + (rec.artist||'').toLowerCase() + '|' + (rec.title||'').toLowerCase(); }
function hasMinInfo(rec){ const a=(rec.artist||'').trim().toLowerCase(), t=(rec.title||'').trim().toLowerCase(); return !!(a && t && a!=='unknown artist' && !/^untitled/.test(t)); }
function withTimeout(promise, ms=8000){ const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),ms); return Promise.race([ promise(ctl), new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms+50)) ]).finally(()=>clearTimeout(t)); }
function fetchJson(url,ctl){ return fetch(url,{mode:'cors', cache:'no-store', signal:ctl.signal}).then(r=>r.ok?r.json():null); }
function loadImage(url){ return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(url); img.onerror=reject; img.referrerPolicy='no-referrer'; img.src=url; }); }
function sanitizeCoverURL(u){ if(!u) return ""; let url=u.trim(); let m=url.match(/drive\.google\.com\/file\/d\/([^\/]+)\//); if(m){ return `https://drive.google.com/uc?export=download&id=${m[1]}`; } m=url.match(/drive\.google\.com\/open\?id=([^&]+)/); if(m){ return `https://drive.google.com/uc?export=download&id=${m[1]}`; } if(/dropbox\.com/.test(url)){ url=url.replace('www.dropbox.com','dl.dropboxusercontent.com'); url=url.replace(/(\?|&)dl=0/,''); return url; } m=url.match(/imgur\.com\/(a|gallery)\/([A-Za-z0-9]+)/); if(m){ return `https://i.imgur.com/${m[2]}.jpg`; } m=url.match(/imgur\.com\/([A-Za-z0-9]+)$/); if(m && !/i\.imgur\.com/.test(url)){ return `https://i.imgur.com/${m[1]}.jpg`; } return url; }
function proxyURL(u){ try{ const clean=u.replace(/^https?:\/\//,''); return 'https://images.weserv.nl/?url='+encodeURIComponent(clean)+'&w=1200&h=1200&fit=cover&we'; }catch{ return u; } }
function stripCommonEdits(s){ return (s||'').toLowerCase().replace(/deluxe|expanded|edition|remaster|remastered|explicit|clean|version|anniversary|bonus|mono|stereo|original/g,''); }
function titleKey(s){ s=stripCommonEdits(s); s=s.replace(/(volume|vol|vol\.)\s*/g,''); s=s.replace(/\([^)]*\)/g,''); s=s.replace(/[^a-z0-9]/g,''); return s; }
function strictOk(rec,cand){ const ar1=NOR_FLAT(rec.artist), ar2=NOR_FLAT(cand.artistName); const t1=titleKey(rec.title), t2=titleKey(cand.collectionName); if(!(ar1 && ar1===ar2)) return false; if(t1 && t1===t2) return true; if(t1 && (t2.startsWith(t1)||t2.endsWith(t1)||t2.includes(t1))) return true; return false; }
async function itunesSearch(term, attribute){ const q=encodeURIComponent(term); const attr=attribute?`&attribute=${attribute}`:''; const url=`https://itunes.apple.com/search?media=music&entity=album&limit=50&term=${q}${attr}`; return withTimeout((ctl)=>fetchJson(url,ctl),8000); }
function deezerJSONP(url,timeout=9000){ return new Promise((resolve,reject)=>{ const cb='__dz_cb_'+Math.random().toString(36).slice(2); const s=document.createElement('script'); const cleanup=()=>{ try{delete window[cb];}catch{}; if(s.parentNode) s.parentNode.removeChild(s); clearTimeout(tid); }; const tid=setTimeout(()=>{cleanup();reject(new Error('timeout'));},timeout); window[cb]=(data)=>{cleanup();resolve(data);}; s.src=url+(url.includes('?')?'&':'?')+'output=jsonp&callback='+cb; s.onerror=()=>{cleanup();reject(new Error('script error'));}; document.head.appendChild(s); }); }
async function fetchITunesStrict(rec){ const tries=[ await itunesSearch(`${rec.artist} ${rec.title}`,''), await itunesSearch(`${rec.artist}`,'artistTerm'), await itunesSearch(`${rec.title}`,'albumTerm') ]; for(const d of tries){ if(!d||!d.results||!d.results.length) continue; const exact=d.results.find(r=>strictOk(rec,r)&&r.artworkUrl100); if(exact){ return exact.artworkUrl100.replace('100x100bb','1200x1200bb'); } } return null; }

async function mbSearchReleaseGroup(rec){
  const artist = encodeURIComponent(rec.artist);
  const title  = encodeURIComponent(rec.title);
  const q = `artist:"${rec.artist}" AND release:"${rec.title}"`;
  const url = 'https://r.jina.ai/http://musicbrainz.org/ws/2/release-group/?query=' + encodeURIComponent(q) + '&fmt=json&limit=1';
  try{
    const res = await fetch(url, {cache:'no-store'});
    const txt = await res.text();
    const data = JSON.parse(txt);
    const rg = (data['release-groups']||[])[0];
    return rg && rg.id ? rg.id : null;
  }catch(e){ return null; }
}
async function fetchCoverArtArchive(rec){
  const mbid = await mbSearchReleaseGroup(rec);
  if(!mbid) return null;
  const trySizes = ['1200','1000','800','500','250'];
  for(const size of trySizes){
    const url = `https://coverartarchive.org/release-group/${mbid}/front-${size}`;
    try{ await loadImage(url); return url; }catch{}
  }
  // fallback generic front
  const url = `https://coverartarchive.org/release-group/${mbid}/front`;
  try{ await loadImage(url); return url; }catch{}
  return null;
}

async function fetchDeezerStrict(rec){ const q=encodeURIComponent(`artist:"${rec.artist}" album:"${rec.title}"`); const data=await deezerJSONP(`https://api.deezer.com/search/album?q=${q}`,9000); const list=(data&&data.data)||[]; const exact=list.find(a=>NOR_FLAT(a.artist&&a.artist.name)===NOR_FLAT(rec.artist) && titleKey(a.title)===titleKey(rec.title)); if(exact){ return exact.cover_xl || exact.cover_big || exact.cover_medium || null; } return null; }


async function attemptArtwork(rec, coverEl, force=false){
  const srcKey = 'art:'+ (rec.artist||'') +'|'+ (rec.title||'');
  const cached = !force && localStorage.getItem(srcKey);
  if (cached && cached !== 'null'){ coverEl.src = cached; return true; }

  const direct = sanitizeCoverURL(rec.cover||"");
  const proxy  = direct ? proxyURL(direct) : "";
  const map = await loadArtIndex();
  const key = (rec.artist||'') + '|||' + (rec.title||'');
  const baked = map[key]?.url || "";

  const tried = [direct, proxy, baked].filter(Boolean);
  for (const url of tried){
    try { await loadImage(url); coverEl.src = url; localStorage.setItem(srcKey, url); return true; } catch {}
  }
  localStorage.setItem(srcKey, 'null');
  return false;
}

async function maybeFetchGenre(rec){
  const gKey='genre:'+(rec.artist||'').toLowerCase()+'|'+(rec.title||'').toLowerCase();
  if(rec.genre && rec.genre.trim()) return;
  const cached=cache.get(gKey); if(cached){ rec.genre=cached; return; }
  try{ const data=await itunesSearch(`${rec.artist} ${rec.title}`,''); if(data&&data.results&&data.results.length){ let best=data.results.find(r=>strictOk(rec,r)); if(!best) best=data.results[0]; const g=best&&best.primaryGenreName; if(g){ rec.genre=g; cache.set(gKey,g); if(window.scheduleSoftRender) scheduleSoftRender(); } } }catch{}
}

// queue & lazy
const loaderQ={ q:[], active:0, max:4, push(task){this.q.push(task); this.pump();}, pump(){ while(this.active<this.max && this.q.length){ const t=this.q.shift(); this.active++; Promise.resolve().then(t).catch(()=>{}).finally(()=>{ this.active--; setTimeout(()=>this.pump(),60); }); } } };
function lazyScheduleCover(coverEl,rec){ const schedule=(force=false)=> loaderQ.push(()=>attemptArtwork(rec,coverEl,force)); if('IntersectionObserver' in window){ const io=new IntersectionObserver((entries)=>{ entries.forEach(ent=>{ if(ent.isIntersecting){ io.unobserve(ent.target); schedule(false); } }); },{ root:document.getElementById('lane'), rootMargin:'200px', threshold:0.1}); io.observe(coverEl); } else { schedule(false); } }

// layout/render
const lane = ()=>document.getElementById('lane');
function step(){ const firstTile=lane().querySelector('.tile'); if(!firstTile) return 0; const w=firstTile.getBoundingClientRect().width; const gap=getComputedStyle(lane()).display==='grid'?18:24; return Math.round(w+gap); }
function page(dir){ const l=lane(); if(!l) return; if(state.view==='flip'){ l.scrollBy({left: dir*(step()||Math.round(l.clientWidth*0.85)), behavior:'smooth'}); } else { window.scrollBy({top: dir*window.innerHeight*0.8, behavior:'smooth'}); } }

function genreChips(rec){ const g=splitGenres(rec.genre); if(!g.length) return null; const wrap=document.createElement('div'); wrap.className='genres'; g.slice(0,4).forEach(name=>{ const chip=document.createElement('span'); chip.className='genre-chip'; chip.textContent=name; wrap.appendChild(chip); }); return wrap; }
function placeholder(rec){ const base=(rec.artist && rec.artist!=='Unknown Artist'?rec.artist:rec.title)||'LP'; const letters=base.trim().split(/\s+/).slice(0,2).map(s=>s[0]?s[0].toUpperCase():'').join(''); const ph=document.createElement('div'); ph.className='placeholder'; const i=document.createElement('div'); i.className='initials'; i.textContent=letters||'LP'; ph.appendChild(i); return ph; }

function tile(rec, idx){
  const wrap=document.createElement('div'); wrap.className='tile'; wrap.dataset.key=cacheKey(rec);
  const card=document.createElement('div'); card.className='card'; card.__rec=rec;
  const inner=document.createElement('div'); inner.className='inner';
  const sleeve=document.createElement('div'); sleeve.className='sleeve';
  const back=document.createElement('div'); back.className='back';
  const cover=document.createElement('div'); cover.className='cover';
  if(rec.cover){ cover.style.backgroundImage="url('"+sanitizeCoverURL(rec.cover)+"')"; } else { cover.appendChild(placeholder(rec)); }
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
    card.addEventListener('pointerdown',(e)=>{ t0=Date.now(); drag=false; downX=e.clientX; downY=e.clientY; try{card.setPointerCapture(e.pointerId);}catch{} },{passive:true});
    card.addEventListener('pointermove',(e)=>{ if(Math.hypot(e.clientX-downX,e.clientY-downY)>8) drag=true; },{passive:true});
    card.addEventListener('pointerup',(e)=>{ try{card.releasePointerCapture(e.pointerId);}catch{} if(!drag && Date.now()-t0<700){ card.classList.toggle('flipped'); } },{passive:true});
  } else { card.addEventListener('click', ()=> card.classList.toggle('flipped')); }

  const caption=document.createElement('div'); caption.className='caption';
  const title=document.createElement('div'); title.className='title'; title.innerHTML=hi(rec.title,currentQuery);
  const artist=document.createElement('div'); artist.className='artist'; artist.innerHTML=hi(rec.artist,currentQuery);
  caption.appendChild(title); caption.appendChild(artist);

  wrap.appendChild(card); wrap.appendChild(caption);
  return wrap;
}

function render(){ const root=lane(); if(!root) return; root.innerHTML=''; document.body.classList.toggle('view-grid', state.view==='grid');
  if(!state.filtered.length){ const empty=document.createElement('div'); empty.className='empty'; empty.textContent='No records yet — open the Google Sheet to edit.'; root.appendChild(empty); return; }
  state.filtered.forEach((rec,i)=>{ root.appendChild(tile(rec,i)); });
  const covers=root.querySelectorAll('.cover'); covers.forEach(el=>{ const rec=el.closest('.tile').querySelector('.card').__rec; lazyScheduleCover(el,rec); });
}

// sort & search
function sortBy(mode){ if(mode==='random'){ state.filtered.sort(()=>Math.random()-.5); } else if(mode==='artist'){ state.filtered.sort((a,b)=>(a.artist||'').localeCompare(b.artist||'')); } else { state.filtered.sort((a,b)=>(a.title||'').localeCompare(b.title||'')); } }
function applySearch(q){ currentQuery=q||''; const parts=currentQuery.toLowerCase().split(/\s+/).filter(Boolean);
  if(parts.length>=2 && fuse){ const res=fuse.search(currentQuery); state.filtered=res.map(r=>r.item); }
  else { const all=normalizeData(state.all); state.filtered=all.filter(r=>{ const hay=[r.title,r.artist,r.genre,r.label,r.format,r.notes].join(' ').toLowerCase(); return parts.every(p=>hay.indexOf(p)!==-1); }); }
  sortBy(document.getElementById('sort')?.value || 'title');
}

// stats
function splitGenres(s){ return (s||'').split(/[\/,;&|•·]+|\s+\band\b\s+|\s*\+\s*/i).map(t=>t.trim()).filter(Boolean).map(x=>x.replace(/\b\w/g,m=>m.toUpperCase())); }
function buildStats(items){ const all=normalizeData(items).map(applyCachedGenre); const total=all.length; const gset=new Set(); const gcount=new Map();
  for(const r of all){ for(const g of splitGenres(r.genre)){ gset.add(g); const key=g.toLowerCase(); gcount.set(key,(gcount.get(key)||0)+1);} }
  const topGenres=Array.from(gcount.entries()).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>[k.replace(/\b\w/g,m=>m.toUpperCase()),v]);
  const artistCount=new Map(); for(const r of all){ if(r.artist) artistCount.set(r.artist,(artistCount.get(r.artist)||0)+1); }
  const topArtists=Array.from(artistCount.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10);
  return { total, totalGenres: gset.size, topGenres, topArtists };
}
function cardStat(num,lbl){ return `<div class="stat"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`; }
function barsHtml(pairs){ const max=pairs.length?Math.max(...pairs.map(p=>p[1])):1; return pairs.map(([name,count])=>`
  <div class="row"><div class="bar-wrap" title="${name}"><div class="bar" style="width:${Math.max(8,(count/max)*100)}%"></div></div><div class="count">${count}</div></div>
  <div class="label" style="font-size:12px;color:var(--muted);margin-top:-2px;margin-bottom:4px">${name}</div>`).join(''); }
function openStats(){ const m=document.getElementById('statsModal'); const s=buildStats(state.all);
  const sum=document.getElementById('statsSummary'); sum.innerHTML = cardStat(s.total,'Total records') + cardStat(s.totalGenres,'Total genres');
  document.getElementById('topGenres').innerHTML=barsHtml(s.topGenres); document.getElementById('topArtists').innerHTML=barsHtml(s.topArtists);
  m.classList.remove('hidden'); }

// sheet fetch
async function fetchSheetCsv(){ const url=(window.SHEET_CSV_URL||'').trim(); if(!url) return false;
  try{ const res=await fetch(url,{mode:'cors', cache:'no-store'}); if(!res.ok) throw new Error('HTTP '+res.status);
    const text=await res.text(); const parsed=Papa.parse(text,{header:true, skipEmptyLines:true});
    if(parsed && parsed.data && parsed.data.length){ state.all=parsed.data; build(); console.log(`Loaded ${parsed.data.length} rows from Google Sheets`); return true; }
  }catch(e){ console.warn('Sheet fetch failed:',e); }
  return false; }

async function refreshAllArt(){ const btn=document.getElementById('refreshArt'); const laneEl=document.getElementById('lane');
  try{ if(btn){ btn.disabled=true; btn.textContent='Refreshing…'; }
    cache.keys().filter(k=>k.startsWith('art:')).forEach(k=>localStorage.removeItem(k)); render();
    const covers=Array.from(laneEl.querySelectorAll('.cover')).map(el=>({el, rec: el.closest('.tile').querySelector('.card').__rec}));
    let done=0,total=covers.length;
    await Promise.all(covers.map(({el,rec})=> new Promise(resolve=>{ loaderQ.push(async()=>{ await attemptArtwork(rec,el,true); done++; if(btn){ btn.textContent='Refreshing… '+`${done}/${total}`; } resolve(); }); })));
  } finally { if(btn){ btn.disabled=false; btn.textContent='Refresh Art'; } } }

// SW
function registerSW(){ if('serviceWorker' in navigator){ navigator.serviceWorker.register('./service-worker.v33.js').catch(()=>{}); } }

// init
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
    const viewToggle=document.getElementById('viewToggle'); const updateViewLabel=()=>{ viewToggle.textContent='View: '+(state.view==='flip'?'Scroll':'Grid'); };
    if(viewToggle){ viewToggle.addEventListener('click', ()=>{ state.view=state.view==='flip'?'grid':'flip'; updateViewLabel(); render(); }); updateViewLabel(); }
    const bindNav=(btn,dir)=>{ if(!btn) return; ['click','pointerdown','touchstart','mousedown'].forEach(type=>{ btn.addEventListener(type,(e)=>{ if(state.view!=='flip') return; e.stopPropagation(); e.preventDefault(); page(dir); }, {passive:false}); }); };
    bindNav(document.getElementById('prevBtn'),-1); bindNav(document.getElementById('nextBtn'),1);
    const l=document.getElementById('lane'); l.addEventListener('wheel', (e)=>{ if(state.view==='flip' && Math.abs(e.deltaY)>Math.abs(e.deltaX)){ l.scrollLeft += e.deltaY; if(e.cancelable) e.preventDefault(); } }, {passive:false});
    registerSW(); build(); await fetchSheetCsv(); try{ await enrichGenresAll(); }catch(e){}
  });
})();

// batch-enrich genres for all records (limit concurrency)
async function enrichGenresAll(){
  const lacking = normalizeData(state.all).filter(r => !r.genre || !r.genre.trim());
  let idx = 0, active = 0, max = 4;
  return new Promise(resolve => {
    const pump = () => {
      if (idx >= lacking.length && active === 0) return resolve();
      while (active < max && idx < lacking.length){
        const rec = lacking[idx++];
        active++;
        Promise.resolve(maybeFetchGenre(rec)).catch(()=>{}).finally(()=>{
          active--; pump();
        });
      }
    };
    pump();
  });
}

// Remote lookups disabled in baked mode.
async function fetchITunesStrict(){return null}
async function fetchDeezerStrict(){return null}
