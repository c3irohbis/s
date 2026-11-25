/* ==========================================================================
   js/call-history.js — سجل المكالمات (ملف مستقل، لا يعدّل أي منطق قائم)
   - المصدر الوحيد: عامل bis-call-history على Supabase. لا قراءة/كتابة Firebase
     لبيانات السجل إطلاقًا — Firebase للإشارات العابرة فقط (calls.js).
   - كاش محلي دائم (localStorage لكل حساب): أول تحميل صفحة واحدة (50)، وأي
     تحديث بعدها incremental عبر since + جلب السجل المفرد عند أحداث المكالمات.
   - العرض: تبويب «المكالمات» نفسه (dmsCallsList) يرسم من الكاش فقط — صفر
     شبكة عند فتح التبويب — بشكل «الحديثة» المرجعي وبألوان بريق. لا نوافذ
     منبثقة ولا أيقونة سجل في هيدر الشات ولا زر عائم.
   - يصدّر: window.BisCallHistory = { renderCallsList, record, resolveIncoming,
     onSignal, sync } و window._chatCallEvents (مزود فقاعات الشات).
   ========================================================================== */
(function () {
  "use strict";
  if (window.BisCallHistory) return;

  var API = window.BIS_CALL_HISTORY_URL || "https://bis-call-history.cairohbis.workers.dev";
  var PAGE = 50;
  var CACHE_CAP = 500;

  var cache = null;          // {items:{id:rec}, order:[id..], lastSync, oldest, done}
  var cacheUid = null;
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
    /* «عرض الأقدم» في التبويب: الصفحات الأقدم من السجل العام فقط */
    var uid = me(); if (!uid) return;
    loadCache(uid);
    try {
      if (cache.done || !cache.oldest) return;
      var d = await api("/v1/calls/history?limit=" + PAGE + "&before=" + encodeURIComponent(cache.oldest));
      upsertMany(d.records);
      if ((d.records || []).length < PAGE) cache.done = true;
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
  /* مرجع «الحديثة»: اليوم، 05:56 / أمس، 05:45 / 21 نوفمبر، 12:14 */
  function fmtDay(iso) {
    var d = new Date(iso);
    var time = d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    if (d >= today) return "اليوم، " + time;
    var yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    if (d >= yesterday) return "أمس، " + time;
    return d.toLocaleDateString("ar-EG", { day: "numeric", month: "long" }) + "، " + time;
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

  /* ── تبويب «المكالمات»: قائمة «الحديثة» من الكاش فقط ── */
  function injectCss() {
    if ($("bchCss")) return;
    var st = document.createElement("style"); st.id = "bchCss";
    st.textContent =
      ".bch-calls-section{padding:14px 18px 6px;font-weight:900;font-size:15px;color:var(--text)}" +
      ".bch-call-row{display:flex;align-items:center;gap:12px;padding:9px 14px;cursor:pointer;border-radius:14px;transition:background .15s}" +
      ".bch-call-row:hover{background:var(--glass-bg)}" +
      ".bch-ava-letter{width:44px;height:44px;border-radius:50%;flex-shrink:0;background:var(--glass-bg-heavy);border:1px solid var(--glass-border);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;color:var(--gold)}" +
      ".bch-ci{flex:1;min-width:0}" +
      ".bch-cname{font-weight:800;font-size:14.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".bch-cname .bch-cnt{font-weight:700;color:var(--muted);font-size:12.5px}" +
      ".bch-csub{font-size:12px;color:var(--muted);font-weight:700;margin-top:3px;display:flex;align-items:center;gap:5px}" +
      ".bch-arrow{font-size:13px;font-weight:900}" +
      ".bch-arrow-out{color:var(--success)}" +
      ".bch-arrow-in{color:var(--success)}" +
      ".bch-missed .bch-cname{color:var(--danger)}" +
      ".bch-missed .bch-arrow{color:var(--danger)}" +
      ".bch-cbtn{width:38px;height:38px;border-radius:50%;flex-shrink:0;border:1px solid var(--glass-border);background:var(--glass-bg);color:var(--success);font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit}" +
      ".bch-cbtn:hover{background:var(--glass-highlight)}" +
      ".bch-calls-more{margin:6px 16px 14px;padding:10px;border-radius:14px;border:1px dashed var(--glass-border);background:transparent;color:var(--muted);font-weight:800;cursor:pointer;font-family:inherit}" +
      ".bch-calls-empty{padding:44px 16px;text-align:center;color:var(--muted);font-weight:700;font-size:13.5px}" +
      ".bch-event{display:flex;justify-content:center;margin:8px 0}" +
      ".bch-event-pill{background:var(--glass-bg);border:1px solid var(--glass-border);color:var(--muted);font-size:12px;font-weight:800;padding:6px 14px;border-radius:999px;direction:rtl}";
    document.head.appendChild(st);
  }

  /* تجميع عرضي: المكالمات المتتالية لنفس الطرف تُجمَّع بعدّاد مثل «لور (٤)» */
  function groupTab(recs, uid) {
    var groups = [];
    (recs || []).forEach(function (rec) {
      var peer = peerOf(rec, uid);
      var last = groups[groups.length - 1];
      if (last && last.peer.uid === peer.uid) { last.count++; return; }
      groups.push({ peer: peer, rec: rec, count: 1, missed: isMissed(rec, uid) });
    });
    return groups;
  }

  function tabRowsHtml(uid) {
    loadCache(uid);
    var recs = [];
    cache.order.forEach(function (id) { var r = cache.items[id]; if (r) recs.push(r); });
    var html = '<div class="bch-calls-section">الحديثة</div>';
    if (!recs.length) return html + '<div class="bch-calls-empty">لا مكالمات بعد</div>';
    html += groupTab(recs, uid).map(function (g) {
      var rec = g.rec;
      var dir = directionOf(rec, uid);
      var name = g.peer.name || "مستخدم";
      var cnt = g.count > 1 ? ' <span class="bch-cnt">(' + g.count.toLocaleString("ar-EG") + ")</span>" : "";
      var missed = g.missed ? " bch-missed" : "";
      var arrow = dir === "out" ? "↗" : "↙";
      var arrowCls = g.missed ? "bch-arrow" : (dir === "out" ? "bch-arrow bch-arrow-out" : "bch-arrow bch-arrow-in");
      var dur = (rec.status === "ended" && typeof rec.duration_sec === "number") ? " · " + fmtDur(rec.duration_sec) : "";
      return '<div class="bch-call-row' + missed + '" data-peer="' + esc(g.peer.uid) + '">' +
        '<div class="bch-ava-letter">' + esc(name.charAt(0) || "؟") + "</div>" +
        '<div class="bch-ci"><div class="bch-cname">' + esc(name) + cnt + "</div>" +
        '<div class="bch-csub"><span class="' + arrowCls + '">' + arrow + "</span><span>" + esc(fmtDay(rec.started_at)) + esc(dur) + "</span></div></div>" +
        '<button type="button" class="bch-cbtn" data-call="' + esc(g.peer.uid) + '" aria-label="معاودة الاتصال"><i class="fa-solid fa-phone"></i></button>' +
        "</div>";
    }).join("");
    if (!cache.done) html += '<button type="button" class="bch-calls-more" id="bchCallsMore">عرض الأقدم</button>';
    return html;
  }

  function renderCallsList(containerId) {
    var uid = me(); if (!uid) return;
    injectCss();
    var el = $(containerId || "dmsCallsList"); if (!el) return;
    loadCache(uid);
    el.innerHTML = tabRowsHtml(uid);
    el.querySelectorAll(".bch-call-row").forEach(function (row) {
      row.addEventListener("click", function () {
        var p = row.getAttribute("data-peer");
        try { if (p && typeof window.openDirectChat === "function") window.openDirectChat(p); } catch (e) {}
      });
    });
    el.querySelectorAll(".bch-cbtn").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var p = b.getAttribute("data-call");
        try { if (p && window.BisCalls && typeof window.BisCalls.start === "function") window.BisCalls.start({ kind: "dm", peerUid: p }); } catch (e2) {}
      });
    });
    var more = $("bchCallsMore");
    if (more) more.addEventListener("click", function () { loadOlder(); });
  }

  function refreshOpen() {
    try {
      var panel = $("dmspanel-calls");
      if (panel && panel.classList.contains("active")) renderCallsList("dmsCallsList");
    } catch (e) {}
    try { if (typeof window._chatRedraw === "function") window._chatRedraw(); } catch (e) {}
  }

  /* إقلاع: مزامنة خلفية بعد الدخول (نفس نمط calls.js) */
  var booted = false;
  function boot() {
    var uid = me();
    if (!uid) { setTimeout(boot, 1500); return; }
    if (booted) return;
    booted = true;
    loadCache(uid); sync();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.BisCallHistory = {
    renderCallsList: renderCallsList,
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
    _internals: { loadCache: loadCache, upsert: upsert, saveCache: saveCache, statusLabel: statusLabel, isMissed: isMissed, fmtDur: fmtDur, fmtDay: fmtDay, directionOf: directionOf, bubbleRow: bubbleRow, groupTab: groupTab, tabRowsHtml: tabRowsHtml, snapshot: function () { return cache; } }
  };
})();
