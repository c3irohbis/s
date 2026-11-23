const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'../js/library.js'),'utf8');

test('live lectures listener is bounded by the page limit',()=>{
  assert.ok(s.includes('onSnapshot, limit }'),'limit imported');
  assert.ok(s.includes('orderBy("createdAt", "desc"), limit(_libLiveLimit)'),'query carries the limit');
  assert.ok(s.includes('const _LIB_PAGE       = 60;'),'page size constant');
  assert.ok(s.includes('_libMayHaveMore = snap.docs.length >= _libLiveLimit'),'full page sets mayHaveMore');
  assert.ok(s.includes('_libLiveLimit = _LIB_PAGE; _libMayHaveMore = false;'),'limit resets on account/world change');
});

test('load-more button lifecycle and listener growth',()=>{
  const a=s.indexOf('/* ── ترقيم الصفحات'), b=s.indexOf('// يعرض _libAllDocs الحالية');
  assert.ok(a>0&&b>a,'slice bounds');
  const stateAndRender=s.slice(a,b);
  const loadMore=s.slice(s.indexOf('// زرار "عرض المزيد"'), s.indexOf('function _libLiveStop'));
  const calls=[];
  const mk=()=>({kids:[],removed:false,style:{},appendChild(c){this.kids.push(c)},remove(){this.removed=true},addEventListener(t,f){this._click=f},disabled:false,textContent:''});
  const grid=mk();
  const doc={_btn:null,getElementById(id){if(id==='libSubjectGrid')return grid;if(id==='libLoadMoreBtn')return this._btn;return null},createElement(){this._btn=mk();return this._btn}};
  const ctx={document:doc,_libLiveCtx:{uid:'u1',world:'is_2',sig:'x'},_libLiveStop:()=>calls.push('stop'),_libLiveStart:()=>calls.push('start')};
  vm.createContext(ctx);
  vm.runInContext(stateAndRender+loadMore,ctx);
  // hidden while no more pages
  vm.runInContext('_libRenderLoadMore()',ctx);
  assert.equal(doc._btn,null,'no button without more pages');
  // appears when a full page was confirmed
  vm.runInContext('_libMayHaveMore = true; _libRenderLoadMore()',ctx);
  assert.ok(doc._btn,'button created');
  assert.equal(doc._btn.textContent,'عرض المزيد من المحاضرات');
  assert.ok(grid.kids.includes(doc._btn),'appended to grid');
  // click grows the page and recreates the listener once
  vm.runInContext('_libLoadMore()',ctx);
  assert.equal(vm.runInContext('_libLiveLimit',ctx),120,'limit grew by one page');
  assert.deepEqual(calls,['stop','start'],'listener recreated');
  assert.equal(doc._btn.disabled,true,'disabled while loading');
  assert.equal(doc._btn.textContent,'جارٍ التحميل…');
  // double click while loading is a no-op
  vm.runInContext('_libLoadMore()',ctx);
  assert.equal(vm.runInContext('_libLiveLimit',ctx),120,'no double growth');
  // hides again when the next page comes back short
  vm.runInContext('_libLoadingMore = false; _libMayHaveMore = false; _libRenderLoadMore()',ctx);
  assert.equal(doc._btn.removed,true,'button removed when exhausted');
});
