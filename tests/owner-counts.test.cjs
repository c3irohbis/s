const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../js/app-main.js'),'utf8');const indexHtml=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
test('owner counts preserve aggregates and in-flight sharing after analytics removal',async()=>{
 const start=html.indexOf('let _ownerStatsPending');const end=html.indexOf('let _allOwnerUsers');
 assert.ok(end>start,'slice end marker found');
 const code=html.slice(start,end);const calls=[],elements={};let resolve;
 const ctx={console,db:{},ROLES:{ADMIN:'admin',USER:'user'},
  collection:()=>({}),query:(...v)=>v,where:(...v)=>v,
  getCountFromServer:q=>{calls.push(q);return new Promise(r=>{if(!resolve)resolve=r;else r({data:()=>({count:2})})})},
  document:{getElementById:id=>elements[id]||(elements[id]={})}};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const a=ctx.loadOwnerStats(),b=ctx.loadOwnerStats();assert.equal(calls.length,4);
 resolve({data:()=>({count:10})});await Promise.all([a,b]);
 assert.equal(elements.statTotal.textContent,10);assert.equal(elements.statBanned.textContent,2);
 assert.ok(!code.includes('getDocs('));
 assert.ok(!html.includes('msgFakeData'),'no random chart values');
 assert.ok(!html.includes('loadOwnerAnalytics'));
 assert.ok(!html.includes('function loadAnalytics'));
 assert.ok(!html.includes('statMsgsToday'));
 for(const k of ['msgFakeData','loadOwnerAnalytics','function loadAnalytics','statMsgsToday'])assert.ok(!indexHtml.includes(k),'index.html also clean: '+k);
});
