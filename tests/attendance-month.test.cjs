const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const s=fs.readFileSync(path.join(__dirname,'../js/attendance.js'),'utf8');const a=s.indexOf('let _attRecordsCache ='),b=s.indexOf('function _statusColor',a);const code=s.slice(a,b).replaceAll('export ','');
function ctxWith(sql){const els={};const ctx={window:{currentUser:{uid:'me'}},_el:id=>els[id]||(els[id]={innerHTML:'',insertAdjacentHTML:(w,t)=>{els[id].innerHTML+=t;}}),_cairoNow:()=>({dateStr:'2026-11-21'}),_sql:sql,_renderAttCalendar:()=>{ctx.window.__renders=(ctx.window.__renders||0)+1;}};ctx.els=els;vm.createContext(ctx);vm.runInContext(code,ctx);return ctx;}

test('attendance history loads one month range and lifetime stats through SQL only',async()=>{
 const calls=[];const sql=()=>({listRecords:async(from,to)=>{calls.push(['list',from,to]);return {'2026-11-20':{status:'present',totalSubjects:2,presentSubjects:2,absentSubjects:0,subjects:[{name:'A',status:'present'},{name:'B',status:'present'}],completedAt:'2026-11-20T10:00:00.000Z'}};},recordStats:async()=>{calls.push(['stats']);return{present:10,absent:10,total:20};}});
 const ctx=ctxWith(sql);await ctx.loadAttendanceHistory();
 assert.deepEqual(calls,[['list','2026-11-01','2026-12-01'],['stats']]);
 assert.equal(ctx.window.__renders,1);assert.ok(ctx.els.attHistStats.innerHTML.includes('50%'));
 assert.equal(ctx._attMonthBounds(2026,12).end,'2027-01-01');assert.equal(ctx._attMonthBounds(2028,2).end,'2028-03-01');
});

test('stale responses are ignored and failures never render as zero stats',async()=>{
 let resolve;const sql=()=>({listRecords:()=>new Promise(r=>resolve=r),recordStats:async()=>{throw Error('offline');}});
 const ctx=ctxWith(sql);const pending=ctx.loadAttendanceHistory();
 ctx.window.currentUser={uid:'other'};resolve({});await pending;
 assert.equal(ctx.window.__renders,undefined);assert.ok(!ctx.els.attHistStats.innerHTML.includes('%'));assert.ok(!ctx.els.attCalGrid.innerHTML.includes('تعذّر'));
 const sql2=()=>({listRecords:async()=>{throw Error('denied');},recordStats:async()=>({present:1,absent:1,total:2})});
 const ctx2=ctxWith(sql2);await ctx2.loadAttendanceHistory();
 assert.ok(ctx2.els.attCalGrid.innerHTML.includes('تعذّر'));assert.ok(ctx2.els.attHistStats.innerHTML.includes('50%'));
 const sql3=()=>({listRecords:async()=>({}),recordStats:async()=>{throw Error('offline');}});
 const ctx3=ctxWith(sql3);await ctx3.loadAttendanceHistory();
 assert.ok(ctx3.els.attHistStats.innerHTML.includes('تعذّر'));assert.ok(!ctx3.els.attHistStats.innerHTML.includes('0%'));
});
