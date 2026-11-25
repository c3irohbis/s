import {handleAuthority,drainAuthority} from './authority-routes.js';
/* ══════════════════════════════════════════════════════════════════
   bliss-gateway — بوابة «بليس» (المرحلة 1: الأساس)
   المرحلة 1: GET /v1/health و GET /v1/config. المرحلة 2 (كارت التعليمات التجريبي):
     GET  /v1/content/instructions            قراءة الكارت من Supabase (وضع gateway فقط، وإلا 503)
     POST /v1/admin/sync/instructions         مزامنة مفتاح أو ?all=1 — المالك فقط
     GET  /v1/admin/reconcile/instructions    فحص فقط — المالك فقط
     POST /v1/admin/reconcile/instructions/fix إصلاح يدوي — المالك فقط
     GET  /v1/admin/shadow/instructions       مقارنة وتسجيل أعداد في shadow_log — المالك فقط
   المرحلة 3.0 (بنية عامة كامنة — كل الأعلام firebase، لا تفعيل):
     GET  /v1/cards/{card}/content?world=     قراءة كارت عام من card_items (المسجل فقط: news)
     POST /v1/cards/{card}/sync               مزامنة مفتاح أو ?all=1 — المالك فقط
     GET  /v1/cards/{card}/reconcile          فحص فقط — المالك فقط
     POST /v1/cards/{card}/reconcile/fix      إصلاح يدوي — المالك فقط
     GET  /v1/cards/{card}/shadow             مقارنة وتسجيل أعداد — المالك فقط
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
const VALID_MODES = new Set(["firebase","shadow","gateway","supabase"]);
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
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-None-Match, X-File-Name, X-Upload-Context",
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
  for (const k of CARD_KEYS) cards[k] = (VALID_MODES.has(raw[k]) || raw[k] === OWNER_PREVIEW || raw[k] === "supabase-owner") ? raw[k] : "firebase";
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
    revision: row.content_hash || null,
  };
}

/* Instructions badge and per-user read marker also live only in Supabase. */
async function handleInstructionBadge(request,env,user,mark) {
  const mode=(await readFlags(env)).instructions;
  if(!(mode==='supabase'||mode==='supabase-owner'&&user.sub===env.OWNER_UID))return err(request,env,503,'disabled');
  const result=await sb(env,'/rpc/instruction_badge',{method:'POST',body:{p_uid:user.sub,p_mark:mark}});
  if(!result.ok||!Number.isInteger(result.data?.count))return err(request,env,502,'supabase_error');
  return ok(request,env,result.data,{complete:true,source:'supabase'},{'Cache-Control':'no-store'});
}

/* Authoritative instructions: no Firestore, no edge cache, no legacy sync state. */
async function handleAuthoritativeInstructionsRead(request, env) {
  const r = await sbGetInstructions(env);
  if (!r.ok) return err(request, env, 502, "supabase_error");
  if (r.rows.length > INSTR.MAX_ITEMS) return err(request, env, 502, "too_large");
  const items = r.rows.map(rowToClient);
  const etag = '"isa-' + (await sha256hex(JSON.stringify(items))).slice(0,24) + '"';
  const body = {v:V,data:items,etag,ts:Date.now(),meta:{complete:true,count:items.length,expected_count:items.length,version:V,generatedAt:Date.now(),etag,source:"supabase"}};
  if (new TextEncoder().encode(JSON.stringify(body)).length > INSTR.MAX_RESP_BYTES) return err(request,env,502,"too_large");
  return new Response(JSON.stringify(body),{headers:{"Content-Type":"application/json","Cache-Control":"no-store",...corsHeaders(request,env),"X-Content-Type-Options":"nosniff"}});
}
async function handleAuthoritativeInstructionsWrite(request, env, user) {
  if (!["supabase","supabase-owner"].includes((await readFlags(env)).instructions)) return err(request,env,503,"disabled");
  if (Number(request.headers.get("Content-Length")) > 65536) return err(request,env,413,"too_large");
  const reader=request.body?.getReader(); if(!reader)return err(request,env,400,"invalid-json");
  const chunks=[];let size=0;
  let timer;
  try {
    await Promise.race([(async()=>{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new Error('too_large');}chunks.push(value);}})(),new Promise((_,reject)=>{timer=setTimeout(()=>{reader.cancel().catch(()=>{});reject(new Error('body_timeout'));},10000);})]);
  } catch(e){try{await reader.cancel();}catch(_){}return err(request,env,e.message==='too_large'?413:408,e.message==='too_large'?'too_large':'body_timeout');}
  finally{clearTimeout(timer);reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const x of chunks){bytes.set(x,at);at+=x.length;}
  let raw;try{raw = new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch(_){return err(request,env,400,"invalid-utf8");}
  let b; try { b=JSON.parse(raw); } catch (_) {return err(request,env,400,"invalid-json");}
  const keys=["key","action","featureTitle","blocks","revision"];
  if (!b || typeof b!=="object" || Array.isArray(b) || Object.keys(b).some(k=>!keys.includes(k)) || !/^[A-Za-z0-9_-]{1,80}$/.test(b.key||"") || !["save","delete"].includes(b.action) || !(b.revision===null || typeof b.revision==="string"&&b.revision.length<=128)) return err(request,env,400,"invalid-input");
  if(b.action==="save") {
    if(typeof b.featureTitle!=="string" || b.featureTitle.length>200 || !Array.isArray(b.blocks) || !b.blocks.length || b.blocks.length>60) return err(request,env,400,"invalid-input");
    for(const x of b.blocks) {
      if(!x || typeof x!=="object" || Object.keys(x).some(k=>!['t','v'].includes(k)) || !['h','p','img'].includes(x.t) || typeof x.v!=="string" || !x.v.trim() || x.v.length>5000) return err(request,env,400,"bad-block");
      if(x.t==='img') {try {const u=new URL(x.v);if(u.protocol!=="https:"||u.hostname!=="res.cloudinary.com"||u.username||u.password||u.port)throw 0;}catch(_){return err(request,env,400,"bad-image-url");}}
    }
  }
  const r=await sb(env,"/rpc/mutate_instruction_authoritative",{method:"POST",body:{p_key:b.key,p_action:b.action,p_title:b.featureTitle||"",p_blocks:b.blocks||[],p_expected:b.revision,p_uid:user.sub}});
  if(!r.ok) {
    if(r.data?.code==='P0001' && r.data.message==='revision-conflict') {
      // An identical write retried after a lost response is a successful no-op.
      if(b.action==='save') {
        const now=await sbGetInstructions(env); const row=now.ok&&now.rows.find(x=>x.feature_key===b.key);
        if(row&&row.feature_title===b.featureTitle&&JSON.stringify(row.blocks)===JSON.stringify(b.blocks)) return ok(request,env,rowToClient(row),{complete:true,source:'supabase'},{'Cache-Control':'no-store'});
      }
      return err(request,env,409,'revision-conflict');
    }
    if(r.data?.code==='P0001'&&['item-limit','card-size-limit'].includes(r.data.message))return err(request,env,409,r.data.message);
    return err(request,env,502,'supabase_error');
  }
  return ok(request,env,b.action==='delete'?r.data:rowToClient(r.data),{complete:true,source:'supabase'},{'Cache-Control':'no-store'});
}

