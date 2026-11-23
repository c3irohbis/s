import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, getDocsFromServer, getCountFromServer, writeBatch, runTransaction,
  query, orderBy, onSnapshot, serverTimestamp,
  limit, where, startAfter, deleteField,
  arrayUnion, arrayRemove, increment,
  terminate, clearIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import {
  getMessaging, getToken, onMessage
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import { initFCM, showForegroundNotif, fcmSupported } from "./notif-permission.js";

/* ══════════════════════════════════════════
   CONFIG & INIT
══════════════════════════════════════════ */
const firebaseConfig = {
  apiKey:            "AIzaSyB538malKBKgsWO572c9uo4bOzzSGWFue8",
  authDomain:        "university-platform-dev.firebaseapp.com",
  projectId:         "university-platform-dev",
  storageBucket:     "university-platform-dev.firebasestorage.app",
  messagingSenderId: "665165296802",
  appId:             "1:665165296802:web:57aa1315497e48c25ad3fb"
};

const OWNER_UID = "wnvQPme3u0NU4VVqvr4DGqvv4KE3";
window.OWNER_UID = OWNER_UID; // ← تصدير: محتاجها js/chat-core.js (appendChatMsg)
// UID المالك الرسمي — الوحيد المسموح له بتعديل الرتبة
const VERIFIED_OWNER_UID = "wnvQPme3u0NU4VVqvr4DGqvv4KE3";
// دالة مساعدة — تتحقق من كلا الـ UID (uppercase + lowercase)
const _isVerifiedOwner = (uid) =>
  uid && (uid === OWNER_UID || uid === VERIFIED_OWNER_UID);

const ROLES     = Object.freeze({ OWNER: "owner", ADMIN: "admin", USER: "user" });

// Anti-spam: last send time per user
let _lastSendTime = 0;
Object.defineProperty(window, '_lastSendTime', { get: () => _lastSendTime, set: (v) => { _lastSendTime = v; }, configurable: true }); // ← bridge: محتاجها js/chat-send.js
const SPAM_INTERVAL_MS = 1500; // min 1.5s between messages
window.SPAM_INTERVAL_MS = SPAM_INTERVAL_MS; // ← تصدير: محتاجها js/chat-send.js

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
// ── نفرض طريقة حفظ ثابتة لجلسة الدخول بدل الوضع التلقائي —
//    الوضع التلقائي أحيانًا بيختار تخزين IndexedDB اللي ممكن ميفتحش
//    صح لما تطبيق TWA يتقفل ويتفتح تاني وهو أوفلاين، فيفقد الجلسة
//    ويرجّع صفحة تسجيل الدخول رغم إن المستخدم لسه مسجل دخول فعليًا.
setPersistence(auth, browserLocalPersistence).catch((e) => {
  console.warn("Auth persistence setup failed:", e);
});
// تفعيل التخزين المحلي (Offline Persistence) — يسمح بعرض المحادثات والبيانات
// اللي سبق تحميلها حتى بدون إنترنت، وأي تعديل/رسالة تتبعت وقت انقطاع النت
// بتتخزن محليًا وتتزامن تلقائيًا لما الاتصال يرجع (زي سلوك تطبيقات
// المحادثة الحقيقية) بدل ما تفشل فورًا.
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager({ forceOwnership: true })
    })
  });
} catch (e) {
  // fallback لو المتصفح مش داعم (مثلاً وضع تصفح خاص) أو تعذّر تفعيل الكاش
  db = getFirestore(app);
}
const storage = getStorage(app);
window.db = db;

/* FCM — منقول بالكامل لملف مستقل js/notif-permission.js */

async function _sendNotification(recipientUid, title, body, data) {
  if (!recipientUid || recipientUid === currentUser?.uid) return;
  try {
    // Check recipient's notif prefs before creating the doc
    const type = (() => {
      if (!data) return "default";
      if (data.chatType === "private") return "dm";
      if (data.chatType === "reply")   return "reply";
      if (data.chatType === "mention") return "mention";
      if (data.type === "news")        return "news";
      if (data.type === "lectures")    return "lectures";
      if (data.type === "exams")       return "exams";
      if (data.type === "sections")    return "sections";
      if (data.type === "admin")       return "admin";
      return "default";
    })();
    if (type !== "default") {
      try {
        const prefSnap = await getDoc(doc(db, "users", recipientUid, "settings", "notifPrefs"));
        if (prefSnap.exists() && prefSnap.data()[type] === false) return;
      } catch(e2) {}
    }
    const docRef = await addDoc(collection(db, "fcmNotifications"), {
      recipientUid, title, body,
      data: Object.assign({}, data || {}, { senderUid: currentUser?.uid || "" }),
      createdAt: serverTimestamp(), read: false,
    });
    try {
      const idToken = await currentUser.getIdToken();
      await fetch("https://YOUR-WORKER.example.workers.dev/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
        body: JSON.stringify({ docId: docRef.id }),
      });
    } catch (e) { console.warn("DM push trigger failed:", e); }
  } catch(e) {}
}

/* Content notification distributor: local candidate, separate from legacy chat/call Push. */
async function _notifyAllUsers(title, body, data, context) {
  const result = { created: 0, exists: 0, skipped: 0, failed: 0, aborted: 0, unsupported: 0, directoryFailed: false };
  const senderUid = context?.senderUid;
  const worldId = context?.worldId;
  const sourceId = context?.contentId;
  const type = context?.colName;
  const safePart = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
  const sameActor = () => currentUser?.uid === senderUid && isAdmin() &&
    (isOwner() || window.currentUserWorldId?.() === worldId);
  if (!safePart(senderUid) || !safePart(sourceId) || !window.isValidWorldId?.(worldId) ||
      !["news", "lectures", "exams", "sections"].includes(type) || data?.type !== type || !sameActor()) {
    result.aborted = 1;
    return result;
  }
  let directory;
  try {
    directory = await getDocsFromServer(query(collection(db, "users"), where("worldId", "==", worldId)));
    if (directory.metadata?.fromCache) throw new Error("Content notification directory is not server-confirmed");
  } catch (_) {
    result.directoryFailed = true;
    return result;
  }
  const recipients = new Set();
  directory.docs.forEach(d => { if (d.data().worldId === worldId) recipients.add(d.id); });
  recipients.add(OWNER_UID);
  recipients.delete(senderUid);
  const ids = [...recipients];
  let next = 0;
  const messageTitle = String(title || "").slice(0, 200);
  const messageBody = String(body || "").slice(0, 300);
  async function worker() {
    while (next < ids.length) {
      if (!sameActor()) {
        result.aborted += ids.length - next;
        next = ids.length;
        return;
      }
      const recipientUid = ids[next++];
      if (!safePart(recipientUid)) { result.unsupported++; continue; }
      const notificationId = "content-v1~" + type + "~" + sourceId + "~" + recipientUid;
      const notificationRef = doc(db, "fcmNotifications", notificationId);
      try {
        const outcome = await runTransaction(db, async tx => {
          if (!sameActor()) throw new Error("Content notification account changed");
          const existing = await tx.get(notificationRef);
          if (existing.exists()) return "exists";
          const pref = await tx.get(doc(db, "users", recipientUid, "settings", "notifPrefs"));
          if (pref.exists()) {
            const value = pref.data()[type];
            if (value === false) return "skipped";
            if (value !== undefined && value !== true) throw new Error("Invalid content notification preference");
          }
          if (!sameActor()) throw new Error("Content notification account changed");
          tx.set(notificationRef, {
            recipientUid,
            title: messageTitle,
            body: messageBody,
            data: { type, sourceId, worldId, senderUid, tag: type + "-" + sourceId },
            createdAt: serverTimestamp(),
            read: false,
          });
          return "created";
        });
        result[outcome]++;
      } catch (_) {
        if (!sameActor()) result.aborted++;
        else result.failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, () => worker()));
  return result;
}

/* ── DM notification ── */
async function _notifyPrivateMsg(peerUid, senderName, text) {
  if (window._dmExtrasIsMuted && window._dmExtrasIsMuted(peerUid)) return;
  const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
  await _sendNotification(peerUid,
    `💬 رسالة خاصة من ${senderName}`,
    preview,
    { chatType: "private", senderUid: currentUser?.uid || "", tag: "dm_" + (currentUser?.uid || "") }
  );
}
window._notifyPrivateMsg = _notifyPrivateMsg; // ← تصدير: محتاجها js/chat-core.js (module منفصل)
window._sendNotification = _sendNotification; // ← تصدير فقط (للمكالمات: js/calls.js) — بدون تغيير المسار

/* ── Mention notification (@name) ── */
async function _notifyMentions(text, senderName) {
  const mentionRe = /@([\u0600-\u06FFa-zA-Z0-9_\u200c]+)/g;
  let m;
  const notified = new Set();
  while ((m = mentionRe.exec(text)) !== null) {
    const handle = m[1].toLowerCase();
    try {
      const all = await _getWorldUsers();
      for (const u of all) {
        const uid = u.uid || u.id;
        if (!uid || uid === currentUser?.uid) continue;
        if (notified.has(uid)) continue;
        const uName = (u.name || u.displayName || "").toLowerCase();
        if (uName.includes(handle) || handle.includes(uName.split(" ")[0])) {
          notified.add(uid);
          const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
          await _sendNotification(uid,
            `📣 ${senderName} ذكرك في الشات`,
            preview,
            { chatType: "mention", senderUid: currentUser?.uid || "", tag: "mention_" + uid }
          );
        }
      }
    } catch(e) {}
  }
}
window._notifyMentions = _notifyMentions; // ← تصدير: محتاجها js/chat-send.js

/* ── Reply notification ── */
async function _notifyReply(replyData, senderName, text) {
  if (!replyData) return;
  /* Try to find the owner of the replied message */
  try {
    const colPath = chatColPath(_currentChatId);
    let targetUid = null;
    if (replyData.docId) {
      const snap = await getDoc(doc(db, colPath, replyData.docId));
      if (snap.exists()) targetUid = snap.data().uid || null;
    }
    if (!targetUid || targetUid === currentUser?.uid) return;
    const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
    await _sendNotification(targetUid,
      `↩️ ${senderName} رد على رسالتك`,
      preview,
      { chatType: "reply", senderUid: currentUser?.uid || "", tag: "reply_" + targetUid }
    );
  } catch(e) {}
}
window._notifyReply = _notifyReply; // ← تصدير: محتاجها js/chat-send.js

let _fcmNotifsUnsub = null;
const _fcmShownIds = new Set();

/* IN-APP NOTIFICATION ENGINE */
const _IAN_MAX      = 4;
const _IAN_DURATION = 6000;
let   _ianUnreadCnt = 0;
const _IAN_TYPES = {
  dm:       { icon: "💬", accent: "#3b82f6", iconBg: "rgba(59,130,246,.18)",  iconBorder: "rgba(59,130,246,.3)" },
  reply:    { icon: "↩️", accent: "#14b8a6", iconBg: "rgba(20,184,166,.18)",  iconBorder: "rgba(20,184,166,.3)" },
  mention:  { icon: "📣", accent: "#f97316", iconBg: "rgba(249,115,22,.18)",  iconBorder: "rgba(249,115,22,.3)" },
  admin:    { icon: "🔔", accent: "#ef4444", iconBg: "rgba(239,68,68,.18)",   iconBorder: "rgba(239,68,68,.3)" },
  news:     { icon: "📰", accent: "#c9a96e", iconBg: "rgba(201,169,110,.18)", iconBorder: "rgba(201,169,110,.3)" },
  lectures: { icon: "📚", accent: "#22c55e", iconBg: "rgba(34,197,94,.18)",   iconBorder: "rgba(34,197,94,.3)" },
  exams:    { icon: "📅", accent: "#f59e0b", iconBg: "rgba(245,158,11,.18)",  iconBorder: "rgba(245,158,11,.3)" },
  sections: { icon: "🏫", accent: "#8b5cf6", iconBg: "rgba(139,92,246,.18)",  iconBorder: "rgba(139,92,246,.3)" },
  default:  { icon: "🔔", accent: "#c9a96e", iconBg: "rgba(201,169,110,.18)", iconBorder: "rgba(201,169,110,.3)" },
};
function _ianTypeFromData(data) {
  if (!data) return "default";
  if (data.chatType === "private") return "dm";
  if (data.chatType === "reply")   return "reply";
  if (data.chatType === "mention") return "mention";
  if (data.type === "news")        return "news";
  if (data.type === "lectures")    return "lectures";
  if (data.type === "exams")       return "exams";
  if (data.type === "sections")    return "sections";
  if (data.type === "admin")       return "admin";
  return "default";
}
window._ianTypeFromData = _ianTypeFromData;
function _ianNow() {
  const n = new Date();
  return n.getHours().toString().padStart(2,"0")+":"+n.getMinutes().toString().padStart(2,"0");
}
function showInAppNotif(title, body, data, onClick) {
  const container = document.getElementById("inAppNotifContainer");
  if (!container) return;
  const existing = container.querySelectorAll(".ian");
  if (existing.length >= _IAN_MAX) _ianDismiss(existing[0]);
  const kind = _ianTypeFromData(data);
  const cfg  = _IAN_TYPES[kind] || _IAN_TYPES.default;
  const el   = document.createElement("div");
  el.className = "ian";
  el.style.setProperty("--ian-accent",      cfg.accent);
  el.style.setProperty("--ian-icon-bg",     cfg.iconBg);
  el.style.setProperty("--ian-icon-border", cfg.iconBorder);
  el.style.setProperty("--ian-dur", (_IAN_DURATION/1000)+"s");
  const _t = String(title||"إشعار").replace(/</g,"&lt;");
  const _b = String(body||"").replace(/</g,"&lt;");
  el.innerHTML =
    '<div class="ian-icon">'+cfg.icon+'</div>'+
    '<div class="ian-body">'+
      '<div class="ian-title">'+_t+'</div>'+
      '<div class="ian-msg">'+_b+'</div>'+
    '</div>'+
    '<span class="ian-time">'+_ianNow()+'</span>'+
    '<button class="ian-close" title="إغلاق"><i class="fa-solid fa-xmark"></i></button>'+
    '<div class="ian-progress"></div>';
  el.addEventListener("click", e => {
    if (e.target.closest(".ian-close")) { _ianDismiss(el); return; }
    _ianDismiss(el);
    if (typeof onClick === "function") onClick(data);
  });
  el.querySelector(".ian-close").addEventListener("click", e => { e.stopPropagation(); _ianDismiss(el); });
  container.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("ian-in")));
  el._ianTimer = setTimeout(() => _ianDismiss(el), _IAN_DURATION);
  _ianUnreadCnt++;
  _ianUpdateBadge();
}
function _ianDismiss(el) {
  if (!el || el._ianDismissed) return;
  el._ianDismissed = true;
  clearTimeout(el._ianTimer);
  el.classList.remove("ian-in");
  el.classList.add("ian-out");
  setTimeout(() => el.remove(), 220);
}
function _ianUpdateBadge() {
  // Badge now handled by notification panel system (_updateProfileBadge)
}
window.showInAppNotif = showInAppNotif;
window.toggleNotifPanel = function() {
  _ianUnreadCnt = 0; _ianUpdateBadge();
  const c = document.getElementById("inAppNotifContainer");
  if (c) c.querySelectorAll(".ian").forEach(_ianDismiss);
};

function _startNotifListener(uid) {
  if (_fcmNotifsUnsub) { try { _fcmNotifsUnsub(); } catch(e){} _fcmNotifsUnsub = null; }
  if (!uid) return;
  const q = query(collection(db, "fcmNotifications"),
    where("recipientUid", "==", uid),
    where("read", "==", false),
    limit(20));
  _fcmNotifsUnsub = onSnapshot(q, async (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type !== "added") continue;
      const docId = change.doc.id;
      if (_fcmShownIds.has(docId)) continue;
      _fcmShownIds.add(docId);
      const d = change.doc.data(), data = d.data || {};
      if (data.senderUid && data.senderUid === uid) { updateDoc(change.doc.ref, { read: true }).catch(() => {}); continue; }
      if (data.chatType === "private" && _currentChatId === data.senderUid) { updateDoc(change.doc.ref, { read: true }).catch(() => {}); continue; }
      showInAppNotif(d.title, d.body, data, (dat) => {
        if (dat && dat.chatType === "private" && dat.senderUid) try { openDMChat(dat.senderUid); } catch(e2) {}
        else if (dat && dat.type === "news")     try { openForumSection("tab-news","tab-news-content"); } catch(e2) {}
        else if (dat && dat.type === "lectures") try { openForumSection("tab-lectures","tab-lectures-content"); } catch(e2) {}
        else if (dat && dat.type === "exams")    try { openForumSection("tab-exams","tab-exams-content"); } catch(e2) {}
        else if (dat && dat.type === "sections") try { openForumSection("tab-sections","tab-sections-content"); } catch(e2) {}
      });
      if (fcmSupported() && window.Notification && window.Notification.permission === "granted") {
        try {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification(d.title || "نظام الجامعة", { body: d.body || "", icon: "/favicon.ico",
            badge: "/favicon.ico", dir: "rtl", lang: "ar",
            tag: (data && data.tag) ? data.tag : "uni", data: data, requireInteraction: false });
        } catch(e) { showForegroundNotif(d.title, d.body, data); }
      }
      updateDoc(change.doc.ref, { read: true }).catch(() => {});
    }
  }, () => {});
}
window._startNotifListener = _startNotifListener;
/* FCM END */

async function uploadToCloudinary(file) {
  if (file.type.startsWith("video/")) throw new Error("رفع الفيديوهات غير مسموح");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", "university_upload");
  const response = await fetch(
    "https://api.cloudinary.com/v1_1/dnbvvfita/auto/upload",
    { method: "POST", body: formData }
  );
  const data = await response.json();
  if (!data.secure_url) throw new Error("Cloudinary upload failed");
  const isPDF = file.type === "application/pdf" || file.name.endsWith(".pdf");
  return isPDF ? data.secure_url.replace("/image/upload/", "/raw/upload/") : data.secure_url;
}

/* ══════════════════════════════════════════
   UPLOAD ENGINE + UPLOAD CARD — منقول بالكامل لـ js/upload-engine.js
   alias محلي عشان الاستدعاءات القديمة (4 دوال) تفضل شغالة بدون أي تعديل
══════════════════════════════════════════ */
const uploadToCloudinaryWithProgress = (...args) => window.uploadToCloudinaryWithProgress(...args);
const _buildUploadCard = (...args) => window._buildUploadCard(...args);
const _getFileCategory = (...args) => window._getFileCategory(...args);
const _formatSize = (...args) => window._formatSize(...args);

/* ══════════════════════════════════════════
/* ══════════════════════════════════════════
   AUDIT LOG SYSTEM — منقول بالكامل لـ js/audit-log.js
   alias محلي بسيط عشان كل الاستدعاءات القديمة (AUDIT_ACTIONS.X / writeAuditLog(...))
   المنتشرة في الملف تفضل شغالة بدون أي تعديل عليها
══════════════════════════════════════════ */
const AUDIT_ACTIONS = new Proxy({}, { get: (_, prop) => window.AUDIT_ACTIONS?.[prop] });
const writeAuditLog = (...args) => window.writeAuditLog(...args);

let currentUser   = null;
let currentRole   = null;
let currentName   = "";
Object.defineProperty(window, 'currentName', { get: () => currentName, configurable: true });
let currentPhoto  = "";
Object.defineProperty(window, 'currentPhoto', { get: () => currentPhoto, configurable: true });
let msgUnsub      = null;
Object.defineProperty(window, 'msgUnsub', { get: () => msgUnsub, set: (v) => { msgUnsub = v; }, configurable: true }); // ← bridge: محتاجها js/chat-listener.js (قراءة+كتابة)
// _reactionsUnsub → منقول لـ js/chat-listener.js (كان مستخدم بس جوه startChatListener)
let _isChatBanned = false;
Object.defineProperty(window, '_isChatBanned', { get: () => _isChatBanned, set: (v) => { _isChatBanned = v; }, configurable: true });


/* ══════════════════════════════════════════
   ROLE HELPERS
══════════════════════════════════════════ */
const isOwner = () => currentRole === ROLES.OWNER;
const isAdmin = () => currentRole === ROLES.ADMIN || currentRole === ROLES.OWNER;
window.isAdmin = isAdmin;
window.isOwner = isOwner;
window.getCurrentRole = () => currentRole;
window.getCurrentName = () => currentName;

// Phase 1 / 5.1 — Owner activeWorld: تبديل حالة جلسة فقط، بدون أي Firestore write
window.setActiveWorld = function(worldId) {
  if (!isOwner()) return;
  if (typeof window.isValidWorldId !== "function" || !window.isValidWorldId(worldId)) return;
  window._activeWorld = worldId;
  sessionStorage.setItem("activeWorld", worldId);
  window._forumLiveSync?.();   // تبديل العالم: أعد ربط قوائم المنتدى الظاهرة بالعالم الجديد (أو افصلها)
  // معاينة الشات العام وقائمة الغرف مرتبطتان بالعالم النشط وقت البدء — أعد ربطهما بالعالم الجديد
  window._dmsStopListeners?.();
  window._dmsStartListeners?.();
};

function canModifyUser(actorRole, targetRole) {
  if (targetRole === ROLES.OWNER) return false;
  if (actorRole  === ROLES.OWNER) return true;
  if (actorRole  === ROLES.ADMIN && targetRole !== ROLES.OWNER) return true;
  return false;
}
function canSetRole(actorRole, targetRole, newRole) {
  if (targetRole === ROLES.OWNER) return false;
  if (newRole    === ROLES.OWNER) return false;
  if (actorRole  === ROLES.OWNER) return true;
  return false;
}

