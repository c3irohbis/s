/* split from js/app-main.js (block L_requests_chat_helpers_ban) — verbatim code; cross-module state writes go through __set_* helpers */
import { _isChatBanned, isOwner } from "./d-state-roles-email.js";
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

export { _currentChatId, _ensuredRooms, updateChatBannedState };
