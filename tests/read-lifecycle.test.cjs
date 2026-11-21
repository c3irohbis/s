const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = p => fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const flush = () => new Promise(r => setImmediate(r));

test('all lost-found views cancel pending starts and detach active subscriptions',async()=>{
  for(const name of ['feed','admin']) {
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
