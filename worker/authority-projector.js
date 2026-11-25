// Server-only projection module. No client imports, no credential logging.
const enc=new TextEncoder();
function b64url(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
let cached=null;
async function accessToken(env){
 if(cached&&cached.until>Date.now()+60000&&cached.identity===env.AUTHORITY_PROJECTOR_EMAIL)return cached.token;
 if(env.FIREBASE_PROJECT_ID!=='university-platform-dev')throw Error('projector-project');
 const identity=env.AUTHORITY_PROJECTOR_EMAIL;
 if(identity!=='news-authority-projector@university-platform-dev.iam.gserviceaccount.com')throw Error('projector-identity');
 const now=Math.floor(Date.now()/1000);
 const claims={iss:identity,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600};
 const unsigned=b64url(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'})))+'.'+b64url(enc.encode(JSON.stringify(claims)));
 const pem=env.AUTHORITY_PROJECTOR_KEY.replace(/-----[^-]+-----/g,'').replace(/\s+/g,'');
 const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(unsigned));
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+b64url(sig)}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('projector-oauth');const j=await r.json();if(typeof j.access_token!=='string')throw Error('projector-oauth-response');
 cached={identity,token:j.access_token,until:Date.now()+Math.min(Number(j.expires_in)||300,3600)*1000};return cached.token;
}
function decode(v){if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('nullValue'in v)return null;throw Error('projection-type');}
function fields(o){return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v===null?{nullValue:null}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'&&Number.isSafeInteger(v)?{integerValue:String(v)}:typeof v==='string'?{stringValue:v}:(()=>{throw Error('projection-value')})()]));}
const keys=['uid','role','worldId','isBanned','authorityRevision','authorityDeleted'];
function expected(job){const p=job.payload;if(!p||keys.some(k=>!(k in p))||Object.keys(p).some(k=>!keys.includes(k)&&k!=='profile')||p.uid!==job.targetUid||p.authorityRevision!==job.revision)throw Error('projection-job');return Object.fromEntries(keys.map(k=>[k,p[k]]));}
function observed(doc){return Object.fromEntries(keys.filter(k=>doc?.fields?.[k]).map(k=>[k,decode(doc.fields[k])]));}
function equal(a,b){return keys.every(k=>Object.hasOwn(a,k)&&Object.hasOwn(b,k)&&a[k]===b[k]);}
export async function projectAuthority(job,env,transport){
 if(env.FIREBASE_PROJECT_ID!=='university-platform-dev')throw Error('projector-project');
 const target=expected(job);if(!/^[A-Za-z0-9_-]{1,128}$/.test(job.targetUid))throw Error('projection-uid');
 const root='https://firestore.googleapis.com/v1/projects/'+env.FIREBASE_PROJECT_ID+'/databases/(default)/documents';
 const document=root+'/users/'+encodeURIComponent(job.targetUid);
 const deadline=Date.now()+20000;
 const token=transport?'emulator':await accessToken(env);
 const baseSend=transport||fetch;
 const send=(url,init={})=>{const left=deadline-Date.now();if(left<=0)throw Error('projection-deadline');return baseSend(url,{...init,signal:AbortSignal.timeout(Math.min(5000,left))});};
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 for(let attempt=0;attempt<4;attempt++){
  const r=await send(document,{headers,signal:AbortSignal.timeout(10000)});
  if(!r.ok&&r.status!==404)throw Error('projection-read');const old=r.status===404?null:await r.json();
  const found=old?observed(old):{};const rev=found.authorityRevision||0;
  if(rev>job.revision)throw Error('projection-stale');
  if(rev===job.revision){if(!equal(found,target))throw Error('projection-revision-mismatch');return found;}
  const profile=job.payload.profile;
  if(!old&&!profile)throw Error('projection-profile-missing');
  if(profile&&old)throw Error('projection-create-conflict');
  const body=old?target:{...profile,...target};
  const write={update:{name:document.replace('https://firestore.googleapis.com/v1/',''),fields:fields(body)},currentDocument:old?{updateTime:old.updateTime}:{exists:false}};
  if(old)write.updateMask={fieldPaths:keys};
  else write.updateTransforms=[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'agreedToTermsAt',setToServerValue:'REQUEST_TIME'}];
  const commit=await send(root+':commit',{method:'POST',headers,body:JSON.stringify({writes:[write]}),signal:AbortSignal.timeout(10000)});
  if(!commit.ok){
   let error;try{error=await commit.json();}catch{}
   if(['FAILED_PRECONDITION','ABORTED'].includes(error?.error?.status))continue;
   throw Error('projection-write');
  }
  const verify=await send(document,{headers,signal:AbortSignal.timeout(10000)});
  if(!verify.ok)throw Error('projection-verify');const applied=observed(await verify.json());
  if(!equal(applied,target))throw Error('projection-verify-mismatch');return applied;
 }
 throw Error('projection-conflict');
}
export const _projectionTest={fields,observed,expected};
