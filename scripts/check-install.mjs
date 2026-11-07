#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped listeners without starting the catalog or a real install.
const source=fs.readFileSync(new URL('../dist/app-v2.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
assert.match(source,/\ninit\(\);\s*$/);
assert.match(html,/id="native-install" disabled/);
assert.match(html,/id="install-status" role="status" aria-live="polite"/);
const appSource=source.replace(/\ninit\(\);\s*$/,'');

function app(){
 const elements=new Map(),windowListeners=new Map(),documentListeners=new Map(),writes=[];
 const listen=(listeners,type,handler)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler);};
 let document;
 function element(key){
  if(!elements.has(key)){
   const classes=new Set(),attributes=new Map(),listeners=new Map();
   const value={dataset:{},isConnected:true,disabled:false,textContent:'',scrollTop:0,
    classList:{add(...names){names.forEach(name=>classes.add(name));},remove(...names){names.forEach(name=>classes.delete(name));},contains:name=>classes.has(name),toggle(name,force){const enabled=force??!classes.has(name);enabled?classes.add(name):classes.delete(name);return enabled;}},
    addEventListener(type,handler){listen(listeners,type,handler);},
    dispatch(type,event={target:value}){return Promise.all((listeners.get(type)||[]).map(handler=>handler(event)));},
    focus(){document.activeElement=value;},setAttribute(name,text){attributes.set(name,String(text));},getAttribute:name=>attributes.get(name),hasAttribute:name=>attributes.has(name),
    closest:selector=>selector.includes('button')?value:null,querySelectorAll:()=>[],getClientRects:()=>classes.has('hidden')?[]:[{}]};
   if(key==='#native-install'){value.disabled=true;classes.add('hidden');}
   if(key==='#install-modal'||key==='#detail-modal')classes.add('hidden');
   elements.set(key,value);
  }
  return elements.get(key);
 }
 const devices=['iphone','android','computer'].map(device=>{const value=element('device:'+device);value.dataset.installDevice=device;return value;});
 const panels=['iphone','android','computer'].map(device=>{const value=element('panel:'+device);value.dataset.installPanel=device;if(device!=='iphone')value.classList.add('hidden');return value;});
 document={activeElement:element('#install-btn'),body:element('body'),querySelector:element,
  querySelectorAll:selector=>selector==='[data-install-device]'?devices:selector==='[data-install-panel]'?panels:[],
  addEventListener:(type,handler)=>listen(documentListeners,type,handler)};
 const window={addEventListener:(type,handler)=>listen(windowListeners,type,handler)};
 vm.runInNewContext(appSource,{document,window,navigator:{userAgent:'Android'},localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},setTimeout,clearTimeout,URL});
 return {element,writes,
  async click(key){const target=element(key);if(target.disabled)return;await target.dispatch('click');await Promise.all((documentListeners.get('click')||[]).map(handler=>handler({target})));},
  emit(event){for(const handler of windowListeners.get('beforeinstallprompt')||[])handler(event);},
  get status(){return element('#install-status').textContent;},
  get activeElement(){return document.activeElement;},
  get native(){return element('#native-install');},
  get modal(){return element('#install-modal');}};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function installEvent(prompt,userChoice){return{calls:0,prevented:0,preventDefault(){this.prevented++;},prompt(){this.calls++;return prompt();},userChoice};}
function unavailable(site){assert.equal(site.native.disabled,true);assert.equal(site.native.classList.contains('hidden'),true);}
function available(site){assert.equal(site.native.disabled,false);assert.equal(site.native.classList.contains('hidden'),false);}
async function instructions(site){
 await site.click('#install-btn');
 assert.equal(site.modal.classList.contains('hidden'),false,'La guía debe abrir incluso sin solicitud nativa');
 await site.click('device:iphone');
 assert.equal(site.element('panel:iphone').classList.contains('hidden'),false);
 await site.click('device:android');
 assert.equal(site.element('panel:android').classList.contains('hidden'),false);
 assert.equal(site.element('panel:iphone').classList.contains('hidden'),true);
 await site.click('#close-install');
 assert.equal(site.modal.classList.contains('hidden'),true);
 await site.click('#install-btn');
 assert.equal(site.modal.classList.contains('hidden'),false,'Cerrar y reabrir debe conservar el acceso a las instrucciones');
 assert.deepEqual(site.writes,[],'Las respuestas del diálogo no deben guardar un estado de instalación');
 assert.doesNotMatch(site.status,/app instalada|instalaci[oó]n completada/i);
}

