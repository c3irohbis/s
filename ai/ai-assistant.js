/* Bariq v2: local guide. No API calls, database reads, or account mutations. */
(function () {
  'use strict';
  const kb = window.BariqKnowledge;
  if (!kb) return;
  const byId = Object.fromEntries(kb.topics.map(t => [t.id,t]));
  let messages = [], sending = false, lastTopic = null, sessionIdentity = '';
  function identity(){return (window.currentUser?.uid||'')+'|'+(window.activeWorldContext?.()||'');}
  function guard(){const id=identity();if(id!==sessionIdentity){clearSession();sessionIdentity=id;}}

  const escape = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFKC').replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim().split(' ').map(w=>w.startsWith('ال')&&w.length>3?w.slice(2):w).join(' ');
  const stop = new Set(['عايز','عاوز','ازاي','كيف','انا','هو','هي','ايه','فين','من','في','علي','الي','عن','لي','يا','لو','عندي','ممكن','اعمل','عايزه','عاوزه','اقدر','بتاع','بتاعه','دا','ده','دي']);
  const compiled=kb.topics.map(t=>({id:t.id,parent:t.parent,phrases:Array.from(new Set([t.title,...t.phrases].map(norm))).map(n=>({n,tokens:n.split(' ')}))}));
  const exact=new Map();
  compiled.forEach(t=>t.phrases.forEach(p=>{if(!exact.has(p.n))exact.set(p.n,[]);if(!exact.get(p.n).includes(t.id))exact.get(p.n).push(t.id);}));
  // Topic titles are explicit choices, prefer them over a broad alias from another topic.
  kb.topics.forEach(t=>exact.set(norm(t.title),[t.id]));
  function match(text) {
    const q=norm(text),words=q.split(' ').filter(w=>w.length>1&&!stop.has(w));
    if(!q)return [];
    if(exact.has(q))return exact.get(q).slice(0,4);
    const ranked=compiled.map(t=>{
      if(t.id==='angry')return {id:t.id,score:0};
      let best=0;
      t.phrases.forEach(({n,tokens})=>{
        if((' '+q+' ').includes(' '+n+' '))best=Math.max(best,30+n.length*2);
        else {const hits=tokens.filter(w=>!stop.has(w)&&words.includes(w));if(hits.length)best=Math.max(best,hits.length/tokens.length*12+hits.length*2);}
      });
      if(t.parent===lastTopic&&best)best+=2;
      return {id:t.id,score:best};
    }).filter(t=>t.score>=10).sort((a,b)=>b.score-a.score);
    if(!ranked.length)return [];
    if(ranked[0].score>=30&&(!ranked[1]||ranked[0].score-ranked[1].score>=5))return [ranked[0].id];
    return ranked.filter(t=>ranked[0].score-t.score<=5).slice(0,4).map(t=>t.id);
  }
  // Strict memory-only mode: no navigation function may run from Bariq.
  const actions = {};
  const labels={password:'افتح مكان تغيير كلمة السر',photo:'افتح تعيين الصورة',editprofile:'افتح تعديل البيانات',settings:'افتح الإعدادات',profile:'افتح بروفايلي',publicchat:'افتح الشات العام',dms:'افتح الدردشات',portal:'افتح البوابة الخارجية',install:'افتح خيارات التثبيت',tuition:'افتح مصروفات السنة',budget:'افتح فلوسي ومواصلاتي'};
  function chip(id) { return `<button type="button" class="bariq-chip" data-bariq-topic="${escape(id)}">${escape(byId[id].title)}<span aria-hidden="true">‹</span></button>`; }
  function topicHtml(t) {
    const children=kb.topics.filter(x=>x.parent===t.id);
    return `<h3 class="bariq-topic-title">${escape(t.title)}</h3>`+t.sections.map(s=>`<section class="bariq-section"><h4>${escape(s.title)}</h4><p>${escape(s.text)}</p></section>`).join('')+
      (t.action?`<p class="bariq-action-note">للوصول: ${escape(labels[t.action]||'افتح '+t.title)} من قوائم الموقع بنفسك. الاختصار التلقائي متوقف هنا للحفاظ على صفر طلبات إضافية؛ القسم الأصلي قد يحمّل بياناته عند فتحه.</p>`:'')+
      (children.length?`<div class="bariq-follow-title">تحب تعرف إيه كمان؟</div><div class="bariq-options">${children.map(c=>chip(c.id)).join('')}</div>`:'')+
      `<div class="bariq-topic-nav">${t.parent?`<button type="button" data-bariq-topic="${escape(t.parent)}">رجوع لـ ${escape(byId[t.parent].title)}</button>`:''}<button type="button" data-bariq-root>كل الأسئلة الشائعة</button></div>`;
  }
  function render() {
    const body=document.getElementById('aiChatBody'); if(!body) return;
    body.innerHTML=`<div class="bariq-hero"><span aria-hidden="true" class="bariq-local-mark">ب</span><div><strong>بريق معاك</strong><span>دليلك للموقع، خطوة بخطوة</span></div></div>`+messages.map(m=>`<div class="msg-row ${m.out?'me':'other'}"><div class="msg-bubble-group"><div class="msg-line"><div class="bubble ${m.out?'me':'other'}"><div class="bubble-text">${m.topic?topicHtml(byId[m.topic]):escape(m.text)}${m.table?tableHtml(m.table):''}${m.founder?'<button type="button" class="bariq-action" data-bariq-founder>عمر ناصر · زيارة البروفايل</button><p class="bariq-action-note">الضغط يفتح البروفايل الأصلي بقراءته العادية. الإجابة نفسها لا تجلب بيانات.</p>':''}${m.choices?`<div class="bariq-options">${m.choices.map(chip).join('')}</div>`:''}</div></div></div><div class="bubble-meta ${m.out?'':'other'}"><span class="bubble-time">${new Date(m.ts).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</span></div></div></div>`).join('');
    const rows=body.querySelectorAll('.msg-row');
    if(rows.length>1) rows[rows.length-1].scrollIntoView({block:'start',behavior:'instant'});
    else body.scrollTop=0;
  }
  function tableHtml(t) {
    return `<div class="bariq-action-note">اسحب الجدول أفقيًا لعرض باقي الأعمدة.</div><div class="bariq-table-wrap"><table class="bariq-table"><thead><tr>${t.headers.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map(c=>`<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function account() {
    const u=window.currentUser, d=window._currentUserData;
    if (!u?.uid || d?.uid!==u.uid) return {};
    const world=/^(is|lt|th|ba)_([1-4])$/.exec(d.worldId||'');
    return {uid:u.uid,name:String(window.currentName||d.name||''),email:typeof u.email==='string'?u.email:'',year:world?['','الأولى','الثانية','الثالثة','الرابعة'][+world[2]]:null};
  }
  function loaded(kind) {
    const get=kind==='news'?window.BariqLoadedNews:window.BariqLoadedSheets;
    const data=typeof get==='function'?get():null;
    if(!data) {push({text:kind==='news'?'الأخبار مش متاحة في ذاكرة الجلسة الحالية. مش هطلبها من السيرفر.':'بيانات الشيتات مش محمّلة في الجلسة الحالية. مش هطلبها من السيرفر، وده مش معناه إن مفيش شيتات.'});return;}
    const stamp=data.at?new Date(data.at).toLocaleString('ar-EG'):'وقت غير متاح';
    if(kind==='news')push({text:`دي الأخبار اللي وصلت للجلسة، مش تأكيد إنها آخر تحديث على السيرفر. وقت اللقطة: ${stamp}. بعرض حتى 10 أخبار.`,table:{headers:['العنوان','التفاصيل','التاريخ'],rows:data.rows.slice(0,10).map(r=>[r.title,r.body,r.date?new Date(r.date).toLocaleDateString('ar-EG'):'غير متاح'])}});
    else push({text:`الشيتات المحمّلة لآخر مادة: ${data.subject||'غير محددة'}. دي مش قائمة كل المواد. وقت اللقطة: ${stamp}. حالة الإنجاز هي حالة وقت اللقطة فقط.`,table:{headers:['المادة','صفحة','التسليم','اتعمل؟'],rows:data.rows.slice(0,30).map(r=>[r.subject,r.page,r.due,r.done===null?'غير متاح':r.done?'نعم':'لا'])}});
    if(!data.rows.length)push({text:'اللقطة المحمّلة فاضية. ده وصف اللقطة دي فقط، مش بحث جديد.'});
  }
  function localReply(text) {
    const q=norm(text), a=account();
    if(/(?:عايز اموت|انتحار|انتحر|اذي نفسي|ايذاء نفس|اقتل نفسي)/.test(q)){
      push({text:'سلامتك أهم دلوقتي. لو ممكن تأذي نفسك أو الخطر قريب، ابعد عن أي حاجة ممكن تؤذيك، وخليك مع شخص تثق فيه واتصل بالطوارئ المحلية أو روح أقرب طوارئ فورًا. أنا دليل محلي ومش خدمة طوارئ، ومش بقدر أتصل بدلًا منك. إنت في أمان دلوقتي؟'});return true;
    }
    if(/^(?:اخبار مصر|اخبار عامه|الاخبار العامه|اخبار الدوري)$/.test(q)){push({topic:'outofscope'});return true;}

    if(/(?:ايميل|ايميلات|بريد|email)/.test(q)) {
      if(/(?:ايميلي|بريدي|حسابي|بتاعي|ايميل حساب|بريد حساب|my email)/.test(q)&&!/(?:عمر|مؤسس|غيري|زميلي|صحبي|صاحبي|طالب|الطلاب|الناس|الاعضاء|عضو)/.test(q))push({text:a.email?'إيميل حسابك الحالي: '+a.email:'إيميل حسابك الحالي مش متاح في بيانات الجلسة.'});
      else push({text:'أقدر أعرض إيميل حسابك الحالي فقط. مش بعرض إيميلات أي شخص تاني. لو تقصد حسابك اكتب «إيميلي إيه؟».'});return true;
    }
    if(/(?:مؤسس|اسس|صاحب موقع|صاحب منتدي|عمر ناصر|مين عمر)/.test(q)) {push({text:'مؤسس موقع منتدى الجامعة الطالب عمر ناصر.',founder:true});return true;}
    if(/(?:انا مين|اسمي اي|تعرف اسمي|اسم حسابي|مين انا)/.test(q)){push({text:a.name?'اسمك في الحساب الحالي '+a.name+'.':'اسمك مش متاح في الجلسة الحالية.'});return true;}
    if(/(?:سنه|سنتي|فرقه|فرقتي|دراسيه)/.test(q)&&/(?:انا|حسابي|سنتي|فرقتي|دراسيه)/.test(q)){push({text:a.year?'إنت في الفرقة '+a.year+' حسب بيانات حسابك المحمّلة.':'فرقتك الدراسية مش محددة في بيانات حسابك المحمّلة. مش هخمنها من عالم المعاينة.'});return true;}
    if(/(?:اخبار|اعلانات)/.test(q)&&!/(?:ازاي|اشرح|يعني)/.test(q)){loaded('news');lastTopic='news';return true;}
    if(/(?:شيتات|شيتاتي|واجباتي|تسليماتي)/.test(q)&&!/(?:ازاي|اشرح|يعني|احمل|انزل)/.test(q)){loaded('sheets');lastTopic='sheetaty';return true;}
    if(/^(?:هلا|اهلا|اهلين|هالو|هاي|hello|hi|السلام عليكم|سلام عليكم|صباح الخير|مساء الخير|ازيك|عامل ايه)(?: يا بريق)?$/.test(q)){push({text:`أهلًا${a.name?' يا '+a.name:''}! أنا بريق، دليلك في منتدى الجامعة. أساعدك في إيه؟`,choices:kb.roots});return true;}
    if(/^(?:شكرا|متشكر|تسلم|حبيبي|تمام|ماشي|اشطا|جميل)$/.test(q)){push({text:'تسلم! لو محتاج خطوة تانية في نفس الموضوع قولّي، أو اختار من الأسئلة.',choices:lastTopic?[lastTopic]:kb.roots});return true;}
    if(/(?:مين انت|انت مين|عرف نفسك|بتعمل ايه|قدراتك)/.test(q)){push({text:'أنا بريق، دليل محلي لمنتدى الجامعة. أشرح الكروت، أستخدم اسم وفرقة وإيميل صاحب الجلسة فقط، وأعرض الأخبار والشيتات المحمّلة بالفعل. مش نموذج لغوي ولا بجيب تحديثات جديدة أو بغيّر بيانات.'});return true;}
    if(/^(?:كمل|وبعدين|بعدين|ازاي|اشرح اكتر|وضح|مش فاهم|وضح اكتر)$/.test(q)&&lastTopic){push({topic:lastTopic});return true;}
    return false;
  }
  function push(m) {messages.push({...m,ts:Date.now()}); if(messages.length>40) messages=messages.slice(-40);render();}
  function root() {lastTopic=null;const a=account();push({text:`أهلًا${a.name?' يا '+a.name:''}، أنا بريق، دليلك في منتدى الجامعة. أشرح لك، وأرتّب البيانات المحمّلة بالفعل في جلستك، من غير طلبات بيانات جديدة. اسألني عن اسمك أو فرقتك أو إيميل حسابك، أو قول آخر الأخبار أو الشيتات. المحادثة مؤقتة وبتتمسح لما تخرج.`,choices:kb.roots});}
  function clearSession() {
    messages=[];lastTopic=null;sending=false;
    const body=document.getElementById('aiChatBody');if(body)body.replaceChildren();
    const input=document.getElementById('aiChatInput');if(input)input.value='';
  }
  function choose(id) {if(!byId[id])return;lastTopic=id;push({out:true,text:byId[id].title});push({topic:id});}
  window._aiListItem=()=>({id:'ai',name:'بريق',photo:'',cls:'ai',lastMsg:'دليلك للموقع • شرح وخطوات واختصارات',lastTime:null,unread:0});
  window._openAiChat=()=>{guard();window.showPage?.('page-ai-chat');if(!messages.length) root();else render();};
  window._sendToAI=()=>{
    guard();if(sending)return;
    const input=document.getElementById('aiChatInput'),text=(input?.value||'').trim();if(!text)return;
    if(text.length>500){window.toast?.('خلي السؤال أقل من ٥٠٠ حرف عشان أوصّلك بسرعة','warn');return;}
    sending=true;input.value='';push({out:true,text});
    if(localReply(text)){sending=false;return;}
    const ids=match(text);
    if(ids.length===1){lastTopic=ids[0];push({topic:ids[0]});}
    else if(ids.length>1)push({text:'تقصد أنهي موضوع من دول يا صاحبي؟',choices:ids});
    else push({text:'مش فاهمك يا صاحبي',choices:kb.roots});
    sending=false;
  };
  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-bariq-topic],[data-bariq-action],[data-bariq-root],[data-bariq-founder]');if(!btn)return;guard();
    if(btn.hasAttribute('data-bariq-founder')){if(window.OWNER_UID&&typeof window.openProfileViewModal==='function'){window.openProfileViewModal(window.OWNER_UID);clearSession();}else push({text:'زيارة البروفايل مش متاحة حاليًا.'});return;}
    if(btn.hasAttribute('data-bariq-root'))root();
    else if(btn.dataset.bariqTopic)choose(btn.dataset.bariqTopic);
    else push({text:'فتح الأقسام التلقائي متوقف للحفاظ على صفر طلبات إضافية.'});
  });
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('aiChatInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();window._sendToAI();}});
    document.getElementById('aiChatInput')?.setAttribute('maxlength','500');
    const page=document.getElementById('page-ai-chat');
    if(page)new MutationObserver(()=>{if(!page.classList.contains('active'))clearSession();}).observe(page,{attributes:true,attributeFilter:['class']});
    window.addEventListener('pagehide',clearSession);
    new MutationObserver(()=>guard()).observe(document.body,{attributes:true,attributeFilter:['class'],subtree:true});
  });
  // Read-only diagnostics for dev tests, no personal content.
  window.BariqGuide = Object.freeze({match,normalize:norm,topicCount:kb.topics.length,actionIds:[],mode:"memory-only-v2"});
})();
