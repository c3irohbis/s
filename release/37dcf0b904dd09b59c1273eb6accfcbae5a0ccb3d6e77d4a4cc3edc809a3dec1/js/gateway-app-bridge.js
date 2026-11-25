/* Compare the gateway's client pin, never a guessed build identity. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else api.install(root);})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 function install(env){
  try{env.sessionStorage.removeItem('bis-gateway-attempt');}catch(_){}let pending=null,pendingManual=false,target=null,reloading=false,scheduled=false;const dirty=new Set();
  const say=text=>{if(typeof env.toast==='function')env.toast(text);};
  const valid=g=>typeof g==='string'&&/^[a-f0-9]{64}$/.test(g);
  const editable=e=>e&&(e.matches?.('input,textarea,select')||e.isContentEditable);
  function unsafe(){if(editable(env.document.activeElement))return true;for(const e of dirty){if(e.isContentEditable&&(String(e.textContent||'').trim().length||e.querySelector?.('img,video,audio,iframe,canvas,svg,object,embed,[contenteditable=false]'))||e.type==='file'&&e.files?.length||e.type==='checkbox'||e.type==='radio'||e.tagName==='SELECT'||String(e.value||'').length)return true;dirty.delete(e);}return false;}
  function reloadIfSafe(){
   if(!target||reloading||unsafe())return;
   try{const raw=env.sessionStorage.getItem('bis-auto-reload-ledger');const ledger=raw?JSON.parse(raw):[];if(!Array.isArray(ledger)||ledger.some(x=>!valid(x))||ledger.length>=32||ledger.includes(target))return;ledger.push(target);const encoded=JSON.stringify(ledger);env.sessionStorage.setItem('bis-auto-reload-ledger',encoded);if(env.sessionStorage.getItem('bis-auto-reload-ledger')!==encoded)return;}catch(_){return;}
   reloading=true;const u=new URL(env.location.href);u.searchParams.delete('__gateway');u.searchParams.delete('_refresh');env.location.replace(u.href);
  }
  function queueSafeCheck(){if(scheduled)return;scheduled=true;env.setTimeout(()=>{scheduled=false;reloadIfSafe();},0);}
  env.document.addEventListener('input',e=>{if(editable(e.target))dirty.add(e.target);queueSafeCheck();},true);
  env.document.addEventListener('change',e=>{if(editable(e.target))dirty.add(e.target);queueSafeCheck();},true);
  env.document.addEventListener('focusout',queueSafeCheck,true);
  env.document.addEventListener('reset',e=>{env.setTimeout(()=>{if(e.defaultPrevented)return;for(const x of dirty)if(e.target.contains(x)&&!x.isContentEditable)dirty.delete(x);reloadIfSafe();},0);},true);
  async function check(type,manual){
   if(pending){const rerun=manual&&!pendingManual;const result=await pending;return rerun?check(type,true):result;}pendingManual=manual;
   pending=(async()=>{
    const sw=env.navigator.serviceWorker,worker=sw&&sw.controller;if(!worker)throw Error('No gateway controller');
    const reply=await new Promise((resolve,reject)=>{
     const c=new env.MessageChannel();let done=false;const finish=(fn,v)=>{if(done)return;done=true;env.clearTimeout(timer);c.port1.close();c.port2.close();fn(v);};
     const timer=env.setTimeout(()=>finish(reject,Error('Update timeout')),type==='BIS_GATEWAY_CHECK'?95000:10000);
     c.port1.onmessage=e=>finish(resolve,e.data);
     try{worker.postMessage({type,protocol:1},[c.port2]);}catch(e){finish(reject,e);}
    });
    if(sw.controller!==worker||!reply||reply.type!==type||reply.protocol!==1||!['ready','verified'].includes(reply.state)||!valid(reply.generation)||!valid(reply.currentGeneration)||!valid(reply.manifestSHA256)||!valid(reply.currentManifestSHA256)||!Number.isSafeInteger(reply.epoch)||reply.epoch<1||(reply.generation===reply.currentGeneration&&reply.manifestSHA256!==reply.currentManifestSHA256))throw Error('Update status unavailable');
    if(reply.generation===reply.currentGeneration){target=null;if(manual)say('لا توجد تحديثات متاحة');}
    else{target=reply.generation;if(unsafe())say('نسخة جاهزة. التحديث التلقائي مؤجل لحماية الكتابة؛ امسح الحقول أو أعد ضبط النموذج بعد حفظ شغلك.');reloadIfSafe();}
    return reply;
   })().catch(()=>{if(manual)say('تعذر التحقق من التحديثات، جرّب مرة أخرى.');return {state:'unavailable'};}).finally(()=>{pending=null;});return pending;
  }
  env._checkForUpdates=()=>check('BIS_GATEWAY_CHECK',true);
  env.navigator.serviceWorker?.addEventListener('message',e=>{if(e.source!==env.navigator.serviceWorker.controller||e.data?.type!=='BIS_GATEWAY_GENERATION_READY'||e.data.protocol!==1||!valid(e.data.generation))return;check('BIS_GATEWAY_APP_STATUS',false);});
  check('BIS_GATEWAY_APP_STATUS',false);
 }
 return Object.freeze({install});
});