/* ══════════════════════════════════════════
   EMAIL PRIVACY — Owner-only visibility
══════════════════════════════════════════ */
// Returns true ONLY for the owner
const canSeeEmails = () => currentRole === ROLES.OWNER;

// Masks email → "ah***@gm***.com"  (safe for non-owners)
function maskEmail(email) {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return "—";
  const [domName, ...domExt] = domain.split(".");
  const maskedLocal  = local.slice(0, 2)   + "***";
  const maskedDomain = domName.slice(0, 2) + "***";
  return `${maskedLocal}@${maskedDomain}.${domExt.join(".")}`;
}

// Returns the display value based on current role
function displayEmail(email) {
  return canSeeEmails() ? (email || "—") : maskEmail(email);
}

/* ══════════════════════════════════════════
   TOAST
══════════════════════════════════════════ */
window.toast = function(msg, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3000);
};

/* ══════════════════════════════════════════
   CONFIRMATION MODAL
══════════════════════════════════════════ */
function confirm(title, body) {
  return new Promise(resolve => {
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalBody").textContent  = body;
    document.getElementById("modalBackdrop").classList.add("show");

    // Clone buttons to remove ALL previous listeners in one shot
    const oldOk  = document.getElementById("modalConfirm");
    const oldCan = document.getElementById("modalCancel");
    const newOk  = oldOk.cloneNode(true);
    const newCan = oldCan.cloneNode(true);
    oldOk.replaceWith(newOk);
    oldCan.replaceWith(newCan);

    function cleanup(result) {
      document.getElementById("modalBackdrop").classList.remove("show");
      resolve(result);
    }
    newOk.addEventListener("click",  () => cleanup(true),  { once: true });
    newCan.addEventListener("click", () => cleanup(false), { once: true });
  });
}
document.getElementById("modalCancel").addEventListener("click", () => {
  document.getElementById("modalBackdrop").classList.remove("show");
});
// تعريض باسم آمن (مش window.confirm) عشان محدش يتصادم مع confirm() الأصلية بتاعة المتصفح
window._appConfirm = confirm;

/* ══════════════════════════════════════════
   PAGE / TAB NAVIGATION
══════════════════════════════════════════ */

window.showPage = (id) => {
  const _prevPageEl = document.querySelector(".page.active");
  const _prevPageId = _prevPageEl ? _prevPageEl.id : null;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.dispatchEvent(new Event("uniAppReady")); // يقفل شاشة التحميل الحديثة بمجرد ظهور أول صفحة فعلية
  const _bn = document.querySelector(".bottom-nav");
  if (_bn) {
    _bn.style.display = (id === "page-home" || id === "page-dms") ? "" : "none";
    _bn.classList.toggle("dms-mode", id === "page-dms");
  }
  if (id === "page-owner") {
    loadOwnerStats();
    renderOwnerRoomsList();
    // Phase 1 / 5.1 — Owner activeWorld: عرض الاختيار الحالي عند فتح اللوحة
    const _aws = document.getElementById("activeWorldSelect");
    if (_aws && window._activeWorld) _aws.value = window._activeWorld;
  }
  if (id === "page-admin") { loadAdminUsers(); }
  if (_prevPageId && _prevPageId !== id) {
    window._navPush?.(`page:${id}`, () => window.showPage(_prevPageId));
  }
  if (id !== "page-chat") {
    window._stopChatListener?.();
    window._cleanupPollListeners?.();
  } else queueMicrotask(() => window._resumeVisibleChat?.());
  window._forumLiveSync?.();   // قوائم المنتدى: اربط/افصل المستمع حسب ظهور القسم
};

function goTab(tabId) {
  const _prevTabEl = document.querySelector(".tab-content.active");
  const _prevTabId = _prevTabEl ? _prevTabEl.id : null;
  document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  document.getElementById(tabId)?.classList.add("active");
  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === tabId));
  document.querySelectorAll(".nav-item[data-nav]").forEach(n =>
    n.classList.toggle("active", n.dataset.nav === tabId));
  // When entering forum tab, show landing grid
  if (tabId === "tab-forum") {
    document.getElementById("forum-landing").style.display = "";
    ["tab-news-content","tab-lectures-content","tab-exams-content","tab-sections-content","tab-attendance-content"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
  }
  if (_prevTabId && _prevTabId !== tabId) {
    window._navPush?.(`tab:${tabId}`, () => goTab(_prevTabId));
  }
  window._forumLiveSync?.();   // قوائم المنتدى: اربط/افصل المستمع حسب ظهور القسم
}
window.goTab = goTab;

// Forum section open/close
window.openForumSection = function(sectionKey, contentId) {
  const _el = document.getElementById(contentId);
  const _alreadyOpen = _el && _el.style.display !== "none";
  document.getElementById("forum-landing").style.display = "none";
  ["tab-news-content","tab-lectures-content","tab-exams-content","tab-sections-content","tab-attendance-content"]
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
  const el = document.getElementById(contentId);
  if (el) el.style.display = "";
  // trigger data load via existing load functions
  const loaders = {
    "tab-news-content":     () => loadNews(),
    "tab-lectures-content": () => window.loadLectures(),
    "tab-exams-content":    () => loadExams(),
    "tab-sections-content": () => loadSections(),
    "tab-attendance-content": () => window.loadAttendanceHistory?.(),
  };
  try { loaders[contentId]?.(); } catch(e) {}
  if (!_alreadyOpen) {
    window._navPush?.(`forum:${contentId}`, () => window.closeForumSection(contentId));
  }
  window._forumLiveSync?.();   // ضمان: المستمع شغّال للقسم الظاهر (idempotent)
};
window.closeForumSection = function(contentId) {
  if (window._navGoBackIfMatches?.(`forum:${contentId}`)) return;
  const el = document.getElementById(contentId);
  if (el) el.style.display = "none";
  document.getElementById("forum-landing").style.display = "";
  window._forumLiveSync?.();   // القسم اتقفل → افصل المستمع
};

// Official portal URL — change this value to update the link
const PORTAL_URL = "https://chi-eg.net/student_portal/?fbclid=Iwb21leAPq43hjbGNrA-rjRGV4dG4DYWVtAjExAHNydGMGYXBwX2lkDDM1MDY4NTUzMTcyOAABHkpCDRA8xSs7nItW3grqTxplTvYLsx1bYQSIosAjaza3rlBAtxE3395goFLL_aem_NpaEu8Nx7ixJG1fj_aGTdw";
window.openPortal = function() { window.open(PORTAL_URL, "_blank", "noopener,noreferrer"); };

document.querySelectorAll(".tab").forEach(t =>
  t.addEventListener("click", () => goTab(t.dataset.tab)));
document.querySelectorAll(".nav-item[data-nav]").forEach(n =>
  n.addEventListener("click", () => {
    if (!document.getElementById("page-home")?.classList.contains("active")) showPage("page-home");
    goTab(n.dataset.nav);
  }));

document.getElementById("topbarLeft").addEventListener("click", () => goTab("tab-profile"));
document.getElementById("ownerBackBtn").addEventListener("click", () => {
  if (!window._navGoBackIfMatches?.("page:page-owner")) showPage("page-home");
});
document.getElementById("adminBackBtn").addEventListener("click", () => {
  if (!window._navGoBackIfMatches?.("page:page-admin")) showPage("page-home");
});

/* ══════════════════════════════════════════
   CHAT PAGE OPEN / CLOSE
══════════════════════════════════════════ */
window.openChatPage = function() {
  showPage("page-chat");
  selectChat("public", "الشات العام", "");
};
window.closeChatPage = function() {
  if (window._navGoBackIfMatches?.("page:page-chat")) return;
  showPage("page-home");
};
window.closeArchivePage = function() {
  if (window._navGoBackIfMatches?.("page:page-dms-archive")) return;
  showPage("page-dms");
};
window.closeAiChatPage = function() {
  if (window._navGoBackIfMatches?.("page:page-ai-chat")) return;
  showPage("page-dms");
};


window.openDmsPanel = function() {
  showPage("page-dms");
  window._dmsPageInit?.();
};

/* ══════════════════════════════════════════
   AUTH — PROFILE CORE (التسجيل/الدخول نفسه في js/auth-ui.js + js/auth-bridge.js)
══════════════════════════════════════════ */

// ── إنشاء وثيقة المستخدم (مشتركة بين التسجيل والإكمال التلقائي) ──
// الوثيقة تُكتب أولاً بدون publicId، وبعدها نولّده ونحدّثه؛
// لو فشل يتولّاه كود الترحيل في onAuthStateChanged عند أول دخول.
async function _createUserProfile(user, { name, gender, worldId }) {
  const uid  = user.uid;
  const role = uid === OWNER_UID ? ROLES.OWNER : ROLES.USER;
  await setDoc(doc(db, "users", uid), {
    uid, name, email: user.email, role,
    publicId:  "",
    photo:     "",
    bio:       "",
    gender,
    ...(uid !== OWNER_UID ? { worldId } : {}),
    banReason: "",
    agreedToTerms:   true,
    agreedToTermsAt: serverTimestamp(),
    createdAt: serverTimestamp()
  });
  try {
    const publicId = await _generatePublicId();
    await updateDoc(doc(db, "users", uid), { publicId });
  } catch (e) { console.warn("publicId will be generated on next login:", e); }
}

// ── نسخة محلية من بيانات التسجيل (بدون كلمة المرور) ──
const _PENDING_KEY = "bis_pending_profile";
function _savePendingProfile(email, p) {
  try { localStorage.setItem(_PENDING_KEY, JSON.stringify({ email: email.toLowerCase(), ...p, ts: Date.now() })); } catch (e) {}
}
function _readPendingProfile(email) {
  try {
    const p = JSON.parse(localStorage.getItem(_PENDING_KEY) || "null");
    if (!p || !email || p.email !== email.toLowerCase()) return null;
    if (Date.now() - p.ts > 7 * 864e5) return null;
    return { name: p.name, gender: p.gender, worldId: p.worldId };
  } catch (e) { return null; }
}
function _clearPendingProfile() { try { localStorage.removeItem(_PENDING_KEY); } catch (e) {} }

// ── منطق الحساب المشترك مع واجهة الدخول الجديدة (js/auth-bridge.js) ──
// واجهة الدخول/التسجيل/إكمال البيانات صارت في js/auth-ui.js؛ هنا يبقى فقط
// منطق إنشاء وثيقة المستخدم الذي يستخدمه الربط.
window._bisAuthCore = {
  auth,
  createUserProfile: _createUserProfile,
  savePendingProfile: _savePendingProfile,
  readPendingProfile: _readPendingProfile,
  clearPendingProfile: _clearPendingProfile
};

/* ══════════════════════════════════════════
   AUTH — LOGOUT
══════════════════════════════════════════ */
async function doLogout() {
  // حفظ أي تغيير معلّق في تفضيلات الإشعارات قبل ما الحساب يخرج (بحد أقصى مهلة داخلية؛ أي فشل ما بيوقفش الخروج)
  try { await window._notifPrefsFlush?.(); } catch(e) {}

  if (msgUnsub)         { msgUnsub();         msgUnsub         = null; }
  if (_selfListenerUnsub){ _selfListenerUnsub(); _selfListenerUnsub = null; }
  // تنظيف مستمعي الاستطلاعات
  window._cleanupPollListeners?.();
  // فصل مستمعات قوائم المنتدى (الأخبار/المحاضرات/الامتحانات/السكاشن)
  window._forumLiveStopAll?.();
  // مسح كاش الغرف الخاصة المتحقق منها
  if (typeof _ensuredRooms !== "undefined") _ensuredRooms.clear();
  _acceptedPeers  = {};
  _userCache      = {};
  _allUsersCache  = null; _worldUsersCache = null;
  window._dmsStopListeners?.(); // إيقاف مستمعات قائمة الدردشات (dms-page.js) ومسح حالتها
  currentUser = null; currentRole = null; currentName = ""; currentPhoto = "";
  window.currentUser = null; // تنظيف للوحدات الخارجية
  // FCM cleanup
  if (_fcmNotifsUnsub) { try { _fcmNotifsUnsub(); } catch(e){} _fcmNotifsUnsub = null; }
  window.qnStopListening?.(); // إيقاف مستمع الإخطار السريع قبل إبطال الجلسة (quick-notifications.js)
  await signOut(auth);
  document.getElementById("settingsModal")?.classList.remove("open");
  document.body.style.overflow = "";
  window.AuthUI?.reset?.(); // الواجهة الجديدة: تفريغ الحقول والرجوع لعرض الدخول

  // مسح كل أثر للحساب من هذا الجهاز: التخزين المحلي (عدا تفضيل الثيم) + كاش Firestore، ثم صفحة نظيفة
  try { sessionStorage.clear(); } catch (e) {}
  try { Object.keys(localStorage).forEach(k => { if (!/theme/i.test(k)) localStorage.removeItem(k); }); } catch (e) {}
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch (e) {}
  window.location.replace(window.location.pathname);
}
document.getElementById("logoutBtn")?.addEventListener("click", doLogout);
document.getElementById("logoutBtnProfile").addEventListener("click", doLogout);

/* ══════════════════════════════════════════
   DEFAULT AVATAR SVGs
══════════════════════════════════════════ */
function _maleSVG(size) {
  // Premium Male Avatar — Deep blue theme with gold accent
  return `<svg width="${size}" height="${size}" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="border-radius:50%;display:block;">
    <defs>
      <radialGradient id="mgBg${size}" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#0f2044"/>
        <stop offset="100%" stop-color="#060d1a"/>
      </radialGradient>
      <radialGradient id="mgSkin${size}" cx="45%" cy="35%" r="60%">
        <stop offset="0%" stop-color="#e8c97a"/>
        <stop offset="100%" stop-color="#c9a557"/>
      </radialGradient>
      <linearGradient id="mgShirt${size}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1d4ed8"/>
        <stop offset="100%" stop-color="#1e3a8a"/>
      </linearGradient>
      <radialGradient id="mgGlow${size}" cx="50%" cy="45%" r="50%">
        <stop offset="0%" stop-color="rgba(59,130,246,0.18)"/>
        <stop offset="100%" stop-color="transparent"/>
      </radialGradient>
    </defs>
    <!-- Background -->
    <circle cx="40" cy="40" r="40" fill="url(#mgBg${size})"/>
    <circle cx="40" cy="40" r="40" fill="url(#mgGlow${size})"/>
    <!-- Body / Shirt -->
    <path d="M13 80 Q14 54 40 50 Q66 54 67 80Z" fill="url(#mgShirt${size})"/>
    <!-- Collar & tie detail -->
    <path d="M34 51 L40 56 L46 51 L42 51 L40 53 L38 51Z" fill="#93c5fd"/>
    <path d="M38.5 53 L40 70 L41.5 53 L40 56Z" fill="#bfdbfe" opacity="0.6"/>
    <!-- Neck -->
    <rect x="35" y="43" width="10" height="10" rx="4" fill="url(#mgSkin${size})"/>
    <!-- Head -->
    <ellipse cx="40" cy="30" rx="14" ry="15" fill="url(#mgSkin${size})"/>
    <!-- Hair — short masculine -->
    <path d="M26 29 Q26 14 40 13 Q54 14 54 29 Q52 20 40 19 Q28 20 26 29Z" fill="#2d1810"/>
    <!-- Ear left -->
    <ellipse cx="26.5" cy="30" rx="2" ry="3" fill="#c9a557"/>
    <!-- Ear right -->
    <ellipse cx="53.5" cy="30" rx="2" ry="3" fill="#c9a557"/>
    <!-- Eye Left -->
    <ellipse cx="34.5" cy="29" rx="2.2" ry="2" fill="#1a0e00"/>
    <circle cx="35" cy="28.5" r=".7" fill="white" opacity=".5"/>
    <!-- Eye Right -->
    <ellipse cx="45.5" cy="29" rx="2.2" ry="2" fill="#1a0e00"/>
    <circle cx="46" cy="28.5" r=".7" fill="white" opacity=".5"/>
    <!-- Eyebrows -->
    <path d="M32 26 Q34.5 24.8 37 26" stroke="#2d1810" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <path d="M43 26 Q45.5 24.8 48 26" stroke="#2d1810" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <!-- Nose -->
    <path d="M39 31 Q38.5 35 39.5 36 Q40.5 36 41.5 35 Q42.5 34 40 31" stroke="#b8883d" stroke-width=".8" fill="none" opacity=".6"/>
    <!-- Smile -->
    <path d="M35.5 38 Q40 41.5 44.5 38" stroke="#8b5e24" stroke-width="1.3" stroke-linecap="round" fill="none"/>
    <!-- Cheek blush -->
    <circle cx="30" cy="35" r="3.5" fill="rgba(255,200,100,0.15)"/>
    <circle cx="50" cy="35" r="3.5" fill="rgba(255,200,100,0.15)"/>
  </svg>`;
}

function _femaleSVG(size) {
  // Premium Female Avatar — Rose-navy theme with warm pink accent
  return `<svg width="${size}" height="${size}" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="border-radius:50%;display:block;">
    <defs>
      <radialGradient id="fgBg${size}" cx="40%" cy="35%" r="65%">
        <stop offset="0%" stop-color="#1a0a2e"/>
        <stop offset="100%" stop-color="#0d0618"/>
      </radialGradient>
      <radialGradient id="fgSkin${size}" cx="45%" cy="35%" r="60%">
        <stop offset="0%" stop-color="#f0c987"/>
        <stop offset="100%" stop-color="#d4a055"/>
      </radialGradient>
      <linearGradient id="fgShirt${size}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#be185d"/>
        <stop offset="100%" stop-color="#831843"/>
      </linearGradient>
      <radialGradient id="fgGlow${size}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(236,72,153,0.14)"/>
        <stop offset="100%" stop-color="transparent"/>
      </radialGradient>
      <radialGradient id="fgHair${size}" cx="50%" cy="20%" r="70%">
        <stop offset="0%" stop-color="#3d1a1a"/>
        <stop offset="100%" stop-color="#1a0a0a"/>
      </radialGradient>
    </defs>
    <!-- Background -->
    <circle cx="40" cy="40" r="40" fill="url(#fgBg${size})"/>
    <circle cx="40" cy="40" r="40" fill="url(#fgGlow${size})"/>
    <!-- Body -->
    <path d="M11 80 Q13 52 40 49 Q67 52 69 80Z" fill="url(#fgShirt${size})"/>
    <!-- Neckline detail -->
    <path d="M33 50 Q40 53 47 50 Q43 55 40 55 Q37 55 33 50Z" fill="#fb7185" opacity=".6"/>
    <!-- Neck -->
    <rect x="35.5" y="43" width="9" height="9" rx="4" fill="url(#fgSkin${size})"/>
    <!-- Long hair behind (back layer) -->
    <path d="M22 30 Q21 48 26 62 Q30 70 35 72 Q38 73 40 73 Q42 73 45 72 Q50 70 54 62 Q59 48 58 30 Q55 40 40 41 Q25 40 22 30Z" fill="url(#fgHair${size})"/>
    <!-- Head -->
    <ellipse cx="40" cy="28" rx="13.5" ry="14.5" fill="url(#fgSkin${size})"/>
    <!-- Hair top -->
    <path d="M27 27 Q27 13 40 12 Q53 13 53 27 Q51 18 40 17 Q29 18 27 27Z" fill="url(#fgHair${size})"/>
    <!-- Hair side sweeps -->
    <path d="M26.5 25 Q24 30 25 38 Q27 26 29 24Z" fill="url(#fgHair${size})"/>
    <path d="M53.5 25 Q56 30 55 38 Q53 26 51 24Z" fill="url(#fgHair${size})"/>
    <!-- Small curls / fringe -->
    <path d="M28 20 Q30 15 33 17" stroke="#3d1a1a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M47 17 Q50 15 52 20" stroke="#3d1a1a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <!-- Ears -->
    <ellipse cx="26.5" cy="28.5" rx="2.2" ry="2.8" fill="#d4a055"/>
    <ellipse cx="53.5" cy="28.5" rx="2.2" ry="2.8" fill="#d4a055"/>
    <!-- Ear rings -->
    <circle cx="26.5" cy="31" r="1.2" fill="#f9a8d4" opacity=".9"/>
    <circle cx="53.5" cy="31" r="1.2" fill="#f9a8d4" opacity=".9"/>
    <!-- Eye Left -->
    <ellipse cx="34" cy="27.5" rx="2.5" ry="2.2" fill="#1a0e00"/>
    <circle cx="34.6" cy="27" r=".8" fill="white" opacity=".5"/>
    <!-- Eye Right -->
    <ellipse cx="46" cy="27.5" rx="2.5" ry="2.2" fill="#1a0e00"/>
    <circle cx="46.6" cy="27" r=".8" fill="white" opacity=".5"/>
    <!-- Lashes upper left -->
    <path d="M31.5 25.5 Q34 24 36.5 25.5" stroke="#1a0e00" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <!-- Lashes upper right -->
    <path d="M43.5 25.5 Q46 24 48.5 25.5" stroke="#1a0e00" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <!-- Eyebrow Left (arched) -->
    <path d="M31 23.5 Q34 21.5 37 23.5" stroke="#3d1a1a" stroke-width="1.3" stroke-linecap="round" fill="none"/>
    <!-- Eyebrow Right (arched) -->
    <path d="M43 23.5 Q46 21.5 49 23.5" stroke="#3d1a1a" stroke-width="1.3" stroke-linecap="round" fill="none"/>
    <!-- Nose -->
    <path d="M39 31 Q38.5 34 39.5 35 Q40.5 35.2 41.5 34 Q42.5 33 40 31" stroke="#b8883d" stroke-width=".8" fill="none" opacity=".5"/>
    <!-- Smile with lipstick -->
    <path d="M35.5 37.5 Q40 41 44.5 37.5" stroke="#c2185b" stroke-width="1.8" stroke-linecap="round" fill="none"/>
    <path d="M35.5 37.5 Q40 38.5 44.5 37.5" stroke="#e91e8c" stroke-width=".6" fill="none" opacity=".4"/>
    <!-- Cheek blush -->
    <ellipse cx="29" cy="33" rx="4" ry="2.5" fill="rgba(236,72,153,0.2)"/>
    <ellipse cx="51" cy="33" rx="4" ry="2.5" fill="rgba(236,72,153,0.2)"/>
  </svg>`;
}

