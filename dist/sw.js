'use strict';
const CACHE='epss-hospitales-dripssha-20261028-v3';
const VIEWER_MANIFEST='assets/pdfjs/asset-manifest.json';
const CORE=['./','index.html','styles.css','full-reader.js','document-viewer.js','document-viewer.css','app-v2.js','manifest.webmanifest','assets/icon.svg','assets/icon-180.png','assets/icon-192.png','assets/icon-512.png','assets/social-preview.png','assets/catalogo.json','assets/config.json','styles.css?v=20261028-h3','app-v2.js?v=20261028-h3',VIEWER_MANIFEST];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE.map(file=>new Request(new URL(file,self.location.href),{cache:'reload'})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('epss-hospitales-dripssha-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname.endsWith('.pdf')){event.respondWith(caches.match(event.request,{ignoreSearch:true}).then(cached=>cached||fetch(event.request)));return;}
 const viewerAsset=/\/assets\/pdfjs\/[^/]+$/.test(url.pathname);
 event.respondWith(fetch(event.request,{cache:'no-cache'}).then(response=>{if(response.ok&&response.type==='basic'){const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}return response;}).catch(()=>caches.match(event.request,{ignoreSearch:viewerAsset}).then(cached=>cached||(event.request.mode==='navigate'?caches.match('index.html'):Response.error()))));
});
self.addEventListener('message',event=>{
 if(event.data?.type!=='CACHE_DOCUMENTS')return;
 event.waitUntil((async()=>{
  const port=event.ports[0],cache=await caches.open(CACHE);
  const files=[...new Set(event.data.files||[])].filter(file=>/^assets\/[a-zA-Z0-9/_-]+\.pdf$/.test(file));
  try{
   port?.postMessage({stage:'viewer'});
   const manifestResponse=await cache.match(VIEWER_MANIFEST)||await fetch(VIEWER_MANIFEST);
   if(!manifestResponse.ok)throw Error('Falta el visor PDF.');
   const manifest=await manifestResponse.json();
   const viewerFiles=[...new Set(manifest.files||[])].filter(file=>/^assets\/pdfjs\/[a-zA-Z0-9_.-]+$/.test(file));
   if(!viewerFiles.includes('assets/pdfjs/pdf.mjs')||!viewerFiles.includes('assets/pdfjs/pdf.worker.mjs'))throw Error('Visor PDF incompleto.');
   for(const file of viewerFiles)await cache.add(file);
   let count=0;for(const file of files){await cache.add(file);count++;port?.postMessage({progress:count,total:files.length});}port?.postMessage({ok:true,count});
  }
  catch{port?.postMessage({ok:false,error:'No se guardaron todos los documentos. Compruebe la conexión y el espacio del dispositivo.'});}
 })());
});
