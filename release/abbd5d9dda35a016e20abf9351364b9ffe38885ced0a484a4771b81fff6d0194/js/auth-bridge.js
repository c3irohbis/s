/* ==========================================================================
   ربط واجهة الدخول الجديدة (js/auth-ui.js) مع Firebase — ملف مستقل
   يعرّف دوال window.AuthBridge التي تستدعيها الواجهة:
     loginEmail · google · sendEmailLink · resendEmailLink · checkEmailVerified
     saveProfile · signOut · onDone · needsProfile
   ويعرّف window._authHold(user) الذي يستخدمه onAuthStateChanged في index.html
   كي لا يفتح الموقع قبل ما تكتمل خطوات الدخول/التسجيل/تأكيد البريد.

   لا يغيّر أي شكل: كل الرسائل تظهر عبر نفس عناصر الواجهة.
   إنشاء وثيقة المستخدم يتم بنفس الدالة القديمة (window._bisAuthCore.createUserProfile).
   ========================================================================== */
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, GoogleAuthProvider, signInWithPopup,
  signInWithRedirect, getRedirectResult,
  verifyPasswordResetCode, confirmPasswordReset, applyActionCode
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const core  = () => window._bisAuthCore;    // يعرّفه index.html
const auth  = () => (core() && core().auth) || getAuth(getApp());

/* ── "قيد التنفيذ": يبقى true بعد نجاح الدخول/التسجيل حتى يضغط المستخدم "الدخول إلى الموقع"
      (فيُعاد تحميل الصفحة)، ويرجع false عند أي فشل أو تسجيل خروج ── */
let busy = false;

/* فتح الصفحة من رابط في رسالة Firebase (?mode=resetPassword أو verifyEmail مع oobCode):
   نمنع فتح الموقع (حتى لو كانت هناك جلسة محفوظة) إلى أن تنتهي خطوات الرابط */
let resetHold = (() => {
  try { const q = new URLSearchParams(location.search); return (q.get("mode") === "resetPassword" || q.get("mode") === "verifyEmail") && !!q.get("oobCode"); }
  catch (e) { return false; }
})();


/* يُستدعى من onAuthStateChanged: true = لا تفتح الموقع الآن */
window._authHold = (user) =>
  busy || resetHold || !!readMarker() || sdkRedirectPending();
  /* الماركر أو راية Firebase نفسها يمسكان الموقع لحد ما يكمل إكمال الـ redirect —
     فلا يفتح مسار الجلسة العام التطبيق قبل انتهاء فحوص الإكمال */

/* ── رسائل الأخطاء (نفس صياغة الموقع القديم + رسائل Google/التحقق) ── */
const ERR = {
  "auth/invalid-credential":   "بريد أو كلمة مرور غلط",
  "auth/user-not-found":       "الحساب غير موجود",
  "auth/wrong-password":       "كلمة المرور غلط",
  "auth/too-many-requests":    "محاولات كثيرة — انتظر قليلاً",
  "auth/email-already-in-use": "البريد الإلكتروني مستخدم من قبل",
  "auth/invalid-email":        "تنسيق البريد الإلكتروني غلط",
  "auth/weak-password":        "كلمة المرور ضعيفة",
  "auth/network-request-failed": "تعذّر الاتصال بالإنترنت، تأكد من الشبكة وحاول تاني",
  "auth/popup-blocked":        "المتصفح منع نافذة Google، اسمح بالنوافذ المنبثقة وحاول تاني",
  "auth/operation-not-allowed": "هذه الطريقة غير مفعّلة حاليًا",
  "auth/unauthorized-domain":  "هذا الرابط غير مسموح له بتسجيل الدخول بـ Google",
  "auth/user-disabled":        "تم إيقاف هذا الحساب — تواصل مع الإدارة",
  "auth/expired-action-code":  "انتهت صلاحية الرابط، اطلب رابطًا جديدًا",
  "auth/invalid-action-code":  "الرابط غير صالح أو تم استخدامه من قبل، اطلب رابطًا جديدًا"
};
const CANCELLED = ["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"];
const errMsg = (e) => ERR[e && e.code] || (e && e.message) || "حدث خطأ، حاول مرة أخرى.";

