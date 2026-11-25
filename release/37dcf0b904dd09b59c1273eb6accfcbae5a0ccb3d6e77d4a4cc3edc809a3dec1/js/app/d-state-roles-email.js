/* split from js/app-main.js (block D_state_roles_email) — verbatim code; cross-module state writes go through __set_* helpers */
import { ROLES } from "./a-init-config.js";
let currentUser   = null;
let currentRole   = null;
let currentName   = "";
Object.defineProperty(window, 'currentName', { get: () => currentName, configurable: true });
let currentPhoto  = "";
Object.defineProperty(window, 'currentPhoto', { get: () => currentPhoto, configurable: true });
let msgUnsub      = null;
Object.defineProperty(window, 'msgUnsub', { get: () => msgUnsub, set: (v) => { msgUnsub = v; }, configurable: true }); // ← bridge: محتاجها js/chat-listener.js (قراءة+كتابة)
// _reactionsUnsub → منقول لـ js/chat-listener.js (كان مستخدم بس جوه startChatListener)
let _isChatBanned = false;
Object.defineProperty(window, '_isChatBanned', { get: () => _isChatBanned, set: (v) => { _isChatBanned = v; }, configurable: true });


/* ══════════════════════════════════════════
   ROLE HELPERS
══════════════════════════════════════════ */
const isOwner = () => currentRole === ROLES.OWNER;
const isAdmin = () => currentRole === ROLES.ADMIN || currentRole === ROLES.OWNER;
window.isAdmin = isAdmin;
window.isOwner = isOwner;
window.getCurrentRole = () => currentRole;
window.getCurrentName = () => currentName;

// Phase 1 / 5.1 — Owner activeWorld: تبديل حالة جلسة فقط، بدون أي Firestore write
window.setActiveWorld = function(worldId) {
  if (!isOwner()) return;
  if (typeof window.isValidWorldId !== "function" || !window.isValidWorldId(worldId)) return;
  window._activeWorld = worldId;
  sessionStorage.setItem("activeWorld", worldId);
  window._forumLiveSync?.();   // تبديل العالم: أعد ربط قوائم المنتدى الظاهرة بالعالم الجديد (أو افصلها)
  // معاينة الشات العام وقائمة الغرف مرتبطتان بالعالم النشط وقت البدء — أعد ربطهما بالعالم الجديد
  window._dmsStopListeners?.();
  window._dmsStartListeners?.();
};

function canModifyUser(actorRole, targetRole) {
  if (targetRole === ROLES.OWNER) return false;
  if (actorRole  === ROLES.OWNER) return true;
  if (actorRole  === ROLES.ADMIN && targetRole !== ROLES.OWNER) return true;
  return false;
}
function canSetRole(actorRole, targetRole, newRole) {
  if (targetRole === ROLES.OWNER) return false;
  if (newRole    === ROLES.OWNER) return false;
  if (actorRole  === ROLES.OWNER) return true;
  return false;
}

/* ══════════════════════════════════════════
   EMAIL PRIVACY — Owner-only visibility
══════════════════════════════════════════ */
// Returns true ONLY for the owner
const canSeeEmails = () => currentRole === ROLES.OWNER;

// Masks email → "ah***@gm***.com"  (safe for non-owners)
function maskEmail(email) {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return "—";
  const [domName, ...domExt] = domain.split(".");
  const maskedLocal  = local.slice(0, 2)   + "***";
  const maskedDomain = domName.slice(0, 2) + "***";
  return `${maskedLocal}@${maskedDomain}.${domExt.join(".")}`;
}

// Returns the display value based on current role
function displayEmail(email) {
  return canSeeEmails() ? (email || "—") : maskEmail(email);
}

export function __set_currentUser(v){ currentUser = v; return v; }
export function __set_currentRole(v){ currentRole = v; return v; }
export function __set_currentName(v){ currentName = v; return v; }
export function __set_currentPhoto(v){ currentPhoto = v; return v; }
export function __set_msgUnsub(v){ msgUnsub = v; return v; }
export function __set__isChatBanned(v){ _isChatBanned = v; return v; }
export { _isChatBanned, canModifyUser, canSetRole, currentName, currentPhoto, currentRole, currentUser, displayEmail, isAdmin, isOwner, msgUnsub };
