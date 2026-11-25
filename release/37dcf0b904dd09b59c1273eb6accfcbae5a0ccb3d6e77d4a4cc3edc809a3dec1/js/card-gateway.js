/* ══════════════════════════════════════════════════════════════
   js/card-gateway.js — بوابة بليس: مسار القراءة العام للكروت (المرحلة 3.0)
   ▸ كامن تمامًا خلف علم KV: ما دام وضع الكارت "firebase"/"shadow" لا يخرج أي طلب محتوى.
   ▸ الكروت المسجلة الآن: news فقط. أي كارت جديد يُضاف في سجل CGW_CARDS بمرحلته الخاصة.
   ▸ D9=A (قرار المالك 2026-11-22): الجلب يحدث عند فتح الكارت أو الرجوع إليه فقط —
     لا إعادة جلب أبدًا بينما الكارت مفتوح، ولا مؤقّتات ولا استطلاع دوري (مراجعة المالك نقطة 1).
     الفتح/الرجوع الحقيقي يمر بـ _forumLiveStop ثم _forumLiveStart، وserveCard يجلب جديدًا دائمًا.
   ▸ حالة كل طلب مربوطة بـ (كارت، عالم) — تبديل العالم أثناء طلب لا يرسم بيانات العالم القديم
     في الجديد أبدًا (مراجعة المالك نقطة 2)، والبوابة نفسها تفصل الكروت/العوالم في الاستعلام.
   ▸ أي فشل في البوابة (503/4xx/شبكة/مهلة/غلاف غير صالح) ← رجوع فوري لمستمع Firestore الحالي.
   ▸ العميل لا يرسل card_key في أي جسم إداري يُعتمد عليه؛ الفصل مفروض في البوابة وقاعدة البيانات.
   ══════════════════════════════════════════════════════════════ */

const CGW_URL      = "https://bliss-gateway.cairohbis.workers.dev";
const CGW_CFG_TTL  = 60e3;   // الإعداد يُخزَّن في sessionStorage بحد أقصى 60 ثانية (مشترك مع كارت التعليمات)
const CGW_TIMEOUT  = 5e3;    // مهلة طلبات البوابة (تشمل جلب التوكن)
const CGW_DOWN_TTL = 60e3;   // قاطع الدائرة: بعد فشل البوابة يتخطّاها الكارت دقيقة واحدة (لكل كارت على حدة)
const CGW_MAX_ITEMS = 500;   // سقف عناصر الرد (يطابق CARD_LIMITS.MAX_ITEMS في الوركر)

/* سجل الكروت: حدود الحقول + التحقق من شكل العنصر + تغليفه بما يشبه مستند Firestore للعارض الحالي */
const CGW_CARDS = {
  news: {
    worldScoped: true,
    MAX_TITLE: 500,
    MAX_BODY: 10000,
    validItem: (d) => !!d && typeof d.id === "string" && d.id.length > 0 && d.id.length <= 1500 &&
                     typeof d.title === "string" && d.title.length <= 500 &&
                     typeof d.body === "string" && d.body.length <= 10000 &&
                     typeof d.worldId === "string" &&
                     (d.createdAt === null || typeof d.createdAt === "string"),
    wrap: (d) => ({
      id: d.id,
      data: () => ({
        title: d.title, body: d.body, worldId: d.worldId,
        createdAt: d.createdAt ? { toDate: () => new Date(d.createdAt) } : null,
      }),
    }),
  },
};

/* حالة لكل (كارت، عالم): طلب واحد في الطيران + ETag + آخر عناصر.
   المفتاح المركب هو الضمان: استجابة عالم قديم لا تمتزج بعالم جديد إطلاقًا. */
const _cgwState = {};
const _cgwSlot = (card, world) => (_cgwState[card + "|" + (world || "")] ||= { etag: null, docs: null, inflight: null, abort: null });

async function _cgwToken() {
  // getIdToken نفسها قد تعلّق بلا نهاية ← سباق مع مهلة
  return await Promise.race([
    window.currentUser.getIdToken(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("token-timeout")), CGW_TIMEOUT)),
  ]);
}

