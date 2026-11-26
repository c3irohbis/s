/* split from js/app-main.js (block Q_add_content) — verbatim code; cross-module state writes go through __set_* helpers */
import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./a-init-config.js";
import { _notifyAllUsers } from "./b-fcm-notif.js";
import { currentUser, isAdmin } from "./d-state-roles-email.js";
import { loadExams, loadNews, loadSections } from "./p-content-loaders-forum.js";
/* ══════════════════════════════════════════
   ADMIN / OWNER — ADD CONTENT
══════════════════════════════════════════ */
function makeAdder(btnId, getFields, colName, successMsg, reloadFn) {
  const el = document.getElementById(btnId);
  if (!el) return;
  el.addEventListener("click", async () => {
    if (!isAdmin()) return toast("ليس لديك صلاحية", "error");
    // ✅ World Isolation: worldId إلزامي — activeWorldContext() هو المصدر الوحيد، لا يُخمَّن ولا يُترك فارغًا.
    const _worldId = (typeof window.activeWorldContext === "function") ? window.activeWorldContext() : null;
    if (!_worldId) { toast("لا يوجد عالم نشط — تعذّرت الإضافة", "error"); return; }
    const fields = getFields();
    if (!fields) return;
    const _senderUid = currentUser?.uid;
    let saved = false;
    let _newId = null;
    try {
      const _ref = colName==='news'&&(window.__BLISS_NEWS_MODE!=='firebase')?await window.NewsFeed.add(fields,{world:_worldId}):colName==='lectures'&&(window.__BLISS_LECTURES_MODE!=='firebase')?await window.LecturesLib.add(fields,{world:_worldId}):colName==='exams'&&(window.__BLISS_EXAMS_MODE!=='firebase')?await window.ExamsFeed.add(fields,{world:_worldId}):colName==='sections'&&(window.__BLISS_SECTIONS_MODE!=='firebase')?await window.SectionsFeed.add(fields,{world:_worldId}):await addDoc(collection(db, colName), { ...fields, worldId: _worldId, createdAt: serverTimestamp() });
      _newId = _ref && _ref.id;
      saved = true;
      if(colName==='news'&&(window.__BLISS_NEWS_MODE!=='firebase')){
        const prefix=btnId==='oAddNewsBtn'?'oNews':'news';
        const titleEl=document.getElementById(prefix+'Title'),bodyEl=document.getElementById(prefix+'Body');
        if(titleEl?.value.trim()===fields.title&&bodyEl?.value.trim()===fields.body){titleEl.value='';bodyEl.value='';}
      }
    } catch(e) {
      toast("فشلت الإضافة", "error");
      console.error(e);
      return;
    }
    if (saved) {
      toast(successMsg, "success");
      if(colName==='news'&&(window.__BLISS_NEWS_MODE!=='firebase')){try{reloadFn();}catch{}return;}
      if(colName==='lectures'&&(window.__BLISS_LECTURES_MODE!=='firebase')){try{reloadFn();}catch{}return;}
      if(colName==='exams'&&(window.__BLISS_EXAMS_MODE!=='firebase'))return;
      if(colName==='sections'&&(window.__BLISS_SECTIONS_MODE!=='firebase'))return;
      try { window.CardGateway?.syncAfterWrite(colName, _newId, _worldId); } catch(_) {} // مزامنة البوابة (كامنة) — لا تمنع الإضافة أبدًا
      try { reloadFn(); } catch(_) {}
      if(colName==='news'&&(window.__BLISS_NEWS_MODE!=='firebase'))return;
      // FCM: notify all users
      const _nt = { news: "📰 خبر جديد", lectures: "📚 محاضرة جديدة", exams: "📅 امتحان جديد", sections: "🏫 سكشن جديد" };
      _notifyAllUsers(
        _nt[colName] || "🔔 محتوى جديد",
        fields.title || fields.subject || fields.name || "",
        { type: colName },
        { senderUid: _senderUid, worldId: _worldId, contentId: _newId, colName }
      ).then(result => {
        if (result.directoryFailed || result.failed || result.aborted || result.unsupported) {
          console.warn("Content notification distribution incomplete:", result);
        }
      }).catch(() => { console.warn("Content notification distribution failed after saving content"); });
    }
  });
}

makeAdder("addNewsBtn", () => {
  const title = document.getElementById("newsTitle").value.trim();
  const body  = document.getElementById("newsBody").value.trim();
  if (!title) { toast("اكتب عنوان الخبر","error"); return null; }
  if(!(window.__BLISS_NEWS_MODE!=='firebase')){document.getElementById("newsTitle").value="";document.getElementById("newsBody").value="";}
  return { title, body };
}, "news", "تم نشر الخبر", loadNews);

makeAdder("addLecBtn", () => {
  const subject = document.getElementById("lecSubject")?.value.trim();
  const title   = document.getElementById("lecTitle").value.trim();
  const desc    = document.getElementById("lecDesc").value.trim();
  const type    = document.getElementById("lecType")?.value || "link";
  if (!subject) { toast("اكتب اسم المادة","error"); return null; }
  if (!title)   { toast("اكتب عنوان المحاضرة","error"); return null; }
  let content = {};
  if (type === "link") {
    const url = document.getElementById("lecUrl")?.value.trim();
    if (!url) { toast("أدخل الرابط","error"); return null; }
    content = { url };
  } else if (type === "pdf") {
    const pdf = document.getElementById("lecPdf")?.value.trim();
    if (!pdf) { toast("أدخل رابط PDF","error"); return null; }
    content = { pdf };
  } else if (type === "text") {
    const text = document.getElementById("lecText")?.value.trim();
    if (!text) { toast("اكتب المحتوى","error"); return null; }
    content = { text };
  }
  ["lecSubject","lecTitle","lecDesc","lecUrl","lecPdf","lecText"].forEach(i => { const el = document.getElementById(i); if (el) el.value = ""; });
  return { subject, title, description: desc, contentType: type, ...content };
}, "lectures", "تمت إضافة المحاضرة", window.loadLectures);

