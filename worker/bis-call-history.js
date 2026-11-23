// BIS-main call-history service. Secrets belong only in Cloudflare settings.
// سجل المكالمات على Supabase: المصدر الوحيد للسجل المركزي وأحداث الشات.
// البيئة: SUPABASE_URL (Variable), SUPABASE_SERVICE_KEY (Secret). لا أسرار هنا.
// هوية المستخدم = توكن Firebase المؤكد عبر JWKS فقط؛ لا يُقبل أي uid من العميل.
const ORIGIN = 'https://c3irohbis.github.io';
const PROJECT = 'university-platform-dev';
const enc = new TextEncoder();
const dec = new TextDecoder();
const jwksURL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache;
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
function response(req, status, data) {
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  if (req.headers.get('Origin') === ORIGIN) Object.assign(headers, {
    'Access-Control-Allow-Origin':ORIGIN,
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type',
    'Access-Control-Max-Age':'600'
  });
  return new Response(status === 204 ? null : JSON.stringify(data),{status,headers});
}
async function keys(force=false) {
  if (!force && jwksCache && jwksCache.until > Date.now()) return jwksCache.keys;
  const r=await fetch(jwksURL);
  if(!r.ok) throw Error('keys-unavailable');
  const body=await r.json();
  if(!Array.isArray(body.keys)) throw Error('keys-unavailable');
  const maxAge=Number((r.headers.get('Cache-Control')||'').match(/max-age=(\d+)/)?.[1] || 300);
  jwksCache={keys:body.keys,until:Date.now()+Math.min(3600,maxAge)*1000};
  return body.keys;
}
async function verifyFirebase(token) {
  if(typeof token !== 'string' || token.length>8192) throw Error('token');
  const p=token.split('.');
  if(p.length!==3) throw Error('token');
  const h=JSON.parse(dec.decode(unb64(p[0]))), c=JSON.parse(dec.decode(unb64(p[1])));
  if(h.alg!=='RS256'||typeof h.kid!=='string') throw Error('algorithm');
  let jwk=(await keys()).find(k=>k.kid===h.kid);
  if(!jwk) jwk=(await keys(true)).find(k=>k.kid===h.kid);
  if(!jwk) throw Error('key');
  const k=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',k,unb64(p[2]),enc.encode(p[0]+'.'+p[1]))) throw Error('signature');
  const now=Math.floor(Date.now()/1000);
  if(c.aud!==PROJECT || c.iss!=='https://securetoken.google.com/'+PROJECT || typeof c.sub!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(c.sub)) throw Error('identity');
  if(!Number.isFinite(c.exp)||c.exp<=now||!Number.isFinite(c.iat)||c.iat>now+30||!Number.isFinite(c.auth_time)||c.auth_time>now+30) throw Error('time');
  if(c.user_id && c.user_id!==c.sub) throw Error('identity');
  return c;
}

