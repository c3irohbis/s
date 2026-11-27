/**
 * ══════════════════════════════════════════
 *   INSTRUCTIONS MODULE — تعليمات
 *   شروحات مميزات المنتدى — القراءة للجميع، الإنشاء/التعديل/الحذف للمالك فقط
 *
 *   ▸ ملف مستقل بالكامل — نفس معمارية military.js / grades.js
 *     (window.InstructionsModule.open/close + جذر ثابت في index.html)
 *   ▸ لا يُنشئ نسخة من الميزة: كل تعليمات مرتبطة بالميزة الأصلية عبر مفتاحها،
 *     والاسم والأيقونة تُقرأ حيّة من كارت الميزة في المنتدى (تتغير معه تلقائيًا)
 *   ▸ Content: Supabase via authenticated bliss-gateway, no Firestore fallback.
 * ══════════════════════════════════════════
 */

(function () {
  "use strict";

  if (window.__instructionsModuleLoaded) return;
  window.__instructionsModuleLoaded = true;

  window.InstructionsModule = window.InstructionsModule || {};

  const MAX_IMG_MB    = 10;
  const MAX_BLOCKS    = 60;
  const MAX_TEXT      = 5000;

  /* Temporary, local-only instructions diagnostics. No transport/SDK interception. */
  const CAP_BUILD = "instructions-capture-2";
  const CAP_DB = "bliss-instructions-capture-v1";
  const CAP_DAY = 86400000;
  let _capFlow = null, _capOpenedAt = 0, _capRendered = false, _capStarting = null;
  const _capClock = () => performance.now();
  const _capture = (() => {
    const TYPES = new Set(["capture_started", "capture_stopped", "card_open", "card_close", "request", "http_detail", "attempt_error", "firestore_error", "sync_error", "fallback", "source", "render_call_completed", "breaker", "cancel", "visibility"]);
    const REASONS = new Set(["http", "code_unavailable", "timeout", "token_timeout", "auth_error", "network_or_cors", "json_invalid", "config_invalid", "payload_envelope", "payload_incomplete", "payload_count", "payload_age", "payload_item", "payload_block", "retry_exhausted", "breaker_open", "breaker_preexisting_unknown", "mode_firebase", "mode_shadow", "closed", "superseded", "revalidated", "snapshot", "unknown"]);
    const CODES = new Set(["supabase_error", "empty_unexpected", "too_large", "disabled", "owner-only", "invalid-token", "missing-token", "rate-limited", "origin-not-allowed", "bad-json", "permission-denied", "unavailable", "resource-exhausted", "failed-precondition", "unauthenticated", "cancelled", "deadline-exceeded", "internal", "aborted", "data-loss", "invalid-argument", "not-found", "already-exists", "out-of-range", "unimplemented", "unknown", "auth/network-request-failed", "auth/user-token-expired", "auth/invalid-user-token"]);
    const STAGES = new Set(["card", "config", "content", "token", "sync", "firestore-init", "firestore-listen", "firestore-save", "firestore-delete"]);
    const SOURCES = new Set(["gateway", "gateway-memory", "firebase-cache", "firebase-server", "firebase-unknown"]);
    const MODES = new Set(["gateway", "firebase", "shadow", "unknown"]);
    const prefix = (window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/[^a-z0-9-]/gi, "");
    let seq = 0, db = null, meta = null, health = "off", queue = Promise.resolve();
    // Memory-only warning, not durable across tab close/crash or reload.
    let lifecycle = 0, actions = Promise.resolve(), unconfirmedLossSession = null;
    const action = work => { const next = actions.then(work); actions = next.catch(() => {}); return next; };
    let releaseLock = null, lockTask = null, gate = false, epoch = null, mutating = false, breakerCause = null;
    const unsettled = new Set();
    const anchor = { wall: Date.now(), mono: _capClock() };
    const id = () => prefix + "-" + (++seq);
    const number = v => typeof v === "number" && Number.isFinite(v);
    const safeId = v => typeof v === "string" && /^[a-z0-9_-]{1,96}$/i.test(v);
    const eligibility = () => { try { return window.__insCaptureAuth?.getEligibility() || { eligible: false }; } catch (_) { return { eligible: false }; } };
    const owner = () => eligibility().eligible === true && _isOwnerUser();
    const current = () => owner() && eligibility().epoch === epoch;
    function clean(type, fields = {}, timestamp = Date.now(), eventId = id()) {
      if (!TYPES.has(type) || !safeId(eventId) || !number(timestamp)) return null;
      const e = { id: eventId, type, at: timestamp };
      for (const key of ["flow", "request", "cause"]) if (safeId(fields[key])) e[key] = fields[key];
      for (const [key, allowed] of [["reason", REASONS], ["code", CODES], ["stage", STAGES], ["source", SOURCES], ["mode", MODES]])
        if (allowed.has(fields[key])) e[key] = fields[key];
      for (const key of ["elapsed_ms", "age_ms"])
        if (number(fields[key])) e[key] = Math.round(Math.max(-1e12, Math.min(1e12, fields[key])));
      if (Number.isInteger(fields.ordinal) && fields.ordinal > 0 && fields.ordinal <= 2000) e.ordinal = fields.ordinal;
      if (Number.isInteger(fields.status) && fields.status >= 0 && fields.status <= 599) e.status = fields.status;
      if (Number.isInteger(fields.attempt) && fields.attempt >= 0 && fields.attempt <= 3) e.attempt = fields.attempt;
      for (const key of ["first", "visible"]) if (typeof fields[key] === "boolean") e[key] = fields[key];
      return e;
    }
    function bounded(promise, ms = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("capture-timeout")), ms);
        promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
      });
    }
    async function openDb() {
      if (db) return db;
      if (!window.indexedDB && typeof indexedDB === "undefined") throw new Error("capture-unavailable");
      return new Promise((resolve, reject) => {
        let expired = false;
        const timer = setTimeout(() => { expired = true; reject(new Error("capture-timeout")); }, 2000);
        const r = indexedDB.open(CAP_DB, 1);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains("meta")) r.result.createObjectStore("meta", { keyPath: "key" });
          if (!r.result.objectStoreNames.contains("events")) r.result.createObjectStore("events", { keyPath: "id" });
        };
        r.onerror = () => { clearTimeout(timer); reject(new Error("capture-storage")); };
        r.onsuccess = () => {
          clearTimeout(timer);
          if (expired) { r.result.close(); return; }
          db = r.result;
          db.onversionchange = () => { db.close(); db = null; gate = false; health = "store_changed"; };
          resolve(db);
        };
      });
    }
    async function transaction(mode, work) {
      const store = await openDb();
      let tx, timer;
      const operation = new Promise((resolve, reject) => {
        let answer;
        tx = store.transaction(["meta", "events"], mode);
        tx.oncomplete = () => resolve(answer);
        tx.onabort = tx.onerror = () => reject(new Error("capture-storage"));
        try { work(tx.objectStore("meta"), tx.objectStore("events"), value => { answer = value; }); }
        catch (_) { try { tx.abort(); } catch (_) {} reject(new Error("capture-storage")); }
      });
      unsettled.add(operation);
      operation.then(() => unsettled.delete(operation), () => unsettled.delete(operation));
      try {
        return await Promise.race([operation, new Promise((_, reject) => {
          timer = setTimeout(() => { gate = false; health = "durability_unknown"; try { tx.abort(); } catch (_) {} reject(new Error("capture-timeout")); }, 2000);
        })]);
      } finally { clearTimeout(timer); }
    }
    function enqueue(work, session) {
      queue = queue.then(work).catch(() => { unconfirmedLossSession = session; gate = false; health = "loss_unconfirmed"; _capUi(); });
      return queue;
    }
    async function settleAndRelease() {
      await Promise.allSettled([...unsettled]);
      const release = releaseLock; releaseLock = null;
      release?.();
    }
    async function withLock(work) {
      if (releaseLock) { if (unsettled.size) throw new Error("capture-unsettled"); return work(); }
      if (lockTask) throw new Error("capture-busy");
      if (!navigator.locks?.request) throw new Error("capture-unavailable");
      return new Promise((resolve, reject) => {
        lockTask = navigator.locks.request(CAP_DB, { mode: "exclusive", ifAvailable: true }, async lock => {
          if (!lock) { reject(new Error("capture-busy")); return; }
          const held = new Promise(done => { releaseLock = done; });
          try { resolve(await work()); } catch (e) { reject(e); void settleAndRelease(); }
          await held;
        }).catch(reject).finally(() => { lockTask = null; });
      });
    }
    function closeAcceptance() { lifecycle++; gate = false; }
    function disable() { closeAcceptance(); epoch = null; }
    async function stopInternal() {
      const wasSession = meta?.id;
      closeAcceptance();
      await queue;
      try {
        if (!wasSession || !releaseLock) return { captureDisabledHere: true, stopPersisted: false, purgeVerified: false };
        await transaction("readwrite", (ms, es) => {
          const r = ms.get("session");
          r.onsuccess = () => { if (r.result?.id === wasSession) ms.put({ ...r.result, active: false, endedAt: Date.now(), health: r.result.lost ? r.result.health : "ended" }); };
        });
        const check = await transaction("readonly", (ms, es, done) => { const r = ms.get("session"); r.onsuccess = () => done(r.result); });
        const ok = check?.id === wasSession && check.active === false;
        if (ok) { meta = check; health = unconfirmedLossSession === wasSession ? "loss_unconfirmed" : check.health; }
        return { captureDisabledHere: true, stopPersisted: ok, purgeVerified: false };
      } catch (_) { health = unconfirmedLossSession === wasSession ? "loss_unconfirmed" : "durability_unknown"; return { captureDisabledHere: true, stopPersisted: false, purgeVerified: false }; }
      finally { void settleAndRelease(); _capUi(); }
    }
    async function recordLost(session) {
      try {
        if (!releaseLock) throw new Error("capture-no-lock");
        const m = await transaction("readwrite", (ms, es, done) => {
          const r = ms.get("session");
          r.onsuccess = () => {
            if (r.result?.id !== session) return;
            const m = { ...r.result, lost: (r.result.lost || 0) + 1, health: "revoked_gap" };
            ms.put(m); done(m);
          };
        });
        if (!m) throw new Error("capture-session-changed");
        meta = m; health = m.health;
      } catch (_) {
        unconfirmedLossSession = session;
        gate = false; health = "loss_unconfirmed";
      }
      _capUi();
    }
    function event(type, fields) {
      try {
        if (!gate || !current() || !meta?.active) return null;
        const e = clean(type, fields); if (!e) return null;
        const session = meta.id, capturedEpoch = epoch;
        if (type === "breaker") breakerCause = e.cause || e.id;
        void enqueue(async () => {
          if (!current() || epoch !== capturedEpoch || !releaseLock) { await recordLost(session); return; }
          const m = await transaction("readwrite", (ms, es, done) => {
            const r = ms.get("session");
            r.onsuccess = () => {
              const m = r.result;
              if (!current() || epoch !== capturedEpoch || m?.id !== session || !m.active) { done({ dropped: true }); return; }
              if (Date.now() >= m.deadline) { m.active = false; m.health = "ended"; }
              else if (Math.abs((Date.now() - anchor.wall) - (_capClock() - anchor.mono)) > 2000) { m.active = false; m.health = "clock_gap"; }
              else {
                e.ordinal = m.count + 1;
                const bytes = new TextEncoder().encode(JSON.stringify(e)).length;
                if (m.count >= 2000 || m.bytes + bytes > 1048576) { m.active = false; m.health = "capacity"; m.lost++; }
                else { es.add(e); m.count++; m.bytes += bytes; if (type === "render_call_completed" && m.phase === "validation") m.validationReady = true; }
              }
              ms.put(m); done(m);
            };
          });
          if (m?.dropped) { await recordLost(session); return; }
          if (m) { meta = m; health = m.health; if (!m.active) { gate = false; void settleAndRelease(); } }
          _capUi();
        }, session);
        return e.id;
      } catch (_) { disable(); health = "storage_error"; return null; }
    }
    async function begin(phase) {
      if (!owner()) throw new Error("capture-owner-only");
      if (mutating || gate || unsettled.size || lockTask || releaseLock) throw new Error("capture-busy");
      mutating = true;
      const startLife = lifecycle;
      try {
        return await withLock(async () => {
          const authEpoch = eligibility().epoch;
          const previous = await transaction("readonly", (ms, es, done) => { const r = ms.get("session"); r.onsuccess = () => done(r.result); });
          if (lifecycle !== startLife || !owner() || eligibility().epoch !== authEpoch) throw new Error("capture-state-changed");
          if (phase === "observation" && !(previous?.phase === "validation" && previous.validationReady)) throw new Error("capture-needs-validation");
          const now = Date.now();
          const m = { key: "session", id: id(), build: CAP_BUILD, phase, active: true, startedAt: now, deadline: now + CAP_DAY,
            expiresAt: now + 2 * CAP_DAY, count: 0, bytes: 0, health: "ok", lost: 0, validationReady: phase === "observation" };
          await transaction("readwrite", (ms, es) => {
            if (lifecycle !== startLife || !owner() || eligibility().epoch !== authEpoch) throw new Error("capture-state-changed");
            es.clear(); ms.put(m);
          });
          if (lifecycle !== startLife || !owner() || eligibility().epoch !== authEpoch) throw new Error("capture-state-changed");
          meta = m; epoch = authEpoch; health = "ok"; breakerCause = null; gate = true;
          anchor.wall = Date.now(); anchor.mono = _capClock();
          event("capture_started", { stage: "card" }); await queue;
        });
      } finally { mutating = false; _capUi(); }
    }
    async function erase() {
      const eraseEpoch = eligibility().epoch;
      disable();
      if (mutating) throw new Error("capture-busy");
      await queue;
      return withLock(async () => {
        try {
          await transaction("readwrite", (ms, es) => { ms.clear(); es.clear(); });
          const empty = await transaction("readonly", (ms, es, done) => {
            let a, b, n = 0; const finish = () => { if (++n === 2) done(a.length === 0 && b.length === 0); };
            const x = ms.getAll(), y = es.getAll(); x.onsuccess = () => { a = x.result; finish(); }; y.onsuccess = () => { b = y.result; finish(); };
          });
          meta = null; health = empty ? "off" : "purge_unknown"; breakerCause = null;
          return { captureDisabledHere: true, stopPersisted: false, purgeVerified: empty === true && eligibility().epoch === eraseEpoch };
        } catch (_) { health = "purge_unknown"; return { captureDisabledHere: true, stopPersisted: false, purgeVerified: false }; }
        finally { void settleAndRelease(); _capUi(); }
      });
    }
    async function exported() {
      if (!owner()) throw new Error("capture-owner-only");
      await queue;
      const exportEpoch = eligibility().epoch;
      const s = await transaction("readonly", (ms, es, done) => {
        let m, events, n = 0; const finish = () => { if (++n === 2) done({ m, events }); };
        const a = ms.get("session"), b = es.getAll(); a.onsuccess = () => { m = a.result; finish(); }; b.onsuccess = () => { events = b.result; finish(); };
      });
      if (!owner() || eligibility().epoch !== exportEpoch) throw new Error("capture-state-changed");
      if (s.m && Date.now() >= s.m.expiresAt) { const r = await erase(); if (!r.purgeVerified) throw new Error("capture-storage"); return exported(); }
      const events = s.events.map(e => clean(e.type, e, e.at, e.id)).filter(Boolean).sort((a,b) => a.ordinal - b.ordinal);
      const uncertain = !!s.m?.active && !(gate && meta?.id === s.m.id && current());
      const expired = !!s.m && Date.now() >= s.m.deadline;
      return { schema: 2, build: CAP_BUILD, scope: "participating-owner-tab-only", exportedAt: Date.now(),
        coverage: { phase: s.m?.phase || "none", active: !!s.m?.active && !uncertain && !expired, health: s.m?.id === unconfirmedLossSession ? "loss_unconfirmed" : events.length !== (s.m?.count || 0) ? "event_gap" : uncertain ? "activity_unknown_no_resume" : expired ? "ended" : s.m?.health || "off",
          lossAccountingConfirmed: s.m?.id !== unconfirmedLossSession, events: s.m?.count || 0, bytes: s.m?.bytes || 0, lost: s.m?.lost || 0, validationReady: !!s.m?.validationReady }, events };
    }
    let channel;
    try { channel = new BroadcastChannel(CAP_DB); channel.onmessage = e => { if (e.data === "revoke") { try { window.__insCaptureAuth?.revoke(); } catch (_) {} disable(); void action(stopInternal); } }; } catch (_) {}
    return { id, event, begin: phase => { const life = lifecycle; return action(() => { if (life !== lifecycle) throw new Error("capture-state-changed"); return begin(phase); }); }, stop: () => { closeAcceptance(); return action(stopInternal); }, erase: () => { disable(); return action(erase); }, exported, resume: async () => {}, drain: () => queue,
      revokeLocal() { disable(); void action(stopInternal); },
      async logout() { disable(); try { channel?.postMessage("revoke"); } catch (_) {} try { return await action(erase); } catch (_) { return { captureDisabledHere: true, purgeVerified: false, crossTabStop: "unknown" }; } },
      code: v => CODES.has(v) ? v : "unknown", get active() { return gate && current() && !!meta?.active && Date.now() < meta.deadline; },
      get session() { return meta?.id || null; }, get breakerCause() { return breakerCause; },
      visibility(visible) { event("visibility", { stage: "card", flow: _capFlow, visible }); if (!visible) { closeAcceptance(); void action(stopInternal); } },
      get status() { return { build: CAP_BUILD, health, busy: mutating, phase: meta?.phase || "none", active: gate && current() && !!meta?.active, count: meta?.count || 0, validationReady: !!meta?.validationReady, startedAt: meta?.startedAt || null, deadline: meta?.deadline || null }; }
    };
  })();

  function _capUi() {
    const el = document.getElementById("insCaptureStatus");
    if (!el) return;
    const s = _capture.status;
    const phase = s.phase === "validation" ? "تجربة فقط، لا عداد رصد" : s.phase === "observation" ? "رصد 24 ساعة" : "لا تسجيل";
    el.textContent = `${s.build} | ${phase} | ${s.active ? "يسجل" : "متوقف"} | ${s.health} | ${s.count}/2000` +
      (s.startedAt ? ` | ${new Date(s.startedAt).toISOString()}` + (s.phase === "observation" ? ` → ${new Date(s.deadline).toISOString()}` : "") : "");
    const b = document.getElementById("insCaptureObserve");
    if (b) b.disabled = s.busy || s.active || !s.validationReady || s.phase !== "validation" || !["ok", "ended"].includes(s.health);
  }
  function _capRender(source, cause) {
    if (!_gwIsOpen()) return;
    _capture.event("render_call_completed", { flow: _capFlow, cause, stage: "card", source, first: !_capRendered,
      ...(!_capRendered ? { elapsed_ms: _capClock() - _capOpenedAt } : {}) });
    _capRendered = true;
  }
  function _capReason(e, stage, timedOut, jsonStarted) {
    if (e?.message === "token-timeout") return "token_timeout";
    if (timedOut) return "timeout";
    if (stage === "token") return "auth_error";
    if (jsonStarted) return "json_invalid";
    return "network_or_cors";
  }
  function _capHttp(r, stage, request, attempt, started, flow) {
    _capture.event("request", { stage, request, attempt, flow, status: r.status, elapsed_ms: _capClock() - started });
    if (!_capture.active || r.ok || r.status === 304 || !r.body?.getReader) return;
    // Error bodies were previously unused. Never await this in the application path.
    const session = _capture.session;
    void (async () => {
      const reader = r.body.getReader();
      const timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 150);
      let code = "unknown", total = 0, text = "";
      try {
        const decoder = new TextDecoder();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > 1024) break;
          text += decoder.decode(chunk.value, { stream: true });
        }
        if (total <= 1024) code = _capture.code(JSON.parse(text).error?.code);
      } catch (_) {} finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
      if (_capture.session !== session) return;
      _capture.event("http_detail", { stage, request, flow, status: r.status, code,
        reason: code === "unknown" ? "code_unavailable" : "http" });
    })().catch(() => {});
  }
  function _capStart(phase) {
    if (_capStarting) return Promise.reject(new Error("capture-busy"));
    const pending = _capture.begin(phase); _capStarting = pending;
    return pending.finally(() => { if (_capStarting === pending) _capStarting = null; });
  }
  window.InstructionsModule.capture = {
    startValidation() { return _capStart("validation"); },
    startObservation() { return _capStart("observation"); },
    stop() { return _capture.stop(); }, clear() { if (!window.__insCaptureAuth?.getEligibility().eligible || !_isOwnerUser()) return Promise.reject(new Error("capture-owner-only")); return _capture.erase(); },
    exportData() { return _capture.exported(); },
    revokeLocal() { _capture.revokeLocal(); }, logout() { return _capture.logout(); },
    async action(action) {
      if (!_isOwnerUser()) return;
      try {
        if (action === "validation" && window.confirm("بدء تجربة محلية في هذا التبويب؟ السجل السابق سيستبدل. لا استئناف تلقائي بعد إعادة التحميل.")) await this.startValidation();
        if (action === "observe" && window.confirm("هل راجعت ملف التجربة؟ بدء جلسة مستقلة حتى 24 ساعة، تتوقف عند إخفاء التبويب.")) await this.startObservation();
        if (action === "stop") { const r = await this.stop(); if (!r.stopPersisted) throw new Error("capture-stop-unknown"); }
        if (action === "clear" && window.confirm("مسح سجل التشخيص فقط؟")) { const r = await this.clear(); if (!r.purgeVerified) throw new Error("capture-purge-unknown"); window.toast?.("السجل فارغ عند التحقق"); }
        if (action === "export") { const data = await this.exportData(); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "instructions-capture.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      } catch (_) { window.toast?.("التشخيص غير متاح أو تعذر تأكيد الإجراء. لا تعتمد على اكتمال الإيقاف أو المسح في التبويبات الأخرى.", "error"); }
      _capUi();
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (_capture.active) _capture.visibility(document.visibilityState === "visible");
  });


  /* Supabase authoritative content only. Identity remains Firebase Auth. */
  const GW_URL = "https://bliss-gateway.cairohbis.workers.dev";
  let _gwAbort=null, _gwMode="gateway", _fresh=false, _snapshotUid=null, _loadSeq=0;
  async function _gwToken() {
    let timer;try{return await Promise.race([window.currentUser.getIdToken(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('token-timeout')),5000);})]);}finally{clearTimeout(timer);}
  }
  async function _insRequest(path, body, signal) {
    const token=await _gwToken();
    const r=await fetch(GW_URL+path,{method:body?'POST':'GET',cache:'no-store',signal,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!r.ok) {
      let code;try{code=(await r.json()).error?.code;}catch(_){}
      throw new Error(['revision-conflict','item-limit','card-size-limit'].includes(code)?code:'http-'+r.status);
    }
    return await r.json();
  }
  function _validInstructions(j) {
    return j&&j.v===1&&j.meta?.complete===true&&j.meta.source==='supabase'&&Array.isArray(j.data)&&j.data.length<=200&&j.meta.count===j.data.length&&j.meta.expected_count===j.data.length&&j.data.every(d=>d&&typeof d.featureKey==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(d.featureKey)&&typeof d.featureTitle==='string'&&typeof d.revision==='string'&&Array.isArray(d.blocks)&&d.blocks.length<=60&&d.blocks.every(b=>b&&['h','p','img'].includes(b.t)&&typeof b.v==='string'))&&new Set(j.data.map(d=>d.featureKey)).size===j.data.length;
  }
  function _gwIsOpen(){return !!_root()?.classList.contains("instructions-open");}
  function _staleNotice() {
    document.getElementById("insStaleNotice")?.remove();
    const body=_body(); if(body)body.insertAdjacentHTML('afterbegin','<p id="insStaleNotice" role="status" class="ins-hint">نسخة سابقة للقراءة فقط. تعذّر تحديث Supabase. أغلق الكارت وافتحه للمحاولة.</p>');
  }
  function _renderCurrent() {
    if(!_root()?.classList.contains('instructions-open'))return;
    if(_view==='read'&&_docs[_curKey])_renderRead();else if(_view!=='edit')_renderList();
    if(!_fresh)_staleNotice();
  }
  async function _gwFetch() {
    const uid=window.currentUser?.uid,seq=++_loadSeq;
    if(_snapshotUid!==uid){_docs={};_snapshotUid=uid;_fresh=false;if(_body())_body().innerHTML="";}
    _fresh=false;
    if(Object.keys(_docs).length)_renderCurrent();
    if(_gwAbort)_gwAbort.abort();
    const ac=_gwAbort=new AbortController(),to=setTimeout(()=>ac.abort(),10000);
    try {
      const j=await _insRequest('/v1/content/instructions',null,ac.signal);
      if(seq!==_loadSeq||uid!==window.currentUser?.uid)return;
      if(!_validInstructions(j))throw new Error('invalid-payload');
      _docs=Object.fromEntries(j.data.map(d=>[d.featureKey,{...d,id:d.featureKey}]));_fresh=true;
      _capture.event('source',{stage:'card',flow:_capFlow,mode:'gateway',source:'gateway'});
      _renderCurrent();_capRender('gateway',null);
      window.dispatchEvent(new Event("instructions-content-read"));
    } catch(e) {
      if(seq!==_loadSeq||uid!==window.currentUser?.uid)return;
      _fresh=false;
      if(Object.keys(_docs).length)_renderCurrent();else _fail();
    }finally{clearTimeout(to);}
  }
  let _insRefreshTimer=null;
  function _stopRefresh(){if(_insRefreshTimer){clearInterval(_insRefreshTimer);_insRefreshTimer=null;}}
  function _startRefresh(){_stopRefresh();if(document.visibilityState==='visible')_insRefreshTimer=setInterval(()=>{if(_gwIsOpen()&&document.visibilityState==='visible'&&_view!=='edit'&&!_busy)void _gwFetch();},60000);}
  async function _startListener(){_startRefresh();return _gwFetch();}
  document.addEventListener('visibilitychange',()=>{_stopRefresh();if(document.visibilityState==='visible'&&_gwIsOpen()){_startRefresh();if(_view!=='edit')void _gwFetch();}});
  async function _mutate(action,key,extra={},expected=_docs[key]?.revision||null) {
    if(!_fresh)throw new Error('stale');
    ++_loadSeq;if(_gwAbort)_gwAbort.abort();
    const uid=window.currentUser?.uid;
    const j=await _insRequest('/v1/admin/content/instructions',{key,action,revision:expected,...extra},AbortSignal.timeout(15000));
    if(uid!==window.currentUser?.uid)throw new Error('account-changed');
    if(j?.meta?.source!=='supabase'||j.meta.complete!==true||!j.data)throw new Error('invalid-write-result');
    if(action==='delete'){if(j.data.deleted!==true||j.data.key!==key)throw new Error('invalid-delete-result');delete _docs[key];}
    else {if(j.data.featureKey!==key||typeof j.data.revision!=='string'||typeof j.data.featureTitle!=='string'||!Array.isArray(j.data.blocks)||j.data.blocks.some(b=>!b||!['h','p','img'].includes(b.t)||typeof b.v!=='string'))throw new Error('invalid-write-result');_docs[key]={...j.data,id:key};}
  }

  function _esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function _root() { return document.getElementById("instructions-app-root"); }
  function _isOwnerUser() { return !!(window.isOwner && window.isOwner()); }
  function _safeImg(u) { return typeof u === "string" && u.startsWith("https://res.cloudinary.com/"); }

  async function _uploadImage(file, onProgress) {
 const {uploadMedia}=await import(new URL('js/media-upload.js',document.baseURI).href);
 const data=await uploadMedia(file,p=>onProgress(p.pct),'instructions');
 return data.secure_url;
}

  /* ─────────────────────────────────────────
     المميزات: تُقرأ حيّة من كروت المنتدى الموجودة (لا نسخ، لا تعديل عليها)
  ───────────────────────────────────────── */
  function _deriveKey(card) {
    const explicit = card.getAttribute("data-feature");
    if (explicit) return explicit;
    const oc = card.getAttribute("onclick") || "";
    let m = oc.match(/openForumSection\(\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
    m = oc.match(/window\.(\w+)Module/);
    if (m) return m[1].toLowerCase();
    return null;
  }

  function _features() {
    const out = [], seen = new Set();
    document.querySelectorAll("#forum-landing .forum-section-card").forEach(card => {
      if (card.hasAttribute("data-ins-self")) return;
      const key = _deriveKey(card);
      const title = card.querySelector(".forum-card-title")?.textContent.trim();
      if (!key || !title || seen.has(key)) return;
      seen.add(key);
      const icon = card.querySelector(".forum-card-icon");
      out.push({
        key, title,
        iconHTML: icon ? icon.outerHTML : `<div class="forum-card-icon"><i class="fa-solid fa-circle-info"></i></div>`
      });
    });
    return out;
  }
  function _featureByKey(key) { return _features().find(f => f.key === key) || null; }

  /* ─────────────────────────────────────────
     الحالة
  ───────────────────────────────────────── */
  let _unsub = null;
  let _docs  = {};                 // featureKey -> doc
  let _view  = "list";             // list | read | edit
  let _curKey = null;
  let _draft = null;               // { key, blocks, isNew, dirty }
  let _busy  = false;

  function _body()  { return document.getElementById("insBody"); }
  function _sortedDocs() {
    const order = _features().map(f => f.key);
    return Object.values(_docs).sort((a, b) => {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  }

  function _fail() {
    const b = _body();
    if (b) b.innerHTML = `<div class="ins-empty"><div class="ins-empty-title">تعذّر تحميل التعليمات</div></div>`;
  }

  /* ─────────────────────────────────────────
     الهيكل
  ───────────────────────────────────────── */
  function _buildShell() {
    const root = _root();
    if (!root) return;
    root.innerHTML = `
      <div class="ins-overlay" onclick="window.InstructionsModule._back()"></div>
      <div class="ins-sheet">
        <div class="ins-header">
          <button class="ins-back-btn" onclick="window.InstructionsModule._back()"><i class="fa-solid fa-arrow-right"></i> رجوع</button>
          <div class="ins-title" id="insTitle"><i class="fa-solid fa-circle-info"></i> <span id="insTitleText">تعليمات</span></div>
          <button class="ins-add-btn" id="insAddBtn" onclick="window.InstructionsModule._openEditor()" style="display:none"><i class="fa-solid fa-plus"></i></button>
        </div>
        ${_isOwnerUser() ? `<details class="ins-capture"><summary>تشخيص التعليمات المؤقت · هذا التبويب فقط</summary>
          <p>لا استئناف تلقائي. الإخفاء يوقف الجلسة. لا بيانات حساب أو محتوى. صدّر السجل يدويًا قبل مسحه.</p>
          <output id="insCaptureStatus" aria-live="polite"></output>
          <div class="ins-capture-actions">
            <button type="button" onclick="InstructionsModule.capture.action('validation')">تجربة التسجيل</button>
            <button type="button" id="insCaptureObserve" disabled onclick="InstructionsModule.capture.action('observe')">بدء 24 ساعة بعد التحقق</button>
            <button type="button" onclick="InstructionsModule.capture.action('stop')">إيقاف</button>
            <button type="button" onclick="InstructionsModule.capture.action('export')">تصدير محلي</button>
            <button type="button" onclick="InstructionsModule.capture.action('clear')">مسح السجل</button>
          </div>
        </details>` : ""}
        <div class="ins-body" id="insBody">
          <div class="ins-loading"><div class="ins-spinner"></div><span>جارِ التحميل...</span></div>
        </div>
      </div>`;
    _capUi();
  }

  function _setHeader(title, showAdd) {
    const t = document.getElementById("insTitleText");
    if (t) t.textContent = title;
    const a = document.getElementById("insAddBtn");
    if (a) a.style.display = (showAdd && _isOwnerUser() && _fresh) ? "" : "none";
  }

  function _goList() {
    _view = "list"; _curKey = null; _draft = null;
    _renderList();
    if(!_fresh)_staleNotice();
  }

  /* ─────────────────────────────────────────
     القائمة
  ───────────────────────────────────────── */

  function _renderList() {
    _setHeader("تعليمات", true);
    const body = _body();
    if (!body) return;
    const owner = _isOwnerUser() && _fresh;
    const list = _sortedDocs();

    if (!list.length) {
      body.innerHTML = `
        <div class="ins-empty">
          <div class="ins-empty-icon"><i class="fa-solid fa-book-open"></i></div>
          <div class="ins-empty-title">لا توجد تعليمات بعد</div>
          <div class="ins-empty-sub">${owner ? "اضغط + لإضافة أول شرح" : "سيتم إضافة شروحات المميزات قريبًا"}</div>
        </div>`;
      return;
    }

    body.innerHTML = `
      <div class="ins-hint">اختر ميزة لقراءة طريقة استخدامها</div>
      <div class="ins-grid">
        ${list.map(d => {
          const f = _featureByKey(d.id) || {
            key: d.id, title: d.featureTitle || "ميزة",
            iconHTML: `<div class="forum-card-icon"><i class="fa-solid fa-circle-question"></i></div>`
          };
          const orphan = !_featureByKey(d.id);
          if (orphan && !owner) return "";
          const ownerBtns = owner ? `
            <div class="ins-tile-actions">
              <button class="ins-mini-btn" title="تعديل" onclick="event.stopPropagation();window.InstructionsModule._openEditor('${_esc(d.id)}')"><i class="fa-solid fa-pen"></i></button>
              <button class="ins-mini-btn ins-danger" title="حذف" onclick="event.stopPropagation();window.InstructionsModule._delete('${_esc(d.id)}')"><i class="fa-solid fa-trash"></i></button>
            </div>` : "";
          return `<div class="ins-tile${orphan ? " ins-orphan" : ""}" onclick="window.InstructionsModule._read('${_esc(d.id)}')">
            ${ownerBtns}
            <div class="ins-tile-icon">${f.iconHTML}</div>
            <div class="ins-tile-title">${_esc(f.title)}</div>
            ${orphan ? `<div class="ins-tile-sub">الميزة غير موجودة</div>` : `<div class="ins-tile-sub">${(d.blocks || []).length} عنصر</div>`}
          </div>`;
        }).join("")}
      </div>`;
  }

  /* ─────────────────────────────────────────
     القراءة
  ───────────────────────────────────────── */
  window.InstructionsModule._read = function (key) {
    if (!_docs[key]) return;
    _view = "read"; _curKey = key;
    _renderRead();
    if(!_fresh)_staleNotice();
  };

  function _renderRead() {
    const d = _docs[_curKey];
    const body = _body();
    if (!d || !body) return;
    const f = _featureByKey(_curKey) || { title: d.featureTitle || "تعليمات", iconHTML: `<div class="forum-card-icon"><i class="fa-solid fa-circle-info"></i></div>` };
    _setHeader("تعليمات", false);
    const blocks = Array.isArray(d.blocks) ? d.blocks : [];
    body.scrollTop = 0;
    body.innerHTML = `
      <div class="ins-read">
        <div class="ins-read-hero">
          <div class="ins-tile-icon ins-hero-icon">${f.iconHTML}</div>
          <div class="ins-read-name">${_esc(f.title)}</div>
        </div>
        ${blocks.map(b => {
          if (b.t === "h")   return `<h3 class="ins-r-h">${_esc(b.v)}</h3>`;
          if (b.t === "p")   return `<p class="ins-r-p">${_esc(b.v)}</p>`;
          if (b.t === "img" && _safeImg(b.v)) return `<figure class="ins-r-fig"><img src="${_esc(b.v)}" alt="" loading="lazy" onclick="window.openLightbox && window.openLightbox(this.src)"></figure>`;
          return "";
        }).join("")}
      </div>`;
  }

  /* ─────────────────────────────────────────
     المحرر (المالك فقط)
  ───────────────────────────────────────── */
  window.InstructionsModule._openEditor = function (key) {
    if (!_isOwnerUser() || !_fresh) return;
    const existing = key && _docs[key];
    _draft = {
      key: key || null,
      revision: existing?.revision || null,
      blocks: existing ? JSON.parse(JSON.stringify(existing.blocks || [])) : [],
      isNew: !existing,
      dirty: false
    };
    _view = "edit";
    _renderEditor();
  };

  function _renderEditor() {
    if (!_isOwnerUser()) return;
    _setHeader(_draft.isNew ? "تعليمات جديدة" : "تعديل التعليمات", false);
    const body = _body();
    if (!body) return;
    const feats = _features();
    body.scrollTop = 0;
    body.innerHTML = `
      <div class="ins-editor">
        <div class="ins-step-label"><span class="ins-step-num">1</span> اختر الميزة</div>
        <div class="ins-grid ins-pick-grid" id="insPick">
          ${feats.map(f => `
            <div class="ins-tile ins-pick${_draft.key === f.key ? " selected" : ""}${_docs[f.key] ? " has-doc" : ""}" data-k="${_esc(f.key)}" onclick="window.InstructionsModule._pick('${_esc(f.key)}')">
              ${_docs[f.key] ? `<span class="ins-has-badge"><i class="fa-solid fa-check"></i></span>` : ""}
              <div class="ins-tile-icon">${f.iconHTML}</div>
              <div class="ins-tile-title">${_esc(f.title)}</div>
            </div>`).join("")}
        </div>

        <div class="ins-step-label"><span class="ins-step-num">2</span> اكتب التعليمات</div>
        <div id="insBlocks"></div>

        <div class="ins-add-bar">
          <button class="ins-add-chip" onclick="window.InstructionsModule._addBlock('h')"><i class="fa-solid fa-heading"></i> عنوان</button>
          <button class="ins-add-chip" onclick="window.InstructionsModule._addBlock('p')"><i class="fa-solid fa-align-right"></i> فقرة</button>
          <label class="ins-add-chip"><i class="fa-solid fa-image"></i> صورة
            <input type="file" accept="image/*" multiple class="ins-file-hidden" onchange="window.InstructionsModule._addImages(this)">
          </label>
        </div>
        <div class="ins-progress" id="insProg" style="display:none"><div class="ins-progress-bar" id="insProgBar"></div><span id="insProgTxt"></span></div>

        <div class="ins-actions">
          <button class="ins-btn-primary" id="insSaveBtn" onclick="window.InstructionsModule._save()"><i class="fa-solid fa-floppy-disk"></i> حفظ</button>
          <button class="ins-btn-cancel" onclick="window.InstructionsModule._cancelEdit()">إلغاء</button>
        </div>
      </div>`;
    _renderBlocks();
  }

  function _renderBlocks() {
    const wrap = document.getElementById("insBlocks");
    if (!wrap) return;
    if (!_draft.blocks.length) {
      wrap.innerHTML = `<div class="ins-blocks-empty">ابدأ بإضافة عنوان أو فقرة أو صورة من الأزرار بالأسفل</div>`;
      return;
    }
    const n = _draft.blocks.length;
    wrap.innerHTML = _draft.blocks.map((b, i) => {
      const label = b.t === "h" ? "عنوان" : b.t === "p" ? "فقرة" : "صورة";
      const icon  = b.t === "h" ? "fa-heading" : b.t === "p" ? "fa-align-right" : "fa-image";
      let content = "";
      if (b.t === "h") content = `<input type="text" class="ins-input" maxlength="200" placeholder="نص العنوان" value="${_esc(b.v)}" oninput="window.InstructionsModule._edit(${i},this.value)">`;
      else if (b.t === "p") content = `<textarea class="ins-input ins-textarea" rows="4" maxlength="${MAX_TEXT}" placeholder="اكتب الشرح هنا..." oninput="window.InstructionsModule._edit(${i},this.value);this.style.height='auto';this.style.height=this.scrollHeight+'px'">${_esc(b.v)}</textarea>`;
      else content = _safeImg(b.v) ? `<img class="ins-prev-img" src="${_esc(b.v)}" alt="">` : `<div class="ins-blocks-empty">صورة غير صالحة</div>`;
      return `<div class="ins-block">
        <div class="ins-block-head">
          <span class="ins-block-type"><i class="fa-solid ${icon}"></i> ${label}</span>
          <span class="ins-block-tools">
            <button class="ins-mini-btn" ${i === 0 ? "disabled" : ""} onclick="window.InstructionsModule._move(${i},-1)"><i class="fa-solid fa-arrow-up"></i></button>
            <button class="ins-mini-btn" ${i === n - 1 ? "disabled" : ""} onclick="window.InstructionsModule._move(${i},1)"><i class="fa-solid fa-arrow-down"></i></button>
            <button class="ins-mini-btn ins-danger" onclick="window.InstructionsModule._removeBlock(${i})"><i class="fa-solid fa-trash"></i></button>
          </span>
        </div>
        ${content}
      </div>`;
    }).join("");
    wrap.querySelectorAll("textarea.ins-textarea").forEach(t => { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; });
  }

  window.InstructionsModule._pick = function (key) {
    if (!_isOwnerUser() || !_draft || _draft.key === key) return;
    const hasContent = _draft.blocks.some(b => (b.v || "").trim());
    if (_docs[key]) {
      if (hasContent && _draft.dirty && !window.confirm("لهذه الميزة تعليمات محفوظة بالفعل. تحميلها سيستبدل ما كتبته الآن. متابعة؟")) return;
      _draft.blocks = JSON.parse(JSON.stringify(_docs[key].blocks || []));
      _draft.isNew = false;
      _draft.dirty = false;
    } else if (!_draft.isNew) {
      // كنّا نعدّل ميزة موجودة ثم اخترنا غيرها: تصبح حالة "جديد" بنفس المحتوى الحالي
      _draft.isNew = true;
    }
    _draft.key = key;
    _draft.revision = _docs[key]?.revision || null;
    document.querySelectorAll("#insPick .ins-pick").forEach(el => el.classList.toggle("selected", el.getAttribute("data-k") === key));
    _renderBlocks();
  };

  window.InstructionsModule._addBlock = function (t) {
    if (!_isOwnerUser() || !_draft) return;
    if (_draft.blocks.length >= MAX_BLOCKS) { window.toast?.("وصلت للحد الأقصى من العناصر", "error"); return; }
    _draft.blocks.push({ t, v: "" });
    _draft.dirty = true;
    _renderBlocks();
    const wrap = document.getElementById("insBlocks");
    const last = wrap && wrap.lastElementChild && wrap.lastElementChild.querySelector("input,textarea");
    if (last) last.focus();
  };

  window.InstructionsModule._edit = function (i, val) {
    if (!_draft || !_draft.blocks[i]) return;
    _draft.blocks[i].v = val;
    _draft.dirty = true;
  };

  window.InstructionsModule._move = function (i, dir) {
    if (!_draft) return;
    const j = i + dir;
    if (j < 0 || j >= _draft.blocks.length) return;
    const b = _draft.blocks;
    [b[i], b[j]] = [b[j], b[i]];
    _draft.dirty = true;
    _renderBlocks();
  };

  window.InstructionsModule._removeBlock = function (i) {
    if (!_draft) return;
    _draft.blocks.splice(i, 1);
    _draft.dirty = true;
    _renderBlocks();
  };

  window.InstructionsModule._addImages = async function (inp) {
    if (!_isOwnerUser() || !_draft) return;
    const files = Array.from(inp.files || []);
    inp.value = "";
    if (!files.length) return;
    const prog = document.getElementById("insProg");
    const bar  = document.getElementById("insProgBar");
    const txt  = document.getElementById("insProgTxt");
    if (prog) prog.style.display = "flex";
    _busy = true;
    for (let k = 0; k < files.length; k++) {
      const f = files[k];
      if (!f.type.startsWith("image/")) { window.toast?.("الملف ليس صورة: " + f.name, "error"); continue; }
      if (f.size > MAX_IMG_MB * 1024 * 1024) { window.toast?.(`الصورة أكبر من ${MAX_IMG_MB}MB: ${f.name}`, "error"); continue; }
      if (_draft.blocks.length >= MAX_BLOCKS) { window.toast?.("وصلت للحد الأقصى من العناصر", "error"); break; }
      try {
        const url = await _uploadImage(f, pct => {
          if (bar) bar.style.width = pct + "%";
          if (txt) txt.textContent = `صورة ${k + 1}/${files.length} — ${pct}%`;
        });
        _draft.blocks.push({ t: "img", v: url });
        _draft.dirty = true;
        _renderBlocks();
      } catch (e) {
        window.toast?.("تعذر رفع الصورة", "error");
      }
    }
    _busy = false;
    if (prog) prog.style.display = "none";
    if (bar) bar.style.width = "0%";
  };

  window.InstructionsModule._save = async function () {
    if (!_isOwnerUser() || !_fresh || !_draft || _busy) return;
    if (!_draft.key) { window.toast?.("اختر الميزة أولاً", "error"); return; }
    const blocks = _draft.blocks
      .map(b => ({ t: b.t, v: (b.v || "").trim() }))
      .filter(b => b.v && (b.t !== "img" || _safeImg(b.v)))
      .map(b => ({ t: b.t, v: b.t === "img" ? b.v : b.v.slice(0, MAX_TEXT) }));
    if (!blocks.length) { window.toast?.("أضف محتوى للتعليمات أولاً", "error"); return; }

    const f = _featureByKey(_draft.key);
    const btn = document.getElementById("insSaveBtn");
    if (btn) btn.disabled = true;
    _busy=true;
    try {
      await _mutate('save',_draft.key,{featureTitle:f?f.title:(_docs[_draft.key]?.featureTitle||""),blocks},_draft.revision);
      window.toast?.("تم الحفظ ✓");
      _goList();
    } catch (e) {
      window.toast?.(e.message === "revision-conflict" ? "تغيّرت التعليمات من جلسة أخرى. أغلق الكارت وافتحه قبل التعديل." : ["item-limit","card-size-limit"].includes(e.message) ? "وصلت التعليمات للحد المسموح. قلّل المحتوى ثم أعد المحاولة." : "فشل الحفظ", "error");
      if (btn) btn.disabled = false;
    } finally { _busy=false; }
  };

  window.InstructionsModule._cancelEdit = function () {
    if (_draft && _draft.dirty && !window.confirm("تجاهل التغييرات غير المحفوظة؟")) return;
    _goList();
  };

  window.InstructionsModule._delete = async function (key) {
    if (!_isOwnerUser() || !_fresh || _busy) return;
    if (!window.confirm("حذف تعليمات هذه الميزة نهائيًا؟\n(الميزة نفسها لا تتأثر، والصور تبقى على Cloudinary)")) return;
    _busy=true;
    try {
      await _mutate('delete',key);
      _goList();
      window.toast?.("تم الحذف");
    } catch (e) {
      window.toast?.(e.message === "revision-conflict" ? "تغيّرت التعليمات من جلسة أخرى. حدّث الكارت قبل الحذف." : "فشل الحذف", "error");
    } finally { _busy=false; }
  };

  /* ─────────────────────────────────────────
     رجوع / فتح / إغلاق
  ───────────────────────────────────────── */
  window.InstructionsModule._back = function () {
    if (_view === "edit") { window.InstructionsModule._cancelEdit(); return; }
    if (_view === "read") { _goList(); return; }
    window.InstructionsModule.close();
  };

  window.InstructionsModule.open = function () {
    const root = _root();
    if (!root) return;
    _capFlow = _capture.id(); _capOpenedAt = _capClock(); _capRendered = false;
    void _capture.resume();
    _capture.event("card_open", { stage: "card", flow: _capFlow, visible: document.visibilityState === "visible" });
    _fresh=false;
    _view = "list"; _curKey = null; _draft = null; _busy = false;
    root.classList.add("instructions-open");
    root.style.display = "flex";
    _buildShell();
    _fresh=false;
    _setHeader("تعليمات", true);
    _startListener();
  };

  window.InstructionsModule.close = function () {
    const root = _root();
    if (!root) return;
    _capture.event("card_close", { stage: "card", flow: _capFlow });
    root.classList.remove("instructions-open");
    root.style.display = "none";
    root.innerHTML = "";
    if (_unsub) { _unsub(); _unsub = null; }
    if (_gwAbort) { _gwAbort.abort(); _gwAbort = null; }
    _stopRefresh();
    ++_loadSeq; _fresh=false; _draft = null; _view = "list"; _curKey = null;
  };

})();
