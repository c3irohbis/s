/* News transport: authenticated RPC and constant-only Postgres Changes invalidations. */
(function(){'use strict';if(window.NewsAPI)return;
const ROOT='https://bliss-gateway.cairohbis.workers.dev/v1/news/';let joinRef=null,listeners=new Set(),socket=null,heartbeat=null,retry=null,refs=0,stopped=true,lastEmit=0,debounce=null;
async function request(op,{method='GET',body,world,cursor}={}){
 const user=window.currentUser;if(!user)throw Error('news-signed-out');const uid=user.uid,token=await user.getIdToken(),url=new URL(ROOT+op);
 if(window.currentUser?.uid!==uid)throw Error('news-account-changed');
 if(world)url.searchParams.set('world',world);if(cursor)url.searchParams.set('cursor',JSON.stringify(cursor));
 const r=await fetch(url,{method,cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();
 if(window.currentUser?.uid!==uid)throw Error('news-account-changed');if(r.status===401||r.status===403)window.dispatchEvent(new Event('news-authority-denied'));if(!r.ok)throw Object.assign(Error('تعذر تحميل الأخبار. حاول مرة أخرى.'),{status:r.status,code:j.error});
 if(j.source!=='supabase'||j.complete!==true||!j.data)throw Error('news-invalid-payload');return j.data;
}
function emit(){if(stopped||document.hidden)return;const wait=Math.max(0,5000-(Date.now()-lastEmit));if(debounce)return;debounce=setTimeout(()=>{debounce=null;lastEmit=Date.now();for(const f of [...listeners]){try{f()}catch{}}},wait);}
function disconnect(){if(heartbeat)clearInterval(heartbeat);heartbeat=null;if(socket){socket.onclose=null;socket.close();socket=null;}if(retry)clearTimeout(retry);retry=null;}
function connect(){if(stopped||document.hidden||socket||!window.currentUser)return;const key=window.__BLISS_NEWS_ANON_KEY;if(typeof key!=='string'||!key)return;
 socket=new WebSocket('wss://bazrgebdawkjcyufhanu.supabase.co/realtime/v1/websocket?apikey='+encodeURIComponent(key)+'&vsn=1.0.0');const ws=socket;
 ws.onopen=()=>{joinRef=String(++refs);ws.send(JSON.stringify({topic:'realtime:news-invalidation',event:'phx_join',payload:{config:{broadcast:{self:false},presence:{key:''},postgres_changes:[{event:'UPDATE',schema:'public',table:'news_signal'}]},access_token:key},ref:joinRef}));heartbeat=setInterval(()=>{if(ws.readyState===1)ws.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(++refs)}))},25000)};
 ws.onmessage=e=>{try{const j=JSON.parse(e.data);if(j.event==='phx_reply'&&j.ref===joinRef){if(j.payload?.status==='ok')emit();else if(j.payload?.status==='error')ws.close();}if(j.event==='phx_error'||j.event==='phx_close')ws.close();if(j.event==='postgres_changes'){const d=j.payload?.data;if(d?.schema==='public'&&d.table==='news_signal'&&d.type==='UPDATE'&&JSON.stringify(d.record)==='{"id":1}'&&JSON.stringify(d.old_record)==='{"id":1}')emit();}}catch{}};
 ws.onclose=()=>{if(socket!==ws)return;disconnect();if(!stopped&&!document.hidden)retry=setTimeout(connect,10000)};
 ws.onerror=()=>ws.close();
}
function subscribe(fn){listeners.add(fn);stopped=false;connect();return()=>{listeners.delete(fn);if(!listeners.size){stopped=true;disconnect();if(debounce)clearTimeout(debounce);debounce=null;}};}
document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnect();else{connect();emit()}});window.addEventListener('online',()=>{connect();emit()});
window.NewsAPI={request,subscribe,enabled:()=>window.__BLISS_NEWS_MODE==='supabase'};
})();
