/* split from js/app-main.js (block J_dm_open) — verbatim code; cross-module state writes go through __set_* helpers */
import { currentUser, isOwner } from "./d-state-roles-email.js";
import { _getUser, _userCache } from "./k-usercache-publicid.js";
/* ══════════════════════════════════════════
   _acceptedPeers — يُملأ من مستمع privateChats في js/dms-page.js
   (يستهلكه حوار التحويل + أيقونة المحادثة في قائمة الأعضاء)
══════════════════════════════════════════ */
let _acceptedPeers      = {};
Object.defineProperty(window, '_acceptedPeers', { get: () => _acceptedPeers, configurable: true });

/* ══════════════════════════════════════════
   OPEN DIRECT CHAT — Creates room if needed (no chatRequests)
══════════════════════════════════════════ */
// ══════════════════════════════════════════
// openDirectChat — فتح محادثة مباشرة مع أي مستخدم
// بدون Request System — الغرفة تُنشأ تلقائياً
// ══════════════════════════════════════════
let _dcReqToken = 0;
window.openDirectChat = async function(toUid, toUser) {
  if (!currentUser?.uid) { toast("يجب تسجيل الدخول أولاً", "error"); return; }
  if (!toUid)            { toast("مستخدم غير صالح", "error"); return; }
  if (toUid === currentUser.uid) { toast("لا يمكنك مراسلة نفسك", "warn"); return; }

  const myToken = ++_dcReqToken;

  // ✅ World Model: منع فتح/إنشاء محادثة خاصة مع مستخدم من عالم مختلف
  // (الـOwner مستثنى). المصدر الوحيد: users/{uid}.worldId من الخادم عبر
  // _getUser() — وليس أي قيمة ممرَّرة من الواجهة (toUser قد لا تحمل worldId
  // لو جاءت من كائن مبني جزئيًا في مكان آخر).
  if (!isOwner() && toUid !== window.OWNER_UID) {
    const _myWorld = window.currentUserWorldId?.();
    const _toUserSrc = await _getUser(toUid);
    if (myToken !== _dcReqToken) return;
    const _toWorld = window.isValidWorldId?.(_toUserSrc?.worldId) ? _toUserSrc.worldId : null;
    if (!_myWorld || !_toWorld || _myWorld !== _toWorld) {
      toast("لا يمكنك مراسلة مستخدم من عالم مختلف", "error");
      return;
    }
  }

  // تحميل بيانات المستخدم إن لزم
  if (!toUser?.name) toUser = await _getUser(toUid);
  if (myToken !== _dcReqToken) return;

  // 2. تحديث الـ cache المحلي
  if (!_userCache[toUid]) _userCache[toUid] = { data: toUser, ts: Date.now() };

  // 4. فتح المحادثة
  selectChat(toUid, toUser.name, toUser.photo);
};

/* ══════════════════════════════════════════
   MEMBERS LIST — منقول بالكامل لـ js/members-list.js
══════════════════════════════════════════ */
/* Request System — Removed */

export function __set__acceptedPeers(v){ _acceptedPeers = v; return v; }
export { _acceptedPeers };
