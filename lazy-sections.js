/* Load independent overlays on first use. Startup and optional offline preparation do not request them. */
(function(){'use strict';
 const root=new URL('.',document.baseURI);const groups=[
  {names:['MilitaryModule'],js:'military.js',css:['military.css']},
  {names:['InstructionsModule'],js:'instructions.js?v=bliss-phase2-4',css:['instructions.css']},
  {names:['TuitionModule'],js:'tuition-fees.js',css:['tuition-fees.css']},
  {names:['ExpensesModule','MyExpensesHub'],js:'expenses.js?v=local-1',css:['expenses.css','tuition-fees.css']},
  {names:['StudyScheduleModule'],js:'study-schedule.js?v=shared-2',css:['study-schedule.css']},
  {names:['SheetatyModule'],js:'sheetaty.js?v=bariq-memory-2',css:['sheetaty.css']},
  {names:['MyDocsModule'],js:'my-docs.js?v=pages-1',css:['my-docs.css']}
 ];const styles=new Map();
 function style(file){const url=new URL('css/'+file,root).href;if(styles.has(url))return styles.get(url);const promise=new Promise((resolve,reject)=>{const link=document.createElement('link');link.rel='stylesheet';link.href=url;link.onload=resolve;link.onerror=()=>{link.remove();styles.delete(url);reject(Error('style unavailable'));};document.head.appendChild(link);});styles.set(url,promise);return promise;}
 function identity(){return (window.currentUser?.uid||'')+':'+(window.activeWorldContext?.()||'');}
 for(const group of groups){let pending=null,ticket=0;const stubs={};
  const load=()=>pending||(pending=Promise.all(group.css.map(style)).then(()=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('js/'+group.js,root).href;script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('section unavailable'));};document.head.appendChild(script);})).catch(error=>{pending=null;throw error;}));
  for(const name of group.names){const stub={};stubs[name]=stub;window[name]=stub;
   const open=async function(...args){const n=++ticket,who=identity();try{await load();if(n!==ticket||who!==identity())return;const fn=window[name]?.open;if(typeof fn!=='function'||fn===open)throw Error('section did not initialize');return fn?.apply(window[name],args);}catch(error){pending=null;console.error(error);window.toast?.('تعذر فتح القسم. تحقق من الاتصال وجرب مرة أخرى.');}};
   stub.open=open;stub.close=()=>{ticket++;};
  }
 }
})();
