/* split from js/app-main.js (block V_profile_cards_picctx) — verbatim code; cross-module state writes go through __set_* helpers */
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from "./a-init-config.js";
import { currentUser, displayEmail } from "./d-state-roles-email.js";
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

export { _fillProfInfoCard, _syncBioCards, esc };
