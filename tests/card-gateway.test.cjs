const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../js/card-gateway.js'),'utf8');

/* بيئة متصفح مصطنعة: window/session/local/fetch قابلة للضبط لكل اختبار */
function makeCtx(over={}){
 const ss={},ls={};
 let clockOffset=0;
 class TestDate extends Date { static now(){ return super.now()+clockOffset; } }
 const ctx={
  console,
  Date:TestDate,
  JSON,
  Promise,
  setTimeout,clearTimeout,
  AbortController,
  AbortSignal,
  Response,
  URL,
  encodeURIComponent,
  _advance:(ms)=>{clockOffset+=ms},
  sessionStorage:{getItem:k=>ss[k]??null,setItem:(k,v)=>{ss[k]=String(v)},removeItem:k=>{delete ss[k]}},
  localStorage:{getItem:k=>ls[k]??null,setItem:(k,v)=>{ls[k]=String(v)},removeItem:k=>{delete ls[k]}},
  window:{currentUser:{uid:'u1',getIdToken:async()=>'tok'},isOwner:()=>false},
  fetch:async()=>{throw new Error('unset fetch')},
  _ss:ss,_ls:ls,
  ...over,
 };
 ctx.window.CardGateway=undefined;
 vm.createContext(ctx);
 vm.runInContext(code,ctx);
 return ctx;
}
const cfgBody={v:1,data:{cards:{news:'gateway'}}};
const newsItems=[
 {id:'n1',title:'خبر',body:'ت1',worldId:'is_2',createdAt:'2026-11-20T10:00:00Z'},
 {id:'n2',title:'خبر2',body:'ت2',worldId:'is_2',createdAt:'2026-11-21T10:00:00Z'},
];
const okContent=(items=newsItems)=>({v:1,data:items,etag:'"e1"',ts:Date.now(),meta:{complete:true,count:items.length,expected_count:items.length,version:1,generatedAt:Date.now(),etag:'"e1"'}});
function fetchQueue(ctx,handlers){
 let i=0;
 ctx.fetch=async(url,opts)=>{
  const h=handlers[Math.min(i++,handlers.length-1)];
  return h(url,opts);
 };
}
const res=(status,body,headers={})=>new Response(body===null||body===undefined?null:(typeof body==='string'?body:JSON.stringify(body)),{status,headers});

test('mode firebase: no content request leaves, serveCard returns false (fallback to Firestore)',async()=>{
 const ctx=makeCtx();
 let calls=0;
 fetchQueue(ctx,[async()=>{calls++;return res(200,{v:1,data:{cards:{news:'firebase'}}})}]);
 const served=await ctx.window.CardGateway.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},()=>{});
 assert.equal(served,false);
 assert.equal(calls,1); // إعداد فقط، بلا طلب محتوى
});

test('gateway mode: news served, docs wrapped like Firestore docs for the existing renderer',async()=>{
 const ctx=makeCtx();
 fetchQueue(ctx,[
  async()=>res(200,cfgBody),
  async()=>res(200,okContent(),{ETag:'"e1"'}),
 ]);
 let rendered=null;
 const served=await ctx.window.CardGateway.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},docs=>{rendered=docs;});
 assert.equal(served,true);
 assert.equal(rendered.length,2);
 const d=rendered[0].data();
 assert.equal(rendered[0].id,'n1');
 assert.equal(d.title,'خبر');
 assert.equal(d.createdAt.toDate().toISOString(),'2026-11-20T10:00:00.000Z');
});

test('gateway 503/4xx: fallback + circuit breaker trips (no more attempts for a minute)',async()=>{
 const ctx=makeCtx();
 let contentCalls=0;
 fetchQueue(ctx,[
  async()=>res(200,cfgBody),
  async()=>{contentCalls++;return res(503,{error:{code:'disabled'}})},
 ]);
 const served=await ctx.window.CardGateway.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},()=>{});
 assert.equal(served,false);
 assert.equal(contentCalls,1);
 // القاطع مفتوح: محاولة ثانية لا تصل حتى الإعداد
 const served2=await ctx.window.CardGateway.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},()=>{});
 assert.equal(served2,false);
 assert.equal(contentCalls,1);
});

