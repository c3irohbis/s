const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/dm-extras.js'),'utf8');
const start=source.indexOf('let _exCaptureGeneration');
const end=source.indexOf('/* ═',start);
const code=source.slice(start,end);
test('first unread anchor fetches one ordered peer message and ignores stale responses',async()=>{
 const reads=[],anchors=[];
 const ctx={document:{hidden:false},db:{},_currentChatId:'peer',_exRoomId:()=> 'pair',
  collection:(...v)=>v,where:(...v)=>({where:v}),orderBy:(...v)=>({orderBy:v}),limit:n=>({limit:n}),query:(...v)=>v,
  getDocs:q=>new Promise(resolve=>reads.push({q,resolve})),_exWatchAndInsertDivider:(...v)=>anchors.push(v)};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);
 const a=ctx._exCaptureUnreadDivider('peer');const b=ctx._exCaptureUnreadDivider('peer');
 assert.ok(reads[0].q.some(p=>p.limit===1));
 assert.ok(reads[0].q.some(p=>p.orderBy?.[0]==='createdAt' && p.orderBy[1]==='asc'));
 reads[0].resolve({docs:[{id:'stale'}]});await a;assert.equal(anchors.length,0);
 reads[1].resolve({docs:[{id:'first-unread'}]});await b;assert.equal(anchors[0][2],'first-unread');
});
