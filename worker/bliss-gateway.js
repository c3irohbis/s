/* ══════════════════════════════════════════════════════════════════
   bliss-gateway — بوابة «بليس» (المرحلة 1: الأساس)
   مساراتان فقط: GET /v1/health و GET /v1/config — بلا أي محتوى ولا Supabase.
   الأسرار والإعدادات في متغيرات بيئة الـ Worker فقط (لا شيء في الكود):
     FIREBASE_PROJECT_ID  (Variable)  معرّف مشروع Firebase
     OWNER_UID            (Variable)  UID المالك الثابت (يطابق isOwner() في القواعد)
     ALLOWED_ORIGINS      (Variable)  أصول مسموحة مفصولة بفواصل
     FLAGS_DEFAULT        (Variable, اختياري) JSON افتراضي لمفاتيح الكروت
     FLAGS                (KV Binding) مفتاح `flags` — JSON { <cardKey>: "firebase"|"shadow"|"gateway" }
   ══════════════════════════════════════════════════════════════════ */

const V = 1;
// الكروت المعروفة (مفاتيح forum-badges). الافتراضي لأي كارت: firebase
const CARD_KEYS = ["news","lectures","exams","sections","studySchedule","sheets","records","lostFound","military","instructions","tuition"];
const VALID_MODES = new Set(["firebase","shadow","gateway"]);

/* ── أدوات base64url ── */
const b64uToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/* ── CORS: أصل الموقع حرفيًا، لا * ── */
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
}
function originAllowed(request, env) {
  const o = request.headers.get("Origin");
  return o === null || allowedOrigins(env).includes(o); // بلا Origin = ليس متصفحًا؛ التوكن مطلوب على كل حال
}
function corsHeaders(request, env) {
  const o = request.headers.get("Origin");
  if (!o || !allowedOrigins(env).includes(o)) return { "Vary": "Origin" };
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-None-Match",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function ok(request, env, data, meta, extraHeaders) {
  return new Response(JSON.stringify({ v: V, data, etag: meta && meta.etag, ts: Date.now(), meta }), {
    status: 200,
    headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", ...corsHeaders(request, env), ...(extraHeaders || {}) },
  });
}
function err(request, env, status, code) {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status,
    headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff", ...corsHeaders(request, env) },
  });
}

/* ── تحديد المعدل: عدادات ذاكرة لكل نسخة تنفيذ (أفضل جهد، ليست عالمية ولا دقيقة — موثق) ── */
const _rl = new Map();
function rateLimit(key, limit) {
  const now = Date.now(), win = 60e3;
  let e = _rl.get(key);
  if (!e || now >= e.reset) { e = { count: 0, reset: now + win }; _rl.set(key, e); }
  if (_rl.size > 10000) { for (const [k, v] of _rl) if (now >= v.reset) _rl.delete(k); }
  return ++e.count <= limit;
}

/* ── التحقق من Firebase ID token (RS256 بمفاتيح Google العامة) ── */
let _jwks = { until: 0, keys: null };
async function getJwks(force) {
  if (!force && _jwks.keys && _jwks.until > Date.now()) return _jwks.keys;
  const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!r.ok) throw new Error("jwks");
  const maxAge = Number(((r.headers.get("Cache-Control") || "").match(/max-age=(\d+)/) || [])[1] || 300);
  _jwks = { until: Date.now() + Math.min(3600, maxAge) * 1000, keys: (await r.json()).keys };
  return _jwks.keys;
}
async function verifyToken(idToken, projectId) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("malformed");
  const header = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64uToBytes(parts[1])));
  if (header.alg !== "RS256") throw new Error("alg"); // يرفض none وأي خوارزمية أخرى
  let jwk = (await getJwks(false)).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await getJwks(true)).find(k => k.kid === header.kid); // تدوير المفاتيح: إعادة جلب عند غياب kid
  if (!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64uToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!good) throw new Error("sig");
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error("aud");
  if (payload.iss !== "https://securetoken.google.com/" + projectId) throw new Error("iss");
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("sub");
  if (!(payload.exp > now)) throw new Error("exp");
  if (typeof payload.iat !== "number" || payload.iat > now + 60) throw new Error("iat");
  if (typeof payload.auth_time !== "number" || payload.auth_time > now + 60) throw new Error("auth_time");
  return payload; // صلاحية التوكن ليست صلاحيات المستخدم داخل الموقع
}

/* ── بصمة ETag: هاش لحالة الكروت الحالية ── */
async function sha256hex(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}

/* ── مفاتيح الكروت: KV flags ثم المتغير الافتراضي ثم firebase (لا ينهار عند غياب KV) ── */
async function readFlags(env) {
  let raw = null;
  try { if (env.FLAGS) raw = await env.FLAGS.get("flags", { type: "json" }); } catch (_) { raw = null; }
  if (!raw || typeof raw !== "object") {
    try { raw = JSON.parse(env.FLAGS_DEFAULT || "{}"); } catch (_) { raw = {}; }
  }
  const cards = {};
  for (const k of CARD_KEYS) cards[k] = VALID_MODES.has(raw[k]) ? raw[k] : "firebase";
  return cards;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 1) OPTIONS ← 204 للأصول المسموحة فقط
    if (request.method === "OPTIONS") {
      if (!originAllowed(request, env)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    // 2) رفض أصل غير مسموح (بلا رؤوس CORS)
    if (!originAllowed(request, env)) return err(request, env, 403, "origin-not-allowed");
    if (request.method !== "GET") return err(request, env, 405, "method-not-allowed");

    // 3) حد المرحلة الأولى بحسب IP قبل أي تحقق من التوكن (أفضل جهد)
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const isHealth = url.pathname === "/v1/health";
    if (!rateLimit("ip:" + ip + (isHealth ? ":h" : ""), isHealth ? 60 : 300))
      return err(request, env, 429, "rate-limited");

    // GET /v1/health — سطحي، بلا توكن ولا استعلام قاعدة
    if (isHealth) return ok(request, env, { ok: true }, { complete: true, count: 0, generatedAt: Date.now() }, { "Cache-Control": "no-store" });

    if (url.pathname !== "/v1/config") return err(request, env, 404, "not-found");

    // 4) التحقق من التوكن ثم حد المرحلة الثانية بحسب uid
    const m = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "");
    if (!m) return err(request, env, 401, "missing-token");
    let user;
    try { user = await verifyToken(m[1], env.FIREBASE_PROJECT_ID); }
    catch (_) { return err(request, env, 401, "invalid-token"); }
    if (!rateLimit("uid:" + user.sub, 120)) return err(request, env, 429, "rate-limited");

    // 5-6) كروت عامة: يكفي توكن صالح لأي مستخدم مسجل (يطابق allow read: if isSignedIn())
    const cards = await readFlags(env);
    // 7) ETag لحالة المجموعة + دعم If-None-Match ← 304
    const etag = '"cfg-' + (await sha256hex(JSON.stringify(cards))).slice(0, 24) + '"';
    const cacheH = { "Cache-Control": "max-age=60", "ETag": etag };
    const inm = request.headers.get("If-None-Match");
    if (inm && inm.split(",").map(s => s.trim()).includes(etag))
      return new Response(null, { status: 304, headers: { ...corsHeaders(request, env), ...cacheH } });
    // 8) غلاف ثابت + كاش 60 ثانية
    return ok(request, env, { cards }, { complete: true, count: CARD_KEYS.length, version: V, generatedAt: Date.now(), etag }, cacheH);
  },
};