/* مسار القراءة: GET /v1/content/instructions */
async function handleInstructionsContent(request, env, user, cards) {
  if (cards.instructions === "supabase" || (cards.instructions === "supabase-owner" && user.sub === env.OWNER_UID)) return handleAuthoritativeInstructionsRead(request, env);
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


/* ═══ المرحلة 3.0: البنية العامة للكروت ← card_items ═══
   كاملة لكن كامنة: كل مفاتيح الكروت في KV ما زالت "firebase"، فالمسارات العامة
   ترد 503 disabled لأي طالب. كارت instructions يبقى على جدوله ومساراته الخاصة أعلاه.
   فصل الكروت مفروض في ثلاث نقاط: قيد CHECK + تحقق داخل الـRPC في قاعدة البيانات،
   ومفتاح الكارت هنا يأتي من مسار الـURL ويُطابَق مع السجل — لا يُقبل من جسم الطلب أبدًا. */

/* العوالم الـ16 الثابتة (مطابقة js/world-model.js) */
const WORLDS = new Set([
  "is_1","is_2","is_3","is_4","lt_1","lt_2","lt_3","lt_4",
  "th_1","th_2","th_3","th_4","ba_1","ba_2","ba_3","ba_4",
]);

const CARD_LIMITS = {
  MAX_ITEMS: 500,            // أقصى عناصر لكل كارت/عالم في الرد
  MAX_RESP_BYTES: 512 * 1024,
  MAX_SYNC_BODY: 64 * 1024,
  CACHE_TTL_S: 60,
  FS_PAGE_SIZE: 300,
};

/* سجل الكروت المفعّلة بنيويًا: news فقط في 3.0. كل كارت جديد يُضاف هنا بمرحلته الخاصة. */
const CARDS = {
  news: {
    col: "news",             // مجموعة Firestore
    worldScoped: true,       // عالم إلزامي في القراءة والكتابة
    MAX_TITLE: 500,
    MAX_BODY: 10000,
    /* فك مستند Firestore ← عنصر داخلي + تحقق الشكل قبل أي كتابة في Supabase */
    FIELDS: new Set(["title", "body", "worldId", "createdAt", "updatedAt", "updatedBy"]),
    decode(doc) {
      const key = decodeURIComponent((doc.name || "").split("/").pop() || "");
      const f = doc.fields || {};
      // صرامة الشكل (مراجعة المالك نقطة 4): أي حقل خارج مخطط الأخبار يرفض المستند كله
      for (const fname of Object.keys(f)) if (!this.FIELDS.has(fname)) return { error: "unknown-field:" + fname };
      // ساعة المصدر إلزامية (مراجعة المالك نقطة 3): NULL لا يصل RPC أبدًا من هنا
      if (typeof doc.updateTime !== "string" || !doc.updateTime) return { error: "missing-source-time" };
      const item = {
        title: fsDecode(f.title),
        body: fsDecode(f.body) ?? "",
        worldId: fsDecode(f.worldId),
        createdAt: fsDecode(f.createdAt) ?? null,
        updatedAt: fsDecode(f.updatedAt) ?? null,
        updatedBy: fsDecode(f.updatedBy) ?? "",
        sourceUpdateTime: doc.updateTime,
      };
      if (typeof item.title !== "string" || !item.title.trim()) return { error: "bad-title" };
      if (item.title.length > this.MAX_TITLE) return { error: "title-too-long" };
      if (typeof item.body !== "string") return { error: "bad-body" };
      if (item.body.length > this.MAX_BODY) return { error: "body-too-long" };
      if (typeof item.worldId !== "string" || !WORLDS.has(item.worldId)) return { error: "bad-world" };
      return { key, item };
    },
    /* بصمة المحتوى بعد توحيد الصيغة */
    hashOf(item) {
      return JSON.stringify({ title: item.title, body: item.body, worldId: item.worldId });
    },
    /* صف Supabase ← شكل العميل الذي يتوقعه عارض الأخبار (id + الحقول) */
    toClient(row) {
      return {
        id: row.item_key,
        title: row.payload.title,
        body: row.payload.body || "",
        worldId: row.world_id,
        createdAt: row.created_at,
      };
    },
  },
};

/* قراءة صفوف كارت (وعالم) من Supabase — card_key دائمًا من السجل، لا من العميل */
async function sbGetCardItems(env, card, world) {
  // limit=MAX_ITEMS+1: لو اتخطى الحد يوصل 501 ويقفل too_large بدل اقتطاع صامت (مراجعة المالك نقطة 4)
  let q = "/card_items?select=item_key,world_id,payload,created_at,updated_at,updated_by,synced_at,source_update_time,content_hash"
        + "&card_key=eq." + encodeURIComponent(card) + "&deleted_at=is.null&limit=" + (CARD_LIMITS.MAX_ITEMS + 1)
        + "&order=created_at.desc.nullslast";
  if (world !== null) q += "&world_id=eq." + encodeURIComponent(world);
  const r = await sb(env, q);
  if (!r.ok || !Array.isArray(r.data)) return { ok: false, status: r.status };
  return { ok: true, rows: r.data };
}
async function sbGetCardSyncState(env, card, scope) {
  const r = await sb(env, "/sync_state?select=*&card_key=eq." + encodeURIComponent(card) + "&scope=eq." + encodeURIComponent(scope) + "&limit=1");
  if (!r.ok || !Array.isArray(r.data)) return null;
  return r.data[0] || null;
}
async function sbSetCardSyncState(env, card, scope, patch) {
  await sb(env, "/sync_state", {
    method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { card_key: card, scope, ...patch },
  });
}
async function sbUpsertCardItem(env, card, key, item, hash) {
  const def = CARDS[card];
  const r = await sb(env, "/rpc/upsert_card_item", {
    method: "POST",
    body: {
      p_card_key: card, p_item_key: key, p_world_id: def.worldScoped ? item.worldId : null,
      p_payload: def.hashOf ? JSON.parse(def.hashOf(item)) : item,
      p_created_at: item.createdAt, p_updated_at: item.updatedAt, p_updated_by: item.updatedBy,
      p_source_update_time: item.sourceUpdateTime, p_content_hash: hash,
    },
  });
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, result: typeof r.data === "string" ? r.data : String(r.data) }; // applied | noop | stale_rejected
}
async function sbSoftDeleteCardItem(env, card, key) {
  const r = await sb(env, "/rpc/soft_delete_card_item", { method: "POST", body: { p_card_key: card, p_item_key: key } });
  return { ok: r.ok };
}
async function sbCountCardLive(env, card, world) {
  let q = "/card_items?select=item_key&card_key=eq." + encodeURIComponent(card) + "&deleted_at=is.null&limit=" + CARD_LIMITS.MAX_ITEMS;
  if (world !== null) q += "&world_id=eq." + encodeURIComponent(world);
  const r = await sb(env, q);
  return r.ok && Array.isArray(r.data) ? r.data.length : null;
}

