import { collection, query, where, onSnapshot, doc, getDoc, getDocs, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ── عدّاد غير المقروء: بدون مستمعات — يُحسب بعدّ من السيرفر عند وصول رسالة جديدة من الطرف الآخر فقط ── */
const _escHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let _dmsUnreadMap = {};  // roomId → عدد غير المقروء
let _dmsCountedAt = {};  // roomId → lastMessageAt (ms) عند آخر عدّ
let _dmsCountSeq  = {};  // roomId → رقم آخر طلب عدّ (لتجاهل الردود المتأخرة)

/* ── ذاكرة محلية (localStorage): محادثات عدّيناها ولقينا الناتج صفر عند lastMessageAt معيّن — تُتخطى عند الدخول التالي ── */
let _dmsZero = null;
function _dmsZeroMap() {
  if (!_dmsZero) { try { _dmsZero = JSON.parse(localStorage.getItem("dmsZero_" + window.currentUser?.uid) || "{}"); } catch (e) { _dmsZero = {}; } }
  return _dmsZero;
}
function _dmsZeroSet(roomId, ms) {
  if (!ms) return;
  const m = _dmsZeroMap();
  if (m[roomId] === ms) return;
  m[roomId] = ms;
  try { localStorage.setItem("dmsZero_" + window.currentUser?.uid, JSON.stringify(m)); } catch (e) {}
}

function _dmsSetUnread(roomId, otherId, cnt) {
  _dmsUnreadMap[roomId] = cnt;
  const item = _dmsItems.find(i => i.id === otherId);
  if (item) item.unread = cnt;
  _render(document.getElementById("dmsSearchInp")?.value||"");
  _updateNavBadge();
}

async function _dmsCountUnread(roomId, otherId, gen) {
  const seq = (_dmsCountSeq[roomId] || 0) + 1;
  _dmsCountSeq[roomId] = seq;
  const at = _dmsCountedAt[roomId];
  const q = query(collection(window.db, `privateChats/${roomId}/messages`), where("uid","==",otherId), where("seen","==",false));
  let cnt;
  try {
    cnt = (await getCountFromServer(q)).data().count;
  } catch (err) {
    if (gen !== _dmsGen || _dmsCountSeq[roomId] !== seq) return;
    delete _dmsCountedAt[roomId]; // تُعاد المحاولة مع أول snapshot (عند رجوع الاتصال)
    if (err && (err.code === "unavailable" || navigator.onLine === false)) {
      // بدون اتصال: نعرض العدد من الكاش المحلي (زي ما كان يحصل أوفلاين) بدون اعتباره عدًّا مؤكدًا ولا نخزّن صفر
      try {
        const snap = await getDocs(q);
        if (gen === _dmsGen && _dmsCountSeq[roomId] === seq) _dmsSetUnread(roomId, otherId, window._currentChatId === otherId ? 0 : snap.size);
      } catch (e2) { /* لا كاش متاح — نكمل بالمعروض */ }
    } else {
      console.error("[dms] unread count error:", roomId, err);
    }
    return;
  }
  if (gen !== _dmsGen || _dmsCountSeq[roomId] !== seq) return;
  if (cnt === 0) _dmsZeroSet(roomId, at);
  _dmsSetUnread(roomId, otherId, window._currentChatId === otherId ? 0 : cnt);
}

/* العودة للتطبيق: أعد عدّ المحادثات التي بها عدّاد فقط (لو اتقرأت من جهاز آخر) */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !_dmsStarted) return;
  _dmsItems.forEach(i => {
    if (i.id === "public" || !(i.unread > 0)) return;
    const rid = window.privateChatId?.(i.id);
    if (rid) _dmsCountUnread(rid, i.id, _dmsGen);
  });
});

/* ══════════════════════════════════════════
   DMS PAGE — صفحة الدردشات
   ▸ preload فور تسجيل الدخول
   ▸ badge غير مقروء في الـ nav
   ▸ عداد لكل محادثة
══════════════════════════════════════════ */

let _dmsStarted   = false;
let _dmsStartedUid = null; // uid الحساب الذي بدأت له المستمعات حالياً
let _dmsGen       = 0;     // رقم "جلسة" المستمعات — أي callback متأخر من جلسة قديمة يُتجاهل
let _dmsCurFilter = "all";
let _dmsUnsubs    = [];
let _dmsItems     = [];
let _dmsRooms     = [];

