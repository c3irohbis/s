/* ==========================================================================
   js/calls.js — مكالمات صوتية وفيديو عبر LiveKit (ملف مستقل، لا يعدّل أي منطق قائم)
   - التوكن يُصدر من الـ Worker الحالي: POST <worker>/livekit-token
     مع Authorization: Bearer <Firebase ID token>. لا أسرار LiveKit هنا.
   - الغرفة تُحدَّد وتُتحقق صلاحيتها في الـ Worker فقط (DM: مشارك في privateChats،
     غرفة: نفس worldId أو مالك). المتصفح يرسل peerUid/roomId فقط.
   - أي فشل يُعالَج داخليًا ولا يؤثر على بقية الموقع.
   Globals المعرّفة: window.BisCalls = { start, end, isActive }
   ========================================================================== */
(function () {
  "use strict";
  if (window.BisCalls) return;

  var TOKEN_URL = window.BIS_LIVEKIT_TOKEN_URL ||
    "https://bis-calls.cairohbis.workers.dev/livekit-token";
  var SDK_URL = "https://cdn.jsdelivr.net/npm/livekit-client@2.22.4/dist/livekit-client.umd.js";

  var lkRoom = null, active = false, starting = false, timerId = null, t0 = 0, audioEls = {}, videoEls = {}, callUid = null, camOn = false;

  function toast(msg, type) { try { window.toast && window.toast(msg, type || "error"); } catch (e) {} }
  function $(id) { return document.getElementById(id); }

  /* ── تحميل SDK عند أول مكالمة فقط ── */
  var sdkPromise = null;
  function loadSdk() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (res, rej) {
      var s = document.createElement("script");
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

  async function fetchToken(target) {
    var u = window.currentUser;
    if (!u || !u.getIdToken) throw new Error("not-signed-in");
    var idToken = await u.getIdToken();
    var r = await fetch(TOKEN_URL, {
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
  }

  function errText(e) {
    var m = e && e.message;
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
      '<button type="button" id="bisCallMute" class="bis-call-btn" title="كتم">🎤</button>' +
      '<button type="button" id="bisCallCam" class="bis-call-btn" title="فيديو">📷</button>' +
      '<button type="button" id="bisCallEnd" class="bis-call-btn bis-call-end" title="إنهاء">📞</button>' +
      '</div></div>';
    document.body.appendChild(o);
    $("bisCallEnd").addEventListener("click", function () { end(); });
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
    if (!lkRoom) return;
    var lp = lkRoom.localParticipant;
    var on = !lp.isMicrophoneEnabled;
    lp.setMicrophoneEnabled(on).then(function () {
      var b = $("bisCallMute"); if (b) { b.textContent = on ? "🎤" : "🔇"; b.classList.toggle("off", !on); }
    }).catch(function () {});
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
    var lp = lkRoom.localParticipant;
    await lp.setCameraEnabled(on);
    camOn = on;
    var b = $("bisCallCam"); if (b) { b.textContent = on ? "🎥" : "📷"; b.classList.toggle("off", !on); }
    var t = $("bisCallTitle"); if (t && on && t.textContent.indexOf("فيديو") < 0) t.textContent += " · فيديو";
    lp.videoTrackPublications.forEach(function (pub) { /* معاينة محلية */
      if (pub.track) (on ? attachVideo : detachVideo)(pub.track, "local_" + (pub.trackSid || "me"), true);
    });
    if (!on) Object.keys(videoEls).forEach(function (k) { if (k.indexOf("local_") === 0) detachVideo(k); });
  }
  function toggleCam() {
    if (!lkRoom) return;
    setCam(!camOn).catch(function (e) { toast(errText(e)); });
  }

  async function end() {
    if (timerId) { clearInterval(timerId); timerId = null; }
    var r = lkRoom; lkRoom = null; active = false; starting = false; callUid = null;
    try { if (r) await r.disconnect(); } catch (e) {}
    cleanupAudio(); cleanupVideo();
    try { showOverlay(false); } catch (e) {}
    refreshBtn();
  }

  async function start(target, opts) {
    if (active || starting) { showOverlay(true); return; }
    target = target || currentTarget();
    if (!target) { toast("المكالمات متاحة في الرسائل الخاصة والغرف فقط"); return; }
    starting = true; callUid = curUid();
    try {
      if (!callUid) throw new Error("not-signed-in");
      showOverlay(true); setStatus("جاري الاتصال…");
      var title = (document.getElementById("chatTopName") || {}).textContent;
      $("bisCallTitle").textContent = title ? title.trim() : "مكالمة";

      var results = await Promise.all([loadSdk(), fetchToken(target)]);
      var LK = results[0], tk = results[1];
      if (!starting || curUid() !== callUid) throw new Error("user-changed"); /* أُنهيت أو تغيّر الحساب أثناء الجلب */

      var room = new LK.Room({ adaptiveStream: false, dynacast: false });
      lkRoom = room;
      room.on(LK.RoomEvent.TrackSubscribed, function (track, pub, p) {
        if (track.kind === "audio") {
          var el = track.attach(); el.autoplay = true; el.style.display = "none";
          document.body.appendChild(el); audioEls[track.sid || p.identity] = el;
        } else if (track.kind === "video") {
          attachVideo(track, track.sid || p.identity, false);
        }
      });
      room.on(LK.RoomEvent.TrackUnsubscribed, function (track) {
        if (track.kind === "video") detachVideo(track.sid || "remote");
        try { track.detach().forEach(function (e) { e.remove(); }); } catch (e) {}
      });
      room.on(LK.RoomEvent.TrackUnpublished, function (pub, p) {
        if (pub.kind === "video") detachVideo(pub.trackSid || (p && p.identity) || "remote");
      });
      room.on(LK.RoomEvent.LocalTrackPublished, function (pub) {
        if (pub.kind === "video" && pub.track) attachVideo(pub.track, "local_" + (pub.trackSid || "me"), true);
      });
      room.on(LK.RoomEvent.LocalTrackUnpublished, function (pub) {
        if (pub.kind === "video") detachVideo("local_" + (pub.trackSid || "me"));
      });
      room.on(LK.RoomEvent.ParticipantConnected, renderParts);
      room.on(LK.RoomEvent.ParticipantDisconnected, renderParts);
      room.on(LK.RoomEvent.ActiveSpeakersChanged, renderParts);
      room.on(LK.RoomEvent.Disconnected, function () { if (active) end(); });

      await room.connect(tk.url, tk.token);
      if (lkRoom !== room) { try { await room.disconnect(); } catch (e) {} return; } /* أُنهيت أثناء الاتصال */
      if (curUid() !== callUid) throw new Error("user-changed");
      await room.localParticipant.setMicrophoneEnabled(true);
      try { await room.startAudio(); } catch (e) {}
      if (opts && opts.video) { try { await setCam(true); } catch (e) { toast(errText(e)); } }

      active = true; starting = false; t0 = Date.now();
      timerId = setInterval(tick, 1000); tick(); renderParts(); refreshBtn();

      /* رنين لطرف الـ DM عبر مسار الإشعارات الحالي (لا تعديل عليه) */
      if (target.kind === "dm" && typeof window._sendNotification === "function") {
        try {
          var me = window.currentUser, myName = (window._currentUserData && window._currentUserData.name) || (me && me.displayName) || "مستخدم";
          window._sendNotification(target.peerUid, "📞 مكالمة من " + myName, "اضغط للدخول للمحادثة والانضمام للمكالمة",
            { type: "call", chatType: "call", senderUid: me ? me.uid : "", tag: "call_" + (me ? me.uid : "") });
        } catch (e) {}
      }
    } catch (e) {
      if (!e || e.message !== "user-changed") toast(errText(e));
      await end();
    }
  }

  /* ── زر المكالمة في هيدر الشات (يُحقن بدون تعديل HTML الحالي) ── */
  function refreshBtn() {
    try {
      if ((active || starting) && curUid() !== callUid) end(); /* خروج/تبديل حساب */
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
      "#bisCallOverlay:has(.bis-call-videos:not([style*='none'])) .bis-call-card{width:min(94vw,640px)}";
    document.head.appendChild(st);
  }

  window.BisCalls = {
    start: start,
    startVideo: function (target) { start(target, { video: true }); },
    end: end,
    isActive: function () { return active; }
  };

  function init() {
    try { injectCss(); refreshBtn(); setInterval(refreshBtn, 800); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.addEventListener("beforeunload", function () { try { lkRoom && lkRoom.disconnect(); } catch (e) {} });
})();
