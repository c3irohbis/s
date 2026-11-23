const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const html=require('./_app-source.cjs').source;const a=html.indexOf('async function _getUser(uid)'),b=html.indexOf('async function _getAllUsers()',a);const code=html.slice(a,b);
test('profile reads are shared, cached, retried after failure, and cannot fill a new account cache',async()=>{
 let calls=0,resolve;const ctx={window:{currentUser:{uid:'me'}},db:{},CACHE_TTL_MS:300000,_userCache:{},_userFetchQ:{},doc:(...x)=>x,getDoc:()=>{calls++;return new Promise(r=>resolve=r)}};vm.createContext(ctx);vm.runInContext(code,ctx);
 const x=ctx._getUser('peer'),y=ctx.window._getUserProfile('peer');assert.equal(calls,1);resolve({exists:()=>true,data:()=>({name:'peer'})});assert.equal((await x).name,'peer');await y;await ctx._getUser('peer');assert.equal(calls,1);
 const pending=ctx._getUser('other');ctx.window.currentUser={uid:'new'};resolve({exists:()=>true,data:()=>({name:'old result'})});await pending;assert.equal(ctx._userCache.other,undefined);
 ctx.getDoc=async()=>{calls++;throw Error('offline')};await ctx._getUser('other');await ctx._getUser('other');assert.equal(calls,4);
});
