const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
let code=fs.readFileSync(path.join(__dirname,'../js/firestore-safe.js'),'utf8').replace(/export \* from "[^"]+";/,'').replace(/import \{[\s\S]*?\} from "[^"]+";/,'').replaceAll('export ','');
test('four preference reads share one attempt; writes, accounts, errors, and other paths remain safe',async()=>{
 const calls=[];const ctx={currentUser:{uid:'me'},_rawGetDoc:r=>new Promise((resolve,reject)=>calls.push({r,resolve,reject})),
   _rawSetDoc:async()=>{},getDocFromCache:async()=>{throw Error('offline')}};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const db={},ref={path:'users/me/settings/appPrefs',firestore:db};
 const pending=[ctx.getDoc(ref),ctx.getDoc(ref),ctx.getDoc(ref),ctx.getDoc(ref)];assert.equal(calls.length,1);
 const snap={metadata:{fromCache:false}};calls[0].resolve(snap);await Promise.all(pending);
 assert.equal(await ctx.getDoc(ref),snap);assert.equal(calls.length,1);
 await ctx.setDoc(ref,{theme:'dark'},{merge:true});const afterWrite=ctx.getDoc(ref);assert.equal(calls.length,2);calls[1].resolve(snap);await afterWrite;
 ctx.currentUser={uid:'other'};const other=ctx.getDoc({path:'users/other/settings/appPrefs',firestore:db});assert.equal(calls.length,3);calls[2].resolve(snap);await other;
 const permissions=ctx.getDoc({path:'config/maintenance',firestore:db});assert.equal(calls.length,4);calls[3].resolve(snap);await permissions;
 const permissions2=ctx.getDoc({path:'config/maintenance',firestore:db});assert.equal(calls.length,5);calls[4].resolve(snap);await permissions2;
});
test('offline preference results and failed attempts are never kept as fresh cache',async()=>{
 let calls=0;
 const ctx={currentUser:{uid:'me'},_rawGetDoc:async()=>{calls++;throw Error('server')},
 getDocFromCache:async()=>({metadata:{fromCache:true}})};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const ref={path:'users/me/settings/appPrefs',firestore:{}};
 await ctx.getDoc(ref);await ctx.getDoc(ref);assert.equal(calls,2);
 ctx.getDocFromCache=async()=>{throw Error('cache')};
 await assert.rejects(ctx.getDoc(ref));await assert.rejects(ctx.getDoc(ref));assert.equal(calls,4);
});
