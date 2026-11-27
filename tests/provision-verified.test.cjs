const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const load=()=>import(pathToFileURL(path.join(__dirname,'../worker/authority-routes.js')).href);
const env={AUTHORITY_MODE:'supabase',OWNER_UID:'owner'};
const req=()=>new Request('https://x/authority',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'provision',requestId:'req-0123456789abcdef',value:{name:'A',gender:'m',worldId:'w'}})});
function rpcStub(calls){return async(name,args)=>{calls.push(name);return {applied:true,targetUid:args.p_target,revision:1,requestId:'r'};};}
test('provision refused for unverified email token, no rpc',async()=>{
 const {handleAuthority}=await load();const calls=[];
 const r=await handleAuthority(req(),env,{sub:'u1',email:'a@b.c',email_verified:false},{rpc:rpcStub(calls)});
 assert.equal(r.status,403);assert.deepEqual(await r.json(),{error:'email-unverified'});assert.equal(calls.length,0);
});
test('provision refused when email_verified claim missing',async()=>{
 const {handleAuthority}=await load();const calls=[];
 const r=await handleAuthority(req(),env,{sub:'u1',email:'a@b.c'},{rpc:rpcStub(calls)});
 assert.equal(r.status,403);assert.equal(calls.length,0);
});
test('provision proceeds for verified token',async()=>{
 const {handleAuthority}=await load();const calls=[];
 const r=await handleAuthority(req(),env,{sub:'u1',email:'a@b.c',email_verified:true},{rpc:rpcStub(calls)});
 assert.equal(r.status,200);assert.ok(calls.includes('authority_prepare'));
});
