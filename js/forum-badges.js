/* ============================================================
   forum-badges.js — تنبيهات كروت المنتدى (Unread Badges) بنظام "البوابة"
   ------------------------------------------------------------
   الفكرة: بدل ما كل كارت يسأل Firestore "في جديد؟" في كل دخول، عندنا مستند بوابة
   صغير فيه آخر وقت نشر لكل قسم:
     forumMeta/{worldId}  → أقسام العالم   (worldScoped + singleDoc)
     forumMeta/_global    → أقسام عامة     (باقي الأقسام)
   - الدخول = قراءة واحدة لكل بوابة (2 إجمالًا) + مستمع الدرجات (underUser).
   - كارت اتغيّر وقته بعد آخر مرة فتحه المستخدم فقط هو اللي يتعدّ (getCountFromServer).
   - اللي بيكتب البصمة هو js/firestore-safe.js تلقائيًا بعد أي كتابة ناجحة على مجموعة
     مسجّلة هنا (addDoc/setDoc/updateDoc/deleteDoc/writeBatch/runTransaction) عبر
     window.__forumGate.touch — لا حاجة لتعديل ملفات النشر.
   - آخر قراءة: users/{uid}/cardReads/{key} (مصدر الحقيقة) + نسخة محلية للمقارنة السريعة.
   - كارت جديد = سطر واحد في SOURCES (+ HTML) — راجع FORUM-NEW-CARD-GUIDE.md.
   ============================================================ */
