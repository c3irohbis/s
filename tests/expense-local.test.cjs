const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const s=fs.readFileSync(path.join(__dirname,'../js/expenses.js'),'utf8');
const a=s.indexOf('  window.ExpensesModule._save ='),b=s.indexOf('  /* ═══════════ الميزانية',a);const code=s.slice(a,b);
test('successful expense mutations update local records without rereading full history; failures and account switches do not',async()=>{
 let uid='me',reads=0,render=0;const fsMock={db:{},collection:(...x)=>x,doc:(...x)=>x,addDoc:async()=>({id:'new'}),updateDoc:async()=>{},deleteDoc:async()=>{},serverTimestamp:()=>({})};
 const ctx={window:{ExpensesModule:{},toast:()=>{},confirm:()=>true},_all:[{id:'old',amount:10,category:'food',date:'2026-11-20'}],_draft:{amount:20,category:'food',date:'2026-11-21'},_num:Number,_uid:()=>uid,_fs:async()=>fsMock,_loadAll:async()=>reads++,_setTitle:()=>{},_renderHome:()=>render++};
 vm.createContext(ctx);vm.runInContext(code,ctx);await ctx.window.ExpensesModule._save();assert.equal(ctx._all.length,2);assert.equal(ctx._all[1].id,'new');assert.equal(reads,0);
 ctx._draft={id:'old',amount:30,category:'books',date:'2026-11-21'};await ctx.window.ExpensesModule._save();assert.equal(ctx._all[0].amount,30);await ctx.window.ExpensesModule._delete('old');assert.equal(ctx._all.length,1);assert.equal(reads,0);
 fsMock.updateDoc=async()=>{throw Error('failed')};ctx._draft={id:'new',amount:40,category:'food',date:'2026-11-21'};await ctx.window.ExpensesModule._save();assert.equal(ctx._all[0].amount,20);
 fsMock.updateDoc=async()=>{uid='other'};const n=render;await ctx.window.ExpensesModule._save();assert.equal(ctx._all[0].amount,20);assert.equal(render,n);
});
