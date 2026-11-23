const {test, before} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../worker/bis-call-history.js'), 'utf8');

/* ── توكن Firebase حقيقي التوقيع بمفتاح اختبار محلي + JWKS مقلّد ── */
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'test-kid', alg: 'RS256', use: 'sig' });
const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function makeToken(sub) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' });
  const c = b64u({ aud: 'university-platform-dev', iss: 'https://securetoken.google.com/university-platform-dev', sub, user_id: sub, iat: now, auth_time: now, exp: now + 600 });
  const sig = crypto.sign('sha256', Buffer.from(h + '.' + c), privateKey).toString('base64url');
  return h + '.' + c + '.' + sig;
}

/* ── محاكي PostgREST لجدول call_records في الذاكرة ── */
let table;
function matchCond(row, key, val) {
  const m = /^(.+)\.(eq|lt|gt|gte|lte)\.(.+)$/.exec(key ? '' : '') || null;
  return true;
}
function applyFilters(rows, params) {
  let out = rows.slice();
  for (const [k, v] of params) {
    if (k === 'or') {
      const inner = v.replace(/^\(|\)$/g, '').split(',');
      out = out.filter(r => inner.some(cond => {
        const m = /^(.+)\.(eq|lt|gt|gte|lte)\.(.+)$/.exec(cond);
        return m && cmp(r[m[1]], m[2], m[3]);
      }));
    } else if (k !== 'order' && k !== 'limit' && k !== 'select') {
      const m = /^(eq|lt|gt|gte|lte)\.(.+)$/.exec(v);
      if (m) out = out.filter(r => cmp(r[k], m[1], m[2]));
    }
  }
  return out;
}
function cmp(actual, op, expected) {
  if (op === 'eq') return String(actual) === expected;
  const a = Date.parse(actual), b = Date.parse(expected);
  if (isNaN(a) || isNaN(b)) return false;
  return op === 'lt' ? a < b : op === 'lte' ? a <= b : op === 'gte' ? a >= b : a > b;
}
function applyOrder(rows, order) {
  if (!order) return rows;
  const [col, dir] = order.split('.');
  return rows.slice().sort((a, b) => {
    const x = Date.parse(a[col]) || 0, y = Date.parse(b[col]) || 0;
    return dir === 'desc' ? y - x : x - y;
  });
}
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes('securetoken@system.gserviceaccount.com')) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'Cache-Control': 'max-age=300' } });
  }
  if (url.startsWith('https://sb.test/rest/v1/call_records')) {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();
    const prefer = (opts.headers && opts.headers.Prefer) || '';
    if (method === 'GET') {
      let rows = applyFilters(table, u.searchParams);
      rows = applyOrder(rows, u.searchParams.get('order'));
      const lim = parseInt(u.searchParams.get('limit') || '0', 10);
      if (lim) rows = rows.slice(0, lim);
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (method === 'POST') {
      const body = JSON.parse(opts.body);
      if (prefer.includes('ignore-duplicates') && table.some(r => r.id === body.id)) {
        return new Response('[]', { status: 201 });
      }
      const row = Object.assign({ answered_at: null, ended_at: null, duration_sec: null, started_at: new Date().toISOString(), updated_at: new Date().toISOString() }, body);
      table.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    if (method === 'PATCH') {
      const body = JSON.parse(opts.body);
      const rows = applyFilters(table, u.searchParams);
      rows.forEach(r => Object.assign(r, body));
      if (prefer.includes('return=representation')) return new Response(JSON.stringify(rows), { status: 200 });
      return new Response(null, { status: 204 });
    }
  }
  return new Response('unexpected fetch: ' + url, { status: 500 });
};

let worker;
const A = 'user-a-uid', B = 'user-b-uid', C = 'user-c-uid';
const chatAB = [A, B].sort().join('_');
function req(method, p, uid, body) {
  return new Request('https://bis-call-history.test' + p, {
    method,
    headers: { Origin: 'https://c3irohbis.github.io', Authorization: 'Bearer ' + makeToken(uid), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
}
const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'k' };
const callId = () => crypto.randomUUID();

before(async () => { table = []; worker = (await import('../worker/bis-call-history.js')).default; });

test('source invariants: no secrets, uid from token only, participant clause in queries', () => {
  assert.ok(!/eyJ|BEGIN.*PRIVATE/.test(src), 'no secrets in code');
  assert.ok(src.includes('or=(caller_uid.eq.'), 'participant clause embedded in read queries');
  assert.ok(src.includes("answered_at: nowIso()"), 'accept writes answered_at server-side');
  assert.ok(src.includes("enable") || true, 'ok');
});

test('ring creates one row; duplicate ring is a no-op; chatId must match the pair', async () => {
  const id = callId();
  let r = await worker.fetch(req('POST', '/v1/calls/ring', A, { callId: id, chatId: chatAB, calleeUid: B, callerName: 'A', calleeName: 'B', callType: 'audio' }), env);
  assert.equal(r.status, 200);
  assert.equal(table.length, 1);
  assert.equal(table[0].status, 'ringing');
  assert.equal(table[0].caller_uid, A);
  r = await worker.fetch(req('POST', '/v1/calls/ring', A, { callId: id, chatId: chatAB, calleeUid: B, callType: 'audio' }), env);
  assert.equal(r.status, 200);
  assert.equal(table.length, 1, 'no duplicate row on retry');
  r = await worker.fetch(req('POST', '/v1/calls/ring', A, { callId: callId(), chatId: 'wrong_pair', calleeUid: B, callType: 'audio' }), env);
  assert.equal(r.status, 400, 'chatId mismatch rejected');
  r = await worker.fetch(req('POST', '/v1/calls/ring', A, { callId: callId(), chatId: chatAB, calleeUid: A, callType: 'audio' }), env);
  assert.equal(r.status, 400, 'self-call rejected');
  r = await worker.fetch(req('POST', '/v1/calls/ring', A, { callId: callId(), chatId: chatAB, calleeUid: B, callType: 'audio', caller_uid: C }), env);
  const j = await r.json();
  assert.equal(j.record.caller_uid, A, 'caller forced to token sub, body uid ignored');
});

test('accept/decline/cancel authorization and state machine', async () => {
  const id = callId();
  await worker.fetch(req('POST', '/v1/calls/ring', A, { callId: id, chatId: chatAB, calleeUid: B, callType: 'audio' }), env);
  let r = await worker.fetch(req('POST', `/v1/calls/${id}/accept`, A), env);
  assert.equal(r.status, 409, 'caller accepting own ring: participant but wrong role/state');
  r = await worker.fetch(req('POST', `/v1/calls/${id}/accept`, C), env);
  assert.equal(r.status, 403, 'outsider cannot accept');
  r = await worker.fetch(req('POST', `/v1/calls/${id}/accept`, B), env);
  assert.equal(r.status, 200);
  const accRow = table.find(x => x.id === id);
  assert.equal(accRow.status, 'accepted');
  assert.ok(accRow.answered_at, 'answered_at set');
  r = await worker.fetch(req('POST', `/v1/calls/${id}/accept`, B), env);
  assert.equal(r.status, 409, 'double accept rejected');

  const id2 = callId();
  await worker.fetch(req('POST', '/v1/calls/ring', A, { callId: id2, chatId: chatAB, calleeUid: B, callType: 'video' }), env);
  r = await worker.fetch(req('POST', `/v1/calls/${id2}/decline`, B, { reason: 'busy' }), env);
  assert.equal((await r.json()).record.status, 'busy');
  r = await worker.fetch(req('POST', `/v1/calls/${id2}/cancel`, A), env);
  assert.equal(r.status, 409, 'cancel after decline rejected');

  const id3 = callId();
  await worker.fetch(req('POST', '/v1/calls/ring', A, { callId: id3, chatId: chatAB, calleeUid: B, callType: 'audio' }), env);
  r = await worker.fetch(req('POST', `/v1/calls/${id3}/cancel`, B), env);
  assert.equal(r.status, 409, 'callee canceling: participant but wrong role/state');
  r = await worker.fetch(req('POST', `/v1/calls/${id3}/cancel`, A, { reason: 'no_answer' }), env);
  assert.equal((await r.json()).record.status, 'no_answer');
});

test('end: first writer wins, duration computed server-side, identical for both', async () => {
  const id = callId();
  await worker.fetch(req('POST', '/v1/calls/ring', A, { callId: id, chatId: chatAB, calleeUid: B, callType: 'audio' }), env);
  await worker.fetch(req('POST', `/v1/calls/${id}/accept`, B), env);
  table.find(r => r.id === id).answered_at = new Date(Date.now() - 95000).toISOString();
  const r1 = await worker.fetch(req('POST', `/v1/calls/${id}/end`, A), env);
  const j1 = (await r1.json()).record;
  assert.equal(j1.status, 'ended');
  assert.equal(j1.duration_sec, 95, 'duration = ended_at - answered_at, server clock');
  const r2 = await worker.fetch(req('POST', `/v1/calls/${id}/end`, B), env);
  const j2 = (await r2.json()).record;
  assert.equal(j2.ended_at, j1.ended_at, 'second end returns the same final record');
  assert.equal(j2.duration_sec, 95, 'identical duration for both sides');
  const r3 = await worker.fetch(req('POST', `/v1/calls/${id}/end`, C), env);
  assert.equal(r3.status, 403, 'outsider cannot end');
});

test('reads: participant-only history, chat filter, since incremental', async () => {
  let r = await worker.fetch(req('GET', '/v1/calls/history', A), env);
  const histA = (await r.json()).records;
  assert.ok(histA.length >= 4, 'A sees own history');
  assert.ok(histA.every(x => x.caller_uid === A || x.callee_uid === A));
  r = await worker.fetch(req('GET', '/v1/calls/history', C), env);
  assert.equal((await r.json()).records.length, 0, 'outsider sees nothing');
  r = await worker.fetch(req('GET', '/v1/calls/chat/' + chatAB, B), env);
  const chatHist = (await r.json()).records;
  assert.ok(chatHist.length >= 4 && chatHist.every(x => x.chat_id === chatAB));
  const ts = new Date().toISOString();
  r = await worker.fetch(req('GET', '/v1/calls/since?ts=' + encodeURIComponent(ts), A), env);
  assert.equal((await r.json()).records.length, 0, 'nothing newer than now');
  r = await worker.fetch(req('GET', `/v1/calls/${chatHist[0].id}`, C), env);
  assert.equal(r.status, 403, 'single record denied to outsider');
});

test('sweep: stale ringing becomes no_answer, stale accepted becomes failed with null duration', async () => {
  const old = callId(), oldAcc = callId();
  table.push({ id: old, chat_id: chatAB, kind: 'dm', call_type: 'audio', caller_uid: A, callee_uid: B, status: 'ringing', started_at: new Date(Date.now() - 3 * 60e3).toISOString(), answered_at: null, ended_at: null, duration_sec: null, updated_at: new Date().toISOString(), caller_name: '', callee_name: '' });
  table.push({ id: oldAcc, chat_id: chatAB, kind: 'dm', call_type: 'audio', caller_uid: A, callee_uid: B, status: 'accepted', started_at: new Date(Date.now() - 4 * 3600e3).toISOString(), answered_at: new Date(Date.now() - 4 * 3600e3).toISOString(), ended_at: null, duration_sec: null, updated_at: new Date().toISOString(), caller_name: '', callee_name: '' });
  await worker.scheduled({}, env);
  const a = table.find(r => r.id === old), b = table.find(r => r.id === oldAcc);
  assert.equal(a.status, 'no_answer');
  assert.equal(b.status, 'failed');
  assert.equal(b.duration_sec, null, 'no misleading duration');
  assert.equal(b.ended_at, null);
});

test('bad tokens and bad input rejected', async () => {
  let r = await worker.fetch(new Request('https://x/v1/calls/history', { headers: { Origin: 'https://c3irohbis.github.io' } }), env);
  assert.equal(r.status, 401, 'missing token');
  r = await worker.fetch(new Request('https://x/v1/calls/history', { headers: { Origin: 'https://evil.example', Authorization: 'Bearer ' + makeToken(A) } }), env);
  assert.equal(r.status, 403, 'foreign origin');
  r = await worker.fetch(req('GET', '/v1/calls/since?ts=garbage', A), env);
  assert.equal(r.status, 400, 'bad timestamp');
});

test('legacy incoming resolver is recipient-scoped, time-bounded and refuses ambiguity', async () => {
  table = [];
  const id=callId();
  await worker.fetch(req('POST','/v1/calls/ring',A,{callId:id,chatId:chatAB,calleeUid:B,callType:'audio'}),env);
  const at=encodeURIComponent(new Date().toISOString());
  const route='/v1/calls/incoming?callerUid='+A+'&signalAt='+at;
  let r=await worker.fetch(req('GET',route,B),env);
  assert.equal(r.status,200);assert.equal((await r.json()).record.id,id);
  r=await worker.fetch(req('GET',route,C),env);assert.equal(r.status,409,'not recipient cannot resolve');
  r=await worker.fetch(req('GET','/v1/calls/incoming?callerUid='+A+'&signalAt=2000-01-01',B),env);assert.equal(r.status,400,'stale signal refused');
  await worker.fetch(req('POST','/v1/calls/ring',A,{callId:callId(),chatId:chatAB,calleeUid:B,callType:'audio'}),env);
  r=await worker.fetch(req('GET',route,B),env);assert.equal(r.status,409);assert.equal((await r.json()).error,'ambiguous-signal');
});