const SESSION_GONE = "انتهت الجلسة، سجّل الدخول من جديد.";

/* ── دخول Google على الموبايل: redirect بدل الـ popup ──
   الـ popup على الموبايل بيفتح تبويب منفصل؛ لو انقطع التواصل مع التبويب الأصلي
   (متصفح تاني أو متصفح داخل تطبيق) بيفضل تبويب يتيم والتبويب الأصلي يبان كأنه سجّل خروج.
   الـ redirect بيكمّل في نفس التبويب ويرجع للموقع مسجَّل الدخول مباشرة. ── */
const REDIRECT_KEY = "bis_google_redirect_v1";
const REDIRECT_TTL = 30 * 60 * 1000;   /* ماركر أقدم من 30 دقيقة يُعتبر منسيًا ويُحذف */
/* الماركر في sessionStorage: الـ redirect تنقّل في نفس التبويب، وتخزين التبويب ينجو من
   التنقل ويبقى معزولًا عن باقي التبويبات — لا يستهلكه ولا يحذفه تبويب آخر */
function readMarker() {
  let m = null;
  try { m = JSON.parse(sessionStorage.getItem(REDIRECT_KEY) || "null"); }
  catch (e) { clearMarker(); return null; }   /* JSON تالف يُحذف فورًا */
  if (!m) return null;
  const age = Date.now() - m.ts;
  if (!Number.isFinite(m.ts) || age < 0 || age > REDIRECT_TTL
      || (m.mode !== "login" && m.mode !== "register")) { clearMarker(); return null; }
  return m;
}
function clearMarker() { try { sessionStorage.removeItem(REDIRECT_KEY); } catch (e) {} }
/* علم الـ SDK نفسه: Firebase يكتب firebase:pendingRedirect:<apiKey>:<appName> في
   sessionStorage قبل _openRedirect مباشرة. ظهوره = التنقّل وشيك الحدوث.
   المفتاح مخصَّص لتطبيق Firebase الحالي بالضبط (apiKey + appName) — لا نقرأ ولا
   نمسح أعلام تطبيقات أخرى قد تشارك نفس النطاق */
function sdkPendingKey() {
  try {
    const a = auth();
    return "firebase:pendingRedirect:" + a.app.options.apiKey + ":" + a.app.name;
  } catch (e) { return null; }
}
function sdkRedirectPending() {
  const k = sdkPendingKey();
  if (!k) return false;
  try { return sessionStorage.getItem(k) === "true"; } catch (e) { return false; }
}
/* عند التخلي عن المحاولة بالكامل (مهلة الاسترداد أو إكمال فاشل): نزيل راية الـ SDK
   الخاصة بتطبيقنا حتى لا تبقي _authHold الموقع محجوزًا — المحاولة تُعتبر ملغاة */
function clearSdkRedirectPending() {
  const k = sdkPendingKey();
  if (!k) return;
  try { sessionStorage.removeItem(k); } catch (e) {}
}
/* آيباد بوضع سطح المكتب يعرّف نفسه كـ Macintosh لكنه شاشة لمس → يُعامل كموبايل */
const isMobileLike = () => /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent || "")
  || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent || ""));
/* اختيار المسار: override يدوي للدعم والاختبار (localStorage bis_auth_flow = redirect|popup)،
   وإلا موبايل → redirect وكمبيوتر → popup */
function googleFlow() {
  try { const f = localStorage.getItem("bis_auth_flow"); if (f === "redirect" || f === "popup") return f; } catch (e) {}
  return isMobileLike() ? "redirect" : "popup";
}

