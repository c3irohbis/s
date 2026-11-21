/* ══════════════════════════════════════════════════════════════════
   bliss-gateway — بوابة «بليس» (المرحلة 1: الأساس)
   المرحلة 1: GET /v1/health و GET /v1/config. المرحلة 2 (كارت التعليمات التجريبي):
     GET  /v1/content/instructions            قراءة الكارت من Supabase (وضع gateway فقط، وإلا 503)
     POST /v1/admin/sync/instructions         مزامنة مفتاح أو ?all=1 — المالك فقط
     GET  /v1/admin/reconcile/instructions    فحص فقط — المالك فقط
     POST /v1/admin/reconcile/instructions/fix إصلاح يدوي — المالك فقط
     GET  /v1/admin/shadow/instructions       مقارنة وتسجيل أعداد في shadow_log — المالك فقط
   الأسرار والإعدادات في متغيرات بيئة الـ Worker فقط (لا شيء في الكود):
     FIREBASE_PROJECT_ID  (Variable)  معرّف مشروع Firebase
     OWNER_UID            (Variable)  UID المالك الثابت (يطابق isOwner() في القواعد)
     ALLOWED_ORIGINS      (Variable)  أصول مسموحة مفصولة بفواصل
     FLAGS_DEFAULT        (Variable, اختياري) JSON افتراضي لمفاتيح الكروت
     FLAGS                (KV Binding) مفتاح `flags` — JSON { <cardKey>: "firebase"|"shadow"|"gateway" }
     SUPABASE_URL         (Variable)  رابط مشروع Supabase
     SUPABASE_SERVICE_KEY (Secret)    مفتاح service_role — في الـ Worker فقط، لا يصل المتصفح أبدًا
   ══════════════════════════════════════════════════════════════════ */

const V = 1;
// الكروت المعروفة (مفاتيح forum-badges). الافتراضي لأي كارت: firebase
const CARD_KEYS = ["news","lectures","exams","sections","studySchedule","sheets","records","lostFound","military","instructions","tuition"];
const VALID_MODES = new Set(["firebase","shadow","gateway"]);
const OWNER_PREVIEW = "gateway-owner"; // قيمة KV: بوابة للمالك فقط، وshadow للباقين (تدرّج 2.5)

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
  for (const k of CARD_KEYS) cards[k] = (VALID_MODES.has(raw[k]) || raw[k] === OWNER_PREVIEW) ? raw[k] : "firebase";
  return cards;
}

/* ═══ المرحلة 2: كارت التعليمات ← Supabase ═══ */
const INSTR = {
  MAX_ITEMS: 200,            // 2.9: أقصى عناصر المجموعة
  MAX_BLOCKS: 100,           // 2.9: أقصى كتل لكل عنصر (التطبيق يحدّ 60 عند الحفظ)
  MAX_TEXT: 5000,            // MAX_TEXT في js/instructions.js
  MAX_RESP_BYTES: 256 * 1024,
  MAX_SYNC_BODY: 64 * 1024,
  CACHE_TTL_S: 60,
  FS_PAGE_SIZE: 300,
};

/* تحويل حقول Firestore REST إلى قيم JS */
function fsDecode(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsDecode);
  if ("mapValue" in v) {
    const o = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = fsDecode(val);
    return o;
  }
  return null;
}

/* قراءة مستند واحد من Firestore بتوكن المالك — يميّز 404 القاطع عن أي فشل آخر */
async function fsGetDoc(env, key, token) {
  let r;
  try {
    r = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/instructions/${encodeURIComponent(key)}`, {
      headers: { "Authorization": "Bearer " + token },
    });
  } catch (_) { return { status: "network" }; }
  if (r.status === 404) {
    // نتأكد أنه NOT_FOUND حقيقي في جسم الرد وليس صفحة خطأ
    let is404 = false;
    try { const j = await r.json(); is404 = j && j.error && (j.error.status === "NOT_FOUND" || j.error.code === 404); } catch (_) { is404 = false; }
    return is404 ? { status: "not_found" } : { status: "error", code: 404 };
  }
  if (!r.ok) return { status: "error", code: r.status };
  try { return { status: "ok", doc: await r.json() }; } catch (_) { return { status: "error", code: r.status }; }
}

/* قائمة المجموعة كاملة بترقيم الصفحات — complete=false عند أي صفحة فاشلة (يلغي قرارات الحذف) */
async function fsListAll(env, token) {
  const docs = [];
  let pageToken = null;
  for (let page = 0; page < 50; page++) {
    const u = new URL(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/instructions`);
    u.searchParams.set("pageSize", String(INSTR.FS_PAGE_SIZE));
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    let r;
    try { r = await fetch(u.toString(), { headers: { "Authorization": "Bearer " + token } }); }
    catch (_) { return { status: "network", docs: [], complete: false }; }
    if (!r.ok) return { status: "error", code: r.status, docs: [], complete: false };
    let j;
    try { j = await r.json(); } catch (_) { return { status: "error", code: r.status, docs: [], complete: false }; }
    for (const d of (j.documents || [])) docs.push(d);
    pageToken = j.nextPageToken || null;
    if (!pageToken) return { status: "ok", docs, complete: true }; // آخر صفحة بلا nextPageToken
  }
  return { status: "error", code: "too-many-pages", docs: [], complete: false };
}

