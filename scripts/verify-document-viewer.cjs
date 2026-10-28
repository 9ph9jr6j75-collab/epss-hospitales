#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {File}=require('node:buffer');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'dist/document-viewer.js'),'utf8');
const {pdfRequest,safeFilename,canvasPlan,sharePreparedFile,commitPageInput}=require(path.join(root,'dist/document-viewer.js'));
const base='https://example.test/epss-hospitales/';
assert.deepEqual(pdfRequest('assets/test.pdf#page=205',base),{url:base+'assets/test.pdf',page:205});
assert.equal(pdfRequest('https://other.test/assets/test.pdf',base),null);
assert.equal(pdfRequest('javascript:alert(1)',base),null);
assert.equal(pdfRequest('../assets/test.pdf',base),null);
assert.equal(pdfRequest('assets/file.html',base),null);
assert.equal(pdfRequest('assets/test.pdf#page=-3',base).page,1);
assert.equal(safeFilename('01-02 Atención / posparto?'),'01-02 Atención posparto.pdf');
for(const width of [320,390,768,1440])for(const zoom of [.75,1,2,3]){
  const p=canvasPlan(612,792,width-32,zoom,3);
  assert.ok(p.width*p.height<=4000000,'El lienzo debe limitar la memoria en pantallas densas');
  assert.ok(p.width<=8192&&p.height<=8192);
  assert.ok(Math.abs(p.cssWidth/p.cssHeight-612/792)<1e-9,'La página debe conservar sus proporciones');
}
const catalog=JSON.parse(fs.readFileSync(path.join(root,'dist/assets/catalogo.json'),'utf8'));
for(const item of catalog.items){const page=item.sourcePage||1,request=pdfRequest(item.sourceFile+'#page='+page,base);assert.ok(request,item.id+': el PDF debe pasar por el visor');assert.equal(request.page,page,item.id+': la ficha debe abrir su página de origen');}
for(const doc of catalog.documents)assert.ok(pdfRequest(doc.file,base),doc.id+': el documento debe pasar por el visor');
const assetManifest=JSON.parse(fs.readFileSync(path.join(root,'dist/assets/pdfjs/asset-manifest.json'),'utf8'));
assert.equal(assetManifest.version,'5.6.205');
assert.ok(assetManifest.files.length<100,'La distribución debe poder mantenerse como un grupo de archivos');
for(const name of assetManifest.files)assert.ok(fs.statSync(path.join(root,'dist',name)).isFile(),name);
for(const name of ['pdf.mjs','pdf.worker.mjs'])assert.match(fs.readFileSync(path.join(root,'dist/assets/pdfjs',name),'utf8'),/5\.6\.205/,'Núcleo y worker deben usar la misma versión');