test('gateway 5xx then network error: retries then falls back to Firestore',async()=>{
 const ctx=makeCtx();
 let contentCalls=0;
 fetchQueue(ctx,[
  async()=>res(200,cfgBody),
  async()=>{contentCalls++;return res(502,{error:{code:'supabase_error'}})},
  async()=>{contentCalls++;throw new Error('netdown')},
  async()=>{contentCalls++;return res(502,{error:{code:'supabase_error'}})},
 ]);
 const served=await ctx.window.CardGateway.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},()=>{});
 assert.equal(served,false);
 assert.equal(contentCalls,3); // محاولة + إعادتان كحد أقصى
});

test('invalid envelope (count mismatch / bad item shape) is rejected → fallback',async()=>{
 const ctx=makeCtx();
 fetchQueue(ctx,[
  async()=>res(200,cfgBody),
  async()=>res(200,{v:1,data:[...newsItems,{id:'x',title:5,body:'b',worldId:'is_2',createdAt:null}],ts:Date.now(),meta:{complete:true,count:3,version:1,generatedAt:Date.now()}}),
 ]);
 const served=await ctx.window.CardGateway.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},()=>{});
 assert.equal(served,false);
 const ctx2=makeCtx();
 fetchQueue(ctx2,[
  async()=>res(200,cfgBody),
  async()=>res(200,{v:1,data:newsItems,ts:Date.now(),meta:{complete:true,count:99,version:1,generatedAt:Date.now()}}),
 ]);
 assert.equal(await ctx2.window.CardGateway.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},()=>{}),false);
});

test('D9=A strict: every open/return fetches fresh; no timer/poll path exists',async()=>{
 const ctx=makeCtx();
 let contentCalls=0;
 ctx.fetch=async(url)=>{
  if(String(url).endsWith('/v1/config')) return res(200,cfgBody);
  contentCalls++;
  return res(200,okContent(),{ETag:'"e1"'});
 };
 const cg=ctx.window.CardGateway;
 assert.equal(cg.refetchIfDue,undefined); // لا يوجد أي مسار إعادة جلب — أُزيل كليًا (مراجعة المالك نقطة 1)
 const ctxA={uid:'u1',world:'is_2',sig:'u1|is_2'};
 assert.equal(await cg.serveCard('news',ctxA,()=>{}),true);
 assert.equal(contentCalls,1);
 // رجوع حقيقي (إغلاق ثم فتح = serveCard جديد) ← جلب جديد دائمًا حتى لو خلال ثوانٍ
 assert.equal(await cg.serveCard('news',ctxA,()=>{}),true);
 assert.equal(contentCalls,2);
});

test('world isolation: in-flight requests are keyed per (card,world); old-world data never reaches new world',async()=>{
 const ctx=makeCtx();
 const pending={};
 ctx.fetch=async(url)=>{
  const s=String(url);
  if(s.endsWith('/v1/config')) return res(200,cfgBody);
  const w=/world=(\w+)/.exec(s)[1];
  return new Promise(resolve=>{pending[w]=resolve});
 };
 const cg=ctx.window.CardGateway;
 let docsA=null,docsB=null;
 const pA=cg.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},d=>{docsA=d;});
 const pB=cg.serveCard('news',{uid:'u1',world:'lt_1',sig:'u1|lt_1'},d=>{docsB=d;});
 await new Promise(r=>setTimeout(r,20));
 assert.ok(pending['is_2']&&pending['lt_1']); // طلبان منفصلان — لا ديدوب عبر العوالم
 // استجابة العالم الجديد أولًا، ثم القديم لاحقًا: كل عالم يستلم بياناته فقط
 pending['lt_1'](res(200,okContent([{id:'b1',title:'خبر لغات',body:'ت',worldId:'lt_1',createdAt:'2026-11-21T10:00:00Z'}])));
 await pB;
 assert.equal(docsB.length,1); assert.equal(docsB[0].id,'b1'); assert.equal(docsA,null);
 pending['is_2'](res(200,okContent([{id:'a1',title:'خبر نظم',body:'ت',worldId:'is_2',createdAt:'2026-11-20T10:00:00Z'}])));
 await pA;
 assert.equal(docsA.length,1); assert.equal(docsA[0].id,'a1'); assert.equal(docsB.length,1);
});

