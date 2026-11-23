/* ══════════════════════════════════════════
   js/pin-message.js — نظام تثبيت الرسائل
   ↳ Stores pinned msg in Firestore per chat
   ↳ appSettings/pinnedMessages → { public: {msgId,text,senderName}, "room:xxx": {...}, "uid1_uid2": {...} }
   ↳ Real-time listener updates bar for ALL users
   منقول من index.html بدون أي تغيير في المنطق —
   فقط استبدال المراجع المحلية بمراجع window المكافئة.
   ملاحظة: سطرا "تفعيل" الاستماع (selectChat hook + الاستدعاء الأولي)
   فضلوا عمداً في index.html نفسه (مش هنا) بسبب حساسية توقيت التنفيذ.
══════════════════════════════════════════ */
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Track current pinned msg id
window._pinnedMsgId   = null;
window._pinnedMsgText = null;
let _pinUnsub = null;

function _pinDocId(chatId) {
  const privateChatId = window.privateChatId;
  // Safe doc key: public, room_xxx, or sorted uid pair
  if (!chatId || chatId === "public") return "public";
  if (chatId.startsWith("room:")) return "room_" + chatId.slice(5).replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!window.currentUser?.uid) return null; // بعد فقدان الجلسة: لا مفتاح خاص (privateChatId تحتاج currentUser)
  return privateChatId(chatId); // uid1_uid2
}

const _pinnedRef = () => doc(window.db, "appSettings", "pinnedMessages");

// ── Show / hide the pinned bar ──
function _renderPinnedBar(data) {
  const bar  = document.getElementById("pinnedMsgBar");
  const txt  = document.getElementById("pinnedMsgText");
  const unpin = document.getElementById("pinnedBarUnpinBtn");
  if (!bar || !txt) return;

  if (!data || !data.msgId) {
    window._pinnedMsgId   = null;
    window._pinnedMsgText = null;
    bar.classList.remove("show");
    return;
  }

  window._pinnedMsgId   = data.msgId;
  window._pinnedMsgText = data.text || "";

  // Preview text: truncate + indicate type
  let preview = data.text || "";
  if (!preview && data.image) preview = "📷 صورة";
  else if (!preview && data.audio) preview = "🎤 تسجيل صوتي";
  else if (!preview && data.pdf) preview = "📄 ملف PDF";
  else if (!preview && data.file) preview = "📎 ملف";
  else if (!preview) preview = "رسالة مثبتة";

  txt.textContent = (data.senderName ? data.senderName + ": " : "") + preview;
  bar.classList.add("show");

  // Show unpin button only for admins/owners
  if (unpin) unpin.style.display = (window.isAdmin?.() || window.isOwner?.()) ? "" : "none";
}

// ── Listen to pinned messages for current chat ──
// المستند واحد لكل الدردشات (appSettings/pinnedMessages)، فالمستمع يبقى واحدًا دائمًا:
// عند تبديل المحادثة نعيد العرض من آخر لقطة بدل إلغاء الاشتراك وإعادته.
let _pinData = null, _pinHasSnap = false;
function _pinForCurrentChat() {
  return _pinData ? (_pinData[_pinDocId(window._currentChatId)] || null) : null;
}
function _listenPinnedMsg() {
  const bar = document.getElementById("pinnedMsgBar");
  if (bar) bar.classList.remove("show");
  window._pinnedMsgId = null;

  if (_pinUnsub) {
    if (_pinHasSnap) _renderPinnedBar(_pinForCurrentChat());
    return;
  }
  _pinUnsub = onSnapshot(_pinnedRef(), (snap) => {
    _pinHasSnap = true;
    _pinData = snap.exists() ? snap.data() : null;
    _renderPinnedBar(_pinForCurrentChat());
  }, () => { _pinUnsub = null; _pinHasSnap = false; _pinData = null; }); // خطأ (مثلاً قبل الدخول) → أعد الاشتراك في الاستدعاء التالي
}
window._listenPinnedMsg = _listenPinnedMsg;

// ── ctxPin — called from context menu ──
function ctxPin() {
  const toast = window.toast;
  window.hideMsgCtxMenu();
  const _ctxDocId = window._ctxDocId;
  const _ctxData  = window._ctxData;
  if (!_ctxDocId || !_ctxData) return;
  if (!window.isAdmin?.() && !window.isOwner?.()) { toast("غير مصرح","error"); return; }

  const isPinned = window._pinnedMsgId === _ctxDocId;
  if (isPinned) {
    _unpinMsg();
    return;
  }

  // Build preview data
  const d = _ctxData;
  const pinData = {
    msgId:      _ctxDocId,
    text:       d.text ? (window._currentChatId === 'public' ? window.BariqProfanity.mask(d.text) : d.text) : null,
    image:      d.image ? true : null,
    audio:      d.audio ? true : null,
    pdf:        d.pdf   ? true : null,
    file:       d.file  ? true : null,
    senderName: d.name  || null,
    pinnedBy:   window.currentUser?.uid || null,
    pinnedAt:   Date.now(),
  };
  // Remove nulls
  Object.keys(pinData).forEach(k => { if (pinData[k] === null) delete pinData[k]; });

  const key = _pinDocId(window._currentChatId);
  if (key == null) return;
  setDoc(_pinnedRef(), { [key]: pinData }, { merge: true })
    .then(() => toast("📌 تم تثبيت الرسالة","success"))
    .catch(() => toast("فشل تثبيت الرسالة","error"));
}
window.ctxPin = ctxPin;

// ── Unpin: called by bar close btn or context menu ──
function _unpinMsg() {
  const toast = window.toast;
  if (!window.isAdmin?.() && !window.isOwner?.()) { toast("غير مصرح","error"); return; }
  const key = _pinDocId(window._currentChatId);
  if (key == null) return;
  // Use updateDoc with deleteField to remove the key
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(m => {
    m.updateDoc(_pinnedRef(), { [key]: m.deleteField() })
      .then(() => toast("🗑 تم إلغاء التثبيت","success"))
      .catch(() => toast("فشل إلغاء التثبيت","error"));
  });
}
window._unpinMsg = _unpinMsg;

// ── Jump to pinned message in chat ──
function _jumpToPinnedMsg() {
  if (!window._pinnedMsgId) return;
  window.jumpToMsg(window._pinnedMsgId);
}
window._jumpToPinnedMsg = _jumpToPinnedMsg;
