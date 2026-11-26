/* split from js/app-main.js (block Y_reply_fwd) — verbatim code; cross-module state writes go through __set_* helpers */
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./a-init-config.js";
import { currentName, currentPhoto, currentUser } from "./d-state-roles-email.js";
import { _defaultAvatarHTML } from "./h-avatars.js";
import { _acceptedPeers } from "./j-dm-open.js";
import { _userCache } from "./k-usercache-publicid.js";
import { esc } from "./v-profile-cards-picctx.js";

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
    window.BariqProfanity.payload(payload, targetChatId);
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