/* ── تنسيق الوقت ── */
function _fmt(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000) return d.toLocaleTimeString("ar-EG",{hour:"2-digit",minute:"2-digit"});
  if (diff < 604800000) return ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][d.getDay()];
  return d.toLocaleDateString("ar-EG",{day:"2-digit",month:"2-digit"});
}

/* ── avatar ── */
function _av(photo, name, cls) {
  if (cls==="public") return `<div class="dms-conv-avatar dms-conv-avatar-public"><i class="fa-solid fa-graduation-cap"></i></div>`;
  if (cls==="room")   return `<div class="dms-conv-avatar dms-conv-avatar-room"><i class="fa-solid fa-users"></i></div>`;
  if (cls==="ai")     return `<div class="dms-conv-avatar ai-avatar"><i class="fa-solid fa-sparkles"></i></div>`;
  if (photo) return `<img class="dms-conv-avatar" src="${_escHtml(photo)}" alt="">`;
  return `<div class="dms-conv-avatar dms-conv-avatar-letter">${_escHtml((name||"?").charAt(0).toUpperCase())}</div>`;
}

/* ── بناء عنصر ── */
function _buildItem(item) {
  const badge = item.unread > 0 ? `<span class="dms-unread-badge">${item.unread>99?"99+":item.unread}</span>` : "";
  const safeName = (item.name||"").replace(/'/g,"\\'").replace(/"/g,"&quot;");
  const safePhoto = (item.photo||"").replace(/'/g,"\\'");
  const showDot = item.cls === "";
  const ringCls = item.cls === "ai" ? " ai-ring" : "";
  let extrasHTML = "";
  if (showDot && typeof window._dmExtrasRender === "function") {
    try { extrasHTML = window._dmExtrasRender(item) || ""; } catch (e) { extrasHTML = ""; }
  }
  // شارة توثيق/أدمن (إن وُجدت) — تظهر فقط للمحادثات الخاصة (نفس شرط showDot)
  let nameBadgesHTML = "";
  if (showDot && typeof window._chatListBadgesHTML === "function") {
    try { nameBadgesHTML = window._chatListBadgesHTML({ uid: item.id, role: item.role }) || ""; } catch (e) { nameBadgesHTML = ""; }
  }
  // فرع جديد خاص فقط بالمستخدم العادي بدون صورة — لا يمس _av() ولا يغيّر استدعاءها في باقي الحالات
  const _avatarHTML = (item.cls === "" && !item.photo && typeof window._defaultAvatarHTML === "function")
    ? `<div class="dms-conv-avatar dms-conv-avatar-letter">${window._defaultAvatarHTML(item.gender, 32)}</div>`
    : _av(item.photo, item.name, item.cls);
  return `
    <div class="dms-conv-item" id="dms-item-${item.id}" ${showDot ? `data-other-id="${item.id}"` : ""} onclick="_dmsOpenChat('${item.id}','${safeName}','${safePhoto}')">
      <div class="dms-avatar-wrap${ringCls}">
        ${_avatarHTML}
      </div>
      <div class="dms-conv-body">
        <div class="dms-conv-row1">
          <span dir="auto"><span class="dms-conv-name">${_escHtml(item.name||"مستخدم")}${item.cls==="ai" ? ' <span class="ai-badge">AI</span>' : ""}</span>${nameBadgesHTML}</span>
          ${extrasHTML}
          <span class="dms-conv-time">${_fmt(item.lastTime)}</span>
        </div>
        <div class="dms-conv-row2">
          <span class="dms-conv-last">${_escHtml(item.lastMsg||"ابدأ المحادثة")}</span>
          <span class="dms-conv-badges">${badge}</span>
        </div>
      </div>
    </div>`;
}

/* ── تحديث badge الـ nav ──
   العدد هنا = عدد المحادثات (الأشخاص) التي بها رسائل غير مقروءة
   وليس مجموع الرسائل غير المقروءة ── */
function _updateNavBadge() {
  const convCount = _dmsItems.filter(i => (i.unread||0) > 0).length;
  const el = document.getElementById("navDmsBadge");
  if (!el) return;
  if (convCount > 0) {
    el.textContent    = convCount > 99 ? "99+" : convCount;
    el.style.display  = "";
  } else {
    el.style.display  = "none";
  }
}

/* ── عرض القائمة (تشمل الدردشات والغرف مدموجة معًا، مرتبة حسب آخر نشاط) ── */
function _render(search, containerId = "dmsConvList", forceArchive = false) {
  const el = document.getElementById(containerId);
  if (!el) return;
  let items = [..._dmsItems, ..._dmsRooms.map(_roomToItem)];
  if (typeof window._aiListItem === "function") {
    const ai = window._aiListItem();
    if (ai) items.push(ai);
  }
  // إبقاء الشات العام في الأعلى دائمًا. الباقي (دردشات + غرف) يُرتَّب حسب آخر
  // نشاط، مع الحفاظ على أولوية التثبيت/المفضلة (window._dmExtrasSort) لو متاحة
  // — نفس المنطق الموجود أصلاً، بس مطبَّق على القائمة المدموجة بالكامل.
  const pub = items.filter(i => i.id === "public");
  let rest = items.filter(i => i.id !== "public")
    .sort((a,b) => (b.lastTime?.toMillis?.()??0) - (a.lastTime?.toMillis?.()??0));
  if (typeof window._dmExtrasSort === "function") {
    try { rest = window._dmExtrasSort(rest) || rest; } catch (e) {}
  }
  items = [...pub, ...rest];

  // الأرشيف — ميزة جديدة (الوحيدة المضافة فعليًا). المحادثة العامة لا تُؤرشف أبدًا.
  const isArchived = (id) => {
    if (id === "public") return false;
    try { return typeof window._dmExtrasIsArchived === "function" ? window._dmExtrasIsArchived(id) : false; }
    catch (e) { return false; }
  };
  // عداد الأرشيف يُحدَّث فقط أثناء رسم القائمة الرئيسية (مش من شاشة الأرشيف نفسها)
  if (!forceArchive) {
    const archCountEl = document.getElementById("dmsArchiveCount");
    if (archCountEl) archCountEl.textContent = items.filter(i => isArchived(i.id)).length;
  }

  const showArchiveOnly = forceArchive || _dmsCurFilter === "archive";
  if (showArchiveOnly) {
    items = items.filter(i => isArchived(i.id));
  } else {
    items = items.filter(i => !isArchived(i.id));
  }

  if (!forceArchive && _dmsCurFilter === "unread") items = items.filter(i => i.unread > 0);
  if (!forceArchive && _dmsCurFilter === "fav") {
    items = items.filter(i => {
      try { return typeof window._dmExtrasIsFav === "function" ? window._dmExtrasIsFav(i.id) : false; }
      catch (e) { return false; }
    });
  }
  if (search) {
    const s = search.toLowerCase();
    items = items.filter(i => (i.name||"").toLowerCase().includes(s));
  }
  if (!items.length) {
    const emptyMsg = showArchiveOnly ? "لا توجد محادثات مؤرشفة" : "لا توجد محادثات";
    el.innerHTML = `<div class="dms-empty"><i class="fa-regular fa-comment-dots"></i><p>${emptyMsg}</p></div>`;
    return;
  }
  el.innerHTML = items.map(_buildItem).join("");
  // — يُتخطَّى في شاشة الأرشيف المستقلة
  if (!forceArchive) {
    window._dmsRefreshFoldEffects?.();
  }
}

/* ── إعادة رسم القائمة الرئيسية + شاشة الأرشيف لو مفتوحة (تُستدعى من مستمع privateChats بعد أي تغيير تثبيت/مفضلة/كتم/أرشفة) ── */
function _rerenderLists() {
  _render(document.getElementById("dmsSearchInp")?.value||"");
  // لو شاشة الأرشيف مفتوحة حاليًا، حدِّثها فورًا كمان (مثلاً بعد إلغاء أرشفة
  // عنصر من داخلها) بدل ما يفضل يظهر فيها لحد ما يدخلها تاني.
  if (document.getElementById("page-dms-archive")?.classList.contains("active")) {
    _render("", "dmsArchiveList", true);
  }
}

/* ── فتح محادثة ── */
window._dmsOpenChat = function(id, name, photo) {
  if (id === "ai") {
    if (typeof window._openAiChat === "function") window._openAiChat();
    return;
  }
  window.selectChat(id, name, photo);
};

/* ── إعادة رسم القائمة من مصدر خارجي (مثلاً ai-assistant.js لما تتحدث آخر رسالة) ── */
window._dmsRerender = function() {
  _render(document.getElementById("dmsSearchInp")?.value || "");
};

/* ── تصفير فوري لعداد شخص معيّن عند فتح محادثته (يُستدعى من selectChat) ── */
window._dmsMarkRead = function(otherId) {
  const _rid = window.privateChatId?.(otherId);
  if (_rid) { _dmsUnreadMap[_rid] = 0; _dmsZeroSet(_rid, _dmsCountedAt[_rid]); }
  const item = _dmsItems.find(i => i.id === otherId);
  if (item && item.unread) {
    item.unread = 0;
    _render(document.getElementById("dmsSearchInp")?.value||"");
    _updateNavBadge();
  }
};

/* ── فلتر ── */
window._dmsFilter = function(btn, filter) {
  _dmsCurFilter = filter;
  document.querySelectorAll(".dms-chip").forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  _render(document.getElementById("dmsSearchInp")?.value || "");
};

/* ── صندوق الأرشيف المستقل — شاشة منفصلة (القرار النهائي المؤكَّد) ──
   يُعيد استخدام _render()/_dmsAttachFoldEffect() الموجودتين بالكامل بدل
   تكرار منطق الفلترة/الفرز أو تأثير الطي 3D. */
window._dmsOpenArchive = function () {
  showPage("page-dms-archive");
  _render("", "dmsArchiveList", true);
  const panel = document.getElementById("dmspanel-archive");
  if (panel) {
    _dmsAttachFoldEffect(panel, ".dms-conv-item");
  }
};

/* ── تبويبات ── */
window._dmsSwitchTab = function(btn, panel) {
  document.querySelectorAll(".dms-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".dms-fab-item").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".dms-panel").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("dmspanel-" + panel)?.classList.add("active");
  const filters = document.getElementById("dmsFilters");
  if (filters) filters.style.display = panel === "chats" ? "" : "none";
  if (panel === "members" && typeof window.renderMembersList === "function") {
    window.renderMembersList("", "dmsMembersList");
  }
  if (panel === "calls" && window.BisCallHistory && typeof window.BisCallHistory.renderCallsList === "function") {
    window.BisCallHistory.renderCallsList("dmsCallsList");
  }
  // خطوة 5.2 — نص placeholder صندوق البحث حسب التاب النشط
  const searchInp = document.getElementById("dmsSearchInp");
  if (searchInp) {
    searchInp.placeholder = panel === "members"
      ? "بحث عن مستخدمين - UID"
      : "البحث عن رسائل أو مستخدمين...";
  }
  // خطوة 5.3 — عنوان الصفحة يتغيّر حسب التاب النشط
  const titleEl = document.querySelector("#page-dms .dms-header-title");
  if (titleEl) {
    titleEl.textContent = panel === "members" ? "المستخدمون" : (panel === "calls" ? "المكالمات" : "الدردشات");
  }
  window._dmsRefreshFoldEffects?.();
};

/* ── الدائرة العائمة (حالات / مكالمات / أعضاء) ── */
window._dmsFabToggle = function(force) {
  const w = document.getElementById("dmsFab");
  if (!w) return;
  const open = typeof force === "boolean" ? force : !w.classList.contains("open");
  w.classList.toggle("open", open);
  document.getElementById("dmsFabMain")?.setAttribute("aria-expanded", open ? "true" : "false");
};
window._dmsFabClose = function() { window._dmsFabToggle(false); };
document.addEventListener("click", e => {
  const w = document.getElementById("dmsFab");
  if (w && w.classList.contains("open") && !w.contains(e.target)) window._dmsFabToggle(false);
});

/* ── بحث ── */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("dmsSearchToggle")?.addEventListener("click", () => {
    const bar = document.getElementById("dmsSearchBar");
    if (bar) { bar.classList.toggle("open"); if (bar.classList.contains("open")) document.getElementById("dmsSearchInp")?.focus(); }
  });
  document.getElementById("dmsSearchInp")?.addEventListener("input", e => _render(e.target.value));
});