test('cross-world leak inside a response is rejected (item worldId must equal requested world)',async()=>{
 const ctx=makeCtx();
 fetchQueue(ctx,[
  async()=>res(200,cfgBody),
  async()=>res(200,okContent([newsItems[0],{id:'x',title:'متسلل',body:'ت',worldId:'lt_1',createdAt:null}])),
 ]);
 const served=await ctx.window.CardGateway.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},()=>{});
 assert.equal(served,false);
});

test('payload caps: >500 items, oversized title/body are rejected',async()=>{
 const ctx=makeCtx();
 const big=Array.from({length:501},(_,i)=>({id:'n'+i,title:'خبر',body:'ت',worldId:'is_2',createdAt:null}));
 fetchQueue(ctx,[async()=>res(200,cfgBody),async()=>res(200,okContent(big))]);
 assert.equal(await ctx.window.CardGateway.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},()=>{}),false);
 const ctx2=makeCtx();
 fetchQueue(ctx2,[async()=>res(200,cfgBody),async()=>res(200,okContent([{id:'n1',title:'خ'.repeat(501),body:'ت',worldId:'is_2',createdAt:null}]))]);
 assert.equal(await ctx2.window.CardGateway.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},()=>{}),false);
 const ctx3=makeCtx();
 fetchQueue(ctx3,[async()=>res(200,cfgBody),async()=>res(200,okContent([{id:'n1',title:'خبر',body:'ت'.repeat(10001),worldId:'is_2',createdAt:null}]))]);
 assert.equal(await ctx3.window.CardGateway.serveCard('news',{uid:'u1',world:'is_2',sig:'u1|is_2'},()=>{}),false);
});

test('syncAfterWrite posts to the card URL with key+world; failure queues pending (never throws)',async()=>{
 const ctx=makeCtx();
 let seen=null;
 ctx.fetch=async(url,opts)=>{seen={url,body:JSON.parse(opts.body)};return res(200,{v:1,data:{results:[{key:'n1',action:'applied'}]}});};
 await ctx.window.CardGateway.syncAfterWrite('news','n1','is_2');
 await new Promise(r=>setTimeout(r,50));
 assert.ok(seen.url.endsWith('/v1/cards/news/sync'));
 assert.deepEqual(seen.body,{key:'n1',world:'is_2'});
 // فشل ← قائمة معلّقة، والنداء نفسه لا يرمي أبدًا
 ctx.fetch=async()=>{throw new Error('netdown')};
 await ctx.window.CardGateway.syncAfterWrite('news','n9','lt_1');
 await new Promise(r=>setTimeout(r,50));
 assert.deepEqual(JSON.parse(ctx._ls['gwPendingSync:news']),[{key:'n9',world:'lt_1'}]);
 // كارت غير مسجل: لا شيء إطلاقًا
 seen=null;
 ctx.fetch=async()=>{seen=true;return res(200)};
 ctx.window.CardGateway.syncAfterWrite('exams','e1','is_2');
 await new Promise(r=>setTimeout(r,50));
 assert.equal(seen,null);
});

test('unregistered card: serveCard returns false immediately without any request',async()=>{
 const ctx=makeCtx();
 let calls=0;
 ctx.fetch=async()=>{calls++;return res(200,cfgBody)};
 assert.equal(await ctx.window.CardGateway.serveCard('exams',{uid:'u1',world:'is_2'},()=>{}),false);
 assert.equal(calls,0);
});