// Get default avatar HTML based on gender — صورة الطالب/الطالبة الحقيقية (نظام واحد موحّد للمشروع بالكامل)
function _defaultAvatarHTML(gender, size) {
  const src = gender === "female" ? "images/default-student-female.png" : "images/default-student-male.png";
  return `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
}
// تعريض الدالة فقط لأن js/dms-page.js و js/mention.js يعملان كموديولات منفصلة (نفس نمط window._chatListBadgesHTML الموجود)
window._defaultAvatarHTML = _defaultAvatarHTML;

/* ══════════════════════════════════════════
   AVATAR HELPERS
══════════════════════════════════════════ */
function setAvatarUI(src, isUrl, gender) {
  // isUrl=null means SVG content directly
  ["avatar","profileAvatar","navProfileAvatar"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isUrl === null) {
      el.innerHTML = src; // raw SVG
    } else {
      el.innerHTML = isUrl ? `<img src="${src}" alt="">` : src;
    }
    // Apply gender glow class to profile avatar
    if (id === "profileAvatar") {
      el.classList.remove("gender-male","gender-female","gender-none");
      if (gender === "male")   el.classList.add("gender-male");
      else if (gender === "female") el.classList.add("gender-female");
      else el.classList.add("gender-none");
    }
  });
}

function avatarHTML(photo, name, size=38, gender) {
  if (photo) return `<img src="${esc(photo)}" alt="" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;">`;
  return _defaultAvatarHTML(gender, size);
}

/* ══════════════════════════════════════════
   AUTH STATE — Central controller
══════════════════════════════════════════ */
/* يسمح لواجهة الدخول بتشغيل منطق فتح الموقع مباشرة بدون إعادة تحميل الصفحة */
let _authStateHandler = null;
window._runAuthState = () => (_authStateHandler ? _authStateHandler(auth.currentUser) : undefined);
onAuthStateChanged(auth, _authStateHandler = async (user) => {

  // ✅ أثناء الدخول/التسجيل/تأكيد البريد/إكمال البيانات من واجهة الدخول الجديدة
  // (Firebase يُطلق هذا الـ callback فور الدخول أو إنشاء الحساب، قبل ما تكتمل الخطوات)
  // — الواجهة تمسك الحدث وتكمل الموقع بعد ضغط "الدخول إلى الموقع" (js/auth-bridge.js)
  if (user && window._authHold?.(user)) { showPage("page-login"); return; }

  if (!user) {
    window._dmsStopListeners?.(); // لا تُبقِ أي مستمع/قائمة DM بعد الخروج (مهما كان سبب الخروج)
    window._chatSessionListenersStop?.(); // + الكتابة/التسجيل/الاستطلاعات (مهما كان سبب الخروج)
    _userCache = {}; _allUsersCache = null; _worldUsersCache = null;   // نفس doLogout: لا تُبقِ بيانات الحساب السابق في الذاكرة (تُجلب من جديد عند الدخول التالي)
    { const _cm = document.getElementById("chatMessages"); if (_cm) _cm.innerHTML = ""; }   // رسائل المحادثة المخفية للحساب السابق
    window.currentUser = null; // عقد doLogout للوحدات الخارجية: forum-badges.js تُسقط مستمعاتها (uid/world) ذاتيًا عند غياب الحساب
    window._maintenanceApply?.();
    window.__apkPromptHide?.();
    window.__updateNoticeStop?.();
    window.AuthUI?.sessionEnded?.(); // انتهت الجلسة أثناء انتظار تأكيد البريد
    showPage("page-login"); return;
  }

  // ✅ إظهار الواجهة فورًا بمجرد تأكد Firebase من وجود جلسة صالحة —
  // دون انتظار قراءة Firestore. تحميل بيانات المستخدم يستمر أدناه في الخلفية
  // ويُحدّث العناصر تدريجيًا عند وصوله، بدون إعادة فتح الصفحة.
  currentUser = user;
  window.currentUser = user;
  window._dmsGuardUser?.(user.uid); // لو تغيّر الحساب: أوقف مستمعات/بيانات قائمة الـDM للحساب السابق فوراً
  window._sheetatyGuardUser?.(user.uid); // لو تغيّر الحساب: صفّر كاش شيتاتي (subjects/sheets/completions) للحساب السابق فوراً
  window._mydocsGuardUser?.(user.uid); // لو تغيّر الحساب: صفّر كاش مستنداتي (docSubjects/docItems) للحساب السابق فوراً
  if (!window.db) window.db = db;
  window.qnStartListening?.(); // بدء/إعادة بدء مستمع الإخطار السريع بعد تأكيد الجلسة (quick-notifications.js)
  showPage("page-home");
  goTab("tab-home");
  try { window.__apkPromptAfterLogin?.(); } catch (_) {} // اقتراح تحميل التطبيق (متصفح فقط) — يعمل أيضًا مع الجلسة المحفوظة
  try { window.__updateNoticeStart?.(); } catch (_) {} // إشعار نشر تحديث عالمي — مستمع واحد على config/appUpdate

  let userData = null;
  let _readSucceeded = false;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      userData = snap.data(); _readSucceeded = true;
    }
    else { _readSucceeded = true; } // القراءة نجحت، والحساب فعلاً غير موجود
  } catch(e) {
    console.error("Firestore read error:", e);
    _readSucceeded = false; // فشل القراءة (غالبًا بسبب انقطاع النت)، مش دليل على عدم وجود الحساب
  }

  if (!userData) {
    if (!_readSucceeded || !navigator.onLine) {
      // مفيش نت أو تعذر التأكد من البيانات — نكمل بهدوء بحد أدنى من
      // البيانات لحد ما الاتصال يرجع ويزامن تلقائي، من غير أي رسالة مقاطعة
      userData = { name: user.displayName || "مستخدم", publicId: null };
    } else {
      // حساب يتيم: موجود في Auth بدون وثيقة Firestore — نكمّله بدل ما نطرده
      const pending = _readPendingProfile(user.email);
      if (pending) {
        try {
          await _createUserProfile(user, pending);
          _clearPendingProfile();
          const s2 = await getDoc(doc(db, "users", user.uid));
          if (s2.exists()) {
            userData = s2.data();
          }
        } catch (e) { console.error("auto-complete profile failed:", e); }
      }
      if (!userData) { showPage("page-login"); window.AuthBridge?.needsProfile?.(user); return; }
    }
  }

  if (userData.isBanned) {
    toast("تم حظر حسابك — تواصل مع الإدارة", "error");
    await signOut(auth);
    return;
  }

  // ── ترحيل المستخدمين القدامى: إنشاء publicId إن لم يكن موجوداً ──
  if (!userData.publicId) {
    try {
      const newPublicId = await _generatePublicId();
      await updateDoc(doc(db, "users", user.uid), { publicId: newPublicId });
      userData.publicId = newPublicId;
    } catch(e) { console.warn("publicId migration failed:", e); }
  }

  currentUser     = user;
  currentName     = userData.name  || "مستخدم";
  currentRole     = userData.role  || ROLES.USER;
  currentPhoto    = userData.photo || "";
  _isChatBanned   = userData.isChatBanned || false;

  // حفظ بيانات المستخدم الحالي للـ badges
  window._currentUserData = { ...userData, uid: user.uid };

  // ── تعريض المتغيرات للوحدات الخارجية (grades, ...) ──
  window.currentUser = currentUser;
  if (!window.db) window.db = db;
  window._maintenanceApply?.();

  if (user.uid === OWNER_UID && currentRole !== ROLES.OWNER) {
    await updateDoc(doc(db, "users", user.uid), { role: ROLES.OWNER });
    currentRole = ROLES.OWNER;
  }

  // Phase 1 / 5.1 — Owner activeWorld: حالة جلسة فقط (sessionStorage)، بدون أي كتابة لبيانات Owner
  if (currentRole === ROLES.OWNER) {
    const _savedWorld = sessionStorage.getItem("activeWorld");
    window._activeWorld = (typeof window.isValidWorldId === "function" && window.isValidWorldId(_savedWorld))
      ? _savedWorld : "is_2";
  }

  window.checkAttendancePopup?.().catch(() => {}); // بعد تحميل userData وتحديد العالم (activeWorldContext صالح)

  const email = userData.email || user.email || "";
  const bio   = userData.bio   || "";
  const photo = userData.photo || "";

  document.getElementById("welcomeText").innerHTML    = renderUserDisplay(currentName, userData, user.uid);
  document.getElementById("profileName").innerHTML    = renderUserDisplay(currentName, userData, user.uid);
  document.getElementById("profileBioText").textContent = bio;
  document.getElementById("profileEmail").textContent   = email;
  document.getElementById("editName").value = currentName;
  document.getElementById("editBio").value  = bio;

  // Hide password change for non-email providers (e.g. Google)
  const _pwCard = document.getElementById("changePasswordCard");
  const _pwSection = document.getElementById("sec-account");
  const _isEmailProvider2 = user.providerData?.some(p => p.providerId === "password");
  // Find the password block inside account section and show/hide it
  if (_pwSection) {
    // We show/hide the password sub-block by finding it via the header
    const _pwHdr = _pwSection.querySelector(".prof-panel-pw-hdr");
    if (_pwHdr) {
      const _pwWrap = _pwHdr.closest("div") || _pwHdr.parentElement;
      if (_pwWrap) _pwWrap.style.display = _isEmailProvider2 ? "" : "none";
    }
  }
  if (_pwCard) _pwCard.style.display = "none"; // always hide the old hidden placeholder

  // حساب Google: شعار Google وكلمة Google بدل أيقونة وكلمة «البريد الإلكتروني»
  const _isGoogleOnly = !_isEmailProvider2 && user.providerData?.some(p => p.providerId === "google.com");
  const _emIcon = document.getElementById("profSecEmailIcon"), _emLbl = document.getElementById("profSecEmailLbl");
  if (_emIcon && _emLbl) {
    if (_isGoogleOnly) {
      _emIcon.outerHTML = '<svg id="profSecEmailIcon" width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
      _emLbl.textContent = "Google";
    } else {
      _emLbl.textContent = "البريد الإلكتروني";
    }
  }

  // ✅ عرض المعرف العام (publicId) في البروفايل
  const pubIdEl = document.getElementById("profilePublicId");
  if (pubIdEl) pubIdEl.textContent = userData.publicId || "—";
  const pubIdEl2 = document.getElementById("profSecPublicId");
  if (pubIdEl2) pubIdEl2.textContent = userData.publicId || "—";

  // ✅ تعبئة بطاقة المعلومات الإضافية (البريد / النبذة / UID / تاريخ الانضمام)
  _fillProfInfoCard(userData, user, email, bio);

  const roleLabels = { owner:"<i class=\"fa-solid fa-crown\"></i> أونر (Super Admin)", admin:"<i class=\"fa-solid fa-gear\"></i> أدمن", user:"<i class=\"fa-solid fa-circle-user\"></i> مستخدم" };
  document.getElementById("profileRole").innerHTML = roleLabels[currentRole] || currentRole;

  // Show gender
  const gEl = document.getElementById("profileGenderRow");
  const gTxt = document.getElementById("profileGenderText");
  if (gEl && gTxt && userData.gender) {
    gEl.style.display = "flex";
    const gIcon = userData.gender === "female"
      ? `<i class="fa-solid fa-venus" style="color:#f9a8d4;"></i>`
      : `<i class="fa-solid fa-mars" style="color:#93c5fd;"></i>`;
    gTxt.innerHTML = userData.gender === "female"
      ? `${gIcon} طالبة` : `${gIcon} طالب`;
  }

  const badgeEl    = document.getElementById("roleBadgeTop");
  const badgeClass = { owner:"owner", admin:"admin", user:"user" }[currentRole] || "user";
  const badgeText  = { owner:"<i class=\"fa-solid fa-crown\"></i> Owner", admin:"<i class=\"fa-solid fa-gear\"></i> Admin", user:"<i class=\"fa-solid fa-circle-user\"></i> User" }[currentRole] || "User";
  badgeEl.innerHTML = `<span class="role-badge ${badgeClass}">${badgeText}</span>`;

  if (photo) setAvatarUI(photo, true, userData.gender);
  else       setAvatarUI(_defaultAvatarHTML(userData.gender, 96), null, userData.gender);

  document.getElementById("ownerBtn").style.display = isOwner() ? "inline-block" : "none";
  document.getElementById("adminBtn").style.display = isAdmin() && !isOwner() ? "inline-block" : "none";
  _syncBioCards({ ...userData, email: user.email });

  // ── Self-Listener: مراقبة التغييرات على حسابنا الخاص في realtime ──
  // يكشف: حظر الشات، رفع الحظر، تغيير الصورة، تغيير الاسم
  _startSelfListener(user.uid);

  // (تم نقل showPage("page-home") / goTab("tab-home") لأعلى الدالة لتظهر فورًا دون انتظار Firestore)

  // FCM init
  initFCM(user.uid, { app, db, getCurrentChatId: () => _currentChatId }).catch(() => {});
  _startNotifListener(user.uid);
  window._dmsStartListeners?.();

  // قوائم المنتدى (الأخبار/المحاضرات/الامتحانات/السكاشن) مبقاش بتتحمّل مسبقًا عند الدخول:
  // بتشتغل بـ onSnapshot للقسم الظاهر بس (انظر _forumLiveSync) وبتتفصل لما القسم يتخفّى.

});

/* ══════════════════════════════════════════
   _acceptedPeers — يُملأ من مستمع privateChats في js/dms-page.js
   (يستهلكه حوار التحويل + أيقونة المحادثة في قائمة الأعضاء)
══════════════════════════════════════════ */
let _acceptedPeers      = {};
Object.defineProperty(window, '_acceptedPeers', { get: () => _acceptedPeers, configurable: true });

/* ══════════════════════════════════════════
   OPEN DIRECT CHAT — Creates room if needed (no chatRequests)
══════════════════════════════════════════ */
// ══════════════════════════════════════════
// openDirectChat — فتح محادثة مباشرة مع أي مستخدم
// بدون Request System — الغرفة تُنشأ تلقائياً
// ══════════════════════════════════════════
let _dcReqToken = 0;
window.openDirectChat = async function(toUid, toUser) {
  if (!currentUser?.uid) { toast("يجب تسجيل الدخول أولاً", "error"); return; }
  if (!toUid)            { toast("مستخدم غير صالح", "error"); return; }
  if (toUid === currentUser.uid) { toast("لا يمكنك مراسلة نفسك", "warn"); return; }

  const myToken = ++_dcReqToken;

  // ✅ World Model: منع فتح/إنشاء محادثة خاصة مع مستخدم من عالم مختلف
  // (الـOwner مستثنى). المصدر الوحيد: users/{uid}.worldId من الخادم عبر
  // _getUser() — وليس أي قيمة ممرَّرة من الواجهة (toUser قد لا تحمل worldId
  // لو جاءت من كائن مبني جزئيًا في مكان آخر).
  if (!isOwner() && toUid !== window.OWNER_UID) {
    const _myWorld = window.currentUserWorldId?.();
    const _toUserSrc = await _getUser(toUid);
    if (myToken !== _dcReqToken) return;
    const _toWorld = window.isValidWorldId?.(_toUserSrc?.worldId) ? _toUserSrc.worldId : null;
    if (!_myWorld || !_toWorld || _myWorld !== _toWorld) {
      toast("لا يمكنك مراسلة مستخدم من عالم مختلف", "error");
      return;
    }
  }

  // تحميل بيانات المستخدم إن لزم
  if (!toUser?.name) toUser = await _getUser(toUid);
  if (myToken !== _dcReqToken) return;

  // 2. تحديث الـ cache المحلي
  if (!_userCache[toUid]) _userCache[toUid] = { data: toUser, ts: Date.now() };

  // 4. فتح المحادثة
  selectChat(toUid, toUser.name, toUser.photo);
};

/* ══════════════════════════════════════════
   MEMBERS LIST — منقول بالكامل لـ js/members-list.js
══════════════════════════════════════════ */
/* Request System — Removed */

/* ══════════════════════════════════════════
   USER CACHE — TTL + Batch
   _userCache:     uid → { data, ts }
   _allUsersCache: full users array (5-min TTL)
   _userFetchQ:    pending batch-fetch promises
══════════════════════════════════════════ */
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 دقائق
let _userCache     = {};
Object.defineProperty(window, '_userCache', { get: () => _userCache, configurable: true }); // ← bridge: محتاجها js/chat-core.js (appendChatMsg قراءة فقط)
let _allUsersCache = null;
let _allUsersCacheTs = 0;
const _userFetchQ  = {};  // uid → Promise (لمنع التحميل المتوازي)

async function _getUser(uid) {
  const actorUid = window.currentUser?.uid || null;
  const fallback = () => ({name:"مستخدم",photo:""});
  if (!actorUid || !uid) return fallback();
  const cached = _userCache[uid];
  if (cached && (Date.now() - cached.ts < CACHE_TTL_MS)) return cached.data;
  const key = JSON.stringify([actorUid,uid]);
  if (_userFetchQ[key]) return _userFetchQ[key];
  const pending = (async () => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (window.currentUser?.uid !== actorUid) return fallback();
      const data = snap.exists() ? snap.data() : fallback();
      _userCache[uid] = { data, ts: Date.now() };
      return data;
    } catch(e) { return fallback(); }
    finally { delete _userFetchQ[key]; }
  })();
  _userFetchQ[key] = pending;
  return pending;
}
window._getUserProfile = _getUser;

async function _getAllUsers() {
  if (_allUsersCache && (Date.now() - _allUsersCacheTs < CACHE_TTL_MS)) {
    return _allUsersCache;
  }
  const snap = await getDocs(collection(db, "users"));
  _allUsersCache = [];
  snap.forEach(d => {
    const u = { id: d.id, uid: d.id, ...d.data() };
    _userCache[d.id] = { data: u, ts: Date.now() };
    _allUsersCache.push(u);
  });
  _allUsersCacheTs = Date.now();
  return _allUsersCache;
}
window._getAllUsers = _getAllUsers;

// Share the complete world result without broadening a failed scoped query.
// Pagination/substring search is a separate migration, not a silent result cap.
let _worldUsersCache = null, _worldUsersCacheTs = 0, _worldUsersCacheW = null;
let _worldUsersCacheUid = null, _worldUsersPending = null;
async function _getWorldUsers() {
  const w = window.activeWorldContext?.() || null;
  const uid = window.currentUser?.uid || null;
  if (!uid) throw new Error("Directory requires a signed-in account");
  const current = () => window.currentUser?.uid === uid && (window.activeWorldContext?.() || null) === w;
  if (_worldUsersCache && _worldUsersCacheUid === uid && _worldUsersCacheW === w && Date.now() - _worldUsersCacheTs < CACHE_TTL_MS) return _worldUsersCache;
  if (_worldUsersPending?.uid === uid && _worldUsersPending.w === w) return _worldUsersPending.promise;
  const pending = { uid, w, promise: null };
  pending.promise = (async () => {
    const [ws, os] = await Promise.all([
      w ? getDocs(query(collection(db, "users"), where("worldId", "==", w))) : null,
      getDoc(doc(db, "users", OWNER_UID))
    ]);
    if (!current()) throw new Error("Directory context changed");
    const seen = new Set(), list = [];
    [...(ws ? ws.docs : []), ...(os.exists() ? [os] : [])].forEach(d => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      const u = { id: d.id, uid: d.id, ...d.data() };
      _userCache[d.id] = { data: u, ts: Date.now() };
      list.push(u);
    });
    _worldUsersCache = list; _worldUsersCacheW = w; _worldUsersCacheUid = uid; _worldUsersCacheTs = Date.now();
    return list;
  })().finally(() => { if (_worldUsersPending === pending) _worldUsersPending = null; });
  _worldUsersPending = pending;
  return pending.promise;
}
window._getWorldUsers = _getWorldUsers;

/* ══════════════════════════════════════════
   _generatePublicId — إنشاء معرف عام فريد
   ✓ 6 أرقام (100000 → 999999)
   ✓ يتحقق من عدم التكرار في Firestore
   ✓ يعيد المحاولة حتى 10 مرات
══════════════════════════════════════════ */
async function _generatePublicId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = String(Math.floor(100000 + Math.random() * 900000));
    try {
      const q = query(
        collection(db, "users"),
        where("publicId", "==", id),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return id; // ← فريد ✓
    } catch(e) {
      // في حالة فشل الاستعلام، نجرب رقماً آخر
    }
  }
  // Fallback نادر جداً — يستخدم timestamp
  return String(Date.now()).slice(-6);
}