/* Firestore: مستند واحد / قائمة مجموعة كاملة — لأي كارت مسجل */
async function fsGetCardDoc(env, def, key, token) {
  let r;
  try {
    r = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${def.col}/${encodeURIComponent(key)}`, {
      headers: { "Authorization": "Bearer " + token },
    });
  } catch (_) { return { status: "network" }; }
  if (r.status === 404) {
    let is404 = false;
    try { const j = await r.json(); is404 = j && j.error && (j.error.status === "NOT_FOUND" || j.error.code === 404); } catch (_) { is404 = false; }
    return is404 ? { status: "not_found" } : { status: "error", code: 404 };
  }
  if (!r.ok) return { status: "error", code: r.status };
  try { return { status: "ok", doc: await r.json() }; } catch (_) { return { status: "error", code: r.status } ; }
}
/* استعلام منظم بفلتر worldId — قواعد Firestore للكروت العالمية (news...) تشترط قيد worldId في القراءة،
   فالقائمة العارية ممنوعة حتى للمالك. النشر 3.0 الأول أثبت ذلك لايف (403 → firestore_incomplete). */
async function fsQueryWorldPage(env, def, world, offset, token) {
  let r;
  try {
    r = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`, {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: def.col }],
          where: { fieldFilter: { field: { fieldPath: "worldId" }, op: "EQUAL", value: { stringValue: world } } },
          limit: CARD_LIMITS.FS_PAGE_SIZE,
          offset,
        },
      }),
    });
  } catch (_) { return { status: "network" }; }
  if (!r.ok) return { status: "error", code: r.status };
  try { return { status: "ok", rows: await r.json() }; } catch (_) { return { status: "error", code: r.status }; }
}

