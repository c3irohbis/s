const test = require('node:test'), assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const env = { FIREBASE_PROJECT_ID: 'p', SIGNUP_SA_KEY: JSON.stringify({ client_email: 'sa@x', private_key: pem }), GMAIL_CLIENT_ID: 'c', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r', TURNSTILE_SECRET: 'x' };
const req = (path, body) => new Request('https://w.example' + path, { method: 'POST', body: JSON.stringify(body) });
function mk({ existing = false, squat = false, lookupFail = false, mailOk = true, createResult = 'ok', db = {} } = {}) {
  const log = { sent: [], created: [], rpc: [], fetch: [], diag: [] };
  const f = async (url, opts) => {
    log.fetch.push(String(url));
    const u = String(url);
    if (u.includes('turnstile/v0/siteverify')) return Response.json((() => { const t = JSON.parse(opts.body).response; return t === 'nohost' ? { success: true } : t === 'otherhost' ? { success: true, hostname: 'evil.example' } : { success: t === 'good', hostname: 'c3irohbis.github.io' }; })());
    if (u === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 't' });
    if (u.endsWith('/accounts:lookup')) { if (lookupFail) return new Response('{}', { status: 500 }); const created = log.created.length > 0 && createResult === 'boom-after'; return Response.json(existing ? { users: [{ localId: 'e1', emailVerified: true, providerUserInfo: [{ providerId: 'password' }] }] } : squat ? { users: [{ localId: 's1', emailVerified: false, providerUserInfo: [{ providerId: 'password' }] }] } : created ? { users: [{ localId: 'c1', emailVerified: true, providerUserInfo: [{ providerId: 'password' }] }] } : {}); }
    if (u.endsWith('/accounts:update')) { log.updated = (log.updated || []).concat(JSON.parse(opts.body)); return Response.json({}); }
    if (u.endsWith('/accounts')) {
      const b = JSON.parse(opts.body); log.created.push(b);
      if (createResult === 'ok') return Response.json({ localId: 'u' });
      if (createResult === 'boom' || createResult === 'boom-after') return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ error: { message: createResult } }), { status: 400 });
    }
    if (u.includes('gmail.googleapis.com')) { if (!mailOk) return new Response('{}', { status: 500 }); log.sent.push(JSON.parse(opts.body).raw); return Response.json({}); }
    throw Error('unexpected ' + u);
  };
  const rpc = async (name, body) => { if (name === 'signup_diag') { log.diag.push(body); return null; } log.rpc.push([name, body]); return (db[name] || (() => ({ ok: true })))(body); };
  return { f, rpc, log };
}
import('../worker/signup-routes.js').then((m) => m._setBotCheck(true));
const run = async (path, body, o) => { const m = mk(o); const mod = await import('../worker/signup-routes.js'); mod._clearTokenCache(); const r = await mod.handleSignup(req(path, (body && typeof body === 'object' && !('ts' in body) && path.endsWith('/start')) ? { ...body, ts: 'good' } : body), env, { rpc: m.rpc, fetch: m.f, ip: '1.2.3.4' }); return { status: r.status, json: await r.json(), ...m }; };

