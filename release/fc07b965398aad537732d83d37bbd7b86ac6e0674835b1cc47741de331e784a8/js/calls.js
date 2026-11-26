/* ==========================================================================
   js/calls.js — مكالمات صوتية وفيديو عبر LiveKit (ملف مستقل، لا يعدّل أي منطق قائم)
   - التوكن يُصدر من الـ Worker الحالي: POST <worker>/livekit-token
     مع Authorization: Bearer <Firebase ID token>. لا أسرار LiveKit هنا.
   - الغرفة تُحدَّد وتُتحقق صلاحيتها في الـ Worker فقط (DM: مشارك في privateChats،
     غرفة: نفس worldId أو مالك). المتصفح يرسل peerUid/roomId فقط.
   - أي فشل يُعالَج داخليًا ولا يؤثر على بقية الموقع.
   - سجل المكالمات (بطاقة سجل المكالمات): أحداث تُرسل fire-and-forget لـ
     window.BisCallHistory (js/call-history.js) — المصدر الوحيد للسجل هو
     عامل bis-call-history/Supabase. Firebase هنا للإشارات العابرة فقط،
     وفشل التسجيل لا يوقف المكالمة أبدًا.
   Globals المعرّفة: window.BisCalls = { start, end, isActive }
   ========================================================================== */
