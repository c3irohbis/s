/* split from js/app-main.js (block S_badges_display) — verbatim code; cross-module state writes go through __set_* helpers */
import { OWNER_UID, VERIFIED_OWNER_UID } from "./a-init-config.js";
import { esc } from "./v-profile-cards-picctx.js";
/* ══════════════════════════════════════════
   SVG مرجعية — Owner / Admin / Verified
══════════════════════════════════════════ */
const _SVG_OWNER_CROWN = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 14l2-6 5 3.5L15 8l2 6H3z" fill="#060d1a" stroke="#060d1a" stroke-width="0.5" stroke-linejoin="round"/>
  <circle cx="3"  cy="8"  r="1.5" fill="#060d1a"/>
  <circle cx="10" cy="5"  r="1.5" fill="#060d1a"/>
  <circle cx="17" cy="8"  r="1.5" fill="#060d1a"/>
  <rect x="3" y="14.5" width="14" height="1.5" rx="0.75" fill="#060d1a"/>
</svg>`;

const _SVG_ADMIN_SHIELD = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 2L3 5v5c0 4 3.1 7.5 7 8.5 3.9-1 7-4.5 7-8.5V5L10 2z" fill="#fff" opacity="0.92"/>
  <path d="M7 10l2 2 4-4" stroke="#f97316" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/* ══════════════════════════════════════════
   BADGE BUILDERS
══════════════════════════════════════════ */

function _adminBadgeHTML() {
  return `<span class="badge-admin-icon" title="مشرف النظام">${_SVG_ADMIN_SHIELD}</span>`;
}

let _vbCounter = 0;
function _verifiedBadgeHTML(uid) {
  // عدّاد تصاعدي دائم يضمن تفرّد معرّف الـ mask دائمًا، حتى لو ظهرت شارة
  // نفس المستخدم في أكثر من مكان بالصفحة في نفس اللحظة (قائمة + هيدر + ...).
  // معرّفات mask غير فريدة تُفشل تطبيق القص فيسقط الـmask ويظهر الدائرة
  // الزرقاء ممتلئة بلا علامة صح — هذا هو الإصلاح المباشر لذلك.
  const _mid = "vbmask-" + (uid || "x") + "-" + (_vbCounter++);
  return `<svg class="badge-verified-icon" viewBox="0 0 40 40" aria-label="موثق" title="حساب موثق">
    <mask id="${_mid}">
      <path fill="#fff" d="M36.794,23.502 Q37.387,24.659 36.295,25.364 L34.082,26.794 Q32.990,27.500 32.925,28.798 L32.793,31.430 Q32.728,32.728 31.430,32.793 L28.798,32.925 Q27.500,32.990 26.794,34.082 L25.364,36.295 Q24.659,37.387 23.502,36.794 L21.157,35.593 Q20.000,35.000 18.843,35.593 L16.498,36.794 Q15.341,37.387 14.636,36.295 L13.206,34.082 Q12.500,32.990 11.202,32.925 L8.570,32.793 Q7.272,32.728 7.207,31.430 L7.075,28.798 Q7.010,27.500 5.918,26.794 L3.705,25.364 Q2.613,24.659 3.206,23.502 L4.407,21.157 Q5.000,20.000 4.407,18.843 L3.206,16.498 Q2.613,15.341 3.705,14.636 L5.918,13.206 Q7.010,12.500 7.075,11.202 L7.207,8.570 Q7.272,7.272 8.570,7.207 L11.202,7.075 Q12.500,7.010 13.206,5.918 L14.636,3.705 Q15.341,2.613 16.498,3.206 L18.843,4.407 Q20.000,5.000 21.157,4.407 L23.502,3.206 Q24.659,2.613 25.364,3.705 L26.794,5.918 Q27.500,7.010 28.798,7.075 L31.430,7.207 Q32.728,7.272 32.793,8.570 L32.925,11.202 Q32.990,12.500 34.082,13.206 L36.295,14.636 Q37.387,15.341 36.794,16.498 L35.593,18.843 Q35.000,20.000 35.593,21.157 L36.794,23.502 Z"/>
      <path d="M11.6,19.7 L17,25.5 L28.5,15.7" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="bevel"/>
    </mask>
    <path fill="#0866ff" mask="url(#${_mid})" d="M36.794,23.502 Q37.387,24.659 36.295,25.364 L34.082,26.794 Q32.990,27.500 32.925,28.798 L32.793,31.430 Q32.728,32.728 31.430,32.793 L28.798,32.925 Q27.500,32.990 26.794,34.082 L25.364,36.295 Q24.659,37.387 23.502,36.794 L21.157,35.593 Q20.000,35.000 18.843,35.593 L16.498,36.794 Q15.341,37.387 14.636,36.295 L13.206,34.082 Q12.500,32.990 11.202,32.925 L8.570,32.793 Q7.272,32.728 7.207,31.430 L7.075,28.798 Q7.010,27.500 5.918,26.794 L3.705,25.364 Q2.613,24.659 3.206,23.502 L4.407,21.157 Q5.000,20.000 4.407,18.843 L3.206,16.498 Q2.613,15.341 3.705,14.636 L5.918,13.206 Q7.010,12.500 7.075,11.202 L7.207,8.570 Q7.272,7.272 8.570,7.207 L11.202,7.075 Q12.500,7.010 13.206,5.918 L14.636,3.705 Q15.341,2.613 16.498,3.206 L18.843,4.407 Q20.000,5.000 21.157,4.407 L23.502,3.206 Q24.659,2.613 25.364,3.705 L26.794,5.918 Q27.500,7.010 28.798,7.075 L31.430,7.207 Q32.728,7.272 32.793,8.570 L32.925,11.202 Q32.990,12.500 34.082,13.206 L36.295,14.636 Q37.387,15.341 36.794,16.498 L35.593,18.843 Q35.000,20.000 35.593,21.157 L36.794,23.502 Z"/>
  </svg>`;
}

/* ══════════════════════════════════════════
   _buildBadgesHTML(user)
   ترتيب: [Owner|Admin] → [✓Verified]
   VERIFIED_OWNER_UID معرّف أعلاه عند CONFIG & INIT
══════════════════════════════════════════ */
function _buildBadgesHTML(user) {
  if (!user) return "";
  const uid         = user.uid || user.id || "";
  const role        = user.role || "user";
  const isOwnerUser = uid === OWNER_UID || uid === VERIFIED_OWNER_UID || role === "owner";
  const isAdminUser = role === "admin";
  const isVerified  = isOwnerUser;
  let html = "";

  // 1. Role badge — شارة المالك الذهبية اتشالت (كانت بتظهر مكررة جنب الشارة الزرقاء)
  if (isAdminUser && !isOwnerUser) html += _adminBadgeHTML();

  // 2. Verified
  if (isVerified) html += _verifiedBadgeHTML(uid);

  return html;
}

/* ── شارات مصغّرة (توثيق/أدمن فقط) — لقائمة الدردشات المضغوطة ──
   دالة إضافية معزولة تماماً، لا تُعدّل _buildBadgesHTML الأصلية، وتُعرَّض على
   window لأن js/dms-page.js يعمل كموديول (نطاق منفصل عن هذا السكربت). */
window._chatListBadgesHTML = function (user) {
  if (!user) return "";
  const uid         = user.uid || user.id || "";
  const role        = user.role || "user";
  const isOwnerUser = uid === OWNER_UID || uid === VERIFIED_OWNER_UID || role === "owner";
  const isAdminUser = role === "admin";
  const isVerified  = isOwnerUser;
  let html = "";
  if (isAdminUser && !isOwnerUser) html += _adminBadgeHTML();
  if (isVerified) html += _verifiedBadgeHTML(uid);
  return html;
};

/* ══════════════════════════════════════════
   renderUserDisplay(name, user, uid?)
   دالة مرنة — اسم + badges كاملة inline
══════════════════════════════════════════ */
function renderUserDisplay(name, user, uid) {
  if (uid && user && !user.uid && !user.id) user = { ...user, uid };
  const safeName = esc(name || user?.name || "مستخدم");
  const badges   = _buildBadgesHTML(user || {});
  return `<span class="user-display" dir="auto"><span class="user-display-name">${safeName}</span>${badges}</span>`;
}
window.renderUserDisplay = renderUserDisplay;

export function __inc__vbCounter(){ return _vbCounter++; }
export { _vbCounter, renderUserDisplay };
