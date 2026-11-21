const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/my-docs.js'),'utf8');const a=source.indexOf('  async function _queryItems('),b=source.indexOf('  const FILTERS =',a);const code=source.slice(a,b);
test('mydocs uses bounded snapshot cursors, keeps filter/sort scope, and caches pages without duplication',async()=>{
 const docs=Array.from({length:65},(_,i)=>({id:String(i),data:()=>({order:i,worldId:'a',subjectId:'subject'})}));let uid='me',world='a',calls=[],renders=[];
 const fns={db:{},collection:(db,col)=>({col}),where:(...x)=>({where:x}),orderBy:(...x)=>({order:x}),limit:n=>({limit:n}),startAfter:d=>({cursor:d}),query:(...x)=>x,getDocs:async q=>{calls.push(q);const cursor=q.find(x=>x.cursor)?.cursor;const start=cursor?Number(cursor.id)+1:0;const page=docs.slice(start,start+30);return {docs:page,size:page.length}}};
 const ctx={window:{MyDocsModule:{},toast:()=>{}},_uid:()=>uid,_worldId:()=>world,_fs:async()=>fns,_subjects:[{id:'subject'}],_setTitle:()=>{},_body:()=>({innerHTML:''}),document:{getElementById:()=>null},COL_ITEMS:'docItems',ITEM_PAGE_SIZE:30,_items:[],_itemPage:null,_itemGeneration:0,_itemPages:new Map(),_currentSubjectId:null,_filter:'all',_view:'home',_renderSubject:()=>renders.push(ctx._items.length)};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 await ctx.window.MyDocsModule._openSubject('subject');assert.equal(ctx._items.length,30);assert.equal(calls.length,1);assert.equal(calls[0].find(x=>x.limit).limit,30);
 await ctx.window.MyDocsModule._loadMoreItems();assert.equal(ctx._items.length,60);assert.equal(calls[1].find(x=>x.cursor).cursor.id,'29');
 await ctx.window.MyDocsModule._loadMoreItems();assert.equal(ctx._items.length,65);assert.equal(ctx._itemPage.done,true);await ctx.window.MyDocsModule._loadMoreItems();assert.equal(calls.length,3);
 await ctx.window.MyDocsModule._setFilter('pdf');assert.equal(calls.length,4);assert.ok(calls.at(-1).some(x=>x.where?.[0]==='type'&&x.where[2]==='pdf'));
 await ctx.window.MyDocsModule._setFilter('all');assert.equal(calls.length,4);assert.equal(ctx._items.length,65);
 await ctx.window.MyDocsModule._setFilter('newest');assert.equal(calls.at(-1).find(x=>x.order).order[1],'desc');
 world='b';await ctx.window.MyDocsModule._openSubject('subject');assert.ok(calls.at(-1).some(x=>x.where?.[0]==='worldId'&&x.where[2]==='b'));
 let resolve;fns.getDocs=q=>new Promise(r=>resolve=r);world='c';const old=ctx.window.MyDocsModule._openSubject('subject');await new Promise(r=>setImmediate(r));uid='other';const count=renders.length;resolve({docs:docs.slice(0,30),size:30});await old;assert.equal(renders.length,count);
});
