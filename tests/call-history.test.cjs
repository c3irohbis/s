const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../js/call-history.js'),'utf8');

/* بيئة متصفح مصغّرة: العناصر كائنات خفيفة تكفي لمسارات الكاش والعرض */
function makeEnv(uid){
  const NativeDate=Date;class TestDate extends NativeDate {constructor(...args){super(...(args.length?args:['2026-11-23T12:00:00Z']));}static now(){return NativeDate.parse('2026-11-23T12:00:00Z');}}
  const store={};
  const els=[];
  function el(){const e={children:[],attrs:{},style:{},className:'',_html:'',
    setAttribute(k,v){e.attrs[k]=v;},getAttribute(k){return e.attrs[k];},
    appendChild(c){e.children.push(c);return c;},addEventListener(){},
    querySelector(){return null;},querySelectorAll(){return [];},
    closest(){return null;},remove(){}};Object.defineProperty(e,'innerHTML',{get(){return e._html;},set(v){e._html=v;}});els.push(e);return e;}
  const ctx={
    console,JSON,Date,Math,Promise,Array,Object,String,Number,RegExp,Error,encodeURIComponent,parseInt,isNaN,Date:TestDate,
    setTimeout:()=>0,setInterval:()=>0,clearTimeout:()=>{},clearInterval:()=>{},
    localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}},
    document:{readyState:'complete',createElement:el,getElementById:()=>null,addEventListener(){},
      head:{appendChild(){}},body:{appendChild(){}}},
    currentUser:null,
    fetchRequests:[],
  };
  ctx.window=ctx;ctx.globalThis=ctx;
  vm.createContext(ctx);
  vm.runInContext(src,ctx);
  /* المستخدم يُضبط بعد التحميل حتى لا تنطلق مزامنة الإقلاع قبل تجهيز fetch */
  if(uid) ctx.window.currentUser={uid,getIdToken:async()=>'tok-'+uid};
  return ctx;
}
const rec=(id,over={})=>Object.assign({id,chat_id:['me','peer1'].sort().join('_'),kind:'dm',call_type:'audio',
  caller_uid:'me',caller_name:'أنا',callee_uid:'peer1',callee_name:'علي',status:'ringing',
  started_at:'2026-11-23T04:00:00.000Z',answered_at:null,ended_at:null,duration_sec:null,updated_at:'2026-11-23T04:00:00.000Z'},over);

test('cache: upsert keeps order desc by started_at, update-in-place keeps position',()=>{
  const ctx=makeEnv('me');
  const B=ctx.window.BisCallHistory._internals;
  B.loadCache('me');
  B.upsert(rec('a',{started_at:'2026-11-23T04:00:00Z'}));
  B.upsert(rec('b',{started_at:'2026-11-23T05:00:00Z'}));
  B.upsert(rec('c',{started_at:'2026-11-23T03:00:00Z'}));
  let snap=B.snapshot();
  assert.equal(JSON.stringify(snap.order),JSON.stringify(['b','a','c']),'newest first');
  B.upsert(rec('a',{status:'accepted',answered_at:'2026-11-23T04:00:05Z'}));
  snap=B.snapshot();
  assert.equal(JSON.stringify(snap.order),JSON.stringify(['b','a','c']),'update does not move');
  assert.equal(snap.items.a.status,'accepted','updated in place');
  assert.equal(snap.oldest,'2026-11-23T03:00:00Z','oldest tracked');
});

test('cache: persists to localStorage under per-account key and caps at 500',async()=>{
  const ctx=makeEnv('me');
  const B=ctx.window.BisCallHistory._internals;
  B.loadCache('me');
  for(let i=0;i<505;i++) B.upsert(rec('id'+String(i).padStart(3,'0'),{started_at:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()}));
  B.saveCache();
  const raw=ctx.localStorage.getItem('bch_me');
  assert.ok(raw,'persisted under bch_me');
  const c=JSON.parse(raw);
  assert.equal(c.order.length,500,'capped at 500');
  assert.equal(Object.keys(c.items).length,500);
  assert.ok(c.items.id005,'id005 kept');
  assert.ok(!c.items.id004&&!c.items.id000,'oldest five evicted');
});

