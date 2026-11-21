const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');const a=html.indexOf('let _worldUsersCache ='),b=html.indexOf('window._getWorldUsers = _getWorldUsers;',a);
const code=html.slice(a,b);
test('world directory shares concurrent work and never broadens errors into global scans',async()=>{
 let world='a',reads=0,resolve;const ctx={window:{currentUser:{uid:'me'},activeWorldContext:()=>world},db:{},OWNER_UID:'owner',CACHE_TTL_MS:300000,_userCache:{},collection:()=>({}),query:(...q)=>q,where:(...q)=>q,doc:()=>({}),getDoc:async()=>({exists:()=>false}),getDocs:()=>{reads++;return new Promise(r=>resolve=r)}};
 vm.createContext(ctx);vm.runInContext(code,ctx);const first=ctx._getWorldUsers(),second=ctx._getWorldUsers();assert.equal(reads,1);
 resolve({docs:[{id:'one',data:()=>({worldId:'a',name:'اسم كامل'})}]});assert.equal((await first).length,1);await second;await ctx._getWorldUsers();assert.equal(reads,1);
 world='b';const stale=ctx._getWorldUsers();world='c';resolve({docs:[]});await assert.rejects(stale,/context changed/);
 ctx.getDocs=async()=>{reads++;throw Error('index')};await assert.rejects(ctx._getWorldUsers(),/index/);assert.ok(!code.includes('_getAllUsers'));
});
