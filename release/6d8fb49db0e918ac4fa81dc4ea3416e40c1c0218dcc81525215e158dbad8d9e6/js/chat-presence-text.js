/* ══════════════════════════════════════════════════════════════
   CHAT ACTIVITY EYE — زر العين (آخر نشاط) في هيدر محادثات الـ DM
   ▸ ضغطة على العين = قراءة واحدة فقط من Firestore: آخر رسالة بعتها
     الطرف الآخر في هذه المحادثة (limit 1). بدون كتابة، بدون مستمع،
     بدون مؤقّت. النتيجة تظهر في #chatTopOnline وتتخزّن في ذاكرة
     الجلسة فقط (لا قراءة جديدة عند الرجوع للمحادثة).
   ▸ يحتاج فهرس: messages (uid ASC, createdAt DESC) — firestore.indexes.json
   ▸ الحالات الأخرى ("مباشر — الجميع" / "غرفة عامة") يتحكم فيها index.html.
   ══════════════════════════════════════════════════════════════ */
(function () {
  var _results = {};   // "<myUid>:<chatId>" → ms (0 = لا يوجد نشاط)
  var _busy = false;

  function _key(chatId) { return (window.currentUser && window.currentUser.uid || "") + ":" + chatId; }

  function _isDm(chatId) {
    return !!chatId && chatId !== "public" && chatId.indexOf("room:") !== 0;
  }

  function formatLastActivity(ms) {
    var d = new Date(ms), now = new Date();
    var time = d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: true });
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (sameDay) return "آخر نشاط " + time;
    var day = d.toLocaleDateString("ar-EG", { day: "numeric" });
    var month = d.toLocaleDateString("ar-EG", { month: "long" });
    return "آخر نشاط " + time + " الساعة " + day + " " + month;
  }

  function _text(chatId) {
    var k = _key(chatId);
    if (!(k in _results)) return "خاص";
    return _results[k] ? formatLastActivity(_results[k]) : "لا يوجد نشاط بعد";
  }

  // إعادة رسم #chatTopOnline لمحادثة DM (آخر نتيجة محفوظة أو "خاص")
  function _renderDmHeaderActivity(chatId) {
    var el = document.getElementById("chatTopOnline");
    if (el) el.textContent = _text(chatId);
  }
  window._renderDmHeaderActivity = _renderDmHeaderActivity;

  // إظهار العين في الـ DM فقط
  window._syncActivityEye = function (chatId) {
    var b = document.getElementById("activityEyeBtn");
    if (b) b.classList.toggle("show", _isDm(chatId));
  };

  async function _onEyeClick(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    var chatId = window._currentChatId;
    var btn = document.getElementById("activityEyeBtn");
    if (_busy || !_isDm(chatId) || !window.db || !window.currentUser) return;
    _busy = true;
    if (btn) btn.classList.add("loading");
    try {
      var fs = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      var q = fs.query(
        fs.collection(window.db, window.chatColPath(chatId)),
        fs.where("uid", "==", chatId),
        fs.orderBy("createdAt", "desc"),
        fs.limit(1)
      );
      var snap = await fs.getDocs(q);
      var ms = 0;
      snap.forEach(function (d) {
        var c = d.data().createdAt;
        ms = (c && c.toMillis && c.toMillis()) || (c && c.seconds ? c.seconds * 1000 : 0);
      });
      _results[_key(chatId)] = ms;
      if (window._currentChatId === chatId) _renderDmHeaderActivity(chatId);
    } catch (err) {
      console.warn("[activity-eye]", err && err.code || err);
      if (typeof window.toast === "function") window.toast("تعذّر جلب آخر نشاط", "error");
    } finally {
      _busy = false;
      if (btn) btn.classList.remove("loading");
    }
  }

  function _bind() {
    var b = document.getElementById("activityEyeBtn");
    if (b && !b._eyeBound) { b._eyeBound = true; b.addEventListener("click", _onEyeClick); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _bind);
  else _bind();
})();
