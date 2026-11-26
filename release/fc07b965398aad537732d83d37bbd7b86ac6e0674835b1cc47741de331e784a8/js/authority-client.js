// Imported by profile provisioning and authority controls after cutover only.
const ROOT='https://bliss-gateway.cairohbis.workers.dev/v1/authority';
const mode=()=>window.__BLISS_AUTHORITY_MODE==='supabase';
async function call(user,method,body,target){
 const token=await user.getIdToken();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
 try{
  const r=await fetch(ROOT+(target?'?target='+encodeURIComponent(target):''),{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal,cache:'no-store'});
  const j=await r.json();if(!r.ok)throw Object.assign(Error(j.error==='authority-disabled'?'تحديث الحسابات متوقف مؤقتا للصيانة. حاول بعد قليل.':r.status===409?'تغيرت البيانات أو يوجد تحديث معلق. حاول مجددا.':'تعذر إتمام تحديث الحساب. حاول مجددا.'),{status:r.status,code:j.error});return j;
 }finally{clearTimeout(timer);}
}
const pending=new Map();
const storageKey=key=>'bis_authority_request:'+key;
function loadPending(key){if(pending.has(key))return pending.get(key);try{const j=JSON.parse(sessionStorage.getItem(storageKey(key))||'null');if(j&&typeof j.requestId==='string'){pending.set(key,j);return j;}}catch{}return null;}
function savePending(key,body){pending.set(key,body);try{sessionStorage.setItem(storageKey(key),JSON.stringify(body));}catch{}}
function clearPending(key){pending.delete(key);try{sessionStorage.removeItem(storageKey(key));}catch{}}
async function mutate(user,targetUid,action,value){
 const key=[user.uid,targetUid,action,JSON.stringify(value)].join('|');let body=loadPending(key);
 if(!body){let t=await call(user,'GET',null,targetUid);if(t.pending){await recover(user,targetUid);t=await call(user,'GET',null,targetUid);}body={targetUid,action,value,expectedRevision:t.revision,requestId:crypto.randomUUID()};savePending(key,body);}
 // Reuse request id after lost response or a partial server projection.
 let result;try{result=await call(user,'POST',body);}catch(e){if(e.status===409)clearPending(key);throw e;}clearPending(key);return result;
}
async function status(user,targetUid=user.uid){return call(user,'GET',null,targetUid);}
async function recover(user,targetUid=user.uid){return call(user,'POST',{targetUid,action:'recover',requestId:crypto.randomUUID()});}
async function provision(user,profile){
 const key=user.uid+'|provision';let body=loadPending(key);
 if(!body){body={action:'provision',value:profile,requestId:crypto.randomUUID()};savePending(key,body);}
 const result=await call(user,'POST',body);clearPending(key);return result;
}
export const AuthorityClient={enabled:mode,mutate,provision,recover,status};