(function () {
  "use strict";
  if (window.BisCalls) return;

  var TOKEN_URL = window.BIS_LIVEKIT_TOKEN_URL ||
    "https://bis-calls.cairohbis.workers.dev/livekit-token";
  var SDK_URL = "https://cdn.jsdelivr.net/npm/livekit-client@2.22.4/dist/livekit-client.umd.js";

  var lkRoom = null, active = false, starting = false, timerId = null, t0 = 0, audioEls = {}, videoEls = {}, callUid = null, camOn = false;
  // One local attempt owns all async work. Cancelling invalidates late continuations.
  var attempt = null, endScreenTimer = null;
  var LIMITS = { sdk: 15000, token: 15000, connect: 20000, media: 30000, signal: 15000 };
  function beginAttempt() {
    if (endScreenTimer) { clearTimeout(endScreenTimer); endScreenTimer = null; }
    var a = { uid: curUid(), cancelled: false, cancels: [], joining: false, muting: false, camera: false };
    attempt = a; starting = true; callUid = a.uid; return a;
  }
  function valid(a) { return !!a && attempt === a && !a.cancelled && curUid() === a.uid; }
  function check(a) { if (!valid(a)) throw new Error("call-cancelled"); }
  function cancelAttempt(a) {
    if (!a || a.cancelled) return;
    a.cancelled = true;
    a.cancels.splice(0).forEach(function (f) { try { f(); } catch (e) {} });
  }
  function bounded(p, ms, label, a, late) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () { finish(new Error("timeout-" + label)); }, ms);
      function cancel() { finish(new Error("call-cancelled")); }
      function finish(err, value) {
        if (done) return; done = true; clearTimeout(timer);
        if (a) { var i = a.cancels.indexOf(cancel); if (i >= 0) a.cancels.splice(i, 1); }
        err ? reject(err) : resolve(value);
      }
      if (a) { a.cancels.push(cancel); if (!valid(a)) cancel(); }
      Promise.resolve(p).then(function (value) {
        if (done || (a && !valid(a))) { if (late) { try { late(value); } catch (e) {} } return; }
        finish(null, value);
      }, function (err) { finish(err); });
    });
  }
  function stopRoom(room) {
    if (!room) return;
    try { room.localParticipant.trackPublications.forEach(function (pub) { if (pub.track) pub.track.stop(); }); } catch (e) {}
    try { Promise.resolve(room.disconnect()).catch(function () {}); } catch (e) {}
  }
  function sameStamp(a, b) { return !!a && !!b && a.seconds === b.seconds && a.nanoseconds === b.nanoseconds; }
  function sameSignal(ctx, d) {
    return !!ctx && !!d && !!ctx.signalTs && d.callerUid === ctx.callerUid && sameStamp(ctx.signalTs, d.ts);
  }
  // Transactions are conditional server operations, not cancellable promises.
  function mutateSignal(ctx, state, a, reason) {
    if (!ctx || !ctx.ref || !ctx.signalTs) return Promise.resolve("unconfirmed");
    return fs().then(function (F) {
      return F.runTransaction(window.db, async function (tx) {
        if (a) check(a);
        var snap = await tx.get(ctx.ref);
        if (a) check(a);
        if (!snap.exists()) return "gone";
        if (!sameSignal(ctx, snap.data() || {})) return "different";
        var current = (snap.data() || {}).state;
        if ((state === "accepted" || state === "declined") && current !== "ringing") return "state-changed";
        if (state === "ended" && current === "ended") return "confirmed";
        if (state === "ended" && current !== "ringing" && current !== "accepted") return "state-changed";
        if (state === null) tx.delete(ctx.ref);
        else { var patch = { state: state }; if (reason) patch.reason = reason; tx.update(ctx.ref, patch); }
        return "confirmed";
      });
    });
  }
  function closeSignal(ctx, wasActive) { return mutateSignal(ctx, wasActive ? "ended" : null, null); }
  function reportCleanup(ctx, wasActive) {
    if (!ctx || !ctx.ref || ctx.cleanupPending) return;
    if (ctx.signalTs) ctx.cleanupPending = true;
    // Preserve observation of the actual result even after our UI wait expires.
    var pending = true, timedOut = false;
    var timer = setTimeout(function () {
      if (!pending) return; timedOut = true;
      toast("المكالمة مقفولة عندك؛ تأكيد الإنهاء متأخر، والمهلة لا تلغي عملية الخادم");
    }, LIMITS.signal);
    closeSignal(ctx, wasActive).then(function (result) {
      pending = false; clearTimeout(timer);
      if (result === "unconfirmed") toast("المكالمة مقفولة عندك؛ لا توجد هوية إشارة مؤكدة لتنظيفها بأمان");
      else if (timedOut && result === "confirmed") toast("تم تأكيد إنهاء إشارة المكالمة المتأخرة");
    }, function () {
      ctx.cleanupPending = false;
      pending = false; clearTimeout(timer);
      toast("المكالمة مقفولة عندك، لكن تعذر تأكيد الإنهاء على الخادم؛ قد يبقى رنين للطرف الآخر");
    });
  }
  function signalError(a, err) {
    if (!valid(a)) return;
    toast("انقطع تحديث حالة المكالمة، حاول الاتصال من جديد"); end(true);
  }
  /* إشارات الرنين عبر مستند activeCalls/{calleeUid} — الاسم داخل المستند؛
     معاملات حماية الهوية تضيف قراءات، وعددها وتكلفتها غير مقيسين،
     مستمع واحد لكل مستخدم، والمدة تتحسب محليًا من لحظة الاتصال عند كل طرف */
  var fsP = null, callCtx = null, sigUnsub = null, ringTimer = null, inboxUnsub = null, inboxUid = null, inboxErrAt = 0, inboxErrStreak = 0, incomingData = null;
  function fs() { if (!fsP) fsP = import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"); return fsP; }
  function myName() { var me = window.currentUser; return ((window._currentUserData && window._currentUserData.name) || (me && me.displayName) || "مستخدم"); }
  /* ── سجل المكالمات: أحداث غير حاجبة (لا await)، فشلها لا يمس مسار المكالمة ── */
  function bchRec(action, payload) {
    try { if (window.BisCallHistory && payload && payload.callId) window.BisCallHistory.record(action, payload); } catch (e) {}
  }
  function bchSync(callId) { /* الطرف اللي سجّل هو الطرف التاني: نجيب النسخة النهائية */
    try { if (window.BisCallHistory && callId) window.BisCallHistory.onSignal(callId); } catch (e) {}
  }
  function newCallId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    /* بديل بصيغة UUIDv4 (العامل يرفض غيرها) */
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 3 | 8);
      return v.toString(16);
    });
  }
  function sigStop() { if (sigUnsub) { try { sigUnsub(); } catch (e) {} sigUnsub = null; } if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; } }

  function toast(msg, type) { try { window.toast && window.toast(msg, type || "error"); } catch (e) {} }
  function $(id) { return document.getElementById(id); }

  /* ── تحميل SDK عند أول مكالمة فقط ── */
  var sdkPromise = null, sdkScript = null;
  function loadSdk() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (res, rej) {
      var s = document.createElement("script"); sdkScript = s;
      s.src = SDK_URL; s.async = true;
      s.onload = function () { window.LivekitClient ? res(window.LivekitClient) : rej(new Error("sdk")); };
      s.onerror = function () { sdkPromise = null; rej(new Error("sdk-load")); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  /* ── الهدف الحالي من الشات المفتوح (بدون افتراض أسماء غرف) ── */
  function curUid() { var u = window.currentUser; return u && u.uid ? u.uid : null; }
  function currentTarget() {
    var id = window._currentChatId;
    if (!id || id === "public") return null;
    if (typeof id === "string" && id.indexOf("room:") === 0) return { kind: "room", roomId: id.slice(5) };
    return { kind: "dm", peerUid: id };
  }

  async function fetchToken(target, a) {
    var u = window.currentUser;
    if (!u || !u.getIdToken) throw new Error("not-signed-in");
    var controller = new AbortController();
    var abort = function () { controller.abort(); };
    if (a) a.cancels.push(abort);
    var timer = setTimeout(abort, LIMITS.token);
    try {
    var idToken = await u.getIdToken();
    if (a) check(a);
    var r = await fetch(TOKEN_URL, {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + idToken },
      body: JSON.stringify(target)
    });
    var data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok || !data || !data.token) {
      var err = new Error((data && data.error) || ("http-" + r.status));
      err.status = r.status; throw err;
    }
    return data;
    } finally {
      clearTimeout(timer);
      if (a) { var i = a.cancels.indexOf(abort); if (i >= 0) a.cancels.splice(i, 1); }
    }
  }

  function errText(e) {
    var m = e && e.message;
    if (m === "signal-changed") return "انتهت المكالمة أو تغيرت إشارتها، لم يتم قبول مكالمة أخرى";
    if (m === "peer-busy") return "الطرف الآخر مشغول حاليًا";
    if (m === "timeout-media") return "انتهت مهلة تجهيز الميكروفون أو الصوت أو الكاميرا، راجع الإذن ثم حاول من جديد";
    if (m === "timeout-sdk") return "تأخر تحميل مكتبة المكالمات، حاول من جديد";
    if (m === "timeout-token" || (e && e.name === "AbortError")) return "تأخر تجهيز الاتصال، حاول من جديد";
    if (m === "timeout-connect") return "انتهت مهلة الاتصال، تأكد من الشبكة وحاول من جديد";
    if (m === "timeout-signal") return "تأخر تحديث حالة المكالمة، حاول من جديد";
    if (m === "not-participant") return "لا توجد محادثة بينكما بعد. أرسل رسالة أولًا ثم حاول الاتصال"; /* DM فقط */
    if (m === "world-mismatch" || m === "room-not-accessible") return "غير مسموح لك بدخول هذه المكالمة";
    if (e && e.status === 401) return "انتهت الجلسة، سجّل الدخول من جديد";
    if (m === "livekit-not-configured") return "خدمة المكالمات غير مفعّلة بعد";
    if (m === "sdk-load") return "تعذّر تحميل مكتبة المكالمات، تأكد من الإنترنت";
    if (e && (e.name === "NotAllowedError" || /permission/i.test(m || ""))) return "اسمح للموقع باستخدام الميكروفون أو الكاميرا";
    return "تعذّر بدء المكالمة، حاول تاني";
  }

  /* ── واجهة المكالمة ── */
  function ensureOverlay() {
    if ($("bisCallOverlay")) return $("bisCallOverlay");
    var o = document.createElement("div");
    o.id = "bisCallOverlay";
    o.setAttribute("dir", "rtl");
    o.innerHTML =
      '<div class="bis-call-card">' +
      '<div class="bis-call-title"><i class="fa-solid fa-phone"></i><span id="bisCallTitle">مكالمة</span></div>' +
      '<div class="bis-call-status" id="bisCallStatus">جاري الاتصال…</div>' +
      '<div class="bis-call-videos" id="bisCallVideos" style="display:none"></div>' +
      '<div class="bis-call-parts" id="bisCallParts"></div>' +
      '<div class="bis-call-actions">' +
      '<button type="button" id="bisCallMute" class="bis-call-btn" title="كتم" aria-label="كتم الصوت">🎤</button>' +
      '<button type="button" id="bisCallCam" class="bis-call-btn" title="فيديو" aria-label="تشغيل الفيديو">📷</button>' +
      '<button type="button" id="bisCallEnd" class="bis-call-btn bis-call-end" title="إنهاء" aria-label="إنهاء المكالمة">📞</button>' +
      '</div></div>';
    document.body.appendChild(o);
    $("bisCallEnd").addEventListener("click", function () { end(true); });
    $("bisCallMute").addEventListener("click", toggleMute);
    $("bisCallCam").addEventListener("click", toggleCam);
    return o;
  }
  function showOverlay(show) { var o = ensureOverlay(); o.style.display = show ? "flex" : "none"; }
  function setStatus(t) { var s = $("bisCallStatus"); if (s) s.textContent = t; }

  function renderParts() {
    var box = $("bisCallParts"); if (!box || !lkRoom) return;
    var list = [lkRoom.localParticipant].concat(Array.from(lkRoom.remoteParticipants.values()));
    box.innerHTML = "";
    list.forEach(function (p) {
      var d = document.createElement("div");
      d.className = "bis-call-part" + (p.isSpeaking ? " speaking" : "");
      var nm = document.createElement("span");
      nm.textContent = (p.name || "مستخدم") + (p === lkRoom.localParticipant ? " (أنت)" : "");
      d.appendChild(nm);
      box.appendChild(d);
    });
  }

  function toggleMute() {
    var room = lkRoom, a = attempt;
    if (!active || !room || !valid(a) || a.muting) return;
    a.muting = true;
    var lp = room.localParticipant, on = !lp.isMicrophoneEnabled;
    function syncMute() {
      if (!valid(a)) { stopRoom(room); return; }
      var b = $("bisCallMute"); if (b) { b.textContent = lp.isMicrophoneEnabled ? "🎤" : "🔇"; b.classList.toggle("off", !lp.isMicrophoneEnabled); }
    }
    var operation = Promise.resolve().then(function () { check(a); return lp.setMicrophoneEnabled(on); });
    operation.then(function () { a.muting = false; }, function () { a.muting = false; });
    bounded(operation, LIMITS.media, "media", a, syncMute).then(syncMute).catch(function (e) { if (valid(a)) toast(errText(e)); });
  }

  function tick() {
    var s = Math.floor((Date.now() - t0) / 1000);
    var mm = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
    setStatus("متصل · " + mm + ":" + ss);
  }

  /* ── فيديو: شبكة البعيد + معاينة محلية PiP ── */
  function attachVideo(track, key, isLocal) {
    var box = $("bisCallVideos"); if (!box || videoEls[key]) return;
    var w = document.createElement("div");
    w.className = isLocal ? "bis-call-vid local" : "bis-call-vid";
    var v = track.attach();
    v.playsInline = true; v.autoplay = true;
    if (isLocal) v.muted = true;
    w.appendChild(v); box.appendChild(w); videoEls[key] = w;
    box.style.display = "grid";
  }
  function detachVideo(key) {
    var w = videoEls[key]; if (!w) return;
    try { w.querySelectorAll("video").forEach(function (v) { v.srcObject = null; }); } catch (e) {}
    try { w.remove(); } catch (e) {}
    delete videoEls[key];
    var box = $("bisCallVideos");
    if (box && !Object.keys(videoEls).length) box.style.display = "none";
  }
  function cleanupAudio() {
    Object.keys(audioEls).forEach(function (k) { try { audioEls[k].remove(); } catch (e) {} });
    audioEls = {};
  }
  function cleanupVideo() { Object.keys(videoEls).forEach(detachVideo); camOn = false; }
  async function setCam(on) {
    if (!lkRoom) return;
    var room = lkRoom, a = attempt, lp = room.localParticipant;
    if (!valid(a) || a.camera) return;
    a.camera = true;
    try {
      await bounded(Promise.resolve().then(function () { check(a); return lp.setCameraEnabled(on); }), LIMITS.media, "media", a, function () { stopRoom(room); });
    } catch (e) {
      if (valid(a) && e.message === "timeout-media") { toast(errText(e)); end(true); }
      throw e;
    } finally { a.camera = false; }
    check(a); camOn = on;
    var b = $("bisCallCam"); if (b) { b.textContent = on ? "🎥" : "📷"; b.classList.toggle("off", !on); }
    var t = $("bisCallTitle"); if (t && on && t.textContent.indexOf("فيديو") < 0) t.textContent += " · فيديو";
    lp.videoTrackPublications.forEach(function (pub) { /* معاينة محلية */
      if (pub.track) (on ? attachVideo : detachVideo)(pub.track, "local_" + (pub.trackSid || "me"), true);
    });
    if (!on) Object.keys(videoEls).forEach(function (k) { if (k.indexOf("local_") === 0) detachVideo(k); });
  }
  function toggleCam() {
    if (!active || !lkRoom) return;
    var a = attempt; setCam(!camOn).catch(function (e) { if (valid(a)) toast(errText(e)); });
  }

  /* writeSig=true ⇒ نبلغ الطرف التاني (إنهاء أثناء المكالمة = update، إلغاء أثناء الرنين = حذف) */
  async function end(writeSig, details) {
    details = details || {};
    var duration = t0 ? Date.now() - t0 : 0;
    var a = attempt; attempt = null;
    cancelAttempt(a);
    if (timerId) { clearInterval(timerId); timerId = null; }
    var ctx = callCtx; callCtx = null;
    var wasActive = active;
    sigStop();
    var r = lkRoom; lkRoom = null; active = false; starting = false; callUid = null; t0 = 0;
    // Release media and state before network work; the duration screen is display-only.
    cleanupAudio(); cleanupVideo(); refreshBtn(); stopRoom(r);
    if (duration > 0) {
      var seconds = Math.floor(duration / 1000);
      setStatus("انتهت المكالمة · " + String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0"));
      endScreenTimer = setTimeout(function () { endScreenTimer = null; if (!attempt) showOverlay(false); }, 2500);
    } else if (!endScreenTimer) showOverlay(false);
    if (ctx && ctx.callId) {
      if (wasActive) bchRec("end", { callId: ctx.callId });
      else if (ctx.role === "caller" && (!details.remote || details.reason)) {
        var payload = { callId: ctx.callId }; if (details.reason) payload.reason = details.reason;
        bchRec("cancel", payload);
      } else if (details.remote) bchSync(ctx.callId);
    }
    if (writeSig && ctx) reportCleanup(ctx, wasActive);
  }

  /* ── مستمع المكالمات الواردة: مستند واحد لكل مستخدم، بيقرأ بس عند التغيير ── */
  async function ensureInbox() {
    var uid = curUid();
    if (uid === inboxUid) return;
    if (inboxUnsub) { try { inboxUnsub(); } catch (e) {} inboxUnsub = null; }
    if (!uid || !window.db) return; /* db مش جاهز لسه: نحاول تاني مع التيك الجاي */
    if (inboxErrStreak && Date.now() - inboxErrAt < Math.min(60000, 2000 * inboxErrStreak)) return; /* تراجع تصاعدي بعد خطأ البث: حماية للكوتا من إعادة اشتراك فاشلة كل 800ms */
    inboxUid = uid;
    var F = await fs();
    if (inboxUid !== uid || !curUid()) return;
    inboxUnsub = F.onSnapshot(F.doc(window.db, "activeCalls", uid), onIncoming, function (err) {
      // شفاء ذاتي: لو بث المراقبة مات بخطأ، نسجّل الرمز ونصفّر الحالة عشان تيك refreshBtn (800ms) يعيد الاشتراك تلقائيًا
      try { console.warn("inbox listener error:", err && (err.code || err.message || err)); } catch (e) {}
      inboxErrStreak++; inboxErrAt = Date.now();
      if (inboxUnsub) { try { inboxUnsub(); } catch (e) {} inboxUnsub = null; }
      if (inboxUid === uid) inboxUid = null;
    });
  }

  function incomingRecord(d) {
    if (!d || !window.BisCallHistory || !d.ts || typeof d.ts.toMillis !== "function") return Promise.resolve(null);
    if (!d._recordPromise) d._recordPromise = Promise.race([
      window.BisCallHistory.resolveIncoming(d.callerUid, new Date(d.ts.toMillis()).toISOString()),
      new Promise(function (r) { setTimeout(function () { r(null); }, 1500); })
    ]).then(function (rec) { if (rec) d.callId = rec.id; return rec; });
    return d._recordPromise;
  }

  function onIncoming(snap) {
    try {
      inboxErrStreak = 0; /* بث سليم ⇒ تصفير التراجع */
      if (!snap.exists()) { hideIncoming(); return; }
      var d = snap.data() || {};
      if (d.state === "ringing") {
        var fresh = (d.ts && typeof d.ts.toMillis === "function") ? (Date.now() - d.ts.toMillis() < 60000) : true;
        if (!fresh) return;
        if (active || starting || callCtx) { /* مشغول ⇒ رفض تلقائي */
          var uid = inboxUid;
          fs().then(function (F) {
            if (curUid() !== uid) return "different";
            return mutateSignal({ ref: F.doc(window.db, "activeCalls", uid), callerUid: d.callerUid, signalTs: d.ts }, "declined", null, "busy");
          }).then(function (result) {
            if (result === "confirmed") incomingRecord(d).then(function (rec) { if (rec) bchRec("decline", { callId: rec.id, reason: "busy" }); });
          }).catch(function () {});
          return;
        }
        incomingRecord(d);
        showIncoming(d);
      } else { hideIncoming(); }
    } catch (e) {}
  }

  /* ── واجهة المكالمة الواردة (نفس نظام الزجاج بتاع الموقع) ── */
  function ensureIncoming() {
    if ($("bisIncomingOverlay")) return $("bisIncomingOverlay");
    var o = document.createElement("div");
    o.id = "bisIncomingOverlay";
    o.setAttribute("dir", "rtl");
    o.innerHTML =
      '<div class="bis-call-card">' +
      '<div class="bis-call-title"><i class="fa-solid fa-phone-volume"></i><span>مكالمة واردة</span></div>' +
      '<div class="bis-call-inc-name" id="bisIncName">مستخدم</div>' +
      '<div class="bis-call-status">يريد بدء مكالمة معك</div>' +
      '<div class="bis-call-actions">' +
      '<button type="button" id="bisIncAccept" class="bis-call-btn bis-call-accept" title="رد" aria-label="رد على المكالمة">📞</button>' +
      '<button type="button" id="bisIncDecline" class="bis-call-btn bis-call-end" title="رفض" aria-label="رفض المكالمة">📞</button>' +
      '</div></div>';
    document.body.appendChild(o);
    $("bisIncAccept").addEventListener("click", acceptIncoming);
    $("bisIncDecline").addEventListener("click", declineIncoming);
    return o;
  }
  function showIncoming(d) {
    incomingData = d;
    var o = ensureIncoming();
    $("bisIncName").textContent = d.callerName || "مستخدم";
    o.style.display = "flex";
  }
  function hideIncoming() { incomingData = null; var o = $("bisIncomingOverlay"); if (o) o.style.display = "none"; }

  /* الرد: تحديث المستند ثم دخول فوري — الطرفين بيشوفوا "جاري الاتصال" في نفس اللحظة */
  async function acceptIncoming() {
    var d = incomingData; if (!d || active || starting || attempt) return;
    var a = beginAttempt();
    hideIncoming(); showOverlay(true); setStatus("جاري قبول المكالمة…");
    try {
      await bounded(incomingRecord(d), LIMITS.signal, "signal", a); check(a);
      var F = await bounded(fs(), LIMITS.signal, "signal", a); check(a);
      var ref = F.doc(window.db, "activeCalls", inboxUid);
      check(a);
      var ctx = { ref: ref, peerUid: d.callerUid, callerUid: d.callerUid, signalTs: d.ts, role: "callee", title: d.callerName || "مكالمة", callId: d.callId || null };
      callCtx = ctx;
      var accepting = mutateSignal(ctx, "accepted", a);
      // A commit already submitted can finish after cancellation. Only clean this identity.
      accepting.then(function (result) { if (!valid(a) && result === "confirmed") reportCleanup(ctx, false); }, function () {});
      var accepted = await bounded(accepting, LIMITS.signal, "signal", a); check(a);
      if (accepted !== "confirmed") throw new Error("signal-changed");
      bchRec("accept", { callId: d.callId });
      sigUnsub = F.onSnapshot(ref, function (snap) { if (valid(a)) onSignal(snap); }, function (e) { signalError(a, e); });
      join({ kind: "dm", peerUid: d.callerUid }, null, callCtx.title, a);
    } catch (e) { if (valid(a)) { toast(errText(e)); end(true); } }
  }
  async function declineIncoming() {
    var d = incomingData, uid = curUid(); hideIncoming(); if (!d || !uid) return;
    await incomingRecord(d);
    if (curUid() !== uid) return;
    var ctx = { ref: null, callerUid: d.callerUid, signalTs: d.ts };
    try {
      var F = await bounded(fs(), LIMITS.signal, "signal", null);
      if (curUid() !== uid) return;
      ctx.ref = F.doc(window.db, "activeCalls", uid);
      var result = await bounded(mutateSignal(ctx, "declined", null), LIMITS.signal, "signal", null);
      if (result === "confirmed") bchRec("decline", { callId: d.callId });
      else if (result === "unconfirmed") toast("أُغلق الطلب عندك، لكن لم تتأكد هوية المكالمة لرفضها على الخادم");
    } catch (e) { toast("أُغلق الطلب عندك، لكن رفض المكالمة على الخادم غير مؤكد"); }
  }

  /* ── الرنين الصادر ── */
  async function startDm(target, opts, a) {
    check(a);
    if (!callUid) throw new Error("not-signed-in");
    showOverlay(true);
    var title = (document.getElementById("chatTopName") || {}).textContent;
    title = title ? title.trim() : "مكالمة";
    $("bisCallTitle").textContent = title;
    setStatus("جاري الرنين…");
    var F = await bounded(fs(), LIMITS.signal, "signal", a); check(a);
    var ref = F.doc(window.db, "activeCalls", target.peerUid);
    var ctx = { ref: ref, peerUid: target.peerUid, callerUid: a.uid, role: "caller", title: title, opts: opts || null };
    callCtx = ctx;
    /* مكالمة سابقة بتسيب المستند بحالة ended/declined، والقواعد بتمنع setDoc
       فوق مستند موجود (بيتحسب update) — فبنمسح القديم أولًا بشرط الحالة
       النهائية فقط، أبدًا ringing/accepted. القراءة+المسح جوه معاملة واحدة:
       لو المستند اتغيّر في النص المعاملة بتتعاد تلقائيًا ثم تتوقف، فمستحيل
       نمسح رنين جديد أو مكالمة شغالة. */
    try {
      await bounded(F.runTransaction(window.db, async function (tx) {
        check(a);
        var prev = await tx.get(ref); check(a);
        if (!prev.exists()) return;
        var st = (prev.data() || {}).state;
        if (st === "ended" || st === "declined") { tx.delete(ref); return; }
        throw new Error("peer-busy");
      }), LIMITS.signal, "signal", a); check(a);
    } catch (e) {
      check(a);
      if (e && e.message === "timeout-signal") throw e;
      if (e && e.message === "peer-busy") { toast("الطرف الآخر مشغول حاليًا"); await end(false); return; }
      /* خطأ قراءة/مسح عابر: نكمّل — setDoc هيفشل طبيعي لو لسه فيه مانع */
    }
    /* تسجيل الرنين قبل الإشارة (السجل لا يشير لمستند غير موجود)، بحد أقصى
       1.5ث حتى لا يتعطل الرنين لو العامل بطيء — فشله لا يمنع المكالمة */
    var callId = newCallId();
    try {
      await Promise.race([
        (window.BisCallHistory ? window.BisCallHistory.record("ring", { callId: callId, calleeUid: target.peerUid, calleeName: title, callType: (opts && opts.video) ? "video" : "audio", callerName: myName(), chatId: [callUid, target.peerUid].sort().join("_") }) : null),
        new Promise(function (res) { setTimeout(res, 1500); })
      ]);
    } catch (e) {}
    check(a); ctx.callId = callId;
    // The current rules do not let an ordinary caller read an absent peer document,
    // so creation cannot be changed to a client transaction without a wider change.
    var writing = F.setDoc(ref, { callerUid: callUid, callerName: myName(), calleeUid: target.peerUid, state: "ringing", ts: F.serverTimestamp() });
    // Use the existing signal listener to capture the committed timestamp.
    var unsub = F.onSnapshot(ref, function (snap) {
      var d = snap.exists() ? (snap.data() || {}) : null;
      if (d && d.callerUid !== ctx.callerUid) { if (valid(a)) finishSignal("تغيرت حالة المكالمة، حاول من جديد", false); return; }
      if (d && d.callerUid === ctx.callerUid && d.ts && !ctx.signalTs && !(snap.metadata && snap.metadata.hasPendingWrites)) ctx.signalTs = d.ts;
      if (!valid(a)) {
        return;
      }
      if (d) onSignal(snap);
    }, function (e) { signalError(a, e); });
    sigUnsub = unsub;
    writing.then(function () {
      if (!valid(a)) {
        if (ctx.signalTs) reportCleanup(ctx, false);
        else toast("اتقفلت المكالمة عندك، لكن قد يصل رنين متأخر للطرف الآخر بسبب الشبكة");
      }
    }, function () {});
    await bounded(writing, LIMITS.signal, "signal", a); check(a);
    if (!a.joining) ringTimer = setTimeout(function () { if (valid(a)) finishSignal("لا يوجد رد", true); }, 45000);
    /* إشعار خارجي بالمسار الحالي (احتياطي لو الطرف التاني مش فاتح التطبيق) */
    if (typeof window._sendNotification === "function") {
      try {
        window._sendNotification(target.peerUid, "📞 مكالمة من " + myName(), "افتح التطبيق للرد على المكالمة",
          { type: "call", chatType: "call", senderUid: callUid, tag: "call_" + callUid });
      } catch (e) {}
    }
  }

  function onSignal(snap) {
    if (!callCtx) return;
    if (!snap.exists()) { finishSignal(null, false); return; } /* الطرف التاني قفل/مسح */
    var d = snap.data() || {};
    if (d.callerUid !== callCtx.callerUid || (callCtx.signalTs && d.ts && !sameStamp(callCtx.signalTs, d.ts))) {
      finishSignal("تغيرت إشارة المكالمة؛ تم إغلاق المحاولة القديمة فقط", false); return;
    }
    if (!callCtx.signalTs && d.ts && !(snap.metadata && snap.metadata.hasPendingWrites)) callCtx.signalTs = d.ts;
    if (d.state === "accepted" && callCtx.role === "caller" && starting) {
      if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
      bchSync(callCtx.callId);
      join({ kind: "dm", peerUid: callCtx.peerUid }, callCtx.opts, callCtx.title, attempt);
    } else if (d.state === "declined") {
      /* الرفض يخصنا بس واحنا لسه بنرن — بعد الاتصال بيكون رنين تاني اترد عليه تلقائيًا */
      if (starting) finishSignal(d.reason === "busy" ? "الطرف الآخر مشغول حاليًا" : "تم رفض المكالمة", false);
    } else if (d.state === "ended") {
      finishSignal(null, false);
    }
  }

  /* إنهاء بسبب إشارة من الطرف التاني: يقفل هنا فورًا ويبان مدة المكالمة محليًا */
  function finishSignal(msg, isTimeout) {
    if (msg) toast(msg);
    end(!!isTimeout, { remote: true, reason: isTimeout ? "no_answer" : null });
  }

  async function start(target, opts) {
    if (active || starting) { showOverlay(true); return; }
    target = target || currentTarget();
    if (!target) { toast("المكالمات متاحة في الرسائل الخاصة والغرف فقط"); return; }
    var a = beginAttempt();
    try {
      if (target.kind === "dm") await startDm(target, opts || null, a); /* DM: رنين أولًا ثم اتصال بعد الرد */
      else await join(target, opts || null, null, a); /* الغرف: دخول مباشر */
    } catch (e) {
      if (valid(a)) { toast(errText(e)); await end(true); }
    }
  }

  async function join(target, opts, titleText, a) {
    if (!valid(a) || active || a.joining) return;
    a.joining = true;
    var room = null;
    try {
      if (!callUid) throw new Error("not-signed-in");
      showOverlay(true); setStatus("جاري الاتصال…");
      if (titleText) $("bisCallTitle").textContent = titleText;
      else if (!$("bisCallTitle").textContent) $("bisCallTitle").textContent = "مكالمة";

      var results = await Promise.all([
        bounded(loadSdk(), LIMITS.sdk, "sdk", a).catch(function (e) { if (e.message === "timeout-sdk") { if (sdkScript) { sdkScript.onload = sdkScript.onerror = null; sdkScript.remove(); sdkScript = null; } sdkPromise = null; } throw e; }),
        bounded(fetchToken(target, a), LIMITS.token, "token", a)
      ]); check(a);
      var LK = results[0], tk = results[1];
      if (!starting || curUid() !== callUid) throw new Error("user-changed"); /* أُنهيت أو تغيّر الحساب أثناء الجلب */

      room = new LK.Room({ adaptiveStream: false, dynacast: false });
      lkRoom = room;
      room.on(LK.RoomEvent.TrackSubscribed, function (track, pub, p) {
        if (!valid(a)) { try { track.detach().forEach(function (el) { el.remove(); }); } catch (e) {} return; }
        if (track.kind === "audio") {
          var el = track.attach(); el.autoplay = true; el.style.display = "none";
          document.body.appendChild(el); audioEls[track.sid || p.identity] = el;
        } else if (track.kind === "video") {
          attachVideo(track, track.sid || p.identity, false);
        }
      });
      room.on(LK.RoomEvent.TrackUnsubscribed, function (track) {
        if (!valid(a)) return;
        if (track.kind === "video") detachVideo(track.sid || "remote");
        try { track.detach().forEach(function (e) { e.remove(); }); } catch (e) {}
      });
      room.on(LK.RoomEvent.TrackUnpublished, function (pub, p) {
        if (!valid(a)) return;
        if (pub.kind === "video") detachVideo(pub.trackSid || (p && p.identity) || "remote");
      });
      room.on(LK.RoomEvent.LocalTrackPublished, function (pub) {
        if (!valid(a)) { try { if (pub.track) pub.track.stop(); } catch (e) {} return; }
        if (pub.kind === "video" && pub.track) attachVideo(pub.track, "local_" + (pub.trackSid || "me"), true);
      });
      room.on(LK.RoomEvent.LocalTrackUnpublished, function (pub) {
        if (!valid(a)) return;
        if (pub.kind === "video") detachVideo("local_" + (pub.trackSid || "me"));
      });
      room.on(LK.RoomEvent.ParticipantConnected, function () { if (valid(a)) renderParts(); });
      room.on(LK.RoomEvent.ParticipantDisconnected, function () { if (valid(a)) renderParts(); });
      room.on(LK.RoomEvent.ActiveSpeakersChanged, function () { if (valid(a)) renderParts(); });
      room.on(LK.RoomEvent.Disconnected, function () { if (valid(a)) { toast("انقطع اتصال المكالمة"); end(true); } });

      await bounded(room.connect(tk.url, tk.token), LIMITS.connect, "connect", a, function () { stopRoom(room); }); check(a);
      setStatus("اسمح باستخدام الميكروفون من نافذة المتصفح…");
      await bounded(room.localParticipant.setMicrophoneEnabled(true), LIMITS.media, "media", a, function () { stopRoom(room); }); check(a);
      await bounded(room.startAudio(), LIMITS.media, "media", a, function () { stopRoom(room); }); check(a);
      if (opts && opts.video) {
        try { await setCam(true); }
        catch (e) { check(a); toast(errText(e)); }
        check(a);
      }
      check(a);
      active = true; starting = false; t0 = Date.now();
      timerId = setInterval(tick, 1000); tick(); renderParts(); refreshBtn();
    } catch (e) {
      if (valid(a)) {
        toast(errText(e));
        if (callCtx && callCtx.callId) bchRec("fail", { callId: callCtx.callId });
        end(true);
      }
      stopRoom(room);
    }
  }

  /* ── زر المكالمة في هيدر الشات (يُحقن بدون تعديل HTML الحالي) ── */
  function refreshBtn() {
    try {
      if ((active || starting) && curUid() !== callUid) end(true); /* خروج/تبديل حساب */
      ensureInbox(); /* مستمع المكالمات الواردة (مرة واحدة لكل حساب) */
      /* أيقونة الاتصال الموجودة أصلًا في هيدر الشات الجديد (.call-circle) */
      var btn = $("chatCallBtn");
      if (!btn) {
        var ic = document.querySelector(".newchat-shell .call-circle svg:not(#chatMenuBtn)");
        if (!ic) return;
        ic.id = "chatCallBtn"; ic.setAttribute("aria-label", "مكالمة صوتية");
        ic.style.cursor = "pointer";
        ic.addEventListener("click", function () { start(); });
        btn = ic;
      }
      btn.style.display = currentTarget() ? "" : "none";
      btn.classList.toggle("in-call", active);
    } catch (e) {}
  }

  function injectCss() {
    if ($("bisCallCss")) return;
    var st = document.createElement("style"); st.id = "bisCallCss";
    /* نفس نظام الزجاج بتاع .modal/.smod في css/style.css — كل الألوان من توكنز الموقع
       (--t-*-rgb, --glass-*, --gold, --text, --muted, --danger) فبتلاقم الفاتح والليلي تلقائيًا */
    st.textContent =
      "#bisCallOverlay{position:fixed;inset:0;z-index:99990;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:20px}" +
      ".bis-call-card{width:min(100%,340px);padding:28px 22px;border-radius:28px;background:rgba(var(--t-bg2-rgb),var(--glass-a));backdrop-filter:var(--glass-blur-heavy);-webkit-backdrop-filter:var(--glass-blur-heavy);border:1px solid var(--glass-border);box-shadow:0 24px 64px rgba(0,0,0,.65),0 4px 16px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.08);color:var(--text);text-align:center;display:flex;flex-direction:column;gap:14px;animation:modalSlideIn .22s cubic-bezier(.34,1.4,.64,1)}" +
      ".bis-call-title{font-weight:900;font-size:17px;display:flex;align-items:center;justify-content:center;gap:9px}" +
      ".bis-call-title i{color:var(--gold)}" +
      ".bis-call-status{color:var(--muted);font-size:13px;font-weight:700}" +
      ".bis-call-parts{display:flex;flex-direction:column;gap:8px;max-height:32vh;overflow:auto}" +
      ".bis-call-part{padding:10px 14px;border-radius:14px;background:var(--glass-bg);border:1px solid var(--glass-border);font-size:14px;font-weight:700;color:var(--text)}" +
      ".bis-call-part.speaking{border-color:var(--glass-border-gold);box-shadow:inset 0 0 0 1px var(--glass-border-gold)}" +
      ".bis-call-actions{display:flex;gap:16px;justify-content:center}" +
      ".bis-call-btn{width:52px;height:52px;border-radius:50%;border:1px solid var(--glass-border);background:var(--glass-bg-heavy);color:var(--text);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}" +
      ".bis-call-btn:hover{background:var(--glass-highlight)}" +
      ".bis-call-btn.off{opacity:.55}" +
      ".bis-call-end{background:var(--danger);border-color:var(--danger);color:#fff;transform:rotate(135deg)}" +
      "#chatCallBtn.in-call{stroke:var(--success)}" +
      ".bis-call-videos{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;position:relative}" +
      ".bis-call-vid{border-radius:20px;overflow:hidden;background:#000;border:1px solid var(--glass-border);aspect-ratio:4/3}" +
      ".bis-call-vid video{width:100%;height:100%;object-fit:cover}" +
      ".bis-call-vid.local{position:absolute;bottom:6px;inset-inline-start:6px;width:86px;z-index:2;box-shadow:0 4px 14px rgba(0,0,0,.4)}" +
      ".bis-call-vid.local:only-child{position:static;width:auto}" +
      ".bis-call-vid.local video{transform:scaleX(-1)}" +
      "#bisCallOverlay:has(.bis-call-videos:not([style*='none'])) .bis-call-card{width:min(94vw,640px)}" +
      "#bisIncomingOverlay{position:fixed;inset:0;z-index:99991;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);padding:20px}" +
      ".bis-call-inc-name{font-size:20px;font-weight:900;color:var(--text)}" +
      ".bis-call-accept{background:var(--success);border-color:var(--success);color:#fff;animation:bisRing 1.2s ease-in-out infinite}" +
      "@keyframes bisRing{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}";
    document.head.appendChild(st);
  }

  window.BisCalls = {
    start: start,
    startVideo: function (target) { start(target, { video: true }); },
    end: function () { return end(true); },
    isActive: function () { return active; }
  };

  function init() {
    try { injectCss(); refreshBtn(); setInterval(refreshBtn, 800); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.addEventListener("beforeunload", function () { try { lkRoom && lkRoom.disconnect(); } catch (e) {} });
})();
