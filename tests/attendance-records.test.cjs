const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../js/attendance-client.js'),'utf8');
function make(responder){
 const sent=[];
 const ctx={window:{__BLISS_ATTENDANCE_MODE:'supabase',currentUser:{uid:'u1',getIdToken:async()=>'tok'},activeWorldContext:()=>'is_1'},
  fetch:async(url,opts)=>{sent.push({url:String(url),opts});return{ok:true,status:200,json:async()=>responder(url,opts)};},
  AbortSignal:{timeout:()=>({})},crypto:{randomUUID:()=>'00000000-0000-4000-8000-000000000000'},URL};
 ctx.sent=sent;vm.createContext(ctx);vm.runInContext(src,ctx);return ctx;
}
const REC={status:'partial',totalSubjects:2,presentSubjects:1,absentSubjects:1,subjects:[{name:'Math',status:'present'},{name:'Phy',status:'absent'}],completedAt:'2026-11-20T10:00:00.000Z'};

test('listRecords validates shape strictly and keys records by day',async()=>{
 const ctx=make(()=>({source:'supabase',complete:true,data:[{day:'2026-11-19',...REC},{day:'2026-11-20',...REC,status:'absent',totalSubjects:1,presentSubjects:0,absentSubjects:1,subjects:[{name:'Math',status:'absent'}]}]}));
 const out=await ctx.window.AttendanceSQL.listRecords('2026-11-01','2026-12-01');
 assert.deepEqual(Object.keys(out),['2026-11-19','2026-11-20']);assert.equal(out['2026-11-20'].status,'absent');
 const u=new URL(ctx.sent[0].url);assert.equal(u.searchParams.get('world'),'is_1');assert.equal(u.searchParams.get('from'),'2026-11-01');assert.equal(u.searchParams.get('to'),'2026-12-01');
 const bad=[{day:'2026-11-19',...REC,status:'weird'},{day:'2026-11-19',...REC,totalSubjects:3},{day:'x',...REC},{day:'2026-99-99',...REC},{day:'2026-11-19',...REC,subjects:[{name:'',status:'present'},{name:'B',status:'absent'}]},{day:'2026-11-19',...REC,status:'present'},{day:'2026-11-19',...REC,subjects:[{name:'A',status:'present',extra:1},{name:'B',status:'absent'}]},{day:'2026-11-19',...REC,unexpected:1}];
 for(const row of bad){const c=make(()=>({source:'supabase',complete:true,data:[row]}));await assert.rejects(c.window.AttendanceSQL.listRecords('2026-11-01',null),/attendance-response/);}
 const dup=make(()=>({source:'supabase',complete:true,data:[{day:'2026-11-19',...REC},{day:'2026-11-19',...REC}]}));
 await assert.rejects(dup.window.AttendanceSQL.listRecords('2026-11-01',null),/attendance-response/);
 const incomplete=make(()=>({source:'supabase',complete:false,data:[]}));
 await assert.rejects(incomplete.window.AttendanceSQL.listRecords('2026-11-01',null),/attendance-invalid-payload/);
 await assert.rejects(ctx.window.AttendanceSQL.listRecords('20-11-01',null),/attendance-input/);
});

test('saveRecord sends validated record and requires exact ack',async()=>{
 const ctx=make(()=>({source:'supabase',complete:true,data:{day:'2026-11-20',saved:true}}));
 const ok=await ctx.window.AttendanceSQL.saveRecord('2026-11-20',REC);
 assert.equal(ok,true);
 const body=JSON.parse(ctx.sent[0].opts.body);assert.equal(body.world,'is_1');assert.equal(body.day,'2026-11-20');
 assert.deepEqual(body.record,REC);
 await assert.rejects(ctx.window.AttendanceSQL.saveRecord('2026-11-20',{...REC,extraKey:'rejected'}),/attendance-response/);
 await assert.rejects(ctx.window.AttendanceSQL.saveRecord('2026-13-01',REC),/attendance-input/);
 const wrongAck=make(()=>({source:'supabase',complete:true,data:{day:'2026-11-21',saved:true}}));
 await assert.rejects(wrongAck.window.AttendanceSQL.saveRecord('2026-11-20',REC),/attendance-response/);
 await assert.rejects(ctx.window.AttendanceSQL.saveRecord('2026/11/20',REC),/attendance-input/);
 await assert.rejects(ctx.window.AttendanceSQL.saveRecord('2026-11-20',{...REC,presentSubjects:2}),/attendance-response/);
});

test('recordStats requires non-negative integers consistent with total',async()=>{
 const ctx=make(()=>({source:'supabase',complete:true,data:{present:10,absent:5,total:15}}));
 const got=await ctx.window.AttendanceSQL.recordStats();assert.equal(got.present,10);assert.equal(got.absent,5);assert.equal(got.total,15);
 for(const s of[{present:-1,absent:5,total:15},{present:10,absent:10,total:15},{present:10,absent:5,total:20},{present:1.5,absent:5,total:15},{present:10,absent:5},{present:10,absent:5,total:15,extra:1}]){const c=make(()=>({source:'supabase',complete:true,data:s}));await assert.rejects(c.window.AttendanceSQL.recordStats(),/attendance-response/);}
});
