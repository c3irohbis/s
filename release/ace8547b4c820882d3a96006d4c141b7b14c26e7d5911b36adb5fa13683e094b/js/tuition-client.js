/* Tuition SQL transport, bounded snapshot reads and constant-only Postgres Changes invalidations. No Firestore dependency. */
(function(){'use strict';if(window.TuitionSQL)return;
const ROOT='https://bliss-gateway.cairohbis.workers.dev/v1/tuition/';let joinRef=null,socket=null,heartbeat=null,retry=null,refs=0,stopped=true,lastEmit=0,debounce=null;const subs=new Set();
const uidNow=()=>window.currentUser?.uid||null;
const enabled=()=>window.__BLISS_TUITION_MODE==='supabase';
const ctx=()=>({uid:window.currentUser?.uid||null,world:window.currentUserWorldId?.()||null});
async function request(op,{method='GET',body,world}={}){
 const user=window.currentUser;if(!user)throw Error('tuition-signed-out');const uid=user.uid,contextWorld=window.currentUserWorldId?.(),token=await user.getIdToken(),url=new URL(ROOT+op);
 if(window.currentUser?.uid!==uid||window.currentUserWorldId?.()!==contextWorld)throw Error('tuition-account-changed');
 if(world)url.searchParams.set('world',world);
 const r=await fetch(url,{method,cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json().catch(()=>({}));
 if(window.currentUser?.uid!==uid||window.currentUserWorldId?.()!==contextWorld)throw Error('tuition-account-changed');
 if(!r.ok)throw Object.assign(Error('tuition-http'),{status:r.status,code:j.error});
 if(j.source!=='supabase'||j.complete!==true||!j.data)throw Error('tuition-invalid-payload');return j.data;
}
/* Firestore-snapshot-shaped result so schedule consumers need no changes. */
function snapshot(data,world){
 if(!Array.isArray(data.items)||data.items.length>16||data.items.some(x=>(world&&x.world_id!==world)||!/^(is|lt|th|ba)_[1-4]$/.test(x.world_id)||!x.payload||typeof x.payload!=='object'))throw Error('tuition-response');
 const docs=data.items.map(x=>({id:x.world_id,data:()=>({...x.payload,worldId:x.world_id,updatedBy:x.updated_by,__revision:x.revision})}));
 return{docs,size:docs.length,empty:!docs.length,forEach:f=>docs.forEach(f),metadata:{fromCache:false,hasPendingWrites:false},viewToken:data.viewToken};
}
/* One in-flight list per uid+world; a result is delivered only to callers whose uid+world still match. */
const inflight=new Map();const tokens=new Map();
function list(world,uid){
 const c=ctx();if(!uid||c.uid!==uid||(world&&c.world!==world))return Promise.reject(Error('tuition-context'));
 const key=uid+'|'+(world||'*');if(inflight.has(key))return inflight.get(key);
 const p=request('list',{world:world||undefined}).then(d=>{const n=ctx();if(n.uid!==uid||(world&&n.world!==world))throw Error('tuition-account-changed');const s=snapshot(d,world);tokens.set(key,s.viewToken);return s}).finally(()=>{if(inflight.get(key)===p)inflight.delete(key)});
 inflight.set(key,p);return p;
}
function subscribe(world,uid,next,error){
 let live=true,gen=0,loading=false,queued=false;const key=uid+'|'+(world||'*');
 const valid=()=>{const n=ctx();return live&&n.uid===uid&&(!world||n.world===world)};
 const load=async()=>{if(!valid())return;if(loading){queued=true;return}loading=true;const g=++gen;try{const s=await list(world,uid);if(valid()&&g===gen)next(s)}catch(e){if(valid()&&g===gen&&!/account-changed|context/.test(String(e.message)))error?.(e)}finally{loading=false;if(queued){queued=false;void load()}}};
 const f=()=>void load();subs.add(f);stopped=false;connect();void load();
 return()=>{live=false;subs.delete(f);tokens.delete(key);if(!subs.size){stopped=true;disconnect();if(debounce)clearTimeout(debounce);debounce=null}};
}
async function mutate(action,{world,data,revision}){
 if(!uidNow()||!/^(is|lt|th|ba)_[1-4]$/.test(world||''))throw Error('tuition-context');
 const result=await request('mutate',{method:'POST',body:{world,action,data:data??{},expectedRevision:revision??null,requestId:crypto.randomUUID()}});
 emit(true);window.dispatchEvent(new Event('tuition-changed'));return result;
}
const save=(world,data,revision)=>mutate('set',{world,data,revision});
const remove=(world,revision)=>mutate('delete',{world,revision});
/* Badge: counts new rows; marking read uses the server-issued ticket of the list the user actually viewed. */
let badgeSig=null,badgeGen=0;
async function refreshBadge(){const c=ctx();if(!enabled()||!c.uid||!c.world||document.hidden)return;const g=badgeGen;try{const d=await request('badge',{world:c.world});const n=ctx();if(g===badgeGen&&n.uid===c.uid&&n.world===c.world)window.dispatchEvent(new CustomEvent('tuition-badge',{detail:{uid:c.uid,world:c.world,count:d.count}}))}catch{}}
async function markViewed(world,uid){const key=uid+'|'+(world||'*'),t=tokens.get(key);if(!t)return;try{await request('read',{method:'POST',body:{world:window.currentUserWorldId?.(),viewToken:t}});tokens.delete(key);void refreshBadge()}catch{}}
function syncBadge(){const c=ctx(),sig=enabled()&&c.uid&&c.world?c.uid+'|'+c.world:null;if(sig===badgeSig)return;badgeSig=sig;badgeGen++;window.dispatchEvent(new CustomEvent('tuition-badge',{detail:{uid:c.uid,world:c.world,count:0}}));if(sig){subs.add(refreshBadge);stopped=false;connect();void refreshBadge()}else{subs.delete(refreshBadge);if(!subs.size){stopped=true;disconnect()}}}
function emit(force){if(stopped||document.hidden)return;const wait=force?0:Math.max(0,5000-(Date.now()-lastEmit));if(debounce)return;debounce=setTimeout(()=>{debounce=null;lastEmit=Date.now();for(const f of [...subs]){try{f()}catch{}}},wait)}
function disconnect(){if(heartbeat)clearInterval(heartbeat);heartbeat=null;if(socket){socket.onclose=null;socket.close();socket=null}if(retry)clearTimeout(retry);retry=null}
function connect(){if(stopped||document.hidden||socket||!window.currentUser)return;const key=window.__BLISS_TUITION_ANON_KEY;if(typeof key!=='string'||!key)return;
 socket=new WebSocket('wss://bazrgebdawkjcyufhanu.supabase.co/realtime/v1/websocket?apikey='+encodeURIComponent(key)+'&vsn=1.0.0');const ws=socket;
 ws.onopen=()=>{joinRef=String(++refs);ws.send(JSON.stringify({topic:'realtime:tuition-invalidation',event:'phx_join',payload:{config:{broadcast:{self:false},presence:{key:''},postgres_changes:[{event:'UPDATE',schema:'public',table:'tuition_signal'}]},access_token:key},ref:joinRef}));heartbeat=setInterval(()=>{if(ws.readyState===1)ws.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(++refs)}))},25000)};
 ws.onmessage=e=>{try{const j=JSON.parse(e.data);if(j.event==='phx_reply'&&j.ref===joinRef){if(j.payload?.status==='ok')emit();else if(j.payload?.status==='error')ws.close()}if(j.event==='phx_error'||j.event==='phx_close')ws.close();if(j.event==='postgres_changes'){const d=j.payload?.data;if(d?.schema==='public'&&d.table==='tuition_signal'&&d.type==='UPDATE'&&JSON.stringify(d.record)==='{"id":1}'&&JSON.stringify(d.old_record)==='{"id":1}')emit()}}catch{}};
 ws.onclose=()=>{if(socket!==ws)return;disconnect();if(!stopped&&!document.hidden)retry=setTimeout(connect,10000)};
 ws.onerror=()=>ws.close();
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnect();else{connect();emit();syncBadge()}});window.addEventListener('online',()=>{connect();emit()});
setInterval(syncBadge,800);
window.TuitionSQL={enabled,list,subscribe,save,remove,markViewed,request};
})();