const cancelled=app();
unavailable(cancelled);
await instructions(cancelled);
const shown=deferred(),choice=deferred();
const first=installEvent(()=>shown.promise,choice.promise);
cancelled.emit(first);
assert.equal(first.prevented,1);
available(cancelled);
cancelled.native.focus();
const requesting=cancelled.click('#native-install');
assert.equal(first.calls,1);
unavailable(cancelled);
assert.equal(cancelled.activeElement,cancelled.element('#close-install'),'El foco no debe permanecer en el botón que se oculta');
await cancelled.click('#native-install');
await cancelled.native.dispatch('click');
assert.equal(first.calls,1,'Un doble clic no debe reutilizar la solicitud pendiente');
shown.resolve();
await Promise.resolve();
unavailable(cancelled);
choice.resolve({outcome:'dismissed'});
await requesting;
assert.match(cancelled.status,/Canceló la solicitud/);
unavailable(cancelled);
await instructions(cancelled);
unavailable(cancelled);
await cancelled.native.dispatch('click');
assert.equal(first.calls,1,'Reabrir la guía no debe reutilizar un evento consumido');

const retry=installEvent(()=>Promise.resolve(),Promise.resolve({outcome:'accepted'}));
cancelled.emit(retry);
available(cancelled);
await cancelled.click('#native-install');
assert.equal(retry.calls,1,'Un evento nuevo debe permitir reintentar');
assert.match(cancelled.status,/Solicitud aceptada/);
assert.equal(cancelled.modal.classList.contains('hidden'),false,'Aceptar no debe cerrar las instrucciones ni afirmar que la instalación terminó');
unavailable(cancelled);
await instructions(cancelled);

for(const failure of [()=>{throw Error('Synchronous failure');},()=>Promise.reject(Error('Rejected prompt'))]){
 const site=app(),event=installEvent(failure);
 await instructions(site);site.emit(event);await site.click('#native-install');
 assert.equal(event.calls,1);assert.match(site.status,/No se pudo completar/);unavailable(site);
 await instructions(site);await site.native.dispatch('click');assert.equal(event.calls,1);
}
const rejectedChoice=app(),rejection=deferred();
await instructions(rejectedChoice);
rejectedChoice.emit(installEvent(()=>Promise.resolve(),rejection.promise));
const resolvingChoice=rejectedChoice.click('#native-install');
await Promise.resolve();rejection.reject(Error('Rejected choice'));await resolvingChoice;
assert.match(rejectedChoice.status,/No se pudo completar/);unavailable(rejectedChoice);await instructions(rejectedChoice);

const concurrent=app(),oldChoice=deferred();
await instructions(concurrent);
const oldEvent=installEvent(()=>Promise.resolve(),oldChoice.promise);
const newEvent=installEvent(()=>Promise.resolve({outcome:'accepted'}));
concurrent.emit(oldEvent);
const oldRequest=concurrent.click('#native-install');
concurrent.emit(newEvent);unavailable(concurrent);
oldChoice.resolve({outcome:'dismissed'});await oldRequest;
available(concurrent);
await concurrent.click('#native-install');
assert.equal(oldEvent.calls,1);assert.equal(newEvent.calls,1,'Finalizar una solicitud no debe perder un evento nuevo recibido mientras esperaba');
assert.match(concurrent.status,/Solicitud aceptada/);unavailable(concurrent);await instructions(concurrent);

console.log('Instalación verificada: cancelación, reintento, doble clic y errores; evento de un uso e instrucciones siempre disponibles.');
