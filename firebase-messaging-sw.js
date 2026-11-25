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
const GW_SHELL = {"bridgeSHA256":"e45cbe163619c1739d8459fe869e46eb800703fe8ed812188bb8e5ceec3c908a","engine":"dff0ff0e7728e85fef092238914f06846abd0eafbd5d749352660058d1c3a341","schema":1,"shellSHA256":"90f4dbf0b3ad914244ec7ec946ebf2977df9cdbb8e794f1d0cd3cdf25f23dfc9","static":{"gateway-shell.css":{"contentType":"text/css","sha256":"a6d4894610d409e94544757502926b7e778c51f253bdf6affdba8b5bc0a29afc"},"images/app-icon-maskable.png":{"contentType":"image/png","sha256":"f7fece25d75098842f0802ba30df6e798fe16a02d0f7c1caf57d0d2ca21c7678"},"images/app-icon.png":{"contentType":"image/png","sha256":"7a31959e2a67430983286c6f42427fb42be17e6b9794f3555d3c47a460127967"},"manifest.json":{"contentType":"application/json","sha256":"36b25dcc5b12882779c1d32a0eb58b7c4ace0624914cfe1169e9e58f8bcf02d1"}},"version":"fast-trusted-cache-v2"};
const GW = {protocol:1,db:'bis-gateway-2-'+GW_SHELL.engine,prefix:'bis-gateway-2-'+GW_SHELL.engine+'-',queue:Promise.resolve(),background:null};
const GW_LIMITS={io:8000,network:10000,total:90000,channel:16384,manifest:524288,resource:4194304,generation:33554432,resources:512};
function gwAttempt(ms=GW_LIMITS.total){const a={id:crypto.randomUUID(),end:Date.now()+ms,dead:false,controllers:new Set()};a.check=()=>{if(a.dead||Date.now()>=a.end)throw Error('deadline');};a.cancel=()=>{a.dead=true;for(const c of a.controllers)c.abort();};return a;}
function gwBound(work,ms=GW_LIMITS.io,a){return new Promise((resolve,reject)=>{let done=false;const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);fn(value);};const timer=setTimeout(()=>{if(a)a.cancel();finish(reject,Error('deadline'));},Math.max(1,Math.min(ms,a?a.end-Date.now():ms)));Promise.resolve().then(()=>{if(a)a.check();return typeof work==='function'?work():work;}).then(v=>{try{if(a)a.check();finish(resolve,v);}catch(e){finish(reject,e);}},e=>finish(reject,e));});}
const gwURL = key => new URL(key,self.registration.scope).href;
function gwDB(){return new Promise((resolve,reject)=>{const q=indexedDB.open(GW.db,1);let expired=false;const timer=setTimeout(()=>{expired=true;reject(Error('metadata timeout'));},GW_LIMITS.io);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('records'))q.result.createObjectStore('records');};q.onsuccess=()=>{clearTimeout(timer);if(expired)q.result.close();else resolve(q.result);};q.onerror=()=>{clearTimeout(timer);reject(q.error);};q.onblocked=()=>{clearTimeout(timer);expired=true;reject(Error('metadata blocked'));};});}
async function gwRead(key){const db=await gwDB();try{return await gwBound(()=>new Promise((resolve,reject)=>{const tx=db.transaction('records');const q=tx.objectStore('records').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);}));}finally{db.close();}}
async function gwWrite(entries,a){if(a)a.check();const db=await gwDB();try{if(a)a.check();await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');let settled=false;const finish=(fn,v)=>{if(settled)return;settled=true;clearTimeout(timer);fn(v);};const timer=setTimeout(()=>{try{tx.abort();}catch(_){}if(a)a.cancel();finish(reject,Error('metadata deadline'));},Math.max(1,Math.min(GW_LIMITS.io,a?a.end-Date.now():GW_LIMITS.io)));try{if(a)a.check();for(const [key,value]of entries)tx.objectStore('records').put(value,key);}catch(e){tx.abort();finish(reject,e);}tx.oncomplete=()=>finish(resolve);tx.onerror=()=>finish(reject,tx.error);tx.onabort=()=>finish(reject,tx.error||Error('metadata aborted'));});}finally{db.close();}}
async function gwSelections(){const db=await gwDB();try{return await gwBound(()=>new Promise((resolve,reject)=>{const q=db.transaction('records').objectStore('records').openCursor(IDBKeyRange.bound('selection:','selection;'));const rows=[];q.onsuccess=()=>{const c=q.result;if(!c)return resolve(rows.sort((a,b)=>b.epoch-a.epoch).slice(0,5));rows.push(c.value);c.continue();};q.onerror=()=>reject(q.error);}));}finally{db.close();}}
async function gwHash(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
function gwKey(key){if(typeof key!=='string'||!key||key.startsWith('/')||key.includes('\\')||/%2f|%5c|%00/i.test(key))throw Error('unsafe key');const u=new URL(key,self.registration.scope);if(u.origin!==self.location.origin||!u.href.startsWith(self.registration.scope)||u.hash||u.pathname!==new URL(encodeURI(decodeURI(u.pathname)),u).pathname)throw Error('unsafe key');return u.pathname.slice(new URL(self.registration.scope).pathname.length)+u.search;}
function gwValidate(m){
 if(!m||m.schema!==1||m.gatewayProtocol!==1||!/^[a-f0-9]{64}$/.test(m.generation)||m.status!=='release-candidate-local'||!Array.isArray(m.resources)||!m.resources.length||m.resources.length>GW_LIMITS.resources)throw Error('invalid manifest');
 let total=0;const keys=new Set();for(const r of m.resources){if(r.size>GW_LIMITS.resource||(total+=r.size)>GW_LIMITS.generation)throw Error('release size limit');if(gwKey(r.requestKey)!==r.requestKey||keys.has(r.requestKey)||!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isSafeInteger(r.size)||r.size<0||typeof r.contentType!=='string'||!['document','asset'].includes(r.role)||r.required!==true)throw Error('invalid resource');keys.add(r.requestKey);const path=r.requestKey.split('?')[0];if(r.backing!=='release/'+m.generation+'/'+path||gwKey(r.backing)!==r.backing)throw Error('invalid backing');if(r.headers&&Object.keys(r.headers).some(k=>!['Cache-Control','X-Content-Type-Options'].includes(k)))throw Error('unsupported headers');}
 if(!keys.has(m.entry)||m.entry!=='index.html'||m.resources.find(r=>r.requestKey===m.entry).role!=='document')throw Error('invalid entry');return m;
}
function gwMime(value){const type=(value||'').split(';')[0].trim().toLowerCase();return ['application/javascript','text/javascript'].includes(type)?'text/javascript':type;}
function gwVary(headers){if(!headers.has('vary'))return true;const tokens=headers.get('vary').split(',').map(x=>x.trim().toLowerCase());return tokens.length>0&&tokens.every(x=>x==='accept-encoding');}
async function gwNetwork(url,a=gwAttempt(),limit=GW_LIMITS.resource){const c=new AbortController();a.controllers.add(c);try{return await gwBound(async()=>{const r=await fetch(url,{cache:'no-store',redirect:'error',credentials:'same-origin',signal:c.signal});if(r.status!==200||r.redirected||r.type==='opaque'||!gwVary(r.headers)||r.headers.has('content-range'))throw Error('invalid response');if(Number(r.headers.get('content-length'))>limit)throw Error('response size limit');const reader=r.body&&r.body.getReader();if(!reader)throw Error('missing body');const chunks=[];let size=0;try{for(;;){a.check();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw Error('response size limit');chunks.push(part.value);}}catch(e){reader.cancel().catch(()=>{});throw e;}a.check();const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new Response(bytes,{status:200,headers:r.headers});},GW_LIMITS.network,a);}finally{c.abort();a.controllers.delete(c);}}
function gwShellConfig(){if(!GW_SHELL||GW_SHELL.schema!==1||!['engine','shellSHA256','bridgeSHA256'].every(k=>/^[a-f0-9]{64}$/.test(GW_SHELL[k]||'')))throw Error('unbound shell identity');return GW_SHELL;}
function gwShellCache(){return GW.prefix+'bootstrap-'+gwShellConfig().engine;}
async function gwInstallShell(a=gwAttempt()){const identity=gwShellConfig(),verified=[];for(const [key,hash,mime]of [['index.html',identity.shellSHA256,'text/html'],['bootstrap-bridge.js',identity.bridgeSHA256,'text/javascript']]){const response=await gwNetwork(gwURL(key),a);if(gwMime(response.headers.get('content-type'))!==mime)throw Error('shell MIME');const bytes=await response.arrayBuffer();if(await gwHash(bytes)!==hash)throw Error('shell integrity');verified.push([key,bytes,mime]);}for(const [key,record]of Object.entries(identity.static||{})){if(!['gateway-shell.css','manifest.json','images/app-icon.png','images/app-icon-maskable.png'].includes(key)||!/^[a-f0-9]{64}$/.test(record.sha256))throw Error('invalid shell asset');const response=await gwNetwork(gwURL(key),a);if(gwMime(response.headers.get('content-type'))!==record.contentType)throw Error('shell asset MIME');const bytes=await response.arrayBuffer();if(await gwHash(bytes)!==record.sha256)throw Error('shell asset integrity');verified.push([key,bytes,record.contentType]);}const cache=await gwBound(()=>caches.open(gwShellCache()),GW_LIMITS.io,a);for(const [key,bytes,mime]of verified)await gwBound(()=>cache.put(gwURL(key),new Response(bytes,{headers:{'Content-Type':mime}})),GW_LIMITS.io,a);}
async function gwShellResponse(key,mime){const identity=gwShellConfig(),cache=await caches.open(gwShellCache()),response=await cache.match(gwURL(key));if(!response)throw Error('bootstrap unavailable');const bytes=await response.arrayBuffer();if(await gwHash(bytes)!==(key==='index.html'?identity.shellSHA256:key==='bootstrap-bridge.js'?identity.bridgeSHA256:identity.static&&identity.static[key]&&identity.static[key].sha256))throw Error('cached shell integrity');return new Response(bytes,{headers:{'Content-Type':mime,'Cache-Control':'no-store'}});} 
async function gwBody(cache,r){const response=await cache.match(gwURL(r.requestKey));if(!response)throw Error('pinned body missing');const bytes=await response.arrayBuffer();if(bytes.byteLength!==r.size||await gwHash(bytes)!==r.sha256)throw Error('body integrity');return bytes;}
async function gwDescriptor(generation){const descriptor=await gwRead('generation:'+generation);if(descriptor&&descriptor.engine!==GW_SHELL.engine)throw Error('engine mismatch');if(!descriptor)throw Error('generation unavailable');if(!(descriptor.manifestRaw instanceof ArrayBuffer)||!/^[a-f0-9]{64}$/.test(descriptor.manifestSHA256||'')||await gwHash(descriptor.manifestRaw)!==descriptor.manifestSHA256)throw Error('manifest metadata integrity');const manifest=gwValidate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(descriptor.manifestRaw)));if(manifest.generation!==generation)throw Error('descriptor generation mismatch');return {...descriptor,manifest};}
async function gwVerified(generation,full=false,a){const descriptor=await gwDescriptor(generation);if(!descriptor.verified||descriptor.verified.manifestSHA256!==descriptor.manifestSHA256||descriptor.verified.protocol!==GW.protocol)throw Error('verification record missing');if(!full)return descriptor;const cache=await gwBound(()=>caches.open(descriptor.cacheName));for(const r of descriptor.manifest.resources)await gwBound(()=>gwBody(cache,r),GW_LIMITS.io,a);return descriptor;}
async function gwUpdate(a=gwAttempt()){
 a.check();
 const channel=await(await gwNetwork(gwURL('release-channel.json'),a,GW_LIMITS.channel)).json();
 if(channel.schema!==1||!Number.isSafeInteger(channel.epoch)||channel.epoch<1||!/^[a-f0-9]{64}$/.test(channel.generation)||!/^[a-f0-9]{64}$/.test(channel.manifestSHA256)||channel.manifest!=='manifests/'+channel.generation+'.json'||typeof channel.rollback!=='boolean')throw Error('invalid channel');
 const current=await gwRead('selected');if(current&&channel.epoch<current.epoch)return {state:'stale',generation:current.generation};
 if(current&&channel.epoch===current.epoch){if(channel.generation!==current.generation||channel.manifestSHA256!==current.manifestSHA256)throw Error('epoch conflict');try{await gwVerified(current.generation,true,a);return {state:'ready',generation:current.generation};}catch(_){a.check();}}
 const raw=await(await gwNetwork(gwURL(channel.manifest),a,GW_LIMITS.manifest)).arrayBuffer();if(await gwHash(raw)!==channel.manifestSHA256)throw Error('manifest integrity');const m=gwValidate(JSON.parse(new TextDecoder().decode(raw)));if(m.generation!==channel.generation)throw Error('generation mismatch');
 const known=await gwRead('generation:'+m.generation);if(known&&known.manifestSHA256!==channel.manifestSHA256)throw Error('immutable generation conflict');if(await gwRead('ever-selected:'+m.generation)&&current&&current.generation!==m.generation&&!channel.rollback)throw Error('rollback flag required');
 const cacheName=GW.prefix+m.generation+'-'+a.id;const cache=await gwBound(()=>caches.open(cacheName),GW_LIMITS.io,a);
 for(const r of m.resources){a.check();const response=await gwNetwork(gwURL(r.backing),a);if(gwMime(response.headers.get('content-type'))!==gwMime(r.contentType))throw Error('wrong MIME');const bytes=await response.arrayBuffer();if(bytes.byteLength!==r.size||await gwHash(bytes)!==r.sha256)throw Error('asset integrity');await gwBound(()=>cache.put(gwURL(r.requestKey),new Response(bytes,{headers:{'Content-Type':r.contentType}})),GW_LIMITS.io,a);}
 a.check();for(const r of m.resources)await gwBound(()=>gwBody(cache,r),GW_LIMITS.io,a);const descriptor={engine:GW_SHELL.engine,cacheName,manifestRaw:raw,manifestSHA256:channel.manifestSHA256,verified:{manifestSHA256:channel.manifestSHA256,protocol:GW.protocol}};
 const selection={epoch:channel.epoch,generation:m.generation,manifestSHA256:channel.manifestSHA256};a.check();await gwWrite([['generation:'+m.generation,descriptor],['selection:'+channel.epoch,selection],['ever-selected:'+m.generation,true],['selected',selection]],a);return {state:'ready',generation:m.generation};
}
function gwSerial(action){const run=GW.queue.then(action);GW.queue=run.catch(()=>{});return run;}
async function gwStatus(){const selected=await gwRead('selected');if(!selected)return {state:'unavailable',reason:'NO_SELECTION'};await gwVerified(selected.generation);return {state:'verified',generation:selected.generation,epoch:selected.epoch};}
self.addEventListener('message',event=>{
 const data=event.data,client=event.source,port=event.ports&&event.ports[0];if(!data||data.protocol!==1||!['BIS_GATEWAY_STATUS','BIS_GATEWAY_CHECK'].includes(data.type)||!port||!client||!client.id||!client.url||!client.url.startsWith(self.registration.scope))return;
 event.waitUntil((async()=>{try{const a=gwAttempt();const result=await gwBound(()=>data.type==='BIS_GATEWAY_CHECK'?gwSerial(()=>gwUpdate(a)):gwStatus(),GW_LIMITS.total,a);port.postMessage({type:data.type,protocol:1,...result});}catch(error){port.postMessage({type:data.type,protocol:1,state:'unavailable',reason:String(error.message)});}})());
});
self.addEventListener('install',event=>{const a=gwAttempt();event.waitUntil(gwBound(()=>gwInstallShell(a),GW_LIMITS.total,a));});
// No skipWaiting,clients.claim or deletion of legacy/user data.
self.addEventListener('activate',event=>{event.waitUntil(Promise.resolve());});
function gwFailure(){return new Response('التطبيق متوقف. اقفل كل تبويبات الموقع ونوافذ التطبيق وافتحه من جديد.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});}
function gwBackground(event){if(!GW.background){const a=gwAttempt();GW.background=gwBound(()=>gwSerial(()=>gwUpdate(a)),GW_LIMITS.total,a).catch(()=>null).finally(()=>{GW.background=null;});}event.waitUntil(GW.background);}
async function gwTrustedDocument(event,a){
 a.check();
 if(!event.resultingClientId)throw Error('no resulting client');
 const chosen=await gwRead('selected');const candidates=[];if(chosen)candidates.push(chosen);
 let fallback=false;
 for(let pass=0;pass<2;pass++){
  if(pass){candidates.splice(0,candidates.length,...(await gwSelections()).filter(s=>!chosen||s.generation!==chosen.generation));fallback=true;}
  for(const selection of candidates){let descriptor,response;try{
   descriptor=await gwVerified(selection.generation,fallback,a);if(descriptor.manifestSHA256!==selection.manifestSHA256||!await gwRead('ever-selected:'+selection.generation))throw Error('untrusted selection');
   const cache=await gwBound(()=>caches.open(descriptor.cacheName),GW_LIMITS.io,a);const r=descriptor.manifest.resources.find(r=>r.requestKey==='index.html');const bytes=await gwBound(()=>gwBody(cache,r),GW_LIMITS.io,a);
   response=new Response(bytes,{headers:{'Content-Type':r.contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch(_){a.check();continue;}
   a.check();await gwWrite([['pin:'+event.resultingClientId,selection.generation]],a);gwBackground(event);return response;
  }
 }
 return null;
}
async function gwFetch(event,key,a){
 if(event.request.headers.has('range'))throw Error('range unsupported');
 const url=new URL(event.request.url);const root=url.pathname===new URL(self.registration.scope).pathname||url.pathname===new URL('index.html',self.registration.scope).pathname;
 if(root&&event.request.mode==='navigate'){
  const result=await gwTrustedDocument(event,a);
  if(result)return result;
  return gwBound(()=>gwShellResponse('index.html','text/html'));
 }
 if(key==='bootstrap-bridge.js')return gwShellResponse(key,'text/javascript');
 if(GW_SHELL.static&&Object.prototype.hasOwnProperty.call(GW_SHELL.static,key))return gwShellResponse(key,GW_SHELL.static[key].contentType);
 let pin;
 const selectedDocument=event.request.mode==='navigate'&&!root;
 if((root&&event.request.mode==='navigate'&&url.searchParams.get('__gateway')==='app')||selectedDocument){
  if(!event.resultingClientId)throw Error('no resulting client');const selected=await gwRead('selected');if(!selected)throw Error('no selection');await gwVerified(selected.generation);pin=selected.generation;a.check();await gwWrite([['pin:'+event.resultingClientId,pin]],a);if(root)key='index.html';
 }else pin=event.clientId&&await gwRead('pin:'+event.clientId);
 if(!pin){if(!event.request.destination&&event.request.mode!=='navigate'){const selected=await gwRead('selected');const descriptor=selected&&await gwVerified(selected.generation);if(descriptor&&!descriptor.manifest.resources.some(r=>r.requestKey.split('?')[0]===key.split('?')[0]))return fetch(event.request);}throw Error('no client pin');}const descriptor=await gwVerified(pin);const m=descriptor.manifest;const resource=m.resources.find(r=>r.requestKey===key);
 if(!resource){if(event.request.destination||event.request.mode==='navigate'||m.resources.some(r=>r.requestKey.split('?')[0]===key.split('?')[0]))throw Error('undeclared critical request');return fetch(event.request);}
 const cache=await gwBound(()=>caches.open(descriptor.cacheName),GW_LIMITS.io,a);const bytes=await gwBound(()=>gwBody(cache,resource),GW_LIMITS.io,a);return new Response(bytes,{status:200,headers:{'Content-Type':resource.contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
// Runtime user media is outside distribution deadlines; no selection/pin writes.
// Legacy media is read-only. A media cache failure must not block release selection.
async function gwMedia(request){
 const cache=await caches.open('bis-gateway-media-1');let cached=await cache.match(request);
 if(!cached&&(await caches.keys()).includes('bariq-media-v57'))cached=await(await caches.open('bariq-media-v57')).match(request);
 if(cached)return cached;
 const response=await fetch(request);
 if(response.status===200||response.type==='opaque'){try{await cache.put(request,response.clone());}catch(_){/* Quota must not discard a successful network response. */}}
 return response;
}
self.addEventListener('fetch',event=>{const request=event.request,url=new URL(request.url);if(request.method==='GET'&&['res.cloudinary.com','firebasestorage.googleapis.com'].includes(url.hostname)){event.respondWith(gwBound(()=>gwMedia(request),15000).catch(()=>gwFailure()));return;}if(request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;const key=url.pathname.slice(new URL(self.registration.scope).pathname.length)+url.search;const a=gwAttempt(15000),pending=[];let finishLifetime;const lifetime=new Promise(resolve=>{finishLifetime=resolve;});event.waitUntil(lifetime);const context={request,clientId:event.clientId,resultingClientId:event.resultingClientId,waitUntil:promise=>pending.push(promise)};const response=gwBound(()=>gwFetch(context,key,a),15000,a).catch(()=>gwFailure());event.respondWith(response);response.finally(()=>finishLifetime(Promise.allSettled(pending)));});
