/* EPSS PDF viewer. Originals are rendered and shared without changing their bytes. */
(function (root) {
  'use strict';
  const VERSION = '5.6.205';
  const MAX_PIXELS = 4000000;
  function pdfRequest(href, base) {
    try {
      const url = new URL(href, base), assets = new URL('assets/', base);
      if (url.origin !== assets.origin || !url.pathname.startsWith(assets.pathname) || !/\.pdf$/i.test(url.pathname)) return null;
      const page = Number(new URLSearchParams(url.hash.slice(1)).get('page'));
      url.hash = ''; url.search = '';
      return {url:url.href, page:Number.isFinite(page) && page > 0 ? Math.floor(page) : 1};
    } catch { return null; }
  }
  function safeFilename(title) {
    const value = String(title || 'Documento EPSS').replace(/[\\/:*?"<>|%]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/g, '').slice(0,120);
    return (value || 'Documento EPSS').replace(/\.pdf$/i,'') + '.pdf';
  }
  function canvasPlan(width, height, available, zoom, dpr) {
    const cssWidth = Math.max(160, available) * Math.max(.75,Math.min(3,zoom));
    const cssHeight = height * cssWidth / width;
    const output = Math.min(Math.max(1,Math.min(2,dpr || 1)),Math.sqrt(MAX_PIXELS/(cssWidth*cssHeight)),8192/cssWidth,8192/cssHeight);
    return {cssWidth,cssHeight,scale:cssWidth/width,output,width:Math.max(1,Math.floor(cssWidth*output)),height:Math.max(1,Math.floor(cssHeight*output))};
  }
  function canShareFile(file, navigatorApi) {
    try { return !!(file && navigatorApi.share && navigatorApi.canShare && navigatorApi.canShare({files:[file]})); } catch { return false; }
  }
  function sharePreparedFile(file, navigatorApi, title) {
    if (!canShareFile(file,navigatorApi)) return Promise.reject(new Error('Compartir archivos no está disponible.'));
    // No network or document generation occurs between this click and share().
    try { const result=navigatorApi.share({files:[file],title});return result && typeof result.then==='function'?result:Promise.reject(new Error('El navegador no confirmó la apertura del menú para compartir.')); }
    catch(error) { return Promise.reject(error); }
  }
  function commitPageInput(session, input, render) {
    if(!session?.pdf)return false;
    const page=Math.max(1,Math.min(session.pdf.numPages,Math.floor(Number(input.value)||session.page)));
    input.value=page;
    if(page===session.page)return false;
    session.page=page;render(session);return true;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {pdfRequest,safeFilename,canvasPlan,canShareFile,sharePreparedFile,commitPageInput};
  if (!root.document) return;

  const document = root.document;
  let shell, current = null, modulePromise = null, moduleAttempts = 0;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const localUrl = path => new URL(path,document.baseURI).href;
  const active = session => current === session && !shell.hidden;
  function status(text, error=false) { shell.querySelector('[data-doc-status]').textContent=text; shell.querySelector('[data-doc-status]').classList.toggle('is-error',error); }
  function ensureShell() {
    if (shell) return;
    shell = document.createElement('section'); shell.id='document-viewer'; shell.hidden=true;
    shell.setAttribute('role','dialog'); shell.setAttribute('aria-modal','true'); shell.setAttribute('aria-labelledby','document-viewer-title');
    shell.innerHTML=`<div class="document-shell"><header class="document-header"><button type="button" class="document-back" data-doc-action="close">← Volver a la app</button><div><span class="document-eyebrow">PDF ORIGINAL</span><h2 id="document-viewer-title"></h2></div></header><nav class="document-toolbar" aria-label="Controles del PDF"><button type="button" data-doc-action="prev" aria-label="Página anterior">‹</button><label class="document-page-entry"><span>Página</span><input data-doc-page type="number" min="1" value="1" inputmode="numeric" aria-label="Ir a la página"><span data-doc-total>de …</span></label><button type="button" data-doc-action="next" aria-label="Página siguiente">›</button><span class="document-toolbar-separator"></span><button type="button" data-doc-action="zoom-out" aria-label="Reducir PDF">−</button><button type="button" data-doc-action="fit">Ajustar</button><button type="button" data-doc-action="zoom-in" aria-label="Ampliar PDF">+</button></nav><p class="document-status" data-doc-status role="status" aria-live="polite"></p><div class="document-viewport" data-doc-viewport tabindex="0" aria-label="Página del PDF"><canvas data-doc-canvas role="img" hidden></canvas></div><footer class="document-footer"><p data-doc-help></p><div class="document-file-actions"><button type="button" class="document-primary" data-doc-action="share">Compartir o imprimir</button><button type="button" data-doc-action="print">Abrir para imprimir</button><button type="button" data-doc-action="download">Descargar PDF</button><button type="button" data-doc-action="copy">Copiar enlace de la app</button></div></footer></div>`;
    document.body.append(shell);
    shell.addEventListener('click',event=>{const control=event.target.closest('[data-doc-action]');if(control){event.preventDefault();event.stopPropagation();action(control.dataset.docAction);}});
    const pageInput=shell.querySelector('[data-doc-page]');
    pageInput.addEventListener('change',()=>commitPageInput(current,pageInput,requestRender));
    root.addEventListener('resize',()=>{if(current?.pdf){const width=shell.querySelector('[data-doc-viewport]').clientWidth;if(Math.abs(width-current.lastWidth)>4)requestRender(current);}});
  }
  function updateControls(session) {
    const count=session.pdf?.numPages || 0;
    for (const name of ['prev','next','zoom-in','zoom-out','fit']) shell.querySelector(`[data-doc-action="${name}"]`).disabled=!count;
    shell.querySelector('[data-doc-action="prev"]').disabled=!count || session.page<=1;
    shell.querySelector('[data-doc-action="next"]').disabled=!count || session.page>=count;
    shell.querySelector('[data-doc-action="zoom-in"]').disabled=!count || session.zoom>=3;
    shell.querySelector('[data-doc-action="zoom-out"]').disabled=!count || session.zoom<=.75;
    const input=shell.querySelector('[data-doc-page]');input.disabled=!count;input.value=session.page;input.max=count || 1;
    shell.querySelector('[data-doc-total]').textContent=count?'de '+count:'de …';
    const share=shell.querySelector('[data-doc-action="share"]');share.disabled=!canShareFile(session.file,navigator);share.hidden=!!session.file && !canShareFile(session.file,navigator);
    for (const name of ['download','print']) {const control=shell.querySelector(`[data-doc-action="${name}"]`);control.hidden=isIOS();control.disabled=!session.file;}
    shell.querySelector('[data-doc-action="copy"]').hidden=!(isIOS() && session.file && !canShareFile(session.file,navigator));
    shell.querySelector('[data-doc-help]').textContent=isIOS()
      ? session.file && !canShareFile(session.file,navigator) ? 'Este dispositivo no permite compartir archivos desde esta app. Copie el enlace, ábralo en Safari y consulte allí las opciones de compartir o imprimir.' : 'Para imprimir en iPhone o iPad: pulse Compartir o imprimir y elija Imprimir en el menú de iOS. También puede guardar el PDF en Archivos.'
      : 'Comparta o descargue el PDF original. Abrir para imprimir lo muestra en otra pestaña, conservando esta app.';
  }
  function loadLibrary() {
    if (!modulePromise) {
      const attempt=moduleAttempts++;
      modulePromise=import(localUrl('assets/pdfjs/pdf.mjs')+'?v='+VERSION+(attempt?'&retry='+attempt:'')).then(pdfjs=>{pdfjs.GlobalWorkerOptions.workerSrc=localUrl('assets/pdfjs/pdf.worker.mjs')+'?v='+VERSION;return pdfjs;}).catch(error=>{modulePromise=null;throw error;});
    }
    return modulePromise;
  }
  function requestRender(session) {
    if (!active(session) || !session.pdf) return;
    const generation=++session.renderGeneration;
    session.renderTask?.cancel();
    updateControls(session); status('Preparando página '+session.page+'…');
    session.queue=session.queue.catch(()=>{}).then(async()=>{
      if(!active(session)||generation!==session.renderGeneration)return;
      const pageNumber=session.page,zoom=session.zoom,page=await session.pdf.getPage(pageNumber);
      if(!active(session)||generation!==session.renderGeneration)return;
      const viewport=page.getViewport({scale:1}),holder=shell.querySelector('[data-doc-viewport]');
      session.lastWidth=holder.clientWidth;
      const plan=canvasPlan(viewport.width,viewport.height,Math.max(160,holder.clientWidth-32),zoom,root.devicePixelRatio);
      const canvas=shell.querySelector('[data-doc-canvas]');canvas.width=plan.width;canvas.height=plan.height;canvas.style.width=plan.cssWidth+'px';canvas.style.height=plan.cssHeight+'px';canvas.hidden=false;
      canvas.setAttribute('aria-label','Página '+pageNumber+' de '+session.pdf.numPages+' de '+session.title);
      const task=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:page.getViewport({scale:plan.scale}),transform:[plan.output,0,0,plan.output,0,0],background:'rgb(255,255,255)'});
      session.renderTask=task;
      try {await task.promise;} catch(error) {if(error.name!=='RenderingCancelledException')throw error;}
      if(!active(session)||generation!==session.renderGeneration)return;
      session.renderTask=null;holder.scrollTop=0;holder.scrollLeft=0;status('Página '+pageNumber+' de '+session.pdf.numPages+'. PDF original.');
    }).catch(error=>{if(active(session)&&generation===session.renderGeneration)status('No se pudo mostrar esta página. Puede compartir el PDF original o volver a la app.',true);});
  }
  function makeBackgroundInert(session) {
    session.background=[...document.body.children].filter(el=>el!==shell).map(el=>({el,inert:el.hasAttribute('inert'),aria:el.getAttribute('aria-hidden')}));
    for(const row of session.background){row.el.inert=true;row.el.setAttribute('aria-hidden','true');}
  }
  function restoreBackground(session) {
    for(const row of session.background || []){row.el.inert=row.inert;if(row.aria===null)row.el.removeAttribute('aria-hidden');else row.el.setAttribute('aria-hidden',row.aria);}
  }
  function release(session) {
    session.renderGeneration++;
    try{session.abort.abort();}catch{}
    try{session.renderTask?.cancel();}catch{}
    try{if(session.loadingTask)Promise.resolve(session.loadingTask.destroy()).catch(()=>{});}catch{}
    try{if(session.objectUrl)URL.revokeObjectURL(session.objectUrl);}catch{}
  }
  async function open(href,options={}) {
    const request=pdfRequest(href,document.baseURI);if(!request)return false;
    ensureShell();
    if(current)close(false);
    const session={request,title:options.title || 'Documento EPSS',page:request.page,zoom:1,file:null,pdf:null,loadingTask:null,renderTask:null,renderGeneration:0,queue:Promise.resolve(),abort:new AbortController(),opener:options.opener || document.activeElement,historyToken:'epss-pdf-'+Date.now()+'-'+Math.random().toString(36).slice(2)};
    current=session;shell.hidden=false;document.body.classList.add('document-open');
    const context=options.context || session.opener?.closest?.('.detail-panel,article');
    if(context){const style=getComputedStyle(context);shell.style.setProperty('--document-topic',style.getPropertyValue('--topic').trim() || '#186b98');shell.style.setProperty('--document-tint',style.getPropertyValue('--topic-tint').trim() || '#e6f3fb');}
    else{shell.style.removeProperty('--document-topic');shell.style.removeProperty('--document-tint');}
    shell.querySelector('#document-viewer-title').textContent=session.title;
    shell.querySelector('[data-doc-canvas]').hidden=true;makeBackgroundInert(session);updateControls(session);status('Cargando PDF original…');
    try{history.pushState({epssDocumentViewer:session.historyToken},'',location.href);session.historyAdded=true;}catch{}
    shell.querySelector('[data-doc-action="close"]').focus();
    document.dispatchEvent(new CustomEvent('epss:document-open',{detail:{indicator:options.indicator || '',printMode:!!options.printMode}}));
    try {
      const response=await fetch(request.url,{signal:session.abort.signal,credentials:'same-origin'});if(!response.ok)throw Error('No se pudo descargar el PDF.');
      const bytes=await response.arrayBuffer();if(!active(session))return true;
      // File keeps the original bytes. PDF.js receives a copy for worker transfer.
      session.file=new File([bytes],safeFilename(session.title),{type:'application/pdf'});session.objectUrl=URL.createObjectURL(session.file);updateControls(session);
      const pdfjs=await loadLibrary();if(!active(session))return true;
      session.loadingTask=pdfjs.getDocument({data:new Uint8Array(bytes.slice(0)),standardFontDataUrl:localUrl('assets/pdfjs/'),wasmUrl:localUrl('assets/pdfjs/'),isEvalSupported:false});
      session.pdf=await session.loadingTask.promise;if(!active(session))return true;
      session.page=Math.max(1,Math.min(session.pdf.numPages,request.page));requestRender(session);
    } catch(error) {
      if(active(session)&&error.name!=='AbortError'){status(session.file?'No se pudo mostrar el PDF en este navegador. Puede compartir el archivo original y volver a la app.':'No se pudo cargar el PDF. Compruebe la conexión y vuelva a intentarlo. Puede volver a la app con el botón superior.',true);updateControls(session);}
    }
    return true;
  }
  function close(useHistory=true) {
    const session=current;if(!session)return;
    current=null;release(session);shell.hidden=true;document.body.classList.remove('document-open');restoreBackground(session);
    const canvas=shell.querySelector('[data-doc-canvas]');canvas.width=0;canvas.height=0;
    try{if(session.opener?.isConnected)session.opener.focus({preventScroll:true});}catch{}
    try{if(useHistory && session.historyAdded && history.state?.epssDocumentViewer===session.historyToken)history.back();}catch{}
  }
  function action(name) {
    const session=current;if(!session)return;
    if(name==='close'){close();return;}
    if(name==='prev'&&session.pdf&&session.page>1){session.page--;requestRender(session);return;}
    if(name==='next'&&session.pdf&&session.page<session.pdf.numPages){session.page++;requestRender(session);return;}
    if(name==='zoom-in'||name==='zoom-out'||name==='fit'){session.zoom=name==='fit'?1:Math.max(.75,Math.min(3,session.zoom+(name==='zoom-in'?.25:-.25)));requestRender(session);return;}
    if(name==='share'){
      sharePreparedFile(session.file,navigator,session.title).catch(error=>{if(active(session)&&error.name!=='AbortError'){shell.querySelector('[data-doc-action="copy"]').hidden=false;status('No se pudo abrir el menú para compartir. Puede volver a intentarlo o copiar el enlace y abrir la app en Safari.',true);}});return;
    }
    if(name==='copy'){
      const url=new URL(location.href);url.search='';
      if(!navigator.clipboard?.writeText){status('Abra este enlace de la app en Safari: '+url.href);return;}
      navigator.clipboard.writeText(url.href).then(()=>{if(active(session))status('Enlace de la app copiado. Ábralo en Safari.');}).catch(()=>{if(active(session))status('Abra este enlace de la app en Safari: '+url.href);});return;
    }
    if(isIOS())return;
    if(name==='download'&&session.file){const anchor=document.createElement('a');anchor.href=session.objectUrl;anchor.download=session.file.name;anchor.hidden=true;document.body.append(anchor);anchor.click();anchor.remove();return;}
    if(name==='print'&&session.file){root.open(session.request.url,'_blank','noopener');}
  }
  root.addEventListener('popstate',()=>{if(current && history.state?.epssDocumentViewer!==current.historyToken)close(false);});
  document.addEventListener('keydown',event=>{
    if(!current)return;
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='Enter' && event.target.matches?.('[data-doc-page]')){event.preventDefault();commitPageInput(current,event.target,requestRender);event.target.blur();}
    if(event.key==='Tab'){
      const controls=[...shell.querySelectorAll('button,input,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
      if(controls.length){const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    }
    // The ficha and install dialog shortcuts must not receive PDF key events.
    event.stopImmediatePropagation();
  },true);
  document.addEventListener('click',event=>{
    if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
    const trigger=event.target.closest?.('[data-print],a[href]');if(!trigger || shell?.contains(trigger))return;
    const printMode=trigger.hasAttribute('data-print'),context=trigger.closest('.detail-panel,article');
    const anchor=printMode?context?.querySelector('a[data-pdf]'):trigger;
    const request=anchor && pdfRequest(anchor.href,document.baseURI);if(!request)return;
    event.preventDefault();event.stopImmediatePropagation();
    const title=context?.querySelector('.detail-title,h2,h3')?.textContent?.trim() || anchor.getAttribute('data-document-title') || anchor.textContent.trim().replace(/[↗→]/g,'').trim() || 'Documento EPSS';
    open(anchor.href,{title,context,opener:trigger,indicator:anchor.dataset.pdf || '',printMode});
  },true);
  root.EPSSDocumentViewer={open,close,isOpen:()=>!!current,version:VERSION};
})(typeof window !== 'undefined' ? window : globalThis);
