// firebase-messaging-sw.js
// ══════════════════════════════════════════
// FCM Service Worker — Background & Closed-Tab Notifications
// + تخزين مؤقت لملفات الواجهة (App Shell) عشان الموقع يفتح بدون إنترنت
//
// DEPLOYMENT:
//   • Place this file in the SAME directory as index.html
//   • GitHub Pages: repo-root/ if index.html is at root, or docs/ if served from docs/
//   • Firebase Hosting: public/ root (firebase.json hosting.public)
//
// The JS in index.html registers this SW using a dynamic base path
// so it works on both GitHub Pages subdirs and Firebase Hosting root.
// ══════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyB538malKBKgsWO572c9uo4bOzzSGWFue8",
  authDomain:        "university-platform-dev.firebaseapp.com",
  projectId:         "university-platform-dev",
  storageBucket:     "university-platform-dev.firebasestorage.app",
  messagingSenderId: "665165296802",
  appId:             "1:665165296802:web:57aa1315497e48c25ad3fb"
});

const messaging = firebase.messaging();

// Background message handler (app in background or tab closed)
messaging.onBackgroundMessage(function(payload) {
  const data  = payload.data || {};
  const title = data.title || 'نظام الجامعة';
  const options = {
    body:               data.body || '',
    icon:               new URL('images/app-icon.png', self.registration.scope).href,
    badge:              new URL('images/app-icon.png', self.registration.scope).href,
    data:               data,
    dir:                'rtl',
    lang:               'ar',
    tag:                data.tag || 'uni-bg',
    requireInteraction: false,
  };
  return self.registration.showNotification(title, options);
});

// Notification click — focus existing tab or open app
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  // Resolve URL relative to SW location (handles GitHub Pages subdirs automatically)
  const appUrl = self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(appUrl);
    })
  );
});

/* ══════════════════════════════════════════
   إضافة — تخزين مؤقت لملفات الواجهة (App Shell)
   عشان الموقع يفتح ويشتغل بدون إنترنت (زي أي تطبيق حقيقي)

   ⚠️ لو ضفت أو غيرت ملفات CSS/JS جديدة، حدّث القايمة تحت وزوّد
   رقم CACHE_VERSION عشان المستخدمين ياخدوا النسخة الجديدة.
   ══════════════════════════════════════════ */

const CACHE_VERSION = 'v31'; // بطاقتا فحص 6+7: طابور النوافذ (apk-prompt/notif-permission) + إصلاح فيضان فقاعات الشات (style.css/chat-reply.css) // بطاقة فحص 5: تراجع عن توحيد مفتاح الكاش (كان بيكسر importmap scopes ويوقف الإقلاع) + الاحتفاظ بالـprecache الكامل // بطاقة فحص 4: أيقونة الإشعارات كانت /favicon.ico (غير موجودة ومسار مطلق يكسر تحت مجلد Pages) // بطاقة فحص 3: توسيع الـprecache لكل ملفات الشيل + مطابقة الطلبات متجاهلة ?v= // fix users-manager refresh (window.loadOwnerUsers/Stats); split phase 4: js/app/*.js modules; المرحلة 3.0: js/card-gateway.js الجديد + تعديلات index.html // ← عدّاد غير المقروء يعمل أوفلاين من الكاش المحلي (dms-page.js)
const CACHE_NAME = 'bariq-shell-' + CACHE_VERSION;
const MEDIA_CACHE_NAME = 'bariq-media-' + CACHE_VERSION;

