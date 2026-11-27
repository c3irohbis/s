// Email sign-up without a Firebase Auth account until the emailed link is used.
// start: validate + rate limit + store token hash + send one fixed Arabic email (recipient = the typed address only).
// peek/complete: the link token is single use; the password is set only at complete and is never stored.
const LINK_BASE_DEFAULT = 'https://c3irohbis.github.io/s/';
const SENDER_NAME = 'منتدى الجامعة';
const SUBJECT = 'رابط تأكيد بريدك في منتدى الجامعة';
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (bytes) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256hex = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
export const normEmail = (e) => (typeof e === 'string' ? e.trim().toLowerCase() : '');
export const validEmail = (e) => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);
export const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);

const safeBase = (b) => (typeof b === 'string' && /^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9_.\/-]*$/.test(b)) ? b : LINK_BASE_DEFAULT;
const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

async function readJson(request) {
  const len = request.headers.get('Content-Length');
  if (len && Number(len) > 2048) throw Error('body-limit');
  const reader = request.body && request.body.getReader();
  if (!reader) throw Error('invalid');
  const parts = []; let size = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > 2048) { await reader.cancel().catch(() => {}); throw Error('body-limit'); }
    parts.push(r.value);
  }
  const bytes = new Uint8Array(size); let at = 0; for (const p of parts) { bytes.set(p, at); at += p.length; }
  const v = JSON.parse(new TextDecoder().decode(bytes));
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('invalid');
  return v;
}

const tcache = new Map();
const withTimeout = (f) => (u, o) => f(u, { ...(o || {}), signal: AbortSignal.timeout(10000) });
async function cached(key, make) {
  const c = tcache.get(key);
  if (c && c.until > Date.now()) return c.token;
  const t = await make();
  tcache.set(key, { token: t, until: Date.now() + 45 * 60 * 1000 });
  return t;
}
export const _clearTokenCache = () => tcache.clear();
async function googleToken(env, f, scope) {
  return cached('sa:' + scope, () => googleTokenFresh(env, f, scope));
}
async function googleTokenFresh(env, f, scope) {
  const sa = JSON.parse(env.SIGNUP_SA_KEY);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))) + '.' + b64url(enc.encode(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 })));
  const pem = sa.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
  const r = await f('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + b64url(sig) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Error('auth-token');
  return j.access_token;
}

async function gmailToken(env, f) {
  return cached('gmail', () => gmailTokenFresh(env, f));
}
async function gmailTokenFresh(env, f) {
  const r = await f('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Error('mail-token');
  return j.access_token;
}

const mimeWord = (s) => '=?UTF-8?B?' + btoa(String.fromCharCode(...enc.encode(s))) + '?=';
const b64lines = (s) => btoa(String.fromCharCode(...enc.encode(s))).replace(/.{1,76}/g, '$&\r\n');
const escHtml = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function buildMessage(to, link, fromAddr) {
  const text = [
    'مرحبًا،', '',
    'وصلنا طلب لإنشاء حساب في منتدى الجامعة بهذا البريد الإلكتروني (' + to + ').', '',
    'لإكمال إنشاء الحساب وتحديد كلمة المرور، افتح هذا الرابط:', link, '',
    'الرابط صالح لمدة 30 دقيقة ويُستخدم مرة واحدة فقط.', '',
    'إذا لم تطلب إنشاء حساب، تجاهل هذه الرسالة. لن يُنشأ أي حساب ولن يُحفظ أي شيء، ويُحذف الطلب تلقائيًا.', '',
    'منتدى الجامعة'].join('\r\n');
  const html = '<!DOCTYPE html><html lang="ar" dir="rtl"><body style="margin:0;padding:16px;background:#ffffff"><div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;color:#222;max-width:520px">'
    + '<p>مرحبًا،</p>'
    + '<p>وصلنا طلب لإنشاء حساب في منتدى الجامعة بهذا البريد الإلكتروني (<span dir="ltr">' + escHtml(to) + '</span>).</p>'
    + '<p>لإكمال إنشاء الحساب وتحديد كلمة المرور، اضغط على الزر:</p>'
    + '<p><a href="' + escHtml(link) + '" style="background:#2563eb;color:#ffffff;padding:10px 22px;border-radius:8px;text-decoration:none;display:inline-block">إكمال إنشاء الحساب</a></p>'
    + '<p style="color:#555;font-size:13px">أو انسخ هذا الرابط في المتصفح:<br><a href="' + escHtml(link) + '" dir="ltr" style="color:#555;word-break:break-all">' + escHtml(link) + '</a></p>'
    + '<p style="color:#555;font-size:13px">الرابط صالح لمدة 30 دقيقة ويُستخدم مرة واحدة فقط.<br>إذا لم تطلب إنشاء حساب، تجاهل هذه الرسالة. لن يُنشأ أي حساب ولن يُحفظ أي شيء، ويُحذف الطلب تلقائيًا.</p>'
    + '<p style="color:#555;font-size:13px">منتدى الجامعة</p></div></body></html>';
  const bnd = 'b_' + b64url(crypto.getRandomValues(new Uint8Array(12)));
  return [
    'From: ' + mimeWord(SENDER_NAME) + ' <' + fromAddr + '>', 'To: ' + to, 'Reply-To: ' + fromAddr, 'Subject: ' + mimeWord(SUBJECT),
    'Auto-Submitted: auto-generated', 'X-Auto-Response-Suppress: All', 'Content-Language: ar', 'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + bnd + '"', '',
    '--' + bnd, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(text),
    '--' + bnd, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(html),
    '--' + bnd + '--', ''].join('\r\n');
}

async function sendMail(env, f, to, link) {
  const token = await gmailToken(env, f);
  const raw = b64url(enc.encode(buildMessage(to, link, env.SIGNUP_SENDER || 'cairohbis@gmail.com')));
  const r = await f('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
  if (!r.ok) throw Error('mail-send');
}

async function authLookup(env, f, email) {
  const t = await googleToken(env, f, 'https://www.googleapis.com/auth/identitytoolkit');
  const r = await f('https://identitytoolkit.googleapis.com/v1/projects/' + env.FIREBASE_PROJECT_ID + '/accounts:lookup', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: [email] }) });
  if (!r.ok) throw Error('auth-lookup');
  const j = await r.json().catch(() => ({}));
  const u = Array.isArray(j.users) && j.users[0];
  return u ? { uid: u.localId, verified: u.emailVerified === true, passwordOnly: Array.isArray(u.providerUserInfo) && u.providerUserInfo.every(p => p.providerId === 'password') } : null;
}