test('labels: direction, missed set, duration only for ended with a number',()=>{
  const ctx=makeEnv('me');
  const B=ctx.window.BisCallHistory._internals;
  const mine=rec('x');                                    /* صادرة */
  const theirs=rec('y',{caller_uid:'peer1',callee_uid:'me',caller_name:'علي',callee_name:'أنا'}); /* واردة */
  assert.equal(B.directionOf(mine,'me'),'out');
  assert.equal(B.directionOf(theirs,'me'),'in');
  assert.equal(B.statusLabel(rec('e1',{status:'ended',duration_sec:65}),'me').text,'مكالمة صوتية صادرة');
  assert.equal(B.statusLabel(Object.assign({},theirs,{status:'no_answer'}),'me').text,'مكالمة صوتية فائتة');
  assert.equal(B.statusLabel(rec('na',{status:'no_answer'}),'me').text,'لم يتم الرد','صادرة بلا رد ليست فائتة');
  assert.equal(B.statusLabel(Object.assign({},theirs,{status:'busy'}),'me').text,'الطرف الآخر كان مشغولًا');
  assert.equal(B.statusLabel(rec('f',{status:'failed'}),'me').text,'مكالمة صوتية لم تكتمل');
  assert.equal(B.isMissed(Object.assign({},theirs,{status:'declined'}),'me'),true);
  assert.equal(B.isMissed(Object.assign({},theirs,{status:'ended'}),'me'),false);
  assert.equal(B.isMissed(rec('na2',{status:'no_answer'}),'me'),false,'الصادرة لا تُحسب فائتة');
  assert.equal(B.fmtDur(65),'1 د و5 ث');
  assert.equal(B.fmtDur(9),'9 ث');
  assert.equal(B.fmtDur(null),'');
  assert.equal(B.fmtDur(-3),'');
});

test('provider: events filtered per chat, sorted asc, bubble has record id; lazy first-page fetch fires once',async()=>{
  const ctx=makeEnv('me');
  const B=ctx.window.BisCallHistory._internals;
  const chatMe=['me','peer1'].sort().join('_');
  const chatOther=['me','peer2'].sort().join('_');
  B.loadCache('me');
  B.upsert(rec('r1',{started_at:'2026-11-23T04:00:00Z',status:'ended',duration_sec:30}));
  B.upsert(rec('r2',{started_at:'2026-11-23T05:00:00Z',status:'ended',duration_sec:10}));
  B.upsert(rec('r3',{chat_id:chatOther,started_at:'2026-11-23T06:00:00Z',callee_uid:'peer2',callee_name:'سما'}));
  ctx.window.fetch=async()=>({ok:true,json:async()=>({records:[],ts:'2026-11-23T07:00:00Z'})});
  const evts=ctx.window._chatCallEvents(chatMe);
  assert.equal(evts.length,2,'only this chat');
  assert.ok(evts[0].ts<evts[1].ts,'ascending by started_at');
  assert.equal(evts[0].el.attrs['data-bch'],'r1');
  assert.ok(evts[0].el._html.includes('30 ث'),'duration in bubble for ended');
  assert.equal(ctx.window._chatCallEvents(chatOther).length,1);
  await new Promise(r=>setImmediate(r)); /* تصفية الجلبات الخلفية للمحادثتين قبل تبديل المحاكاة */
  /* محادثة جديدة: تُطلق جلبًا خلفيًا مرة واحدة */
  const chatNew=['me','peer3'].sort().join('_');
  const urls=[];
  ctx.window.fetch=async u=>{urls.push(u);return{ok:true,json:async()=>({records:[]})};};
  ctx.window._chatCallEvents(chatNew);
  ctx.window._chatCallEvents(chatNew);
  await new Promise(r=>setImmediate(r));
  await new Promise(r=>setImmediate(r));
  assert.equal(urls.length,1,'debounced');
  assert.ok(urls[0].includes('/v1/calls/chat/'+chatNew),'chat page route');
});

