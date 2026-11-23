/* Bariq v1: local guide. No API calls, database reads, or account mutations. */
(function () {
  'use strict';
  const kb = window.BariqKnowledge;
  if (!kb) return;
  const byId = Object.fromEntries(kb.topics.map(t => [t.id,t]));
  let messages = [], sending = false, lastTopic = null;
  const escape = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFKC').replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim().split(' ').map(w=>w.startsWith('ال')&&w.length>3?w.slice(2):w).join(' ');
  const stop = new Set(['عايز','عاوز','ازاي','كيف','انا','هو','هي','ايه','فين','من','في','علي','الي','عن','لي','يا','لو','عندي','ممكن','اعمل','عايزه','عاوزه','اقدر','بتاع','بتاعه','دا','ده','دي']);
  function match(text) {
    const q=norm(text), words=q.split(' ').filter(w=>w.length>1&&!stop.has(w));
    if(!q) return [];
    const ranked=kb.topics.map(t=>{
      let best=0;
      [t.title,...t.phrases].forEach(p=>{
        const n=norm(p), tokens=n.split(' ');
        if(q===n) best=Math.max(best,100+n.length);
        else if((' '+q+' ').includes(' '+n+' ')) best=Math.max(best,30+n.length*2);
        else {
          const hits=tokens.filter(w=>!stop.has(w)&&words.includes(w));
          if(hits.length) best=Math.max(best, hits.length/tokens.length*12+hits.length*2);
        }
      });
      if(t.parent===lastTopic&&best) best+=2;
      return {id:t.id,score:best};
    }).filter(t=>t.score>=10).sort((a,b)=>b.score-a.score);
    if(!ranked.length) return [];
    if(ranked[0].score>=30 && (!ranked[1]||ranked[0].score-ranked[1].score>=5)) return [ranked[0].id];
    return ranked.filter(t=>ranked[0].score-t.score<=5).slice(0,4).map(t=>t.id);
  }
  const actions = {};
  function home(tab) { window.showPage?.('page-home'); window.goTab?.(tab || 'tab-forum'); }
  actions.forum=()=>home();
  ['news','lectures','exams','sections','attendance','whyhere'].forEach(k=>{
    actions[k==='whyhere'?'why':k]=()=>{ home(); window.openForumSection?.('tab-'+k,'tab-'+k+'-content'); };
  });
  const modules={schedule:'StudyScheduleModule',sheetaty:'SheetatyModule',mydocs:'MyDocsModule',expenses:'MyExpensesHub',tuition:'TuitionModule',budget:'ExpensesModule',grades:'GradesModule',lost:'LostFoundModule',military:'MilitaryModule',instructions:'InstructionsModule'};
  Object.entries(modules).forEach(([id,name])=>{actions[id]=()=>{if(typeof window[name]?.open!=='function') throw Error('unavailable'); home(); window[name].open();};});
  actions.settings=()=>{window.openSettingsModal?.(); window.switchSettingsTab?.(null);};
  const tabs={appearance:'appearance',notifications:'notifications',privacy:'privacy',account:'account',password:'account',chatsettings:'chat'};
  Object.entries(tabs).forEach(([id,tab])=>{actions[id]=()=>{
    if(typeof window.openSettingsModal!=='function') throw Error('unavailable');
    window.openSettingsModal(); window.switchSettingsTab?.(tab);
    if(id==='password') requestAnimationFrame(()=>document.getElementById('currentPassword')?.scrollIntoView({block:'center',behavior:'smooth'}));
  };});
  actions.profile=()=>home('tab-profile');
  actions.photo=()=>{home('tab-profile');window.openPhotoUploadDirect?.();};
  actions.editprofile=()=>{home('tab-profile');window.openEditDataDirect?.();};
  actions.dms=()=>window.showPage?.('page-dms');
  actions.publicchat=()=>window.openChatPage?.();
  actions.portal=()=>window.openPortal?.();
  actions.install=()=>{home();window.installPWAFromCard?.();};
  const labels={password:'افتح مكان تغيير كلمة السر',photo:'افتح تعيين الصورة',editprofile:'افتح تعديل البيانات',settings:'افتح الإعدادات',profile:'افتح بروفايلي',publicchat:'افتح الشات العام',dms:'افتح الدردشات',portal:'افتح البوابة الخارجية',install:'افتح خيارات التثبيت',tuition:'افتح مصروفات السنة',budget:'افتح فلوسي ومواصلاتي'};
  function chip(id) { return `<button type="button" class="bariq-chip" data-bariq-topic="${escape(id)}">${escape(byId[id].title)}<span aria-hidden="true">‹</span></button>`; }
  function topicHtml(t) {
    const children=kb.topics.filter(x=>x.parent===t.id);
    return `<h3 class="bariq-topic-title">${escape(t.title)}</h3>`+t.sections.map(s=>`<section class="bariq-section"><h4>${escape(s.title)}</h4><p>${escape(s.text)}</p></section>`).join('')+
      (children.length?`<div class="bariq-follow-title">تحب تعرف إيه كمان؟</div><div class="bariq-options">${children.map(c=>chip(c.id)).join('')}</div>`:'')+
      (t.action?`<button type="button" class="bariq-action" data-bariq-action="${escape(t.action)}">${escape(labels[t.action]||'افتح '+t.title)} <span aria-hidden="true">↗</span></button><p class="bariq-action-note">الزر بيفتح القسم الأصلي، وممكن يبدأ تحميل محتواه المعتاد. مش بيحفظ أو يرسل حاجة.</p>`:'')+
      `<div class="bariq-topic-nav">${t.parent?`<button type="button" data-bariq-topic="${escape(t.parent)}">رجوع لـ ${escape(byId[t.parent].title)}</button>`:''}<button type="button" data-bariq-root>كل الأسئلة الشائعة</button></div>`;
  }
  function render() {
    const body=document.getElementById('aiChatBody'); if(!body) return;
    body.innerHTML=`<div class="bariq-hero"><img src="images/mascot/ui/ai-bariq.webp" alt="بريق" width="76" height="76"><div><strong>بريق معاك</strong><span>دليلك للموقع، خطوة بخطوة</span></div></div>`+messages.map(m=>`<div class="msg-row ${m.out?'me':'other'}"><div class="msg-bubble-group"><div class="msg-line"><div class="bubble ${m.out?'me':'other'}"><div class="bubble-text">${m.topic?topicHtml(byId[m.topic]):escape(m.text)}${m.choices?`<div class="bariq-options">${m.choices.map(chip).join('')}</div>`:''}</div></div></div><div class="bubble-meta ${m.out?'':'other'}"><span class="bubble-time">${new Date(m.ts).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</span></div></div></div>`).join('');
    const rows=body.querySelectorAll('.msg-row');
    if(rows.length>1) rows[rows.length-1].scrollIntoView({block:'start',behavior:'smooth'});
    else body.scrollTop=0;
  }
  function push(m) {messages.push({...m,ts:Date.now()}); if(messages.length>40) messages=messages.slice(-40);render();}
  function root() {lastTopic=null;push({text:kb.greeting,choices:kb.roots});}
  function choose(id) {if(!byId[id])return;lastTopic=id;push({out:true,text:byId[id].title});push({topic:id});}
  window._aiListItem=()=>({id:'ai',name:'بريق',photo:'',cls:'ai',lastMsg:'دليلك للموقع • شرح وخطوات واختصارات',lastTime:null,unread:0});
  window._openAiChat=()=>{window.showPage?.('page-ai-chat');if(!messages.length) root();else render();};
  window._sendToAI=()=>{
    if(sending)return;
    const input=document.getElementById('aiChatInput'),text=(input?.value||'').trim();if(!text)return;
    if(text.length>500){window.toast?.('خلي السؤال أقل من ٥٠٠ حرف عشان أوصّلك بسرعة','warn');return;}
    sending=true;input.value='';push({out:true,text});
    const ids=match(text);
    if(ids.length===1){lastTopic=ids[0];push({topic:ids[0]});}
    else if(ids.length>1)push({text:'تقصد أنهي موضوع من دول يا صاحبي؟',choices:ids});
    else push({text:'مش متأكد من قصدك، ومش هفتي عليك 😄 أنا متخصص في شرح الموقع. اختار موضوع، أو اكتب اسم الكارت والحاجة اللي محتاجها.',choices:kb.roots});
    sending=false;
  };
  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-bariq-topic],[data-bariq-action],[data-bariq-root]');if(!btn)return;
    if(btn.hasAttribute('data-bariq-root'))root();
    else if(btn.dataset.bariqTopic)choose(btn.dataset.bariqTopic);
    else {try{const run=actions[btn.dataset.bariqAction];if(!run)throw Error('unavailable');run();}catch(_){push({text:'الاختصار مش متاح دلوقتي. افتح القسم من القائمة الأصلية، وأنا أقدر أشرح لك الطريق.'});}}
  });
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('aiChatInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();window._sendToAI();}});
    document.getElementById('aiChatInput')?.setAttribute('maxlength','500');
  });
  // Read-only diagnostics for dev tests, no personal content.
  window.BariqGuide = Object.freeze({match,normalize:norm,topicCount:kb.topics.length,actionIds:Object.keys(actions)});
})();
