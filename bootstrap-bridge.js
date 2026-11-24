/* Local gateway entry. No app code runs before a verified controlled navigation. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else api.start(root).catch(()=>{root.document.getElementById('gateway-status').textContent='تعذّر تجهيز التطبيق. التطبيق متوقف.';});})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 async function start(env){
  const status=env.document.getElementById('gateway-status');
  const stop=reason=>{status.textContent=reason;return {state:'stopped',reason};};
  const sw=env.navigator.serviceWorker;if(!sw)return stop('المتصفح لا يدعم عامل التطبيق. التطبيق متوقف.');
  const script=new URL('firebase-messaging-sw.js',env.location.href);
  if(!sw.controller){await sw.register(script.href,{scope:new URL('./',env.location.href).href,updateViaCache:'none'});return stop('اتجهّز عامل التطبيق. اقفل كل تبويبات الموقع ونوافذ التطبيق وافتحه من جديد. التطبيق متوقف.');}
  const controller=sw.controller;if(controller.scriptURL!==script.href)return stop('عامل التطبيق الحالي غير متوافق. التطبيق متوقف.');
  const send=type=>new Promise((resolve,reject)=>{const c=new env.MessageChannel();const close=()=>{env.clearTimeout(timer);c.port1.close();c.port2.close();};const timer=env.setTimeout(()=>{close();reject(Error('timeout'));},30000);c.port1.onmessage=e=>{close();resolve(e.data);};try{controller.postMessage({type,protocol:1},[c.port2]);}catch(error){close();reject(error);}});
  let reply;try{reply=await send('BIS_GATEWAY_STATUS');}catch(_){const reg=await sw.getRegistration();if(reg)await reg.update();return stop('عامل قديم أو اتصال غير متوافق. اقفل كل تبويبات الموقع ونوافذ التطبيق وافتحه من جديد. التطبيق متوقف.');}
  if(sw.controller!==controller||!reply||reply.type!=='BIS_GATEWAY_STATUS'||reply.protocol!==1)return stop('إصدار البوابة غير متوافق. التطبيق متوقف.');
  if(reply.state!=='verified'){
   try{reply=await send('BIS_GATEWAY_CHECK');}catch(_){return stop('مفيش نسخة مكتملة التحقق متاحة. التطبيق متوقف.');}
   if(reply.type!=='BIS_GATEWAY_CHECK'||reply.protocol!==1)return stop('رد التحديث غير صالح. التطبيق متوقف.');
  }
  if(sw.controller!==controller||!['verified','ready'].includes(reply.state)||!/^[a-f0-9]{64}$/.test(reply.generation||''))return stop('مفيش نسخة مكتملة التحقق متاحة. التطبيق متوقف.');
  const attempt=Number(env.sessionStorage.getItem('bis-gateway-attempt')||0);if(attempt>=1)return stop('فتح النسخة ما اكتملش. اقفل كل نوافذ التطبيق وافتحه من جديد. التطبيق متوقف.');
  env.sessionStorage.setItem('bis-gateway-attempt','1');const target=new URL(env.location.href);target.searchParams.set('__gateway','app');env.location.replace(target.href);return {state:'navigating'};
 }
 return Object.freeze({start});
});