/* فك مستند تعليمات إلى الشكل الداخلي + تحقق الشكل قبل الكتابة (2.3) */
function fsDocToInstruction(doc) {
  const key = decodeURIComponent((doc.name || "").split("/").pop() || "");
  const f = doc.fields || {};
  const item = {
    featureKey: fsDecode(f.featureKey) ?? key,
    featureTitle: fsDecode(f.featureTitle) ?? "",
    blocks: fsDecode(f.blocks) ?? [],
    createdAt: fsDecode(f.createdAt) ?? null,
    updatedAt: fsDecode(f.updatedAt) ?? null,
    updatedBy: fsDecode(f.updatedBy) ?? "",
    sourceUpdateTime: doc.updateTime || null, // ساعة خادم Firestore
  };
  if (!Array.isArray(item.blocks)) return { error: "blocks-not-array" };
  if (item.blocks.length > INSTR.MAX_BLOCKS) return { error: "too-many-blocks" };
  for (const b of item.blocks) {
    if (!b || typeof b !== "object" || !["h", "p", "img"].includes(b.t)) return { error: "bad-block-type" };
    if (typeof b.v !== "string") return { error: "bad-block-value" };
    if (b.t === "img") {
      if (!/^https:\/\/res\.cloudinary\.com\//.test(b.v)) return { error: "bad-image-url" }; // Cloudinary فقط
    } else if (b.v.length > INSTR.MAX_TEXT) return { error: "text-too-long" };
  }
  return { key, item };
}

/* بصمة المحتوى بعد توحيد الصيغة (JSON مرتّب المفاتيح) */
async function contentHash(item) {
  const norm = JSON.stringify({
    featureKey: item.featureKey, featureTitle: item.featureTitle,
    blocks: (item.blocks || []).map(b => ({ t: b.t, v: b.v })),
  });
  return sha256hex(norm);
}

/* Supabase PostgREST بمفتاح الخدمة — لا يُستدعى من المتصفح أبدًا */
async function sb(env, path, opts) {
  opts = opts || {};
  let r;
  try {
    r = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1" + path, {
      method: opts.method || "GET",
      headers: {
        "apikey": env.SUPABASE_SERVICE_KEY,
        "Authorization": "Bearer " + env.SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
        ...(opts.prefer ? { "Prefer": opts.prefer } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (_) { return { ok: false, network: true }; }
  let data = null;
  const txt = await r.text();
  if (txt) { try { data = JSON.parse(txt); } catch (_) { data = txt; } }
  return { ok: r.ok, status: r.status, data };
}

async function sbGetInstructions(env) {
  const r = await sb(env, "/instructions?select=feature_key,feature_title,blocks,created_at,updated_at,updated_by,synced_at,source_update_time,content_hash&deleted_at=is.null&order=feature_key.asc&limit=1000");
  if (!r.ok || !Array.isArray(r.data)) return { ok: false, status: r.status };
  return { ok: true, rows: r.data };
}
async function sbGetSyncState(env) {
  const r = await sb(env, "/sync_state?select=*&card_key=eq.instructions&limit=1");
  if (!r.ok || !Array.isArray(r.data)) return null;
  return r.data[0] || null;
}
async function sbSetSyncState(env, patch) {
  await sb(env, "/sync_state", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { card_key: "instructions", ...patch },
  });
}
async function sbUpsertInstruction(env, key, item, hash) {
  const r = await sb(env, "/rpc/upsert_instruction", {
    method: "POST",
    body: {
      p_feature_key: key, p_feature_title: item.featureTitle, p_blocks: item.blocks,
      p_created_at: item.createdAt, p_updated_at: item.updatedAt, p_updated_by: item.updatedBy,
      p_source_update_time: item.sourceUpdateTime, p_content_hash: hash,
    },
  });
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, result: typeof r.data === "string" ? r.data : String(r.data) }; // applied | noop | stale_rejected
}
async function sbSoftDelete(env, key) {
  const r = await sb(env, "/rpc/soft_delete_instruction", { method: "POST", body: { p_feature_key: key } });
  return { ok: r.ok };
}
async function sbCountLive(env) {
  const r = await sb(env, "/instructions?select=feature_key&deleted_at=is.null&limit=1000");
  return r.ok && Array.isArray(r.data) ? r.data.length : null;
}

/* صف Supabase ← شكل العميل الذي يتوقعه instructions.js (id + الحقول) */
function rowToClient(row) {
  return {
    id: row.feature_key,
    featureKey: row.feature_key,
    featureTitle: row.feature_title,
    blocks: row.blocks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/* مسار القراءة: GET /v1/content/instructions */
async function handleInstructionsContent(request, env, user, cards) {
  // 2.7/4: الكارت لازم يكون gateway (أو gateway-owner مع طالب هو المالك) وإلا 503 disabled
  const allowed = cards.instructions === "gateway" || (cards.instructions === "gateway-owner" && user.sub === env.OWNER_UID);
  if (!allowed) return err(request, env, 503, "disabled");

  const cacheKey = new Request("https://bliss-cache.internal/v1/content/instructions");
  const inm = request.headers.get("If-None-Match");
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const etag = cached.headers.get("ETag");
      if (inm && etag && inm.split(",").map(s => s.trim()).includes(etag))
        return new Response(null, { status: 304, headers: { ...corsHeaders(request, env), "ETag": etag, "Cache-Control": "max-age=" + INSTR.CACHE_TTL_S, "X-Cache": "HIT", "X-Content-Type-Options": "nosniff" } });
      // Headers لا تُفرد بالـspread ({...cached.headers} = {})؛ تُنسخ بـnew Headers وإلا ضاعت ETag/Cache-Control عن إصابات الكاش
      const h = new Headers(cached.headers);
      const co = corsHeaders(request, env);
      for (const k in co) h.set(k, co[k]);
      h.set("X-Cache", "HIT");
      return new Response(cached.body, { status: 200, headers: h });
    }
  } catch (_) { /* الكاش أفضل جهد */ }

  const [rowsR, state] = await Promise.all([sbGetInstructions(env), sbGetSyncState(env)]);
  if (!rowsR.ok) return err(request, env, 502, "supabase_error");
  const rows = rowsR.rows;
  const expected = state && typeof state.expected_count === "number" ? state.expected_count : 0;
  // 2.8: الفراغ يُقبل فقط إذا expected_count == 0، وإلا 502 (مشكلة مزامنة لا كارت فارغ)
  if (rows.length === 0 && expected > 0) return err(request, env, 502, "empty_unexpected");
  if (rows.length > INSTR.MAX_ITEMS) return err(request, env, 502, "too_large");

  const items = rows.map(rowToClient);
  const fingerprint = await sha256hex(rows.map(r => r.feature_key + ":" + (r.content_hash || "")).join("|") + "#" + rows.length);
  const etag = '"ins-' + fingerprint.slice(0, 24) + '"';
  const meta = {
    complete: true, count: items.length, expected_count: expected,
    version: V, generatedAt: Date.now(), etag,
  };
  const body = JSON.stringify({ v: V, data: items, etag, ts: Date.now(), meta });
  if (new TextEncoder().encode(body).length > INSTR.MAX_RESP_BYTES) return err(request, env, 502, "too_large");

  const headers = {
    "Content-Type": "application/json", "X-Content-Type-Options": "nosniff",
    "Cache-Control": "max-age=" + INSTR.CACHE_TTL_S, "ETag": etag, "X-Cache": "MISS",
    ...corsHeaders(request, env),
  };
  if (inm && inm.split(",").map(s => s.trim()).includes(etag))
    return new Response(null, { status: 304, headers });
  const res = new Response(body, { status: 200, headers });
  try { await caches.default.put(cacheKey, new Response(body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + INSTR.CACHE_TTL_S, "ETag": etag, "X-Content-Type-Options": "nosniff" } })); } catch (_) {}
  return res;
}

