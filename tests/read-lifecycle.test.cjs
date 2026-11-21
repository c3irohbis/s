const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = p => fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const flush = () => new Promise(r => setImmediate(r));

test('same-chat close/reopen cannot resurrect the stale initial query', async () => {
  const pending = [], listeners = [], events = {};
  const container = {innerHTML:'',style:{},querySelector:()=>null};
  const ctx = {console, db:{}, msgUnsub:null, currentUser:{uid:'me'},
    updateChatBannedState(){}, chatColPath:id=>id,
    document:{hidden:false,getElementById:id=>id==='page-chat'?{classList:{contains:()=>true}}:container,
      addEventListener:(n,f)=>events[n]=f},
    collection:()=>({}),where:()=>({}),orderBy:()=>({}),limit:()=>({}),query:()=>({}),
    getDocs:()=>new Promise(r=>pending.push(r)),
    onSnapshot:(q,cb)=>{const item={stopped:false};listeners.push(item);return()=>item.stopped=true;},
    activeWorldContext:()=> 'world',isValidWorldId:()=>true};
  ctx.window=ctx;ctx._currentChatId='public';
  vm.createContext(ctx);
  vm.runInContext(source('js/chat-listener.js').replace(/import[\s\S]*?from "[^"]+";/,''),ctx);
  const a=ctx.startChatListener('public');
  ctx._stopChatListener();
  const b=ctx.startChatListener('public');
  pending[0]({empty:true,docs:[],size:0});await a;
  assert.equal(listeners.length,0);
  pending[1]({empty:true,docs:[],size:0});await b;
  assert.equal(listeners.length,1);
  ctx.document.hidden=true;events.visibilitychange();
  assert.equal(listeners[0].stopped,true);
  await ctx.startChatListener('public');
  assert.equal(pending.length,2,'hidden chat must not query');
  ctx.document.hidden=false;events.visibilitychange();
  assert.equal(pending.length,3,'return resumes exactly one query');
});

test('all lost-found views cancel pending starts and detach active subscriptions',async()=>{
  for(const name of ['feed','found','admin','comments']) {
    const pending=[],subscriptions=[],callbacks=[];
    const el={innerHTML:'',querySelector(){return el},querySelectorAll(){return []},addEventListener(){}};
    const sdk={db:{},collection(){},where(){},orderBy(){},query(){},
      onSnapshot(){const sub={stopped:false};subscriptions.push(sub);return()=>sub.stopped=true;},
      getCountFromServer:async()=>({data:()=>({count:0})})};
    const core={state:{isAdmin:true,currentUser:{uid:'me'}},getFS:()=>new Promise(r=>pending.push(r)),
      registerUnsubscribe:f=>callbacks.push(f),escapeHtml:s=>s};
    const ctx={console,document:{hidden:false},__LF:{core}};ctx.window=ctx;
    vm.createContext(ctx);vm.runInContext(source(`lost-found/js/lost-found-${name}.js`),ctx);
    const view=ctx.__LF[name];
    if(name==='comments') view.render('post',el);else view.render(el);
    view.stop();pending.splice(0).forEach(r=>r(sdk));await flush();
    assert.equal(subscriptions.length,0,`${name}: stopped async start must not subscribe`);
    if(name==='comments') view.render('post',el);else view.render(el);
    pending.splice(0).forEach(r=>r(sdk));await flush();
    assert.equal(subscriptions.length,1,`${name}: visible start subscribes`);
    view.stop();assert.equal(subscriptions[0].stopped,true);
    assert.equal(callbacks.length,1,'register a stable cleanup once, not per render');
  }
});
