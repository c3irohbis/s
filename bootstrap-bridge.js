/* Bounded first-load/repair entry. Trusted warm navigations bypass this shell. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else api.start(root).catch(()=>{root.document.getElementById('gateway-status').textContent='تعذّر تجهيز التطبيق. التطبيق متوقف. جرّب إعادة الفتح.';});})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 async function start(env){
  const status=env.document.getElementById('gateway-status');let active=true;
  let view=null;const observe=fn=>{try{return fn();}catch(_){}};const stop=reason=>{active=false;observe(()=>view?.close(true));status.textContent=reason;return {state:'stopped',reason};};
  const bound=(fn,ms)=>new Promise((resolve,reject)=>{let settled=false;const timer=env.setTimeout(()=>{settled=true;reject(Error('timeout'));},ms);Promise.resolve().then(fn).then(v=>{if(settled||!active)return;settled=true;env.clearTimeout(timer);resolve(v);},e=>{if(settled)return;settled=true;env.clearTimeout(timer);reject(e);});});
  function progressView(){
   const doc=env.document;const help=doc.querySelector?.('.help');if(!doc.createElement)return {update(){},close(){}};
   const box=doc.createElement('section'),bar=doc.createElement('progress'),detail=doc.createElement('p'),eta=doc.createElement('p');box.id='gateway-progress';box.setAttribute('aria-label','تقدم تجهيز التطبيق');bar.max=100;bar.value=0;detail.setAttribute('aria-live','polite');eta.textContent='جاري حساب الوقت التقريبي';box.append(bar,detail,eta);
   let phase='',generation='',lastAt=Date.now(),start=0,base=0,previous=0,previousDone=0,rate=0,closed=false;
   const labels={download:'تنزيل ملفات التجهيز',verify:'فحص سلامة الملفات',commit:'حفظ النسخة المتحققة'};
   const timer=env.setInterval(()=>observe(()=>{if(!closed&&phase&&Date.now()-lastAt>5000)eta.textContent='التجهيز أبطأ من المعتاد. بننتظر تقدم حقيقي.';}),1000);try{status.after(box);}catch(error){env.clearInterval(timer);observe(()=>box.remove());throw error;}if(help)observe(()=>{help.hidden=true;});
   function update(v){
    if(closed||!['download','verify','commit'].includes(v.phase)||!Number.isSafeInteger(v.total)||v.total<1||v.total>512||!Number.isSafeInteger(v.done)||v.done<0||v.done>v.total||!/^[a-f0-9]{64}$/.test(v.generation||''))return;
    if(generation&&generation!==v.generation)return;
    if(v.phase==='download'&&(!Number.isSafeInteger(v.received)||!Number.isSafeInteger(v.totalBytes)||v.received<0||v.totalBytes<1||v.totalBytes>33554432||v.received>v.totalBytes))return;
    generation=v.generation;const now=Date.now(),amount=v.phase==='download'?v.received:v.done,total=v.phase==='download'?v.totalBytes:v.total;
    if(phase&&['download','verify','commit'].indexOf(v.phase)<['download','verify','commit'].indexOf(phase))return;if(v.phase!==phase){phase=v.phase;lastAt=now;previousDone=0;start=now;base=amount;previous=amount;rate=0;eta.textContent='جاري حساب الوقت التقريبي';}
    if(amount<previous||v.done<previousDone)return;previousDone=v.done;
    const elapsed=(now-start)/1000;if(amount>previous){lastAt=now;previous=amount;}
    detail.textContent=phase==='commit'?labels[phase]:labels[phase]+': '+v.done+' من '+v.total+(phase==='download'?'، '+(v.received/1000000).toFixed(1)+' من '+(v.totalBytes/1000000).toFixed(1)+' MB (حجم الملفات بعد فك الضغط)':'');
    bar.max=total;if(phase==='commit')bar.removeAttribute('value');else bar.value=amount;
    if(phase==='commit'){eta.textContent='اكتمل الفحص. بنحفظ النسخة ونفتح التطبيق.';return;}
    if(elapsed>=2&&amount>base&&amount<total){const observed=(amount-base)/elapsed;rate=rate?rate*.7+observed*.3:observed;const seconds=(total-amount)/rate;const low=Math.max(1,Math.floor(seconds*.7)),high=Math.max(low+1,Math.ceil(seconds*1.4));eta.textContent='المتبقي لهذه المرحلة تقريبا '+low+'–'+high+' ثانية. التقدير بيتغير حسب الاتصال.';}else if(amount===total)eta.textContent=phase==='download'?'اكتمل التنزيل. باقي فحص السلامة.':'اكتمل فحص الملفات. بنجهز الفتح.';
   }
   return {update,close(failed=false){closed=true;env.clearInterval(timer);if(failed){eta.textContent='التجهيز توقف. النسخة غير المكتملة مش هتفتح.';const retry=doc.createElement('button');retry.textContent='إعادة المحاولة';retry.type='button';retry.addEventListener('click',()=>{retry.disabled=true;env.location.reload();},{once:true});box.append(retry);}}};
  }
  const sw=env.navigator.serviceWorker;if(!sw)return stop('المتصفح لا يدعم عامل التطبيق. التطبيق متوقف.');
  const script=new URL('firebase-messaging-sw.js',env.location.href);
  let worker=sw.controller,uncontrolled=!worker;
  if(uncontrolled){
   status.textContent='بنجهّز التطبيق بأمان. هيفتح تلقائيًا بعد اكتمال التحقق.';
   let reg;try{reg=await bound(()=>sw.register(script.href,{scope:new URL('./',env.location.href).href,updateViaCache:'none'}),12000);}catch(_){return stop('تعذّر تسجيل عامل التطبيق. جرّب اتصال تاني وأعد المحاولة.');}
   if(reg.scope!==new URL('./',env.location.href).href)return stop('نطاق عامل التطبيق غير متوافق. التطبيق متوقف.');
   let cleanup=()=>{};
   try{worker=await bound(()=>new Promise((resolve,reject)=>{
    const listeners=[];let done=false;cleanup=()=>{done=true;for(const [target,type,cb]of listeners)target.removeEventListener(type,cb);};
    const finish=(fn,value)=>{if(done)return;done=true;for(const [target,type,cb]of listeners)target.removeEventListener(type,cb);fn(value);};
    const listen=(target,type,cb)=>{target.addEventListener(type,cb);listeners.push([target,type,cb]);};
    const inspect=()=>{if(reg.active&&reg.active.state==='activated')return finish(resolve,reg.active);const installing=reg.installing||reg.waiting||reg.active;if(installing&&!listeners.some(x=>x[0]===installing))listen(installing,'statechange',inspect);if(installing&&installing.state==='redundant')finish(reject,Error('install failed'));};
    listen(reg,'updatefound',inspect);inspect();
   }),95000);}catch(_){return stop(reg.waiting?'في تحديث لعامل التطبيق مستني نوافذ الموقع القديمة تتقفل. اقفل نوافذ الموقع وافتحه من جديد.':'تجهيز عامل التطبيق ما اكتملش. جرّب اتصال تاني وأعد المحاولة.');}finally{cleanup();}
  }
  if(!uncontrolled){let reg;try{reg=await bound(()=>sw.getRegistration(),3000);}catch(_){return stop('تعذّر التحقق من نطاق عامل التطبيق. التطبيق متوقف.');}if(!reg||reg.scope!==new URL('./',env.location.href).href)return stop('نطاق عامل التطبيق غير متوافق. التطبيق متوقف.');}
  if(!worker||worker.scriptURL!==script.href)return stop('عامل التطبيق الحالي غير متوافق. التطبيق متوقف.');
  const current=()=>uncontrolled?!sw.controller||sw.controller===worker:sw.controller===worker;
  const send=(type,ms)=>new Promise((resolve,reject)=>{const requestId=env.crypto?.randomUUID?.();const c=new env.MessageChannel();let settled=false;const close=()=>{env.clearTimeout(timer);c.port1.close();c.port2.close();};const timer=env.setTimeout(()=>{settled=true;close();reject(Error('timeout'));},ms);c.port1.onmessage=e=>{if(settled||!active)return;if(e.data?.type==='BIS_GATEWAY_PROGRESS'){if(type==='BIS_GATEWAY_CHECK'&&requestId&&e.data.protocol===1&&e.data.requestId===requestId)observe(()=>view?.update(e.data));return;}settled=true;close();resolve(e.data);};try{worker.postMessage({type,protocol:1,...(type==='BIS_GATEWAY_CHECK'&&requestId?{progress:1,requestId}:{})},[c.port2]);}catch(error){settled=true;close();reject(error);}});
  let reply;try{reply=await send('BIS_GATEWAY_STATUS',10000);}catch(_){let reg;try{reg=await bound(()=>sw.getRegistration(),3000);if(reg)await bound(()=>reg.update(),8000);}catch(_){}return stop(reg&&reg.waiting?'عامل قديم وفي تحديث مستني نوافذ الموقع القديمة تتقفل. اقفل نوافذ الموقع وافتحه من جديد.':'عامل قديم أو الاتصال مش مكتمل. جرّب اتصال تاني وأعد المحاولة.');}
  if(!current()||!reply||reply.type!=='BIS_GATEWAY_STATUS'||reply.protocol!==1)return stop('إصدار البوابة غير متوافق. التطبيق متوقف.');
  // A repair shell must run CHECK even if metadata says verified: the document
  // could be corrupt. The worker alone decides which complete generation is safe.
  status.textContent='بنجهّز نسخة سليمة من التطبيق. أول تجهيز ممكن يحتاج وقت حسب الاتصال.';
  view=observe(()=>progressView());try{reply=await send('BIS_GATEWAY_CHECK',95000);}catch(_){return stop('التجهيز ما اكتملش في الوقت المحدد. النسخة غير المكتملة مش هتفتح. جرّب اتصال تاني وبعدها إعادة الفتح.');}
  if(!current()||!reply||reply.type!=='BIS_GATEWAY_CHECK'||reply.protocol!==1||!['verified','ready'].includes(reply.state)||!/^[a-f0-9]{64}$/.test(reply.generation||''))return stop('مفيش نسخة سليمة مكتملة متاحة. جرّب اتصال تاني وبعدها إعادة الفتح.');
  let attempt;try{attempt=env.sessionStorage.getItem('bis-gateway-attempt');}catch(_){return stop('تعذّر حفظ حالة الفتح بأمان. التطبيق متوقف.');}if(attempt!==null&&attempt!=='0')return stop('فتح النسخة ما اكتملش. اقفل كل نوافذ التطبيق وافتحه من جديد.');
  let stored=false;try{env.sessionStorage.setItem('bis-gateway-attempt','1');stored=env.sessionStorage.getItem('bis-gateway-attempt')==='1';}catch(_){}if(!stored)return stop('تعذّر حفظ حالة الفتح بأمان. التطبيق متوقف.');observe(()=>view?.close());active=false;const target=new URL(env.location.href);target.searchParams.set('__gateway','app');env.location.replace(target.href);return {state:'navigating'};
 }
 return Object.freeze({start});
});