/* ══════════════════════════════════════════
   _ensurePublicId(uid)
   ↳ يتحقق من وجود publicId للمستخدم
   ↳ إذا لم يكن موجوداً → ينشئه ويحفظه في Firestore
   ↳ يُحدّث الـ cache فوراً
   ↳ يُستدعى قبل نسخ المعرف أو زيارة البروفايل
══════════════════════════════════════════ */
async function _ensurePublicId(uid) {
  if (!uid) return null;

  // تحقق من الـ cache أولاً
  const cached = _userCache[uid];
  const cachedData = cached?.data || cached;
  if (cachedData?.publicId) return cachedData.publicId;

  // اقرأ من Firestore
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;
    const data = snap.data();

    // إذا موجود → حدّث الـ cache وارجعه
    if (data.publicId) {
      if (_userCache[uid]) {
        const obj = _userCache[uid]?.data || _userCache[uid];
        obj.publicId = data.publicId;
      }
      return data.publicId;
    }

    // غير موجود → أنشئ واحداً جديداً واحفظه
    const newId = await _generatePublicId();
    await updateDoc(doc(db, "users", uid), { publicId: newId });

    // حدّث الـ cache
    if (_userCache[uid]) {
      const obj = _userCache[uid]?.data || _userCache[uid];
      obj.publicId = newId;
    } else {
      _userCache[uid] = { data: { ...data, publicId: newId, uid }, ts: Date.now() };
    }

    return newId;
  } catch(e) {
    console.warn("_ensurePublicId failed:", uid, e);
    return null;
  }
}
window._ensurePublicId = _ensurePublicId;

/* ══════════════════════════════════════════
   REQUEST PANELS — render incoming & sent
══════════════════════════════════════════ */
/* ══════════════════════════════════════════
   RESPOND TO REQUEST (accept / decline)
══════════════════════════════════════════ */

/* ══════════════════════════════════════════
   NEW DM — SEARCH USERS & SEND REQUEST
══════════════════════════════════════════ */
let _currentChatId   = "public";
Object.defineProperty(window, '_currentChatId', { get: () => _currentChatId, set: (v) => { _currentChatId = v; }, configurable: true });
let _currentChatName = "الشات العام";
Object.defineProperty(window, '_currentChatName', { get: () => _currentChatName, set: (v) => { _currentChatName = v; }, configurable: true }); // ← bridge: محتاجها js/chat-select.js
let _currentChatPhoto= "";
Object.defineProperty(window, '_currentChatPhoto', { get: () => _currentChatPhoto, set: (v) => { _currentChatPhoto = v; }, configurable: true }); // ← bridge: محتاجها js/chat-select.js

// تحديث نص هيدر الشات + إظهار/إخفاء زر العين (آخر نشاط) — js/chat-presence-text.js
function _updateChatHeaderStatus(chatId) {
  const statusText = document.getElementById("chatTopOnline");
  if (chatId === "public" || chatId.startsWith("room:")) {
    if (statusText) statusText.textContent = chatId === "public" ? "مباشر — الجميع" : "غرفة عامة";
    window._syncActivityEye?.(chatId);
    return;
  }
  if (statusText) {
    if (typeof window._renderDmHeaderActivity === "function") window._renderDmHeaderActivity(chatId);
    else statusText.textContent = "خاص"; // fallback دفاعي لو الملف الخارجي لم يتحمّل
  }
  window._syncActivityEye?.(chatId);
}
window._updateChatHeaderStatus = _updateChatHeaderStatus; // ← تصدير: محتاجها js/chat-select.js

// selectChat → منقولة لـ js/chat-select.js (يتحمّل قبل هذا السكريبت الرئيسي،
// نفس مكان pin-message.js/chat-backgrounds.js — لازم عشان سلسلة الـ wrapper
// تحتها بتعمل capture مباشر لـ selectChat وقت تحميل هذا السكريبت)

// startChatListener + _loadOlderMessages + _insertLoadMoreBtn + Read State
// → منقولين لـ js/chat-listener.js (مع window.* exports)

/* ══════════════════════════════════════════
   PRIVATE CHAT HELPERS
══════════════════════════════════════════ */
// privateChatId + chatColPath → منقولين لـ js/chat-core.js (مع window.* exports)

// ══════════════════════════════════════════
// ensurePrivateChatDoc
// chatId = [currentUid, otherUid].sort().join("_")
// participants = [uid1, uid2]  (Array — ليس Object)
// ══════════════════════════════════════════
const _ensuredRooms = new Set(); // cache — منع setDoc المتكررة
window._ensuredRooms = _ensuredRooms; // ← تصدير: محتاجها js/chat-core.js (Private Chat Identity section)
// ensurePrivateChatDoc → منقولة لـ js/chat-core.js (مع window.ensurePrivateChatDoc export)



/* ══════════════════════════════════════════
   CHAT BANNED STATE
══════════════════════════════════════════ */
function updateChatBannedState() {
  const bannedBar       = document.getElementById("chatBannedBar");
  const inputBar        = document.querySelector(".newchat-shell .input-bar");
  const emergencyBanner = document.getElementById("ownerEmergencyBanner");

  if (_isChatBanned) {
    if (isOwner()) {
      // Owner gets the emergency banner — NOT the regular banned bar
      bannedBar.style.display       = "none";
      emergencyBanner.style.display = "block";
      inputBar.style.display        = "none";
    } else {
      bannedBar.style.display       = "flex";
      emergencyBanner.style.display = "none";
      inputBar.style.display        = "none";
    }
  } else {
    bannedBar.style.display       = "none";
    emergencyBanner.style.display = "none";
    inputBar.style.display        = "flex";
  }
}
window.updateChatBannedState = updateChatBannedState; // ← تصدير: محتاجها js/chat-listener.js


/* ══════════════════════════════════════════
   CHAT — SEND MESSAGE
   ▸ Anti-spam: 1.5s interval
   ▸ In-flight guard: منع الإرسال المزدوج
   ▸ Empty message: blocked
══════════════════════════════════════════ */
let _isSending = false; // in-flight guard
Object.defineProperty(window, '_isSending', { get: () => _isSending, set: (v) => { _isSending = v; }, configurable: true }); // ← bridge: محتاجها js/chat-send.js

async function sendChatMsg() {
  if (!currentUser)  return;
  if (_isChatBanned) { toast("أنت محظور من إرسال الرسائل", "error"); return; }
  if (_isSending)    return; // منع الإرسال المزدوج

  // Anti-spam
  const now = Date.now();
  if (now - _lastSendTime < SPAM_INTERVAL_MS) { toast("انتظر قليلاً", "warn"); return; }

  const input = document.getElementById("chatInput");
  const text  = input.value.trim();
  if (!text) return; // منع الرسائل الفارغة

  _isSending    = true;
  _lastSendTime = now;

  // تعطيل الزر فورًا لمنع الضغط المتكرر
  const sendBtn = document.getElementById("chatSendBtn");
  sendBtn.disabled = true;

  input.value = "";
  input.focus();

  const isPrivate = _currentChatId !== "public";
  const colPath   = chatColPath(_currentChatId);

  // Phase 1 / 5.1 — World Model: يُضاف فقط للشات العام، وفقط لو فيه عالم صالح حاليًا.
  // لا worldId: null، ولا افتراض is_2 — لو activeWorldContext() رجّعت null، الحقل ما يُكتبش أصلاً.
  const _worldId = (colPath === "messages" && typeof window.activeWorldContext === "function")
    ? window.activeWorldContext() : null;

  try {
    const msgData = {
      text,
      uid:       currentUser.uid,
      name:      currentName,
      photo:     currentPhoto,
      createdAt: serverTimestamp(),
      ...(_worldId ? { worldId: _worldId } : {}),
      // حقول مشتركة بين العام والخاص
      ...(isPrivate ? {
        senderId:  currentUser.uid,
        delivered: false,
        seen:      false
      } : {
        time: new Date().toLocaleTimeString("ar-EG", {hour:"2-digit", minute:"2-digit"})
      })
    };

    await addDoc(collection(db, colPath), msgData);

    // ── حذف المسودة بعد الإرسال الناجح ──
    _draftClear(_currentChatId);

    // تحديث بيانات الغرفة الخاصة
    // FCM notifications
    const _isTrueDM = isPrivate && !_currentChatId.startsWith("room:");
    if (_isTrueDM) {
      // DM: notify recipient (chatId IS the peer UID)
      _notifyPrivateMsg(_currentChatId, currentName, text).catch(() => {});
    } else {
      // Public / Room: detect @mentions
      _notifyMentions(text, currentName).catch(() => {});
    }
    if (isPrivate) {
      const roomRef = doc(db, "privateChats", privateChatId(_currentChatId));
      updateDoc(roomRef, {
        lastMessage:   text.length > 60 ? text.slice(0, 60) + "…" : text,
        lastMessageAt: serverTimestamp(),
        lastSenderId:  currentUser.uid
      }).catch(e => {
        if (e.code !== "permission-denied") console.warn("lastMsg update:", e.code);
      });
    }
  } catch(e) {
    toast("فشل إرسال الرسالة", "error");
    console.error(e);
    input.value = text; // إعادة النص عند الفشل
  } finally {
    _isSending = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

document.getElementById("chatSendBtn").addEventListener("click", () => window.sendChatMsg());
document.getElementById("chatInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); window.sendChatMsg(); }
});

/* ══════════════════════════════════════════
   CHAT — SEND IMAGE (short tap) + POLL (long press ~400ms)
══════════════════════════════════════════ */
(function() {
  const imgBtn = document.querySelector(".newchat-shell .clip-icon");
  if (!imgBtn) return;
  let _pressTimer = null;
  let _didLongPress = false;

  function _startPress() {
    _didLongPress = false;
    _pressTimer = setTimeout(function() {
      _didLongPress = true;
      imgBtn.style.background = "rgba(201,169,110,.22)";
      imgBtn.style.color = "var(--gold)";
      if (typeof openPollModal === "function") openPollModal();
      setTimeout(function() {
        imgBtn.style.background = "";
        imgBtn.style.color = "";
      }, 400);
    }, 400);
  }

  function _endPress(e) {
    if (e && e.type === "touchend") e.preventDefault(); // يمنع إعادة تنفيذ الضغطة كـ mouse/click
    clearTimeout(_pressTimer);
    imgBtn.style.background = "";
    imgBtn.style.color = "";
    if (_didLongPress) { e && e.preventDefault(); return; }
    if (_isChatBanned) { toast("أنت محظور من إرسال الرسائل", "error"); return; }
    document.getElementById("chatFileInput").click();
  }

  imgBtn.addEventListener("mousedown",  _startPress);
  imgBtn.addEventListener("touchstart", _startPress, { passive: true });
  imgBtn.addEventListener("mouseup",    _endPress);
  imgBtn.addEventListener("touchend",   _endPress);
  imgBtn.addEventListener("mouseleave", function() { clearTimeout(_pressTimer); imgBtn.style.background = ""; imgBtn.style.color = ""; });
  imgBtn.addEventListener("click",      function(e) { if (_didLongPress) e.stopImmediatePropagation(); });
})();

/* ══════════════════════════════════════════
   CHAT — SEND / VOICE BUTTON TOGGLE
══════════════════════════════════════════ */
(function() {
  const input = document.getElementById("chatInput");

  // زر الكاميرا/الإرسال (chatSendBtn) بيتحكم في شكله سكريبت التصميم
  // الجديد (newchat-ui-script → updateBarState) اللي بيبدّل الأيقونة
  // جوه نفس الزر. الدالة دي بقت بس بتعمل refresh للأيقونة بعد الإرسال،
  // مش بتخفي/تظهر الزر نفسه (ده كان هو سبب اختفاء زر الكاميرا).
  function _updateBtnVisibility() {
    if (typeof window.updateBarState === "function") window.updateBarState();
  }

  // Patch sendChatMsg to reset after send
  const _origSend = window.sendChatMsg;
  window.sendChatMsg = function() {
    const r = _origSend ? _origSend.apply(this, arguments) : undefined;
    setTimeout(_updateBtnVisibility, 0);
    return r;
  };

  // Initial state
  _updateBtnVisibility();
  window._updateSendVoiceBtns = _updateBtnVisibility;
})();

document.getElementById("chatFileInput").addEventListener("change", async () => {
  const file = document.getElementById("chatFileInput").files[0];
  if (!file || !currentUser) return;
  if (_isChatBanned) { toast("أنت محظور من إرسال الرسائل", "error"); return; }
  if (file.type.startsWith("video/")) { toast("ممنوع إرسال فيديوهات", "error"); return; }
  if (file.size > 15 * 1024 * 1024) { toast("حجم الملف كبير جداً (max 15MB)", "error"); return; }

  const isPDF = file.type === "application/pdf" || file.name.endsWith(".pdf");
  const upCard = _buildUploadCard(file);

  try {
    const { url } = await uploadToCloudinaryWithProgress(file, (prog) => {
      upCard.update(prog);
    });

    const isPrivate = _currentChatId !== "public";
    const colPath   = chatColPath(_currentChatId);
    // ✅ نفس نقطة الإنشاء المتأخرة المستخدمة في كل مسارات الإرسال —
    // الغرفة تتأكّد/تتنشأ فقط عند أول إرسال فعلي، مش عند فتح الشات.
    if (isPrivate) await ensurePrivateChatDoc(_currentChatId);
    const cat = _getFileCategory(file);

    // Phase 1 / 5.1 — World Model: يُضاف فقط للشات العام، وفقط لو فيه عالم صالح حاليًا.
    // لا worldId: null، ولا افتراض is_2 — لو activeWorldContext() رجّعت null، الحقل ما يُكتبش أصلاً.
    const _worldId = (colPath === "messages" && typeof window.activeWorldContext === "function")
      ? window.activeWorldContext() : null;

    // Build message data based on file type
    let fileFields = {};
    if (isPDF) {
      fileFields = { pdf: url, fileName: file.name };
    } else if (cat === "audio") {
      fileFields = { audio: url, fileName: file.name, fileSize: file.size };
    } else if (cat === "doc" || cat === "zip" || cat === "file") {
      fileFields = { file: url, fileName: file.name, fileSize: file.size, fileType: file.type };
    } else {
      fileFields = { image: url };
    }

    const msgData = {
      uid:       currentUser.uid,
      name:      currentName,
      photo:     currentPhoto,
      createdAt: serverTimestamp(),
      ...fileFields,
      ...(_worldId ? { worldId: _worldId } : {}),
      ...(isPrivate ? {
        senderId:  currentUser.uid,
        delivered: false,
        seen:      false
      } : {
        time: new Date().toLocaleTimeString("ar-EG", {hour:"2-digit", minute:"2-digit"})
      })
    };

    await addDoc(collection(db, colPath), msgData);

    if (isPrivate && !_currentChatId.startsWith("room:")) {
      const _fileLabel = isPDF ? "📄 أرسل لك ملف PDF" : cat === "audio" ? "🎵 أرسل لك ملف صوتي" : cat === "doc" ? "📎 أرسل لك ملف" : "📷 أرسل لك صورة";
      _notifyPrivateMsg(_currentChatId, currentName, _fileLabel).catch(() => {});
    }

    if (isPrivate) {
      const roomRef = doc(db, "privateChats", privateChatId(_currentChatId));
      const label = isPDF ? `📄 PDF` : cat === "audio" ? `🎵 صوت` : cat === "doc" ? `📎 ملف` : cat === "zip" ? `🗜 ملف مضغوط` : `📷 صورة`;
      await updateDoc(roomRef, {
        lastMessage:   label,
        lastMessageAt: serverTimestamp(),
        lastSenderId:  currentUser.uid
      }).catch(() => {});
      // ✅ إعادة ربط مستمع الرسائل لو كان الشات فاضي (مات بـ permission-denied) قبل الإرسال
      if (window._dmNeedsRelisten === _currentChatId) {
        window._dmNeedsRelisten = null;
        window.startChatListener?.(_currentChatId);
      }
    }

    upCard.markDone();
  } catch(e) {
    upCard.markFailed(e.message || e.name || String(e));
    console.error("Upload error:", e);
  }
  document.getElementById("chatFileInput").value = "";
});

/* ══════════════════════════════════════════
   CHAT — ADMIN ACTIONS
══════════════════════════════════════════ */
window.adminDeleteMsg = async function(docId) {
  const chatPath = chatColPath(_currentChatId);

  // احفظ بيانات الرسالة قبل أي قرار — تُستخدم لفحص الملكية وللـ Audit Log
  let msgData = {};
  try {
    const _msgSnap = await getDoc(doc(db, chatPath, docId));
    if (_msgSnap.exists()) msgData = _msgSnap.data();
  } catch(_e) {}

  const _isOwnMsg = currentUser && msgData.uid === currentUser.uid;
  if (!isAdmin() && !_isOwnMsg) return;

  const ok = await confirm("حذف الرسالة", "هل تريد حذف هذه الرسالة؟");
  if (!ok) return;
  try {
    // ✅ Soft Delete — deleted:true بدل deleteDoc
    // يحفظ الرسالة في Firestore للمراجعة، ويخفيها من الواجهة فقط
    await updateDoc(doc(db, chatPath, docId), {
      deleted:        true,
      deletedBy:      currentUser.uid,
      deletedByRole:  currentRole,
      deletedAt:      serverTimestamp(),
    });

    // إخفاء فوري من الـ DOM
    const msgEl = document.getElementById(`msg-${docId}`);
    if (msgEl) {
      // اعرض placeholder بدل الحذف الكامل من الـ DOM
      const bubbleEl = msgEl.querySelector('.bubble-text, .bubble-image');
      if (bubbleEl) {
        bubbleEl.className = 'bubble-text';
        bubbleEl.style.cssText = 'color:var(--muted);font-style:italic;font-size:12px;';
        bubbleEl.textContent = '🗑 تم حذف هذه الرسالة';
      }
    }

    // ── Audit Log ──
    await writeAuditLog(
      AUDIT_ACTIONS.DELETE_MESSAGE,
      {
        messageId:    docId,
        chatId:       _currentChatId,
        msgSenderUid: msgData.uid  || 'unknown',
        msgSenderName:msgData.name || 'unknown',
        msgPreview:   (msgData.text || (msgData.image ? '[صورة]' : '')).slice(0, 100),
      },
      msgData.uid  || null,
      msgData.name || null
    );

    toast("تم حذف الرسالة");
  } catch(e) { toast("فشل الحذف", "error"); console.error(e); }
};


/* ══════════════════════════════════════════
   CHAT BAN — TOGGLE (Owner = ban+unban / Admin = ban فقط)
══════════════════════════════════════════ */
async function toggleChatBan(uid, userName, currentlyBanned, btnEl, onSuccess) {
  // Admin لا يستطيع رفع الحظر
  if (currentlyBanned && !isOwner()) {
    toast("فقط الأونر يستطيع رفع حظر الشات", "warn"); return;
  }

  const newVal = !currentlyBanned;
  const title  = newVal ? "حظر من الشات" : "رفع حظر الشات";
  const msg    = `هل تريد ${newVal ? "حظر" : "رفع الحظر عن"} "${esc(userName)}" من الشات؟`;

  const ok = await confirm(title, msg);
  if (!ok) return;

  // Animation فورية على الزر
  if (btnEl) {
    btnEl.disabled    = true;
    btnEl.textContent = "جاري...";
  }

  try {
    await updateDoc(doc(db, "users", uid), newVal ? {
      isChatBanned: true,
      bannedBy:     currentUser.uid,
      bannedAt:     serverTimestamp(),
      banReason:    `حظر من قِبَل ${isOwner() ? "الأونر" : "الأدمن"}`
    } : {
      isChatBanned: false,
      bannedBy:     deleteField(),
      bannedAt:     deleteField(),
      banReason:    deleteField()
    });

    window.AccountArchive?.log(uid, "chatBan", newVal ? "unbanned" : "banned", newVal ? "banned" : "unbanned");
    toast(newVal ? "تم حظر الشات" : "تم رفع حظر الشات");

    // ── Audit Log ──
    await writeAuditLog(
      newVal ? AUDIT_ACTIONS.CHAT_BAN : AUDIT_ACTIONS.CHAT_UNBAN,
      { byRole: currentRole, method: newVal ? 'chat_ban' : 'chat_unban' },
      uid,
      userName
    );

    // تحديث الزر فوراً بدون reload
    if (btnEl) {
      btnEl.disabled = false;
      if (newVal) {
        btnEl.className   = "act-btn chatunban";
        btnEl.innerHTML = '<i class="fa-solid fa-comments"></i> رفع حظر الشات';
      } else {
        btnEl.className   = "act-btn chatban";
        btnEl.innerHTML = '<i class="fa-solid fa-volume-xmark"></i> حظر الشات';
      }
    }

    if (onSuccess) onSuccess(newVal);
  } catch(e) {
    toast("فشل التحديث — حاول مجدداً", "error");
    console.error(e);
    if (btnEl) {
      btnEl.disabled    = false;
      btnEl.innerHTML = currentlyBanned ? '<i class="fa-solid fa-comments"></i> رفع حظر الشات' : '<i class="fa-solid fa-volume-xmark"></i> حظر الشات';
    }
  }
}

/* ══════════════════════════════════════════
   OWNER EMERGENCY SELF-UNBAN
══════════════════════════════════════════ */
async function ownerSelfUnban() {
  if (!isOwner() || !currentUser) return;

  const btn = document.getElementById("ownerSelfUnbanBtn");
  if (btn) { btn.disabled = true; btn.textContent = "جاري فك الحظر..."; }

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      isChatBanned: false,
      bannedBy:     deleteField(),
      bannedAt:     deleteField(),
      banReason:    deleteField()
    });

    // تحديث الحالة محلياً فوراً — بدون Refresh
    _isChatBanned = false;
    updateChatBannedState();

    // ── Audit Log ──
    await writeAuditLog(
      AUDIT_ACTIONS.OWNER_SELF_UNBAN,
      { note: 'Owner removed own chat ban via emergency banner' }
    );

    window.AccountArchive?.log(currentUser.uid, "chatBan", "banned", "unbanned");
    toast("تم فك الحظر بنجاح", "success");
  } catch(e) {
    toast("فشل فك الحظر — حاول مجدداً", "error");
    if (btn) { btn.disabled = false; btn.innerHTML = "<i class=\"fa-solid fa-crown\"></i> فك الحظر عن نفسي"; }
  }
}

