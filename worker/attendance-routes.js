// Attendance accepts identity only from the gateway's verified Firebase JWT.
export async function handleAttendance(request,env,user,{rpc,enabled}){
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(!['GET','POST'].includes(request.method))return reply(405,{error:'method-not-allowed'});
 if(!enabled)return reply(503,{error:'attendance-disabled'});
 const url=new URL(request.url),op=url.pathname.split('/').at(-1);let input={};
 try{
  if(request.method==='POST'){
   const reader=request.body?.getReader();if(!reader)throw Error('invalid-input');let size=0,parts=[];
   const deadline=Date.now()+5000;
   try{for(;;){let timer;let value;const left=deadline-Date.now();if(left<=0)throw Error('body-timeout');try{value=await Promise.race([reader.read(),new Promise((_,bad)=>{timer=setTimeout(()=>bad(Error('body-timeout')),Math.min(3000,left))})]);}finally{clearTimeout(timer);}if(value.done)break;size+=value.value.length;if(size>65536)return reply(413,{error:'body-limit'});parts.push(value.value);}}finally{await reader.cancel().catch(()=>{});}
   const bytes=new Uint8Array(size);let n=0;for(const p of parts){bytes.set(p,n);n+=p.length;}input=JSON.parse(new TextDecoder().decode(bytes));if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid-input');
  }
  const world=request.method==='GET'?url.searchParams.get('world'):input.world;
  let result;
  if(op==='config'&&request.method==='GET'){
   result=await rpc('attendance_config',{p_uid:user.sub,p_world:world});
  }else if(op==='mutate'&&request.method==='POST')result=await rpc('attendance_mutate',{p_uid:user.sub,p_world:world,p_action:input.action,p_data:input.data??{},p_request:input.requestId});
  else return reply(405,{error:'method-not-allowed'});
  return reply(200,{source:'supabase',complete:true,data:result});
 }catch(e){const t=String(e?.message||'');const denied=/authority-denied/.test(t),invalid=/invalid-|JSON|Unexpected/.test(t),conflict=/conflict/.test(t);return reply(t==='body-timeout'?408:denied?403:invalid?400:conflict?409:503,{error:t==='body-timeout'?'body-timeout':denied?'attendance-denied':invalid?'invalid-input':conflict?'attendance-conflict':'attendance-unavailable'});}
}