/* ── تحويل بيانات الواجهة {name, gender, dept, year} إلى بيانات الموقع {name, gender, worldId} ── */
function toSite(p) {
  p = p || {};
  const worldId = (p.dept && p.year) ? `${p.dept}_${p.year}` : "";
  return { name: String(p.name || "").trim(), gender: p.gender, worldId };
}
function validSite(s) {
  if (!s.name) return "اكتب اسم المستخدم.";
  if (s.gender !== "male" && s.gender !== "female") return "اختر نوع الحساب.";
  if (!s.worldId || typeof window.isValidWorldId !== "function" || !window.isValidWorldId(s.worldId)) return "اختر الشعبة والفرقة.";
  return null;
}
function toUi(d) {
  d = d || {};
  const [dept, year] = String(d.worldId || "").split("_");
  return { name: d.name || "", gender: d.gender, dept: dept || "", year: year || "", terms: true };
}

async function userDoc(uid) {
  const snap = await getDoc(doc(window.db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

/* ينشئ وثيقة المستخدم إن لم تكن موجودة (لا يكتب فوق وثيقة قائمة أبدًا) */
async function ensureProfile(user, site) {
  const existing = await userDoc(user.uid);
  if (existing) return existing;
  await core().createUserProfile(user, site);
  core().clearPendingProfile();
  return await userDoc(user.uid);
}

/* بعد نجاح تسجيل الدخول (بريد أو Google): هل للحساب بيانات؟ */
async function afterSignIn(user, draft) {
  const data = await userDoc(user.uid);
  if (data) {
    if (data.isBanned) {
      await signOut(auth()); busy = false;
      return { status: "error", message: "تم حظر حسابك — تواصل مع الإدارة" };
    }
    return { status: "ok", profile: toUi(data) };
  }
  /* تسجيل جديد بـ Google من شاشة إنشاء الحساب: نستخدم البيانات المكتوبة */
  if (draft) {
    const site = toSite(draft), bad = validSite(site);
    if (bad) { await signOut(auth()); busy = false; return { status: "error", message: bad }; }
    const created = await ensureProfile(user, site);
    return { status: "ok", profile: toUi(created) };
  }
  /* تسجيل قديم انقطع في نفس المتصفح: نكمّله تلقائيًا */
  const pending = core().readPendingProfile(user.email);
  if (pending) {
    const created = await ensureProfile(user, pending);
    return { status: "ok", profile: toUi(created) };
  }
  return { status: "incomplete", profile: { name: user.displayName || "" } };
}

const B = (window.AuthBridge = window.AuthBridge || {});

B.loginEmail = async function ({ email, password }) {
  busy = true;
  try {
    const cred = await signInWithEmailAndPassword(auth(), email, password);
    return await afterSignIn(cred.user, null);
  } catch (e) { busy = false; return { status: "error", message: errMsg(e) }; }
};

B.google = async function (draft) {
  /* موبايل: redirect في نفس التبويب. الماركر يتخزن قبل التنقل ويكمّل الدخول بعد الرجوع */
  if (googleFlow() === "redirect") {
    busy = true;
    try {
      sessionStorage.setItem(REDIRECT_KEY, JSON.stringify({ mode: draft ? "register" : "login", draft: draft || null, ts: Date.now() }));
      /* التنقّل يُبدأ ويُراقَب بمؤقّت مستقل تمامًا عن وعد signInWithRedirect:
         في Firebase 10.12.0 الوعد لا يُحسم أبدًا (_openRedirect ينقل الصفحة ثم يرجع
         promise بلا حسم)، سواء حدث التنقّل أم لا — فانتظاره لا يكشف فشل التنقّل أبدًا.
         pagehide يؤكد بدء التنقّل فيُحفَظ الماركر؛ غيابه مع انتهاء المهلة يعني بيئة
         لم تتنقّل → فشل محدود نظيف بدل تعليق دائم بالحجز */
      let navStarted = false, invokeError = null;
      const onHide = function () { navStarted = true; };
      window.addEventListener("pagehide", onHide, { once: true });
      try { signInWithRedirect(auth(), new GoogleAuthProvider()).catch(function (e) { invokeError = e; }); }
      catch (e) { invokeError = e; }   /* رفض متزامن عند الاستدعاء نفسه */
      /* المرحلة 1: المسار الطبيعي — التنقّل يبدأ خلال ثوانٍ من الاستدعاء */
      await new Promise(function (res) { setTimeout(res, 3000); });
      /* المرحلة 2: تهيئة Firebase البطيئة قد تؤخر التنقّل بعد مهلة المرحلة 1.
         علم pendingRedirect الذي يكتبه الـ SDK قبل _openRedirect يفرّق بين
         «لم يبدأ التنقّل بعد» (ننتظر ولا نحذف الماركر) و«فشل فتح الصفحة» (فشل محدود) */
      const deadline = Date.now() + 7000;
      while (!navStarted && !invokeError && !sdkRedirectPending() && Date.now() < deadline)
        await new Promise(function (res) { setTimeout(res, 250); });
      /* العلم ظهر: التنقّل وشيك — مهلة أخيرة قصيرة لالتقاط pagehide */
      while (!navStarted && !invokeError && sdkRedirectPending() && Date.now() < deadline + 3000)
        await new Promise(function (res) { setTimeout(res, 250); });
      window.removeEventListener("pagehide", onHide);
      if (invokeError) throw invokeError;   /* مثل auth/unauthorized-domain قبل أي تنقّل */
      if (navStarted) { busy = false; return { status: "cancelled" }; }   /* التنقّل بدأ: الماركر محفوظ والسياق سيُدمَّر */
      /* حارس التنقّل المتأخر: تهيئة Firebase قد تتجاوز مهلة المراقبة ثم يبدأ التنقّل —
         عندها يُعاد/يُحفَظ الماركر قبل مغادرة الصفحة فيكمل الرجوع بالمسار الكامل */
      const markerData = { mode: draft ? "register" : "login", draft: draft || null };
      let lateNav = false;
      const onLateHide = function () {
        lateNav = true;
        try { sessionStorage.setItem(REDIRECT_KEY, JSON.stringify({ mode: markerData.mode, draft: markerData.draft, ts: Date.now() })); } catch (e) {}
      };
      window.addEventListener("pagehide", onLateHide, { once: true });
      if (sdkRedirectPending()) {
        /* علم الـ SDK ظهر دون pagehide: تنقّل محتمل ما زال متأخرًا — مهلة استرداد
           20 ثانية ثم تحرير صريح (حذف الماركر + إعادة تقييم) حتى لا يبقى الموقع محجوزًا */
        busy = false;
        setTimeout(function () {
          if (lateNav) return;   /* التنقّل بدأ أخيرًا: الماركر محفوظ */
          window.removeEventListener("pagehide", onLateHide);
          clearMarker(); clearSdkRedirectPending();   /* تخلٍّ كامل: لا ماركر ولا راية SDK تبقي الحجز */
          if (typeof window._runAuthState === "function") window._runAuthState();
        }, 20000);
        return { status: "cancelled" };
      }
      /* لا تنقّل ولا علم بعد ~10 ثوانٍ: فشل محدود نظيف — وحارس التنقّل المتأخر يُنزع بعد دقيقة */
      clearMarker(); busy = false;
      setTimeout(function () { if (!lateNav) window.removeEventListener("pagehide", onLateHide); }, 60000);
      return { status: "error", message: "تعذّر فتح صفحة Google، حاول مرة أخرى." };
    } catch (e) {
      clearMarker(); busy = false;
      return { status: "error", message: errMsg(e) };
    }
  }
  busy = true;
  try {
    const cred = await signInWithPopup(auth(), new GoogleAuthProvider());
    /* من شاشة إنشاء الحساب: حساب Google مسجّل مسبقًا = رفض (نافذة «الحساب مسجّل بالفعل») */
    if (draft && await userDoc(cred.user.uid)) { await signOut(auth()); busy = false; return { status: "exists" }; }
    return await afterSignIn(cred.user, draft || null);
  } catch (e) {
    busy = false;
    if (CANCELLED.indexOf(e && e.code) !== -1) return { status: "cancelled" };
    return { status: "error", message: errMsg(e) };
  }
};

/* مرحلة 1: إنشاء حساب غير مفعّل + إرسال رابط التحقق. لا وثيقة مستخدم هنا، والموقع يبقى محجوزًا. */
let provisionedUid = null;   /* حساب اكتمل إنشاؤه: الإلغاء المتأخر لا يلمسه */
let vChain = Promise.resolve();   /* تسلسل إنشاء/إلغاء جلسة التحقق: الإلغاء ينتظر الإنشاء الجاري */
const serial = (fn) => (arg) => { const r = vChain.then(() => fn(arg)); vChain = r.catch(() => {}); return r; };
B.sendVerification = serial(async function ({ email, password }) {
  provisionedUid = null;   /* بداية دورة تسجيل جديدة */
  busy = true;
  try {
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth(), email, password);
    } catch (e) {
      if (e.code !== "auth/email-already-in-use") throw e;
      let existing;
      try { existing = await signInWithEmailAndPassword(auth(), email, password); }
      catch (_) { busy = false; return { status: "exists" }; }
      if (await userDoc(existing.user.uid)) { await signOut(auth()); busy = false; return { status: "exists" }; }
      cred = existing;
    }
    if (cred.user.emailVerified) return { status: "verified" };
    try { await sendEmailVerification(cred.user); }
    catch (e) {
      /* الحساب اتعمل لكن الرسالة فشلت: نقفل الجلسة غير المفعّلة قبل ما نرفع الحجز */
      try { await signOut(auth()); } catch (_) { return { status: "error", message: errMsg(e) }; }   /* الحجز يبقى لو فشل الإغلاق */
      busy = false; return { status: "error", message: errMsg(e) };
    }
    return { status: "sent" };
  } catch (e) {
    /* أي فشل بعد نجاح الدخول: نُغلق الجلسة التي أنشأتها هذه العملية قبل رفع الحجز */
    try { if (auth().currentUser) await signOut(auth()); }
    catch (_) { return { status: "error", cleanup: true, message: errMsg(e) }; }
    busy = false; return { status: "error", message: errMsg(e) };
  }
});
/* فحص هادئ أثناء الانتظار: reload + توكن جديد (بدون أي قراءة Firestore) */
B.pollVerified = async function () {
  const u = auth().currentUser;
  if (!u) return { status: "error", message: SESSION_GONE };
  try {
    await u.reload();
    if (!u.emailVerified) return { status: "pending" };
    await u.getIdToken(true);
    return { status: "verified" };
  } catch (e) { return { status: "error", message: errMsg(e) }; }
};
/* تغيير البريد أو إلغاء التحقق: نترك الجلسة غير المفعّلة */
B.cancelVerification = serial(async function () {
  /* شاشة التسجيل ليس فيها جلسة مشروعة: نُنهي أي جلسة (مفعّلة أو لا) ثم نرفع الحجز */
  try {
    const cu = auth().currentUser;
    if (cu && cu.uid === provisionedUid) return { status: "ok" };
    if (cu) await signOut(auth());
    busy = false;
    return { status: "ok" };
  } catch (e) { return { status: "error", message: errMsg(e) }; }
});

/* مرحلة 2: إنشاء الحساب لا يتم إلا بعد التحقق من نفس البريد (والخادم يرفض أي توكن غير مفعّل أيضًا) */
B.sendEmailLink = serial(async function ({ email, profile }) {
  const site = toSite(profile), bad = validSite(site);
  if (bad) return { status: "error", message: bad };
  const u = auth().currentUser;
  if (!u || !u.emailVerified || String(u.email || "").toLowerCase() !== String(email || "").toLowerCase())
    return { status: "error", message: "تحقق من بريدك الإلكتروني أولًا" };
  busy = true;
  try {
    await u.getIdToken(true);
    const created = await ensureProfile(u, site);
    provisionedUid = u.uid;
    return { status: "ok", profile: toUi(created) };
  } catch (e) { busy = false; return { status: "error", message: errMsg(e) }; }
});

/* نسيت كلمة المرور: Firebase يرسل رابط إعادة الضبط للبريد.
   لا نكشف إن كان البريد مسجّلًا أم لا (نفس الرد دائمًا) لمنع تخمين الحسابات. */
B.resetPassword = async function ({ email }) {
  try { await sendPasswordResetEmail(auth(), email); return { status: "sent" }; }
  catch (e) {
    if (e && (e.code === "auth/user-not-found" || e.code === "auth/invalid-credential")) return { status: "sent" };
    return { status: "error", message: errMsg(e) };
  }
};

/* استعادة كلمة المرور داخل الموقع: الرابط المرسل يفتح الموقع ومعه oobCode */
B.checkResetCode = async function ({ code }) {
  try { const email = await verifyPasswordResetCode(auth(), code); return { status: "ok", email }; }
  catch (e) { return { status: "error", message: errMsg(e) }; }
};
B.confirmReset = async function ({ code, password }) {
  try { await confirmPasswordReset(auth(), code, password); return { status: "ok" }; }
  catch (e) {
    if (e && (e.code === "auth/expired-action-code" || e.code === "auth/invalid-action-code")) return { status: "expired", message: errMsg(e) };
    return { status: "error", message: errMsg(e) };
  }
};
/* تأكيد البريد من رابط الرسالة (بعد ضبط Custom action URL ليشير للموقع) */
B.applyVerify = async function ({ code }) {
  try { await applyActionCode(auth(), code); return { status: "ok" }; }
  catch (e) { return { status: "error", message: errMsg(e) }; }
};
/* نهاية الاستعادة: نرفع الحجز ونُنهي أي جلسة قديمة ليكون الدخول بعدها طبيعيًا */
B.endReset = async function () {
  resetHold = false;
  try { if (auth().currentUser) await signOut(auth()); } catch (e) {}
};

B.resendEmailLink = async function () {
  const u = auth().currentUser;
  if (!u) return { status: "error", message: SESSION_GONE };
  try { await sendEmailVerification(u); return { status: "sent" }; }
  catch (e) { return { status: "error", message: errMsg(e) }; }
};

B.checkEmailVerified = async function () {
  const u = auth().currentUser;
  if (!u) return { status: "error", message: SESSION_GONE };
  try {
    await u.reload();
    if (!u.emailVerified) return { status: "pending" };
    const existing = await userDoc(u.uid);
    if (existing) return { status: "verified", profile: toUi(existing) };
    const pending = core().readPendingProfile(u.email);
    if (!pending) return { status: "incomplete", profile: { name: u.displayName || "" } };
    const created = await ensureProfile(u, pending);
    return { status: "verified", profile: toUi(created) };
  } catch (e) { return { status: "error", message: errMsg(e) }; }
};

B.saveProfile = async function (profile) {
  const u = auth().currentUser;
  if (!u) return { status: "error", message: SESSION_GONE };
  const site = toSite(profile), bad = validSite(site);
  if (bad) return { status: "error", message: bad };
  if (!u.emailVerified && u.providerData.some(function (x) { return x.providerId === "password"; }))
    return { status: "error", message: "تحقق من بريدك الإلكتروني أولًا" };
  try { await ensureProfile(u, site); return { status: "ok" }; }
  catch (e) { return { status: "error", message: "تعذّر حفظ بياناتك، تأكد من الاتصال وحاول تاني" }; }
};

B.signOut = async function () {
  busy = false;
  try { core().clearPendingProfile(); } catch (e) {}
  try { await signOut(auth()); } catch (e) {}
};

/* زر "الدخول إلى الموقع": إعادة تحميل الصفحة ليكمل onAuthStateChanged بشكل طبيعي */
/* الدخول اكتمل: نرفع الحجز ونشغّل منطق فتح الموقع مباشرة (بدون إعادة تحميل الصفحة) */
B.onDone = function () {
  busy = false;
  if (typeof window._runAuthState === "function") window._runAuthState(); else window.location.reload();
};

/* حساب موجود بدون وثيقة بيانات (يستدعيه onAuthStateChanged): افتح شاشة إكمال البيانات */
B.needsProfile = function (user) {
  busy = true;
  if (window.AuthUI && window.AuthUI.complete) window.AuthUI.complete({ name: (user && user.displayName) || "" });
};

/* الواجهة تنتظر هذا الإشعار قبل أول استدعاء (حتى لو ضغط المستخدم بسرعة) */
if (typeof window.__resolveAuthBridge === "function") window.__resolveAuthBridge();

/* ── إكمال دخول Google بعد الرجوع من redirect ──
   ينفّذ نفس خطوات B.google بعد نجاح الدخول: حارس «الحساب مسجّل بالفعل» عند الإنشاء،
   فحص الحظر وإنشاء ملف البيانات عبر afterSignIn، ثم فتح الموقع. */
(async function completeGoogleRedirect() {
  const marker = readMarker();
  /* الإكمال لا يعتمد على ماركرنا وحده: لو ضاع (تهيئة تجاوزت كل نوافذ المراقبة أو
     تنقّل متأخر جدًا) تشير راية Firebase نفسها (pendingRedirect) إلى رجوع redirect
     حقيقي، فيسترجع getRedirectResult النتيجة وتُستعاد مسودة التسجيل من تخزين الواجهة */
  if (!marker && !sdkRedirectPending()) return;
  /* حجز صريح طوال الإكمال: لا يفتح مراقب حالة الدخول التطبيق قبل انتهاء
     getRedirectResult وفحوص الملف، ويُحرَّر في كل مسارات الخروج.
     بلا مهلة وبلا إجهاض عامد: الإكمال ينتظر الـ SDK مهما طال الوقت — فالإكمال
     البطيء ينجح في النهاية بدل أن يُلغى، وأسوأ حالة عند تعليق الشبكة تمامًا هي
     مؤشّر انتظار يبقى حتى إعادة تحميل الصفحة، دون أي حالة دخول غير صحيحة أبدًا */
  busy = true;
  let result = null, resultError = null;
  try { result = await getRedirectResult(auth()); } catch (e) { resultError = e; }
  const user = (result && result.user) || auth().currentUser || null;
  if (!user) {
    /* إلغاء أو فشل كامل: تحرير الماركر وراية الـ SDK + إعادة تقييم حالة الدخول صراحة — لا يبقى حجز معلّق */
    clearMarker(); busy = false; clearSdkRedirectPending();
    if (resultError && window.AuthUI && window.AuthUI.googleFail) window.AuthUI.googleFail(errMsg(resultError));
    if (typeof window._runAuthState === "function") window._runAuthState();
    return;
  }
  try {
    /* وضع التسجيل ومسودته: من الماركر إن وُجد، وإلا تُستعاد مسودة الواجهة المحفوظة */
    const uiDraft = (window.AuthUI && window.AuthUI.getDraft) ? (window.AuthUI.getDraft() || null) : null;
    const isRegister = marker ? (marker.mode === "register") : !!uiDraft;
    const draft = (!resultError && isRegister) ? ((marker && marker.draft) || uiDraft || null) : null;
    if (draft) {
      const existing = await userDoc(user.uid);
      if (existing) {
        await signOut(auth());
        clearMarker(); busy = false;
        if (window.AuthUI && window.AuthUI.googleExists) window.AuthUI.googleExists();
        return;
      }
    }
    /* مستخدم موجود رغم الخطأ (أو بعد إلغاء بجلسة سابقة): يدخل بنفس فحوص afterSignIn قبل فتح الموقع */
    const r = await afterSignIn(user, draft);
    clearMarker();
    if (r.status === "ok") {
      if (window.AuthUI && window.AuthUI.clearDraft) window.AuthUI.clearDraft();
      B.onDone();
    } else if (r.status === "incomplete") {
      busy = true;   /* يمسك الموقع لحد إكمال البيانات (نفس مسار الـ popup) */
      if (window.AuthUI && window.AuthUI.complete) window.AuthUI.complete(r.profile);
    } else {
      busy = false;
      if (window.AuthUI && window.AuthUI.googleFail) window.AuthUI.googleFail(r.message || (resultError && errMsg(resultError)));
    }
  } catch (e) {
    clearMarker(); busy = false; clearSdkRedirectPending();
    if (window.AuthUI && window.AuthUI.googleFail) window.AuthUI.googleFail(errMsg(e));
  }
})();
