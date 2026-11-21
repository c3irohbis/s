const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'../js/forum-badges.js'),'utf8');const a=s.indexOf('  async function _countUnread('),b=s.indexOf('  async function _verify(',a);
test('badge aggregates explicitly descend the inequality field to reuse feed indexes',async()=>{
 let q;const ctx={_uid:'me',_worldId:'is_2',_db:{},_lastSeen:async()=>123,_fs:{where:(...args)=>({where:args}),orderBy:(...args)=>({order:args}),query:(...args)=>args,collection:(...args)=>args,getCountFromServer:async x=>{q=x;return{data:()=>({count:7})}}}};vm.createContext(ctx);vm.runInContext(s.slice(a,b),ctx);
 for (const src of [{col:'news',worldScoped:true,timeField:'createdAt'},{col:'lostFound',statusIn:['published','found'],timeField:'createdAt'}]) {
 assert.equal(await ctx._countUnread(src),7);assert.deepEqual(JSON.parse(JSON.stringify(q.at(-1))),{order:['createdAt','desc']});assert.deepEqual(JSON.parse(JSON.stringify(q.at(-2))),{where:['createdAt','>',123]});
 }
});
