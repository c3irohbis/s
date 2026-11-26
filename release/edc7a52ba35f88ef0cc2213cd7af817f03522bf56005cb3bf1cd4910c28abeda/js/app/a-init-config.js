/* split from js/app-main.js (block A_init_config) — verbatim code; cross-module state writes go through __set_* helpers */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { browserLocalPersistence, getAuth, setPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentSingleTabManager } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/* ══════════════════════════════════════════
   CONFIG & INIT
══════════════════════════════════════════ */
const firebaseConfig = {
  apiKey:            "AIzaSyB538malKBKgsWO572c9uo4bOzzSGWFue8",
  authDomain:        "university-platform-dev.firebaseapp.com",
  projectId:         "university-platform-dev",
  storageBucket:     "university-platform-dev.firebasestorage.app",
  messagingSenderId: "665165296802",
  appId:             "1:665165296802:web:57aa1315497e48c25ad3fb"
};

const OWNER_UID = "wnvQPme3u0NU4VVqvr4DGqvv4KE3";
window.OWNER_UID = OWNER_UID; // ← تصدير: محتاجها js/chat-core.js (appendChatMsg)
// UID المالك الرسمي — الوحيد المسموح له بتعديل الرتبة
const VERIFIED_OWNER_UID = "wnvQPme3u0NU4VVqvr4DGqvv4KE3";
// دالة مساعدة — تتحقق من كلا الـ UID (uppercase + lowercase)
const _isVerifiedOwner = (uid) =>
  uid && (uid === OWNER_UID || uid === VERIFIED_OWNER_UID);

const ROLES     = Object.freeze({ OWNER: "owner", ADMIN: "admin", USER: "user" });

// Anti-spam: last send time per user
let _lastSendTime = 0;
Object.defineProperty(window, '_lastSendTime', { get: () => _lastSendTime, set: (v) => { _lastSendTime = v; }, configurable: true }); // ← bridge: محتاجها js/chat-send.js
const SPAM_INTERVAL_MS = 1500; // min 1.5s between messages
window.SPAM_INTERVAL_MS = SPAM_INTERVAL_MS; // ← تصدير: محتاجها js/chat-send.js

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
// ── نفرض طريقة حفظ ثابتة لجلسة الدخول بدل الوضع التلقائي —
//    الوضع التلقائي أحيانًا بيختار تخزين IndexedDB اللي ممكن ميفتحش
//    صح لما تطبيق TWA يتقفل ويتفتح تاني وهو أوفلاين، فيفقد الجلسة
//    ويرجّع صفحة تسجيل الدخول رغم إن المستخدم لسه مسجل دخول فعليًا.
setPersistence(auth, browserLocalPersistence).catch((e) => {
  console.warn("Auth persistence setup failed:", e);
});
// تفعيل التخزين المحلي (Offline Persistence) — يسمح بعرض المحادثات والبيانات
// اللي سبق تحميلها حتى بدون إنترنت، وأي تعديل/رسالة تتبعت وقت انقطاع النت
// بتتخزن محليًا وتتزامن تلقائيًا لما الاتصال يرجع (زي سلوك تطبيقات
// المحادثة الحقيقية) بدل ما تفشل فورًا.
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager({ forceOwnership: true })
    })
  });
} catch (e) {
  // fallback لو المتصفح مش داعم (مثلاً وضع تصفح خاص) أو تعذّر تفعيل الكاش
  db = getFirestore(app);
}
const storage = getStorage(app);
window.db = db;

/* FCM — منقول بالكامل لملف مستقل js/notif-permission.js */

export function __set__lastSendTime(v){ _lastSendTime = v; return v; }
export { OWNER_UID, ROLES, SPAM_INTERVAL_MS, VERIFIED_OWNER_UID, _isVerifiedOwner, _lastSendTime, app, auth, db };