/* مسح كاش المركز الحالي بعد مزامنة ناجحة (أفضل جهد — 2.2) */
async function bustInstructionsCache() {
  try { await caches.default.delete(new Request("https://bliss-cache.internal/v1/content/instructions")); } catch (_) {}
}

/* مزامنة مفتاح واحد: Firestore (بتوكن المالك) ← تحقق ← Supabase RPC */
async function syncOne(env, key, token) {
  const got = await fsGetDoc(env, key, token);
  if (got.status === "not_found") {
    // حذف فقط عند 404 قاطع — حذف ناعم
    const del = await sbSoftDelete(env, key);
    if (!del.ok) return { key, action: "delete_failed" };
    return { key, action: "deleted" };
  }
  if (got.status !== "ok") return { key, action: "firestore_error", code: got.code || got.status }; // لا تغيير إطلاقًا
  const parsed = fsDocToInstruction(got.doc);
  if (parsed.error) return { key, action: "invalid_shape", reason: parsed.error };
  const hash = await contentHash(parsed.item);
  const up = await sbUpsertInstruction(env, key, parsed.item, hash);
  if (!up.ok) return { key, action: "supabase_error", code: up.status };
  return { key, action: up.result }; // applied | noop | stale_rejected
}

/* POST /v1/admin/sync/instructions — المالك فقط */
async function handleSync(request, env, user) {
  const url = new URL(request.url);
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > INSTR.MAX_SYNC_BODY) return err(request, env, 413, "too_large");
  let body = {};
  const raw = await request.text();
  if (raw.length > INSTR.MAX_SYNC_BODY) return err(request, env, 413, "too_large");
  if (raw) { try { body = JSON.parse(raw); } catch (_) { return err(request, env, 400, "bad-json"); } }
  const token = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "")[1];

  if (url.searchParams.get("all") === "1") {
    // إعادة مزامنة كاملة: حارس القائمة الفارغة + لا حذف أيتام إلا بعد ترقيم مكتمل
    const list = await fsListAll(env, token);
    if (!list.complete) return err(request, env, 502, "firestore_incomplete"); // يلغي كل قرارات الحذف
    const live = await sbCountLive(env);
    if (list.docs.length === 0 && live !== null && live > 0 && url.searchParams.get("confirm") !== "1")
      return err(request, env, 409, "confirm_required"); // قائمة فارغة وفيه صفوف: أوقف ما لم confirm=1
    const seen = new Set();
    const results = [];
    for (const d of list.docs) {
      const key = decodeURIComponent((d.name || "").split("/").pop() || "");
      seen.add(key);
      const parsed = fsDocToInstruction(d);
      if (parsed.error) { results.push({ key, action: "invalid_shape", reason: parsed.error }); continue; }
      const hash = await contentHash(parsed.item);
      const up = await sbUpsertInstruction(env, key, parsed.item, hash);
      results.push({ key, action: up.ok ? up.result : "supabase_error" });
    }
    // الأيتام: حذف ناعم فقط بعد اكتمال الترقيم (تحقق أعلاه)
    const rowsR = await sbGetInstructions(env);
    if (rowsR.ok) {
      for (const row of rowsR.rows) {
        if (!seen.has(row.feature_key)) {
          const del = await sbSoftDelete(env, row.feature_key);
          results.push({ key: row.feature_key, action: del.ok ? "deleted_orphan" : "delete_failed" });
        }
      }
    }
    await sbSetSyncState(env, { expected_count: list.docs.length, last_reconciled_at: new Date().toISOString(), status: "ok" });
    await bustInstructionsCache();
    return ok(request, env, { results, total: list.docs.length }, { complete: true, count: results.length, version: V, generatedAt: Date.now() });
  }

  const key = typeof body.key === "string" ? body.key : null;
  if (!key) return err(request, env, 400, "missing-key");
  const result = await syncOne(env, key, token);
  if (result.action === "firestore_error") return err(request, env, 502, "firestore_error"); // تنبيه: لا تغيير
  if (result.action === "invalid_shape") return err(request, env, 422, "invalid_shape");
  if (result.action === "supabase_error" || result.action === "delete_failed") return err(request, env, 502, "supabase_error");
  const count = await sbCountLive(env);
  if (count !== null) await sbSetSyncState(env, { expected_count: count, status: "ok" });
  await bustInstructionsCache();
  return ok(request, env, { results: [result] }, { complete: true, count: 1, version: V, generatedAt: Date.now() });
}