/* ── تحويل بيانات الغرفة لنفس شكل عنصر المحادثة، عشان تندمج في نفس القائمة ── */
function _roomToItem(r) {
  return {
    id: "room:" + r.id, name: r.name || "غرفة", photo: r.photo || "", cls: "room",
    lastMsg: r.desc || "غرفة نقاش", lastTime: r.lastMessageAt || r.createdAt || null,
    unread: 0
  };
}

/* ══ PRELOAD — يبدأ فور تسجيل الدخول ══ */
/* ── إيقاف كل مستمعات/حالة قائمة الـDM (تسجيل خروج أو تغيّر الحساب) ── */
window._dmsStopListeners = function() {
  _dmsGen++; // يُبطل أي callback غير متزامن ما زال معلّقاً من الجلسة السابقة
  _dmsUnsubs.forEach(fn => { try { fn(); } catch (e) {} });
  _dmsUnsubs = [];
  _dmsUnreadMap    = {};
  _dmsCountedAt    = {};
  _dmsCountSeq     = {};
  _dmsZero         = null;
  _dmsItems = [];
  _dmsRooms = [];
  const _apStop = window._acceptedPeers; if (_apStop) Object.keys(_apStop).forEach(k => delete _apStop[k]);
  window._dmExtrasStop?.();
  window._dmsRoomsChanged?.();
  _dmsStarted = false;
  _dmsStartedUid = null;
  ["dmsConvList", "dmsArchiveList"].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ""; });
  const si = document.getElementById("dmsSearchInp"); if (si) si.value = "";
  _updateNavBadge();
};