document.getElementById("ownerSelfUnbanBtn")?.addEventListener("click", ownerSelfUnban);

/* ══════════════════════════════════════════
   PROFILE SAVE
══════════════════════════════════════════ */
document.getElementById("saveProfile").addEventListener("click", async () => {
  if (!currentUser) return;
  const name = document.getElementById("editName").value.trim();
  const bio  = document.getElementById("editBio").value.trim();
  if (!name) return toast("اكتب اسمك أولاً", "error");

  const _aaOldName = currentName, _aaOldBio = document.getElementById("profileBioText")?.textContent || "";
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { name, bio });
    if (name !== _aaOldName) window.AccountArchive?.log(currentUser.uid, "name", _aaOldName, name);
    if (bio  !== _aaOldBio)  window.AccountArchive?.log(currentUser.uid, "bio",  _aaOldBio,  bio);
    currentName = name;
    // ✅ تحديث الاسم في _currentUserData قبل إعادة الرسم
    if (window._currentUserData) window._currentUserData.name = name;
    // ✅ استخدام innerHTML + renderUserDisplay لضمان ظهور الـ badges
    document.getElementById("welcomeText").innerHTML    = renderUserDisplay(name, window._currentUserData, currentUser.uid);
    document.getElementById("profileName").innerHTML    = renderUserDisplay(name, window._currentUserData, currentUser.uid);
    document.getElementById("profileBioText").textContent = bio;
    const av = document.getElementById("avatar");
    if (!av.querySelector("img")) setAvatarUI(_defaultAvatarHTML(window._currentUserData?.gender, 96), false, window._currentUserData?.gender);
    toast("تم حفظ التعديلات");
  } catch(e) { toast("فشل الحفظ", "error"); console.error(e); }
});

/* ══════════════════════════════════════════
   CHANGE PASSWORD — منقول بالكامل لـ js/change-password.js
══════════════════════════════════════════ */

document.getElementById("uploadBtn").addEventListener("click", async () => {
  const file = document.getElementById("imageInput").files[0];
  if (!file || !currentUser) return toast("اختر صورة أولاً", "error");
  if (file.size > 3 * 1024 * 1024) return toast("حجم الصورة كبير (max 3MB)", "error");
  toast("جاري الرفع...", "warn");
  try {
    const url = await uploadToCloudinary(file);
    const _aaOldPhoto = currentPhoto;
    await updateDoc(doc(db, "users", currentUser.uid), { photo: url });
    window.AccountArchive?.log(currentUser.uid, "photo", _aaOldPhoto, url);
    currentPhoto = url;
    setAvatarUI(url, true, window._currentUserData?.gender);
    toast("تم رفع الصورة");
  } catch(e) { toast("فشل رفع الصورة", "error"); }
});

// Also trigger upload from profile avatar click
document.getElementById("profileAvatar").addEventListener("click", () =>
  document.getElementById("imageInput").click()
);
document.getElementById("imageInput").addEventListener("change", () => {
  document.getElementById("uploadBtn").click();
});

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
const _forumLiveMarkerKey = (ctx, col) => "forumLive:v1:" + ctx.uid + ":" + ctx.world + ":" + col;
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
  const e = _forumLive[key];
  if (!e.active && !e.unsub) return;
  e.gen++;                                   // أي callback قديم يتجاهل نفسه
  if (e.unsub) { try { e.unsub(); } catch(_) {} }
  if (e.external) { try { window._libLiveStop?.(); } catch(_) {} }
  e.unsub = null; e.active = false; e.sig = null;
}