(function () {
  "use strict";

  const FS_URL = "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

  // كل كارت وبياناته الحقيقية. النطاق (البوابة) بيتحدد تلقائيًا من _scope():
  //   underUser            → بدون بوابة (مستمع خاص بالمستخدم)
  //   worldScoped/singleDoc → forumMeta/{worldId}
  //   غير ذلك               → forumMeta/_global
  const SOURCES = [
    { key: "news",          iconClass: "forum-card-icon--news",          col: "news",              timeField: "createdAt", worldScoped: true },
    { key: "lectures",      iconClass: "forum-card-icon--lectures",      col: "lectures",           timeField: "createdAt", worldScoped: true },
    { key: "exams",         iconClass: "forum-card-icon--exams",         col: "exams",              timeField: "createdAt", worldScoped: true },
    { key: "sections",      iconClass: "forum-card-icon--sections",      col: "sections",           timeField: "createdAt", worldScoped: true },
    { key: "studyschedule", iconClass: "forum-card-icon--studyschedule", col: "studySchedule",      timeField: "createdAt", worldScoped: true },
    { key: "sheetaty",      iconClass: "forum-card-icon--sheetaty",      col: "sheets",             timeField: "createdAt", worldScoped: true },
    { key: "grades",        iconClass: "forum-card-icon--grades",        col: "records",            timeField: "updatedAt", underUser: true },
    { key: "lostfound",     iconClass: "forum-card-icon--lostfound",     col: "lostFound",          timeField: "createdAt", statusIn: ["published", "found"] },
    { key: "military",      iconClass: "forum-card-icon--military",      col: "militaryMaterials",  timeField: "createdAt" },
    { key: "instructions",  iconClass: "forum-card-icon--instructions",  col: "instructions",       timeField: "updatedAt" },
    { key: "tuition",       iconClass: "forum-card-icon--tuition",       col: "tuitionFees",        timeField: "updatedAt", kind: "singleDoc" },
  ];

  function _scope(src) {
    if (src.underUser) return null;
    return (src.worldScoped || src.kind === "singleDoc") ? "world" : "global";
  }

  const BY_COL = {};
  SOURCES.forEach((s) => { if (_scope(s)) BY_COL[s.col] = s; });

  let _db, _fs, _uid, _worldId;
  const _counts = {};    // key -> عدد حالي
  const _unsubs = {};    // اسم -> دالة إلغاء الاشتراك
  const _st = {};        // key -> { ss: آخر بصمة تحققنا عندها/فتحنا الكارت، pos: 1 لو فيه غير مقروء }
  const _verified = {};  // key -> البصمة اللي اتحقق منها في الجلسة دي
  const _lastStamp = {}; // key -> آخر بصمة وصلت من البوابة
  const _vt = {};        // key -> رقم آخر تحقق (يتجاهل الردود المتأخرة)
  const _marking = {};   // key -> وعد كتابة "تم القراءة" الجارية
  const _ready = {};     // key -> true بعد أول نتيجة مؤكدة لكارت الدرجات
  const _deferred = {};  // key -> true: كارت محتاج عدّ لكن التبويب في الخلفية (يتأجل لحد الرجوع)
  const POS_MAX_AGE = 12 * 3600 * 1000; // أقصى عمر لعدد غير مقروء محفوظ قبل إعادة التحقق منه
  let _sig = null;       // بصمة "uid|worldId" الحالية — تغيّرها = إعادة تشغيل كاملة
  let _gen = 0;          // رقم الجيل: يُبطل أي عملية قديمة كانت منتظرة await
  let _bound = false;    // ربط click مرة واحدة فقط
  let _paused = false;   // مراقبة الحساب متوقفة لأن التبويب في الخلفية

  async function _loadFs() {
    if (!_fs) _fs = await import(FS_URL);
    return _fs;
  }

  /* ───────────── كتابة البصمة (تُستدعى من firestore-safe.js بعد كتابة ناجحة) ───────────── */
  const _stampQ = new Map();
  let _stampTimer = false;

  function _activeWorld() {
    return (typeof window.activeWorldContext === "function") ? window.activeWorldContext() : null;
  }

  function _touch(op, path, data, opts) {
    try {
      const seg = String(path || "").split("/");
      if (seg.length > 2) return;                       // مجموعات فرعية (تعليقات...) خارج العدّاد
      const src = BY_COL[seg[0]];
      if (!src) return;
      if(src.key==='sheetaty'&&window.__BLISS_SHEETS_MODE!=='firebase')return;
      if(src.key==='news'&&window.__BLISS_NEWS_MODE!=='firebase')return;
      if(src.key==='lectures'&&window.__BLISS_LECTURES_MODE!=='firebase')return;
      if(src.key==='exams'&&window.__BLISS_EXAMS_MODE!=='firebase')return;
      if(src.key==='sections'&&window.__BLISS_SECTIONS_MODE!=='firebase')return;
      if(src.key==='studyschedule'&&window.__BLISS_STUDYSCHEDULE_MODE!=='firebase')return;
      if(src.key==='military'&&window.__BLISS_MILITARY_MODE!=='firebase')return;
      if(src.key==='tuition'&&window.__BLISS_TUITION_MODE!=='firebase')return;
      if (src.timeField === "createdAt") {
        // العدّاد بيحسب المستندات الجديدة: التعديل العادي ما يغيّرش النتيجة، إلا تغيّر الحالة (راحت فين؟)
        const obj = (data && typeof data === "object") ? data : null;
        if (op === "update" && !(src.statusIn && obj && "status" in obj)) return;
        if (op === "set" && opts && opts.merge && !(obj && src.timeField in obj)) return;
      }
      let docId = "_global";
      if (_scope(src) === "world") {
        docId = (data && typeof data === "object" && data.worldId) || (src.kind === "singleDoc" && seg[1]) || _activeWorld();
      }
      if (!docId) return;
      _stampQ.set(docId + "|" + src.key, { docId: docId, key: src.key });
      if (!_stampTimer) { _stampTimer = true; Promise.resolve().then(_flushStamps); }
    } catch (e) { /* لا يكسر الكتابة الأصلية أبدًا */ }
  }

  async function _flushStamps() {
    _stampTimer = false;
    const items = Array.from(_stampQ.values());
    _stampQ.clear();
    if (!items.length || !window.db) return;
    try {
      const fs = await _loadFs();
      const byDoc = {};
      items.forEach((it) => { (byDoc[it.docId] = byDoc[it.docId] || {})[it.key] = fs.serverTimestamp(); });
      await Promise.all(Object.keys(byDoc).map((docId) =>
        fs.setDoc(fs.doc(window.db, "forumMeta", docId), { s: byDoc[docId] }, { merge: true })
          .catch((e) => console.warn("[forum-gate] stamp failed:", docId, e && e.code))
      ));
    } catch (e) { console.warn("[forum-gate] stamp failed:", e && e.code); }
  }

  window.__forumGate = { touch: _touch };

  /* ───────────── هل الكارت ده لسه بيستخدم مسار Firebase للشارات؟ ─────────────
     لو كروت النطاق كلها اتنقلت للـ gateway (supabase) مفيش داعي لمستمع البوابة
     أصلًا؛ ولو أي كارت رجع firebase (رولباك) المستمع بيتركب زي ما كان بالظبط. */
  const _FLAG_BY_KEY = { news:"NEWS", lectures:"LECTURES", exams:"EXAMS", sections:"SECTIONS", studyschedule:"STUDYSCHEDULE", sheetaty:"SHEETS", military:"MILITARY", tuition:"TUITION" };
  function _cardUsesFirebase(src) {
    if (src.key === "instructions") return false;   // شارته من الـ gateway
    const f = _FLAG_BY_KEY[src.key];
    if (!f) return true;                            // lostfound: Firebase حاليًا
    return window["__BLISS_" + f + "_MODE"] === "firebase";
  }
  function _scopeNeedsGate(scope) {
    return SOURCES.some((src) => _scope(src) === scope && _cardUsesFirebase(src));
  }

  /* ───────────── الشكل (badge على الكارت + badge على شريط "المنتدى") ───────────── */
  function _injectStyles() {
    if (document.getElementById("forumBadgeStyles")) return;
    const s = document.createElement("style");
    s.id = "forumBadgeStyles";
    s.textContent =
      ".forum-section-card{position:relative}" +
      ".fb-badge{position:absolute;top:6px;left:6px;min-width:18px;height:18px;padding:0 5px;" +
      "border-radius:999px;background:#ff6b6b;color:#fff;font-size:11px;font-weight:700;" +
      "line-height:18px;text-align:center;box-shadow:0 0 0 2px rgba(0,0,0,.15);z-index:2;direction:ltr}" +
      ".nav-item[data-nav=\"tab-forum\"]{position:relative}" +
      ".fb-nav-badge{position:absolute;top:2px;left:50%;transform:translateX(8px);min-width:16px;height:16px;" +
      "padding:0 4px;border-radius:999px;background:#b30000;color:#fff;font-size:10px;font-weight:700;" +
      "line-height:16px;text-align:center;box-shadow:0 0 0 2px rgba(0,0,0,.2);" +
      "animation:fbPulse 1.6s ease-in-out infinite;z-index:3;direction:ltr}" +
      "@keyframes fbPulse{0%,100%{transform:translateX(8px) scale(1)}50%{transform:translateX(8px) scale(1.2)}}";
    document.head.appendChild(s);
  }

  function _cardEl(src) {
    const icon = document.querySelector("." + src.iconClass);
    return icon ? icon.closest(".forum-section-card") : null;
  }

  function _renderCard(src) {
    const el = _cardEl(src);
    if (!el) return;
    const n = _counts[src.key] || 0;
    let badge = el.querySelector(":scope > .fb-badge");
    if (n <= 0) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement("span"); badge.className = "fb-badge"; el.appendChild(badge); }
    badge.textContent = n > 99 ? "99+" : String(n);
  }

  function _renderNav() {
    const nav = document.querySelector('.nav-item[data-nav="tab-forum"]');
    if (!nav) return;
    let unreadCards = 0;
    SOURCES.forEach((s) => { if ((_counts[s.key] || 0) > 0) unreadCards++; });
    let badge = nav.querySelector(":scope > .fb-nav-badge");
    if (unreadCards <= 0) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement("span"); badge.className = "fb-nav-badge"; nav.appendChild(badge); }
    badge.textContent = unreadCards > 99 ? "99+" : String(unreadCards);
  }

  function _renderAll() { SOURCES.forEach(_renderCard); _renderNav(); }

  /* ───────────── الحالة المحلية (localStorage) ───────────── */
  function _lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function _lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* تجاهل */ } }
  function _stKey(scope) { return "fbGate1_" + _uid + "_" + (scope === "world" ? _worldId : "g"); }

  function _loadState() {
    Object.keys(_st).forEach((k) => { delete _st[k]; });
    ["world", "global"].forEach((sc) => { const o = _lsGet(_stKey(sc)); if (o) Object.assign(_st, o); });
  }

  function _saveState() {
    ["world", "global"].forEach((sc) => {
      const o = {};
      SOURCES.forEach((s) => { if (_scope(s) === sc && _st[s.key]) o[s.key] = _st[s.key]; });
      _lsSet(_stKey(sc), o);
    });
  }

  /* ───────────── العدّ (فقط للكارت اللي بصمته اتغيّرت) ───────────── */
  // أول مرة يفتح فيها المستخدم بعد تفعيل الميزة: نعتبر كل الموجود حاليًا "مقروء".
  async function _lastSeen(key) {
    const ref = _fs.doc(_db, "users", _uid, "cardReads", key);
    const snap = await _fs.getDoc(ref);
    if (snap.exists() && snap.data().lastSeenAt) return snap.data().lastSeenAt;
    const now = _fs.Timestamp.now();
    await _fs.setDoc(ref, { lastSeenAt: now }, { merge: true });
    return now;
  }

  async function _countUnread(src) {
    if(src.key === "instructions")return _instructionsBadge(false);
    const lastSeen = await _lastSeen(src.key);
    if (src.kind === "singleDoc") {
      const snap = await _fs.getDoc(_fs.doc(_db, src.col, _worldId));
      const t = snap.exists() ? snap.data()[src.timeField] : null;
      return (t && t.toMillis() > lastSeen.toMillis()) ? 1 : 0;
    }
    const clauses = [];
    if (src.worldScoped) clauses.push(_fs.where("worldId", "==", _worldId));
    if (src.statusIn)    clauses.push(_fs.where("status", "in", src.statusIn));
    clauses.push(_fs.where(src.timeField, ">", lastSeen));
    clauses.push(_fs.orderBy(src.timeField, "desc"));
    const q = _fs.query(_fs.collection(_db, src.col), ...clauses);
    return (await _fs.getCountFromServer(q)).data().count;
  }

  async function _verify(src, stamp) {
    const gen = _gen;
    const tk = (_vt[src.key] = (_vt[src.key] || 0) + 1);
    _verified[src.key] = stamp;
    let n;
    try {
      if (_marking[src.key]) { try { await _marking[src.key]; } catch (e) { /* تجاهل */ } }
      n = await _countUnread(src);
    } catch (e) { n = null; }
    if (gen !== _gen || tk !== _vt[src.key]) return;
    if (n === null) { delete _verified[src.key]; return; }   // أوفلاين/خطأ: يعاد عند أول بصمة أو رجوع النت
    const prev = _st[src.key];
    _st[src.key] = n > 0
      ? { ss: prev ? prev.ss : -1, pos: 1, n: n, vs: stamp, at: Date.now() }
      : { ss: Math.max(stamp, 0), pos: 0 };
    _saveState();
    _counts[src.key] = n;
    _renderCard(src); _renderNav();
  }

  function _evaluate(src, stamp) {
    if(src.key === "instructions")return;
    if(src.key==='sheetaty'&&window.__BLISS_SHEETS_MODE!=='firebase')return;
    if(src.key === "news"&&(window.__BLISS_NEWS_MODE!=='firebase'))return;
    if(src.key === "lectures"&&(window.__BLISS_LECTURES_MODE!=='firebase'))return;
    if(src.key === "exams"&&(window.__BLISS_EXAMS_MODE!=='firebase'))return;
    if(src.key === "sections"&&(window.__BLISS_SECTIONS_MODE!=='firebase'))return;
    if(src.key === "studyschedule"&&(window.__BLISS_STUDYSCHEDULE_MODE!=='firebase'))return;
    if(src.key === "military"&&(window.__BLISS_MILITARY_MODE!=='firebase'))return;
    if(src.key === "tuition"&&(window.__BLISS_TUITION_MODE!=='firebase'))return;
    _lastStamp[src.key] = stamp;
    if (_verified[src.key] === stamp) return;
    const st = _st[src.key];
    if (stamp >= 0 && st) {
      if (!st.pos && stamp <= st.ss) {                        // لا جديد منذ آخر تحقق/فتح
        _verified[src.key] = stamp;
        if (_counts[src.key]) { _counts[src.key] = 0; _renderCard(src); _renderNav(); }
        return;
      }
      if (st.pos && st.vs === stamp && typeof st.n === "number" && (Date.now() - (st.at || 0)) < POS_MAX_AGE) {
        // غير مقروء محفوظ والبصمة ما اتغيرتش: نعرض العدد المحفوظ بدون أي قراءة
        _verified[src.key] = stamp;
        if (_counts[src.key] !== st.n) { _counts[src.key] = st.n; _renderCard(src); _renderNav(); }
        return;
      }
    }
    // التبويب في الخلفية: نأجّل العدّ لحد ما المستخدم يرجع (وبكده كذا نشر = عدّ واحد بآخر بصمة)
    if (document.visibilityState === "hidden") { _deferred[src.key] = true; return; }
    _verify(src, stamp);
  }

  function _flushDeferred() {
    Object.keys(_deferred).forEach((k) => {
      delete _deferred[k];
      const src = SOURCES.find((s) => s.key === k);
      if (src && _lastStamp[k] !== undefined) _evaluate(src, _lastStamp[k]);
    });
  }

  function _stampOf(data, key) {
    const t = data && data.s && data.s[key];
    return (t && typeof t.toMillis === "function") ? t.toMillis() : 0;
  }

  function _watchGate(scope) {
    const ref = _fs.doc(_db, "forumMeta", scope === "world" ? _worldId : "_global");
    _unsubs["gate:" + scope] = _fs.onSnapshot(ref, (snap) => {
      const data = snap.exists() ? snap.data() : null;
      SOURCES.forEach((src) => { if (_scope(src) === scope) _evaluate(src, _stampOf(data, src.key)); });
    }, (err) => {
      // البوابة غير مقروءة (قواعد لم تُنشر بعد؟): نتحقق من كل كارت مرة واحدة في الجلسة بدل ما نخسر الشارات
      console.warn("[forum-gate] gate unreadable — verifying each card once:", err && err.code);
      SOURCES.forEach((src) => { if (_scope(src) === scope) _evaluate(src, -1); });
    });
  }

  /* ───────────── كارت الدرجات (خاص بكل مستخدم — مستمع واحد) ───────────── */
  const _gsKey = () => "fbGradesSeen1_" + _uid;
  function _gradesSeenCached() {
    const o = _lsGet(_gsKey());
    return (o && typeof o.s === "number") ? new _fs.Timestamp(o.s, o.n || 0) : null;
  }
  function _gradesSeenStore(ts) { if (ts) _lsSet(_gsKey(), { s: ts.seconds, n: ts.nanoseconds }); }

  async function _watchGrades(src) {
    const gen = _gen;
    if (_unsubs[src.key]) { try { _unsubs[src.key](); } catch (e) { /* تجاهل */ } delete _unsubs[src.key]; }
    let lastSeen = _gradesSeenCached();
    const fromCache = !!lastSeen;
    if (!lastSeen) {
      try { lastSeen = await _lastSeen(src.key); } catch (e) { return; }
      if (gen !== _gen) return;
      _gradesSeenStore(lastSeen);
    }
    const q = _fs.query(_fs.collection(_db, "grades", _uid, src.col), _fs.where(src.timeField, ">", lastSeen));
    let confirmed = !fromCache;
    _unsubs[src.key] = _fs.onSnapshot(q, async (snap) => {
      if (gen !== _gen) return;
      if (snap.size > 0 && !confirmed) {
        // نسخة محلية قديمة ممكن تكون اتقرأت من جهاز تاني: نتأكد مرة واحدة قبل العرض
        confirmed = true;
        try {
          const fresh = await _lastSeen(src.key);
          if (gen !== _gen) return;
          if (fresh.toMillis() > lastSeen.toMillis()) { _gradesSeenStore(fresh); _watchGrades(src); return; }
        } catch (e) { /* نكمل بالمتاح */ }
      }
      _counts[src.key] = snap.size;
      _ready[src.key] = true;
      _renderCard(src); _renderNav();
    }, () => { _counts[src.key] = 0; _renderCard(src); _renderNav(); });
  }

  /* ───────────── فتح الكارت = تمّت القراءة ───────────── */
  async function _markRead(key) {
    if(key==='sheetaty'&&window.__BLISS_SHEETS_MODE!=='firebase')return;
    const src = SOURCES.find((s) => s.key === key);
    if (!src || !_fs || !_uid) return;
    if(key === "news"&&(window.__BLISS_NEWS_MODE!=='firebase'))return;
    if(key === "lectures"&&(window.__BLISS_LECTURES_MODE!=='firebase'))return;
    if(key === "exams"&&(window.__BLISS_EXAMS_MODE!=='firebase'))return;
    if(key === "sections"&&(window.__BLISS_SECTIONS_MODE!=='firebase'))return;
    if(key === "studyschedule"&&(window.__BLISS_STUDYSCHEDULE_MODE!=='firebase'))return;
    if(key === "military"&&(window.__BLISS_MILITARY_MODE!=='firebase'))return;
    if(key === "tuition"&&(window.__BLISS_TUITION_MODE!=='firebase'))return;
    if(key === "instructions"){try{await _instructionsBadge(true);}catch(_){}return;}
    // كارت مؤكَّد إنه نظيف (بدون شارة وبصمته متحقق منها) → مفيش حاجة تتسجّل ولا كتابة
    const hadBadge = (_counts[key] || 0) > 0;
    const cleanKnown = _scope(src)
      ? (!!_st[key] && !_st[key].pos && _verified[key] !== undefined && _verified[key] === _lastStamp[key])
      : (_ready[key] === true && _counts[key] === 0);
    if (!hadBadge && cleanKnown) return;
    _counts[key] = 0;
    _vt[key] = (_vt[key] || 0) + 1;                // يبطل أي تحقق جارٍ
    _renderAll();
    const ref = _fs.doc(_db, "users", _uid, "cardReads", key);
    const p = _fs.setDoc(ref, { lastSeenAt: _fs.serverTimestamp() }, { merge: true });
    _marking[key] = p;
    if (_scope(src)) {
      const stamp = _lastStamp[key] || 0;
      _st[key] = { ss: Math.max(stamp, 0), pos: 0 };
      _verified[key] = stamp;
      _saveState();
    }
    try { await p; } catch (e) { /* تجاهل — يتظبط في أقرب تحقق */ }
    if (_marking[key] === p) delete _marking[key];
    if (!_scope(src)) {
      try {
        const snap = await _fs.getDoc(ref);
        const ts = snap.exists() ? snap.data().lastSeenAt : null;
        if (ts) _gradesSeenStore(ts);
      } catch (e) { /* تجاهل */ }
      _watchGrades(src);
    }
  }

  function _bindResetOnClick() {
    const grid = document.getElementById("forum-landing");
    if (!grid || _bound) return;
    _bound = true;
    grid.addEventListener("click", (e) => {
      const card = e.target.closest(".forum-section-card");
      if (!card) return;
      const src = SOURCES.find((s) => card.querySelector("." + s.iconClass));
      if (src) _markRead(src.key);
    });
  }

  let _onlineBound = false;
  function _bindOnline() {
    if (_onlineBound) return;
    _onlineBound = true;
    window.addEventListener("online", () => {
      if (!_sig) return;
      SOURCES.forEach((src) => {
        if (_scope(src) && _verified[src.key] === undefined && _lastStamp[src.key] !== undefined) _evaluate(src, _lastStamp[src.key]);
      });
    });
  }

  async function _instructionsBadge(mark) {
    const uid=_uid,gen=_gen,token=await window.currentUser.getIdToken();
    const r=await fetch('https://bliss-gateway.cairohbis.workers.dev/v1/content/instructions/'+(mark?'read':'badge'),{method:mark?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+token}});
    if(!r.ok)throw Error('instructions-badge');const j=await r.json();
    if(uid!==_uid||gen!==_gen)return 0;
    if(j.meta?.complete!==true||j.meta?.source!=='supabase'||!Number.isInteger(j.data?.count)||j.data.count<0)throw Error('instructions-badge-payload');
    _counts.instructions=j.data.count;_renderAll();return j.data.count;
  }
  window.addEventListener('sheets-badge',e=>{if(e.detail?.uid!==_uid||e.detail?.world!==_worldId)return;_counts.sheetaty=e.detail.count;_renderAll();});
  window.addEventListener('news-badge',e=>{if(e.detail?.uid!==_uid||e.detail?.world!==_worldId)return;_counts.news=e.detail.count;_renderAll();});
  window.addEventListener('lectures-badge',e=>{if(e.detail?.uid!==_uid||e.detail?.world!==_worldId)return;_counts.lectures=e.detail.count;_renderAll();});
  window.addEventListener('exams-badge',e=>{if(e.detail?.uid!==_uid||e.detail?.world!==_worldId)return;_counts.exams=e.detail.count;_renderAll();});
  window.addEventListener('sections-badge',e=>{if(e.detail?.uid!==_uid||e.detail?.world!==_worldId)return;_counts.sections=e.detail.count;_renderAll();});
  window.addEventListener('tuition-badge',e=>{if(e.detail?.uid!==_uid||e.detail?.world!==_worldId)return;_counts.tuition=e.detail.count;_renderAll();});
  window.addEventListener('military-badge',e=>{if(e.detail?.uid!==_uid)return;_counts.military=e.detail.count;_renderAll();});
  window.addEventListener('studyschedule-badge',e=>{if(e.detail?.uid!==_uid||e.detail?.world!==_worldId)return;_counts.studyschedule=e.detail.count;_renderAll();});
  let _instructionsBadgeTimer=null;
  async function _pollInstructionsBadge(){
    if(_instructionsBadgeTimer)clearTimeout(_instructionsBadgeTimer);
    if(!_sig||document.visibilityState!=='visible')return;
    try{await _instructionsBadge(false);}catch(_){}
    if(_sig&&document.visibilityState==='visible')_instructionsBadgeTimer=setTimeout(_pollInstructionsBadge,60000);
  }
  window.addEventListener('instructions-content-read',()=>{if(_uid)void _instructionsBadge(true).catch(()=>{});});
  function _teardown() {
    _gen++;
    if(_instructionsBadgeTimer)clearTimeout(_instructionsBadgeTimer);
    Object.keys(_unsubs).forEach((k) => { try { _unsubs[k](); } catch (e) { /* تجاهل */ } delete _unsubs[k]; });
    [_counts, _verified, _lastStamp, _vt, _marking, _st, _ready, _deferred].forEach((o) => { Object.keys(o).forEach((k) => { delete o[k]; }); });
    _renderAll();
  }

  function _next() {
    if (document.visibilityState === "hidden") { _paused = true; return; }   // التبويب في الخلفية: لا مراقبة
    setTimeout(_boot, 800);
  }

  async function _boot() {
    try { await _loadFs(); } catch (e) { return; }

    const uid = window.currentUser && window.currentUser.uid;
    const worldId = _activeWorld();

    // لا بداية قبل ما uid + worldId صالح يكونوا جاهزين؛ ولو اختفوا (خروج) نوقف كل حاجة.
    if (!window.db || !uid || !worldId) {
      if (_sig !== null) { _sig = null; _teardown(); }
      _next();
      return;
    }

    const sig = uid + "|" + worldId;
    if (sig !== _sig) {
      if (_sig !== null) _teardown();
      _sig = sig;
      _db  = window.db;
      _uid = uid;
      _worldId = worldId;
      _injectStyles();
      _bindResetOnClick();
      _bindOnline();
      _loadState();
      if (_scopeNeedsGate("world")) _watchGate("world");
      if (_scopeNeedsGate("global")) _watchGate("global");
      void _pollInstructionsBadge();
      SOURCES.filter((s) => !_scope(s)).forEach(_watchGrades);
    }
    _next(); // مراقبة تغيّر الحساب/العالم (تتوقف والتبويب في الخلفية وتكمّل عند الرجوع)
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible"){if(_instructionsBadgeTimer)clearTimeout(_instructionsBadgeTimer);return;}
    void _pollInstructionsBadge();
    if (_paused) { _paused = false; _boot(); }
    _flushDeferred();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _boot);
  } else {
    _boot();
  }
})();
