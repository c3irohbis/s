/* Bounded first-load/repair entry. Trusted warm navigations bypass this shell. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else api.start(root).catch(()=>{root.document.getElementById('gateway-status').textContent='تعذّر تجهيز التطبيق. التطبيق متوقف. جرّب إعادة الفتح.';});})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 async function start(env){
  const status=env.document.getElementById('gateway-status');let active=true;
  const stop=reason=>{active=false;status.textContent=reason;return {state:'stopped',reason};};
  const bound=(fn,ms)=>new Promise((resolve,reject)=>{let settled=false;const timer=env.setTimeout(()=>{settled=true;reject(Error('timeout'));},ms);Promise.resolve().then(fn).then(v=>{if(settled||!active)return;settled=true;env.clearTimeout(timer);resolve(v);},e=>{if(settled)return;settled=true;env.clearTimeout(timer);reject(e);});});
  const sw=env.navigator.serviceWorker;if(!sw)return stop('المتصفح لا يدعم عامل التطبيق. التطبيق متوقف.');
  const script=new URL('firebase-messaging-sw.js',env.location.href);
  if(!sw.controller){try{await bound(()=>sw.register(script.href,{scope:new URL('./',env.location.href).href,updateViaCache:'none'}),12000);}catch(_){return stop('تجهيز التطبيق أخد وقت أطول من المتوقع. جرّب اتصال تاني واقفل تبويبات الموقع وافتحه من جديد.');}return stop('اتجهّز التطبيق. اقفل كل تبويبات الموقع ونوافذ التطبيق وافتحه من جديد مرة واحدة.');}
  const controller=sw.controller;if(controller.scriptURL!==script.href)return stop('عامل التطبيق الحالي غير متوافق. التطبيق متوقف.');
  const send=(type,ms)=>new Promise((resolve,reject)=>{const c=new env.MessageChannel();let settled=false;const close=()=>{env.clearTimeout(timer);c.port1.close();c.port2.close();};const timer=env.setTimeout(()=>{settled=true;close();reject(Error('timeout'));},ms);c.port1.onmessage=e=>{if(settled||!active)return;settled=true;close();resolve(e.data);};try{controller.postMessage({type,protocol:1},[c.port2]);}catch(error){settled=true;close();reject(error);}});
  let reply;try{reply=await send('BIS_GATEWAY_STATUS',10000);}catch(_){try{const reg=await bound(()=>sw.getRegistration(),3000);if(reg)await bound(()=>reg.update(),8000);}catch(_){}return stop('عامل قديم أو الاتصال مش مكتمل. اقفل كل تبويبات الموقع ونوافذ التطبيق وافتحه من جديد.');}
  if(sw.controller!==controller||!reply||reply.type!=='BIS_GATEWAY_STATUS'||reply.protocol!==1)return stop('إصدار البوابة غير متوافق. التطبيق متوقف.');
  // A repair shell must run CHECK even if metadata says verified: the document
  // could be corrupt. The worker alone decides which complete generation is safe.
  status.textContent='بنجهّز نسخة سليمة من التطبيق. أول تجهيز ممكن يحتاج وقت حسب الاتصال.';
  try{reply=await send('BIS_GATEWAY_CHECK',95000);}catch(_){return stop('التجهيز ما اكتملش في الوقت المحدد. النسخة غير المكتملة مش هتفتح. جرّب اتصال تاني وبعدها إعادة الفتح.');}
  if(sw.controller!==controller||!reply||reply.type!=='BIS_GATEWAY_CHECK'||reply.protocol!==1||!['verified','ready'].includes(reply.state)||!/^[a-f0-9]{64}$/.test(reply.generation||''))return stop('مفيش نسخة سليمة مكتملة متاحة. جرّب اتصال تاني وبعدها إعادة الفتح.');
  const attempt=Number(env.sessionStorage.getItem('bis-gateway-attempt')||0);if(attempt>=1)return stop('فتح النسخة ما اكتملش. اقفل كل نوافذ التطبيق وافتحه من جديد.');
  env.sessionStorage.setItem('bis-gateway-attempt','1');active=false;const target=new URL(env.location.href);target.searchParams.set('__gateway','app');env.location.replace(target.href);return {state:'navigating'};
 }
 return Object.freeze({start});
});
