/* split from js/app-main.js (block K_usercache_publicid) — verbatim code; cross-module state writes go through __set_* helpers */
import { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { OWNER_UID, db } from "./a-init-config.js";
/* ══════════════════════════════════════════
   USER CACHE — TTL + Batch
   _userCache:     uid → { data, ts }
   _allUsersCache: full users array (5-min TTL)
   _userFetchQ:    pending batch-fetch promises
══════════════════════════════════════════ */
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 دقائق
let _userCache     = {};
Object.defineProperty(window, '_userCache', { get: () => _userCache, configurable: true }); // ← bridge: محتاجها js/chat-core.js (appendChatMsg قراءة فقط)
let _allUsersCache = null;
let _allUsersCacheTs = 0;
const _userFetchQ  = {};  // uid → Promise (لمنع التحميل المتوازي)

async function _getUser(uid) {
  const actorUid = window.currentUser?.uid || null;
  const fallback = () => ({name:"مستخدم",photo:""});
  if (!actorUid || !uid) return fallback();
  const cached = _userCache[uid];
  if (cached && (Date.now() - cached.ts < CACHE_TTL_MS)) return cached.data;
  const key = JSON.stringify([actorUid,uid]);
  if (_userFetchQ[key]) return _userFetchQ[key];
  const pending = (async () => {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (window.currentUser?.uid !== actorUid) return fallback();
      const data = snap.exists() ? snap.data() : fallback();
      _userCache[uid] = { data, ts: Date.now() };
      return data;
    } catch(e) { return fallback(); }
    finally { delete _userFetchQ[key]; }
  })();
  _userFetchQ[key] = pending;
  return pending;
}
window._getUserProfile = _getUser;

async function _getAllUsers() {
  if (_allUsersCache && (Date.now() - _allUsersCacheTs < CACHE_TTL_MS)) {
    return _allUsersCache;
  }
  const snap = await getDocs(collection(db, "users"));
  _allUsersCache = [];
  snap.forEach(d => {
    const u = { id: d.id, uid: d.id, ...d.data() };
    _userCache[d.id] = { data: u, ts: Date.now() };
    _allUsersCache.push(u);
  });
  _allUsersCacheTs = Date.now();
  return _allUsersCache;
}
window._getAllUsers = _getAllUsers;

// Share the complete world result without broadening a failed scoped query.
// Pagination/substring search is a separate migration, not a silent result cap.
let _worldUsersCache = null, _worldUsersCacheTs = 0, _worldUsersCacheW = null;
let _worldUsersCacheUid = null, _worldUsersPending = null;
async function _getWorldUsers() {
  const w = window.activeWorldContext?.() || null;
  const uid = window.currentUser?.uid || null;
  if (!uid) throw new Error("Directory requires a signed-in account");
  const current = () => window.currentUser?.uid === uid && (window.activeWorldContext?.() || null) === w;
  if (_worldUsersCache && _worldUsersCacheUid === uid && _worldUsersCacheW === w && Date.now() - _worldUsersCacheTs < CACHE_TTL_MS) return _worldUsersCache;
  if (_worldUsersPending?.uid === uid && _worldUsersPending.w === w) return _worldUsersPending.promise;
  const pending = { uid, w, promise: null };
  pending.promise = (async () => {
    const [ws, os] = await Promise.all([
      w ? getDocs(query(collection(db, "users"), where("worldId", "==", w))) : null,
      getDoc(doc(db, "users", OWNER_UID))
    ]);
    if (!current()) throw new Error("Directory context changed");
    const seen = new Set(), list = [];
    [...(ws ? ws.docs : []), ...(os.exists() ? [os] : [])].forEach(d => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      const u = { id: d.id, uid: d.id, ...d.data() };
      _userCache[d.id] = { data: u, ts: Date.now() };
      list.push(u);
    });
    _worldUsersCache = list; _worldUsersCacheW = w; _worldUsersCacheUid = uid; _worldUsersCacheTs = Date.now();
    return list;
  })().finally(() => { if (_worldUsersPending === pending) _worldUsersPending = null; });
  _worldUsersPending = pending;
  return pending.promise;
}
window._getWorldUsers = _getWorldUsers;

/* ══════════════════════════════════════════
   _generatePublicId — إنشاء معرف عام فريد
   ✓ 6 أرقام (100000 → 999999)
   ✓ يتحقق من عدم التكرار في Firestore
   ✓ يعيد المحاولة حتى 10 مرات
══════════════════════════════════════════ */
async function _generatePublicId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = String(Math.floor(100000 + Math.random() * 900000));
    try {
      const q = query(
        collection(db, "users"),
        where("publicId", "==", id),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return id; // ← فريد ✓
    } catch(e) {
      // في حالة فشل الاستعلام، نجرب رقماً آخر
    }
  }
  // Fallback نادر جداً — يستخدم timestamp
  return String(Date.now()).slice(-6);
}

/* ══════════════════════════════════════════
   _ensurePublicId(uid)
   ↳ يتحقق من وجود publicId للمستخدم
   ↳ إذا لم يكن موجوداً → ينشئه ويحفظه في Firestore
   ↳ يُحدّث الـ cache فوراً
   ↳ يُستدعى قبل نسخ المعرف أو زيارة البروفايل
══════════════════════════════════════════ */
async function _ensurePublicId(uid) {
  if (!uid) return null;

  // تحقق من الـ cache أولاً
  const cached = _userCache[uid];
  const cachedData = cached?.data || cached;
  if (cachedData?.publicId) return cachedData.publicId;

  // اقرأ من Firestore
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return null;
    const data = snap.data();

    // إذا موجود → حدّث الـ cache وارجعه
    if (data.publicId) {
      if (_userCache[uid]) {
        const obj = _userCache[uid]?.data || _userCache[uid];
        obj.publicId = data.publicId;
      }
      return data.publicId;
    }

    // غير موجود → أنشئ واحداً جديداً واحفظه
    const newId = await _generatePublicId();
    await updateDoc(doc(db, "users", uid), { publicId: newId });

    // حدّث الـ cache
    if (_userCache[uid]) {
      const obj = _userCache[uid]?.data || _userCache[uid];
      obj.publicId = newId;
    } else {
      _userCache[uid] = { data: { ...data, publicId: newId, uid }, ts: Date.now() };
    }

    return newId;
  } catch(e) {
    console.warn("_ensurePublicId failed:", uid, e);
    return null;
  }
}
window._ensurePublicId = _ensurePublicId;

export function __set__userCache(v){ _userCache = v; return v; }
export function __set__allUsersCache(v){ _allUsersCache = v; return v; }
export function __set__worldUsersCache(v){ _worldUsersCache = v; return v; }
export { CACHE_TTL_MS, _allUsersCache, _ensurePublicId, _generatePublicId, _getUser, _getWorldUsers, _userCache, _worldUsersCache };
