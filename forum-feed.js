/* split from js/app-main.js (block P_content_loaders_forum) — verbatim code; cross-module state writes go through __set_* helpers */
import { collection, deleteDoc, doc, getDoc, limit, limitToLast, startAfter, endBefore, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "/s/release/e7c11e368f7d8d898514eeaed1fa11b9663743862e482accf2cdee9bf6b0755c/js/app/a-init-config.js";
import { AUDIT_ACTIONS, writeAuditLog } from "/s/release/e7c11e368f7d8d898514eeaed1fa11b9663743862e482accf2cdee9bf6b0755c/js/app/c-upload-audit-stub.js";
import { isAdmin, isOwner } from "/s/release/e7c11e368f7d8d898514eeaed1fa11b9663743862e482accf2cdee9bf6b0755c/js/app/d-state-roles-email.js";
import { confirm } from "/s/release/e7c11e368f7d8d898514eeaed1fa11b9663743862e482accf2cdee9bf6b0755c/js/app/e-toast-confirm.js";
import { esc } from "/s/release/e7c11e368f7d8d898514eeaed1fa11b9663743862e482accf2cdee9bf6b0755c/js/app/v-profile-cards-picctx.js";
/* ══════════════════════════════════════════
   CONTENT LOADERS
══════════════════════════════════════════ */
/* ══════════════════════════════════════════
   CONTENT LOADERS — الأخبار / الامتحانات / السكاشن (+ المحاضرات عبر js/library.js)
   onSnapshot للقسم الظاهر فقط:
   • مستمع واحد لكل قائمة، بيبدأ لما القسم يبقى ظاهر فعلاً، ويتفصل لما يتخفّى أو يتغيّر الحساب/العالم أو التطبيق يتخفّى.
   • القرار كله في نقطة واحدة (_forumLiveSync) بتتنادى من: showPage / goTab / openForumSection / closeForumSection /
     setActiveWorld / visibilitychange / IntersectionObserver (شبكة أمان) / doLogout.
   • الأسماء loadNews / loadExams / loadSections / loadLectures محفوظة، ودورها دلوقتي إنها تضمن إن المستمع شغّال
     (مفيش getDocs ولا إعادة قراءة بعد الإضافة — الإضافة والحذف والتعديل بتوصل من المستمع).
══════════════════════════════════════════ */
const _FORUM_PAGE=25;
const _FORUM_EMPTY_HTML       = `<div class="empty-state">لم تتم الإضافة بعد</div>`;
const _FORUM_UNAVAILABLE_HTML = `<div class="empty-state">لا تتوفر بيانات محفوظة بدون اتصال</div>`;

// ── عرض عنصر واحد من كل قائمة (نفس الكود القديم بالظبط) ──
const _renderNewsDoc = docu => {
    const d = docu.data();
    const div = document.createElement("div"); div.className = "news-card";
    const ts = d.createdAt?.toDate?.() || new Date();
    div.innerHTML = `
      <div class="news-badge"><i class=\"fa-solid fa-bullhorn\"></i> إعلان رسمي</div>
      <div class="news-title">${esc(d.title)}</div>
      <div class="news-body">${esc(d.body||"")}</div>
      <div class="news-date">${ts.toLocaleDateString("ar-EG",{day:"numeric",month:"long",year:"numeric"})}</div>
      ${isAdmin() ? `<button class="del-btn" data-id="${docu.id}"><i class="fa-solid fa-trash-can"></i> حذف</button>` : ""}
    `;
    div.querySelector(".del-btn")?.addEventListener("click", () => deleteItem("news", docu.id, div));
    return div;
  };

const _renderExamDoc = docu => {
    const d = docu.data(); const div = document.createElement("div"); div.className = "item-card";
    div.innerHTML = `
      <div class="item-title"><i class=\"fa-solid fa-thumbtack\"></i> ${esc(d.subject)}</div>
      ${d.date ? `<div class="item-sub"><i class="fa-solid fa-calendar"></i> ${esc(d.date)}</div>` : ""}
      ${d.time ? `<div class="item-sub"><i class="fa-solid fa-clock"></i> ${esc(d.time)}</div>` : ""}
      ${d.room ? `<div class="item-sub"><i class=\"fa-solid fa-school\"></i> ${esc(d.room)}</div>` : ""}
      ${isAdmin() ? `<button class="del-btn"><i class=\"fa-solid fa-trash-can\"></i> حذف</button>` : ""}
    `;
    div.querySelector(".del-btn")?.addEventListener("click", () => deleteItem("exams", docu.id, div));
    return div;
  };

const _renderSectionDoc = docu => {
    const d = docu.data(); const div = document.createElement("div"); div.className = "item-card";
    div.innerHTML = `
      <div class="item-title"><i class=\"fa-solid fa-chalkboard-user\"></i> ${esc(d.name)}</div>
      ${d.subject ? `<div class="item-sub"><i class="fa-solid fa-book-open"></i> ${esc(d.subject)}</div>` : ""}
      ${d.time    ? `<div class="item-sub"><i class="fa-solid fa-clock"></i> ${esc(d.time)}</div>`    : ""}
      ${d.room    ? `<div class="item-sub"><i class=\"fa-solid fa-school\"></i> ${esc(d.room)}</div>`    : ""}
      ${isAdmin() ? `<button class="del-btn"><i class=\"fa-solid fa-trash-can\"></i> حذف</button>` : ""}
    `;
    div.querySelector(".del-btn")?.addEventListener("click", () => deleteItem("sections", docu.id, div));
    return div;
  };

let _bariqNewsSnapshot = null;
function _bariqRememberNews(key, docs, ctx) {
  if (key !== 'news') return;
  _bariqNewsSnapshot = {uid:ctx.uid, world:ctx.world, at:Date.now(), rows:docs.map(x=>{
    const d=x.data();return {title:String(d.title||''),body:String(d.body||''),date:d.createdAt?.toDate?.()?.toISOString?.()||null};
  })};
}
window.BariqLoadedNews = () => {
  const ctx=_forumLiveCtx(), s=(window.__BLISS_NEWS_MODE!=='firebase')?window.__newsLoadedSnapshot:_bariqNewsSnapshot;
  if (!s || s.uid!==ctx.uid || s.world!==ctx.world) return null;
  return {at:s.at,world:s.world,rows:s.rows.map(x=>({...x}))};
};
const _forumLive = {
  news:     { content: "tab-news-content",     list: "newsList",     col: "news",     render: _renderNewsDoc },
  exams:    { content: "tab-exams-content",    list: "examsList",    col: "exams",    render: _renderExamDoc },
  sections: { content: "tab-sections-content", list: "sectionsList", col: "sections", render: _renderSectionDoc },
  lectures: { content: "tab-lectures-content", external: true },   // المستمع نفسه في js/library.js (_libLiveStart/_libLiveStop)
};
Object.keys(_forumLive).forEach(k => Object.assign(_forumLive[k], {
  active: false, sig: null, unsub: null, gen: 0, rendered: false, dataSig: null, failedSig: null,
}));

// بصمة الحساب + العالم الحاليين (نفس فكرة forum-badges.js)
function _forumLiveCtx() {
  const uid   = window.currentUser?.uid || null;
  const world = (typeof window.activeWorldContext === "function") ? window.activeWorldContext() : null;
  return { uid, world, sig: uid ? (uid + "|" + (world || "none")) : null };
}
// هل القسم ظاهر فعلاً؟ (display + كل الأجداد: الصفحة/التاب .active) — مش بنعتمد على IntersectionObserver لوحده
function _forumLiveShown(e) {
  const el = document.getElementById(e.content);
  return !!el && el.style.display !== "none" && el.getClientRects().length > 0;
}
// علامة "الجهاز ده استلم لقطة مؤكدة من السيرفر" + عدد العناصر وقتها (n). دي دليل على اكتمال الكاش مش إثبات:
//  • لقطة السيرفر (من غير كتابات معلّقة) بتسجّل n؛ لقطة الكاش بتتعرض بس لو موثوقة (_forumLiveCacheTrusted).
//  • الكاش مش بيتمسح ومفيش أي قراءة/استعلام إضافي — العلامة في localStorage بس.
const _forumLiveMarkerKey = (ctx, col) => "forumLive:page25:v3:" + ctx.uid + ":" + ctx.world + ":" + col;
function _forumLiveGetMarker(k) {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    try { const v = JSON.parse(raw); if (v && typeof v === "object" && typeof v.n === "number") return { n: v.n }; } catch(_) {}
    return { n: null };                       // علامة قديمة (تاريخ بس، من غير عدد)
  } catch(_) { return null; }
}
function _forumLiveSetMarker(k, n) { try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), n })); } catch(_) {} }
// لقطة الكاش موثوقة لو: في علامة، وعدد المستندات المخزّنة مش أقل من اللي اتأكّد من السيرفر آخر مرة.
// علامة قديمة بدون عدد → بنثق في البيانات الموجودة بس، مش في الكاش الفاضي (الفاضي مش بيتعرض كـ "لا توجد عناصر").
function _forumLiveCacheTrusted(m, count) {
  if (!m) return false;
  if (typeof m.n !== "number") return count > 0;
  return count >= m.n;
}

function _forumLiveStop(key) {
  if(key==='news'&&(window.__BLISS_NEWS_MODE!=='firebase')){window.NewsFeed?.stop();return;}
  if(key==='exams'&&(window.__BLISS_EXAMS_MODE!=='firebase')){window.ExamsFeed?.stop();return;}
  if(key==='sections'&&(window.__BLISS_SECTIONS_MODE!=='firebase')){window.SectionsFeed?.stop();return;}
  const e = _forumLive[key];
  if(key==='news')_bariqNewsSnapshot=null;
  if (!e.active && !e.unsub) return;
  e.gen++;                                   // أي callback قديم يتجاهل نفسه
  if (e.unsub) { try { e.unsub(); } catch(_) {} }
  if (e.external) { try { window._libLiveStop?.(); } catch(_) {} }
  e.unsub = null; e.active = false; e.sig = null;
}

async function _forumLiveStart(key, ctx, page=null) {
  const e = _forumLive[key];
  _forumLiveStop(key);                       // أي مستمع سابق يتفصل قبل الجديد
  e.active = true; e.sig = ctx.sig;
  if (e.external) { try { window._libLiveStart?.(ctx); } catch(err) { console.error(err); } return; }

  const gen  = e.gen;
  const list = document.getElementById(e.list);
  if (!list) {e.active=false;e.sig=null;return;}
  // حساب/عالم مختلف عن اللي معروض (أو أول مرة) → spinner؛ نفس الحساب والعالم → سيب المعروض لحد أول لقطة
  if (page || e.dataSig !== ctx.sig || !e.rendered) { list.innerHTML = `<div class="spinner"></div>`; e.rendered = false; }
  // عالم غير محدد (مثلاً أونر لسه ما اختارش) → قائمة فاضية زي السلوك القديم، من غير مستمع
  if (!ctx.world) { list.innerHTML = _FORUM_EMPTY_HTML; e.rendered = true; e.dataSig = ctx.sig; return; }

  const mk    = _forumLiveMarkerKey(ctx, e.col)+(page?":"+page.dir+":"+page.edge.id:":latest");
  const still = () => gen === e.gen && window.currentUser?.uid === ctx.uid && _forumLiveCtx().sig === ctx.sig;
  let first = true;
  try {
    // ✅ World Isolation: نفس الاستعلام القديم بالظبط (worldId + createdAt تنازلي) + فلترة worldId على العميل
    const edges=page?(page.dir==='next'?[startAfter(page.edge),limit(_FORUM_PAGE)]:[endBefore(page.edge),limitToLast(_FORUM_PAGE)]):[limit(_FORUM_PAGE)];
    const q = query(collection(db, e.col), where("worldId", "==", ctx.world), orderBy("createdAt", "desc"),...edges);
    e.unsub = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      if (!still()) return;
      const fromCache = snap.metadata.fromCache;
      const docs = snap.docs.filter(d => d.data().worldId === ctx.world);
      // لقطة مؤكدة من السيرفر (من غير كتابات معلّقة) → سجّل العلامة بعدد العناصر
      if (!fromCache && !snap.metadata.hasPendingWrites) _forumLiveSetMarker(mk, docs.length);
      if (fromCache && !_forumLiveCacheTrusted(_forumLiveGetMarker(mk), docs.length)) {
        // كاش غير موثوق (من غير علامة، أو أقل من آخر تأكيد، أو فاضي مع علامة قديمة) → مش بنعرضه كقائمة كاملة ولا كـ "لا توجد عناصر"
        if (navigator.onLine === false && !e.rendered) list.innerHTML = _FORUM_UNAVAILABLE_HTML;
        return;
      }
      // تغيير ميتاداتا بس (تأكيد السيرفر / كتابة معلّقة) من غير تغيير فعلي في البيانات → مفيش إعادة بناء
      if (!first && !snap.docChanges().length) return;
      // نبني كل العناصر الأول: لو عرض أي مستند فشل → رسالة خطأ بدل قائمة جزئية مضلّلة (المستمع بيفضل شغّال وبيحاول مع اللقطة الجاية)
      let els = [];
      try { els = docs.map(d => e.render(d)); }
      catch (err) {
        console.error(err);
        list.innerHTML = `<div class="empty-state">خطأ في التحميل</div>`;
        e.rendered = false;
        return;
      }
      first = false;
      list.innerHTML = "";
      if (!docs.length) { list.innerHTML = _FORUM_EMPTY_HTML; }
      else els.forEach(el => { if (el) list.appendChild(el); });
      e.rendered = true; e.dataSig = ctx.sig;
      _bariqRememberNews(key, docs, ctx);
      const nav=document.createElement('div');nav.className='forum-page-nav';
      const add=(label,action)=>{const btn=document.createElement('button');btn.type='button';btn.className='btn';btn.textContent=label;btn.addEventListener('click',()=>{if(still())action()});nav.appendChild(btn)};
      if(page){add('الأحدث',()=>_forumLiveStart(key,ctx));if(docs.length)add('السابق',()=>_forumLiveStart(key,ctx,{dir:'prev',edge:docs[0]}));}
      if(docs.length===_FORUM_PAGE)add('التالي',()=>_forumLiveStart(key,ctx,{dir:'next',edge:docs.at(-1)}));
      if(nav.children.length)list.appendChild(nav);
    }, (err) => {
      if (gen !== e.gen) return;
      console.error(err);
      list.innerHTML = `<div class="empty-state">خطأ في التحميل</div>`;
      e.rendered = false; e.unsub = null; e.active = false; e.sig = null; e.failedSig = ctx.sig;
    });
  } catch (err) {
    console.error(err);
    list.innerHTML = `<div class="empty-state">خطأ في التحميل</div>`;
    e.rendered = false; e.unsub = null; e.active = false; e.sig = null; e.failedSig = ctx.sig;
  }
}

// نقطة القرار الوحيدة: اللي ظاهر ويسمح حاله → شغّال (مستمع واحد)، غير كده → متفصل
function _forumLiveSync() {
  const ctx    = _forumLiveCtx();
  const canRun = !!(ctx.uid && db && !document.hidden);
  Object.keys(_forumLive).forEach(key => {
    const e = _forumLive[key];
    if(key==='news'&&(window.__BLISS_NEWS_MODE!=='firebase')){window.NewsFeed?.sync();return;}
    if(key==='exams'&&(window.__BLISS_EXAMS_MODE!=='firebase')){window.ExamsFeed?.sync();return;}
    if(key==='sections'&&(window.__BLISS_SECTIONS_MODE!=='firebase')){window.SectionsFeed?.sync();return;}
    if (!(canRun && _forumLiveShown(e))) { _forumLiveStop(key); e.failedSig = null; return; }
    // D9=A (مراجعة المالك نقطة 1): الكارت المفتوح لا يُعاد جلبه أبدًا — لا هنا ولا عبر أي استدعاء متكرر
    // (IntersectionObserver/visibilitychange أثناء الفتح). الفتح/الرجوع الحقيقي يمر بـ _forumLiveStop
    // ثم _forumLiveStart أدناه، وserveCard يجلب جديدًا عندها فقط.
    if (e.active && e.sig === ctx.sig) return;                 // شغّال لنفس الحساب والعالم → ما نكرّرش
    if (!e.active && e.failedSig === ctx.sig) return;          // فشل لنفس السياق → إعادة المحاولة بعد الإخفاء/الفتح التالي
    _forumLiveStart(key, ctx);
  });
}
function _forumLiveStopAll() {
  Object.keys(_forumLive).forEach(key => {
    _forumLiveStop(key);
    Object.assign(_forumLive[key], { rendered: false, dataSig: null, failedSig: null });
  });
}
window._forumLiveSync    = _forumLiveSync;
window._forumLiveCtx     = _forumLiveCtx;
window._forumLiveStopAll = _forumLiveStopAll;
// js/library.js بيبلّغ لو مستمع المحاضرات فشل (عشان ما نعيدش المحاولة في حلقة)
window._forumLiveFailed  = (key, sig) => { const e = _forumLive[key]; if (e) { e.active = false; e.sig = null; e.unsub = null; e.failedSig = sig; } };

document.addEventListener("visibilitychange", _forumLiveSync);   // التطبيق اتخفّى → فصل، رجع → إعادة ربط للقسم الظاهر
window.addEventListener("offline", () => {                         // انقطاع الاتصال أثناء انتظار أول لقطة مؤكدة
  Object.keys(_forumLive).forEach(key => {
    const e = _forumLive[key];
    if (!e.active || e.rendered) return;
    if (e.external) { try { window._libLiveOffline?.(); } catch(_) {} return; }
    const list = document.getElementById(e.list);
    if (list) list.innerHTML = _FORUM_UNAVAILABLE_HTML;
  });
});
if (typeof IntersectionObserver === "function") {                  // شبكة أمان فقط — القرار دايمًا من _forumLiveSync
  const _forumIO = new IntersectionObserver(() => _forumLiveSync());
  Object.keys(_forumLive).forEach(k => { const el = document.getElementById(_forumLive[k].content); if (el) _forumIO.observe(el); });
}

async function loadNews()     { _forumLiveSync(); }
async function loadExams()    { _forumLiveSync(); }
async function loadSections() { _forumLiveSync(); }

async function deleteItem(col, id, cardEl) {
  if (!isAdmin()) return toast("ليس لديك صلاحية", "error");
  const ok = await confirm("تأكيد الحذف", "هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع.");
  if (!ok) return;

  // احفظ بيانات العنصر قبل الحذف
  let itemData = {};
  try {
    const _snap = await getDoc(doc(db, col, id));
    if (_snap.exists()) itemData = _snap.data();
  } catch(_e) {}

  // ✅ Admin Isolation: تحقق داخل عملية الحذف نفسها (وليس اعتمادًا على أن العنصر
  // ظهر أصلاً في قائمة مفلترة) — الأونر يتجاوز التحقق ويبقى Global كالمعتاد.
  if (!isOwner()) {
    const _myWorld = (typeof window.currentUserWorldId === "function") ? window.currentUserWorldId() : null;
    if (!itemData.worldId || itemData.worldId !== _myWorld) {
      toast("غير مصرح — هذا العنصر لا يتبع عالمك", "error");
      return;
    }
  }

  const _auditActionMap = {
    news:      AUDIT_ACTIONS.DELETE_NEWS,
    lectures:  AUDIT_ACTIONS.DELETE_LECTURE,
    exams:     AUDIT_ACTIONS.DELETE_EXAM,
    sections:  AUDIT_ACTIONS.DELETE_SECTION,
  };

  try {
    await deleteDoc(doc(db, col, id));
    cardEl?.remove();

    // ── Audit Log ──
    await writeAuditLog(
      _auditActionMap[col] || 'delete_content',
      {
        collection: col,
        docId:      id,
        title:      itemData.title || itemData.subject || itemData.name || '—',
      }
    );

    toast("تم الحذف");
    try { window.CardGateway?.syncAfterWrite(col, id, (typeof window.activeWorldContext === "function") ? window.activeWorldContext() : null); } catch(_) {} // مزامنة البوابة (كامنة) — لا تمنع الحذف أبدًا
  } catch(e) { toast("فشل الحذف", "error"); console.error(e); }
}
window.deleteItem = deleteItem;

export { loadExams, loadNews, loadSections };
