const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../js/chat-listener.js'),'utf8').replace(/import[\s\S]*?from "[^"]+";/,'');
function fixture(){
  const listeners=[],reads=[],events={},rows=new Map();
  let active=true;
  const node=()=>({style:{},classList:{add(){},remove(){},toggle(){}},getBoundingClientRect:()=>({top:0,bottom:1}),querySelector:()=>null,appendChild(){},remove(){rows.delete(this.id)},isConnected:true});
  const container={...node(),scrollHeight:0,scrollTop:0,clientHeight:300,
    querySelectorAll:()=>[...rows.values()],prepend(){},
    set innerHTML(v){rows.clear()},get innerHTML(){return ''}};
  const ctx={console,db:{},msgUnsub:null,currentUser:{uid:'me'},
    document:{hidden:false,getElementById:id=>id==='page-chat'?{classList:{contains:()=>active}}:id==='chatMessages'?container:rows.get(id),
      createElement:()=>node(),querySelectorAll:()=>[],addEventListener:(n,f)=>events[n]=f},
    updateChatBannedState(){},chatColPath:id=>id,activeWorldContext:()=> 'w',isValidWorldId:()=>true,
    collection:(...v)=>({collection:v}),doc:(...v)=>({document:v}),
    where:(...v)=>({where:v}),orderBy:(...v)=>({orderBy:v}),limit:n=>({limit:n}),startAfter:d=>({after:d.id}),query:(...v)=>({parts:v}),
    getDocs:q=>new Promise(resolve=>reads.push({q,resolve})),
    onSnapshot:(q,cb,error)=>{const l={q,cb,error,stopped:false};listeners.push(l);return()=>l.stopped=true},
    appendChatMsg:(el,id,d,prev,cb,uid,ucb)=>{rows.set('msg-'+id,{...node(),id:'msg-'+id,text:d.text});cb('today');ucb(d.uid)},
    _currentChatId:'public'};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);
  return {ctx,listeners,reads,events,rows,setActive:v=>active=v};
}
const doc=(n,time=n,data={})=>({id:String(n).padStart(3,'0'),data:()=>({createdAt:{toMillis:()=>time},uid:'other',text:'message '+n,...data}),exists:()=>true});
const snapshot=(docs,changes=docs.map(doc=>({type:'added',doc})))=>({docs,size:docs.length,empty:!docs.length,docChanges:()=>changes});
test('one bounded head, eviction retained, edits without replacing rows, and cursor history deduplicated',async()=>{
 const f=fixture();await f.ctx.startChatListener('public');
 assert.equal(f.reads.length,0,'no separate initial getDocs');assert.equal(f.listeners.length,1);
 assert.ok(f.listeners[0].q.parts.some(p=>p.limit===40));
 const initial=Array.from({length:40},(_,i)=>doc(40-i));f.listeners[0].cb(snapshot(initial));assert.equal(f.rows.size,40);
 const next=[doc(41),...initial.slice(0,39)];
 f.listeners[0].cb(snapshot(next,[{type:'removed',doc:doc(1)},{type:'added',doc:doc(41)}]));
 assert.equal(f.rows.size,41,'window eviction is preserved as loaded history');
 const unchanged=f.rows.get('msg-040');
 f.listeners[0].cb(snapshot(next,[{type:'modified',doc:doc(40,40,{seen:true})}]));
 assert.equal(f.rows.get('msg-040'),unchanged,'receipt update must not rebuild DOM/audio');
 const older=f.ctx._loadOlderMessages('public');assert.equal(f.reads.length,1);
 assert.ok(f.reads[0].q.parts.some(p=>p.after==='001'),'snapshot cursor retains equal-timestamp ordering');
 f.reads[0].resolve(snapshot([doc(1),doc(0)]));await older;assert.equal(f.rows.size,42,'overlapping pages do not duplicate');
 f.ctx._stopChatListener();assert.equal(f.listeners[0].stopped,true);
});
test('same-chat stale callbacks, hidden-page stop/resume, and stale history completion are ignored',async()=>{
 const f=fixture();await f.ctx.startChatListener('public');const old=f.listeners[0];
 f.ctx._stopChatListener();await f.ctx.startChatListener('public');
 old.cb(snapshot([doc(99)]));assert.equal(f.rows.size,0);
 f.listeners[1].cb(snapshot(Array.from({length:40},(_,i)=>doc(40-i))));
 const history=f.ctx._loadOlderMessages('public');f.ctx.document.hidden=true;f.events.visibilitychange();
 f.reads[0].resolve(snapshot([doc(0)]));await history;assert.equal(f.rows.has('msg-000'),false);
 assert.equal(f.listeners[1].stopped,true);
 await f.ctx.startChatListener('public');assert.equal(f.listeners.length,2,'no hidden listener');
 f.ctx.document.hidden=false;f.events.visibilitychange();assert.equal(f.listeners.length,3,'one resume');
});
test('disjoint reconnect head resets the cursor to avoid skipping the offline gap',async()=>{
 const f=fixture();await f.ctx.startChatListener('public');
 f.listeners[0].cb(snapshot(Array.from({length:40},(_,i)=>doc(40-i))));
 const recent=Array.from({length:40},(_,i)=>doc(100-i));f.listeners[0].cb(snapshot(recent));
 const p=f.ctx._loadOlderMessages('public');assert.ok(f.reads[0].q.parts.some(p=>p.after==='061'));
 f.reads[0].resolve(snapshot([]));await p;
});