async function _cgwConfig() {
  try {
    const c = JSON.parse(sessionStorage.getItem("gwCfg") || "null");
    if (c && c.cards && Date.now() - c.at < CGW_CFG_TTL) return c.cards;
  } catch (_) {}
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), CGW_TIMEOUT);
  try {
    const r = await fetch(CGW_URL + "/v1/config", { signal: ac.signal, headers: { Authorization: "Bearer " + (await _cgwToken()) } });
    if (!r.ok) { _cgwTrip("*"); return null; }
    const j = await r.json();
    if (j && j.v === 1 && j.data && j.data.cards) {
      try { sessionStorage.setItem("gwCfg", JSON.stringify({ at: Date.now(), cards: j.data.cards })); } catch (_) {}
      return j.data.cards;
    }
  } catch (_) { _cgwTrip("*"); }
  finally { clearTimeout(to); }
  return null; // أي فشل أو مهلة ← firebase
}

// قاطع الدائرة لكل كارت (نفس اتفاق كارت التعليمات: gwDown:<card>)
function _cgwTrip(card) { try { sessionStorage.setItem("gwDown:" + card, String(Date.now())); } catch (_) {} }
function _cgwDown(card) { try { const t = +sessionStorage.getItem("gwDown:" + card) || 0; return t > 0 && Date.now() - t < CGW_DOWN_TTL; } catch (_) { return false; } }
function _cgwUp(card)   { try { sessionStorage.removeItem("gwDown:" + card); } catch (_) {} }

/* لا يُعتمد ردّ البوابة إلا بغلاف سليم كامل + كل عنصر بمخطط الكارت وحدوده +
   كل عنصر يخص العالم المطلوب تحديدًا (أي تسريب عبر العوالم يرفض الرد كله) */
function _cgwValidPayload(card, world, j) {
  const def = CGW_CARDS[card];
  if (!def || !j || j.v !== 1 || !j.meta || j.meta.complete !== true) return false;
  if (!Array.isArray(j.data) || j.meta.count !== j.data.length) return false;
  if (j.data.length > CGW_MAX_ITEMS) return false;
  if (!j.meta.generatedAt || Date.now() - j.meta.generatedAt > 5 * 60e3) return false;
  return j.data.every(d => def.validItem(d) && (!def.worldScoped || d.worldId === world));
}

/* جلب عناصر (كارت، عالم) من البوابة — جلب جديد دائمًا (لا استطلاع ولا تكرار تلقائي).
   يرجع { ok: true, docs } | { ok: false } — والفشل يعني: ارجع لمستمع Firestore */
async function _cgwFetch(card, world) {
  const def = CGW_CARDS[card];
  const st = _cgwSlot(card, world);
  if (st.inflight) return st.inflight; // ديدوب لنفس (الكارت، العالم) فقط
  if (_cgwDown(card) || _cgwDown("*")) return { ok: false };
  if (st.abort) st.abort.abort();
  const ac = st.abort = new AbortController();
  st.inflight = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) { // إعادتان كحد أقصى، على 5xx/الشبكة فقط
      let timedOut = false;
      const to = setTimeout(() => { timedOut = true; ac.abort(); }, CGW_TIMEOUT);
      try {
        const hasLocal = Array.isArray(st.docs) && st.docs.length > 0;
        const u = CGW_URL + "/v1/cards/" + encodeURIComponent(card) + "/content" + (def.worldScoped ? "?world=" + encodeURIComponent(world) : "");
        const r = await fetch(u, {
          signal: ac.signal,
          headers: { Authorization: "Bearer " + (await _cgwToken()), ...(st.etag && hasLocal ? { "If-None-Match": st.etag } : {}) },
        });
        if (r.status === 304) { _cgwUp(card); return { ok: true, docs: st.docs }; }
        if (r.status === 503 || (r.status >= 400 && r.status < 500)) { _cgwTrip(card); return { ok: false }; } // disabled أو 4xx: فورًا وبلا إعادة
        if (!r.ok) throw new Error("gw-" + r.status);
        const j = await r.json();
        if (!_cgwValidPayload(card, world, j)) { _cgwTrip(card); return { ok: false }; }
        _cgwUp(card);
        st.etag = r.headers.get("ETag") || j.etag || st.etag;
        st.docs = j.data;
        return { ok: true, docs: st.docs };
      } catch (e) {
        clearTimeout(to); // أول سطر في الـcatch: إيقاف مؤقّت المحاولة قبل أي انتظار
        if (e && e.name === "AbortError") {
          if (timedOut) { _cgwTrip(card); return { ok: false }; } // بوابة معلّقة: رجوع فوري بلا إعادة
          return { ok: false, aborted: true }; // إلغاء عمدي (تبديل عالم أو إغلاق)
        }
        if (attempt >= 2) { _cgwTrip(card); return { ok: false }; }
        await new Promise(res => setTimeout(res, 1000 * (attempt + 1))); // تباعد متصاعد
      } finally { clearTimeout(to); }
    }
    return { ok: false };
  })();
  try { return await st.inflight; } finally { st.inflight = null; }
}

