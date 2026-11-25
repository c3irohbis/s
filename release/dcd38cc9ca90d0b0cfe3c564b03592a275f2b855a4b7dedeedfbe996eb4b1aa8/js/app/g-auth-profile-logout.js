/* split from js/app-main.js (block G_auth_profile_logout) — verbatim code; cross-module state writes go through __set_* helpers */
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { clearIndexedDbPersistence, doc, serverTimestamp, setDoc, terminate, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { OWNER_UID, ROLES, auth, db } from "./a-init-config.js";
import { __set__fcmNotifsUnsub, _fcmNotifsUnsub } from "./b-fcm-notif.js";
import { __set_currentName, __set_currentPhoto, __set_currentRole, __set_currentUser, __set_msgUnsub, currentName, currentPhoto, currentRole, currentUser, msgUnsub } from "./d-state-roles-email.js";
import { __set__acceptedPeers, _acceptedPeers } from "./j-dm-open.js";
import { __set__allUsersCache, __set__userCache, __set__worldUsersCache, _allUsersCache, _generatePublicId, _userCache, _worldUsersCache } from "./k-usercache-publicid.js";
import { _ensuredRooms } from "./l-requests-chat-helpers-ban.js";
import { __set__selfListenerUnsub, _selfListenerUnsub } from "./t-self-listener.js";
/* ══════════════════════════════════════════
   AUTH — PROFILE CORE (التسجيل/الدخول نفسه في js/auth-ui.js + js/auth-bridge.js)
══════════════════════════════════════════ */

// ── إنشاء وثيقة المستخدم (مشتركة بين التسجيل والإكمال التلقائي) ──
// الوثيقة تُكتب أولاً بدون publicId، وبعدها نولّده ونحدّثه؛
// لو فشل يتولّاه كود الترحيل في onAuthStateChanged عند أول دخول.
async function _createUserProfile(user, { name, gender, worldId }) {
  const uid  = user.uid;
  const role = uid === OWNER_UID ? ROLES.OWNER : ROLES.USER;
  await setDoc(doc(db, "users", uid), {
    uid, name, email: user.email, role,
    publicId:  "",
    photo:     "",
    bio:       "",
    gender,
    ...(uid !== OWNER_UID ? { worldId } : {}),
    banReason: "",
    agreedToTerms:   true,
    agreedToTermsAt: serverTimestamp(),
    createdAt: serverTimestamp()
  });
  try {
    const publicId = await _generatePublicId();
    await updateDoc(doc(db, "users", uid), { publicId });
  } catch (e) { console.warn("publicId will be generated on next login:", e); }
}

// ── نسخة محلية من بيانات التسجيل (بدون كلمة المرور) ──
const _PENDING_KEY = "bis_pending_profile";
function _savePendingProfile(email, p) {
  try { localStorage.setItem(_PENDING_KEY, JSON.stringify({ email: email.toLowerCase(), ...p, ts: Date.now() })); } catch (e) {}
}
function _readPendingProfile(email) {
  try {
    const p = JSON.parse(localStorage.getItem(_PENDING_KEY) || "null");
    if (!p || !email || p.email !== email.toLowerCase()) return null;
    if (Date.now() - p.ts > 7 * 864e5) return null;
    return { name: p.name, gender: p.gender, worldId: p.worldId };
  } catch (e) { return null; }
}
function _clearPendingProfile() { try { localStorage.removeItem(_PENDING_KEY); } catch (e) {} }

// ── منطق الحساب المشترك مع واجهة الدخول الجديدة (js/auth-bridge.js) ──
// واجهة الدخول/التسجيل/إكمال البيانات صارت في js/auth-ui.js؛ هنا يبقى فقط
// منطق إنشاء وثيقة المستخدم الذي يستخدمه الربط.
window._bisAuthCore = {
  auth,
  createUserProfile: _createUserProfile,
  savePendingProfile: _savePendingProfile,
  readPendingProfile: _readPendingProfile,
  clearPendingProfile: _clearPendingProfile
};

/* ══════════════════════════════════════════
   AUTH — LOGOUT
══════════════════════════════════════════ */
async function doLogout() {
  try { window.__insCaptureAuth?.revoke(); } catch (_) {}
  try { void window.InstructionsModule?.capture?.logout().catch(() => {}); } catch (_) {}
  // حفظ أي تغيير معلّق في تفضيلات الإشعارات قبل ما الحساب يخرج (بحد أقصى مهلة داخلية؛ أي فشل ما بيوقفش الخروج)
  try { await window._notifPrefsFlush?.(); } catch(e) {}

  if (msgUnsub)         { msgUnsub();         __set_msgUnsub(null); }
  if (_selfListenerUnsub){ _selfListenerUnsub(); __set__selfListenerUnsub(null); }
  // تنظيف مستمعي الاستطلاعات
  window._cleanupPollListeners?.();
  // فصل مستمعات قوائم المنتدى (الأخبار/المحاضرات/الامتحانات/السكاشن)
  window._forumLiveStopAll?.();
  // مسح كاش الغرف الخاصة المتحقق منها
  if (typeof _ensuredRooms !== "undefined") _ensuredRooms.clear();
  __set__acceptedPeers({});
  __set__userCache({});
  __set__allUsersCache(null); __set__worldUsersCache(null);
  window._dmsStopListeners?.(); // إيقاف مستمعات قائمة الدردشات (dms-page.js) ومسح حالتها
  __set_currentUser(null); __set_currentRole(null); __set_currentName(""); __set_currentPhoto("");
  window.currentUser = null; // تنظيف للوحدات الخارجية
  // FCM cleanup
  if (_fcmNotifsUnsub) { try { _fcmNotifsUnsub(); } catch(e){} __set__fcmNotifsUnsub(null); }
  window.qnStopListening?.(); // إيقاف مستمع الإخطار السريع قبل إبطال الجلسة (quick-notifications.js)
  await signOut(auth);
  document.getElementById("settingsModal")?.classList.remove("open");
  document.body.style.overflow = "";
  window.AuthUI?.reset?.(); // الواجهة الجديدة: تفريغ الحقول والرجوع لعرض الدخول

  // مسح كل أثر للحساب من هذا الجهاز: التخزين المحلي (عدا تفضيل الثيم) + كاش Firestore، ثم صفحة نظيفة
  try { sessionStorage.clear(); } catch (e) {}
  try { Object.keys(localStorage).forEach(k => { if (!/theme/i.test(k)) localStorage.removeItem(k); }); } catch (e) {}
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch (e) {}
  window.location.replace(window.location.pathname);
}
document.getElementById("logoutBtn")?.addEventListener("click", doLogout);
document.getElementById("logoutBtnProfile").addEventListener("click", doLogout);

export { _clearPendingProfile, _createUserProfile, _readPendingProfile, doLogout };
