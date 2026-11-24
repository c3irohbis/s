// firebase-messaging-sw.js
// ══════════════════════════════════════════
// FCM Service Worker — Background & Closed-Tab Notifications
// + تخزين مؤقت لملفات الواجهة (App Shell) عشان الموقع يفتح بدون إنترنت
//
// DEPLOYMENT:
//   • Place this file in the SAME directory as index.html
//   • GitHub Pages: repo-root/ if index.html is at root, or docs/ if served from docs/
//   • Firebase Hosting: public/ root (firebase.json hosting.public)
//
// The JS in index.html registers this SW using a dynamic base path
// so it works on both GitHub Pages subdirs and Firebase Hosting root.
// ══════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyB538malKBKgsWO572c9uo4bOzzSGWFue8",
  authDomain:        "university-platform-dev.firebaseapp.com",
  projectId:         "university-platform-dev",
  storageBucket:     "university-platform-dev.firebasestorage.app",
  messagingSenderId: "665165296802",
  appId:             "1:665165296802:web:57aa1315497e48c25ad3fb"
});

const messaging = firebase.messaging();

// Background message handler (app in background or tab closed)
messaging.onBackgroundMessage(function(payload) {
  const data  = payload.data || {};
  const title = data.title || 'نظام الجامعة';
  const options = {
    body:               data.body || '',
    icon:               new URL('images/app-icon.png', self.registration.scope).href,
    badge:              new URL('images/app-icon.png', self.registration.scope).href,
    data:               data,
    dir:                'rtl',
    lang:               'ar',
    tag:                data.tag || 'uni-bg',
    requireInteraction: false,
  };
  return self.registration.showNotification(title, options);
});

// Notification click — focus existing tab or open app
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  // Resolve URL relative to SW location (handles GitHub Pages subdirs automatically)
  const appUrl = self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(appUrl);
    })
  );
});

