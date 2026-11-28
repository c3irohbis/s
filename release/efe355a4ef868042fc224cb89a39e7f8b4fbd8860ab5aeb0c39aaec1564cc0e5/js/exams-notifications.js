/* Durable Exams inbox, independent from legacy chat/call notifications. */
(function(){'use strict';let signature=null,gen=0,unsubscribe=null,busy=false,queued=false,seen=new Set(),bannerSeen=new Set(),ctx=null;const tab=crypto.randomUUID();
const current=()=>({uid:window.currentUser?.uid,world:window.activeWorldContext?.()});
function matches(c,g){const n=current();return g===gen&&n.uid===c.uid&&n.world===c.world;}
function banner(n,c,g){const root=document.getElementById('inAppNotifContainer');if(!root)return false;const el=document.createElement('button');el.className='ian ian-in exams-local-banner';el.style.cssText='padding:16px;text-align:right;display:block;color:var(--text);background:var(--bg-card,#fff8e8);border:1px solid var(--border,#d4af37);border-radius:16px;pointer-events:auto;width:100%';const title=document.createElement('strong'),body=document.createElement('div');title.textContent=n.title;body.textContent=n.body;el.append(title,body);el.onclick=async()=>{if(!matches(c,g)){el.remove();return}try{await ExamsAPI.request('notifications',{method:'POST',body:{action:'read',id:n.id}});if(!matches(c,g))return;window.showPage?.('page-home');window.goTab?.('tab-forum');window.openForumSection?.('tab-exams','tab-exams-content');el.remove();void refresh()}catch{}};root.append(el);setTimeout(()=>el.remove(),7000);return true;}
function render(items,c,g){window.dispatchEvent(new CustomEvent('exams-inbox',{detail:{uid:c.uid,items}}));}
async function refresh(){if(!ctx||document.hidden)return;if(busy){queued=true;return;}const c={...ctx},g=gen;busy=true;
 try{
  const [badge,inbox,pref]=await Promise.all([ExamsAPI.request('badge',{world:c.world}),ExamsAPI.request('notifications'),ExamsAPI.request('prefs')]);if(!matches(c,g))return;
  window.dispatchEvent(new CustomEvent('exams-badge',{detail:{uid:c.uid,world:c.world,count:badge.count}}));render(inbox.items,c,g);
  for(const n of inbox.items){if(!matches(c,g))break;if(!bannerSeen.has(n.id)&&!n.read_at&&!n.os_claimed_at&&pref.enabled){if(banner(n,c,g))bannerSeen.add(n.id)}if(seen.has(n.id)||n.os_claimed_at||n.read_at||!pref.enabled)continue;
   // Claim only when OS can actually be attempted; claim is not a read receipt.
   if(!window.Notification||Notification.permission!=='granted')continue;
   let reg;try{reg=await Promise.race([navigator.serviceWorker.ready,new Promise((_,bad)=>setTimeout(()=>bad(Error('exams-sw-timeout')),3000))]);}catch{continue}if(!matches(c,g))break;const claim=await ExamsAPI.request('notifications',{method:'POST',body:{action:'claim',id:n.id,context:tab}});if(!matches(c,g))continue;seen.add(n.id);if(!claim.claimed)continue;
   try{if(!matches(c,g))break;await reg.showNotification(n.title,{body:n.body,dir:'rtl',lang:'ar',tag:n.tag,data:{type:'exams',sourceId:n.item_id},requireInteraction:false});}catch{}
  }
 }catch(e){if(matches(c,g)&&(e.status===401||e.status===403))window.dispatchEvent(new Event('exams-authority-denied'));}finally{if(g===gen){busy=false;if(queued){queued=false;void refresh()}}}
}
function reset(){gen++;unsubscribe?.();unsubscribe=null;busy=false;queued=false;seen.clear();bannerSeen.clear();document.querySelectorAll('.exams-local-banner').forEach(x=>x.remove());ctx=null;window.dispatchEvent(new CustomEvent('exams-inbox',{detail:{uid:null,items:[]}}));}
function sync(){const c=current(),sig=c.uid&&c.world?c.uid+'|'+c.world:null;if(!ExamsAPI.enabled()||!sig){if(signature!==null){reset();signature=null;}return;}if(signature===sig)return;reset();signature=sig;ctx=c;unsubscribe=ExamsAPI.subscribe(refresh);void refresh();}
window.addEventListener('exams-authority-denied',()=>{document.querySelectorAll('.exams-local-banner').forEach(x=>x.remove());window.dispatchEvent(new CustomEvent('exams-inbox',{detail:{uid:null,items:[]}}));if(ctx)window.dispatchEvent(new CustomEvent('exams-badge',{detail:{uid:ctx.uid,world:ctx.world,count:0}}));});
setInterval(sync,800);window.addEventListener('exams-read',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden){sync();void refresh()}});window.ExamsNotifications={refresh};
})();
