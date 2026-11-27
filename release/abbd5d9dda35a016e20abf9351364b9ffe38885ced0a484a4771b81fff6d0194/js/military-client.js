/* Military SQL transport, bounded snapshot reads and constant-only Postgres Changes invalidations. No Firestore dependency. */
(function(){'use strict';if(window.MilitarySQL)return;
const ROOT='https://bliss-gateway.cairohbis.workers.dev/v1/military/';let joinRef=null,socket=null,heartbeat=null,retry=null,refs=0,stopped=true,lastEmit=0,debounce=null;const subs=new Set();
const enabled=()=>window.__BLISS_MILITARY_MODE==='supabase';
const uidNow=()=>window.currentUser?.uid||null;
async function request(op,{method='GET',body}={}){
 const user=window.currentUser;if(!user)throw Error('military-signed-out');const uid=user.uid,token=await user.getIdToken(),url=new URL(ROOT+op);
 if(uidNow()!==uid)throw Error('military-account-changed');
 const r=await fetch(url,{method,cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({}));
 if(uidNow()!==uid)throw Error('military-account-changed');
 if(!r.ok)throw Object.assign(Error('military-http'),{status:r.status,code:j.error});
 if(j.source!=='supabase'||j.complete!==true||!j.data)throw Error('military-invalid-payload');return j.data;
}
/* Firestore-snapshot-shaped result so the module needs minimal changes. pinnedAt keeps toMillis() for the existing sort. */
function snapshot(data){
 if(!Array.isArray(data.items)||data.items.length>500||data.items.some(x=>!x.payload||typeof x.payload!=='object'))throw Error('military-response');
 const docs=data.items.map(x=>{const pin=x.pinned_at?Date.parse(x.pinned_at):null;return{id:x.id,data:()=>({...x.payload,sortOrder:Number(x.sort_order)||0,pinnedAt:pin?{toMillis:()=>pin}:null,createdAt:{toMillis:()=>Date.parse(x.created_at)},createdBy:x.updated_by,__revision:x.revision})}});
 return{docs,size:docs.length,empty:!docs.length,forEach:f=>docs.forEach(f),metadata:{fromCache:false,hasPendingWrites:false},viewToken:data.viewToken};
}
const inflight=new Map();const tokens=new Map();
function list(uid){
 if(!uid||uidNow()!==uid)return Promise.reject(Error('military-context'));
 if(inflight.has(uid))return inflight.get(uid);
 const p=request('list').then(d=>{if(uidNow()!==uid)throw Error('military-account-changed');const s=snapshot(d);tokens.set(uid,s.viewToken);return s}).finally(()=>{if(inflight.get(uid)===p)inflight.delete(uid)});
 inflight.set(uid,p);return p;
}
function subscribe(uid,next,error){
 let live=true,gen=0,loading=false,queued=false;
 const valid=()=>live&&uidNow()===uid;
 const load=async()=>{if(!valid())return;if(loading){queued=true;return}loading=true;const g=++gen;try{const s=await list(uid);if(valid()&&g===gen)next(s)}catch(e){if(valid()&&g===gen&&!/account-changed|context/.test(String(e.message)))error?.(e)}finally{loading=false;if(queued){queued=false;void load()}}};
 const f=()=>void load();subs.add(f);stopped=false;connect();void load();
 return()=>{live=false;subs.delete(f);tokens.delete(uid);if(!subs.size){stopped=true;disconnect();if(debounce)clearTimeout(debounce);debounce=null}};
}
async function mutate(action,{id,data,revision}){
 if(!uidNow())throw Error('military-context');
 const result=await request('mutate',{method:'POST',body:{action,id:id||crypto.randomUUID().replace(/-/g,''),data:data??{},expectedRevision:revision??null,requestId:crypto.randomUUID()}});
 emit(true);window.dispatchEvent(new Event('military-changed'));return result;
}
const create=data=>mutate('create',{data});
const update=(id,data,revision)=>mutate('update',{id,data,revision});
const remove=(id,revision)=>mutate('delete',{id,revision});
let badgeSig=null,badgeGen=0;
async function refreshBadge(){const uid=uidNow();if(!enabled()||!uid||document.hidden)return;const g=badgeGen;try{const d=await request('badge');if(g===badgeGen&&uidNow()===uid)window.dispatchEvent(new CustomEvent('military-badge',{detail:{uid,count:d.count}}))}catch{}}
async function markViewed(uid){const t=tokens.get(uid);if(!t)return;try{await request('read',{method:'POST',body:{viewToken:t}});tokens.delete(uid);void refreshBadge()}catch{}}
function syncBadge(){const uid=uidNow(),sig=enabled()&&uid?uid:null;if(sig===badgeSig)return;badgeSig=sig;badgeGen++;window.dispatchEvent(new CustomEvent('military-badge',{detail:{uid,count:0}}));if(sig){subs.add(refreshBadge);stopped=false;connect();void refreshBadge()}else{subs.delete(refreshBadge);if(!subs.size){stopped=true;disconnect()}}}
function emit(force){if(stopped||document.hidden)return;const wait=force?0:Math.max(0,5000-(Date.now()-lastEmit));if(debounce)return;debounce=setTimeout(()=>{debounce=null;lastEmit=Date.now();for(const f of [...subs]){try{f()}catch{}}},wait)}
function disconnect(){if(heartbeat)clearInterval(heartbeat);heartbeat=null;if(socket){socket.onclose=null;socket.close();socket=null}if(retry)clearTimeout(retry);retry=null}
function connect(){if(stopped||document.hidden||socket||!window.currentUser)return;const key=window.__BLISS_MILITARY_ANON_KEY;if(typeof key!=='string'||!key)return;
 socket=new WebSocket('wss://bazrgebdawkjcyufhanu.supabase.co/realtime/v1/websocket?apikey='+encodeURIComponent(key)+'&vsn=1.0.0');const ws=socket;
 ws.onopen=()=>{joinRef=String(++refs);ws.send(JSON.stringify({topic:'realtime:military-invalidation',event:'phx_join',payload:{config:{broadcast:{self:false},presence:{key:''},postgres_changes:[{event:'UPDATE',schema:'public',table:'military_signal'}]},access_token:key},ref:joinRef}));heartbeat=setInterval(()=>{if(ws.readyState===1)ws.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(++refs)}))},25000)};
 ws.onmessage=e=>{try{const j=JSON.parse(e.data);if(j.event==='phx_reply'&&j.ref===joinRef){if(j.payload?.status==='ok')emit();else if(j.payload?.status==='error')ws.close()}if(j.event==='phx_error'||j.event==='phx_close')ws.close();if(j.event==='postgres_changes'){const d=j.payload?.data;if(d?.schema==='public'&&d.table==='military_signal'&&d.type==='UPDATE'&&JSON.stringify(d.record)==='{"id":1}'&&JSON.stringify(d.old_record)==='{"id":1}')emit()}}catch{}};
 ws.onclose=()=>{if(socket!==ws)return;disconnect();if(!stopped&&!document.hidden)retry=setTimeout(connect,10000)};
 ws.onerror=()=>ws.close();
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnect();else{connect();emit();syncBadge()}});window.addEventListener('online',()=>{connect();emit()});
setInterval(syncBadge,800);
window.MilitarySQL={enabled,list,subscribe,create,update,remove,markViewed,request};
})();