makeAdder("addExamBtn", () => {
  const subject = document.getElementById("examSub").value.trim();
  const date    = document.getElementById("examDate").value.trim();
  const time    = document.getElementById("examTime").value.trim();
  const room    = document.getElementById("examRoom").value.trim();
  if (!subject) { toast("اكتب اسم المادة","error"); return null; }
  ["examSub","examDate","examTime","examRoom"].forEach(i => document.getElementById(i).value="");
  return { subject, date, time, room };
}, "exams", "تمت إضافة الامتحان", loadExams);

makeAdder("addSecBtn", () => {
  const name    = document.getElementById("secName").value.trim();
  const subject = document.getElementById("secSubj").value.trim();
  const time    = document.getElementById("secTime").value.trim();
  const room    = document.getElementById("secRoom").value.trim();
  if (!name) { toast("اكتب اسم الدكتور","error"); return null; }
  ["secName","secSubj","secTime","secRoom"].forEach(i => document.getElementById(i).value="");
  return { name, subject, time, room };
}, "sections", "تمت إضافة السكشن", loadSections);

// Owner panel adders
makeAdder("oAddNewsBtn", () => {
  const title = document.getElementById("oNewsTitle").value.trim();
  const body  = document.getElementById("oNewsBody").value.trim();
  if (!title) { toast("اكتب عنوان الخبر","error"); return null; }
  if(!(window.__BLISS_NEWS_MODE!=='firebase')){document.getElementById("oNewsTitle").value="";document.getElementById("oNewsBody").value="";}
  return { title, body };
}, "news", "تم نشر الخبر", loadNews);

// إخطار سريع — نظام مستقل، بيستخدم window.qnPublish من quick-notifications.js
// شغّال من صفحتين مختلفتين (الأونر والأدمن) بنفس المنطق، كل واحدة بحقولها
function _wireQuickNotifBtn(btnId, titleId, bodyId, audienceId) {
  var btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener("click", async function () {
    if (!isAdmin()) return toast("ليس لديك صلاحية", "error");
    var title = document.getElementById(titleId).value;
    var body  = document.getElementById(bodyId).value;
    var _audEl = audienceId ? document.getElementById(audienceId) : null;
    await window.qnPublish(title, body, _audEl ? _audEl.value : undefined);
    document.getElementById(titleId).value = "";
    document.getElementById(bodyId).value = "";
  });
}
_wireQuickNotifBtn("oAddQuickNotifBtn", "qnTitleInput", "qnBodyInput", "qnAudienceSelect");
_wireQuickNotifBtn("adminAddQuickNotifBtn", "adminQnTitleInput", "adminQnBodyInput");

makeAdder("oAddLecBtn", () => {
  const subject = document.getElementById("oLecSubject")?.value.trim();
  const title   = document.getElementById("oLecTitle").value.trim();
  const desc    = document.getElementById("oLecDesc").value.trim();
  const type    = document.getElementById("oLecType")?.value || "link";
  if (!subject) { toast("اكتب اسم المادة","error"); return null; }
  if (!title)   { toast("اكتب عنوان المحاضرة","error"); return null; }
  let content = {};
  if (type === "link") {
    const url = document.getElementById("oLecUrl")?.value.trim();
    if (!url) { toast("أدخل الرابط","error"); return null; }
    content = { url };
  } else if (type === "pdf") {
    const pdf = document.getElementById("oLecPdf")?.value.trim();
    if (!pdf) { toast("أدخل رابط PDF","error"); return null; }
    content = { pdf };
  } else if (type === "text") {
    const text = document.getElementById("oLecText")?.value.trim();
    if (!text) { toast("اكتب المحتوى","error"); return null; }
    content = { text };
  }
  ["oLecSubject","oLecTitle","oLecDesc","oLecUrl","oLecPdf","oLecText"].forEach(i => { const el = document.getElementById(i); if (el) el.value = ""; });
  return { subject, title, description: desc, contentType: type, ...content };
}, "lectures", "تمت إضافة المحاضرة", window.loadLectures);

makeAdder("oAddExamBtn", () => {
  const subject = document.getElementById("oExamSub").value.trim();
  const date    = document.getElementById("oExamDate").value.trim();
  const time    = document.getElementById("oExamTime").value.trim();
  const room    = document.getElementById("oExamRoom").value.trim();
  if (!subject) { toast("اكتب اسم المادة","error"); return null; }
  ["oExamSub","oExamDate","oExamTime","oExamRoom"].forEach(i => document.getElementById(i).value="");
  return { subject, date, time, room };
}, "exams", "تمت إضافة الامتحان", loadExams);

makeAdder("oAddSecBtn", () => {
  const name    = document.getElementById("oSecName").value.trim();
  const subject = document.getElementById("oSecSubj").value.trim();
  const time    = document.getElementById("oSecTime").value.trim();
  const room    = document.getElementById("oSecRoom").value.trim();
  if (!name) { toast("اكتب اسم الدكتور","error"); return null; }
  ["oSecName","oSecSubj","oSecTime","oSecRoom"].forEach(i => document.getElementById(i).value="");
  return { name, subject, time, room };
}, "sections", "تمت إضافة السكشن", loadSections);
