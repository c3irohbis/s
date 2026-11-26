/* split from js/app-main.js (block N_admin_ban_unban) — verbatim code; cross-module state writes go through __set_* helpers */
import { deleteField, doc, getDoc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./a-init-config.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./c-upload-audit-stub.js";
import { __set__isChatBanned, _isChatBanned, currentRole, currentUser, isAdmin, isOwner } from "./d-state-roles-email.js";
import { confirm } from "./e-toast-confirm.js";
import { _currentChatId, updateChatBannedState } from "./l-requests-chat-helpers-ban.js";
import { esc } from "./v-profile-cards-picctx.js";
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
    __set__isChatBanned(false);
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

export { toggleChatBan };