/* مقارنة Firestore ↔ Supabase — مشتركة بين المصالحة والـ shadow */
async function compareInstructions(env, token) {
  const list = await fsListAll(env, token);
  if (!list.complete) return { ok: false, reason: "firestore_incomplete", code: list.code || list.status };
  const rowsR = await sbGetInstructions(env);
  if (!rowsR.ok) return { ok: false, reason: "supabase_error", code: rowsR.status };
  const sbByKey = new Map(rowsR.rows.map(r => [r.feature_key, r]));
  const fsByKey = new Map();
  const missing = [], stale = [], orphan = [];
  let fsError = null;
  for (const d of list.docs) {
    const key = decodeURIComponent((d.name || "").split("/").pop() || "");
    const parsed = fsDocToInstruction(d);
    if (parsed.error) { fsError = parsed.error; fsByKey.set(key, { error: parsed.error }); continue; }
    const hash = await contentHash(parsed.item);
    fsByKey.set(key, { item: parsed.item, hash });
    const row = sbByKey.get(key);
    if (!row) { missing.push(key); continue; }
    if (row.content_hash !== hash) stale.push(key);
  }
  for (const row of rowsR.rows) if (!fsByKey.has(row.feature_key)) orphan.push(row.feature_key);
  return {
    ok: true, missing, stale, orphan,
    counts: { firestore: fsByKey.size, supabase: rowsR.rows.length, missing: missing.length, stale: stale.length, orphan: orphan.length },
    fsError, list, sbRows: rowsR.rows, fsByKey,
  };
}

