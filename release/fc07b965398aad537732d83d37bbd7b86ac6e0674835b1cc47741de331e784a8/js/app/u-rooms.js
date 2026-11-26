/* split from js/app-main.js (block U_rooms) — verbatim code; cross-module state writes go through __set_* helpers */
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./a-init-config.js";
import { __set__fcmNotifsUnsub, _fcmNotifsUnsub } from "./b-fcm-notif.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./c-upload-audit-stub.js";
import { currentUser, isOwner } from "./d-state-roles-email.js";
import { confirm } from "./e-toast-confirm.js";
import { _currentChatId } from "./l-requests-chat-helpers-ban.js";
import { __set__selfListenerUnsub, _selfListenerUnsub } from "./t-self-listener.js";
import { esc } from "./v-profile-cards-picctx.js";
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
  if (_selfListenerUnsub) { try { _selfListenerUnsub(); } catch(e) {} __set__selfListenerUnsub(null); } // users/<أنا>
  if (_fcmNotifsUnsub)    { try { _fcmNotifsUnsub(); } catch(e) {} __set__fcmNotifsUnsub(null); }       // fcmNotifications
  window.qnStopListening?.();            // quickNotifications (عالم + عام)
  window._stopChatListener?.();          // رسائل/تفاعلات المحادثة المفتوحة
};

/* ══ Sync iOS Bio Cards ══ */

export { renderOwnerRoomsList };