async function _forumLiveStart(key, ctx) {
  const e = _forumLive[key];
  _forumLiveStop(key);                       // أي مستمع سابق يتفصل قبل الجديد
  e.active = true; e.sig = ctx.sig;
  if (e.external) { try { window._libLiveStart?.(ctx); } catch(err) { console.error(err); } return; }

  const gen  = e.gen;
  const list = document.getElementById(e.list);
  if (!list) return;
  // حساب/عالم مختلف عن اللي معروض (أو أول مرة) → spinner؛ نفس الحساب والعالم → سيب المعروض لحد أول لقطة
  if (e.dataSig !== ctx.sig || !e.rendered) { list.innerHTML = `<div class="spinner"></div>`; e.rendered = false; }
  // عالم غير محدد (مثلاً أونر لسه ما اختارش) → قائمة فاضية زي السلوك القديم، من غير مستمع
  if (!ctx.world) { list.innerHTML = _FORUM_EMPTY_HTML; e.rendered = true; e.dataSig = ctx.sig; return; }

  // بوابة بليس (مرحلة 3.0 — كامنة خلف علم KV): الكروت المسجلة في js/card-gateway.js تجرّب البوابة أولًا،
  // وأي فشل أو غياب الوضع "gateway" ← المستمع الحالي بالأسفل كما هو بلا أي تغيير.
  if (window.CardGateway && window.CardGateway.isRegistered(key)) {
    const renderGwDocs = (docs) => {
      if (gen !== e.gen || window.currentUser?.uid !== ctx.uid || _forumLiveCtx().sig !== ctx.sig) return;
      let els = [];
      try { els = docs.map(d => e.render(d)); }
      catch (err) {
        console.error(err);
        list.innerHTML = `<div class="empty-state">خطأ في التحميل</div>`;
        e.rendered = false;
        return;
      }
      list.innerHTML = "";
      if (!docs.length) { list.innerHTML = _FORUM_EMPTY_HTML; }
      else els.forEach(el => { if (el) list.appendChild(el); });
      e.rendered = true; e.dataSig = ctx.sig;
    };
    let served = false;
    try { served = await window.CardGateway.serveCard(key, ctx, renderGwDocs); }
    catch (err) { console.error(err); served = false; }
    if (gen !== e.gen) return;                 // الكارت اتقفل/اتبدل أثناء الانتظار (والرسم نفسه محروس بالجيل والبصمة)
    if (served) return;                        // خُدم من البوابة: بلا مستمع Firestore
    // وإلا: يكمل للمستمع الحالي كما هو
  }

  const mk    = _forumLiveMarkerKey(ctx, e.col);
  const still = () => gen === e.gen && window.currentUser?.uid === ctx.uid && _forumLiveCtx().sig === ctx.sig;
  let first = true;
  try {
    // ✅ World Isolation: نفس الاستعلام القديم بالظبط (worldId + createdAt تنازلي) + فلترة worldId على العميل
    const q = query(collection(db, e.col), where("worldId", "==", ctx.world), orderBy("createdAt", "desc"));
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
      const _ref = await addDoc(collection(db, colName), { ...fields, worldId: _worldId, createdAt: serverTimestamp() });
      _newId = _ref && _ref.id;
      saved = true;
    } catch(e) {
      toast("فشلت الإضافة", "error");
      console.error(e);
      return;
    }
    if (saved) {
      toast(successMsg, "success");
      try { window.CardGateway?.syncAfterWrite(colName, _newId, _worldId); } catch(_) {} // مزامنة البوابة (كامنة) — لا تمنع الإضافة أبدًا
      try { reloadFn(); } catch(_) {}
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
  document.getElementById("newsTitle").value = "";
  document.getElementById("newsBody").value  = "";
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
  document.getElementById("oNewsTitle").value = "";
  document.getElementById("oNewsBody").value  = "";
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

/* ══════════════════════════════════════════
   OWNER PANEL — Stats & User Management
══════════════════════════════════════════ */
/* ══════════════════════════════════════════
   USERS MANAGER MODAL — open / close
══════════════════════════════════════════ */
function openUsersManager() {
  if (!isOwner()) return;
  const modal = document.getElementById("usersManagerModal");
  if (!modal) return;
  modal.style.display = "block";
  // تحميل المستخدمين عند الفتح
  loadOwnerUsers();
  loadOwnerStats();
}

function closeUsersManager() {
  const modal = document.getElementById("usersManagerModal");
  if (modal) {
    modal.style.animation = "um-slide-out .22s cubic-bezier(.4,0,.2,1) forwards";
    setTimeout(() => {
      modal.style.display = "none";
      modal.style.animation = "";
    }, 220);
  }
}
window.openUsersManager  = openUsersManager;
window.closeUsersManager = closeUsersManager;

let _ownerStatsPending = null;
async function loadOwnerStats() {
  if (_ownerStatsPending) return _ownerStatsPending;
  _ownerStatsPending = (async () => {
    try {
      const usersRef = collection(db, "users");
      const counts = await Promise.all([
        getCountFromServer(usersRef),
        getCountFromServer(query(usersRef, where("role", "==", ROLES.ADMIN))),
        getCountFromServer(query(usersRef, where("isBanned", "==", true))),
        getCountFromServer(query(usersRef, where("role", "==", ROLES.USER)))
      ]);
      const [total, admins, banned, users] = counts.map(snap => snap.data().count);
      document.getElementById("statTotal").textContent = total;
      document.getElementById("statAdmins").textContent = admins;
      document.getElementById("statBanned").textContent = banned;
      document.getElementById("statUsers").textContent = users;
      const subEl = document.getElementById("umHeaderSub");
      if (subEl) subEl.textContent = `${total} مستخدم · ${admins} أدمن · ${banned} محظور`;
    } catch(e) { console.error("owner counts:", e); }
  })().finally(() => { _ownerStatsPending = null; });
  return _ownerStatsPending;
}


let _allOwnerUsers = [];
async function loadOwnerUsers() {
  const list = document.getElementById("ownerUsersList");
  list.innerHTML = `<div class="spinner"></div>`;
  try {
    const snap = await getDocs(collection(db, "users"));
    _allOwnerUsers = [];
    snap.forEach(docu => _allOwnerUsers.push({ id: docu.id, ...docu.data() }));
    renderOwnerUsers(_allOwnerUsers);
  } catch(e) {
    list.innerHTML = `<div class="empty-state">خطأ في تحميل المستخدمين</div>`;
    console.error(e);
  }
}

function renderOwnerUsers(users) {
  const list = document.getElementById("ownerUsersList");
  if (!list) return;
  list.innerHTML = "";
  if (!users.length) { list.innerHTML = `<div class="empty-state">لا توجد نتائج</div>`; return; }

  users.forEach(u => {
    const uid        = u.uid || u.id;
    const uRole      = u.role || ROLES.USER;
    const isSelf     = uid === currentUser?.uid;
    const isOwnerDoc = uRole === ROLES.OWNER;

    const roleBadges = {
      owner: `<span class="badge badge-owner"><i class="fa-solid fa-crown"></i> Owner</span>`,
      admin: `<span class="badge badge-admin"><i class="fa-solid fa-gear"></i> Admin</span>`,
      user:  `<span class="badge badge-user"><i class="fa-solid fa-circle-user"></i> User</span>`
    };
    const bannedBadge    = u.isBanned     ? `<span class="badge badge-banned">محظور</span>` : "";
    const chatBanBadge   = u.isChatBanned ? `<span class="badge badge-chatban"><i class="fa-solid fa-ban"></i> شات</span>` : "";

    const div = document.createElement("div");
    div.className = "user-card";
    div.innerHTML = `
      <div class="user-info">
        <div class="u-name">${renderUserDisplay(u.name||"—", u)} ${isSelf ? '<span style="font-size:10px;color:var(--muted)">(أنت)</span>' : ""}</div>
        <div class="u-email">${esc(displayEmail(u.email))}</div>
        <div class="u-badges">${roleBadges[uRole]||""} ${bannedBadge} ${chatBanBadge}</div>
      </div>
      <div class="user-actions" id="oactions-${uid}"></div>
    `;

    const actionsEl = div.querySelector(`#oactions-${uid}`);

    if (!isSelf && !isOwnerDoc && canModifyUser(currentRole, uRole)) {

      // Ban / Unban (account)
      const banBtn = document.createElement("button");
      banBtn.className = `act-btn ${u.isBanned ? "unban" : "ban"}`;
      banBtn.innerHTML = u.isBanned ? '<i class="fa-solid fa-check"></i> رفع الحظر' : '<i class="fa-solid fa-ban"></i> حظر الحساب';
      banBtn.addEventListener("click", async () => {
        const ok = await confirm(u.isBanned ? "رفع الحظر" : "حظر المستخدم",
          `${u.isBanned ? "هل تريد رفع الحظر عن" : "هل تريد حظر"} "${esc(u.name||"هذا المستخدم")}"؟`);
        if (!ok) return;
        banBtn.disabled = true; banBtn.textContent = "جاري...";
        try {
          await updateDoc(doc(db, "users", uid), { isBanned: !u.isBanned });
          window.AccountArchive?.log(uid, "ban", u.isBanned ? "banned" : "unbanned", u.isBanned ? "unbanned" : "banned");
          // ── Audit Log ──
          await writeAuditLog(
            u.isBanned ? AUDIT_ACTIONS.UNBAN_USER : AUDIT_ACTIONS.BAN_USER,
            { method: 'account_ban' },
            uid,
            u.name || '—'
          );
          toast(u.isBanned ? "تم رفع الحظر" : "تم الحظر");
          loadOwnerUsers(); loadOwnerStats();
        } catch(e) { toast("فشل التحديث","error"); banBtn.disabled=false; }
      });
      actionsEl.appendChild(banBtn);

      // ── حظر الشات / رفعه — Owner يملك الصلاحيتين ──
      const chatBanBtn = document.createElement("button");
      chatBanBtn.className   = `act-btn ${u.isChatBanned ? "chatunban" : "chatban"}`;
      chatBanBtn.innerHTML = u.isChatBanned ? '<i class="fa-solid fa-comments"></i> رفع حظر الشات' : '<i class="fa-solid fa-volume-xmark"></i> حظر الشات';
      chatBanBtn.addEventListener("click", () => {
        // قراءة الحالة الحية من الـ class (بعد أي toggle سابق)
        const nowBanned = chatBanBtn.classList.contains("chatunban");
        toggleChatBan(uid, u.name || "هذا المستخدم", nowBanned, chatBanBtn, (newBannedState) => {
          // تحديث الـ cache المحلي للـ search/filter
          const cached = _allOwnerUsers.find(x => (x.uid || x.id) === uid);
          if (cached) cached.isChatBanned = newBannedState;
          // تحديث الـ badge داخل الكارت مباشرة
          const badgesEl = div.querySelector(".u-badges");
          if (badgesEl) {
            const oldBadge = badgesEl.querySelector(".badge-chatban");
            if (newBannedState && !oldBadge) {
              const s = document.createElement("span");
              s.className = "badge badge-chatban"; s.innerHTML = "<i class=\"fa-solid fa-ban\"></i> شات";
              badgesEl.appendChild(s);
            } else if (!newBannedState && oldBadge) { oldBadge.remove(); }
          }
        });
      });
      actionsEl.appendChild(chatBanBtn);

      // Promote / Demote — Owner only
      if (isOwner() && canSetRole(currentRole, uRole, uRole === ROLES.ADMIN ? ROLES.USER : ROLES.ADMIN)) {
        const roleBtn = document.createElement("button");
        const isCurrentlyAdmin = uRole === ROLES.ADMIN;
        roleBtn.className   = `act-btn ${isCurrentlyAdmin ? "demote" : "promote"}`;
        roleBtn.innerHTML = isCurrentlyAdmin ? '<i class="fa-solid fa-chevron-down"></i> إزالة أدمن' : '<i class="fa-solid fa-chevron-up"></i> ترقية أدمن';
        roleBtn.addEventListener("click", async () => {
          const newRole = isCurrentlyAdmin ? ROLES.USER : ROLES.ADMIN;
          const label   = isCurrentlyAdmin ? "مستخدم عادي" : "أدمن";
          const ok = await confirm("تغيير الصلاحية",
            `هل تريد تغيير صلاحية "${esc(u.name||"هذا المستخدم")}" إلى "${label}"؟`);
          if (!ok) return;
          roleBtn.disabled = true; roleBtn.textContent = "جاري...";
          try {
            await updateDoc(doc(db, "users", uid), { role: newRole });
            window.AccountArchive?.log(uid, "role", uRole, newRole);
            // ── Audit Log ──
            await writeAuditLog(
              isCurrentlyAdmin ? AUDIT_ACTIONS.DEMOTE_ADMIN : AUDIT_ACTIONS.PROMOTE_ADMIN,
              { oldRole: uRole, newRole },
              uid,
              u.name || '—'
            );
            toast(`تم تغيير الصلاحية إلى "${label}"`);
            loadOwnerUsers(); loadOwnerStats();
          } catch(e) { toast("فشل تغيير الصلاحية","error"); roleBtn.disabled=false; }
        });
        actionsEl.appendChild(roleBtn);
      }

    } else if (isOwnerDoc) {
      const prot = document.createElement("span");
      prot.style.cssText = "font-size:10px;color:var(--gold);font-weight:700;text-align:center;padding:4px 8px;display:block;";
      prot.innerHTML = '<i class="fa-solid fa-lock"></i> محمي';
      actionsEl.appendChild(prot);
    } else if (isSelf) {
      const self = document.createElement("span");
      self.style.cssText = "font-size:10px;color:var(--muted);padding:4px 8px;display:block;";
      self.textContent = "—";
      actionsEl.appendChild(self);
    }

    list.appendChild(div);
  });
}

/* ══════════════════════════════════════════
   ADMIN PANEL — User List
   Admin: ban/unban users only (NOT other admins, NOT owner)
   Admin: can ban from chat but CANNOT unban chat
══════════════════════════════════════════ */
let _allAdminUsers = [];

async function loadAdminUsers() {
  const list = document.getElementById("adminUsersList");
  if (!list) return;
  list.innerHTML = `<div class="spinner"></div>`;
  try {
    const snap = await getDocs(collection(db, "users"));
    const _allFetched = [];
    snap.forEach(docu => _allFetched.push({ id: docu.id, ...docu.data() }));
    // ✅ Admin Isolation: الأونر يبقى Global بلا فلترة — الأدمن العادي يرى فقط
    // المستخدمين اللي user.worldId بتاعهم يطابق currentUserWorldId(). مستخدم
    // بلا worldId لا يُعامَل كأنه تابع لعالم الأدمن.
    const _myWorld = (typeof window.currentUserWorldId === "function") ? window.currentUserWorldId() : null;
    _allAdminUsers = isOwner() ? _allFetched : _allFetched.filter(u => u.worldId === _myWorld);
    renderAdminUsers(_allAdminUsers);
  } catch(e) {
    list.innerHTML = `<div class="empty-state">خطأ في التحميل</div>`;
    console.error(e);
  }
}

function renderAdminUsers(users) {
  const list = document.getElementById("adminUsersList");
  if (!list) return;
  list.innerHTML = "";
  if (!users.length) { list.innerHTML = `<div class="empty-state">لا توجد نتائج</div>`; return; }

  users.forEach(u => {
    const uid        = u.uid || u.id;
    const uRole      = u.role || ROLES.USER;
    const isSelf     = uid === currentUser?.uid;
    const isOwnerDoc = uRole === ROLES.OWNER;

    if (isOwnerDoc) return; // Admin cannot see/touch owner

    const roleBadges = {
      admin: `<span class="badge badge-admin"><i class="fa-solid fa-gear"></i> Admin</span>`,
      user:  `<span class="badge badge-user"><i class="fa-solid fa-circle-user"></i> User</span>`
    };
    const bannedBadge  = u.isBanned     ? `<span class="badge badge-banned">محظور</span>` : "";
    const chatBanBadge = u.isChatBanned ? `<span class="badge badge-chatban"><i class="fa-solid fa-ban"></i> شات</span>` : "";

    const div = document.createElement("div");
    div.className = "user-card";
    div.innerHTML = `
      <div class="user-info">
        <div class="u-name">${renderUserDisplay(u.name||"—", u)} ${isSelf ? '<span style="font-size:10px;color:var(--muted)">(أنت)</span>' : ""}</div>
        <div class="u-email">${esc(displayEmail(u.email))}</div>
        <div class="u-badges">${roleBadges[uRole]||""} ${bannedBadge} ${chatBanBadge}</div>
      </div>
      <div class="user-actions"></div>
    `;

    const actionsEl = div.querySelector(".user-actions");

    if (!isSelf && uRole !== ROLES.ADMIN) {
      // Account ban (users only)
      const banBtn = document.createElement("button");
      banBtn.className   = `act-btn ${u.isBanned ? "unban" : "ban"}`;
      banBtn.innerHTML = u.isBanned ? '<i class="fa-solid fa-check"></i> رفع الحظر' : '<i class="fa-solid fa-ban"></i> حظر الحساب';
      banBtn.addEventListener("click", async () => {
        // ✅ Admin Isolation: تحقق مباشر وقت التنفيذ (وليس فقط اعتمادًا على
        // أن المستخدم ظهر في قائمة مفلترة) — الأونر يتجاوز هذا التحقق.
        if (!isOwner()) {
          const _myWorld = (typeof window.currentUserWorldId === "function") ? window.currentUserWorldId() : null;
          if (!u.worldId || u.worldId !== _myWorld) { toast("غير مصرح — هذا المستخدم لا يتبع عالمك", "error"); return; }
        }
        const ok = await confirm(u.isBanned ? "رفع الحظر" : "حظر المستخدم",
          `${u.isBanned ? "هل تريد رفع الحظر عن" : "هل تريد حظر"} "${esc(u.name||"هذا المستخدم")}"؟`);
        if (!ok) return;
        banBtn.disabled = true; banBtn.textContent = "جاري...";
        try {
          await updateDoc(doc(db, "users", uid), { isBanned: !u.isBanned });
          window.AccountArchive?.log(uid, "ban", u.isBanned ? "banned" : "unbanned", u.isBanned ? "unbanned" : "banned");
          // ── Audit Log ──
          await writeAuditLog(
            u.isBanned ? AUDIT_ACTIONS.UNBAN_USER : AUDIT_ACTIONS.BAN_USER,
            { method: 'account_ban', byRole: 'admin' },
            uid,
            u.name || '—'
          );
          toast(u.isBanned ? "تم رفع الحظر" : "تم الحظر");
          loadAdminUsers();
        } catch(e) {
          toast("فشل التحديث","error");
          banBtn.disabled=false;
          banBtn.innerHTML = u.isBanned ? '<i class="fa-solid fa-check"></i> رفع الحظر' : '<i class="fa-solid fa-ban"></i> حظر الحساب';
        }
      });
      actionsEl.appendChild(banBtn);

      // ── حظر الشات — Admin: حظر فقط / Owner: يستخدم لوحته الخاصة ──
      if (!u.isChatBanned) {
        const chatBanBtn = document.createElement("button");
        chatBanBtn.className   = "act-btn chatban";
        chatBanBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i> حظر الشات';
        chatBanBtn.addEventListener("click", () => {
          // ✅ Admin Isolation: تحقق مباشر وقت التنفيذ — الأونر يتجاوز هذا التحقق.
          if (!isOwner()) {
            const _myWorld = (typeof window.currentUserWorldId === "function") ? window.currentUserWorldId() : null;
            if (!u.worldId || u.worldId !== _myWorld) { toast("غير مصرح — هذا المستخدم لا يتبع عالمك", "error"); return; }
          }
          toggleChatBan(uid, u.name || "هذا المستخدم", false, chatBanBtn, (newBannedState) => {
            // تحديث cache محلي
            const cached = _allAdminUsers.find(x => (x.uid || x.id) === uid);
            if (cached) cached.isChatBanned = newBannedState;
            // تحديث badge في كارت المستخدم
            const badgesEl = div.querySelector(".u-badges");
            if (badgesEl && newBannedState) {
              const s = document.createElement("span");
              s.className = "badge badge-chatban"; s.innerHTML = "<i class=\"fa-solid fa-ban\"></i> شات";
              badgesEl.appendChild(s);
            }
            // Admin لا يستطيع رفع الحظر — استبدال الزر بـ note
            if (newBannedState) {
              setTimeout(() => {
                chatBanBtn.replaceWith(buildChatBannedNote());
              }, 400);
            }
          });
        });
        actionsEl.appendChild(chatBanBtn);
      } else {
        actionsEl.appendChild(buildChatBannedNote());
      }

      function buildChatBannedNote() {
        const note = document.createElement("span");
        note.className = "chatban-locked-note";
        note.title = "فقط الأونر يستطيع رفع حظر الشات";
        note.innerHTML = `<i class="fa-solid fa-volume-xmark"></i> محظور الشات <span style="color:var(--muted);font-size:9px;">(الأونر فقط يرفع)</span>`;
        return note;
      }
    }

    list.appendChild(div);
  });
}

// Search filters
document.getElementById("adminSearchInput")?.addEventListener("input", e => {
  const q = e.target.value.trim();
  if (!q) { renderAdminUsers(_allAdminUsers); return; }
  const lower = q.toLowerCase();
  const isNumericId = /^\d{5,6}$/.test(q);
  renderAdminUsers(_allAdminUsers.filter(u =>
    (u.name||"").toLowerCase().includes(lower) ||
    (u.email||"").toLowerCase().includes(lower) ||
    (isNumericId && (u.publicId||"") === q)
  ));
});

document.getElementById("ownerSearchInput")?.addEventListener("input", e => {
  const q = e.target.value.trim();
  if (!q) { renderOwnerUsers(_allOwnerUsers); return; }
  const lower = q.toLowerCase();
  const isNumericId = /^\d{5,6}$/.test(q);
  renderOwnerUsers(_allOwnerUsers.filter(u =>
    (u.name||"").toLowerCase().includes(lower) ||
    (u.email||"").toLowerCase().includes(lower) ||
    (isNumericId && (u.publicId||"") === q)
  ));
});

/* ══════════════════════════════════════════
   SVG مرجعية — Owner / Admin / Verified
══════════════════════════════════════════ */
const _SVG_OWNER_CROWN = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 14l2-6 5 3.5L15 8l2 6H3z" fill="#060d1a" stroke="#060d1a" stroke-width="0.5" stroke-linejoin="round"/>
  <circle cx="3"  cy="8"  r="1.5" fill="#060d1a"/>
  <circle cx="10" cy="5"  r="1.5" fill="#060d1a"/>
  <circle cx="17" cy="8"  r="1.5" fill="#060d1a"/>
  <rect x="3" y="14.5" width="14" height="1.5" rx="0.75" fill="#060d1a"/>
</svg>`;

const _SVG_ADMIN_SHIELD = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 2L3 5v5c0 4 3.1 7.5 7 8.5 3.9-1 7-4.5 7-8.5V5L10 2z" fill="#fff" opacity="0.92"/>
  <path d="M7 10l2 2 4-4" stroke="#f97316" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/* ══════════════════════════════════════════
   BADGE BUILDERS
══════════════════════════════════════════ */

function _adminBadgeHTML() {
  return `<span class="badge-admin-icon" title="مشرف النظام">${_SVG_ADMIN_SHIELD}</span>`;
}

let _vbCounter = 0;
function _verifiedBadgeHTML(uid) {
  // عدّاد تصاعدي دائم يضمن تفرّد معرّف الـ mask دائمًا، حتى لو ظهرت شارة
  // نفس المستخدم في أكثر من مكان بالصفحة في نفس اللحظة (قائمة + هيدر + ...).
  // معرّفات mask غير فريدة تُفشل تطبيق القص فيسقط الـmask ويظهر الدائرة
  // الزرقاء ممتلئة بلا علامة صح — هذا هو الإصلاح المباشر لذلك.
  const _mid = "vbmask-" + (uid || "x") + "-" + (_vbCounter++);
  return `<svg class="badge-verified-icon" viewBox="0 0 40 40" aria-label="موثق" title="حساب موثق">
    <mask id="${_mid}">
      <path fill="#fff" d="M36.794,23.502 Q37.387,24.659 36.295,25.364 L34.082,26.794 Q32.990,27.500 32.925,28.798 L32.793,31.430 Q32.728,32.728 31.430,32.793 L28.798,32.925 Q27.500,32.990 26.794,34.082 L25.364,36.295 Q24.659,37.387 23.502,36.794 L21.157,35.593 Q20.000,35.000 18.843,35.593 L16.498,36.794 Q15.341,37.387 14.636,36.295 L13.206,34.082 Q12.500,32.990 11.202,32.925 L8.570,32.793 Q7.272,32.728 7.207,31.430 L7.075,28.798 Q7.010,27.500 5.918,26.794 L3.705,25.364 Q2.613,24.659 3.206,23.502 L4.407,21.157 Q5.000,20.000 4.407,18.843 L3.206,16.498 Q2.613,15.341 3.705,14.636 L5.918,13.206 Q7.010,12.500 7.075,11.202 L7.207,8.570 Q7.272,7.272 8.570,7.207 L11.202,7.075 Q12.500,7.010 13.206,5.918 L14.636,3.705 Q15.341,2.613 16.498,3.206 L18.843,4.407 Q20.000,5.000 21.157,4.407 L23.502,3.206 Q24.659,2.613 25.364,3.705 L26.794,5.918 Q27.500,7.010 28.798,7.075 L31.430,7.207 Q32.728,7.272 32.793,8.570 L32.925,11.202 Q32.990,12.500 34.082,13.206 L36.295,14.636 Q37.387,15.341 36.794,16.498 L35.593,18.843 Q35.000,20.000 35.593,21.157 L36.794,23.502 Z"/>
      <path d="M11.6,19.7 L17,25.5 L28.5,15.7" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="bevel"/>
    </mask>
    <path fill="#0866ff" mask="url(#${_mid})" d="M36.794,23.502 Q37.387,24.659 36.295,25.364 L34.082,26.794 Q32.990,27.500 32.925,28.798 L32.793,31.430 Q32.728,32.728 31.430,32.793 L28.798,32.925 Q27.500,32.990 26.794,34.082 L25.364,36.295 Q24.659,37.387 23.502,36.794 L21.157,35.593 Q20.000,35.000 18.843,35.593 L16.498,36.794 Q15.341,37.387 14.636,36.295 L13.206,34.082 Q12.500,32.990 11.202,32.925 L8.570,32.793 Q7.272,32.728 7.207,31.430 L7.075,28.798 Q7.010,27.500 5.918,26.794 L3.705,25.364 Q2.613,24.659 3.206,23.502 L4.407,21.157 Q5.000,20.000 4.407,18.843 L3.206,16.498 Q2.613,15.341 3.705,14.636 L5.918,13.206 Q7.010,12.500 7.075,11.202 L7.207,8.570 Q7.272,7.272 8.570,7.207 L11.202,7.075 Q12.500,7.010 13.206,5.918 L14.636,3.705 Q15.341,2.613 16.498,3.206 L18.843,4.407 Q20.000,5.000 21.157,4.407 L23.502,3.206 Q24.659,2.613 25.364,3.705 L26.794,5.918 Q27.500,7.010 28.798,7.075 L31.430,7.207 Q32.728,7.272 32.793,8.570 L32.925,11.202 Q32.990,12.500 34.082,13.206 L36.295,14.636 Q37.387,15.341 36.794,16.498 L35.593,18.843 Q35.000,20.000 35.593,21.157 L36.794,23.502 Z"/>
  </svg>`;
}

/* ══════════════════════════════════════════
   _buildBadgesHTML(user)
   ترتيب: [Owner|Admin] → [✓Verified]
   VERIFIED_OWNER_UID معرّف أعلاه عند CONFIG & INIT
══════════════════════════════════════════ */
function _buildBadgesHTML(user) {
  if (!user) return "";
  const uid         = user.uid || user.id || "";
  const role        = user.role || "user";
  const isOwnerUser = uid === OWNER_UID || uid === VERIFIED_OWNER_UID || role === "owner";
  const isAdminUser = role === "admin";
  const isVerified  = isOwnerUser;
  let html = "";

  // 1. Role badge — شارة المالك الذهبية اتشالت (كانت بتظهر مكررة جنب الشارة الزرقاء)
  if (isAdminUser && !isOwnerUser) html += _adminBadgeHTML();

  // 2. Verified
  if (isVerified) html += _verifiedBadgeHTML(uid);

  return html;
}

/* ── شارات مصغّرة (توثيق/أدمن فقط) — لقائمة الدردشات المضغوطة ──
   دالة إضافية معزولة تماماً، لا تُعدّل _buildBadgesHTML الأصلية، وتُعرَّض على
   window لأن js/dms-page.js يعمل كموديول (نطاق منفصل عن هذا السكربت). */
window._chatListBadgesHTML = function (user) {
  if (!user) return "";
  const uid         = user.uid || user.id || "";
  const role        = user.role || "user";
  const isOwnerUser = uid === OWNER_UID || uid === VERIFIED_OWNER_UID || role === "owner";
  const isAdminUser = role === "admin";
  const isVerified  = isOwnerUser;
  let html = "";
  if (isAdminUser && !isOwnerUser) html += _adminBadgeHTML();
  if (isVerified) html += _verifiedBadgeHTML(uid);
  return html;
};

/* ══════════════════════════════════════════
   renderUserDisplay(name, user, uid?)
   دالة مرنة — اسم + badges كاملة inline
══════════════════════════════════════════ */
function renderUserDisplay(name, user, uid) {
  if (uid && user && !user.uid && !user.id) user = { ...user, uid };
  const safeName = esc(name || user?.name || "مستخدم");
  const badges   = _buildBadgesHTML(user || {});
  return `<span class="user-display" dir="auto"><span class="user-display-name">${safeName}</span>${badges}</span>`;
}
window.renderUserDisplay = renderUserDisplay;

/* ══════════════════════════════════════════
   _startSelfListener(myUid)
   ↳ مراقبة بيانات المستخدم الحالي في realtime
   ↳ يكشف: isChatBanned, isBanned, name, photo, role
   ↳ يُحدّث كل UI فوراً بدون Refresh
══════════════════════════════════════════ */
let _selfListenerUnsub = null;

function _startSelfListener(myUid) {
  if (_selfListenerUnsub) { _selfListenerUnsub(); _selfListenerUnsub = null; }
  if (!myUid) return;

  let _prevSelfKey = null;
  _selfListenerUnsub = onSnapshot(doc(db, "users", myUid), snap => {
    if (!snap.exists()) return;
    const d = snap.data();

    // كشف حظر الحساب الكامل (isBanned) — يُسجّل الخروج فورياً
    if (d.isBanned && !_isVerifiedOwner(myUid)) {
      toast("⛔ تم حظر حسابك — تواصل مع الإدارة", "error");
      setTimeout(() => doLogout(), 1500);
      return;
    }

    const key = `${d.isChatBanned||false}_${d.name||""}_${d.photo||""}_${d.role||"user"}_${d.publicId||""}`;
    if (_prevSelfKey === key) return;
    _prevSelfKey = key;

    // حظر الشات — تحديث realtime
    const newChatBanned = d.isChatBanned || false;
    if (typeof _isChatBanned !== "undefined" && newChatBanned !== _isChatBanned) {
      _isChatBanned = newChatBanned;
      updateChatBannedState();
      if (newChatBanned) toast("⛔ تم حظرك من إرسال الرسائل", "error");
      else toast("✅ تم رفع حظر الشات عنك", "success");
    }

    // تحديث بيانات المستخدم الحالي
    if (window._currentUserData) Object.assign(window._currentUserData, d);
    currentName  = d.name  || currentName;
    currentPhoto = d.photo || currentPhoto;
    currentRole  = d.role  || currentRole;

    // تحديث الـ cache
    _userCache[myUid] = { data: { ...(_userCache[myUid]?.data || {}), ...d, uid: myUid }, ts: Date.now() };

    // تحديث UI
    document.getElementById("welcomeText").innerHTML =
      renderUserDisplay(d.name || currentName, d, myUid);
    document.getElementById("profileName").innerHTML =
      renderUserDisplay(d.name || currentName, d, myUid);
    if (d.bio !== undefined)
      document.getElementById("profileBioText").textContent = d.bio || "";
    if (d.photo) setAvatarUI(d.photo, true, d.gender);
    else if (d.gender) setAvatarUI(_defaultAvatarHTML(d.gender, 96), null, d.gender);

    // تحديث publicId في البروفايل
    if (d.publicId) {
      const pubIdEl = document.getElementById("profilePublicId");
      if (pubIdEl) pubIdEl.textContent = d.publicId;
    }

    _syncBioCards(d);

    // Role badge
    const badgeEl    = document.getElementById("roleBadgeTop");
    const badgeClass = { owner:"owner", admin:"admin", user:"user" }[d.role] || "user";
    const badgeText  = { owner:"<i class=\"fa-solid fa-crown\"></i> Owner", admin:"<i class=\"fa-solid fa-gear\"></i> Admin", user:"<i class=\"fa-solid fa-circle-user\"></i> User" }[d.role] || "User";
    if (badgeEl) badgeEl.innerHTML = `<span class="role-badge ${badgeClass}">${badgeText}</span>`;

    // Owner/Admin buttons
    document.getElementById("ownerBtn").style.display = (d.role === "owner") ? "inline-block" : "none";
    document.getElementById("adminBtn").style.display = (d.role === "admin") ? "inline-block" : "none";

    // تحديث كل رسائل المستخدم الحالي في الشات
    document.querySelectorAll(`.msg-sender-name[data-sender-uid="${myUid}"]`).forEach(el => {
      el.innerHTML = renderUserDisplay(d.name || "", d, myUid);
    });
  }, err => {
    if (err.code !== "permission-denied") console.warn("selfListener:", err.code);
  });
}

/* ══════════════════════════════════════════
   ⚡ ROOMS SYSTEM
   ✓ Owner creates rooms (stored in Firestore)
   ✓ All users see rooms realtime
   ✓ Each room has its own messages subcollection
   ✓ Discord-style room switching
══════════════════════════════════════════ */
let _selectedRoomIcon = "💬";

// Create Room (Owner only)
async function createRoom() {
  if (!isOwner()) { toast("المالك فقط يستطيع إنشاء الغرف", "error"); return; }

  const worldId = window.activeWorldContext?.();
  if (!worldId || typeof window.isValidWorldId !== "function" || !window.isValidWorldId(worldId)) {
    toast("لا يوجد عالم نشط حاليًا — اختر عالمًا أولًا", "error");
    return;
  }

  const name = document.getElementById("oRoomName")?.value.trim();
  if (!name) { toast("اكتب اسم الغرفة أولاً", "error"); return; }
  if (name.length > 40) { toast("اسم الغرفة طويل جداً (40 حرف كحد أقصى)", "error"); return; }

  const btn = document.getElementById("oCreateRoomBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-hourglass-half fa-spin"></i> جاري الإنشاء...'; }

  try {
    await addDoc(collection(db, "rooms"), {
      name,
      icon:        _selectedRoomIcon,
      description: "",
      createdBy:   currentUser.uid,
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp(),
      worldId
    });
    // ── Audit Log ──
    await writeAuditLog(
      AUDIT_ACTIONS.CREATE_ROOM,
      { roomName: name, icon: _selectedRoomIcon || '💬' }
    );

    toast(`✦ تم إنشاء غرفة "${name}"`, "success");
    document.getElementById("oRoomName").value = "";
    // Reset icon selection
    _selectedRoomIcon = "💬";
    document.querySelectorAll(".room-icon-btn").forEach((b, i) => b.classList.toggle("sel", i === 0));
  } catch(e) {
    toast("فشل إنشاء الغرفة: " + (e.code || e.message), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus"></i> إنشاء الغرفة'; }
  }
}

window.selectRoomIcon = function(btn) {
  document.querySelectorAll(".room-icon-btn").forEach(b => b.classList.remove("sel"));
  btn.classList.add("sel");
  _selectedRoomIcon = btn.dataset.icon;
};

document.getElementById("oCreateRoomBtn")?.addEventListener("click", createRoom);

/* ── لوحة المالك: قائمة الغرف الحالية + حذف الغرفة ──
   المصدر: window._dmsGetRooms (مستمع الغرف في js/dms-page.js) — بدون مستمع إضافي ── */
function renderOwnerRoomsList() {
  const el = document.getElementById("oRoomsList");
  if (!el) return;
  el.innerHTML = "";
  if (!isOwner()) return;
  const rooms = window._dmsGetRooms?.() || [];
  if (!rooms.length) {
    el.innerHTML = `<div style="padding:12px 4px;color:var(--muted);font-size:12px;">لا توجد غرف بعد</div>`;
    return;
  }
  rooms.forEach(room => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;border:1px solid var(--border);border-radius:10px;";
    row.innerHTML = `<span style="font-size:18px;">${esc(room.icon || "💬")}</span><span style="flex:1;min-width:0;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(room.name)}</span>`;
      const delBtn = document.createElement("button");
      delBtn.className = "room-del-btn";
      delBtn.title = "حذف الغرفة";
      delBtn.style.cssText = "background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:7px;color:rgba(239,68,68,.7);cursor:pointer;font-size:12px;padding:5px 8px;flex-shrink:0;transition:all .15s;margin-right:4px;";
      delBtn.innerHTML = `<i class="fa-solid fa-trash"></i>`;
      delBtn.onmouseover = () => { delBtn.style.background = "rgba(239,68,68,.22)"; delBtn.style.color = "#fca5a5"; };
      delBtn.onmouseout = () => { delBtn.style.background = "rgba(239,68,68,.1)"; delBtn.style.color = "rgba(239,68,68,.7)"; };
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        const ok = await confirm("حذف الغرفة", `هل تريد حذف غرفة "${esc(room.name)}"؟ لا يمكن التراجع.`);
        if (!ok) return;
        try {
          await deleteDoc(doc(db, "rooms", room.id));

          // ── Audit Log ──
          await writeAuditLog(
            AUDIT_ACTIONS.DELETE_ROOM,
            { roomName: room.name, roomId: room.id }
          );

          toast("تم حذف الغرفة");
          if (_currentChatId === `room:${room.id}`) selectChat("public");
        } catch(e) { toast("فشل الحذف", "error"); }
      };
    row.appendChild(delBtn);
    el.appendChild(row);
  });
}
window._dmsRoomsChanged = renderOwnerRoomsList;

