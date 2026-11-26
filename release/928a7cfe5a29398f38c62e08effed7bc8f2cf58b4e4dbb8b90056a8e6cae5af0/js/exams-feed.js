/* Exams-only UI. No Firestore dependency or fallback. Same item-card layout as the legacy renderer. */
(function(){'use strict';let gen=0,unsub=null,ctx=null,next=null,loading=false,queued=false,mutation=null;
const sigOf=c=>c.uid+'|'+c.world;
const shown=()=>{const e=document.getElementById('tab-exams-content');return !!e&&e.style.display!=='none'&&e.getClientRects().length>0&&!document.hidden};
const current=()=>({uid:window.currentUser?.uid,world:window.activeWorldContext?.()});
const listEl=()=>document.getElementById('examsList');
function stop(){gen++;unsub?.();unsub=null;ctx=null;next=null;loading=false;queued=false;}
function valid(g,c){const n=current();return g===gen&&c.uid===n.uid&&c.world===n.world&&shown()}
function line(icon,text){const d=document.createElement('div');d.className='item-sub';const i=document.createElement('i');i.className='fa-solid '+icon;d.append(i,' ',text);return d}
function card(row,g,c){const p=row.payload||{},div=document.createElement('div');div.className='item-card';
 const t=document.createElement('div');t.className='item-title';const ti=document.createElement('i');ti.className='fa-solid fa-thumbtack';t.append(ti,' ',String(p.subject||''));div.append(t);
 if(p.date)div.append(line('fa-calendar',String(p.date)));if(p.time)div.append(line('fa-clock',String(p.time)));if(p.room)div.append(line('fa-school',String(p.room)));
 if(window.isAdmin?.()){const del=document.createElement('button');del.className='del-btn';del.innerHTML='<i class="fa-solid fa-trash-can"></i> حذف';del.onclick=async()=>{if(!valid(g,c))return;del.disabled=true;try{await ExamsAPI.request('mutate',{method:'POST',body:{world:c.world,action:'delete',id:row.id,expectedRevision:row.revision,requestId:crypto.randomUUID()}});if(valid(g,c)){window.toast?.('تم الحذف');await load(false)}}catch{window.toast?.('فشل الحذف','error')}finally{del.disabled=false}};div.append(del)}
 return div}
function render(data,g,c,append){const list=listEl();if(!list)return;if(!append)list.replaceChildren();list.dataset.examsSig=sigOf(c);list.querySelector('.exams-next')?.remove();list.querySelector('.empty-state')?.remove();
 for(const row of data.items)list.append(card(row,g,c));
 if(!list.children.length){const e=document.createElement('div');e.className='empty-state';e.textContent='لم تتم الإضافة بعد';list.append(e)}
 next=data.nextCursor;if(next){const b=document.createElement('button');b.className='btn exams-next';b.textContent='التالي';b.onclick=()=>load(true);list.append(b)}
 if(!append){ExamsAPI.request('read',{method:'POST',body:{world:c.world,viewToken:data.viewToken}}).then(()=>{if(g===gen)window.dispatchEvent(new Event('exams-read'))}).catch(()=>{})}}
async function load(append=false){if(!ctx)return;if(loading){if(!append)queued=true;return;}const c={...ctx},g=gen;loading=true;const list=listEl();
 try{const data=await ExamsAPI.request('list',{world:c.world,cursor:append?next:null});if(!valid(g,c))return;if(!Array.isArray(data.items)||data.items.length>60||data.items.some(x=>x.world_id!==c.world))throw Error('exams-response');render(data,g,c,append)}
 catch(e){if(valid(g,c)){if(e.status===409&&append){next=null;queued=true}else if(e.status===401||e.status===403){list?.replaceChildren();next=null;window.dispatchEvent(new Event('exams-authority-denied'))}else if(list&&list.dataset.examsSig!==sigOf(c)&&!list.querySelector('.item-card')){list.replaceChildren();const d=document.createElement('div');d.className='empty-state';d.textContent='تعذر تحميل الامتحانات. أعد فتح الكارت للمحاولة.';list.append(d)}}}
 finally{if(g===gen){loading=false;if(queued){queued=false;void load(false)}}}}
function sync(){const c=current();const list=listEl();if(list?.dataset.examsSig&&list.dataset.examsSig!==sigOf(c)){list.replaceChildren();delete list.dataset.examsSig;}
 if(!ExamsAPI.enabled()||!shown()||!c.uid||!c.world){stop();return}if(ctx?.uid===c.uid&&ctx?.world===c.world)return;stop();ctx=c;unsub=ExamsAPI.subscribe(()=>load(false));void load(false)}
async function add(fields,{world,requestId,id}={}){const c=current();if(!c.uid||!world)throw Error('exams-context');const signature=JSON.stringify({uid:c.uid,world,f:fields});if(!mutation||mutation.signature!==signature)mutation={signature,id:id||crypto.randomUUID(),requestId:requestId||crypto.randomUUID()};
 const result=await ExamsAPI.request('mutate',{method:'POST',body:{world,action:'create',data:fields,id:mutation.id,requestId:mutation.requestId}});mutation=null;if(ctx&&shown())void load(false);return result}
window.addEventListener('exams-authority-denied',()=>{listEl()?.replaceChildren();next=null});
window.ExamsFeed={sync,stop,add,refresh:()=>load(false)};
})();
