const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'../js/calls.js'),'utf8');

test('inbox listener error handler self-heals with backoff',()=>{
  assert.ok(s.includes('inboxErrStreak++, inboxErrAt = Date.now()') || s.includes('inboxErrStreak++; inboxErrAt = Date.now();'),'error stamps the streak');
  assert.ok(s.includes('if (inboxUid === uid) inboxUid = null;'),'error clears subscription identity (guarded against account switch)');
  assert.ok(s.includes('Math.min(60000, 2000 * inboxErrStreak)'),'backoff gate caps at 60s, grows 2s/step');
  assert.ok(s.includes('inboxErrStreak = 0; /* بث سليم'),'healthy snapshot resets the backoff');
  assert.ok(!s.includes('onIncoming, function () {}'),'empty error handler is gone');
});

test('stream error kills state, backoff gates resubscribe, healthy tick resubscribes',async()=>{
  const a=s.indexOf('  async function ensureInbox()');
  const b=s.indexOf('  function onIncoming(snap)');
  assert.ok(a>0&&b>a,'slice bounds');
  const slice=s.slice(a,b);
  const subs=[],unsubCalls=[];
  const F={doc:(db,c,u)=>({c,u}),onSnapshot:(ref,onNext,onErr)=>{subs.push({ref,onNext,onErr});return()=>unsubCalls.push(ref)}};
  const ctx={curUid:()=> 'u1',window:{db:{}},fs:async()=>F,onIncoming:()=>{},inboxUnsub:null,inboxUid:null,inboxErrAt:0,inboxErrStreak:0};
  vm.createContext(ctx);
  vm.runInContext(slice,ctx);
  await vm.runInContext('ensureInbox()',ctx);
  assert.equal(subs.length,1,'subscribed once');
  assert.equal(vm.runInContext('inboxUid',ctx),'u1');
  // stream errors fatally
  subs[0].onErr({code:'unavailable'});
  assert.equal(vm.runInContext('inboxUid',ctx),null,'identity cleared');
  assert.equal(unsubCalls.length,1,'dead listener unsubscribed');
  assert.equal(vm.runInContext('inboxErrStreak',ctx),1,'streak recorded');
  // next 800ms tick: backoff gate holds (needs 2s for streak 1)
  await vm.runInContext('ensureInbox()',ctx);
  assert.equal(subs.length,1,'backoff blocks instant resubscribe');
  // backoff elapsed
  vm.runInContext('inboxErrAt = 0',ctx);
  await vm.runInContext('ensureInbox()',ctx);
  assert.equal(subs.length,2,'resubscribed after backoff');
  assert.equal(vm.runInContext('inboxUid',ctx),'u1');
  assert.equal(subs[1].ref.u,'u1','same inbox doc');
});
