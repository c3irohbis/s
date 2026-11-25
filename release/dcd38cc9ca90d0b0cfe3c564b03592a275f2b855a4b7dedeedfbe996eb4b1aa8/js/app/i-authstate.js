/* split from js/app-main.js (block I_authstate) — verbatim code; cross-module state writes go through __set_* helpers */
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initFCM } from "../notif-permission.js";
import { OWNER_UID, ROLES, app, auth, db } from "./a-init-config.js";
import { _startNotifListener } from "./b-fcm-notif.js";
import { __set__isChatBanned, __set_currentName, __set_currentPhoto, __set_currentRole, __set_currentUser, _isChatBanned, currentName, currentPhoto, currentRole, currentUser, isAdmin, isOwner } from "./d-state-roles-email.js";
import { goTab } from "./f-nav-chatpage.js";
import { _clearPendingProfile, _createUserProfile, _readPendingProfile } from "./g-auth-profile-logout.js";
import { _defaultAvatarHTML, setAvatarUI } from "./h-avatars.js";
import { __set__allUsersCache, __set__userCache, __set__worldUsersCache, _allUsersCache, _generatePublicId, _userCache, _worldUsersCache } from "./k-usercache-publicid.js";
import { _currentChatId } from "./l-requests-chat-helpers-ban.js";
import { renderUserDisplay } from "./s-badges-display.js";
import { _startSelfListener } from "./t-self-listener.js";
import { _fillProfInfoCard, _syncBioCards } from "./v-profile-cards-picctx.js";
/* ══════════════════════════════════════════
   AUTH STATE — Central controller
══════════════════════════════════════════ */
/* يسمح لواجهة الدخول بتشغيل منطق فتح الموقع مباشرة بدون إعادة تحميل الصفحة */
let _authStateHandler = null;
window._runAuthState = () => (_authStateHandler ? _authStateHandler(auth.currentUser) : undefined);
// Local diagnostics bridge. No diagnostic error may escape into Auth.
try {
  if (!window.__insCaptureAuth) {
    let epoch = 0, eligible = false, account = null, token = null;
    const notify = () => { try { window.InstructionsModule?.capture?.revokeLocal(); } catch (_) {} };
    const api = Object.freeze({
      beginAuthTransition(user) { epoch++; eligible = false; account = user; token = Object.freeze({ epoch }); notify(); return token; },
      setOwnerEligibility(t, owner, user) {
        if (t !== token || t?.epoch !== epoch || user !== account || user !== auth.currentUser) return false;
        eligible = owner === true; return true;
      },
      revoke() { epoch++; eligible = false; token = null; account = null; notify(); },
      getEligibility() { return Object.freeze({ epoch, eligible }); }
    });
    Object.defineProperty(window, '__insCaptureAuth', { value: api, configurable: false, writable: false });
  }
} catch (_) {}
onAuthStateChanged(auth, _authStateHandler = async (user) => {
  let _insAuthToken;
  try { _insAuthToken = window.__insCaptureAuth?.beginAuthTransition(user); } catch (_) {}


  // ✅ أثناء الدخول/التسجيل/تأكيد البريد/إكمال البيانات من واجهة الدخول الجديدة
  // (Firebase يُطلق هذا الـ callback فور الدخول أو إنشاء الحساب، قبل ما تكتمل الخطوات)
  // — الواجهة تمسك الحدث وتكمل الموقع بعد ضغط "الدخول إلى الموقع" (js/auth-bridge.js)
  if (user && window._authHold?.(user)) { showPage("page-login"); return; }

  if (!user) {
    window._dmsStopListeners?.(); // لا تُبقِ أي مستمع/قائمة DM بعد الخروج (مهما كان سبب الخروج)
    window._chatSessionListenersStop?.(); // + الكتابة/التسجيل/الاستطلاعات (مهما كان سبب الخروج)
    __set__userCache({}); __set__allUsersCache(null); __set__worldUsersCache(null);   // نفس doLogout: لا تُبقِ بيانات الحساب السابق في الذاكرة (تُجلب من جديد عند الدخول التالي)
    { const _cm = document.getElementById("chatMessages"); if (_cm) _cm.innerHTML = ""; }   // رسائل المحادثة المخفية للحساب السابق
    window.currentUser = null; // عقد doLogout للوحدات الخارجية: forum-badges.js تُسقط مستمعاتها (uid/world) ذاتيًا عند غياب الحساب
    window._maintenanceApply?.();
    window.__apkPromptHide?.();
    window.__updateNoticeStop?.();
    window.AuthUI?.sessionEnded?.(); // انتهت الجلسة أثناء انتظار تأكيد البريد
    showPage("page-login"); return;
  }

  // ✅ إظهار الواجهة فورًا بمجرد تأكد Firebase من وجود جلسة صالحة —
  // دون انتظار قراءة Firestore. تحميل بيانات المستخدم يستمر أدناه في الخلفية
  // ويُحدّث العناصر تدريجيًا عند وصوله، بدون إعادة فتح الصفحة.
  __set_currentUser(user);
  window.currentUser = user;
  window._dmsGuardUser?.(user.uid); // لو تغيّر الحساب: أوقف مستمعات/بيانات قائمة الـDM للحساب السابق فوراً
  window._sheetatyGuardUser?.(user.uid); // لو تغيّر الحساب: صفّر كاش شيتاتي (subjects/sheets/completions) للحساب السابق فوراً
  window._mydocsGuardUser?.(user.uid); // لو تغيّر الحساب: صفّر كاش مستنداتي (docSubjects/docItems) للحساب السابق فوراً
  if (!window.db) window.db = db;
  window.qnStartListening?.(); // بدء/إعادة بدء مستمع الإخطار السريع بعد تأكيد الجلسة (quick-notifications.js)
  showPage("page-home");
  goTab("tab-home");
  try { window.__apkPromptAfterLogin?.(); } catch (_) {} // اقتراح تحميل التطبيق (متصفح فقط) — يعمل أيضًا مع الجلسة المحفوظة
  try { window.__updateNoticeStart?.(); } catch (_) {} // إشعار نشر تحديث عالمي — مستمع واحد على config/appUpdate

  let userData = null;
  let _readSucceeded = false;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      userData = snap.data(); _readSucceeded = true;
    }
    else { _readSucceeded = true; } // القراءة نجحت، والحساب فعلاً غير موجود
  } catch(e) {
    console.error("Firestore read error:", e);
    _readSucceeded = false; // فشل القراءة (غالبًا بسبب انقطاع النت)، مش دليل على عدم وجود الحساب
  }

  if (!userData) {
    if (!_readSucceeded || !navigator.onLine) {
      // مفيش نت أو تعذر التأكد من البيانات — نكمل بهدوء بحد أدنى من
      // البيانات لحد ما الاتصال يرجع ويزامن تلقائي، من غير أي رسالة مقاطعة
      userData = { name: user.displayName || "مستخدم", publicId: null };
    } else {
      // حساب يتيم: موجود في Auth بدون وثيقة Firestore — نكمّله بدل ما نطرده
      const pending = _readPendingProfile(user.email);
      if (pending) {
        try {
          await _createUserProfile(user, pending);
          _clearPendingProfile();
          const s2 = await getDoc(doc(db, "users", user.uid));
          if (s2.exists()) {
            userData = s2.data();
          }
        } catch (e) { console.error("auto-complete profile failed:", e); }
      }
      if (!userData) { showPage("page-login"); window.AuthBridge?.needsProfile?.(user); return; }
    }
  }

  if (userData.isBanned) {
    toast("تم حظر حسابك — تواصل مع الإدارة", "error");
    await signOut(auth);
    return;
  }

  // ── ترحيل المستخدمين القدامى: إنشاء publicId إن لم يكن موجوداً ──
  if (!userData.publicId) {
    try {
      const newPublicId = await _generatePublicId();
      await updateDoc(doc(db, "users", user.uid), { publicId: newPublicId });
      userData.publicId = newPublicId;
    } catch(e) { console.warn("publicId migration failed:", e); }
  }

  __set_currentUser(user);
  __set_currentName(userData.name  || "مستخدم");
  __set_currentRole(userData.role  || ROLES.USER);
  __set_currentPhoto(userData.photo || "");
  __set__isChatBanned(userData.isChatBanned || false);

  // حفظ بيانات المستخدم الحالي للـ badges
  window._currentUserData = { ...userData, uid: user.uid };

  // ── تعريض المتغيرات للوحدات الخارجية (grades, ...) ──
  window.currentUser = currentUser;
  if (!window.db) window.db = db;
  window._maintenanceApply?.();

  if (user.uid === OWNER_UID && currentRole !== ROLES.OWNER) {
    await updateDoc(doc(db, "users", user.uid), { role: ROLES.OWNER });
    __set_currentRole(ROLES.OWNER);
  }

  try { window.__insCaptureAuth?.setOwnerEligibility(_insAuthToken, currentRole === ROLES.OWNER, user); } catch (_) {}

  // Phase 1 / 5.1 — Owner activeWorld: حالة جلسة فقط (sessionStorage)، بدون أي كتابة لبيانات Owner
  if (currentRole === ROLES.OWNER) {
    const _savedWorld = sessionStorage.getItem("activeWorld");
    window._activeWorld = (typeof window.isValidWorldId === "function" && window.isValidWorldId(_savedWorld))
      ? _savedWorld : "is_2";
  }

  window.checkAttendancePopup?.().catch(() => {}); // بعد تحميل userData وتحديد العالم (activeWorldContext صالح)

  const email = userData.email || user.email || "";
  const bio   = userData.bio   || "";
  const photo = userData.photo || "";

  document.getElementById("welcomeText").innerHTML    = renderUserDisplay(currentName, userData, user.uid);
  document.getElementById("profileName").innerHTML    = renderUserDisplay(currentName, userData, user.uid);
  document.getElementById("profileBioText").textContent = bio;
  document.getElementById("profileEmail").textContent   = email;
  document.getElementById("editName").value = currentName;
  document.getElementById("editBio").value  = bio;

  // Hide password change for non-email providers (e.g. Google)
  const _pwCard = document.getElementById("changePasswordCard");
  const _pwSection = document.getElementById("sec-account");
  const _isEmailProvider2 = user.providerData?.some(p => p.providerId === "password");
  // Find the password block inside account section and show/hide it
  if (_pwSection) {
    // We show/hide the password sub-block by finding it via the header
    const _pwHdr = _pwSection.querySelector(".prof-panel-pw-hdr");
    if (_pwHdr) {
      const _pwWrap = _pwHdr.closest("div") || _pwHdr.parentElement;
      if (_pwWrap) _pwWrap.style.display = _isEmailProvider2 ? "" : "none";
    }
  }
  if (_pwCard) _pwCard.style.display = "none"; // always hide the old hidden placeholder

  // حساب Google: شعار Google وكلمة Google بدل أيقونة وكلمة «البريد الإلكتروني»
  const _isGoogleOnly = !_isEmailProvider2 && user.providerData?.some(p => p.providerId === "google.com");
  const _emIcon = document.getElementById("profSecEmailIcon"), _emLbl = document.getElementById("profSecEmailLbl");
  if (_emIcon && _emLbl) {
    if (_isGoogleOnly) {
      _emIcon.outerHTML = '<svg id="profSecEmailIcon" width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
      _emLbl.textContent = "Google";
    } else {
      _emLbl.textContent = "البريد الإلكتروني";
    }
  }

  // ✅ عرض المعرف العام (publicId) في البروفايل
  const pubIdEl = document.getElementById("profilePublicId");
  if (pubIdEl) pubIdEl.textContent = userData.publicId || "—";
  const pubIdEl2 = document.getElementById("profSecPublicId");
  if (pubIdEl2) pubIdEl2.textContent = userData.publicId || "—";

  // ✅ تعبئة بطاقة المعلومات الإضافية (البريد / النبذة / UID / تاريخ الانضمام)
  _fillProfInfoCard(userData, user, email, bio);

  const roleLabels = { owner:"<i class=\"fa-solid fa-crown\"></i> أونر (Super Admin)", admin:"<i class=\"fa-solid fa-gear\"></i> أدمن", user:"<i class=\"fa-solid fa-circle-user\"></i> مستخدم" };
  document.getElementById("profileRole").innerHTML = roleLabels[currentRole] || currentRole;

  // Show gender
  const gEl = document.getElementById("profileGenderRow");
  const gTxt = document.getElementById("profileGenderText");
  if (gEl && gTxt && userData.gender) {
    gEl.style.display = "flex";
    const gIcon = userData.gender === "female"
      ? `<i class="fa-solid fa-venus" style="color:#f9a8d4;"></i>`
      : `<i class="fa-solid fa-mars" style="color:#93c5fd;"></i>`;
    gTxt.innerHTML = userData.gender === "female"
      ? `${gIcon} طالبة` : `${gIcon} طالب`;
  }

  const badgeEl    = document.getElementById("roleBadgeTop");
  const badgeClass = { owner:"owner", admin:"admin", user:"user" }[currentRole] || "user";
  const badgeText  = { owner:"<i class=\"fa-solid fa-crown\"></i> Owner", admin:"<i class=\"fa-solid fa-gear\"></i> Admin", user:"<i class=\"fa-solid fa-circle-user\"></i> User" }[currentRole] || "User";
  badgeEl.innerHTML = `<span class="role-badge ${badgeClass}">${badgeText}</span>`;

  if (photo) setAvatarUI(photo, true, userData.gender);
  else       setAvatarUI(_defaultAvatarHTML(userData.gender, 96), null, userData.gender);

  document.getElementById("ownerBtn").style.display = isOwner() ? "inline-block" : "none";
  document.getElementById("adminBtn").style.display = isAdmin() && !isOwner() ? "inline-block" : "none";
  _syncBioCards({ ...userData, email: user.email });

  // ── Self-Listener: مراقبة التغييرات على حسابنا الخاص في realtime ──
  // يكشف: حظر الشات، رفع الحظر، تغيير الصورة، تغيير الاسم
  _startSelfListener(user.uid);

  // (تم نقل showPage("page-home") / goTab("tab-home") لأعلى الدالة لتظهر فورًا دون انتظار Firestore)

  // FCM init
  initFCM(user.uid, { app, db, getCurrentChatId: () => _currentChatId }).catch(() => {});
  _startNotifListener(user.uid);
  window._dmsStartListeners?.();

  // قوائم المنتدى (الأخبار/المحاضرات/الامتحانات/السكاشن) مبقاش بتتحمّل مسبقًا عند الدخول:
  // بتشتغل بـ onSnapshot للقسم الظاهر بس (انظر _forumLiveSync) وبتتفصل لما القسم يتخفّى.

});
