// service-worker v33 — cache core & CSV; stale-while-revalidate
const CACHE='vinyl-v33';
const CORE=['./','./index.html','./style.v33.css','./app.v33.js','./manifest.v33.json','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  const isCSV = url.href.includes('docs.google.com/spreadsheets') && url.search.includes('output=csv');
  if(CORE.some(p=>url.pathname.endsWith(p.replace('./',''))) || isCSV){
    e.respondWith(caches.open(CACHE).then(cache=>fetch(e.request).then(res=>{cache.put(e.request,res.clone());return res;}).catch(()=>cache.match(e.request))));
    return;
  }
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});