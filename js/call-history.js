/* ==========================================================================
   js/call-history.js — سجل المكالمات (ملف مستقل، لا يعدّل أي منطق قائم)
   - المصدر الوحيد: عامل bis-call-history على Supabase. لا قراءة/كتابة Firebase
     لبيانات السجل إطلاقًا — Firebase للإشارات العابرة فقط (calls.js).
   - كاش محلي دائم (localStorage لكل حساب): أول تحميل صفحة واحدة (50)، وأي
     تحديث بعدها incremental عبر since + جلب السجل المفرد عند أحداث المكالمات.
   - يصدّر: window.BisCallHistory = { open, openChat, onSignal, record }
     و window._chatCallEvents (مزود فقاعات الشات لـ chat-listener).
   ========================================================================== */
(function () {
  "use strict";
  if (window.BisCallHistory) return;

  var API = window.BIS_CALL_HISTORY_URL || "https://bis-call-history.cairohbis.workers.dev";
  var PAGE = 50;
  var CACHE_CAP = 500;

  var cache = null;          // {items:{id:rec}, order:[id..], lastSync, oldest, done}
  var cacheUid = null;
  var modalScope = null;     // {kind:'all'} | {kind:'chat', chatId, peerUid}
  var modalFilter = "all";
  var chatPages = {};        // chatId -> {done, oldest}
  var syncing = false;

  function me() { var u = window.currentUser; return u && u.uid ? u.uid : null; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ── الكاش ── */
  function cacheKey(uid) { return "bch_" + uid; }
  function loadCache(uid) {
    if (cacheUid === uid && cache) return cache;
    cacheUid = uid; cache = null;
    try {
      var raw = localStorage.getItem(cacheKey(uid));
      if (raw) {
        var c = JSON.parse(raw);
        if (c && c.items && Array.isArray(c.order)) { cache = c; }
      }
    } catch (e) {}
    if (!cache) cache = { items: {}, order: [], lastSync: null, oldest: null, done: false };
    return cache;
  }
  function saveCache() {
    if (!cacheUid || !cache) return;
    try {
      while (cache.order.length > CACHE_CAP) {
        var drop = cache.order.pop();
        delete cache.items[drop];
      }
      localStorage.setItem(cacheKey(cacheUid), JSON.stringify(cache));
    } catch (e) {}
  }
  function upsert(rec) {
    if (!rec || !rec.id || !cache) return;
    var isNew = !cache.items[rec.id];
    cache.items[rec.id] = rec;
    if (isNew) {
      cache.order.push(rec.id);
      cache.order.sort(function (a, b) {
        var x = cache.items[a], y = cache.items[b];
        return (Date.parse(y.started_at) || 0) - (Date.parse(x.started_at) || 0);
      });
    }
    if (!cache.oldest || Date.parse(rec.started_at) < Date.parse(cache.oldest)) cache.oldest = rec.started_at;
  }
  function upsertMany(recs) { (recs || []).forEach(upsert); }

  /* ── الاتصال بالعامل ── */
  async function api(path, opts) {
    var u = window.currentUser;
    if (!u || !u.getIdToken) throw new Error("not-signed-in");
    var idToken = await u.getIdToken();
    var r = await fetch(API + path, {
      method: (opts && opts.method) || "GET",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + idToken },
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined
    });
    var data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) { var err = new Error((data && data.error) || ("http-" + r.status)); err.status = r.status; throw err; }
    return data;
  }

  /* تسجيل أحداث المكالمة (يُنادى من calls.js) — لا يقطع مسار المكالمة أبدًا */
  async function record(action, payload) {
    try {
      var data;
      if (action === "ring") data = await api("/v1/calls/ring", { method: "POST", body: payload });
      else data = await api("/v1/calls/" + encodeURIComponent(payload.callId) + "/" + action, { method: "POST", body: payload });
      if (data && data.record) { var uid = me(); if (uid) { loadCache(uid); upsert(data.record); saveCache(); refreshOpen(); } }
      return data && data.record;
    } catch (e) { return null; }
  }
  async function onSignal(callId) {
    /* حدث إشارة من الطرف الآخر: جلب السجل المفرد فقط (incremental) */
    try {
      var uid = me(); if (!uid || !callId) return;
      var data = await api("/v1/calls/" + encodeURIComponent(callId));
      if (data && data.record) { loadCache(uid); upsert(data.record); saveCache(); refreshOpen(); }
    } catch (e) {}
  }

  /* ── المزامنة المتزايدة ── */
  async function sync() {
    var uid = me(); if (!uid || syncing) return;
    syncing = true;
    try {
      loadCache(uid);
      if (!cache.lastSync) {
        var first = await api("/v1/calls/history?limit=" + PAGE);
        upsertMany(first.records);
        cache.done = (first.records || []).length < PAGE;
        var maxU = null;
        (first.records || []).forEach(function (r) { if (!maxU || r.updated_at > maxU) maxU = r.updated_at; });
        cache.lastSync = maxU || new Date().toISOString();
      } else {
        var inc = await api("/v1/calls/since?ts=" + encodeURIComponent(cache.lastSync));
        upsertMany(inc.records);
        if (inc.ts) cache.lastSync = inc.ts;
      }
      saveCache();
      refreshOpen();
    } catch (e) {} finally { syncing = false; }
  }
  async function loadOlder() {
    var uid = me(); if (!uid) return;
    loadCache(uid);
    try {
      if (modalScope && modalScope.kind === "chat") {
        var st = chatPages[modalScope.chatId] || (chatPages[modalScope.chatId] = { done: false, oldest: null });
        if (st.done) return;
        var before = st.oldest || (listForScope(modalScope).slice(-1)[0] || {}).started_at;
        if (!before) { st.done = true; return; }
        var d = await api("/v1/calls/chat/" + encodeURIComponent(modalScope.chatId) + "?limit=" + PAGE + "&before=" + encodeURIComponent(before));
        upsertMany(d.records);
        if ((d.records || []).length) st.oldest = d.records[d.records.length - 1].started_at;
        if ((d.records || []).length < PAGE) st.done = true;
      } else {
        if (cache.done || !cache.oldest) return;
        var d2 = await api("/v1/calls/history?limit=" + PAGE + "&before=" + encodeURIComponent(cache.oldest));
        upsertMany(d2.records);
        if ((d2.records || []).length < PAGE) cache.done = true;
      }
      saveCache();
      refreshOpen();
    } catch (e) {}
  }

  /* ── العرض: اتجاه + حالة + تسميات ── */
  function directionOf(rec, uid) { return rec.caller_uid === uid ? "out" : "in"; }
  function peerOf(rec, uid) { return rec.caller_uid === uid ? { uid: rec.callee_uid, name: rec.callee_name } : { uid: rec.caller_uid, name: rec.caller_name }; }
  function isMissed(rec, uid) {
    return directionOf(rec, uid) === "in" && ["no_answer", "declined", "busy", "canceled", "failed"].indexOf(rec.status) >= 0;
  }
  function statusLabel(rec, uid) {
    var dir = directionOf(rec, uid);
    var type = rec.call_type === "video" ? "فيديو" : "صوتية";
    var icon = rec.call_type === "video" ? "📹" : "📞";
    var base;
    switch (rec.status) {
      case "ended":     base = "مكالمة " + type + " " + (dir === "out" ? "صادرة" : "واردة"); break;
      case "accepted":  base = "مكالمة " + type + " جارية الآن"; break;
      case "ringing":   base = "مكالمة " + type + " (جاري الرنين…)"; break;
      case "no_answer": base = dir === "in" ? "مكالمة " + type + " فائتة" : "لم يتم الرد"; break;
      case "declined":  base = "مكالمة " + type + " مرفوضة"; break;
      case "busy":      base = "الطرف الآخر كان مشغولًا"; break;
      case "canceled":  base = "مكالمة " + type + " ملغاة"; break;
      case "failed":    base = "مكالمة " + type + " لم تكتمل"; break;
      default:          base = "مكالمة " + type;
    }
    return { icon: icon, text: base };
  }
  function fmtDur(sec) {
    if (typeof sec !== "number" || sec < 0) return "";
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m === 0) return s + " ث";
    return m + " د" + (s ? " و" + s + " ث" : "");
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var time = d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    if (d >= today) return time;
    return d.toLocaleDateString("ar-EG", { day: "numeric", month: "short" }) + " · " + time;
  }

  /* ── فقاعات الشات (مزود يقرأه chat-listener من الكاش فقط) ── */
  function bubbleRow(rec, uid) {
    var st = statusLabel(rec, uid);
    var el = document.createElement("div");
    el.className = "bch-event";
    el.setAttribute("data-bch", rec.id);
    var dur = "";
    if (rec.status === "ended" && typeof rec.duration_sec === "number") dur = " · " + fmtDur(rec.duration_sec);
    el.innerHTML = '<span class="bch-event-pill">' + st.icon + " " + esc(st.text) + " · " + esc(fmtTime(rec.started_at)) + esc(dur) + "</span>";
    return el;
  }
  window._chatCallEvents = function (chatId) {
    var uid = me(); if (!uid || !chatId) return [];
    loadCache(uid);
    /* أول ظهور لمحادثة لم تُجلب صفحتها: جلب خلفي مرة واحدة ثم إعادة رسم */
    if (!(chatId in chatPages)) {
      chatPages[chatId] = { done: false, oldest: null, pending: true };
      api("/v1/calls/chat/" + encodeURIComponent(chatId) + "?limit=" + PAGE)
        .then(function (d) {
          var st = chatPages[chatId] || (chatPages[chatId] = { done: false, oldest: null });
          st.pending = false;
          upsertMany(d.records);
          if ((d.records || []).length) st.oldest = d.records[d.records.length - 1].started_at;
          if ((d.records || []).length < PAGE) st.done = true;
          saveCache(); refreshOpen();
        }).catch(function () { delete chatPages[chatId]; });
    }
    var out = [];
    cache.order.forEach(function (id) {
      var rec = cache.items[id];
      if (rec && rec.chat_id === chatId) out.push({ ts: Date.parse(rec.started_at) || 0, el: bubbleRow(rec, uid) });
    });
    out.sort(function (a, b) { return a.ts - b.ts; });
    return out;
  };

  /* ── نافذة السجل ── */
  function injectCss() {
    if ($("bchCss")) return;
    var st = document.createElement("style"); st.id = "bchCss";
    st.textContent =
      "#bchOverlay{position:fixed;inset:0;z-index:99980;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:16px}" +
      ".bch-card{width:min(100%,420px);max-height:82vh;display:flex;flex-direction:column;border-radius:24px;background:rgba(var(--t-bg2-rgb),var(--glass-a));backdrop-filter:var(--glass-blur-heavy);-webkit-backdrop-filter:var(--glass-blur-heavy);border:1px solid var(--glass-border);box-shadow:0 24px 64px rgba(0,0,0,.65);color:var(--text);animation:modalSlideIn .22s cubic-bezier(.34,1.4,.64,1);overflow:hidden}" +
      ".bch-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 10px}" +
      ".bch-title{font-weight:900;font-size:16px;display:flex;gap:8px;align-items:center}" +
      ".bch-title i{color:var(--gold)}" +
      ".bch-close{background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--text);border-radius:12px;width:34px;height:34px;cursor:pointer;font-size:15px}" +
      ".bch-filters{display:flex;gap:8px;padding:0 18px 10px;flex-wrap:wrap}" +
      ".bch-chip{padding:6px 14px;border-radius:999px;border:1px solid var(--glass-border);background:var(--glass-bg);color:var(--muted);font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit}" +
      ".bch-chip.on{background:var(--glass-bg-heavy);color:var(--gold);border-color:var(--glass-border-gold)}" +
      ".bch-list{overflow-y:auto;padding:4px 14px 14px;display:flex;flex-direction:column;gap:6px}" +
      ".bch-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:16px;background:var(--glass-bg);border:1px solid var(--glass-border);cursor:pointer;transition:background .15s}" +
      ".bch-row:hover{background:var(--glass-highlight)}" +
      ".bch-ava{width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--glass-bg-heavy)}" +
      ".bch-info{flex:1;min-width:0}" +
      ".bch-name{font-weight:800;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".bch-sub{font-size:12px;color:var(--muted);font-weight:700;margin-top:2px}" +
      ".bch-side{text-align:left;flex-shrink:0}" +
      ".bch-dir{font-size:15px}" +
      ".bch-time{font-size:11px;color:var(--muted);font-weight:700;margin-top:2px;direction:ltr}" +
      ".bch-missed .bch-name,.bch-missed .bch-sub{color:var(--danger)}" +
      ".bch-more{margin:4px 14px 14px;padding:10px;border-radius:14px;border:1px dashed var(--glass-border);background:transparent;color:var(--muted);font-weight:800;cursor:pointer;font-family:inherit}" +
      ".bch-empty{padding:36px 16px;text-align:center;color:var(--muted);font-weight:700;font-size:13px}" +
      ".bch-event{display:flex;justify-content:center;margin:8px 0}" +
      ".bch-event-pill{background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--muted);font-size:12px;font-weight:800;padding:6px 14px;border-radius:999px;direction:rtl}";
    document.head.appendChild(st);
  }
  function ensureModal() {
    if ($("bchOverlay")) return $("bchOverlay");
    var o = document.createElement("div");
    o.id = "bchOverlay"; o.setAttribute("dir", "rtl");
    o.innerHTML =
      '<div class="bch-card">' +
      '<div class="bch-head"><div class="bch-title"><i class="fa-solid fa-clock-rotate-left"></i><span id="bchTitle">سجل المكالمات</span></div>' +
      '<button type="button" class="bch-close" id="bchClose" aria-label="إغلاق">✕</button></div>' +
      '<div class="bch-filters" id="bchFilters">' +
      '<button type="button" class="bch-chip on" data-f="all">الكل</button>' +
      '<button type="button" class="bch-chip" data-f="in">واردة</button>' +
      '<button type="button" class="bch-chip" data-f="out">صادرة</button>' +
      '<button type="button" class="bch-chip" data-f="missed">فائتة</button>' +
      '</div>' +
      '<div class="bch-list" id="bchList"></div>' +
      '<button type="button" class="bch-more" id="bchMore" style="display:none">عرض الأقدم</button>' +
      '</div>';
    document.body.appendChild(o);
    $("bchClose").addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && o.style.display === "flex") close(); });
    o.addEventListener("click", function (e) { if (e.target === o) close(); });
    $("bchFilters").addEventListener("click", function (e) {
      var c = e.target.closest(".bch-chip"); if (!c) return;
      modalFilter = c.getAttribute("data-f");
      o.querySelectorAll(".bch-chip").forEach(function (x) { x.classList.toggle("on", x === c); });
      renderList();
    });
    $("bchMore").addEventListener("click", function () { loadOlder(); });
    return o;
  }
  var userDir = {}, dirPrimed = false;
  function primeDir() {
    if (dirPrimed || typeof window._getWorldUsers !== "function") return Promise.resolve();
    dirPrimed = true;
    return Promise.resolve(window._getWorldUsers()).then(function (all) {
      (all || []).forEach(function (u) {
        var id = u.uid || u.id;
        if (id) userDir[id] = { name: u.name || "", photo: u.photo || "", gender: u.gender || "" };
      });
    }).catch(function () { dirPrimed = false; });
  }
  function resolveUser(uid) { return userDir[uid] || null; }
  function avatarHTML(uid, storedName) {
    var u = resolveUser(uid);
    if (u && u.photo) return '<img class="bch-ava" src="' + esc(u.photo) + '" alt="">';
    if (typeof window._defaultAvatarHTML === "function") {
      try { return '<div class="bch-ava" style="overflow:hidden">' + window._defaultAvatarHTML(u && u.gender, 42) + "</div>"; } catch (e) {}
    }
    return '<div class="bch-ava" style="display:flex;align-items:center;justify-content:center;font-size:19px">👤</div>';
  }
  function listForScope(scope) {
    var uid = me(); if (!uid || !cache) return [];
    var out = [];
    cache.order.forEach(function (id) {
      var rec = cache.items[id]; if (!rec) return;
      if (scope.kind === "chat" && rec.chat_id !== scope.chatId) return;
      if (modalFilter === "in" && directionOf(rec, uid) !== "in") return;
      if (modalFilter === "out" && directionOf(rec, uid) !== "out") return;
      if (modalFilter === "missed" && !isMissed(rec, uid)) return;
      out.push(rec);
    });
    return out;
  }
  function renderList() {
    var list = $("bchList"); if (!list || !modalScope) return;
    var uid = me(); if (!uid) return;
    var recs = listForScope(modalScope);
    if (!recs.length) {
      list.innerHTML = '<div class="bch-empty">لا توجد مكالمات بعد</div>';
    } else {
      list.innerHTML = recs.map(function (rec) {
        var peer = peerOf(rec, uid);
        var live = resolveUser(peer.uid);
        var name = (live && live.name) || peer.name || "مستخدم";
        var st = statusLabel(rec, uid);
        var dirIcon = rec.status === "ended" || rec.status === "accepted"
          ? (directionOf(rec, uid) === "out" ? "↗️" : "↙️") : "";
        var dur = (rec.status === "ended" && typeof rec.duration_sec === "number") ? " · " + fmtDur(rec.duration_sec) : "";
        var missed = isMissed(rec, uid) ? " bch-missed" : "";
        return '<div class="bch-row' + missed + '" data-peer="' + esc(peer.uid) + '">' + avatarHTML(peer.uid) +
          '<div class="bch-info"><div class="bch-name">' + esc(name) + '</div>' +
          '<div class="bch-sub">' + st.icon + " " + esc(st.text) + esc(dur) + '</div></div>' +
          '<div class="bch-side"><div class="bch-dir">' + dirIcon + '</div>' +
          '<div class="bch-time">' + esc(fmtTime(rec.started_at)) + '</div></div></div>';
      }).join("");
      list.querySelectorAll(".bch-row").forEach(function (row) {
        row.addEventListener("click", function () {
          var p = row.getAttribute("data-peer");
          close();
          try { if (p && typeof window.openDirectChat === "function") window.openDirectChat(p); } catch (e) {}
        });
      });
    }
    var more = $("bchMore");
    if (more) {
      var canMore = modalScope.kind === "chat"
        ? !(chatPages[modalScope.chatId] && chatPages[modalScope.chatId].done)
        : !cache.done;
      more.style.display = canMore && recs.length ? "" : "none";
    }
  }
  function refreshOpen() {
    if ($("bchOverlay") && $("bchOverlay").style.display === "flex") renderList();
    try { if (typeof window._chatRedraw === "function") window._chatRedraw(); } catch (e) {}
  }
  function open(scope) {
    var uid = me(); if (!uid) return;
    injectCss(); ensureModal();
    loadCache(uid);
    modalScope = scope; modalFilter = "all";
    $("bchTitle").textContent = scope.kind === "chat" ? "مكالمات هذه المحادثة" : "سجل المكالمات";
    $("bchFilters").querySelectorAll(".bch-chip").forEach(function (x) { x.classList.toggle("on", x.getAttribute("data-f") === "all"); });
    $("bchOverlay").style.display = "flex";
    try { $("bchClose").focus(); } catch (e) {}
    renderList();
    primeDir().then(refreshOpen);
    sync(); /* العرض من الكاش فورًا، والتحديث في الخلفية */
    if (scope.kind === "chat" && !chatPages[scope.chatId]) {
      chatPages[scope.chatId] = { done: false, oldest: null };
      api("/v1/calls/chat/" + encodeURIComponent(scope.chatId) + "?limit=" + PAGE)
        .then(function (d) {
          upsertMany(d.records);
          if ((d.records || []).length) chatPages[scope.chatId].oldest = d.records[d.records.length - 1].started_at;
          if ((d.records || []).length < PAGE) chatPages[scope.chatId].done = true;
          saveCache(); refreshOpen();
        }).catch(function () {});
    }
  }
  function close() { var o = $("bchOverlay"); if (o) o.style.display = "none"; modalScope = null; }

  /* ── أيقونة السجل بجانب زر المكالمة في هيدر الشات (حقن ذاتي، بلا تعديل HTML) ── */
  function ensureBtn() {
    try {
      var central = document.querySelector('.dms-fab-item[data-panel="calls"]');
      if (central && !central.dataset.bchBound) {
        central.dataset.bchBound = "1";
        central.addEventListener("click", function () { open({ kind: "all" }); });
      }
      var callBtn = $("chatCallBtn") || document.querySelector(".newchat-shell .call-circle svg:not(#chatMenuBtn)");
      if (!callBtn || $("bchHistBtn")) return;
      var host = callBtn.closest("svg") || callBtn;
      var b = document.createElement("span");
      b.id = "bchHistBtn"; b.textContent = "🕘";
      b.setAttribute("role", "button"); b.setAttribute("aria-label", "سجل مكالمات المحادثة"); b.setAttribute("tabindex", "0");
      /* مساحة لمس ≥ 36px: الحشو يكبّر الهدف دون تغيير مظهر الأيقونة */
      b.style.cssText = "cursor:pointer;font-size:18px;padding:9px;margin-inline-start:2px;user-select:none;-webkit-tap-highlight-color:transparent";
      host.parentNode.insertBefore(b, host.nextSibling);
      b.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b.click(); } });
      b.addEventListener("click", function () {
        var id = window._currentChatId;
        if (!id || id === "public" || (typeof id === "string" && id.indexOf("room:") === 0)) {
          open({ kind: "all" }); return;
        }
        var uid = me(); if (!uid) return;
        open({ kind: "chat", chatId: [uid, id].sort().join("_"), peerUid: id });
      });
    } catch (e) {}
  }

  /* إقلاع: مزامنة خلفية بعد الدخول + حقن الزر دوريًا (نفس نمط calls.js) */
  var booted = false;
  function boot() {
    var uid = me();
    if (!uid) { setTimeout(boot, 1500); return; }
    if (!booted) { booted = true; loadCache(uid); sync(); }
    ensureBtn();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { boot(); setInterval(ensureBtn, 1500); });
  else { boot(); setInterval(ensureBtn, 1500); }

  window.BisCallHistory = {
    open: function () { open({ kind: "all" }); },
    openChat: function (peerUid) {
      var uid = me(); if (!uid || !peerUid) return;
      open({ kind: "chat", chatId: [uid, peerUid].sort().join("_"), peerUid: peerUid });
    },
    record: record,
    resolveIncoming: async function (callerUid, signalAt) {
      try {
        var d = await api('/v1/calls/incoming?callerUid=' + encodeURIComponent(callerUid) + '&signalAt=' + encodeURIComponent(signalAt));
        if (d && d.record) { loadCache(me()); upsert(d.record); saveCache(); return d.record; }
      } catch (e) {}
      return null;
    },
    onSignal: onSignal,
    sync: sync,
    _internals: { loadCache: loadCache, upsert: upsert, saveCache: saveCache, statusLabel: statusLabel, isMissed: isMissed, fmtDur: fmtDur, directionOf: directionOf, bubbleRow: bubbleRow, snapshot: function () { return cache; } }
  };
})();
