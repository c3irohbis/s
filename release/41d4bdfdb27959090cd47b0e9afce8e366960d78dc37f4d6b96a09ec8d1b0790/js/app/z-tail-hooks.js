/* split from js/app-main.js (block Z_tail_hooks) — verbatim code; cross-module state writes go through __set_* helpers */
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./a-init-config.js";
import { _currentChatId } from "./l-requests-chat-helpers-ban.js";
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

export { _draftClear };