/* ── Supabase PostgREST عبر service_role (سر في إعدادات العامل فقط) ── */
async function sb(env, method, path, body, prefer) {
  const r = await fetch(env.SUPABASE_URL.replace(/\/+$/,'') + '/rest/v1' + path, {
    method,
    headers: Object.assign({
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
      'Content-Type': 'application/json'
    }, prefer ? {'Prefer': prefer} : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (r.status === 404) return null;
  if (!r.ok) { let d; try { d=await r.json(); } catch {} const e=Error('supabase-' + r.status); e.dbCode = /^[A-Z0-9]{5,12}$/.test(d?.code || '') ? d.code : null; throw e; }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const esc = v => String(v).replace(/[^A-Za-z0-9_:@.-]/g, '');
const isUuid = v => typeof v === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
const isUid = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const capStr = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
const nowIso = () => new Date().toISOString();

/* تحديث شرطي: ينجح لطلب واحد فقط عند التسابق (أول كاتب يكسب) */
async function guardedPatch(env, id, cond, fields) {
  const rows = await sb(env, 'PATCH',
    '/call_records?id=eq.' + esc(id) + cond,
    Object.assign({}, fields, {updated_at: nowIso()}),
    'return=representation');
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
async function getRow(env, id) {
  const rows = await sb(env, 'GET', '/call_records?id=eq.' + esc(id) + '&select=*');
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
const participant = (row, uid) => row && (row.caller_uid === uid || row.callee_uid === uid);

/* حد معدل بسيط لكل مستخدم (أفضل جهد داخل العزل — موثق) */
const _rl = new Map();
function rateLimit(uid, limit) {
  const now = Date.now(), win = 60e3;
  let e = _rl.get(uid);
  if (!e || now >= e.reset) { e = {count: 0, reset: now + win}; _rl.set(uid, e); }
  if (_rl.size > 10000) { for (const [k, v] of _rl) if (now >= v.reset) _rl.delete(k); }
  return ++e.count <= limit;
}

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const auth = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers.get('Authorization')||'');
  if (!auth) return response(req, 401, {error:'missing-token'});
  let user;
  try { user = await verifyFirebase(auth[1]); } catch { return response(req, 401, {error:'invalid-token'}); }
  const uid = user.sub;

  /* ── قراءات: شرط المشاركة داخل الاستعلام نفسه ── */
  if (req.method === 'GET' && path === '/v1/calls/history') {
    if (!rateLimit('r:'+uid, 120)) return response(req, 429, {error:'rate-limited'});
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    let q = '/call_records?or=(caller_uid.eq.' + esc(uid) + ',callee_uid.eq.' + esc(uid) + ')&order=started_at.desc&limit=' + limit;
    const before = url.searchParams.get('before');
    if (before && !isNaN(Date.parse(before))) q += '&started_at=lt.' + encodeURIComponent(before);
    return response(req, 200, {records: (await sb(env, 'GET', q)) || []});
  }
  if (req.method === 'GET' && path.startsWith('/v1/calls/chat/')) {
    if (!rateLimit('r:'+uid, 120)) return response(req, 429, {error:'rate-limited'});
    const chatId = path.slice('/v1/calls/chat/'.length);
    if (!/^[A-Za-z0-9_-]{1,128}_[A-Za-z0-9_-]{1,128}$/.test(chatId)) return response(req, 400, {error:'bad-chat'});
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    let q = '/call_records?chat_id=eq.' + esc(chatId) + '&or=(caller_uid.eq.' + esc(uid) + ',callee_uid.eq.' + esc(uid) + ')&order=started_at.desc&limit=' + limit;
    const before = url.searchParams.get('before');
    if (before && !isNaN(Date.parse(before))) q += '&started_at=lt.' + encodeURIComponent(before);
    return response(req, 200, {records: (await sb(env, 'GET', q)) || []});
  }
  if (req.method === 'GET' && path === '/v1/calls/since') {
    if (!rateLimit('r:'+uid, 120)) return response(req, 429, {error:'rate-limited'});
    const ts = url.searchParams.get('ts') || '';
    if (isNaN(Date.parse(ts))) return response(req, 400, {error:'bad-ts'});
    const q = '/call_records?or=(caller_uid.eq.' + esc(uid) + ',callee_uid.eq.' + esc(uid) + ')&updated_at=gt.' + encodeURIComponent(ts) + '&order=updated_at.asc&limit=100';
    return response(req, 200, {records: (await sb(env, 'GET', q)) || [], ts: nowIso()});
  }
  /* Resolve the legacy ringing signal without adding fields to Firebase. */
  if (req.method === 'GET' && path === '/v1/calls/incoming') {
    if (!rateLimit('r:'+uid, 120)) return response(req, 429, {error:'rate-limited'});
    const caller = url.searchParams.get('callerUid'), at = Date.parse(url.searchParams.get('signalAt') || '');
    if (!isUid(caller) || caller === uid || !Number.isFinite(at) || Math.abs(Date.now()-at)>120000)
      return response(req, 400, {error:'bad-signal'});
    const q='/call_records?caller_uid=eq.'+esc(caller)+'&callee_uid=eq.'+esc(uid)+
      '&status=eq.ringing&started_at=gte.'+encodeURIComponent(new Date(at-15000).toISOString())+
      '&started_at=lte.'+encodeURIComponent(new Date(at+2000).toISOString())+'&order=started_at.desc&limit=2';
    const rows=(await sb(env,'GET',q))||[];
    if(rows.length!==1) return response(req,409,{error:rows.length?'ambiguous-signal':'record-pending'});
    return response(req,200,{record:rows[0]});
  }
  const mOne = /^\/v1\/calls\/([0-9a-fA-F-]{36})$/.exec(path);
  if (req.method === 'GET' && mOne) {
    if (!rateLimit('r:'+uid, 120)) return response(req, 429, {error:'rate-limited'});
    const row = await getRow(env, mOne[1]);
    if (!row) return response(req, 404, {error:'not-found'});
    if (!participant(row, uid)) return response(req, 403, {error:'not-participant'});
    return response(req, 200, {record: row});
  }

  /* ── كتابات: كل انتقال له كاتب واحد مخوَّل + حالة متوقعة (idempotent) ── */
  if (req.method === 'POST' && path === '/v1/calls/ring') {
    if (!rateLimit('w:'+uid, 60)) return response(req, 429, {error:'rate-limited'});
    if (!/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type')||'')) return response(req, 415, {error:'json-required'});
    const text = await req.text();
    if (text.length > 2048) return response(req, 413, {error:'body-too-large'});
    let body; try { body = JSON.parse(text); } catch { return response(req, 400, {error:'bad-json'}); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response(req, 400, {error:'bad-json'});
    if (!isUuid(body.callId)) return response(req, 400, {error:'bad-callId'});
    if (!isUid(body.calleeUid) || body.calleeUid === uid) return response(req, 400, {error:'bad-callee'});
    const chatId = [uid, body.calleeUid].sort().join('_');
    if (body.chatId !== chatId) return response(req, 400, {error:'chat-mismatch'}); /* إثبات الإقران بلا قراءة إضافية */
    const callType = body.callType === 'video' ? 'video' : 'audio';
    await sb(env, 'POST', '/call_records', {
      id: body.callId, chat_id: chatId, kind: 'dm', call_type: callType,
      caller_uid: uid, caller_name: capStr(body.callerName, 60),
      callee_uid: body.calleeUid, callee_name: capStr(body.calleeName, 60),
      status: 'ringing'
    }, 'resolution=ignore-duplicates');
    const row = await getRow(env, body.callId);
    if (!row) throw Error('ring-failed');
    if (row.caller_uid !== uid) return response(req, 403, {error:'id-taken'}); /* إعادة استعمال خبيثة لمعرف */
    return response(req, 200, {record: row, created: row.status === 'ringing'});
  }
  const mAct = /^\/v1\/calls\/([0-9a-fA-F-]{36})\/(accept|decline|cancel|end)$/.exec(path);
  if (req.method === 'POST' && mAct) {
    if (!rateLimit('w:'+uid, 60)) return response(req, 429, {error:'rate-limited'});
    const id = mAct[1], action = mAct[2];
    if (action === 'accept') {
      const row = await guardedPatch(env, id, '&callee_uid=eq.' + esc(uid) + '&status=eq.ringing',
        {status: 'accepted', answered_at: nowIso()});
      if (row) return response(req, 200, {record: row});
    } else if (action === 'decline') {
      let reason = '';
      try { reason = ((await req.json()) || {}).reason; } catch (e) {}
      const row = await guardedPatch(env, id, '&callee_uid=eq.' + esc(uid) + '&status=eq.ringing',
        {status: reason === 'busy' ? 'busy' : 'declined'});
      if (row) return response(req, 200, {record: row});
    } else if (action === 'cancel') {
      let reason = '';
      try { reason = ((await req.json()) || {}).reason; } catch (e) {}
      const row = await guardedPatch(env, id, '&caller_uid=eq.' + esc(uid) + '&status=eq.ringing',
        {status: reason === 'no_answer' ? 'no_answer' : 'canceled'});
      if (row) return response(req, 200, {record: row});
    } else { /* end: أول كاتب يكسب، والمدة تُحسب خادميًا من الطوابع المخزنة */
      const cur = await getRow(env, id);
      if (!cur) return response(req, 404, {error:'not-found'});
      if (!participant(cur, uid)) return response(req, 403, {error:'not-participant'});
      if (cur.status === 'ended') return response(req, 200, {record: cur}); /* idempotent */
      if (cur.status !== 'accepted' || !cur.answered_at) return response(req, 409, {error:'bad-state', status: cur.status});
      const endIso = nowIso();
      const dur = Math.max(0, Math.round((Date.parse(endIso) - Date.parse(cur.answered_at)) / 1000));
      const row = await guardedPatch(env, id, '&status=eq.accepted',
        {status: 'ended', ended_at: endIso, duration_sec: dur});
      return response(req, 200, {record: row || (await getRow(env, id))});
    }
    /* فشل التحديث الشرطي: إما لست طرفًا أو الحالة غير صالحة — نميّز بقراءة */
    const cur = await getRow(env, id);
    if (!cur) return response(req, 404, {error:'not-found'});
    if (!participant(cur, uid)) return response(req, 403, {error:'not-participant'});
    return response(req, 409, {error:'bad-state', status: cur.status});
  }
  return response(req, 404, {error:'not-found'});
}

/* كنس دوري (Cron Trigger): لا يبقى سجل معلقًا — حالات حقيقية في القاعدة */
async function sweep(env) {
  const twoMinAgo = new Date(Date.now() - 2*60*1000).toISOString();
  const threeHoursAgo = new Date(Date.now() - 3*60*60*1000).toISOString();
  await sb(env, 'PATCH', '/call_records?status=eq.ringing&started_at=lt.' + encodeURIComponent(twoMinAgo),
    {status: 'no_answer', updated_at: nowIso()});
  await sb(env, 'PATCH', '/call_records?status=eq.accepted&answered_at=lt.' + encodeURIComponent(threeHoursAgo),
    {status: 'failed', updated_at: nowIso()}); /* ended_at/duration يبقيان NULL: "لم تكتمل" بلا مدة مضللة */
}

export default {
  async fetch(req, env) {
    if (req.headers.get('Origin') !== ORIGIN) return response(req, 403, {error:'origin-not-allowed'});
    if (req.method === 'OPTIONS') return response(req, 204, null); /* الـ preflight لا يعتمد على الإعداد */
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return response(req, 503, {error:'not-configured'});
    try { return await handle(req, env); } catch (e) { return response(req, 502, {error:'upstream-failed', upstream_status: /^supabase-[0-9]{3}$/.test(e.message || '') ? Number(e.message.slice(9)) : null, db_code: e.dbCode || null}); }
  },
  async scheduled(event, env) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return;
    try { await sweep(env); } catch (e) {}
  }
};
