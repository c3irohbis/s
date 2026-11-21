const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const s=fs.readFileSync(path.join(__dirname,'../js/sheetaty.js'),'utf8');const a=s.indexOf('  async function _loadCompletionIds('),b=s.indexOf('  function _renderSubject()',a);const code=s.slice(a,b);
test('Sheetaty reads only the viewed subject completion IDs in batches of 30 and ignores stale subjects',async()=>{
 const sheets=Array.from({length:65},(_,i)=>({id:'sheet'+i,data:()=>({worldId:'a',subjectId:'s'})}));const queries=[];let uid='me',renders=0;
 const fns={db:{},collection:(db,path)=>({path}),where:(...x)=>({where:x}),orderBy:()=>({}),documentId:()=> '__name__',query:(...x)=>x,getDocs:async q=>{queries.push(q);if(q[0].path==='sheets')return{docs:sheets};return{metadata:{fromCache:false},forEach:cb=>cb({id:q[1].where[2][0],data:()=>({completed:true})})}}};
 const ctx={window:{SheetatyModule:{}},_subjectGeneration:0,_uid:()=>uid,_worldId:()=> 'a',_currentSubjectId:null,_view:'home',_subjects:[{id:'s',worldId:'a'}],_body:()=>({innerHTML:''}),_setTitle:()=>{},_fs:async()=>fns,COL_SHEETS:'sheets',_completions:{},_completionsUid:null,_knownCompletionIds:new Set(),_sheets:[],_renderSubject:()=>renders++};vm.createContext(ctx);vm.runInContext(code,ctx);
 await ctx.window.SheetatyModule._openSubject('s');assert.equal(queries.length,4);assert.equal(ctx._sheets.length,65);assert.equal(ctx._knownCompletionIds.size,65);assert.equal(queries[1][1].where[2].length,30);assert.equal(queries[3][1].where[2].length,5);
 await ctx.window.SheetatyModule._openSubject('s');assert.equal(queries.length,5);assert.equal(renders,2);
 fns.getDocs=async()=>{uid='other';return{docs:sheets}};await ctx.window.SheetatyModule._openSubject('s');assert.equal(renders,2);
});

test('completion batches keep offline absences retryable and propagate errors', async()=>{
 const ctx={window:{SheetatyModule:{}},_subjectGeneration:0};vm.createContext(ctx);vm.runInContext(code,ctx);
 let calls=0;const fns={db:{},collection:(db,p)=>p,query:(...x)=>x,where:(...x)=>x,documentId:()=> '__name__',getDocs:async()=>{calls++;return{metadata:{fromCache:true},forEach:()=>{}}}};
 const result=await ctx._loadCompletionIds(fns,'me',['a','b']);assert.equal(result.length,1);assert.equal(result[0].snap.metadata.fromCache,true);assert.equal(calls,1);
 fns.getDocs=async()=>{throw Error('offline')};await assert.rejects(ctx._loadCompletionIds(fns,'me',['a']),/offline/);
 assert.match(code,/if\(!snap.metadata\?\.fromCache\)_knownCompletionIds.add\(id\)/);
});
test('failed completion write from previous account cannot roll back new account state',async()=>{
 const start=s.indexOf('  window.SheetatyModule._toggleDone ='),end=s.indexOf('  window.SheetatyModule._newSubject =',start);
 let uid='old';const ctx={window:{SheetatyModule:{}},_uid:()=>uid,_completions:{},_renderSubject:()=>{},_fs:async()=>({db:{},doc:()=>({}),serverTimestamp:()=>null,setDoc:async()=>{uid='new';ctx._completions={newState:true};throw Error('failed')}})};
 vm.createContext(ctx);vm.runInContext(s.slice(start,end),ctx);await ctx.window.SheetatyModule._toggleDone('a','s');assert.deepEqual(ctx._completions,{newState:true});
});
