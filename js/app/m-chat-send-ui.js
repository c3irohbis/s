/* split from js/app-main.js (block M_chat_send_ui) — verbatim code; cross-module state writes go through __set_* helpers */
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { SPAM_INTERVAL_MS, __set__lastSendTime, _lastSendTime, db } from "./a-init-config.js";
import { _notifyMentions, _notifyPrivateMsg } from "./b-fcm-notif.js";
import { _buildUploadCard, _getFileCategory, uploadToCloudinaryWithProgress } from "./c-upload-audit-stub.js";
import { _isChatBanned, currentName, currentPhoto, currentUser } from "./d-state-roles-email.js";
import { _currentChatId } from "./l-requests-chat-helpers-ban.js";
import { _draftClear } from "./z-tail-hooks.js";
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
  const text  = _currentChatId === 'public' ? window.BariqProfanity.mask(input.value.trim()) : input.value.trim();
  if (!text) return; // منع الرسائل الفارغة

  _isSending    = true;
  __set__lastSendTime(now);

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

    window.BariqProfanity.payload(msgData, isPrivate ? null : 'public');
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

    window.BariqProfanity.payload(msgData, isPrivate ? null : 'public');
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
