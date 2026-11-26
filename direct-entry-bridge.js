/* Optional offline preparation. It never controls application readiness. */
(function(){'use strict';
 const scope=new URL('./',location.href);scope.search='';scope.hash='';
 function register(){if(!('serviceWorker'in navigator))return;Promise.resolve().then(()=>navigator.serviceWorker.register(new URL('firebase-messaging-sw.js',scope).href,{scope:scope.href,updateViaCache:'none'})).then(reg=>{const send=()=>{const worker=reg.active;if(worker)worker.postMessage({type:'BIS_OFFLINE_PREPARE',protocol:2,generation:document.querySelector('meta[name="bis-release"]')?.content});};if(reg.active)send();{const worker=reg.installing||reg.waiting;if(worker){const changed=()=>{if(worker.state==='activated'){worker.removeEventListener('statechange',changed);send();}else if(worker.state==='redundant')worker.removeEventListener('statechange',changed);};worker.addEventListener('statechange',changed);changed();}}}).catch(()=>{});}
 if(document.readyState==='complete')setTimeout(register,0);else addEventListener('load',register,{once:true});
 /* Manual update check: one cache-bypassing request for the published entry page, compared with the running one. No database reads, no user announcement, no stored state. */
 let checking=false;
 const say=(m,t)=>{if(typeof window.toast==='function')window.toast(m,t);};
 const meta=h=>(/<meta[^>]+name=["']bis-release["'][^>]*>/i.exec(h)||[''])[0],content=t=>(/content=["']([a-f0-9]{64})["']/.exec(t)||[])[1]||'';
 const base=h=>(/<base[^>]+href=["']([^"']+)["']/i.exec(h)||[])[1]||'';
 function unsafe(){try{if(window.BisCalls?.isActive?.())return true;if(document.querySelector?.('.upload-progress-card.uploading'))return true;const a=document.activeElement;if(a&&(a.isContentEditable?String(a.textContent||'').trim().length:String(a.value||'').length))return true;for(const f of document.querySelectorAll?.('input[type=file],textarea')||[])if((f.files?.length)||(f.tagName==='TEXTAREA'&&String(f.value||'').length))return true;}catch(_){}return false;}
 window._checkForUpdates=async function(){
  if(checking)return;checking=true;
  try{
   if(navigator.onLine===false)throw Error('offline');
   const here=new URL(location.href);here.search='';here.hash='';
   const ctl=typeof AbortController==='function'?new AbortController():null,timer=setTimeout(()=>ctl?.abort(),8000);
   let res;try{res=await fetch(here.href,{cache:'reload',signal:ctl?.signal,credentials:'omit'});}finally{clearTimeout(timer);}
   if(!res.ok||res.redirected||(res.url&&new URL(res.url).origin!==location.origin))throw Error('unexpected response');
   const html=await res.text(),newGen=content(meta(html)),newBase=base(html);
   if(!newGen||!newBase)throw Error('entry unreadable');
   const curGen=document.querySelector('meta[name="bis-release"]')?.content||'',curBase=new URL(document.querySelector('base')?.getAttribute('href')||'',here).pathname;
   if(newGen===curGen&&new URL(newBase,here).pathname===curBase){say('مفيش تحديثات','info');return;}
   if(unsafe()){say('في تحديث جديد. هيتطبق أول ما تخلص المكالمة أو تحفظ شغلك. اضغط التحديثات تاني.','info');return;}
   say('لقيت تحديث جديد، بنطبقه دلوقتي...','success');
   const next=new URL(here.href);next.searchParams.set('_refresh',Date.now().toString(36));
   setTimeout(()=>{if(unsafe()){say('في تحديث جديد. هيتطبق أول ما تخلص المكالمة أو تحفظ شغلك. اضغط التحديثات تاني.','info');return;}location.replace(next.href);},400);
  }catch(_){say('تعذر التحقق من التحديثات، جرّب مرة أخرى.','error');}
  finally{checking=false;}
 };
})();
