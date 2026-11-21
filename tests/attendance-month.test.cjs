const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const s=fs.readFileSync(path.join(__dirname,'../js/attendance.js'),'utf8');const a=s.indexOf('let _attRecordsCache ='),b=s.indexOf('function _statusColor',a);const code=s.slice(a,b).replaceAll('export ','');
test('attendance history reads one month and preserves lifetime stats with aggregate counts',async()=>{
 const els={},reads=[],counts=[];let renders=0,resolve;
 const ctx={window:{currentUser:{uid:'me'}},_el:id=>els[id]||(els[id]={innerHTML:''}),_db:()=>({}),_cairoNow:()=>({dateStr:'2026-11-21'}),collection:(...x)=>({collection:x}),where:(...x)=>({where:x}),documentId:()=> '__name__',query:(...x)=>x,getDocs:async q=>{reads.push(q);return {forEach:cb=>cb({id:'2026-11-20',data:()=>({status:'present'})})}},getCountFromServer:async q=>{counts.push(q);const count=counts.length<3?10:20;return {data:()=>({count})}},_renderAttCalendar:()=>renders++};
 vm.createContext(ctx);vm.runInContext(code,ctx);await ctx.loadAttendanceHistory();assert.equal(reads.length,1);assert.equal(counts.length,3);assert.equal(renders,1);assert.ok(els.attHistStats.innerHTML.includes('50%'));
 assert.ok(reads[0].some(x=>x.where?.[1]==='>='&&x.where[2]==='2026-11-01'));assert.ok(reads[0].some(x=>x.where?.[1]==='<'&&x.where[2]==='2026-12-01'));
 assert.equal(ctx._attMonthBounds(2026,12).end,'2027-01-01');assert.equal(ctx._attMonthBounds(2028,2).end,'2028-03-01');
 ctx.getDocs=()=>new Promise(r=>resolve=r);const pending=ctx._loadAttMonth();ctx.window.currentUser={uid:'other'};resolve({forEach:()=>{throw Error('must ignore stale response')}});await pending;assert.equal(renders,1);
});
test('offline months are labelled incomplete and aggregate failure is never shown as zero',async()=>{
 const els={};const ctx={window:{currentUser:{uid:'me'}},_el:id=>els[id]||(els[id]={innerHTML:'',insertAdjacentHTML:(where,text)=>els[id].innerHTML+=text}),_db:()=>({}),_cairoNow:()=>({dateStr:'2026-11-21'}),collection:()=>({}),where:()=>({}),documentId:()=> '__name__',query:(...x)=>x,getDocs:async()=>({metadata:{fromCache:true},forEach:()=>{}}),getCountFromServer:async()=>{throw Error('offline')},_renderAttCalendar:()=>{}};
 vm.createContext(ctx);vm.runInContext(code,ctx);await ctx.loadAttendanceHistory();assert.ok(els.attCalGrid.innerHTML.includes('بدون اتصال'));assert.ok(els.attHistStats.innerHTML.includes('تعذّر'));assert.ok(!els.attHistStats.innerHTML.includes('0%'));
 ctx.getDocs=async()=>{throw Error('denied')};await ctx._loadAttMonth();assert.ok(els.attCalGrid.innerHTML.includes('تعذّر'));
});
