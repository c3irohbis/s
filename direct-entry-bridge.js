/* Optional offline preparation. It never controls application readiness. */
(function(){'use strict';
 const scope=new URL('./',location.href);scope.search='';scope.hash='';
 function register(){if(!('serviceWorker'in navigator))return;Promise.resolve().then(()=>navigator.serviceWorker.register(new URL('firebase-messaging-sw.js',scope).href,{scope:scope.href,updateViaCache:'none'})).then(reg=>{const send=()=>{const worker=reg.active;if(worker)worker.postMessage({type:'BIS_OFFLINE_PREPARE',protocol:2,generation:document.querySelector('meta[name="bis-release"]')?.content});};if(reg.active)send();{const worker=reg.installing||reg.waiting;if(worker){const changed=()=>{if(worker.state==='activated'){worker.removeEventListener('statechange',changed);send();}else if(worker.state==='redundant')worker.removeEventListener('statechange',changed);};worker.addEventListener('statechange',changed);changed();}}}).catch(()=>{});}
 if(document.readyState==='complete')setTimeout(register,0);else addEventListener('load',register,{once:true});
 window._checkForUpdates=()=>{navigator.serviceWorker?.getRegistration(scope.href).then(reg=>reg?.update()).catch(()=>{});if(typeof window.toast==='function')window.toast('التحديثات بتتجهز في الخلفية. هتظهر عند الفتح الجاي.');};
})();