/* GET /v1/admin/reconcile/instructions — فحص فقط، لا يغيّر شيئًا */
async function handleReconcile(request, env, user) {
  const cmp = await compareInstructions(env, /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "")[1]);
  if (!cmp.ok) return err(request, env, 502, cmp.reason);
  return ok(request, env, { missing: cmp.missing, stale: cmp.stale, orphan: cmp.orphan, counts: cmp.counts, fsShapeError: cmp.fsError },
    { complete: true, count: cmp.counts.firestore, version: V, generatedAt: Date.now() });
}

/* POST /v1/admin/reconcile/instructions/fix — إصلاح يدوي بقرار المالك */
async function handleReconcileFix(request, env, user) {
  const token = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "")[1];
  const cmp = await compareInstructions(env, token);
  if (!cmp.ok) return err(request, env, 502, cmp.reason); // صفحة فاشلة = لا حذف إطلاقًا
  const applied = [];
  for (const key of [...cmp.missing, ...cmp.stale]) {
    const f = cmp.fsByKey.get(key);
    if (!f || f.error) continue;
    const up = await sbUpsertInstruction(env, key, f.item, f.hash);
    applied.push({ key, action: up.ok ? up.result : "supabase_error" });
  }
  for (const key of cmp.orphan) {
    const del = await sbSoftDelete(env, key);
    applied.push({ key, action: del.ok ? "deleted_orphan" : "delete_failed" });
  }
  await sbSetSyncState(env, { expected_count: cmp.counts.firestore, last_reconciled_at: new Date().toISOString(), status: "ok" });
  await bustInstructionsCache();
  return ok(request, env, { applied, before: cmp.counts }, { complete: true, count: applied.length, version: V, generatedAt: Date.now() });
}

