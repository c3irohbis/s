/* split from js/app-main.js (block W_visit_system) — verbatim code; cross-module state writes go through __set_* helpers */
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { OWNER_UID, VERIFIED_OWNER_UID, db } from "./a-init-config.js";
import { currentUser } from "./d-state-roles-email.js";
import { _defaultAvatarHTML } from "./h-avatars.js";
import { CACHE_TTL_MS, _ensurePublicId, _getUser, _userCache } from "./k-usercache-publicid.js";
import { __inc__vbCounter, _vbCounter, renderUserDisplay } from "./s-badges-display.js";
import { esc } from "./v-profile-cards-picctx.js";
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
  const _pvmVbMid = "pvm-vbmask-" + (uid || "x") + "-" + (__inc__vbCounter());
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