async function fsListCardAll(env, def, token) {
  // الكروت العالمية: تجميع عبر 16 استعلام worldId (القواعد تفرض القيد) — أي صفحة فاشلة ← complete=false
  if (def.worldScoped) {
    const docs = [];
    for (const w of WORLDS) {
      for (let page = 0; page < 50; page++) {
        const q = await fsQueryWorldPage(env, def, w, page * CARD_LIMITS.FS_PAGE_SIZE, token);
        if (q.status !== "ok") return { status: q.status === "network" ? "network" : "error", code: q.code || q.status, docs: [], complete: false };
        const rows = Array.isArray(q.rows) ? q.rows : [];
        for (const row of rows) if (row.document) docs.push(row.document);
        if (rows.length < CARD_LIMITS.FS_PAGE_SIZE) break; // آخر صفحة لهذا العالم
      }
    }
    return { status: "ok", docs, complete: true };
  }
  const docs = [];
  let pageToken = null;
  for (let page = 0; page < 50; page++) {
    const u = new URL(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${def.col}`);
    u.searchParams.set("pageSize", String(CARD_LIMITS.FS_PAGE_SIZE));
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    let r;
    try { r = await fetch(u.toString(), { headers: { "Authorization": "Bearer " + token } }); }
    catch (_) { return { status: "network", docs: [], complete: false }; }
    if (!r.ok) return { status: "error", code: r.status, docs: [], complete: false };
    let j;
    try { j = await r.json(); } catch (_) { return { status: "error", code: r.status, docs: [], complete: false }; }
    for (const d of (j.documents || [])) docs.push(d);
    pageToken = j.nextPageToken || null;
    if (!pageToken) return { status: "ok", docs, complete: true };
  }
  return { status: "error", code: "too-many-pages", docs: [], complete: false };
}

const _cardCacheKey = (card, world) =>
  new Request("https://bliss-cache.internal/v1/cards/" + card + "/content" + (world !== null ? "?world=" + world : ""));
async function bustCardCache(card, world) {
  try { await caches.default.delete(_cardCacheKey(card, world)); } catch (_) {}
}

/* GET /v1/cards/{card}/content?world= — القراءة العامة */
async function handleCardContent(request, env, user, cards, card) {
  const def = CARDS[card];
  const allowed = cards[card] === "gateway" || (cards[card] === "gateway-owner" && user.sub === env.OWNER_UID);
  if (!allowed) return err(request, env, 503, "disabled");

  const url = new URL(request.url);
  const world = def.worldScoped ? url.searchParams.get("world") : null;
  if (def.worldScoped && (!world || !WORLDS.has(world))) return err(request, env, 400, "bad-world");

  const cacheKey = _cardCacheKey(card, world);
  const inm = request.headers.get("If-None-Match");
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const etag = cached.headers.get("ETag");
      if (inm && etag && inm.split(",").map(s => s.trim()).includes(etag))
        return new Response(null, { status: 304, headers: { ...corsHeaders(request, env), "ETag": etag, "Cache-Control": "max-age=" + CARD_LIMITS.CACHE_TTL_S, "X-Cache": "HIT", "X-Content-Type-Options": "nosniff" } });
      const h = new Headers(cached.headers);
      const co = corsHeaders(request, env);
      for (const k in co) h.set(k, co[k]);
      h.set("X-Cache", "HIT");
      return new Response(cached.body, { status: 200, headers: h });
    }
  } catch (_) { /* الكاش أفضل جهد */ }

  const [rowsR, state] = await Promise.all([sbGetCardItems(env, card, world), sbGetCardSyncState(env, card, world || "")]);
  if (!rowsR.ok) return err(request, env, 502, "supabase_error");
  const rows = rowsR.rows;
  const expected = state && typeof state.expected_count === "number" ? state.expected_count : 0;
  if (rows.length === 0 && expected > 0) return err(request, env, 502, "empty_unexpected");
  if (rows.length > CARD_LIMITS.MAX_ITEMS) return err(request, env, 502, "too_large");

  const items = rows.map(def.toClient);
  const fingerprint = await sha256hex(rows.map(r => r.item_key + ":" + (r.content_hash || "")).join("|") + "#" + rows.length + "#" + (world || ""));
  const etag = '"crd-' + fingerprint.slice(0, 24) + '"';
  const meta = { complete: true, count: items.length, expected_count: expected, version: V, generatedAt: Date.now(), etag };
  const body = JSON.stringify({ v: V, data: items, etag, ts: Date.now(), meta });
  if (new TextEncoder().encode(body).length > CARD_LIMITS.MAX_RESP_BYTES) return err(request, env, 502, "too_large");

  const headers = {
    "Content-Type": "application/json", "X-Content-Type-Options": "nosniff",
    "Cache-Control": "max-age=" + CARD_LIMITS.CACHE_TTL_S, "ETag": etag, "X-Cache": "MISS",
    ...corsHeaders(request, env),
  };
  if (inm && inm.split(",").map(s => s.trim()).includes(etag))
    return new Response(null, { status: 304, headers });
  const res = new Response(body, { status: 200, headers });
  try { await caches.default.put(cacheKey, new Response(body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + CARD_LIMITS.CACHE_TTL_S, "ETag": etag, "X-Content-Type-Options": "nosniff" } })); } catch (_) {}
  return res;
}

/* مزامنة مفتاح واحد لأي كارت مسجل */
async function syncOneCard(env, card, key, token) {
  const def = CARDS[card];
  const got = await fsGetCardDoc(env, def, key, token);
  if (got.status === "not_found") {
    const del = await sbSoftDeleteCardItem(env, card, key);
    if (!del.ok) return { key, action: "delete_failed" };
    return { key, action: "deleted" };
  }
  if (got.status !== "ok") return { key, action: "firestore_error", code: got.code || got.status };
  const parsed = def.decode(got.doc);
  if (parsed.error) return { key, action: "invalid_shape", reason: parsed.error };
  const hash = await sha256hex(def.hashOf(parsed.item));
  const up = await sbUpsertCardItem(env, card, key, parsed.item, hash);
  if (!up.ok) return { key, action: "supabase_error", code: up.status };
  return { key, action: up.result, world: parsed.item.worldId || null };
}

/* POST /v1/cards/{card}/sync — المالك فقط */
async function handleCardSync(request, env, user, card) {
  const def = CARDS[card];
  const url = new URL(request.url);
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > CARD_LIMITS.MAX_SYNC_BODY) return err(request, env, 413, "too_large");
  let body = {};
  const raw = await request.text();
  if (raw.length > CARD_LIMITS.MAX_SYNC_BODY) return err(request, env, 413, "too_large");
  if (raw) { try { body = JSON.parse(raw); } catch (_) { return err(request, env, 400, "bad-json"); } }
  const token = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "")[1];

  if (url.searchParams.get("all") === "1") {
    const list = await fsListCardAll(env, def, token);
    if (!list.complete) return err(request, env, 502, "firestore_incomplete");
    const live = await sbCountCardLive(env, card, null);
    if (list.docs.length === 0 && live !== null && live > 0 && url.searchParams.get("confirm") !== "1")
      return err(request, env, 409, "confirm_required");
    const seen = new Set();
    const results = [];
    const perWorld = {}; // عداد العوالم من مصدر الحقيقة (Firestore)
    for (const d of list.docs) {
      const key = decodeURIComponent((d.name || "").split("/").pop() || "");
      seen.add(key);
      const parsed = def.decode(d);
      if (parsed.error) { results.push({ key, action: "invalid_shape", reason: parsed.error }); continue; }
      if (def.worldScoped) perWorld[parsed.item.worldId] = (perWorld[parsed.item.worldId] || 0) + 1;
      const hash = await sha256hex(def.hashOf(parsed.item));
      const up = await sbUpsertCardItem(env, card, key, parsed.item, hash);
      results.push({ key, action: up.ok ? up.result : "supabase_error" });
    }
    const rowsR = await sbGetCardItems(env, card, null);
    if (rowsR.ok) {
      for (const row of rowsR.rows) {
        if (!seen.has(row.item_key)) {
          const del = await sbSoftDeleteCardItem(env, card, row.item_key);
          results.push({ key: row.item_key, action: del.ok ? "deleted_orphan" : "delete_failed" });
        }
      }
    }
    // حالة المزامنة لكل عالم (العوالم الفارغة تصفر أيضًا) + كاش كل عالم يُمسح
    if (def.worldScoped) {
      for (const w of WORLDS) {
        await sbSetCardSyncState(env, card, w, { expected_count: perWorld[w] || 0, last_reconciled_at: new Date().toISOString(), status: "ok" });
        await bustCardCache(card, w);
      }
    } else {
      await sbSetCardSyncState(env, card, "", { expected_count: list.docs.length, last_reconciled_at: new Date().toISOString(), status: "ok" });
      await bustCardCache(card, null);
    }
    return ok(request, env, { results, total: list.docs.length }, { complete: true, count: results.length, version: V, generatedAt: Date.now() });
  }

  const key = typeof body.key === "string" ? body.key : null;
  if (!key) return err(request, env, 400, "missing-key");
  const result = await syncOneCard(env, card, key, token);
  if (result.action === "firestore_error") return err(request, env, 502, "firestore_error");
  if (result.action === "invalid_shape") return err(request, env, 422, "invalid_shape");
  if (result.action === "supabase_error" || result.action === "delete_failed") return err(request, env, 502, "supabase_error");
  // حدّث عداد العالم المتأثر (أو عداد الكارت للكروت العامة) ثم امسح كاشه.
  // في الحذف لا يعرف الطالب العالم أحيانًا: scope مجهول ← إعادة حساب ومسح لكل العوالم (لا قفلة فارغة كاذبة)
  const scope = def.worldScoped ? (result.world || (body.world && WORLDS.has(body.world) ? body.world : null)) : "";
  if (def.worldScoped && scope === null) {
    for (const w of WORLDS) {
      const c = await sbCountCardLive(env, card, w);
      if (c !== null) await sbSetCardSyncState(env, card, w, { expected_count: c, status: "ok" });
      await bustCardCache(card, w);
    }
  } else {
    const count = await sbCountCardLive(env, card, def.worldScoped ? scope : null);
    if (count !== null) await sbSetCardSyncState(env, card, scope, { expected_count: count, status: "ok" });
    await bustCardCache(card, def.worldScoped ? scope : null);
  }
  return ok(request, env, { results: [result] }, { complete: true, count: 1, version: V, generatedAt: Date.now() });
}

/* مقارنة Firestore ↔ Supabase لأي كارت مسجل — مشتركة بين المصالحة والـ shadow */
async function compareCard(env, card, token) {
  const def = CARDS[card];
  const list = await fsListCardAll(env, def, token);
  if (!list.complete) return { ok: false, reason: "firestore_incomplete", code: list.code || list.status };
  const rowsR = await sbGetCardItems(env, card, null);
  if (!rowsR.ok) return { ok: false, reason: "supabase_error", code: rowsR.status };
  const sbByKey = new Map(rowsR.rows.map(r => [r.item_key, r]));
  const fsByKey = new Map();
  const missing = [], stale = [], orphan = [];
  let fsError = null;
  for (const d of list.docs) {
    const key = decodeURIComponent((d.name || "").split("/").pop() || "");
    const parsed = def.decode(d);
    if (parsed.error) { fsError = parsed.error; fsByKey.set(key, { error: parsed.error }); continue; }
    const hash = await sha256hex(def.hashOf(parsed.item));
    fsByKey.set(key, { item: parsed.item, hash });
    const row = sbByKey.get(key);
    if (!row) { missing.push(key); continue; }
    if (row.content_hash !== hash) stale.push(key);
  }
  for (const row of rowsR.rows) if (!fsByKey.has(row.item_key)) orphan.push(row.item_key);
  return {
    ok: true, missing, stale, orphan,
    counts: { firestore: fsByKey.size, supabase: rowsR.rows.length, missing: missing.length, stale: stale.length, orphan: orphan.length },
    fsError, fsByKey,
  };
}

/* GET /v1/cards/{card}/reconcile — فحص فقط */
async function handleCardReconcile(request, env, user, card) {
  const cmp = await compareCard(env, card, /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "")[1]);
  if (!cmp.ok) return err(request, env, 502, cmp.reason);
  return ok(request, env, { missing: cmp.missing, stale: cmp.stale, orphan: cmp.orphan, counts: cmp.counts, fsShapeError: cmp.fsError },
    { complete: true, count: cmp.counts.firestore, version: V, generatedAt: Date.now() });
}

/* POST /v1/cards/{card}/reconcile/fix — إصلاح يدوي بقرار المالك */
async function handleCardReconcileFix(request, env, user, card) {
  const def = CARDS[card];
  const token = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "")[1];
  const cmp = await compareCard(env, card, token);
  if (!cmp.ok) return err(request, env, 502, cmp.reason);
  const applied = [];
  for (const key of [...cmp.missing, ...cmp.stale]) {
    const f = cmp.fsByKey.get(key);
    if (!f || f.error) continue;
    const up = await sbUpsertCardItem(env, card, key, f.item, f.hash);
    applied.push({ key, action: up.ok ? up.result : "supabase_error" });
  }
  for (const key of cmp.orphan) {
    const del = await sbSoftDeleteCardItem(env, card, key);
    applied.push({ key, action: del.ok ? "deleted_orphan" : "delete_failed" });
  }
  if (def.worldScoped) {
    const perWorld = {};
    for (const [, v] of cmp.fsByKey) if (v.item) perWorld[v.item.worldId] = (perWorld[v.item.worldId] || 0) + 1;
    for (const w of WORLDS) {
      await sbSetCardSyncState(env, card, w, { expected_count: perWorld[w] || 0, last_reconciled_at: new Date().toISOString(), status: "ok" });
      await bustCardCache(card, w);
    }
  } else {
    await sbSetCardSyncState(env, card, "", { expected_count: cmp.counts.firestore, last_reconciled_at: new Date().toISOString(), status: "ok" });
    await bustCardCache(card, null);
  }
  return ok(request, env, { applied, before: cmp.counts }, { complete: true, count: applied.length, version: V, generatedAt: Date.now() });
}

/* GET /v1/cards/{card}/shadow — مقارنة وتسجيل أعداد فقط في shadow_log */
async function handleCardShadow(request, env, user, card) {
  const token = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "")[1];
  const cmp = await compareCard(env, card, token);
  const sourceErrors = { firestore: cmp.ok || cmp.reason !== "firestore_incomplete" ? 0 : 1, supabase: cmp.ok || cmp.reason !== "supabase_error" ? 0 : 1 };
  const compared = cmp.ok ? cmp.counts.firestore : 0;
  const mismatched = cmp.ok ? cmp.counts.missing + cmp.counts.stale + cmp.counts.orphan : 0;
  const diffTypes = cmp.ok ? { missing: cmp.counts.missing, hash: cmp.counts.stale, orphan: cmp.counts.orphan } : null;
  await sb(env, "/shadow_log", {
    method: "POST", prefer: "return=minimal",
    body: { card_key: card, compared, matched: compared - mismatched, mismatched, diff_types: diffTypes, source_errors: sourceErrors },
  });
  if (!cmp.ok) return err(request, env, 502, cmp.reason);
  return ok(request, env, { compared, matched: compared - mismatched, mismatched, diff_types: diffTypes },
    { complete: true, count: compared, version: V, generatedAt: Date.now() });
}

/* Authenticated uploads. Secrets stay in Worker bindings, never in browser code. */
const MEDIA_CLOUD = 'h198yuha';
const MEDIA_FORMATS = Object.freeze({
 jpg:['image/jpeg','image'],jpeg:['image/jpeg','image'],png:['image/png','image'],gif:['image/gif','image'],webp:['image/webp','image'],
 pdf:['application/pdf','raw'],txt:['text/plain','raw'],csv:['text/csv','raw'],
 doc:['application/msword','raw'],docx:['application/vnd.openxmlformats-officedocument.wordprocessingml.document','raw'],
 xls:['application/vnd.ms-excel','raw'],xlsx:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','raw'],
 ppt:['application/vnd.ms-powerpoint','raw'],pptx:['application/vnd.openxmlformats-officedocument.presentationml.presentation','raw'],
 zip:['application/zip','raw'],rar:['application/vnd.rar','raw'], '7z':['application/x-7z-compressed','raw'],
 mp3:['audio/mpeg','video'],wav:['audio/wav','video'],ogg:['audio/ogg','video'],m4a:['audio/mp4','video'],webm:['audio/webm','video'],
 mp4:['video/mp4','video'],mov:['video/quicktime','video']
});
function mediaMagic(ext,b) {
 const ascii=(s,n=0)=>s.split('').every((c,i)=>b[n+i]===c.charCodeAt(0));
 if(['jpg','jpeg'].includes(ext))return b[0]===255&&b[1]===216&&b[2]===255;
 if(ext==='png')return b[0]===137&&ascii('PNG\r\n\x1a\n',1);
 if(ext==='gif')return ascii('GIF87a')||ascii('GIF89a');
 if(ext==='webp')return ascii('RIFF')&&ascii('WEBP',8);
 if(ext==='pdf')return ascii('%PDF-');
 if(['docx','xlsx','pptx','zip'].includes(ext))return ascii('PK')&&[3,5,7].includes(b[2]);
 if(['doc','xls','ppt'].includes(ext))return [208,207,17,224,161,177,26,225].every((x,i)=>b[i]===x);
 if(ext==='rar')return ascii('Rar!');
 if(ext==='7z')return [55,122,188,175,39,28].every((x,i)=>b[i]===x);
 if(ext==='mp3')return ascii('ID3')||(b[0]===255&&(b[1]&224)===224);
 if(ext==='wav')return ascii('RIFF')&&ascii('WAVE',8);
 if(ext==='ogg')return ascii('OggS');
 if(ext==='webm')return [26,69,223,163].every((x,i)=>b[i]===x);
 if(['mp4','m4a','mov'].includes(ext))return ascii('ftyp',4);
 if(['txt','csv'].includes(ext))return !b.includes(0);
 return false;
}
async function handleMediaUpload(request,env,user) {
 const fail=(status,code)=>err(request,env,status,code);
 if(!env.CLOUDINARY_API_KEY||!env.CLOUDINARY_API_SECRET)return fail(503,'media-not-configured');
 const token=request.headers.get('Authorization');
 let profile;
 try {
  const r=await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(user.sub)}`,{headers:{Authorization:token},signal:AbortSignal.timeout(10000)});
  if(!r.ok)return fail(r.status===404||r.status===403?403:503,r.status===404||r.status===403?'media-profile-required':'media-profile-unavailable');
  profile=(await r.json()).fields||{};
 }catch(_){return fail(503,'media-profile-unavailable');}
 if(profile.isBanned?.booleanValue||profile.isChatBanned?.booleanValue)return fail(403,'media-banned');
 const context=request.headers.get('X-Upload-Context')||'general';
 if(!['general','military','instructions'].includes(context))return fail(400,'media-context');
 if(context!=='general'&&user.sub!==env.OWNER_UID)return fail(403,'owner-only');
 let name;
 try{name=decodeURIComponent(request.headers.get('X-File-Name')||'');}catch(_){return fail(400,'media-filename');}
 if(!name||name.length>180||/[\x00-\x1f/\\]/.test(name))return fail(400,'media-filename');
 const ext=name.split('.').pop().toLowerCase(),spec=MEDIA_FORMATS[ext];
 if(!spec)return fail(415,'media-format');
 const type=(request.headers.get('Content-Type')||'').split(';')[0].toLowerCase();
 const aliases={'audio/x-wav':'audio/wav','application/x-zip-compressed':'application/zip','application/x-rar-compressed':'application/vnd.rar','video/webm':'audio/webm'};
 if(type!==spec[0]&&aliases[type]!==spec[0]&&type!=='application/octet-stream')return fail(415,'media-mime');
 const isVideo=['mp4','mov','webm'].includes(ext);
 if(context==='instructions'&&spec[1]!=='image')return fail(415,'media-image-only');
 const max=(isVideo?100:10)*1000*1000;
 const rawLength=request.headers.get('Content-Length');
 if(rawLength!==null&&(!/^\d+$/.test(rawLength)||Number(rawLength)>max||Number(rawLength)<1))return fail(413,'media-size');
 if(!request.body)return fail(400,'media-empty');
 const reader=request.body.getReader(); let first=new Uint8Array(16),sampled=0,total=0;const initial=[];
 const controller=new AbortController();
 const abort=()=>{controller.abort();reader.cancel().catch(()=>{});};
 request.signal?.addEventListener('abort',abort,{once:true});
 if(request.signal?.aborted)abort();
 const timeout=setTimeout(abort,120000);
 try {
 try {
  while(sampled<16){const p=await reader.read();if(p.done)break;total+=p.value.length;if(total>max){await reader.cancel();return fail(413,'media-size');}const n=Math.min(16-sampled,p.value.length);first.set(p.value.subarray(0,n),sampled);sampled+=n;initial.push(p.value);}
 }catch(_){return fail(400,'media-body');}
 if(controller.signal.aborted)return fail(408,'media-timeout');
 if(!sampled||!mediaMagic(ext,first.subarray(0,sampled))){await reader.cancel();return fail(415,'media-content');}
 const timestamp=String(Math.floor(Date.now()/1000)),folder='bliss/'+user.sub;
 const signInput=`folder=${folder}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
 const signature=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signInput)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const boundary='bliss-'+crypto.randomUUID(),enc=new TextEncoder();
 const fields={api_key:env.CLOUDINARY_API_KEY,timestamp,folder,signature};
 let head='';for(const [key,value]of Object.entries(fields))head+=`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
 head+=`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.${ext}"\r\nContent-Type: ${spec[0]}\r\n\r\n`;
 let stage=0,sizeError=false;
 const stream=new ReadableStream({async pull(controller){try{if(stage===0){stage=1;controller.enqueue(enc.encode(head));for(const chunk of initial)controller.enqueue(chunk);initial.length=0;return;}const p=await reader.read();if(p.done){controller.enqueue(enc.encode(`\r\n--${boundary}--\r\n`));controller.close();return;}total+=p.value.length;if(total>max){sizeError=true;await reader.cancel();controller.error(Error('media-size'));return;}controller.enqueue(p.value);}catch(_){controller.error(Error('media-body'));}},cancel(){return reader.cancel();}});
 try {
  const r=await fetch(`https://api.cloudinary.com/v1_1/${MEDIA_CLOUD}/${spec[1]}/upload`,{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary='+boundary},body:stream,duplex:'half',signal:controller.signal});
  if(sizeError)return fail(413,'media-size');
  if(!r.ok)return fail(502,'media-provider-rejected');
  const data=await r.json();
  if(typeof data.secure_url!=='string'||!data.secure_url.startsWith(`https://res.cloudinary.com/${MEDIA_CLOUD}/`))return fail(502,'media-provider-response');
  return new Response(JSON.stringify({secure_url:data.secure_url,public_id:data.public_id,resource_type:data.resource_type,bytes:data.bytes,format:data.format}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...corsHeaders(request,env)}});
 }catch(_){return fail(sizeError?413:502,sizeError?'media-size':'media-upload-failed');}
 } finally{clearTimeout(timeout);request.signal?.removeEventListener('abort',abort);try{await reader.cancel();}catch(_){}}
}

export default {
  async scheduled(controller,env,ctx) {
    if(env.AUTHORITY_MODE!=='supabase')return;
    ctx.waitUntil(drainAuthority(env,{rpc:async(name,body)=>{
      const r=await sb(env,'/rpc/'+name,{method:'POST',body});
      if(!r.ok)throw Error('authority-drain-backend');return r.data;
    }}));
  },
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
      "GET /v1/authority":1,"POST /v1/authority":1,
      "GET /v1/content/instructions/badge":1,"POST /v1/content/instructions/read":1,"POST /v1/admin/content/instructions": 1, "POST /v1/media/upload": 1, "GET /v1/config": 1, "GET /v1/content/instructions": 1,
      "POST /v1/admin/sync/instructions": 1, "GET /v1/admin/reconcile/instructions": 1,
      "POST /v1/admin/reconcile/instructions/fix": 1, "GET /v1/admin/shadow/instructions": 1,
    };
    // المرحلة 3.0: مسارات عامة /v1/cards/{card}/{op} — الكارت لازم يكون مسجلًا في CARDS (news فقط الآن)
    const cardM = /^\/v1\/cards\/([A-Za-z]+)\/(content|sync|reconcile|reconcile\/fix|shadow)$/.exec(url.pathname);
    let cardRoute = null; // { card, op }
    if (cardM) {
      if (!CARDS[cardM[1]]) return err(request, env, 404, "unknown-card"); // مفتاح غير مسجل لا يصل قاعدة البيانات أبدًا
      cardRoute = { card: cardM[1], op: cardM[2] };
    }
    const routeKey = request.method + " " + url.pathname;
    if (!ROUTES[routeKey] && !cardRoute) {
      // محاولة إصلاح عبر GET مرفوضة صراحة (2.3ب): /fix موجود لكن POST فقط
      if (url.pathname === "/v1/admin/reconcile/instructions/fix") return err(request, env, 405, "method-not-allowed");
      if (/^\/v1\/cards\/[A-Za-z]+\/reconcile\/fix$/.test(url.pathname)) return err(request, env, 405, "method-not-allowed");
      return err(request, env, 404, "not-found");
    }
    if (cardRoute) {
      const need = { content: "GET", sync: "POST", reconcile: "GET", "reconcile/fix": "POST", shadow: "GET" }[cardRoute.op];
      if (request.method !== need) return err(request, env, 405, "method-not-allowed");
    }

    // 4) التحقق من التوكن ثم حد المرحلة الثانية بحسب uid
    const m = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "");
    if (!m) return err(request, env, 401, "missing-token");
    let user;
    try { user = await verifyToken(m[1], env.FIREBASE_PROJECT_ID); }
    catch (_) { return err(request, env, 401, "invalid-token"); }
    if (!rateLimit("uid:" + user.sub, 120)) return err(request, env, 429, "rate-limited");

    if(url.pathname==='/v1/authority') {
      const response=await handleAuthority(request,env,user,{rpc:async(name,body)=>{
        const r=await sb(env,'/rpc/'+name,{method:'POST',body});
        if(!r.ok)throw Error(typeof r.data?.message==='string'?r.data.message:'authority-backend');
        return r.data;
      }});
      const headers=new Headers(response.headers);for(const[k,v]of Object.entries(corsHeaders(request,env)))headers.set(k,v);
      return new Response(response.body,{status:response.status,headers});
    }

    // مسارات الإدارة: المالك فقط (uid الثابت، يطابق isOwner() في القواعد)
    const isAdmin = url.pathname.startsWith("/v1/admin/") || (cardRoute && cardRoute.op !== "content");
    if (isAdmin) {
      if (user.sub !== env.OWNER_UID) return err(request, env, 403, "owner-only");
      if (!rateLimit("adm:" + user.sub, 60)) return err(request, env, 429, "rate-limited");
      if (routeKey === "POST /v1/admin/content/instructions") return handleAuthoritativeInstructionsWrite(request,env,user);
      if (url.pathname.includes("instructions") && ["supabase","supabase-owner"].includes((await readFlags(env)).instructions)) return err(request,env,410,"legacy-instructions-disabled");
      if (routeKey === "POST /v1/admin/sync/instructions") return handleSync(request, env, user);
      if (routeKey === "GET /v1/admin/reconcile/instructions") return handleReconcile(request, env, user);
      if (routeKey === "POST /v1/admin/reconcile/instructions/fix") return handleReconcileFix(request, env, user);
      if (routeKey === "GET /v1/admin/shadow/instructions") return handleShadow(request, env, user);
      if (cardRoute && cardRoute.op === "sync") return handleCardSync(request, env, user, cardRoute.card);
      if (cardRoute && cardRoute.op === "reconcile") return handleCardReconcile(request, env, user, cardRoute.card);
      if (cardRoute && cardRoute.op === "reconcile/fix") return handleCardReconcileFix(request, env, user, cardRoute.card);
      if (cardRoute && cardRoute.op === "shadow") return handleCardShadow(request, env, user, cardRoute.card);
    }

    if(routeKey==='GET /v1/content/instructions/badge')return handleInstructionBadge(request,env,user,false);
    if(routeKey==='POST /v1/content/instructions/read')return handleInstructionBadge(request,env,user,true);
    if (routeKey === "POST /v1/media/upload") return handleMediaUpload(request, env, user);
    const cards = await readFlags(env);

    if (routeKey === "GET /v1/content/instructions") return handleInstructionsContent(request, env, user, cards);
    if (cardRoute && cardRoute.op === "content") return handleCardContent(request, env, user, cards, cardRoute.card);

    // GET /v1/config — كروت عامة: يكفي توكن صالح لأي مستخدم مسجل (يطابق allow read: if isSignedIn())
    // تدرّج 2.5: قيمة gateway-owner تظهر "gateway" للمالك و"shadow" لغيره (بلا تغيير كود بين الخطوتين 3 و4)
    const view = { ...cards };
    for (const k of CARD_KEYS) if (view[k] === OWNER_PREVIEW) view[k] = (user.sub === env.OWNER_UID) ? "gateway" : "shadow";
    if(view.instructions === "supabase-owner") view.instructions = user.sub === env.OWNER_UID ? "supabase" : "shadow";
    // ETag لحالة المجموعة + دعم If-None-Match ← 304 (لكل مستخدم: البصمة تشمل هوية المالك)
    const etag = '"cfg-' + (await sha256hex(JSON.stringify(view) + (user.sub === env.OWNER_UID ? ":o" : ""))).slice(0, 24) + '"';
    const cacheH = { "Cache-Control": "max-age=60", "ETag": etag };
    const inm = request.headers.get("If-None-Match");
    if (inm && inm.split(",").map(s => s.trim()).includes(etag))
      return new Response(null, { status: 304, headers: { ...corsHeaders(request, env), ...cacheH } });
    return ok(request, env, { cards: view }, { complete: true, count: CARD_KEYS.length, version: V, generatedAt: Date.now(), etag }, cacheH);
  },
};