/* ── حارس: لو الحساب الحالي غير الحساب المرتبط بالمستمعات، أوقفها فوراً ── */
window._dmsGuardUser = function(uid) {
  if (_dmsStarted && _dmsStartedUid !== uid) window._dmsStopListeners();
};

window._dmsStartListeners = function() {
  if (!window.db || !window.currentUser) return;
  const uid = window.currentUser.uid;
  if (_dmsStarted && _dmsStartedUid === uid) return; // نفس الحساب: لا تكرار
  if (_dmsStarted) window._dmsStopListeners();       // حساب مختلف: نظّف الجلسة السابقة أولاً
  _dmsStarted = true;
  _dmsStartedUid = uid;
  const gen = ++_dmsGen;

  // cache أسماء المستخدمين لتجنب getDoc متكررة
  const _nameCache = {}, _namePending = {};
  async function _getUser(peerUid) {
    if (_namePending[peerUid]) return _namePending[peerUid];
    _namePending[peerUid] = (async () => {
      try {
        let data;
        if (window._getUserProfile) data = await window._getUserProfile(peerUid);
        else {
          if (_nameCache[peerUid]) return _nameCache[peerUid];
          const s = await getDoc(doc(window.db, "users", peerUid));
          data = s.exists() ? s.data() : {};
        }
        const u = {name:data.name||"مستخدم",photo:data.photo||"",role:data.role||"user",gender:data.gender||""};
        if (gen === _dmsGen) _nameCache[peerUid] = u;
        return u;
      } catch(e) { return {name:"مستخدم",photo:"",role:"user",gender:""}; }
      finally { delete _namePending[peerUid]; }
    })();
    return _namePending[peerUid];
  }

  // الشات العام
  const pubItem = { id:"public", name:"الشات العام", photo:"", cls:"public", lastMsg:"مباشر — الجميع", lastTime:null, unread:0 };
  _dmsItems = [pubItem];

  // المحادثات الخاصة
  const privQ = query(collection(window.db,"privateChats"), where("participants","array-contains",uid));
  _dmsUnsubs.push(onSnapshot(privQ, { includeMetadataChanges: true }, async snap => {
    if (gen !== _dmsGen) return;
    const activeRoomIds  = new Set();
    const activeOtherIds = new Set();
    const pairs = [];
    for (const ds of snap.docs) {
      const d       = ds.data();
      const roomId  = ds.id;
      const otherId = (d.participants||[]).find(p => p !== uid);
      if (!otherId) continue;
      activeRoomIds.add(roomId);
      activeOtherIds.add(otherId);
      pairs.push({ d, roomId, otherId, hasPendingWrites: ds.metadata.hasPendingWrites });
    }

    // مزامنة window._acceptedPeers من هذا المستمع نفسه (بدون مستمع إضافي) —
    // يستهلكها حوار التحويل (index.html) وأيقونة المحادثة في قائمة الأعضاء (members-list.js)
    const _apSync = window._acceptedPeers;
    if (_apSync) {
      Object.keys(_apSync).forEach(k => { if (!activeOtherIds.has(k)) delete _apSync[k]; });
      pairs.forEach(p => { _apSync[p.otherId] = { roomId: p.roomId, participants: p.d.participants }; });
    }
    window._dmExtrasFeed?.(pairs, uid);

    // نجيب بيانات كل الأطراف الأخرى مرة واحدة بالتوازي (بدل الانتظار
    // لكل محادثة على حدة بالتتابع — ده كان سبب البطء اللي بياخد ثواني
    // كتير مع زيادة عدد المحادثات) ─────────────────────────────────
    await Promise.all(pairs.map(p => _getUser(p.otherId)));
    if (gen !== _dmsGen) return; // تغيّر الحساب/سُجّل الخروج أثناء الانتظار

    let items = [];
    for (const { d, roomId, otherId, hasPendingWrites } of pairs) {
      // عدّاد غير المقروء: عدّ واحد من السيرفر فقط عند وصول رسالة جديدة من الطرف الآخر (بدون أي مستمع)
      if (!hasPendingWrites) {
        const lastMs = d.lastMessageAt?.toMillis?.() ?? 0;
        if (d.lastSenderId === uid || window._currentChatId === otherId) {
          _dmsUnreadMap[roomId] = 0; _dmsCountedAt[roomId] = lastMs; _dmsZeroSet(roomId, lastMs);
        } else if (_dmsCountedAt[roomId] !== lastMs) {
          _dmsCountedAt[roomId] = lastMs;
          if (lastMs && _dmsZeroMap()[roomId] === lastMs) _dmsUnreadMap[roomId] = 0;
          else _dmsCountUnread(roomId, otherId, gen);
        }
      }
      const u = _nameCache[otherId] || { name:"مستخدم", photo:"", role:"user", gender:"" };
      items.push({
        id: otherId, name: u.name, photo: u.photo, cls: "",
        role: u.role, gender: u.gender,
        lastMsg:  d.lastMessage   || "",
        lastTime: d.lastMessageAt || null,
        unread:   _dmsUnreadMap[roomId] || 0
      });

    }

    // تنظيف عدّادات الغرف التي لم تعد موجودة (محادثة محذوفة مثلاً)
    Object.keys(_dmsCountedAt).forEach(rid => {
      if (!activeRoomIds.has(rid)) { delete _dmsUnreadMap[rid]; delete _dmsCountedAt[rid]; delete _dmsCountSeq[rid]; }
    });
    items.sort((a,b) => (b.lastTime?.toMillis?.()??0) - (a.lastTime?.toMillis?.()??0));
    if (typeof window._dmExtrasSort === "function") {
      try { items = window._dmExtrasSort(items) || items; } catch (e) {}
    }
    const pub = _dmsItems.find(i => i.id==="public") || pubItem;
    _dmsItems = [pub, ...items];
    _rerenderLists();
    _updateNavBadge();
  }, err => {
    console.error("[dms] privateChats listener error:", err);
    if (gen !== _dmsGen) return;
    // لا تُبقِ أي بيانات قديمة معروضة: امسح المحادثات وعدّاداتها
    _dmsUnreadMap = {}; _dmsCountedAt = {};
    _dmsItems = [_dmsItems.find(i => i.id === "public") || pubItem];
    _render(document.getElementById("dmsSearchInp")?.value||"");
    _updateNavBadge();
  }));

  // الغرف — تُدمَج الآن داخل نفس قائمة الدردشات (بدل تبويب مستقل)
  const worldId = window.activeWorldContext?.();
  if (!worldId || !window.isValidWorldId?.(worldId)) {
    _dmsRooms = [];
    _render(document.getElementById("dmsSearchInp")?.value||"");
    window._dmsRoomsChanged?.();
    return;
  }
  _dmsUnsubs.push(onSnapshot(query(collection(window.db,"rooms"), where("worldId","==",worldId)), snap => {
    if (gen !== _dmsGen) return;
    _dmsRooms = snap.docs.map(d => ({id:d.id,...d.data()}));
    _render(document.getElementById("dmsSearchInp")?.value||"");
    window._dmsRoomsChanged?.();
  }, err => {
    console.error("[dms] rooms listener error:", err);
    if (gen !== _dmsGen) return;
    _dmsRooms = [];
    _render(document.getElementById("dmsSearchInp")?.value||"");
    window._dmsRoomsChanged?.();
  }));
};