// Minimal DOM implementation for lifecycle tests. It executes the real viewer
// handlers; PDF rendering itself is checked in the browser.
function testEnvironment({ios=true,share=true,fetchImpl}={}){
  const documentListeners={},windowListeners={},events=[],opened=[],revoked=[];
  let document;
  class Element{
    constructor(tag='div',attributes={}){this.tagName=tag.toUpperCase();this.attributes={...attributes};this.children=[];this.hidden='hidden'in attributes;this.disabled='disabled'in attributes;this.textContent='';this.value=attributes.value||'';this.dataset={};this.handlers={};this.scrollTop=127;this.scrollLeft=0;this.clientWidth=390;this.width=100;this.height=100;this.style={setProperty(){},removeProperty(){}};for(const[k,v]of Object.entries(attributes))if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;
      const classes=new Set((attributes.class||'').split(/\s+/));this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v),toggle(v,force){if(force===true)classes.add(v);else if(force===false)classes.delete(v);else if(classes.has(v))classes.delete(v);else classes.add(v);}};
    }
    set innerHTML(value){this.children=[];for(const m of value.matchAll(/<(\w+)\b([^>]*)>/g)){const attrs={};for(const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]||'';const child=new Element(m[1],attrs);child.parentElement=this;this.children.push(child);}}
    get isConnected(){return this===document?.body||!!this.parentElement?.isConnected;}
    get inert(){return this.hasAttribute('inert');}set inert(value){if(value)this.setAttribute('inert','');else this.removeAttribute('inert');}
    set id(value){this.attributes.id=value;}get id(){return this.attributes.id||'';}
    setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}hasAttribute(k){return k in this.attributes;}removeAttribute(k){delete this.attributes[k];}
    append(el){el.parentElement=this;this.children.push(el);}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(el=>el!==this);this.parentElement=null;}
    matches(selector){return selector.split(',').some(s=>{s=s.trim();if(s.startsWith('#'))return this.id===s.slice(1);if(s.startsWith('.'))return this.classList.contains(s.slice(1));const m=s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);if(m)return m[2]===undefined?this.hasAttribute(m[1]):this.getAttribute(m[1])===m[2];return this.tagName.toLowerCase()===s;});}
    closest(selector){let el=this;while(el){if(el.matches(selector))return el;el=el.parentElement;}return null;}
    contains(el){return el===this||this.children.some(child=>child.contains(el));}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
    addEventListener(name,handler){(this.handlers[name]||=[]).push(handler);}
    getClientRects(){let el=this;while(el){if(el.hidden)return[];el=el.parentElement;}return[{width:100,height:44}];}
    focus(){document.activeElement=this;}blur(){for(const handler of this.handlers.change||[])handler({target:this});document.activeElement=document.body;}
    getContext(){return{};}click(){const event={target:this,preventDefault(){},stopPropagation(){}};for(const handler of this.parentElement?.handlers.click||[])handler(event);}
  }
  document={baseURI:base,body:new Element('body'),activeElement:null,createElement:tag=>new Element(tag),addEventListener(name,handler){(documentListeners[name]||=[]).push(handler);},dispatchEvent:event=>events.push(event)};
  const background=new Element('section',{'class':'detail-panel','aria-hidden':'false'});document.body.append(background);const opener=new Element('button');background.append(opener);document.activeElement=opener;
  const location={href:base+'#ficha=10-01-1.1'};
  const history={state:null,backs:0,pushState(state,_,url){this.state=state;assert.equal(url,location.href,'El visor no debe cambiar la URL ni activar el enrutador de fichas');},back(){this.backs++;this.state=null;for(const handler of windowListeners.popstate||[])handler({});}};
  class TestURL extends URL{static createObjectURL(){return'blob:https://example.test/prepared-pdf';}static revokeObjectURL(url){revoked.push(url);}}
  const navigator={userAgent:ios?'iPhone Safari':'Desktop Chrome',platform:ios?'iPhone':'Linux',maxTouchPoints:ios?5:0,canShare:()=>share,share:data=>{events.push({type:'native-share',data});return Promise.resolve();}};
  const window={document,devicePixelRatio:3,open:(...args)=>opened.push(args),addEventListener(name,handler){(windowListeners[name]||=[]).push(handler);}};
  const context={window,document,navigator,history,location,URL:TestURL,URLSearchParams,AbortController,File,Uint8Array,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},getComputedStyle:()=>({getPropertyValue:()=>''}),fetch:fetchImpl || (()=>Promise.reject(Error('Network unavailable'))),console,setTimeout,clearTimeout};
  vm.runInNewContext(source,context,{filename:'document-viewer.js'});
  const shell=()=>document.body.children.find(el=>el.id==='document-viewer');
  return{api:window.EPSSDocumentViewer,document,navigator,history,background,opener,shell,events,opened,revoked,documentListeners};
}
async function main(){
  let calls=0;
  const file=new File(['original'],'original.pdf',{type:'application/pdf'}),nav={canShare:()=>true,share(data){calls++;assert.equal(data.files[0],file);return Promise.resolve();}};
  const sharing=sharePreparedFile(file,nav,'Original');assert.equal(calls,1,'Compartir debe invocarse en el mismo gesto, sin descargar antes');await sharing;
  await assert.rejects(sharePreparedFile(file,{canShare:()=>false,share:()=>Promise.resolve()},''));
  await assert.rejects(sharePreparedFile(file,{canShare:()=>true,share:()=>{throw Error('Denied');}},''),/Denied/);
  const pageSession={pdf:{numPages:6},page:1},pageEntry={value:'2',blur(){}};let renderedPage=1,renderCount=0;
  const renderEntry=session=>{renderedPage=session.page;renderCount++;};
  assert.equal(commitPageInput(pageSession,pageEntry,renderEntry),true);assert.equal(renderedPage,2,'Confirmar la página debe solicitar su renderizado sin depender de blur ni de change');pageEntry.blur();assert.equal(renderedPage,2);
  assert.equal(commitPageInput(pageSession,pageEntry,renderEntry),false);assert.equal(renderCount,1,'El change posterior a Enter no debe volver a renderizar la misma página');
  pageEntry.value='99';commitPageInput(pageSession,pageEntry,renderEntry);assert.equal(renderedPage,6);assert.equal(pageEntry.value,6,'El número debe limitarse al total de páginas');
  pageEntry.value='-3';commitPageInput(pageSession,pageEntry,renderEntry);assert.equal(renderedPage,1);
  const failed=testEnvironment();await failed.api.open('assets/source.pdf#page=205',{title:'Fuente original',opener:failed.opener,indicator:'10-01-1.1',printMode:true});
  assert.equal(failed.api.isOpen(),true);assert.equal(failed.shell().hidden,false);assert.match(failed.shell().querySelector('[data-doc-status]').textContent,/No se pudo cargar/);
  assert.equal(failed.background.inert,true);assert.equal(failed.shell().querySelector('[data-doc-action="close"]').disabled,false,'Volver siempre debe estar disponible, incluso si falla la carga');
  assert.deepEqual(JSON.parse(JSON.stringify(failed.events[0].detail)),{indicator:'10-01-1.1',printMode:true});
  failed.shell().querySelector('[data-doc-action="close"]').click();assert.equal(failed.api.isOpen(),false);assert.equal(failed.shell().hidden,true);assert.equal(failed.background.inert,false);assert.equal(failed.background.getAttribute('aria-hidden'),'false');assert.equal(failed.document.activeElement,failed.opener);assert.equal(failed.background.scrollTop,127);assert.equal(failed.history.backs,1);
  let resolveFetch,signal;const pending=testEnvironment({fetchImpl:(_,options)=>{signal=options.signal;return new Promise(resolve=>{resolveFetch=resolve;});}});const opening=pending.api.open('assets/source.pdf');assert.equal(pending.api.isOpen(),true);pending.api.close();assert.equal(signal.aborted,true);resolveFetch({ok:false});await opening;assert.equal(pending.api.isOpen(),false,'Una respuesta tardía no debe reabrir el visor');
  let fetches=0;const ios=testEnvironment({fetchImpl:async()=>{fetches++;return{ok:true,arrayBuffer:async()=>new TextEncoder().encode('%PDF-original').buffer};}});
  await ios.api.open('assets/source.pdf',{title:'Original',opener:ios.opener});
  const click=name=>ios.shell().querySelector(`[data-doc-action="${name}"]`).click();
  click('share');await Promise.resolve();assert.equal(fetches,1,'Compartir no debe esperar otra descarga');assert.ok(ios.events.some(event=>event.type==='native-share'));
  ios.navigator.share=()=>Promise.reject(Error('Blocked'));click('share');await Promise.resolve();assert.equal(ios.shell().querySelector('[data-doc-action="copy"]').hidden,false,'Un bloqueo al compartir debe ofrecer una salida visible');click('copy');assert.match(ios.shell().querySelector('[data-doc-status]').textContent,/https:\/\/example\.test\/epss-hospitales\//,'Si no hay portapapeles, debe mostrar el enlace que el usuario puede abrir');
  const beforeCancel=ios.shell().querySelector('[data-doc-status]').textContent;ios.navigator.share=()=>Promise.reject(Object.assign(Error('Cancel'),{name:'AbortError'}));click('share');await Promise.resolve();assert.equal(ios.shell().querySelector('[data-doc-status]').textContent,beforeCancel,'Cancelar el menú de iOS no debe mostrar un error');
  let blurred=false;const pageInput=ios.shell().querySelector('[data-doc-page]');pageInput.blur=()=>{blurred=true;};ios.documentListeners.keydown[0]({key:'Enter',target:pageInput,preventDefault(){},stopImmediatePropagation(){}});assert.equal(blurred,true,'Enter en el número de página debe confirmar el cambio antes de bloquear los atajos inferiores');
  click('print');click('download');assert.equal(ios.opened.length,0,'En iOS nunca se debe navegar al PDF ni abrirlo fuera del visor desde estas acciones');
  ios.history.back();assert.equal(ios.api.isOpen(),false,'Volver en el historial debe cerrar el PDF');assert.equal(ios.shell().querySelector('[data-doc-canvas]').width,0,'Cerrar debe liberar el lienzo');
  const desktop=testEnvironment({ios:false,fetchImpl:async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode('%PDF-original').buffer})});await desktop.api.open('assets/source.pdf');desktop.shell().querySelector('[data-doc-action="print"]').click();assert.equal(desktop.opened[0][0],base+'assets/source.pdf','La pestaña de impresión no debe depender de un Blob que se revoca al cerrar');desktop.api.close();
  const swSource=fs.readFileSync(path.join(root,'dist/sw.js'),'utf8'),swHandlers={},matches=[],added=[],messages=[];
  let precache=[],networkCalls=[],deleted=[];
  const cache={addAll:async files=>{precache=files.map(file=>typeof file==='string'?file:new URL(file.url).pathname.split('/').pop()+new URL(file.url).search);assert.ok(files.every(file=>file.cache==='reload'),'La instalación debe evitar la caché HTTP anterior');},add:async file=>{added.push(file);},put:async()=>{},match:async name=>name==='assets/pdfjs/asset-manifest.json'?{ok:true,json:async()=>assetManifest}:undefined};
  const self={location:{origin:'https://example.test',href:base+'sw.js'},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,handler)=>{swHandlers[name]=handler;}};
  const caches={open:async()=>cache,keys:async()=>['epss-hospitales-dripssha-old','epss-dripssha-first-level-keep'],delete:async key=>{deleted.push(key);return true;},match:async(request,options)=>{matches.push({request,options});return options?.ignoreSearch&&new URL(request.url).pathname.includes('/assets/pdfjs/')?{cached:'pdfjs'}:undefined;}};
  vm.runInNewContext(swSource,{self,caches,URL,Request,Promise,Set,Response:{error:()=>({type:'error'})},fetch:async(request,options)=>{networkCalls.push({request,options});throw Error('Offline');}});
  let task;swHandlers.install({waitUntil:promise=>{task=promise;}});await task;
  swHandlers.activate({waitUntil:promise=>{task=promise;}});await task;assert.deepEqual(deleted,['epss-hospitales-dripssha-old'],'La actualización solo debe borrar cachés hospitalarias anteriores');
  assert.ok(precache.includes('document-viewer.js')&&precache.includes('document-viewer.css'));
  assert.ok(precache.includes('catalogo.json')&&precache.includes('app-v2.js?v=20261028-h3')&&precache.includes('styles.css?v=20261028-h3'),'Los recursos versionados deben estar disponibles sin conexión');
  assert.ok(!precache.some(file=>/^mr\.json(?:\?|$)/.test(file)),'La app hospitalaria no debe cargar la MR del primer nivel');
  assert.ok(!precache.some(file=>/\.mjs$/.test(file)),'La biblioteca grande no debe descargarse al iniciar la app');
  for(const name of ['pdf.mjs','pdf.worker.mjs']){
    let response;swHandlers.fetch({request:{url:base+'assets/pdfjs/'+name+'?v=5.6.205&retry=1',method:'GET',mode:'cors'},respondWith:promise=>{response=promise;}});
    assert.equal((await response).cached,'pdfjs','El visor sin conexión debe encontrar el archivo guardado sin consulta de versión');
    assert.equal(matches.at(-1).options.ignoreSearch,true);
    assert.equal(networkCalls.at(-1).options.cache,'no-cache','La consulta en línea debe revalidar los archivos de la app');
  }
  let ordinary;swHandlers.fetch({request:{url:base+'assets/config.json?v=unexpected',method:'GET',mode:'cors'},respondWith:promise=>{ordinary=promise;}});assert.equal((await ordinary).type,'error');assert.equal(matches.at(-1).options.ignoreSearch,false,'La excepción no debe mezclar consultas de otros recursos');
  swHandlers.message({data:{type:'CACHE_DOCUMENTS',files:catalog.documents.map(doc=>doc.file)},ports:[{postMessage:message=>messages.push(message)}],waitUntil:promise=>{task=promise;}});await task;
  assert.deepEqual(added.slice(0,assetManifest.files.length),assetManifest.files,'Guardar sin conexión debe preparar el visor antes de los PDF');
  assert.equal(messages[0].stage,'viewer');assert.equal(messages.at(-1).ok,true);assert.ok(catalog.documents.length>0,'El catálogo debe tener documentos');const documentCount=new Set(catalog.documents.map(doc=>doc.file)).size;assert.equal(messages.at(-1).count,documentCount);assert.equal(messages.filter(message=>message.progress).length,documentCount,'El progreso cuenta documentos, sin sumar las bibliotecas');
  console.log('Visor PDF verificado: rutas internas, memoria acotada, cierre con error/carga pendiente, foco e historial conservados y compartir sin navegación cruda en iOS.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
