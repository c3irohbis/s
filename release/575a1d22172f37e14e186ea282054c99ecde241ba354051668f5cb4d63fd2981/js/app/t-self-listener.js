/* split from js/app-main.js (block T_self_listener) — verbatim code; cross-module state writes go through __set_* helpers */
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { _isVerifiedOwner, db } from "./a-init-config.js";
import { __set__isChatBanned, __set_currentName, __set_currentPhoto, __set_currentRole, _isChatBanned, currentName, currentPhoto, currentRole } from "./d-state-roles-email.js";
import { doLogout } from "./g-auth-profile-logout.js";
import { _defaultAvatarHTML, setAvatarUI } from "./h-avatars.js";
import { _userCache } from "./k-usercache-publicid.js";
import { updateChatBannedState } from "./l-requests-chat-helpers-ban.js";
import { renderUserDisplay } from "./s-badges-display.js";
import { _syncBioCards } from "./v-profile-cards-picctx.js";
/* ══════════════════════════════════════════
   _startSelfListener(myUid)
   ↳ مراقبة بيانات المستخدم الحالي في realtime
   ↳ يكشف: isChatBanned, isBanned, name, photo, role
   ↳ يُحدّث كل UI فوراً بدون Refresh
══════════════════════════════════════════ */
let _selfListenerUnsub = null;

function _startSelfListener(myUid) {
  if (_selfListenerUnsub) { _selfListenerUnsub(); _selfListenerUnsub = null; }
  if (!myUid) return;

  let _prevSelfKey = null;
  _selfListenerUnsub = onSnapshot(doc(db, "users", myUid), snap => {
    if (!snap.exists()) return;
    const d = snap.data();

    // كشف حظر الحساب الكامل (isBanned) — يُسجّل الخروج فورياً
    if (d.isBanned && !_isVerifiedOwner(myUid)) {
      toast("⛔ تم حظر حسابك — تواصل مع الإدارة", "error");
      setTimeout(() => doLogout(), 1500);
      return;
    }

    const key = `${d.isChatBanned||false}_${d.name||""}_${d.photo||""}_${d.role||"user"}_${d.publicId||""}`;
    if (_prevSelfKey === key) return;
    _prevSelfKey = key;

    // حظر الشات — تحديث realtime
    const newChatBanned = d.isChatBanned || false;
    if (typeof _isChatBanned !== "undefined" && newChatBanned !== _isChatBanned) {
      __set__isChatBanned(newChatBanned);
      updateChatBannedState();
      if (newChatBanned) toast("⛔ تم حظرك من إرسال الرسائل", "error");
      else toast("✅ تم رفع حظر الشات عنك", "success");
    }

    // تحديث بيانات المستخدم الحالي
    if (window._currentUserData) Object.assign(window._currentUserData, d);
    __set_currentName(d.name  || currentName);
    __set_currentPhoto(d.photo || currentPhoto);
    __set_currentRole(d.role  || currentRole);

    // تحديث الـ cache
    _userCache[myUid] = { data: { ...(_userCache[myUid]?.data || {}), ...d, uid: myUid }, ts: Date.now() };

    // تحديث UI
    document.getElementById("welcomeText").innerHTML =
      renderUserDisplay(d.name || currentName, d, myUid);
    document.getElementById("profileName").innerHTML =
      renderUserDisplay(d.name || currentName, d, myUid);
    if (d.bio !== undefined)
      document.getElementById("profileBioText").textContent = d.bio || "";
    if (d.photo) setAvatarUI(d.photo, true, d.gender);
    else if (d.gender) setAvatarUI(_defaultAvatarHTML(d.gender, 96), null, d.gender);

    // تحديث publicId في البروفايل
    if (d.publicId) {
      const pubIdEl = document.getElementById("profilePublicId");
      if (pubIdEl) pubIdEl.textContent = d.publicId;
    }

    _syncBioCards(d);

    // Role badge
    const badgeEl    = document.getElementById("roleBadgeTop");
    const badgeClass = { owner:"owner", admin:"admin", user:"user" }[d.role] || "user";
    const badgeText  = { owner:"<i class=\"fa-solid fa-crown\"></i> Owner", admin:"<i class=\"fa-solid fa-gear\"></i> Admin", user:"<i class=\"fa-solid fa-circle-user\"></i> User" }[d.role] || "User";
    if (badgeEl) badgeEl.innerHTML = `<span class="role-badge ${badgeClass}">${badgeText}</span>`;

    // Owner/Admin buttons
    document.getElementById("ownerBtn").style.display = (d.role === "owner") ? "inline-block" : "none";
    document.getElementById("adminBtn").style.display = (d.role === "admin") ? "inline-block" : "none";

    // تحديث كل رسائل المستخدم الحالي في الشات
    document.querySelectorAll(`.msg-sender-name[data-sender-uid="${myUid}"]`).forEach(el => {
      el.innerHTML = renderUserDisplay(d.name || "", d, myUid);
    });
  }, err => {
    if (err.code !== "permission-denied") console.warn("selfListener:", err.code);
  });
}

export function __set__selfListenerUnsub(v){ _selfListenerUnsub = v; return v; }
export { _selfListenerUnsub, _startSelfListener };