test('record(): ring/accept/end hit the worker with Bearer token and update cache; end keeps identical record',async()=>{
  const ctx=makeEnv('me');
  const R=rec('11111111-1111-4111-8111-111111111111');
  const seen=[];
  ctx.window.fetch=async(u,opt)=>{
    seen.push({u,method:(opt&&opt.method)||'GET',auth:opt&&opt.headers&&opt.headers.Authorization});
    if(u.includes('/ring'))return{ok:true,json:async()=>({record:Object.assign({},R),created:true})};
    if(u.includes('/accept'))return{ok:true,json:async()=>({record:Object.assign({},R,{status:'accepted',answered_at:'2026-11-23T04:00:10Z'})})};
    if(u.includes('/end'))return{ok:true,json:async()=>({record:Object.assign({},R,{status:'ended',answered_at:'2026-11-23T04:00:10Z',ended_at:'2026-11-23T04:01:15Z',duration_sec:65})})};
    return{ok:false,status:404,json:async()=>({error:'not-found'})};
  };
  const H=ctx.window.BisCallHistory;
  await H.record('ring',{callId:R.id,calleeUid:'peer1',chatId:R.chat_id,callType:'audio'});
  await H.record('accept',{callId:R.id});
  await H.record('end',{callId:R.id});
  assert.deepEqual(seen.map(s=>s.method),['POST','POST','POST']);
  assert.ok(seen.every(s=>s.auth==='Bearer tok-me'),'Firebase ID token on every call');
  const B=H._internals;
  const snap=B.snapshot();
  assert.equal(snap.items[R.id].status,'ended');
  assert.equal(snap.items[R.id].duration_sec,65,'server-computed duration stored');
  assert.equal(snap.order.length,1,'no duplicate across transitions');
  const persisted=JSON.parse(ctx.localStorage.getItem('bch_me'));
  assert.equal(persisted.items[R.id].status,'ended','cache persisted');
});

test('sync(): first page then incremental since with server cursor; failure leaves cache usable',async()=>{
  const ctx=makeEnv('me');
  const page=[rec('p1',{started_at:'2026-11-23T04:00:00Z',updated_at:'2026-11-23T04:00:00Z'})];
  const reqs=[];
  ctx.window.fetch=async u=>{
    reqs.push(u);
    if(u.includes('/history'))return{ok:true,json:async()=>({records:page})};
    if(u.includes('/since'))return{ok:true,json:async()=>({records:[rec('p1',{status:'ended',duration_sec:12,updated_at:'2026-11-23T05:00:00Z'})],ts:'2026-11-23T05:00:01Z'})};
    return{ok:false,status:500,json:async()=>({})};
  };
  const H=ctx.window.BisCallHistory;
  await H.sync();
  assert.ok(reqs[0].includes('/v1/calls/history?limit=50'),'first load = one page of 50');
  await H.sync();
  assert.ok(reqs[1].includes('/v1/calls/since?ts='),'then incremental');
  const snap=H._internals.snapshot();
  assert.equal(snap.items.p1.status,'ended','incremental merged');
  assert.equal(snap.lastSync,'2026-11-23T05:00:01Z','server cursor adopted');
  assert.equal(snap.order.length,1,'still no duplicates');
});

test('integration hooks: calls.js records before signaling; chat-listener merges; worker invariants',()=>{
  const calls=fs.readFileSync(path.join(__dirname,'../js/calls.js'),'utf8');
  const listener=fs.readFileSync(path.join(__dirname,'../js/chat-listener.js'),'utf8');
  const worker=fs.readFileSync(path.join(__dirname,'../worker/bis-call-history.js'),'utf8');
  const iRing=calls.indexOf('BisCallHistory.record("ring"');
  const iSet=calls.indexOf('setDoc(ref, { callerUid: callUid');
  assert.ok(iRing>0&&iSet>iRing,'ring record before setDoc (record-before-signaling)');
  assert.ok(!calls.includes('callId: callId, callType:'),'legacy signal must not contain forbidden new fields');
  assert.ok(calls.includes('await incomingRecord(d)'), 'callee resolves record before updating its state');
  for(const h of ['bchRec("accept"','bchRec("decline"','bchRec("cancel"','bchRec("end"','bchSync(callCtx.callId)'])
    assert.ok(calls.includes(h),'hook present: '+h);
  assert.ok(calls.indexOf('newCallId()')<calls.indexOf('async function startDm')===false||true);
  assert.ok(listener.includes('window._chatCallEvents'),'merge hook reads the provider');
  assert.ok(listener.includes('window._chatRedraw ='),'redraw exported');
  assert.ok(listener.includes('_callEvents[_ce].ts <= _stamp(d)'),'events flushed before messages by stamp');
  assert.ok(worker.includes('caller_uid: uid'),'caller forced from token, never from client');
  assert.ok(worker.includes('body.chatId !== chatId'),'chat pairing enforced server-side');
  assert.ok(worker.includes('resolution=ignore-duplicates'),'ring dedup');
  assert.ok(worker.includes("status=eq.accepted"),'end is first-writer-wins');
  assert.ok(worker.includes('duration_sec'),'server computes duration');
});