/* ── واجهات قراءة للمستهلكين خارج الملف (حوار التحويل + قائمة غرف لوحة المالك) ──
   بدون أي مستمع إضافي: تقرأ من نفس بيانات المستمعات أعلاه ── */
window._dmsGetRooms = function() {
  return [..._dmsRooms].sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
};
window._dmsGetPeerInfo = function(uid) {
  const it = _dmsItems.find(x => x.id === uid);
  return it ? { name: it.name, photo: it.photo, gender: it.gender } : null;
};

/* ══════════════════════════════════════════
   تأثير الطي/التصغير ثلاثي الأبعاد عند السكرول — نفس آلية التصميم
   المرجعي بالحرف (perspective + scale + rotateX + opacity حسب المسافة
   من حافة الحاوية العلوية/السفلية). Scroll-driven بالكامل، بدون تأخير.
   Reusable: بتتوصل على أي حاوية سكرول + أي selector للعناصر جواها.
══════════════════════════════════════════ */
const _dmsFoldAttached = new Set();

function _dmsAttachFoldEffect(panelEl, itemSelector) {
  if (!panelEl || _dmsFoldAttached.has(panelEl)) return () => {};
  _dmsFoldAttached.add(panelEl);

  const topZone = 60;
  const bottomZone = 110;
  let ticking = false;

  function update() {
    const panelRect = panelEl.getBoundingClientRect();
    if (panelRect.width === 0 && panelRect.height === 0) return; // القائمة مخفية حاليًا (display:none) — لا تحسب ولا تلمس أي عنصر
    const items = panelEl.querySelectorAll(itemSelector);
    items.forEach(item => {
      const r = item.getBoundingClientRect();
      const centerY = r.top + r.height / 2;
      const distTop = centerY - panelRect.top;
      const distBottom = panelRect.bottom - centerY;

      let scale = 1, opacity = 1, translateY = 0, rotate = 0;

      if (distTop < topZone) {
        const t = Math.max(0, Math.min(1, distTop / topZone));
        scale = 0.82 + 0.18 * t;
        opacity = Math.max(0.05, t);
        translateY = (1 - t) * -10;
        rotate = (1 - t) * -10;
      } else if (distBottom < bottomZone) {
        const t = Math.max(0, Math.min(1, distBottom / bottomZone));
        scale = 0.82 + 0.18 * t;
        opacity = Math.max(0.05, t);
        translateY = (1 - t) * 10;
        rotate = (1 - t) * 10;
      }

      item.style.transform = `perspective(700px) scale(${scale}) translateY(${translateY}px) rotateX(${rotate}deg)`;
      item.style.opacity = opacity;
    });
    ticking = false;
  }

  panelEl.addEventListener("scroll", () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });

  update();
  setTimeout(update, 60);
  return update;
}