async function authCreate(env, f, email, password) {
  const t = await googleToken(env, f, 'https://www.googleapis.com/auth/identitytoolkit');
  const r = await f('https://identitytoolkit.googleapis.com/v1/projects/' + env.FIREBASE_PROJECT_ID + '/accounts', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, emailVerified: true }) });
  if (r.ok) return 'ok';
  const j = await r.json().catch(() => ({}));
  const m = String(j && j.error && j.error.message || '');
  if (/EMAIL_EXISTS/.test(m)) return 'exists';
  if (/WEAK_PASSWORD|INVALID_PASSWORD/.test(m)) return 'weak';
  throw Error('auth-create');
}

async function authTakeover(env, f, uid, password) {
  const t = await googleToken(env, f, 'https://www.googleapis.com/auth/identitytoolkit');
  const r = await f('https://identitytoolkit.googleapis.com/v1/projects/' + env.FIREBASE_PROJECT_ID + '/accounts:update', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: uid, password, emailVerified: true, validSince: String(Math.floor(Date.now() / 1000)) }) });
  if (!r.ok) throw Error('auth-update');
}

// Bot check switch: Turnstile is OFF by the owner's decision when false; the per-email/IP/global limits still apply.
let BOT_CHECK = false;
export function _setBotCheck(v) { BOT_CHECK = !!v; }
export async function handleSignup(request, env, { rpc, fetch: rawFetch = fetch, ip = '', waitUntil }) {
  const f = withTimeout(rawFetch);
  if (request.method !== 'POST') return reply(405, { error: 'method' });
  const route = new URL(request.url).pathname;
  let body;
  try { body = await readJson(request); } catch (_) { return reply(400, { error: 'invalid' }); }
  if (!env.SIGNUP_SA_KEY || !env.GMAIL_REFRESH_TOKEN || !env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET) return reply(503, { error: 'unavailable' });
  try {
    if (route === '/v1/signup/start') {
      const email = normEmail(body.email);
      if (!validEmail(email)) return reply(400, { error: 'invalid-email' });
      const diag = (o, d) => { try { const p = rpc('signup_diag', { p_outcome: o, p_detail: d || '' }).catch(() => {}); if (waitUntil) waitUntil(p); } catch (_) {} };
      // Bot check (Cloudflare Turnstile), fail-closed once configured. Runs before any quota is spent.
      if (BOT_CHECK) {
        if (!env.TURNSTILE_SECRET) return reply(503, { error: 'unavailable' });
        const tk = typeof body.ts === 'string' ? body.ts : '';
        if (!tk || tk.length > 2048) { diag('no-token', typeof body.ce === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(body.ce) ? body.ce : ''); return reply(400, { error: 'captcha' }); }
        let ok = false;
        try {
          const vr = await f('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: tk, remoteip: ip || undefined }) });
          const vj = await vr.json(); ok = !!(vj && vj.success === true && vj.hostname === 'c3irohbis.github.io'); if (!ok) diag('bad-token', (vj && Array.isArray(vj['error-codes']) ? vj['error-codes'].join(',') : '') + (vj && vj.success && vj.hostname !== 'c3irohbis.github.io' ? ' host-mismatch' : ''));
        } catch (_) { return reply(503, { error: 'unavailable' }); }
        if (!ok) return reply(400, { error: 'captcha' });
      }
      if (BOT_CHECK) diag('token-ok', '');
      // System-level check first (same for every address): can we send mail at all?
      try { await gmailToken(env, f); } catch (_) { return reply(503, { error: 'send-failed' }); }
      const raw = crypto.getRandomValues(new Uint8Array(32)); const token = b64url(raw);
      const hash = await sha256hex(token);
      // Durable quotas run before any account lookup, so every address gets the same answer.
      const s = await rpc('signup_start', { p_email: email, p_hash: hash, p_ip: ip ? (await sha256hex('ip:' + ip)).slice(0, 32) : '', p_ttl: 1800 });
      if (s && s.error === 'cooldown') return reply(429, { error: 'cooldown' });
      if (s && (s.error === 'limit' || s.error === 'busy')) return reply(429, { error: 'rate-limited' });
      if (!s || !s.ok) return reply(503, { error: 'unavailable' });
      const base = safeBase(env.SIGNUP_LINK_BASE);
      const work = (async () => {
        try {
          const u = await authLookup(env, f, email);
          // A verified (or social) account exists: send nothing. An unverified password-only squat is not a reason to block the real owner.
          if (u && (u.verified || !u.passwordOnly)) { await rpc('signup_finish', { p_hash: hash }); return; }
          await sendMail(env, f, email, base + '#signup=' + token);
          await rpc('signup_activate', { p_hash: hash });
        } catch (_) { await rpc('signup_finish', { p_hash: hash }).catch(() => {}); }
      })();
      if (typeof waitUntil === 'function') waitUntil(work); else await work;
      return reply(200, { ok: true });
    }
    if (route === '/v1/signup/peek') {
      if (!validToken(body.token)) return reply(400, { error: 'invalid-link' });
      const p = await rpc('signup_peek', { p_hash: await sha256hex(body.token) });
      return p && p.email ? reply(200, { ok: true, email: p.email }) : reply(400, { error: 'invalid-link' });
    }
    if (route === '/v1/signup/complete') {
      if (!validToken(body.token)) return reply(400, { error: 'invalid-link' });
      const pw = body.password;
      if (typeof pw !== 'string' || pw.length < 6 || pw.length > 128) return reply(400, { error: 'weak-password' });
      const hash = await sha256hex(body.token);
      const c = await rpc('signup_consume', { p_hash: hash });
      if (!c || !c.email) return reply(400, { error: 'invalid-link' });
      let r;
      try { r = await authCreate(env, f, c.email, pw); }
      catch (_) {
        // Ambiguous outcome: never blindly restore. Check what exists.
        let u;
        try { u = await authLookup(env, f, c.email); } catch (_2) { return reply(503, { error: 'unavailable' }); }
        if (u) {
          await rpc('signup_finish', { p_hash: hash }).catch(() => {});
          // A verified password-only account that appeared during our ambiguous create is most likely ours (response lost): report ok; the client sign-in with the chosen password settles it.
          if (u.verified && u.passwordOnly) return reply(200, { ok: true, email: c.email });
          return reply(409, { error: 'exists' });
        }
        await rpc('signup_restore', { p_hash: hash }).catch(() => {});
        return reply(503, { error: 'unavailable' });
      }
      if (r === 'weak') { await rpc('signup_restore', { p_hash: hash }).catch(() => {}); return reply(400, { error: 'weak-password' }); }
      if (r === 'exists') {
        // Only an unverified password-only account (pre-registered squat) is taken over: the link proves mailbox ownership.
        let u;
        try { u = await authLookup(env, f, c.email); } catch (_) { return reply(503, { error: 'unavailable' }); }
        if (u && !u.verified && u.passwordOnly) {
          try { await authTakeover(env, f, u.uid, pw); }
          catch (_) { await rpc('signup_restore', { p_hash: hash }).catch(() => {}); return reply(503, { error: 'unavailable' }); }
          await rpc('signup_finish', { p_hash: hash }).catch(() => {});
          return reply(200, { ok: true, email: c.email });
        }
        await rpc('signup_finish', { p_hash: hash }).catch(() => {});
        return reply(409, { error: 'exists' });
      }
      await rpc('signup_finish', { p_hash: hash }).catch(() => {});
      return reply(200, { ok: true, email: c.email });
    }
    return reply(404, { error: 'not-found' });
  } catch (_) { return reply(503, { error: 'unavailable' }); }
}
