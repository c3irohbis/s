// BIS-main call-token service. Secrets belong only in Cloudflare settings.
// Bind CALL_LIMITS to the SQLite-backed CallLimits Durable Object exported below.
const ORIGIN = 'https://c3irohbis.github.io';
const PROJECT = 'university-platform-dev';
const OWNER = 'wnvQPme3u0NU4VVqvr4DGqvv4KE3';
const enc = new TextEncoder();
const dec = new TextDecoder();
const jwksURL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache;
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
const part = obj => b64(enc.encode(JSON.stringify(obj)));
function response(req, status, data) {
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  if (req.headers.get('Origin') === ORIGIN) Object.assign(headers, {
    'Access-Control-Allow-Origin':ORIGIN,
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type',
    'Access-Control-Max-Age':'600'
  });
  return new Response(status === 204 ? null : JSON.stringify(data),{status,headers});
}
async function keys(force=false) {
  if (!force && jwksCache && jwksCache.until > Date.now()) return jwksCache.keys;
  const r=await fetch(jwksURL);
  if(!r.ok) throw Error('keys-unavailable');
  const body=await r.json();
  if(!Array.isArray(body.keys)) throw Error('keys-unavailable');
  const maxAge=Number((r.headers.get('Cache-Control')||'').match(/max-age=(\d+)/)?.[1] || 300);
  jwksCache={keys:body.keys,until:Date.now()+Math.min(3600,maxAge)*1000};
  return body.keys;
}
export async function verifyFirebase(token) {
  if(typeof token !== 'string' || token.length>8192) throw Error('token');
  const p=token.split('.');
  if(p.length!==3) throw Error('token');
  const h=JSON.parse(dec.decode(unb64(p[0]))), c=JSON.parse(dec.decode(unb64(p[1])));
  if(h.alg!=='RS256'||typeof h.kid!=='string') throw Error('algorithm');
  let jwk=(await keys()).find(k=>k.kid===h.kid);
  if(!jwk) jwk=(await keys(true)).find(k=>k.kid===h.kid);
  if(!jwk) throw Error('key');
  const k=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',k,unb64(p[2]),enc.encode(p[0]+'.'+p[1]))) throw Error('signature');
  const now=Math.floor(Date.now()/1000);
  if(c.aud!==PROJECT || c.iss!=='https://securetoken.google.com/'+PROJECT || typeof c.sub!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(c.sub)) throw Error('identity');
  if(!Number.isFinite(c.exp)||c.exp<=now||!Number.isFinite(c.iat)||c.iat>now+30||!Number.isFinite(c.auth_time)||c.auth_time>now+30) throw Error('time');
  if(c.user_id && c.user_id!==c.sub) throw Error('identity');
  return c;
}
async function fs(path,token) {
  const r=await fetch('https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents/'+path,{headers:{Authorization:'Bearer '+token}});
  if([403,404].includes(r.status)) return null;
  if(!r.ok) throw Error('firestore');
  return r.json();
}
const str = f=>f?.stringValue || '';
const arr = f=>(f?.arrayValue?.values||[]).map(v=>v.stringValue);
export async function signLiveKit(env, identity, name, room) {
  const now=Math.floor(Date.now()/1000);
  const data=part({alg:'HS256',typ:'JWT'})+'.'+part({
    iss:env.LIVEKIT_API_KEY,sub:identity,name,iat:now,nbf:now-5,exp:now+120,
    video:{roomJoin:true,room,canPublish:true,canSubscribe:true,canPublishData:false,canPublishSources:['microphone','camera']}
  });
  const key=await crypto.subtle.importKey('raw',enc.encode(env.LIVEKIT_API_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return data+'.'+b64(await crypto.subtle.sign('HMAC',key,enc.encode(data)));
}
async function consume(env,uid) {
  const stub=env.CALL_LIMITS.get(env.CALL_LIMITS.idFromName('token-budget-v1'));
  const r=await stub.fetch(new Request('https://limits/consume',{method:'POST',body:JSON.stringify({uid})}));
  return r.ok;
}
export default {
  async fetch(req,env) {
    if(req.headers.get('Origin')!==ORIGIN) return response(req,403,{error:'origin-not-allowed'});
    if(new URL(req.url).pathname!=='/livekit-token') return response(req,404,{error:'not-found'});
    if(req.method==='OPTIONS') return response(req,204,null);
    if(req.method!=='POST') return response(req,405,{error:'method-not-allowed'});
    if(!env.LIVEKIT_API_KEY||!env.LIVEKIT_API_SECRET||!/^wss:\/\/[a-z0-9-]+\.livekit\.cloud$/.test(env.LIVEKIT_URL||'')||!env.CALL_LIMITS) return response(req,503,{error:'livekit-not-configured'});
    if(!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')||'')) return response(req,415,{error:'json-required'});
    const auth=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers.get('Authorization')||'');
    if(!auth) return response(req,401,{error:'missing-token'});
    let user;
    try {user=await verifyFirebase(auth[1]);} catch {return response(req,401,{error:'invalid-token'});}
    try {
      if(!await consume(env,user.sub)) return response(req,429,{error:'rate-limited'});
      const text=await req.text();
      if(text.length>2048) return response(req,413,{error:'body-too-large'});
      let body;
      try {body=JSON.parse(text);} catch {return response(req,400,{error:'bad-json'});}
      if(!body||typeof body!=='object'||Array.isArray(body)) return response(req,400,{error:'bad-json'});
      const me=await fs('users/'+encodeURIComponent(user.sub),auth[1]);
      if(!me) return response(req,403,{error:'profile-required'});
      const fields=me.fields||{};
      let room;
      if(body.kind==='dm') {
        const peer=body.peerUid;
        if(typeof peer!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(peer)||peer===user.sub) return response(req,400,{error:'bad-peer'});
        const chatId=[peer,user.sub].sort().join('_');
        const chat=await fs('privateChats/'+encodeURIComponent(chatId),auth[1]);
        const participants=arr(chat?.fields?.participants);
        if(!participants.includes(user.sub)||!participants.includes(peer)) return response(req,403,{error:'not-participant'});
        room='dm_'+chatId;
      } else if(body.kind==='room') {
        if(typeof body.roomId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(body.roomId)) return response(req,400,{error:'bad-room'});
        const rd=await fs('rooms/'+encodeURIComponent(body.roomId),auth[1]);
        if(!rd) return response(req,403,{error:'room-not-accessible'});
        const world=str(rd.fields?.worldId);
        if(user.sub!==OWNER&&(!world||world!==str(fields.worldId))) return response(req,403,{error:'world-mismatch'});
        room='room_'+body.roomId;
      } else return response(req,400,{error:'bad-kind'});
      const name=(str(fields.name)||str(fields.displayName)||user.name||'User').slice(0,60);
      return response(req,200,{token:await signLiveKit(env,user.sub,name,room),url:env.LIVEKIT_URL,room,identity:user.sub});
    } catch {return response(req,502,{error:'upstream-failed'});}
  }
};

// Strict, durable, global token-issuance budget. Not a media-duration limit.
// Free LiveKit Build quota remains the hard media-consumption ceiling.
export class CallLimits {
  constructor(state) {this.state=state;}
  async fetch(req) {
    const {uid}=await req.json();
    if(typeof uid!=='string'||uid.length>128) return new Response('',{status:400});
    const now=Date.now(), minute=Math.floor(now/60000), day=Math.floor(now/86400000);
    const accepted=await this.state.storage.transaction(async tx=>{
      let b=await tx.get('budget')||{minute,day,total:0,users:{}};
      if(b.day!==day) b={minute,day,total:0,users:{}};
      if(b.minute!==minute) {b.minute=minute; for(const u of Object.values(b.users)) u.minute=0;}
      const u=b.users[uid]||{minute:0,day:0};
      if(u.minute>=6||u.day>=60||b.total>=500) return false;
      u.minute++;u.day++;b.total++;b.users[uid]=u;
      await tx.put('budget',b);
      return true;
    });
    return new Response('',{status:accepted?200:429});
  }
}