// المسارات نسبةً لمكان هذا الملف (تشتغل صح مع GitHub Pages تحت مجلد فرعي)
const PRECACHE_PATHS = [
  '',
  'index.html',
  'manifest.json',
  'terms.html',

  'css/style.css',
  'css/auth-ui.css',
  'css/military.css',
  'css/dms-page.css',
  'css/chat-bubbles.css',
  'css/bubble-blur.css',
  'css/bubble-color.css',
  'css/splash.css',
  'css/theme-toggle.css',

  'grades/grades.css',
  'grades/grades.js',

  'js/ai-assistant.js', 'js/ai-config.js', 'js/audit-log.js',
  'js/back-nav.js', 'js/bubble-blur.js', 'js/bubble-color.js', 'js/change-password.js',
  'js/chat-backgrounds.js', 'js/chat-search.js', 'js/connectivity.js', 'js/dm-extras.js',
  'js/dms-page.js', 'js/draft-messages.js', 'js/emoji-picker.js', 'js/auth-ui.js', 'js/auth-bridge.js',
  'js/library.js', 'js/lightbox.js', 'js/maintenance.js', 'js/newchat-ui.js', 'js/app-main.js', 'js/app/a-init-config.js', 'js/app/b-fcm-notif.js', 'js/app/c-upload-audit-stub.js', 'js/app/d-state-roles-email.js', 'js/app/e-toast-confirm.js', 'js/app/f-nav-chatpage.js', 'js/app/g-auth-profile-logout.js', 'js/app/h-avatars.js', 'js/app/i-authstate.js', 'js/app/j-dm-open.js', 'js/app/k-usercache-publicid.js', 'js/app/l-requests-chat-helpers-ban.js', 'js/app/m-chat-send-ui.js', 'js/app/n-admin-ban-unban.js', 'js/app/o-profile-save.js', 'js/app/p-content-loaders-forum.js', 'js/app/q-add-content.js', 'js/app/r-owner-admin-panels.js', 'js/app/s-badges-display.js', 'js/app/t-self-listener.js', 'js/app/u-rooms.js', 'js/app/v-profile-cards-picctx.js', 'js/app/w-visit-system.js', 'js/app/y-reply-fwd.js', 'js/app/z-tail-hooks.js', 'js/mention.js', 'js/military.js',
  'js/notif-panel.js', 'js/notif-settings.js', 'js/pin-message.js', 'js/poll.js',
  'js/report.js', 'js/settings-modal.js', 'js/skeleton-loader.js',
  'js/splash.js', 'js/theme-toggle.js', 'js/upload-engine.js',

  'images/app-icon.png',
  'images/app-icon-maskable.png',
  'images/default-student-female.png',
  'images/default-student-male.png',
  'images/military-icon.png',

  // بطاقة فحص 3: باقي ملفات الواجهة اللي index.html بيحمّلها مباشرة أو بالاستيراد (كانت خارج الـprecache)
  'css/account-archive.css', 'css/admin-redesign.css', 'css/apk-prompt.css', 'css/appearance-page.css',
  'css/attendance.css', 'css/chat-header.css', 'css/chat-list.css', 'css/chat-newdesign.css',
  'css/chat-reply.css', 'css/disclaimer-consent.css', 'css/expenses.css', 'css/forum-cards-colors.css',
  'css/instructions.css', 'css/mascot-designer.css', 'css/mascot-dialog-adapter.css', 'css/mascot-login-adapter.css',
  'css/mascot-toast-adapter.css', 'css/mascot-underdev-adapter.css', 'css/mascot.css', 'css/my-docs.css',
  'css/panel-grid.css', 'css/qr-share.css', 'css/quick-notifications.css', 'css/sheetaty.css',
  'css/site-design.css', 'css/study-schedule.css', 'css/theme-light-fix.css', 'css/tuition-fees.css',
  'css/update-notice.css', 'css/why-here-forum.css', 'js/account-archive.js', 'js/apk-prompt.js',
  'js/appearance-page.js', 'js/attendance.js', 'js/bubble-gradient-scroll.js', 'js/calls.js',
  'js/card-gateway.js', 'js/chat-core.js', 'js/chat-ctxmenu.js', 'js/chat-listener.js',
  'js/chat-newdesign-camera.js', 'js/chat-newdesign-wiring.js', 'js/chat-presence-text.js', 'js/chat-reactions.js',
  'js/chat-reply.js', 'js/chat-select.js', 'js/chat-send.js', 'js/disclaimer-consent.js',
  'js/expenses.js', 'js/firestore-safe.js', 'js/forum-badges.js', 'js/instructions.js',
  'js/language-ui.js', 'js/language.js', 'js/mascot-assets-registration.js', 'js/mascot-designer.js',
  'js/mascot-dialog-adapter.js', 'js/mascot-empty-state-adapter.js', 'js/mascot-grades-adapter.js', 'js/mascot-loading-adapter.js',
  'js/mascot-login-adapter.js', 'js/mascot-notification-adapter.js', 'js/mascot-notifs.js', 'js/mascot-override.js',
  'js/mascot-settings-adapter.js', 'js/mascot-splash-adapter.js', 'js/mascot-toast-adapter.js', 'js/mascot-underdev-adapter.js',
  'js/mascot.js', 'js/members-list.js', 'js/my-docs.js', 'js/notif-permission.js',
  'js/other-bubble-color.js', 'js/pwa-install.js', 'js/qr-share.js', 'js/quick-notifications.js',
  'js/schedule-repository.js', 'js/sheetaty.js', 'js/site-design.js', 'js/study-schedule-reminder.js',
  'js/study-schedule.js', 'js/tuition-fees.js', 'js/update-notice.js', 'js/updates-check.js',
  'js/why-here-forum.js', 'js/world-model.js', 'lang/egyptian.js', 'lang/english.js',
  'lost-found/css/lost-found.css', 'lost-found/js/lost-found.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const base = self.registration.scope; // ينتهي بـ "/" دايمًا
      const urls = PRECACHE_PATHS.map((p) => new URL(p, base).toString());
      // addAll بيفشل كله لو ملف واحد فشل، فبنحاول كل ملف لوحده
      // عشان ملف ناقص أو اتغير اسمه ميوقفش باقي التخزين
      return Promise.all(
        urls.map((u) => cache.add(u).catch(() => {}))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('bariq-shell-') && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      );
      await clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const isSameOrigin = req.url.startsWith(self.location.origin);
  const isMediaHost = req.url.startsWith('https://res.cloudinary.com') ||
                       req.url.startsWith('https://firebasestorage.googleapis.com');

  // ── وسائط خارجية (صور/ملفات/صوتيات من Cloudinary أو Firebase Storage) ──
  // كاش أولًا عشان أي ملف سبق فتحه يفضل ظاهر بدون نت، ولو مش موجود
  // في الكاش نجيبه من النت ونخزنه لأول مرة
  if (isMediaHost) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const resClone = res.clone();
            caches.open(MEDIA_CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // نسيب أي طلب تاني مش من نفس الموقع يعدي عادي (Firestore API، إلخ)
  if (!isSameOrigin) return;

  // طلبات التنقل (فتح الصفحة نفسها) — نجرب الشبكة الأول عشان تحديثات
  // الموقع توصل فورًا، ولو مفيش نت نرجع للنسخة المخزنة (app shell)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() =>
          caches.match(req).then(
            (cached) => cached || caches.match(new URL('index.html', self.registration.scope).toString())
          )
        )
    );
    return;
  }

  // باقي الملفات الثابتة (CSS/JS/صور) — كاش أولًا للسرعة وللعمل بدون نت،
  // مع تحديث النسخة المخزنة في الخلفية كل ما فيه اتصال (stale-while-revalidate)
  // ملاحظة مهمة: منستخدمش مفتاح موحد بدون ?v= — رد الكاش بيحمل عنوانه الأصلي،
  // ولو اتقدم لطلب عليه ?v= بيوصل للموديول بعنوان مختلف فيكسر مطابقة scopes بتاعة
  // الـimportmap (js/firestore-safe.js?v=prefs-1) ويوقف تحميل التطبيق كله.
  // المطابقة exact زي الأصل، والـprecache بيخدم الملفات المطلوبة بدون إصدار.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
