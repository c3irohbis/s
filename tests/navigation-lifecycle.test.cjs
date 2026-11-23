const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const html=require('./_app-source.cjs').source;
test('navigation stops chat on exit and resumes only on chat entry',()=>{
 const start=html.indexOf('window.showPage = (id) => {');
 const end=html.indexOf('\nfunction goTab(',start);
 const show=html.slice(start,end);
 assert.ok(show.includes('_stopChatListener'),'hook belongs inside showPage');
 const world=html.slice(html.indexOf('window.setActiveWorld ='),html.indexOf('window.setActiveWorld =')+1800);
 assert.ok(!world.includes('if (id !== "page-chat")'),'no undefined navigation id inside world setter');
 let stopped=0,polls=0,resumed=0;
 const ctx={Event:class{},queueMicrotask:f=>f(),document:{querySelector:()=>null,
   querySelectorAll:()=>[],getElementById:()=>({classList:{add(){}}})},
   _stopChatListener:()=>stopped++,_cleanupPollListeners:()=>polls++,
   _resumeVisibleChat:()=>resumed++,dispatchEvent(){}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(show,ctx);
 ctx.showPage('page-home');assert.equal(stopped,1);assert.equal(polls,1);assert.equal(resumed,0);
 ctx.showPage('page-chat');assert.equal(stopped,1);assert.equal(resumed,1);
});
