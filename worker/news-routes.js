// News accepts identity only from the gateway's verified Firebase JWT.
export async function handleNews(request,env,user,{rpc,enabled}){
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(!['GET','POST'].includes(request.method))return reply(405,{error:'method-not-allowed'});
 if(!enabled)return reply(503,{error:'news-disabled'});
 const url=new URL(request.url),op=url.pathname.split('/').at(-1);let input={};
 try{
  if(request.method==='POST'){
   const reader=request.body?.getReader();if(!reader)throw Error('invalid-input');let size=0,parts=[];
   try{for(;;){let timer;let value;try{value=await Promise.race([reader.read(),new Promise((_,bad)=>{timer=setTimeout(()=>bad(Error('body-timeout')),3000)})]);}finally{clearTimeout(timer);}if(value.done)break;size+=value.value.length;if(size>65536)return reply(413,{error:'body-limit'});parts.push(value.value);}}finally{await reader.cancel().catch(()=>{});}
   const bytes=new Uint8Array(size);let n=0;for(const p of parts){bytes.set(p,n);n+=p.length;}input=JSON.parse(new TextDecoder().decode(bytes));if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid-input');
  }
  const world=request.method==='GET'?url.searchParams.get('world'):input.world;
  let result;
  if(op==='list'&&request.method==='GET'){
   const cursor=url.searchParams.get('cursor');result=await rpc('news_list',{p_uid:user.sub,p_world:world,p_cursor:cursor?JSON.parse(cursor):null});
  }else if(op==='mutate'&&request.method==='POST')result=await rpc('news_mutate',{p_uid:user.sub,p_world:world,p_action:input.action,p_id:input.id,p_title:input.title??null,p_body:input.body??null,p_expected:input.expectedRevision??null,p_request:input.requestId});
  else if(op==='badge'&&request.method==='GET')result=await rpc('news_badge',{p_uid:user.sub,p_world:world,p_mark:null});
  else if(op==='read'&&request.method==='POST')result=await rpc('news_badge',{p_uid:user.sub,p_world:world,p_mark:input.viewToken});
  else if(op==='prefs'){
   if(request.method==='POST'&&typeof input.enabled!=='boolean')throw Error('invalid-input');
   result=await rpc('news_pref',{p_uid:user.sub,p_enabled:request.method==='POST'?input.enabled:null});
  }else if(op==='notifications')result=await rpc('news_notifications',{p_uid:user.sub,p_action:request.method==='GET'?'list':input.action,p_id:input.id??null,p_context:input.context??null});
  else return reply(405,{error:'method-not-allowed'});
  return reply(200,{source:'supabase',complete:true,data:result});
 }catch(e){const t=String(e?.message||'');const denied=/authority-denied/.test(t),invalid=/invalid-|JSON|Unexpected/.test(t),conflict=/conflict/.test(t);return reply(t==='body-timeout'?408:denied?403:invalid?400:conflict?409:503,{error:t==='body-timeout'?'body-timeout':denied?'news-denied':invalid?'invalid-input':conflict?'news-conflict':'news-unavailable'});}
}