let _dmsUpdateChatsFold = null;
let _dmsUpdateMembersFold = null;
window._dmsRefreshFoldEffects = function () {
  const chatsPanel   = document.getElementById("dmspanel-chats");
  const membersPanel = document.getElementById("dmspanel-members");
  if (chatsPanel && !_dmsUpdateChatsFold) {
    _dmsUpdateChatsFold = _dmsAttachFoldEffect(chatsPanel, ".dms-conv-item");
  }
  if (membersPanel && !_dmsUpdateMembersFold) {
    _dmsUpdateMembersFold = _dmsAttachFoldEffect(membersPanel, ".dm-item");
  }
  _dmsUpdateChatsFold?.();
  _dmsUpdateMembersFold?.();
  setTimeout(() => { _dmsUpdateChatsFold?.(); _dmsUpdateMembersFold?.(); }, 80);
};

/* ══ فتح الصفحة ══ */
window._dmsPageInit = function() {
  // reset UI
  const si = document.getElementById("dmsSearchInp"); if (si) { si.value = ""; si.placeholder = "البحث عن رسائل أو مستخدمين..."; }
  const titleEl = document.querySelector("#page-dms .dms-header-title"); if (titleEl) titleEl.textContent = "الدردشات";
  _dmsCurFilter = "all";
  document.querySelectorAll(".dms-chip").forEach((c,i) => c.classList.toggle("active",i===0));
  document.querySelectorAll(".dms-tab").forEach((t,i)  => t.classList.toggle("active",i===0));
  document.querySelectorAll(".dms-fab-item").forEach(t => t.classList.remove("active"));
  window._dmsFabClose?.();
  document.querySelectorAll(".dms-panel").forEach((p,i) => p.classList.toggle("active",i===0));
  const filters = document.getElementById("dmsFilters"); if (filters) filters.style.display = "";

  // إن لم تبدأ الـ listeners بعد، ابدأها الآن
  window._dmsStartListeners?.();
  // عرض ما هو محمّل فعلاً (سريع لأن البيانات جاهزة)
  _render("");
  window._dmsRefreshFoldEffects();
};