// نهاية الجلسة بدون إعادة تحميل (خروج/تبديل حساب): أغلق مستمعات الدردشة المرتبطة بالحساب
// (كانت تُغلق في doLogout فقط، وهو يعيد تحميل الصفحة)
window._chatSessionListenersStop = function () {
  window._cleanupPollListeners?.();
  // مستمعات ومؤقتات أخرى تخص الحساب السابق (كانت تُغلق في doLogout فقط)؛ كلها تُعاد عند الدخول التالي:
  if (_selfListenerUnsub) { try { _selfListenerUnsub(); } catch(e) {} _selfListenerUnsub = null; } // users/<أنا>
  if (_fcmNotifsUnsub)    { try { _fcmNotifsUnsub(); } catch(e) {} _fcmNotifsUnsub = null; }       // fcmNotifications
  window.qnStopListening?.();            // quickNotifications (عالم + عام)
  window._stopChatListener?.();          // رسائل/تفاعلات المحادثة المفتوحة
};

/* ══ Sync iOS Bio Cards ══ */
function _syncBioCards(d) {
  const _s = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || "—"; };
  _s("bioCardBio",   d.bio   || "لا توجد نبذة بعد...");
  _s("bioCardId",    d.publicId || document.getElementById("profilePublicId")?.textContent || "—");
  _s("bioCardEmail", typeof displayEmail === "function" ? displayEmail(d.email || "") : (d.email || "—"));
  const roleMap = { owner:"👑 أونر", admin:"⚙️ أدمن", user:"👤 مستخدم" };
  _s("bioCardRole", roleMap[d.role] || "—");
  const gRow = document.getElementById("bioCardGenderRow");
  if (d.gender && gRow) {
    gRow.style.display = "flex";
    _s("bioCardGender", d.gender === "female" ? "♀ طالبة" : "♂ طالب");
  }

  /* ── Sync new section elements ── */
  const roleLabels2 = { owner:"👑 أونر (Super Admin)", admin:"⚙️ أدمن", user:"👤 مستخدم" };
  _s("profSecPublicId", d.publicId || "—");
  _s("profSecRole",     roleLabels2[d.role] || "—");
  _s("profSecEmail",    typeof displayEmail === "function" ? displayEmail(d.email || "") : (d.email || "—"));
  _s("profSecBio",      d.bio || "لا توجد نبذة");
  /* Gender row in identity section */
  const gRow2 = document.getElementById("profSecGenderRow");
  if (gRow2 && d.gender) {
    gRow2.style.display = "flex";
    _s("profSecGender", d.gender === "female" ? "♀ طالبة" : "♂ طالب");
  }
}

/* ══ Profile Section Toggle ══ */
window.toggleProfSection = function(id) {
  const panel = document.getElementById(id);
  const chevId = "chev-" + id;
  const chev   = document.getElementById(chevId);
  if (!panel) return;
  const isOpen = panel.classList.contains("open");
  /* Close all */
  document.querySelectorAll(".prof-section-panel.open").forEach(p => {
    p.classList.remove("open");
  });
  document.querySelectorAll(".prof-section-chevron.open").forEach(c => {
    c.classList.remove("open");
  });
  /* Open clicked (if it was closed) */
  if (!isOpen) {
    panel.classList.add("open");
    if (chev) chev.classList.add("open");
  }
};

/* ══ اختصار: تعيين صورة — يفتح الاستديو (منتقي الصور) مباشرة، بدون المرور بالإعدادات ══ */
window.openPhotoUploadDirect = function() {
  const inp = document.getElementById("imageInput");
  if (inp) inp.click();
};

/* ══ اختصار: تعديل البيانات — يفتح الإعدادات على تبويب "حسابي" وقسم تعديل البيانات مباشرة ══ */
window.openEditDataDirect = function() {
  if (typeof openSettingsModal === "function") openSettingsModal();
  setTimeout(() => {
    if (typeof switchSettingsTab === "function") switchSettingsTab("account");
    setTimeout(() => {
      const panel = document.getElementById("sec-edit");
      const chev  = document.getElementById("chev-sec-edit");
      if (panel && !panel.classList.contains("open")) {
        document.querySelectorAll(".prof-section-panel.open").forEach(p => p.classList.remove("open"));
        document.querySelectorAll(".prof-section-chevron.open").forEach(c => c.classList.remove("open"));
        panel.classList.add("open");
        if (chev) chev.classList.add("open");
      }
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("editName")?.focus();
    }, 150);
  }, 80);
};

/* ══════════════════════════════════════════
   بطاقة معلومات البروفايل — البريد / النبذة / UID / تاريخ الانضمام
══════════════════════════════════════════ */
function _fmtJoinDate(ts, fallbackStr) {
  try {
    let d = null;
    if (ts?.toDate) d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    if (!d && fallbackStr) {
      const fd = new Date(fallbackStr);
      if (!isNaN(fd.getTime())) d = fd;
    }
    if (!d || isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
  } catch(e) { return "—"; }
}

function _fillProfInfoCard(userData, user, email, bio) {
  const emailEl = document.getElementById("profInfoEmailVal");
  const bioEl   = document.getElementById("profInfoBioVal");
  const uidEl   = document.getElementById("profInfoUidVal");
  const joinEl  = document.getElementById("profInfoJoinVal");

  if (emailEl) {
    emailEl.textContent = email || "—";
    emailEl.classList.toggle("empty", !email);
  }
  if (bioEl) {
    bioEl.textContent = bio || "لا توجد نبذة";
    bioEl.classList.toggle("empty", !bio);
  }
  if (uidEl) {
    uidEl.textContent = userData?.publicId || "—";
  }
  if (joinEl) {
    // أولوية لتاريخ الانضمام المخزّن في Firestore، وإن لم يوجد (حسابات قديمة)
    // نستخدم تاريخ إنشاء الحساب المسجّل أصلاً داخل Firebase Auth نفسه — متوفر دائماً.
    joinEl.textContent = _fmtJoinDate(userData?.createdAt, user?.metadata?.creationTime);
  }
}

/* ── الضغط المطوّل على عناصر بطاقة المعلومات: قائمة (نسخ / تعديل) ── */
let _picLongPressTimer = null;
let _picActiveField = null;

function _picGetItemValue(field) {
  const map = { email: "profInfoEmailVal", bio: "profInfoBioVal", uid: "profInfoUidVal", joined: "profInfoJoinVal" };
  const el = document.getElementById(map[field]);
  return el ? el.textContent.trim() : "";
}

function _openPicCtxMenu(field, x, y) {
  _picActiveField = field;
  const menu = document.getElementById("picCtxMenu");
  const backdrop = document.getElementById("picCtxBackdrop");
  const editBtn = document.getElementById("picCtxEditBtn");
  if (!menu) return;

  // فقط النبذة قابلة للتعديل من هنا — البريد وUID وتاريخ الانضمام ثابتة/للنسخ فقط
  const editable = field === "bio";
  if (editBtn) editBtn.hidden = !editable;

  menu.style.top  = Math.min(y, window.innerHeight - 110) + "px";
  menu.style.left = Math.min(Math.max(x - 70, 10), window.innerWidth - 150) + "px";
  menu.classList.add("show");
  if (backdrop) backdrop.classList.add("show");
  if (navigator.vibrate) navigator.vibrate(15);
}

window._closePicCtxMenu = function() {
  document.getElementById("picCtxMenu")?.classList.remove("show");
  document.getElementById("picCtxBackdrop")?.classList.remove("show");
};

window._picCtxCopy = async function() {
  const val = _picGetItemValue(_picActiveField);
  window._closePicCtxMenu();
  if (!val) return;
  try {
    await navigator.clipboard.writeText(val);
    toast("تم النسخ");
  } catch(e) {
    toast("تعذر النسخ", "error");
  }
};

window._picCtxEdit = async function() {
  const field = _picActiveField;
  window._closePicCtxMenu();
  if (field === "bio") {
    const current = _picGetItemValue("bio");
    const val = prompt("تعديل النبذة:", current === "لا توجد نبذة" ? "" : current);
    if (val === null) return;
    const trimmed = val.trim();
    try {
      await updateDoc(doc(db, "users", currentUser.uid), { bio: trimmed });
      const _aaOldBio2 = current === "لا توجد نبذة" ? "" : current;
      if (trimmed !== _aaOldBio2) window.AccountArchive?.log(currentUser.uid, "bio", _aaOldBio2, trimmed);
      const bioEl = document.getElementById("profInfoBioVal");
      if (bioEl) { bioEl.textContent = trimmed || "لا توجد نبذة"; bioEl.classList.toggle("empty", !trimmed); }
      const editBioInp = document.getElementById("editBio");
      if (editBioInp) editBioInp.value = trimmed;
      document.getElementById("profileBioText").textContent = trimmed;
      if (window._currentUserData) window._currentUserData.bio = trimmed;
      toast("تم تحديث النبذة");
    } catch(e) { toast("فشل تحديث النبذة", "error"); }
  } else {
    toast("هذا الحقل غير قابل للتعديل", "warn");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const items = document.querySelectorAll("#profInfoCard .pic-item");
  items.forEach(item => {
    const field = item.dataset.field;
    const start = (e) => {
      const point = e.touches ? e.touches[0] : e;
      const x = point.clientX, y = point.clientY;
      item.classList.add("pressing");
      _picLongPressTimer = setTimeout(() => {
        item.classList.remove("pressing");
        _openPicCtxMenu(field, x, y);
      }, 480);
    };
    const cancel = () => {
      item.classList.remove("pressing");
      clearTimeout(_picLongPressTimer);
    };
    item.addEventListener("touchstart", start, { passive: true });
    item.addEventListener("touchend", cancel);
    item.addEventListener("touchmove", cancel);
    item.addEventListener("touchcancel", cancel);
    item.addEventListener("mousedown", start);
    item.addEventListener("mouseup", cancel);
    item.addEventListener("mouseleave", cancel);
  });
});

function esc(str) {
  return String(str ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
window.esc = esc;

/* ══════════════════════════════════════════
   ██████╗ ██████╗  ██████╗ ███████╗██╗██╗     ███████╗
   ██╔══██╗██╔══██╗██╔═══██╗██╔════╝██║██║     ██╔════╝
   ██████╔╝██████╔╝██║   ██║█████╗  ██║██║     █████╗
   ██╔═══╝ ██╔══██╗██║   ██║██╔══╝  ██║██║     ██╔══╝
   ██║     ██║  ██║╚██████╔╝██║     ██║███████╗███████╗
   ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝╚══════╝

   VISIT SYSTEM — نظام زيارة البروفايل المتكامل
   ✓ Context Menu  (UCM)
   ✓ Profile Modal (PVM) — بيانات كاملة
   ✓ Cache-First — لا قراءة Firebase زائدة
   ✓ يعمل من: الشات العام / قائمة الأعضاء / DM Sidebar
══════════════════════════════════════════ */

// ══════════════════════════════════════════
// UCM — User Context Menu
// ══════════════════════════════════════════
let _ucmUid      = null;
let _ucmUserData = null;
let _ucmVisible  = false;

/**
 * إظهار قائمة السياق بجانب نقطة النقر
 * @param {string} uid       - UID المستخدم المستهدف
 * @param {number} x         - موضع X للنقر
 * @param {number} y         - موضع Y للنقر
 * @param {object} [userData]- بيانات المستخدم (اختياري، للتسريع)
 */
function _showUserContextMenu(uid, x, y, userData) {
  if (!uid) return;
  // لا نُظهر القائمة إذا كان الهدف هو المستخدم الحالي
  if (uid === currentUser?.uid) return;

  _ucmUid      = uid;
  _ucmUserData = userData || null;
  _ucmVisible  = true;

  const menu = document.getElementById("userContextMenu");
  if (!menu) return;

  // ── تعديل عنوان القائمة بحسب الـ cache ──
  const cached = _userCache[uid];
  const uName  = (cached?.data || cached)?.name || (userData?.name) || "مستخدم";
  const firstItem = menu.querySelector(".ucm-item:first-child span.ucm-uname");
  if (firstItem) firstItem.textContent = uName;

  // ── حساب موضع القائمة ──
  const mw = 200, mh = 140;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = x, top = y;
  if (left + mw > vw - 8) left = vw - mw - 8;
  if (top  + mh > vh - 8) top  = vh - mh - 8;
  if (left < 8) left = 8;
  if (top  < 8) top  = 8;

  menu.style.left = left + "px";
  menu.style.top  = top  + "px";
  menu.classList.add("show");

  // تمييز بصري خفيف جداً للعضو المحدَّد حتى إغلاق القائمة
  document.querySelectorAll(".dmex-highlighted").forEach(el => el.classList.remove("dmex-highlighted"));
  document.getElementById(`dms-member-${uid}`)?.classList.add("dmex-highlighted");
}

function _hideUserContextMenu() {
  _ucmVisible  = false;
  _ucmUid      = null;
  _ucmUserData = null;
  document.getElementById("userContextMenu")?.classList.remove("show");
  document.querySelectorAll(".dmex-highlighted").forEach(el => el.classList.remove("dmex-highlighted"));
}

// ── Context Menu — أحداث الأزرار ──
document.getElementById("ucmVisitProfile")?.addEventListener("click", () => {
  const uid  = _ucmUid;
  const data = _ucmUserData;
  _hideUserContextMenu();
  if (uid) openProfileViewModal(uid, data);
});

document.getElementById("ucmSendMsg")?.addEventListener("click", () => {
  const uid  = _ucmUid;
  const data = _ucmUserData;
  _hideUserContextMenu();
  if (!uid) return;
  // إذا كان الشات غير مفتوح نفتحه (بدون تشغيل الشات العام)
  if (!document.getElementById("page-chat")?.classList.contains("active")) {
    showPage("page-chat");
  }
  openDirectChat(uid, data);
});

document.getElementById("ucmCopyId")?.addEventListener("click", async () => {
  const uid = _ucmUid;
  _hideUserContextMenu();
  if (!uid) return;

  // ضمان وجود publicId — ينشئه إن لم يكن موجوداً
  const idToCopy = await _ensurePublicId(uid);
  if (!idToCopy) { toast("تعذّر الحصول على المعرف", "error"); return; }

  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = idToCopy; ta.style.position = "fixed";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
    toast("✓ تم نسخ المعرف " + idToCopy, "success");
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(idToCopy)
      .then(() => toast("✓ تم نسخ المعرف " + idToCopy, "success"))
      .catch(fallback);
  } else { fallback(); }
});

/* ── نسخ معرف المستخدم الحالي من البروفايل ── */
window.copyMyPublicId = async function() {
  let publicId = window._currentUserData?.publicId || "";
  // ضمان وجود publicId — ينشئه تلقائياً إن لم يكن موجوداً
  if (!publicId && currentUser?.uid) {
    publicId = await _ensurePublicId(currentUser.uid);
    // تحديث واجهة المستخدم بالمعرف الجديد
    if (publicId) {
      if (window._currentUserData) window._currentUserData.publicId = publicId;
      const pubIdEl = document.getElementById("profilePublicId");
      if (pubIdEl) pubIdEl.textContent = publicId;
    }
  }
  if (!publicId) { toast("تعذّر إنشاء المعرف، حاول مجدداً", "error"); return; }
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = publicId; ta.style.position = "fixed";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
    toast("✓ تم نسخ معرفك: " + publicId, "success");
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(publicId)
      .then(() => toast("✓ تم نسخ معرفك: " + publicId, "success"))
      .catch(fallback);
  } else { fallback(); }
};

// ── إغلاق القائمة عند النقر خارجها ──
document.addEventListener("click", (e) => {
  if (_ucmVisible && !e.target.closest("#userContextMenu")) {
    _hideUserContextMenu();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && _ucmVisible) _hideUserContextMenu();
});

// ══════════════════════════════════════════
// EVENT DELEGATION — Chat Messages
// الضغط على اسم المرسل أو صورته في الشات
// ══════════════════════════════════════════
document.addEventListener("click", (e) => {
  if (_ucmVisible && !e.target.closest("#userContextMenu")) return; // يُعالَج أعلاه

  // اسم المرسل في رسائل الشات
  const senderName = e.target.closest(".msg-sender-name[data-sender-uid]");
  if (senderName) {
    const uid = senderName.dataset.senderUid;
    if (uid && uid !== currentUser?.uid) {
      e.stopPropagation();
      const cached = _userCache[uid];
      _showUserContextMenu(uid, e.clientX, e.clientY, cached?.data || cached);
      return;
    }
  }

  // صورة المرسل في رسائل الشات
  const avatarSm = e.target.closest(".msg-avatar-sm[data-avatar-uid]");
  if (avatarSm) {
    const uid = avatarSm.dataset.avatarUid;
    if (uid && uid !== currentUser?.uid) {
      e.stopPropagation();
      const cached = _userCache[uid];
      _showUserContextMenu(uid, e.clientX, e.clientY, cached?.data || cached);
      return;
    }
  }
}, true); // capture phase لضمان الأسبقية

// ══════════════════════════════════════════
// openProfileViewModal(uid, [preloadedData])
// الدالة الرئيسية — تفتح Modal البروفايل
// ══════════════════════════════════════════
window.openProfileViewModal = async function(uid, preloadedData) {
  if (!uid) return;

  const modal = document.getElementById("profileViewModal");
  const cont  = document.getElementById("pvmContent");
  if (!modal || !cont) return;

  // إظهار Modal مع spinner
  cont.innerHTML = `
    <div class="pvm-loading">
      <div class="spinner"></div>
      <span>جارٍ تحميل البروفايل…</span>
    </div>
  `;
  modal.classList.add("show");

  // ── دائماً اقرأ من Firestore للحصول على بيانات البروفايل الحديثة ──
  let userData = null;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      userData = { ...snap.data(), uid };
      // حدّث الـ cache بالبيانات الطازجة
      _userCache[uid] = { data: userData, ts: Date.now() };
    }
  } catch(e) {
    // fallback للـ cache إذا فشلت القراءة
    const cached = _userCache[uid];
    if (cached && (Date.now() - (cached.ts || 0) < CACHE_TTL_MS)) {
      userData = cached.data || cached;
    } else if (preloadedData) {
      userData = { ...preloadedData, uid };
      _userCache[uid] = { data: userData, ts: Date.now() };
    } else {
      userData = await _getUser(uid);
    }
  }

  if (!userData) {
    cont.innerHTML = `
      <div class="pvm-loading" style="padding:50px 20px;">
        <i class="fa-solid fa-circle-exclamation" style="font-size:36px;color:var(--danger);"></i>
        <span>لم يُعثَر على هذا المستخدم</span>
      </div>
    `;
    return;
  }

  // ── ضمان وجود publicId قبل العرض ──
  if (!userData.publicId) {
    const newPid = await _ensurePublicId(uid);
    if (newPid) userData = { ...userData, publicId: newPid };
  }

  _renderProfileViewModal(uid, { ...userData, uid });
};