// Distribution gateway1. FCM above is preserved;only this component owns release caches.
const GW_SHELL = {"bridgeSHA256":"0e8f58d1c477c85a94aa9a22f1bc78142e9941a2ca02047f8e2d0d59c08ed64b","engine":"50191cff35b365a6ce5dd0843557c6907becdec3d83d916c91a3112ad17e4588","schema":1,"shellSHA256":"90f4dbf0b3ad914244ec7ec946ebf2977df9cdbb8e794f1d0cd3cdf25f23dfc9","static":{"gateway-shell.css":{"contentType":"text/css","sha256":"a6d4894610d409e94544757502926b7e778c51f253bdf6affdba8b5bc0a29afc"},"images/app-icon-maskable.png":{"contentType":"image/png","sha256":"f7fece25d75098842f0802ba30df6e798fe16a02d0f7c1caf57d0d2ca21c7678"},"images/app-icon.png":{"contentType":"image/png","sha256":"7a31959e2a67430983286c6f42427fb42be17e6b9794f3555d3c47a460127967"},"manifest.json":{"contentType":"application/json","sha256":"36b25dcc5b12882779c1d32a0eb58b7c4ace0624914cfe1169e9e58f8bcf02d1"}},"version":"production"};
const GW = {protocol:1,db:'bis-gateway-1',prefix:'bis-gateway-1-',queue:Promise.resolve()};
const gwURL = key => new URL(key,self.registration.scope).href;
function gwDB(){return new Promise((resolve,reject)=>{const q=indexedDB.open(GW.db,1);q.onupgradeneeded=()=>q.result.createObjectStore('records');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function gwRead(key){const db=await gwDB();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('records');const q=tx.objectStore('records').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}finally{db.close();}}
async function gwWrite(entries){const db=await gwDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');for(const [key,value]of entries)tx.objectStore('records').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('metadata aborted'));});}finally{db.close();}}
async function gwHash(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
function gwKey(key){if(typeof key!=='string'||!key||key.startsWith('/')||key.includes('\\')||/%2f|%5c|%00/i.test(key))throw Error('unsafe key');const u=new URL(key,self.registration.scope);if(u.origin!==self.location.origin||!u.href.startsWith(self.registration.scope)||u.hash||u.pathname!==new URL(encodeURI(decodeURI(u.pathname)),u).pathname)throw Error('unsafe key');return u.pathname.slice(new URL(self.registration.scope).pathname.length)+u.search;}
function gwValidate(m){
 if(!m||m.schema!==1||m.gatewayProtocol!==1||!/^[a-f0-9]{64}$/.test(m.generation)||m.status!=='release-candidate-local'||!Array.isArray(m.resources)||!m.resources.length||m.resources.length>5000)throw Error('invalid manifest');
 const keys=new Set();for(const r of m.resources){if(gwKey(r.requestKey)!==r.requestKey||keys.has(r.requestKey)||!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isSafeInteger(r.size)||r.size<0||typeof r.contentType!=='string'||!['document','asset'].includes(r.role)||r.required!==true)throw Error('invalid resource');keys.add(r.requestKey);const path=r.requestKey.split('?')[0];if(r.backing!=='release/'+m.generation+'/'+path||gwKey(r.backing)!==r.backing)throw Error('invalid backing');if(r.headers&&Object.keys(r.headers).some(k=>!['Cache-Control','X-Content-Type-Options'].includes(k)))throw Error('unsupported headers');}
 if(!keys.has(m.entry)||m.entry!=='index.html'||m.resources.find(r=>r.requestKey===m.entry).role!=='document')throw Error('invalid entry');return m;
}
function gwMime(value){const type=(value||'').split(';')[0].trim().toLowerCase();return ['application/javascript','text/javascript'].includes(type)?'text/javascript':type;}
function gwVary(headers){if(!headers.has('vary'))return true;const tokens=headers.get('vary').split(',').map(x=>x.trim().toLowerCase());return tokens.length>0&&tokens.every(x=>x==='accept-encoding');}
async function gwNetwork(url){const r=await fetch(url,{cache:'no-store',redirect:'error',credentials:'same-origin'});if(r.status!==200||r.redirected||r.type==='opaque'||!gwVary(r.headers)||r.headers.has('content-range'))throw Error('invalid response');return r;}
function gwShellConfig(){if(!GW_SHELL||GW_SHELL.schema!==1||!['engine','shellSHA256','bridgeSHA256'].every(k=>/^[a-f0-9]{64}$/.test(GW_SHELL[k]||'')))throw Error('unbound shell identity');return GW_SHELL;}
function gwShellCache(){return GW.prefix+'bootstrap-'+gwShellConfig().engine;}
async function gwInstallShell(){const identity=gwShellConfig(),verified=[];for(const [key,hash,mime]of [['index.html',identity.shellSHA256,'text/html'],['bootstrap-bridge.js',identity.bridgeSHA256,'text/javascript']]){const response=await gwNetwork(gwURL(key));if(gwMime(response.headers.get('content-type'))!==mime)throw Error('shell MIME');const bytes=await response.arrayBuffer();if(await gwHash(bytes)!==hash)throw Error('shell integrity');verified.push([key,bytes,mime]);}for(const [key,record]of Object.entries(identity.static||{})){if(!['gateway-shell.css','manifest.json','images/app-icon.png','images/app-icon-maskable.png'].includes(key)||!/^[a-f0-9]{64}$/.test(record.sha256))throw Error('invalid shell asset');const response=await gwNetwork(gwURL(key));if(gwMime(response.headers.get('content-type'))!==record.contentType)throw Error('shell asset MIME');const bytes=await response.arrayBuffer();if(await gwHash(bytes)!==record.sha256)throw Error('shell asset integrity');verified.push([key,bytes,record.contentType]);}const cache=await caches.open(gwShellCache());for(const [key,bytes,mime]of verified)await cache.put(gwURL(key),new Response(bytes,{headers:{'Content-Type':mime}}));}
async function gwShellResponse(key,mime){const identity=gwShellConfig(),cache=await caches.open(gwShellCache()),response=await cache.match(gwURL(key));if(!response)throw Error('bootstrap unavailable');const bytes=await response.arrayBuffer();if(await gwHash(bytes)!==(key==='index.html'?identity.shellSHA256:key==='bootstrap-bridge.js'?identity.bridgeSHA256:identity.static&&identity.static[key]&&identity.static[key].sha256))throw Error('cached shell integrity');return new Response(bytes,{headers:{'Content-Type':mime,'Cache-Control':'no-store'}});} 
async function gwBody(cache,r){const response=await cache.match(gwURL(r.requestKey));if(!response)throw Error('pinned body missing');const bytes=await response.arrayBuffer();if(bytes.byteLength!==r.size||await gwHash(bytes)!==r.sha256)throw Error('body integrity');return bytes;}
async function gwDescriptor(generation){const descriptor=await gwRead('generation:'+generation);if(!descriptor)throw Error('generation unavailable');if(!(descriptor.manifestRaw instanceof ArrayBuffer)||!/^[a-f0-9]{64}$/.test(descriptor.manifestSHA256||'')||await gwHash(descriptor.manifestRaw)!==descriptor.manifestSHA256)throw Error('manifest metadata integrity');const manifest=gwValidate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(descriptor.manifestRaw)));if(manifest.generation!==generation)throw Error('descriptor generation mismatch');return {...descriptor,manifest};}
async function gwVerified(generation,full=false){const descriptor=await gwDescriptor(generation);if(!full){if(!descriptor.verified||descriptor.verified.manifestSHA256!==descriptor.manifestSHA256||descriptor.verified.protocol!==GW.protocol)throw Error('verification record missing');return descriptor;}const cache=await caches.open(GW.prefix+generation);for(const r of descriptor.manifest.resources)await gwBody(cache,r);descriptor.verified={manifestSHA256:descriptor.manifestSHA256,protocol:GW.protocol};await gwWrite([['generation:'+generation,descriptor]]);return descriptor;}
async function gwUpdate(){
 const channel=await(await gwNetwork(gwURL('release-channel.json'))).json();
 if(channel.schema!==1||!Number.isSafeInteger(channel.epoch)||channel.epoch<1||!/^[a-f0-9]{64}$/.test(channel.generation)||!/^[a-f0-9]{64}$/.test(channel.manifestSHA256)||channel.manifest!=='manifests/'+channel.generation+'.json'||typeof channel.rollback!=='boolean')throw Error('invalid channel');
 const current=await gwRead('selected');if(current&&channel.epoch<current.epoch)return {state:'stale',generation:current.generation};
 if(current&&channel.epoch===current.epoch){if(channel.generation!==current.generation||channel.manifestSHA256!==current.manifestSHA256)throw Error('epoch conflict');await gwVerified(current.generation);return {state:'ready',generation:current.generation};}
 const raw=await(await gwNetwork(gwURL(channel.manifest))).arrayBuffer();if(await gwHash(raw)!==channel.manifestSHA256)throw Error('manifest integrity');const m=gwValidate(JSON.parse(new TextDecoder().decode(raw)));if(m.generation!==channel.generation)throw Error('generation mismatch');
 const known=await gwRead('generation:'+m.generation);if(known&&known.manifestSHA256!==channel.manifestSHA256)throw Error('immutable generation conflict');if(await gwRead('ever-selected:'+m.generation)&&current&&current.generation!==m.generation&&!channel.rollback)throw Error('rollback flag required');
 const cache=await caches.open(GW.prefix+m.generation);
 for(const r of m.resources){const response=await gwNetwork(gwURL(r.backing));if(gwMime(response.headers.get('content-type'))!==gwMime(r.contentType))throw Error('wrong MIME');const bytes=await response.arrayBuffer();if(bytes.byteLength!==r.size||await gwHash(bytes)!==r.sha256)throw Error('asset integrity');await cache.put(gwURL(r.requestKey),new Response(bytes,{headers:{'Content-Type':r.contentType}}));}
 const descriptor={manifestRaw:raw,manifestSHA256:channel.manifestSHA256};await gwWrite([['generation:'+m.generation,descriptor]]);await gwVerified(m.generation,true);
 const selection={epoch:channel.epoch,generation:m.generation,manifestSHA256:channel.manifestSHA256};await gwWrite([['selection:'+channel.epoch,selection],['ever-selected:'+m.generation,true],['selected',selection]]);return {state:'ready',generation:m.generation};
}
function gwSerial(action){const run=GW.queue.then(action);GW.queue=run.catch(()=>{});return run;}
async function gwStatus(){const selected=await gwRead('selected');if(!selected)return {state:'unavailable',reason:'NO_SELECTION'};await gwVerified(selected.generation);return {state:'verified',generation:selected.generation,epoch:selected.epoch};}
self.addEventListener('message',event=>{
 const data=event.data,client=event.source,port=event.ports&&event.ports[0];if(!data||data.protocol!==1||!['BIS_GATEWAY_STATUS','BIS_GATEWAY_CHECK'].includes(data.type)||!port||!client||!client.id||!client.url||!client.url.startsWith(self.registration.scope))return;
 event.waitUntil((async()=>{try{const result=await(data.type==='BIS_GATEWAY_CHECK'?gwSerial(gwUpdate):gwStatus());port.postMessage({type:data.type,protocol:1,...result});}catch(error){port.postMessage({type:data.type,protocol:1,state:'unavailable',reason:String(error.message)});}})());
});
self.addEventListener('install',event=>{event.waitUntil(gwInstallShell());});
// No skipWaiting,clients.claim or deletion of legacy/user data.
self.addEventListener('activate',event=>{event.waitUntil(Promise.resolve());});
function gwFailure(){return new Response('التطبيق متوقف. اقفل كل تبويبات الموقع ونوافذ التطبيق وافتحه من جديد.',{status:503,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});}
async function gwFetch(event,key){
 if(event.request.headers.has('range'))throw Error('range unsupported');
 const url=new URL(event.request.url);const root=key===''||url.pathname===new URL('index.html',self.registration.scope).pathname;
 if(root&&url.searchParams.get('__gateway')!=='app'){
  return gwShellResponse('index.html','text/html');
 }
 if(key==='bootstrap-bridge.js')return gwShellResponse(key,'text/javascript');
 if(GW_SHELL.static&&Object.prototype.hasOwnProperty.call(GW_SHELL.static,key))return gwShellResponse(key,GW_SHELL.static[key].contentType);
 let pin;
 const selectedDocument=event.request.mode==='navigate'&&!root;
 if((root&&event.request.mode==='navigate'&&url.searchParams.get('__gateway')==='app')||selectedDocument){
  if(!event.resultingClientId)throw Error('no resulting client');const selected=await gwRead('selected');if(!selected)throw Error('no selection');await gwVerified(selected.generation);pin=selected.generation;await gwWrite([['pin:'+event.resultingClientId,pin]]);if(root)key='index.html';
 }else pin=event.clientId&&await gwRead('pin:'+event.clientId);
 if(!pin){if(!event.request.destination&&event.request.mode!=='navigate'){const selected=await gwRead('selected');const descriptor=selected&&await gwVerified(selected.generation);if(descriptor&&!descriptor.manifest.resources.some(r=>r.requestKey.split('?')[0]===key.split('?')[0]))return fetch(event.request);}throw Error('no client pin');}const descriptor=await gwVerified(pin);const m=descriptor.manifest;const resource=m.resources.find(r=>r.requestKey===key);
 if(!resource){if(event.request.destination||event.request.mode==='navigate'||m.resources.some(r=>r.requestKey.split('?')[0]===key.split('?')[0]))throw Error('undeclared critical request');return fetch(event.request);}
 const bytes=await gwBody(await caches.open(GW.prefix+pin),resource);return new Response(bytes,{status:200,headers:{'Content-Type':resource.contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
// Runtime media is separate from immutable releases;legacy media is read-only.
async function gwMedia(request){
 const cache=await caches.open('bis-gateway-media-1');let cached=await cache.match(request);
 if(!cached&&(await caches.keys()).includes('bariq-media-v57'))cached=await(await caches.open('bariq-media-v57')).match(request);
 if(cached)return cached;
 const response=await fetch(request);
 if(response.status===200||response.type==='opaque'){try{await cache.put(request,response.clone());}catch(_){/* Quota must not discard a successful network response. */}}
 return response;
}
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method==='GET'&&['res.cloudinary.com','firebasestorage.googleapis.com'].includes(url.hostname)){event.respondWith(gwMedia(request));return;}if(request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;const key=url.pathname.slice(new URL(self.registration.scope).pathname.length)+url.search;event.respondWith(gwFetch(event,key).catch(()=>gwFailure()));});
