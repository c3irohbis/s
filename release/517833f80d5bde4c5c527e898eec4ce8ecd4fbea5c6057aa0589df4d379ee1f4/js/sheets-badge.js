/* SQL badge for sheetaty. Shared legacy badges stay untouched. */
(function(){'use strict';let ctx=null,unsub=null,gen=0,busy=false,queued=false;
function current(){return{uid:window.currentUser?.uid,world:window.activeWorldContext?.()}}
function matches(c,g){const x=current();return gen===g&&c.uid===x.uid&&c.world===x.world}
async function refresh(){if(!ctx||document.hidden)return;if(busy){queued=true;return}busy=true;const c={...ctx},g=gen;try{const r=await SheetsAPI.request('badge',{world:c.world});if(matches(c,g))window.dispatchEvent(new CustomEvent('sheets-badge',{detail:{...c,count:r.count}}))}catch{}finally{if(g===gen){busy=false;if(queued){queued=false;void refresh()}}}}
function sync(){const c=current();if(c.uid===ctx?.uid&&c.world===ctx?.world)return;gen++;unsub?.();unsub=null;busy=false;queued=false;ctx=null;if(!c.uid||!c.world||window.__BLISS_SHEETS_MODE==='firebase'||!window.SheetsAPI)return;ctx=c;unsub=SheetsAPI.subscribe(()=>{void refresh();window.dispatchEvent(new Event('sheets-changed'))});void refresh()}
window.addEventListener('sheets-authority-denied',e=>{if(ctx&&e.detail?.uid===ctx.uid&&e.detail?.world===ctx.world)window.dispatchEvent(new CustomEvent('sheets-badge',{detail:{...ctx,count:0}}))});setInterval(sync,800);document.addEventListener('visibilitychange',()=>{if(!document.hidden){sync();void refresh()}});window.SheetsBadge={refresh};
})();