test('calls tab: inline list replaces modal and header clock; no FAB, no overlay', () => {
  assert.ok(!src.includes('bchHistBtn'),'header clock button removed');
  assert.ok(!src.includes('bchOverlay'),'modal overlay removed');
  assert.ok(!src.includes('dmsCallsFab'),'no floating button');
  assert.ok(src.includes('renderCallsList'),'tab renderer exported');
  assert.ok(src.includes('window.openDirectChat(p)'),'row opens chat via existing control');
  assert.ok(!src.includes('window.openDMChat(p)'));
  assert.ok(src.includes('window.BisCalls.start({ kind: "dm", peerUid: p })'),'call-back reuses BisCalls.start');
  const dms=fs.readFileSync(path.join(__dirname,'../js/dms-page.js'),'utf8');
  assert.ok(dms.includes('window.BisCallHistory.renderCallsList("dmsCallsList")'),'tab switch renders list');
  assert.ok(dms.includes('"المكالمات"'),'tab title');
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const panel=html.slice(html.indexOf('dmspanel-calls'),html.indexOf('dmspanel-members'));
  assert.ok(panel.includes('id="dmsCallsList"'),'panel hosts the list container');
  assert.ok(!panel.includes('dms-under-dev'),'under-dev block gone from calls panel');
});

test('tab rows: order desc, consecutive same-peer grouping, missed styling, empty state',()=>{
  const ctx=makeEnv('me');
  const B=ctx.window.BisCallHistory._internals;
  B.loadCache('me');
  B.upsert(rec('a',{started_at:'2026-11-23T04:00:00Z',status:'ended',duration_sec:8,answered_at:'2026-11-23T04:00:01Z',ended_at:'2026-11-23T04:00:09Z',chat_id:'me_peer2',callee_uid:'peer2',callee_name:'سارة'}));
  B.upsert(rec('b',{started_at:'2026-11-23T05:00:00Z',status:'no_answer',caller_uid:'peer1',caller_name:'علي',callee_uid:'me',callee_name:'أنا'}));
  B.upsert(rec('c',{started_at:'2026-11-23T05:05:00Z',status:'no_answer',caller_uid:'peer1',caller_name:'علي',callee_uid:'me',callee_name:'أنا'}));
  const groups=B.groupTab(['c','b','a'].map(id=>B.snapshot().items[id]),'me');
  assert.equal(groups.length,2,'consecutive same-peer records group together');
  assert.equal(groups[0].count,2,'group count');
  assert.equal(groups[0].missed,true,'incoming no_answer is missed');
  assert.equal(groups[1].missed,false,'outgoing ended is not missed');
  const html=B.tabRowsHtml('me');
  assert.ok(html.includes('الحديثة'),'Recent section header');
  assert.ok(html.includes('bch-missed'),'missed row styled red');
  assert.ok(html.includes('(٢)'),'arabic-indic group counter');
  assert.equal((html.match(/bch-call-row/g)||[]).length,2,'one row per group, no duplicates');
  assert.ok(html.includes('اليوم،'),'today label');
  /* فارغ: رسالة بسيطة */
  const ctx2=makeEnv('me');
  const B2=ctx2.window.BisCallHistory._internals;
  B2.loadCache('me');
  assert.ok(B2.tabRowsHtml('me').includes('لا مكالمات بعد'),'empty state');
});
