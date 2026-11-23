/* split from js/app-main.js (block B_fcm_notif) — verbatim code; cross-module state writes go through __set_* helpers */
import { addDoc, collection, doc, getDoc, getDocsFromServer, limit, onSnapshot, query, runTransaction, serverTimestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { fcmSupported, showForegroundNotif } from "../notif-permission.js";
import { OWNER_UID, db } from "./a-init-config.js";
import { currentUser, isAdmin, isOwner } from "./d-state-roles-email.js";
import { _getWorldUsers } from "./k-usercache-publicid.js";
import { _currentChatId } from "./l-requests-chat-helpers-ban.js";
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

export function __set__fcmNotifsUnsub(v){ _fcmNotifsUnsub = v; return v; }
export { _fcmNotifsUnsub, _notifyAllUsers, _notifyMentions, _notifyPrivateMsg, _startNotifListener, uploadToCloudinary };