test('start sends one mail to the typed address only, stores only a hash, link uses hash fragment', async () => {
  const x = await run('/v1/signup/start', { email: ' Ali@Example.com ', ts: 'good' });
  assert.equal(x.status, 200); assert.equal(x.log.sent.length, 1);
  const mime = Buffer.from(x.log.sent[0], 'base64url').toString();
  assert.match(mime, /^To: ali@example\.com$/m);
  const start = x.log.rpc.find(r => r[0] === 'signup_start')[1];
  assert.match(start.p_hash, /^[0-9a-f]{64}$/); assert.equal(start.p_email, 'ali@example.com');
  assert.equal(JSON.stringify(x.log.rpc).includes('password'), false);
  const html = Buffer.from(mime.split('base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString();
  assert.match(html, /\/s\/#signup=[A-Za-z0-9_-]{43}/);
});
test('start rejects bad or header-injecting emails and sends nothing', async () => {
  for (const e of ['a@b', 'a b@c.com', 'x@y.com\r\nBcc: z@z.com', 'a@b.com,c@d.com', '"a"@b.com', '<a@b.com>', 5, null, 'a@b..com'.padEnd(300, 'x')]) {
    const x = await run('/v1/signup/start', { email: e }); assert.equal(x.status, 400, String(e)); assert.equal(x.log.sent.length, 0);
  }
});
test('start for an existing verified account: identical answer, nothing sent, row removed', async () => {
  const x = await run('/v1/signup/start', { email: 'a@b.com' }, { existing: true });
  assert.equal(x.status, 200); assert.deepEqual(x.json, { ok: true }); assert.equal(x.log.sent.length, 0);
  assert.deepEqual(x.log.rpc.map(r => r[0]), ['signup_start', 'signup_finish']);
});
test('start: new and existing addresses hit the quota first and return the same status/body (also at the limit)', async () => {
  for (const existing of [true, false]) {
    const x = await run('/v1/signup/start', { email: 'a@b.com' }, { existing, db: { signup_start: () => ({ error: 'cooldown' }) } });
    assert.equal(x.status, 429); assert.equal(x.log.fetch.filter(u => u.endsWith('lookup')).length, 0);
  }
});
test('start: an unverified password-only squat does not block the real owner (mail is sent)', async () => {
  const x = await run('/v1/signup/start', { email: 'a@b.com' }, { squat: true }); assert.equal(x.log.sent.length, 1);
});
test('start: older links are invalidated only after the mail was sent', async () => {
  const ok = await run('/v1/signup/start', { email: 'a@b.com' }); assert.deepEqual(ok.log.rpc.map(r => r[0]), ['signup_start', 'signup_activate']);
});
test('start: runs the lookup/send in the background when waitUntil is given and answers immediately', async () => {
  const m = mk(); const mod = await import('../worker/signup-routes.js'); mod._clearTokenCache(); const jobs = [];
  const r = await mod.handleSignup(req('/v1/signup/start', { email: 'a@b.com', ts: 'good' }), env, { rpc: m.rpc, fetch: m.f, waitUntil: (p) => jobs.push(p) });
  assert.equal(r.status, 200); assert.equal(jobs.length, 2); await Promise.all(jobs); assert.equal(m.log.sent.length, 1);
});
test('oversized body without Content-Length is cut at 2048 bytes while streaming', async () => {
  const mod = await import('../worker/signup-routes.js');
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"email":"')); for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(1000).fill(97)); c.close(); } });
  const r = await mod.handleSignup(new Request('https://w.example/v1/signup/start', { method: 'POST', body: stream, duplex: 'half' }), env, { rpc: async () => ({}), fetch: async () => { throw Error('no'); } });
  assert.equal(r.status, 400);
});
test('bad SIGNUP_LINK_BASE is ignored (default site is used)', async () => {
  const m = mk(); const mod = await import('../worker/signup-routes.js'); mod._clearTokenCache();
  await mod.handleSignup(req('/v1/signup/start', { email: 'a@b.com', ts: 'good' }), { ...env, SIGNUP_LINK_BASE: 'https://evil.example/"><script>' }, { rpc: m.rpc, fetch: m.f });
  const mime = Buffer.from(m.log.sent[0], 'base64url').toString(); const html = Buffer.from(mime.split('base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString();
  assert.ok(!html.includes('evil.example')); assert.match(html, /c3irohbis\.github\.io\/s\//);
});
test('access token is cached between requests', async () => {
  const mod = await import('../worker/signup-routes.js'); mod._clearTokenCache(); const m = mk();
  await mod.handleSignup(req('/v1/signup/start', { email: 'a@b.com', ts: 'good' }), env, { rpc: m.rpc, fetch: m.f });
  await mod.handleSignup(req('/v1/signup/start', { email: 'c@d.com', ts: 'good' }), env, { rpc: async (n) => (n === 'signup_start' ? { ok: true } : { ok: true }), fetch: m.f });
  assert.equal(m.log.fetch.filter(u => u === 'https://oauth2.googleapis.com/token').length, 2);
});
test('start: cooldown and limits map to 429 and nothing is sent', async () => {
  for (const [err, code] of [['cooldown', 'cooldown'], ['limit', 'rate-limited'], ['busy', 'rate-limited']]) {
    const x = await run('/v1/signup/start', { email: 'a@b.com' }, { db: { signup_start: () => ({ error: err }) } });
    assert.equal(x.status, 429); assert.equal(x.json.error, code); assert.equal(x.log.sent.length, 0);
  }
});
test('start: Gmail send failure removes the pending row and keeps older links valid (no activate)', async () => {
  const x = await run('/v1/signup/start', { email: 'a@b.com' }, { mailOk: false });
  assert.equal(x.status, 200); assert.ok(x.log.rpc.some(r => r[0] === 'signup_finish')); assert.ok(!x.log.rpc.some(r => r[0] === 'signup_activate'));
});
test('start: system-level mail outage (cannot get a Gmail token) is a clear 503 send-failed for every address', async () => {
  const mod = await import('../worker/signup-routes.js'); mod._clearTokenCache(); const m = mk();
  const f = async (u, o) => (String(o && o.body).includes('refresh_token') ? new Response('{}', { status: 400 }) : m.f(u, o));
  const r = await mod.handleSignup(req('/v1/signup/start', { email: 'a@b.com', ts: 'good' }), env, { rpc: m.rpc, fetch: f });
  assert.equal(r.status, 503); assert.equal((await r.json()).error, 'send-failed'); assert.equal(m.log.rpc.length, 0);
});
test('start: missing mail/admin secrets fail closed', async () => {
  const mod = await import('../worker/signup-routes.js');
  const r = await mod.handleSignup(req('/v1/signup/start', { email: 'a@b.com', ts: 'good' }), { ...env, GMAIL_REFRESH_TOKEN: '' }, { rpc: async () => ({}), fetch: async () => { throw Error('no'); } });
  assert.equal(r.status, 503);
});
const TOK = 'A'.repeat(43);
test('peek: valid link returns the email; malformed token never reaches the database', async () => {
  const ok = await run('/v1/signup/peek', { token: TOK }, { db: { signup_peek: () => ({ email: 'a@b.com' }) } });
  assert.equal(ok.status, 200); assert.equal(ok.json.email, 'a@b.com');
  const bad = await run('/v1/signup/peek', { token: 'short' }); assert.equal(bad.status, 400); assert.equal(bad.log.rpc.length, 0);
});
test('complete: consumes then creates a verified account with the chosen password; row removed', async () => {
  const x = await run('/v1/signup/complete', { token: TOK, password: 'secret12' }, { db: { signup_consume: () => ({ email: 'a@b.com' }) } });
  assert.equal(x.status, 200); assert.deepEqual(x.log.created, [{ email: 'a@b.com', password: 'secret12', emailVerified: true }]);
  assert.deepEqual(x.log.rpc.map(r => r[0]), ['signup_consume', 'signup_finish']);
  assert.equal(JSON.stringify(x.log.rpc).includes('secret12'), false);
});
test('complete: used or expired link creates nothing', async () => {
  const x = await run('/v1/signup/complete', { token: TOK, password: 'secret12' }, { db: { signup_consume: () => ({ error: 'invalid' }) } });
  assert.equal(x.status, 400); assert.equal(x.log.created.length, 0);
});
test('complete: weak or oversized password rejected before consuming the link', async () => {
  for (const p of ['12345', 'x'.repeat(129), 7, null]) { const x = await run('/v1/signup/complete', { token: TOK, password: p }); assert.equal(x.status, 400); assert.equal(x.log.rpc.length, 0); }
});
test('complete: genuine Auth failure (lookup shows no account) restores the link', async () => {
  const a = await run('/v1/signup/complete', { token: TOK, password: 'secret12' }, { createResult: 'boom', db: { signup_consume: () => ({ email: 'a@b.com' }) } });
  assert.equal(a.status, 503); assert.ok(a.log.rpc.some(r => r[0] === 'signup_restore'));
});
test('complete: ambiguous outcome (lookup fails) never restores; account found means exists, link stays used', async () => {
  const a = await run('/v1/signup/complete', { token: TOK, password: 'secret12' }, { createResult: 'boom', lookupFail: true, db: { signup_consume: () => ({ email: 'a@b.com' }) } });
  assert.equal(a.status, 503); assert.ok(!a.log.rpc.some(r => r[0] === 'signup_restore'));
  const b = await run('/v1/signup/complete', { token: TOK, password: 'secret12' }, { createResult: 'boom-after', db: { signup_consume: () => ({ email: 'a@b.com' }) } });
  // lookup runs after the failed create; mock reports the account exists only once a create was attempted
  assert.equal(b.status, 200); assert.equal(b.json.ok, true); assert.ok(!b.log.rpc.some(r => r[0] === 'signup_restore')); assert.ok(b.log.rpc.some(r => r[0] === 'signup_finish'));
});
test('complete: EMAIL_EXISTS on a verified account reports exists and changes nothing', async () => {
  const b = await run('/v1/signup/complete', { token: TOK, password: 'secret12' }, { createResult: 'EMAIL_EXISTS', existing: true, db: { signup_consume: () => ({ email: 'a@b.com' }) } });
  assert.equal(b.status, 409); assert.equal((b.log.updated || []).length, 0);
});
test('complete: EMAIL_EXISTS on an unverified password-only squat is taken over (password reset, verified, old sessions revoked)', async () => {
  const b = await run('/v1/signup/complete', { token: TOK, password: 'secret12' }, { createResult: 'EMAIL_EXISTS', squat: true, db: { signup_consume: () => ({ email: 'a@b.com' }) } });
  assert.equal(b.status, 200); assert.equal(b.log.updated.length, 1);
  assert.equal(b.log.updated[0].localId, 's1'); assert.equal(b.log.updated[0].emailVerified, true); assert.equal(b.log.updated[0].password, 'secret12'); assert.match(b.log.updated[0].validSince, /^\d+$/);
});
test('only POST; unknown path 404; oversized body 400', async () => {
  const mod = await import('../worker/signup-routes.js');
  assert.equal((await mod.handleSignup(new Request('https://w.example/v1/signup/start'), env, { rpc: async () => ({}) })).status, 405);
  assert.equal((await run('/v1/signup/other', {})).status, 404);
  assert.equal((await run('/v1/signup/start', { email: 'a@b.com', pad: 'x'.repeat(3000) })).status, 400);
});

test('Turnstile is mandatory: missing secret 503, missing/invalid token 400 with no quota spent, hostname checked', async () => {
  for (const t of [undefined, '', 'bad', 5]) { const x = await run('/v1/signup/start', { email: 'a@b.com', ts: t }); assert.equal(x.status, 400); assert.equal(x.log.rpc.length, 0); assert.equal(x.log.sent.length, 0); }
  const ok = await run('/v1/signup/start', { email: 'a@b.com', ts: 'good' }); assert.equal(ok.status, 200); assert.equal(ok.log.sent.length, 1);
  const saved = env.TURNSTILE_SECRET; delete env.TURNSTILE_SECRET;
  try { const x = await run('/v1/signup/start', { email: 'a@b.com', ts: 'good' }); assert.equal(x.status, 503); assert.equal(x.log.rpc.length, 0); } finally { env.TURNSTILE_SECRET = saved; }
});
test('quota ledger is separate from the token table (SQL)', () => {
  const sql = require('fs').readFileSync(__dirname + '/../worker/signup.sql', 'utf8');
  const start = sql.slice(sql.indexOf('function public.signup_start'), sql.indexOf('function public.signup_activate'));
  assert.doesNotMatch(start, /from public\.signup_pending where (email|ip_hash|created_at>)/);
  assert.match(start, /insert into public\.signup_log/);
  assert.doesNotMatch(sql.slice(sql.indexOf('function public.signup_finish'), sql.indexOf('revoke all on function')), /signup_log/);
});

test('Turnstile hostname must match exactly (missing or different is rejected)', async () => {
  for (const t of ['nohost', 'otherhost']) { const x = await run('/v1/signup/start', { email: 'a@b.com', ts: t }); assert.equal(x.status, 400); assert.equal(x.log.rpc.length, 0); }
});

test('mail is multipart plain+html with transactional headers, visible matching link, escaped address', async () => {
  const mod = await import('../worker/signup-routes.js');
  const link = 'https://c3irohbis.github.io/s/#signup=' + 'A'.repeat(43);
  const m = mod.buildMessage('a+b@example.com', link, 'cairohbis@gmail.com');
  assert.match(m, /^Reply-To: cairohbis@gmail\.com$/m); assert.match(m, /^Auto-Submitted: auto-generated$/m); assert.match(m, /^Content-Language: ar$/m);
  assert.match(m, /multipart\/alternative/); assert.equal((m.match(/Content-Type: text\/(plain|html)/g) || []).length, 2);
  const parts = m.split(/--b_[A-Za-z0-9_-]+/).slice(1, 3).map(p => Buffer.from(p.split('base64\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString());
  assert.ok(parts[0].includes(link) && parts[0].includes('a+b@example.com'));
  assert.ok(parts[1].split(link).length - 1 >= 3);   // button href, visible text, href of visible link
  assert.doesNotMatch(parts[1], /<img|track|pixel/i);
});

test('diagnostics: outcome and a sanitized code are recorded, never the email or token', async () => {
  const mod = await import('../worker/signup-routes.js');
  const m = mk(); const jobs = [];
  const r = await mod.handleSignup(req('/v1/signup/start', { email: 'a@b.com', ts: '', ce: '110200' }), { SIGNUP_SA_KEY: 'k', GMAIL_REFRESH_TOKEN: 'r', GMAIL_CLIENT_ID: 'i', GMAIL_CLIENT_SECRET: 's', TURNSTILE_SECRET: 't' }, { rpc: m.rpc, fetch: m.f, waitUntil: (p) => jobs.push(p) });
  assert.equal(r.status, 400); await Promise.all(jobs);
  assert.deepEqual(m.log.diag, [{ p_outcome: 'no-token', p_detail: '110200' }]);
  assert.ok(!JSON.stringify(m.log.diag).includes('a@b.com'));
});

test('bot check can be switched off: the mail is sent without a token and limits still apply', async () => {
  const mod = await import('../worker/signup-routes.js'); mod._setBotCheck(false);
  try { const r = await run('/v1/signup/start', { email: 'a@b.com', ts: '' }); assert.equal(r.status, 200); assert.equal(r.log.sent.length, 1); assert.ok(r.log.rpc.some((c) => c[0] === 'signup_start')); }
  finally { mod._setBotCheck(true); }
});