/* GET /v1/admin/shadow/instructions — مقارنة وتسجيل أعداد فقط في shadow_log */
async function handleShadow(request, env, user) {
  const token = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "")[1];
  const cmp = await compareInstructions(env, token);
  const sourceErrors = { firestore: cmp.ok || cmp.reason !== "firestore_incomplete" ? 0 : 1, supabase: cmp.ok || cmp.reason !== "supabase_error" ? 0 : 1 };
  const compared = cmp.ok ? cmp.counts.firestore : 0;
  const mismatched = cmp.ok ? cmp.counts.missing + cmp.counts.stale + cmp.counts.orphan : 0;
  const diffTypes = cmp.ok ? { missing: cmp.counts.missing, hash: cmp.counts.stale, orphan: cmp.counts.orphan } : null;
  await sb(env, "/shadow_log", {
    method: "POST", prefer: "return=minimal",
    body: { compared, matched: compared - mismatched, mismatched, diff_types: diffTypes, source_errors: sourceErrors },
  });
  if (!cmp.ok) return err(request, env, 502, cmp.reason);
  return ok(request, env, { compared, matched: compared - mismatched, mismatched, diff_types: diffTypes },
    { complete: true, count: compared, version: V, generatedAt: Date.now() });
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
    if (request.method !== "GET" && request.method !== "POST") return err(request, env, 405, "method-not-allowed");

    // 3) حد المرحلة الأولى بحسب IP قبل أي تحقق من التوكن (أفضل جهد)
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const isHealth = url.pathname === "/v1/health";
    if (!rateLimit("ip:" + ip + (isHealth ? ":h" : ""), isHealth ? 60 : 300))
      return err(request, env, 429, "rate-limited");

    // GET /v1/health — سطحي، بلا توكن ولا استعلام قاعدة
    if (isHealth) return ok(request, env, { ok: true }, { complete: true, count: 0, generatedAt: Date.now() }, { "Cache-Control": "no-store" });

    const ROUTES = {
      "GET /v1/config": 1, "GET /v1/content/instructions": 1,
      "POST /v1/admin/sync/instructions": 1, "GET /v1/admin/reconcile/instructions": 1,
      "POST /v1/admin/reconcile/instructions/fix": 1, "GET /v1/admin/shadow/instructions": 1,
    };
    const routeKey = request.method + " " + url.pathname;
    if (!ROUTES[routeKey]) {
      // محاولة إصلاح عبر GET مرفوضة صراحة (2.3ب): /fix موجود لكن POST فقط
      if (url.pathname === "/v1/admin/reconcile/instructions/fix") return err(request, env, 405, "method-not-allowed");
      return err(request, env, 404, "not-found");
    }

    // 4) التحقق من التوكن ثم حد المرحلة الثانية بحسب uid
    const m = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "");
    if (!m) return err(request, env, 401, "missing-token");
    let user;
    try { user = await verifyToken(m[1], env.FIREBASE_PROJECT_ID); }
    catch (_) { return err(request, env, 401, "invalid-token"); }
    if (!rateLimit("uid:" + user.sub, 120)) return err(request, env, 429, "rate-limited");

    // مسارات الإدارة: المالك فقط (uid الثابت، يطابق isOwner() في القواعد)
    const isAdmin = url.pathname.startsWith("/v1/admin/");
    if (isAdmin) {
      if (user.sub !== env.OWNER_UID) return err(request, env, 403, "owner-only");
      if (!rateLimit("adm:" + user.sub, 60)) return err(request, env, 429, "rate-limited");
      if (routeKey === "POST /v1/admin/sync/instructions") return handleSync(request, env, user);
      if (routeKey === "GET /v1/admin/reconcile/instructions") return handleReconcile(request, env, user);
      if (routeKey === "POST /v1/admin/reconcile/instructions/fix") return handleReconcileFix(request, env, user);
      if (routeKey === "GET /v1/admin/shadow/instructions") return handleShadow(request, env, user);
    }

    const cards = await readFlags(env);

    if (routeKey === "GET /v1/content/instructions") return handleInstructionsContent(request, env, user, cards);

    // GET /v1/config — كروت عامة: يكفي توكن صالح لأي مستخدم مسجل (يطابق allow read: if isSignedIn())
    // تدرّج 2.5: قيمة gateway-owner تظهر "gateway" للمالك و"shadow" لغيره (بلا تغيير كود بين الخطوتين 3 و4)
    const view = { ...cards };
    for (const k of CARD_KEYS) if (view[k] === OWNER_PREVIEW) view[k] = (user.sub === env.OWNER_UID) ? "gateway" : "shadow";
    // ETag لحالة المجموعة + دعم If-None-Match ← 304 (لكل مستخدم: البصمة تشمل هوية المالك)
    const etag = '"cfg-' + (await sha256hex(JSON.stringify(view) + (user.sub === env.OWNER_UID ? ":o" : ""))).slice(0, 24) + '"';
    const cacheH = { "Cache-Control": "max-age=60", "ETag": etag };
    const inm = request.headers.get("If-None-Match");
    if (inm && inm.split(",").map(s => s.trim()).includes(etag))
      return new Response(null, { status: 304, headers: { ...corsHeaders(request, env), ...cacheH } });
    return ok(request, env, { cards: view }, { complete: true, count: CARD_KEYS.length, version: V, generatedAt: Date.now(), etag }, cacheH);
  },
};