// ══════════════════════════════════════════
// _renderProfileViewModal(uid, userData)
// بناء محتوى Modal الكامل
// ══════════════════════════════════════════
function _renderProfileViewModal(uid, userData) {
  const cont = document.getElementById("pvmContent");
  if (!cont) return;

  const d = userData;
  const isSelf    = uid === currentUser?.uid;
  const isOwnerU  = uid === OWNER_UID || uid === VERIFIED_OWNER_UID || d.role === "owner";
  const isAdminU  = d.role === "admin";
  const isMod     = d.role === "moderator";
  const isVerif   = isOwnerU || d.isVerified;

  // ── الصورة ──
  let avatarHTML;
  if (d.photo) {
    avatarHTML = `<img src="${esc(d.photo)}" alt="${esc(d.name||"")}">`;
  } else {
    avatarHTML = _defaultAvatarHTML(d.gender, 104);
  }
  const genderClass = d.gender === "female" ? "g-female" : d.gender === "male" ? "g-male" : "g-none";

  // ── شارة الدور ──
  let roleBadge = "";
  if (isOwnerU) {
    roleBadge = `<span class="pvm-rbadge owner"><i class="fa-solid fa-crown"></i> Owner</span>`;
  } else if (isAdminU) {
    roleBadge = `<span class="pvm-rbadge admin"><i class="fa-solid fa-shield-halved"></i> Admin</span>`;
  } else if (isMod) {
    roleBadge = `<span class="pvm-rbadge mod"><i class="fa-solid fa-star"></i> Moderator</span>`;
  } else {
    roleBadge = `<span class="pvm-rbadge user"><i class="fa-solid fa-circle-user"></i> Member</span>`;
  }

  // ── شارة التوثيق ──
  const _pvmVbMid = "pvm-vbmask-" + (uid || "x") + "-" + (_vbCounter++);
  const verifBadge = isVerif
    ? `<span class="pvm-rbadge veri" style="display:inline;white-space:nowrap;">
        موثق
        <span style="display:inline-block;vertical-align:middle;width:16px;height:16px;margin-inline-start:4px;">
          <svg viewBox="0 0 40 40" width="16" height="16">
            <mask id="${_pvmVbMid}">
              <path fill="#fff" d="M36.794,23.502 Q37.387,24.659 36.295,25.364 L34.082,26.794 Q32.990,27.500 32.925,28.798 L32.793,31.430 Q32.728,32.728 31.430,32.793 L28.798,32.925 Q27.500,32.990 26.794,34.082 L25.364,36.295 Q24.659,37.387 23.502,36.794 L21.157,35.593 Q20.000,35.000 18.843,35.593 L16.498,36.794 Q15.341,37.387 14.636,36.295 L13.206,34.082 Q12.500,32.990 11.202,32.925 L8.570,32.793 Q7.272,32.728 7.207,31.430 L7.075,28.798 Q7.010,27.500 5.918,26.794 L3.705,25.364 Q2.613,24.659 3.206,23.502 L4.407,21.157 Q5.000,20.000 4.407,18.843 L3.206,16.498 Q2.613,15.341 3.705,14.636 L5.918,13.206 Q7.010,12.500 7.075,11.202 L7.207,8.570 Q7.272,7.272 8.570,7.207 L11.202,7.075 Q12.500,7.010 13.206,5.918 L14.636,3.705 Q15.341,2.613 16.498,3.206 L18.843,4.407 Q20.000,5.000 21.157,4.407 L23.502,3.206 Q24.659,2.613 25.364,3.705 L26.794,5.918 Q27.500,7.010 28.798,7.075 L31.430,7.207 Q32.728,7.272 32.793,8.570 L32.925,11.202 Q32.990,12.500 34.082,13.206 L36.295,14.636 Q37.387,15.341 36.794,16.498 L35.593,18.843 Q35.000,20.000 35.593,21.157 L36.794,23.502 Z"/>
              <path d="M11.6,19.7 L17,25.5 L28.5,15.7" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="bevel"/>
            </mask>
            <path fill="#0866ff" mask="url(#${_pvmVbMid})" d="M36.794,23.502 Q37.387,24.659 36.295,25.364 L34.082,26.794 Q32.990,27.500 32.925,28.798 L32.793,31.430 Q32.728,32.728 31.430,32.793 L28.798,32.925 Q27.500,32.990 26.794,34.082 L25.364,36.295 Q24.659,37.387 23.502,36.794 L21.157,35.593 Q20.000,35.000 18.843,35.593 L16.498,36.794 Q15.341,37.387 14.636,36.295 L13.206,34.082 Q12.500,32.990 11.202,32.925 L8.570,32.793 Q7.272,32.728 7.207,31.430 L7.075,28.798 Q7.010,27.500 5.918,26.794 L3.705,25.364 Q2.613,24.659 3.206,23.502 L4.407,21.157 Q5.000,20.000 4.407,18.843 L3.206,16.498 Q2.613,15.341 3.705,14.636 L5.918,13.206 Q7.010,12.500 7.075,11.202 L7.207,8.570 Q7.272,7.272 8.570,7.207 L11.202,7.075 Q12.500,7.010 13.206,5.918 L14.636,3.705 Q15.341,2.613 16.498,3.206 L18.843,4.407 Q20.000,5.000 21.157,4.407 L23.502,3.206 Q24.659,2.613 25.364,3.705 L26.794,5.918 Q27.500,7.010 28.798,7.075 L31.430,7.207 Q32.728,7.272 32.793,8.570 L32.925,11.202 Q32.990,12.500 34.082,13.206 L36.295,14.636 Q37.387,15.341 36.794,16.498 L35.593,18.843 Q35.000,20.000 35.593,21.157 L36.794,23.502 Z"/>
          </svg>
        </span>
      </span>` : "";

  // ── تاريخ الانضمام ──
  let joinDate = "—";
  if (d.createdAt) {
    try {
      const ts = d.createdAt?.toDate ? d.createdAt.toDate() : new Date(d.createdAt);
      joinDate = ts.toLocaleDateString("ar-EG", { day:"numeric", month:"long", year:"numeric" });
    } catch(_) { joinDate = "—"; }
  }

  // ── أزرار الإجراءات ──
  let actionBtns = "";
  if (!isSelf) {
    actionBtns = `
      <button class="pvm-act gold" id="pvmMsgBtn">
        <i class="fa-solid fa-paper-plane"></i> إرسال رسالة
      </button>
      <button class="pvm-act" id="pvmCopyBtn" title="نسخ المعرف">
        <i class="fa-solid fa-fingerprint"></i> نسخ المعرف
      </button>
      ${window.isOwner && window.isOwner() ? `<button class="pvm-act" id="pvmArchiveBtn" title="أرشيف الحساب"><i class="fa-solid fa-clock-rotate-left"></i> أرشيف الحساب</button>` : ""}
      <button class="pvm-act" id="pvmReportBtn" style="background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.25);color:#fca5a5;">
        <i class="fa-solid fa-flag"></i> تبليغ
      </button>
    `;
  } else {
    actionBtns = `
      <button class="pvm-act gold" onclick="document.getElementById('profileViewModal').classList.remove('show')">
        <i class="fa-solid fa-check"></i> هذا أنت!
      </button>
    `;
  }

  // ── بناء HTML الكامل ──
  cont.innerHTML = `
    <!-- Hero -->
    <div class="pvm-hero">
      <div class="pvm-avatar-wrap">
        <div class="pvm-avatar ${genderClass}">${avatarHTML}</div>
      </div>
      <div class="pvm-name-row">
        <div class="pvm-name">${renderUserDisplay(d.name || "مستخدم", d, uid)}</div>
        ${d.bio ? `<div class="pvm-bio">${esc(d.bio)}</div>` : ""}
      </div>
      <div class="pvm-badge-row">
        ${roleBadge}
        ${verifBadge}
      </div>
    </div>

    <!-- Stats -->
    <div class="pvm-stats">
      <div class="pvm-stat-row">
        <span class="pvm-stat-lbl"><i class="fa-solid fa-fingerprint"></i> المعرف</span>
        <span class="pvm-stat-val" style="font-size:17px;font-weight:800;color:var(--gold);letter-spacing:.5px;">${d.publicId || '—'}</span>
      </div>
      <div class="pvm-stat-row">
        <span class="pvm-stat-lbl"><i class="fa-solid fa-calendar-plus"></i> تاريخ الانضمام</span>
        <span class="pvm-stat-val" style="font-size:12px">${joinDate}</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="pvm-actions">${actionBtns}</div>
  `;

  // ── ربط أحداث الأزرار ──
  document.getElementById("pvmMsgBtn")?.addEventListener("click", () => {
    document.getElementById("profileViewModal").classList.remove("show");
    if (!document.getElementById("page-chat")?.classList.contains("active")) {
      showPage("page-chat");
    }
    openDirectChat(uid, d);
  });

  document.getElementById("pvmCopyBtn")?.addEventListener("click", async () => {
    // ضمان وجود publicId — ينشئه إن لم يكن موجوداً
    const idToCopy = d.publicId || await _ensurePublicId(uid);
    if (!idToCopy) { toast("تعذّر الحصول على المعرف", "error"); return; }
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = idToCopy; ta.style.position = "fixed";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
      toast("✓ تم نسخ المعرف " + idToCopy, "success");
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(idToCopy)
        .then(() => toast("✓ تم نسخ المعرف " + idToCopy, "success"))
        .catch(fallback);
    } else { fallback(); }
  });

  document.getElementById("pvmArchiveBtn")?.addEventListener("click", () => {
    window.AccountArchive?.open(uid, d.name);
  });

  document.getElementById("pvmReportBtn")?.addEventListener("click", () => {
    document.getElementById("profileViewModal").classList.remove("show");
    window.openReportModal({ type: "user", targetUid: uid, targetName: d.name || "مستخدم" });
  });
}

// ══════════════════════════════════════════
// إغلاق Modal البروفايل
// ══════════════════════════════════════════
document.getElementById("pvmCloseBtn")?.addEventListener("click", () => {
  document.getElementById("profileViewModal")?.classList.remove("show");
});
document.getElementById("profileViewModal")?.addEventListener("click", (e) => {
  if (e.target === document.getElementById("profileViewModal")) {
    e.currentTarget.classList.remove("show");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.getElementById("profileViewModal")?.classList.remove("show");
  }
});

// ══════════════════════════════════════════
// Expose globally
// ══════════════════════════════════════════
window._showUserContextMenu  = _showUserContextMenu;
window._hideUserContextMenu  = _hideUserContextMenu;

/* Firestore Security Rules v5.2 reference: see docs/firestore-rules-reference.txt */

/* ══════════════════════════════════════════
   REPLY SYSTEM + CONTEXT MENU + CHAT BACKGROUNDS
══════════════════════════════════════════ */

// ── Reply State ──
let _replyData = null; // { docId, name, text, image, audio, pdf, file }
Object.defineProperty(window, '_replyData', { get: () => _replyData, set: (v) => { _replyData = v; }, configurable: true }); // ← bridge: محتاجها js/chat-send.js (قراءة) و js/chat-reply.js (قراءة+كتابة)

// setReply + cancelReply → منقولين لـ js/chat-reply.js (مع window.* exports)

// ── Context Menu ──
let _ctxDocId = null;
let _ctxData  = null;
Object.defineProperty(window, '_ctxData',  { get: () => _ctxData, set: (v) => { _ctxData = v; }, configurable: true });
Object.defineProperty(window, '_ctxDocId', { get: () => _ctxDocId, set: (v) => { _ctxDocId = v; }, configurable: true });

// _showCtxAt + showMsgCtxMenu → منقولين لـ js/chat-ctxmenu.js (مع window.* exports)

// ctxReply → منقولة لـ js/chat-reply.js (مع window.ctxReply export)

// ctxDelete → منقولة لـ js/chat-ctxmenu.js (مع window.ctxDelete export)

/* ══════════════════════════════════════════
   FORWARD MESSAGE SYSTEM
   ↳ ctxForward → openFwdModal → forwardMsgTo
══════════════════════════════════════════ */
// ctxForward → منقولة لـ js/chat-ctxmenu.js (مع window.ctxForward export)

function openFwdModal(data) {
  const backdrop = document.getElementById("fwdBackdrop");
  const previewText = document.getElementById("fwdPreviewText");
  const previewBox  = document.getElementById("fwdPreviewBox");
  const previewIcon = previewBox?.querySelector("i");
  if (!backdrop) return;

  // بناء نص المعاينة
  if (data.image) {
    if (previewIcon) previewIcon.className = "fa-solid fa-image";
    if (previewText) previewText.textContent = "📷 صورة";
  } else if (data.audio) {
    if (previewIcon) previewIcon.className = "fa-solid fa-microphone";
    if (previewText) previewText.textContent = "🎤 " + (data.fileName || "تسجيل صوتي");
  } else if (data.pdf) {
    if (previewIcon) previewIcon.className = "fa-solid fa-file-pdf";
    if (previewText) previewText.textContent = "📄 " + (data.fileName || "ملف PDF");
  } else if (data.file) {
    if (previewIcon) previewIcon.className = "fa-solid fa-file";
    if (previewText) previewText.textContent = "📎 " + (data.fileName || "ملف");
  } else {
    if (previewIcon) previewIcon.className = "fa-solid fa-quote-right";
    if (previewText) previewText.textContent = (data.text || "").slice(0, 120) || "رسالة";
  }

  _buildFwdList(data);
  backdrop.classList.add("show");
}
window.openFwdModal = openFwdModal;

function closeFwdModal() {
  document.getElementById("fwdBackdrop")?.classList.remove("show");
}
window.closeFwdModal = closeFwdModal;

function _buildFwdList(msgData) {
  const list = document.getElementById("fwdList");
  if (!list) return;
  list.innerHTML = "";

  // ── القسم 1: الشات العام ──
  const pubHdr = document.createElement("div");
  pubHdr.className = "fwd-section-hdr";
  pubHdr.innerHTML = `<i class="fa-solid fa-globe fa-xs"></i> عام`;
  list.appendChild(pubHdr);

  const pubBtn = _makeFwdBtn("🎓", "الشات العام", "شات عام", () => forwardMsgTo("public", msgData));
  list.appendChild(pubBtn);

  // ── القسم 2: الغرف ──
  const _fwdRooms = window._dmsGetRooms?.() || [];
  if (_fwdRooms.length) {
    const rHdr = document.createElement("div");
    rHdr.className = "fwd-section-hdr";
    rHdr.innerHTML = `<i class="fa-solid fa-layer-group fa-xs"></i> الغرف`;
    list.appendChild(rHdr);

    _fwdRooms.forEach(room => {
      const btn = _makeFwdBtn(room.icon || "💬", room.name, "غرفة", () => forwardMsgTo(`room:${room.id}`, msgData));
      list.appendChild(btn);
    });
  }

  // ── القسم 3: المحادثات الخاصة ──
  const peers = Object.keys(_acceptedPeers || {});
  if (peers.length) {
    const dmHdr = document.createElement("div");
    dmHdr.className = "fwd-section-hdr";
    dmHdr.innerHTML = `<i class="fa-solid fa-comments fa-xs"></i> المحادثات الخاصة`;
    list.appendChild(dmHdr);

    peers.forEach(uid => {
      const cached = _userCache[uid];
      const u = (cached?.data || cached) || window._dmsGetPeerInfo?.(uid) || {};
      const name = u.name || "مستخدم";
      const photo = u.photo || "";
      let iconHTML;
      if (photo) {
        iconHTML = `<div class="fwd-target-icon"><img src="${esc(photo)}" alt=""></div>`;
      } else {
        iconHTML = `<div class="fwd-target-icon">${_defaultAvatarHTML(u.gender, 40)}</div>`;
      }
      const btn = document.createElement("button");
      btn.className = "fwd-target-btn";
      btn.innerHTML = `${iconHTML}<div style="flex:1;min-width:0;text-align:right;"><div class="fwd-target-name">${esc(name)}</div><div class="fwd-target-type">خاص</div></div><i class="fa-solid fa-chevron-left fa-xs" style="color:var(--muted);"></i>`;
      btn.addEventListener("click", () => forwardMsgTo(uid, msgData));
      list.appendChild(btn);
    });
  }

  if (list.children.length <= 2) {
    const empty = document.createElement("div");
    empty.style.cssText = "text-align:center;color:var(--muted);font-size:13px;padding:20px;";
    empty.textContent = "لا توجد محادثات متاحة";
    list.appendChild(empty);
  }
}

function _makeFwdBtn(iconOrEmoji, name, type, onClick) {
  const btn = document.createElement("button");
  btn.className = "fwd-target-btn";
  const isEmoji = [...iconOrEmoji].length <= 2;
  const iconHTML = isEmoji
    ? `<div class="fwd-target-icon" style="background:var(--card);font-size:20px;">${iconOrEmoji}</div>`
    : `<div class="fwd-target-icon">${iconOrEmoji}</div>`;
  btn.innerHTML = `${iconHTML}<div style="flex:1;min-width:0;text-align:right;"><div class="fwd-target-name">${esc(name)}</div><div class="fwd-target-type">${type}</div></div><i class="fa-solid fa-chevron-left fa-xs" style="color:var(--muted);"></i>`;
  btn.addEventListener("click", onClick);
  return btn;
}

async function forwardMsgTo(targetChatId, msgData) {
  closeFwdModal();
  if (!currentUser || !targetChatId) return;

  const isPrivate = targetChatId !== "public" && !targetChatId.startsWith("room:");
  const colPath   = chatColPath(targetChatId);

  // ضمان وجود وثيقة الغرفة الخاصة إن لزم
  if (isPrivate) {
    await ensurePrivateChatDoc(targetChatId).catch(() => {});
  }

  // Phase 1 / 5.1 — World Model: يُضاف فقط للشات العام، وفقط لو فيه عالم صالح حاليًا.
  // لا worldId: null، ولا افتراض is_2 — لو activeWorldContext() رجّعت null، الحقل ما يُكتبش أصلاً.
  const _worldId = (colPath === "messages" && typeof window.activeWorldContext === "function")
    ? window.activeWorldContext() : null;

  // بناء payload الرسالة المُعاد توجيهها — نحتفظ بالمحتوى الأصلي + نضيف علامة forwarded
  const payload = {
    uid:       currentUser.uid,
    name:      currentName,
    photo:     currentPhoto,
    createdAt: serverTimestamp(),
    forwarded: true,
    ...(_worldId ? { worldId: _worldId } : {}),
    ...(isPrivate
      ? { senderId: currentUser.uid, delivered: false, seen: false }
      : { time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) }
    )
  };

  // نقل المحتوى الأصلي
  if (msgData.text  && !msgData.image && !msgData.audio && !msgData.pdf && !msgData.file)
    payload.text = msgData.text;
  if (msgData.image)    { payload.image = msgData.image; }
  if (msgData.audio)    { payload.audio = msgData.audio; payload.fileName = msgData.fileName || ""; }
  if (msgData.pdf)      { payload.pdf   = msgData.pdf;   payload.fileName = msgData.fileName || ""; }
  if (msgData.file)     { payload.file  = msgData.file;  payload.fileName = msgData.fileName || ""; payload.fileSize = msgData.fileSize || 0; }

  // إذا لم يكن لديه أي محتوى قابل للتوجيه
  if (!payload.text && !payload.image && !payload.audio && !payload.pdf && !payload.file) {
    toast("لا يمكن إعادة توجيه هذه الرسالة", "error"); return;
  }

  try {
    await addDoc(collection(db, colPath), payload);

    // تحديث lastMessage في DM إن كانت خاصة
    if (isPrivate) {
      const roomRef = doc(db, "privateChats", privateChatId(targetChatId));
      const preview = payload.image ? "📷 صورة" : payload.audio ? "🎤 صوت" : payload.pdf ? "📄 PDF" : payload.file ? "📎 ملف" : (payload.text || "").slice(0, 60);
      updateDoc(roomRef, {
        lastMessage:   preview,
        lastMessageAt: serverTimestamp(),
        lastSenderId:  currentUser.uid
      }).catch(() => {});
    }

    // تحديد اسم المحادثة الهدف للـ toast
    let destName = "الشات العام";
    if (targetChatId.startsWith("room:")) {
      const roomId = targetChatId.slice(5);
      const room = (window._dmsGetRooms?.() || []).find(r => r.id === roomId);
      destName = room ? room.name : "الغرفة";
    } else if (isPrivate) {
      const cached = _userCache[targetChatId];
      const u = cached?.data || cached || window._dmsGetPeerInfo?.(targetChatId) || {};
      destName = u.name || "المحادثة الخاصة";
    }

    toast(`✅ تمت إعادة التوجيه إلى ${destName}`, "success");
  } catch(e) {
    toast("فشلت إعادة التوجيه", "error");
    console.error(e);
  }
}
window.forwardMsgTo = forwardMsgTo;

// ctxCopy → منقولة لـ js/chat-ctxmenu.js (مع window.ctxCopy export)

// ctxCopyLink → منقولة لـ js/chat-ctxmenu.js (مع window.ctxCopyLink export)



// _buildReplyPreviewHTML → منقولة لـ js/chat-reply.js (مع window._buildReplyPreviewHTML export)

// ── Jump to replied message ──
function jumpToMsg(docId) {
  if (!docId) return;
  const el = document.getElementById("msg-" + docId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("reply-flash");
  setTimeout(() => el.classList.remove("reply-flash"), 1500);
}
window.jumpToMsg = jumpToMsg;

// sendChatMsg → منقولة بالكامل لـ js/chat-send.js (مع window.sendChatMsg export)

// ══════════════════════════════════════════
/* ══════════════════════════════════════════
   CHAT DYNAMIC BACKGROUNDS — منقول بالكامل لـ js/chat-backgrounds.js
   ملاحظة: سطرا التفعيل التاليين عمداً فضلوا هنا في مكانهم الأصلي بالضبط
   (نفس سبب Pin Message: تنفيذ فوري محتاج selectChat و db جاهزين)
══════════════════════════════════════════ */

// Re-apply when chat switches
const _origSelectChat = typeof selectChat === "function" ? selectChat : null;
if (_origSelectChat) {
  window.selectChat = function(chatId, chatName, chatPhoto) {
    _origSelectChat(chatId, chatName, chatPhoto);
    window._applyChatBgFromCache?.(chatId);   // ── فوري من الكاش ──
    getDoc(doc(db, "appSettings", "chatBackgrounds")).then(snap => {
      if (_currentChatId !== chatId) return;
      if (!snap.exists()) return;
      const data = snap.data();
      window._bgCacheSet?.(data);
      const type = chatId === "public" ? "public"
        : chatId?.startsWith("room:") ? "rooms" : "private";
      window._applyChatBg?.(type, window._chatBgPick ? window._chatBgPick(data, type) : (data[type] || ""));
    }).catch(()=>{});
  };
}

// Start listening immediately — الكاش يمنع الوميض، Firebase يحدّث إن اختلف
try { window._listenChatBg?.(); } catch(e){}

/* ══════════════════════════════════════════
   DRAFT MESSAGES SYSTEM — منقول بالكامل لـ js/draft-messages.js
   alias محلي عشان 3 استدعاءات قديمة تفضل شغالة بدون أي تعديل
══════════════════════════════════════════ */
const _draftSave = (...a) => window._draftSave?.(...a);
const _draftRestore = (...a) => window._draftRestore?.(...a);
const _draftClear = (...a) => window._draftClear?.(...a);

/* ══════════════════════════════════════════
   PIN MESSAGE SYSTEM — منقول بالكامل لـ js/pin-message.js
   ملاحظة: السطرين التاليين (تفعيل الاستماع) عمداً فضلوا هنا في مكانهم
   الأصلي بالضبط — لأنهم بيتنفذوا فوراً وقت التحميل ومحتاجين window.selectChat
   الحقيقية و db جاهزين، وده مش مضمون في ملف بيتحمّل بدري. الـ ?. إضافة أمان
   إضافية بسيطة (defense in depth) رغم إن ترتيب تحميل الموديولات أصلاً بيضمن
   إن js/pin-message.js بيتحمّل قبل هنا.
══════════════════════════════════════════ */

// ── Hook into selectChat to restart pin listener ──
const _selectChatOrig2 = window.selectChat;
window.selectChat = function(chatId, chatName, chatPhoto) {
  if (typeof _selectChatOrig2 === "function") _selectChatOrig2.apply(this, arguments);
  try { window._listenPinnedMsg?.(); } catch(e) {}
};

// Start pin listener for initial chat
try { window._listenPinnedMsg?.(); } catch(e) {}