/* مزامنة بعد كتابة المالك/الأدمن — منفصلة تمامًا عن نجاح الكتابة نفسها */
async function _cgwSync(card, key, world) {
  try {
    const body = { key };
    if (world) body.world = world;
    const r = await fetch(CGW_URL + "/v1/cards/" + encodeURIComponent(card) + "/sync", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: "Bearer " + (await _cgwToken()), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("sync-" + r.status);
    _cgwPendingClear(card, key);
  } catch (e) {
    _cgwPendingAdd(card, key, world); // تُعاد تلقائيًا عند فتح المالك للكارت
  }
}
const _cgwPendKey = (card) => "gwPendingSync:" + card;
function _cgwPendingAdd(card, key, world) {
  try {
    const p = JSON.parse(localStorage.getItem(_cgwPendKey(card)) || "[]");
    if (!p.some(x => x.key === key)) { p.push({ key, world: world || null }); localStorage.setItem(_cgwPendKey(card), JSON.stringify(p)); }
  } catch (_) {}
}
function _cgwPendingClear(card, key) {
  try {
    const p = JSON.parse(localStorage.getItem(_cgwPendKey(card)) || "[]").filter(x => x.key !== key);
    localStorage.setItem(_cgwPendKey(card), JSON.stringify(p));
  } catch (_) {}
}
function _cgwRetryPending(card) {
  let p;
  try { p = JSON.parse(localStorage.getItem(_cgwPendKey(card)) || "[]"); } catch (_) { p = []; }
  if (!Array.isArray(p) || !p.length) return;
  [...p].forEach(x => _cgwSync(card, x.key, x.world));
}

window.CardGateway = {
  isRegistered: (card) => !!CGW_CARDS[card],

  /* نقطة النداء الوحيدة من _forumLiveStart (فتح/رجوع حقيقي فقط — D9=A):
     يحاول خدمة الكارت من البوابة. render(docs) يستلم عناصر مغلّفة بشكل مستندات.
     يرجع true لو خُدم الكارت، false لو على Firestore. */
  async serveCard(card, ctx, render) {
    const def = CGW_CARDS[card];
    if (!def) return false;
    if (def.worldScoped && !ctx.world) return false;
    if (_cgwDown(card) || _cgwDown("*")) return false; // القاطع مفتوح: بلا حتى طلب إعداد
    const cards = await _cgwConfig(); // null أو غياب المفتاح ← firebase
    if ((cards && cards[card]) !== "gateway") return false;
    if (window.isOwner && window.isOwner()) _cgwRetryPending(card);
    const res = await _cgwFetch(card, ctx.world);
    if (!res.ok || !Array.isArray(res.docs)) return false;
    render(res.docs.map(def.wrap));
    return true;
  },

  /* بعد أي كتابة ناجحة في كارت مسجل (إضافة/حذف) — لا تمنع العملية أبدًا */
  syncAfterWrite(card, key, world) {
    if (!CGW_CARDS[card] || !key) return;
    _cgwSync(card, key, world || null);
  },
};
