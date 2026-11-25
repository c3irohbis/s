// Private server routes, composed with the gateway's verified Firebase JWT.
import {projectAuthority} from './authority-projector.js';
export async function handleAuthority(request,env,user,{rpc}) {
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(env.AUTHORITY_MODE!=='supabase')return reply(503,{error:'authority-disabled'});
 let input={};
 try{
  if(request.method==='POST'){
   const length=request.headers.get('Content-Length');if(length&&Number(length)>8192)return reply(413,{error:'body-limit'});
   const reader=request.body?.getReader();let parts=[],size=0;
   if(!reader)return reply(400,{error:'invalid-input'});
   let timer;let onAbort;
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reader.cancel().catch(()=>{});reject(Error('body-timeout'));},3000);onAbort=()=>{reader.cancel().catch(()=>{});reject(Error('body-aborted'));};request.signal.addEventListener('abort',onAbort,{once:true});if(request.signal.aborted)onAbort();});
   try { for(;;){const r=await Promise.race([reader.read(),timeout]);if(r.done)break;size+=r.value.length;if(size>8192){await reader.cancel();return reply(413,{error:'body-limit'});}parts.push(r.value);} }
   finally{clearTimeout(timer);request.signal.removeEventListener('abort',onAbort);}
   const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}input=JSON.parse(new TextDecoder().decode(bytes));
  }
  if(request.method==='GET'){
   const target=new URL(request.url).searchParams.get('target')||user.sub;
   const a=await rpc('authority_target',{p_actor:user.sub,p_target:target,p_owner:env.OWNER_UID});
   return reply(200,a);
  }
  const {action,requestId}=input;
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(requestId))return reply(400,{error:'request-id'});
  let target=input.targetUid,value=input.value;
  if(action==='provision'){
   target=user.sub;
   if(!value||typeof value!=='object'||Array.isArray(value))return reply(400,{error:'invalid-profile'});
   value={name:value.name,gender:value.gender,worldId:value.worldId,email:typeof user.email==='string'?user.email:''};
  }
  const j=action==='recover'?await rpc('authority_recover',{p_actor:user.sub,p_target:target||user.sub,p_owner:env.OWNER_UID}):await rpc('authority_prepare',{p_actor:user.sub,p_target:target,p_action:action,p_value:value??null,p_expected:input.expectedRevision??null,p_request:requestId,p_owner:env.OWNER_UID});
  if(!j.applied){const applied=await projectAuthority(j,env);await rpc('authority_ack',{p_request:j.requestId,p_revision:j.revision,p_observed:applied});}
  return reply(200,{ok:true,targetUid:j.targetUid,revision:j.revision});
 }catch(e){
  // Only fixed error codes cross the boundary, never raw provider text/credentials.
  const text=String(e?.message||'');
  if(/^body-/.test(text))return reply(408,{error:'body-timeout'});
  const conflict=/conflict|stale|pending/.test(text);
  const invalid=/invalid-|unsupported|request-id/.test(text);
  const denied=/authority-denied|protected-target/.test(text);
  return reply(conflict?409:invalid?400:denied?403:503,{error:conflict?'authority-conflict':invalid?'invalid-input':denied?'authority-denied':'authority-pending'});
 }
}

export async function drainAuthority(env,{rpc}) {
 const lease=await rpc('authority_claim_drain',{});if(!lease)return;
 const deadline=Date.now()+25000;
 try { const jobs=await rpc('authority_pending_jobs',{});
 for(const j of jobs.slice(0,5)){if(Date.now()>deadline)break;try{const applied=await projectAuthority(j,env);await rpc('authority_ack',{p_request:j.requestId,p_revision:j.revision,p_observed:applied});}catch{console.warn('authority projection remains pending');}}
 }finally{await rpc('authority_release_drain',{p_lease:lease}).catch(()=>{});}
}
