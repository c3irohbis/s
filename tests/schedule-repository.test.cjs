const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../js/schedule-repository.js'),'utf8').replace(/^import[^\n]+\n/,'').replaceAll('export ','');
test('schedule shares only complete active server snapshots and scopes account/world',async()=>{
 let calls=0,stops=0,callback,readResolve;const ctx={window:{__BLISS_STUDYSCHEDULE_MODE:'firebase'},currentUser:{uid:'me'},collection:()=>({}),query:(...q)=>q,where:(...q)=>q,onSnapshot:(q,options,cb)=>{assert.equal(options.includeMetadataChanges,true);callback=cb;return()=>stops++},getDocs:()=>{calls++;return new Promise(r=>readResolve=r)}};
 vm.createContext(ctx);vm.runInContext(code,ctx);const db={},received=[];
 const stop=ctx.subscribeSchedule(db,'a','me',s=>received.push(s));const snap={metadata:{fromCache:false,hasPendingWrites:false},docs:[]};callback(snap);
 assert.equal(await ctx.getSchedule(db,'a','me'),snap);assert.equal(calls,0);
 const other=ctx.getSchedule(db,'b','me'),again=ctx.getSchedule(db,'b','me');assert.equal(calls,1);readResolve(snap);await Promise.all([other,again]);
 stop();assert.equal(stops,1);const afterStop=ctx.getSchedule(db,'a','me');assert.equal(calls,2);readResolve(snap);await afterStop;
 const stop2=ctx.subscribeSchedule(db,'a','me',()=>{});callback({metadata:{fromCache:true},docs:[]});const offline=ctx.getSchedule(db,'a','me');assert.equal(calls,3);readResolve(snap);await offline;stop2();
 const otherUser=ctx.getSchedule(db,'a','other');assert.equal(calls,4);readResolve(snap);await otherUser;
});
