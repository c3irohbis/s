const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const ui = fs.readFileSync(__dirname + '/../js/auth-ui.js', 'utf8');
const br = fs.readFileSync(__dirname + '/../js/auth-bridge.js', 'utf8');
test('register no longer creates a Firebase account or asks for a password before the link', () => {
  const click = ui.slice(ui.indexOf('vBtn.addEventListener("click"'), ui.indexOf('function sendMail()'));
  assert.ok(!/sendVerification|resendEmailLink|mailPass/.test(click));
  assert.match(click, /Promise\.resolve\(\)\.then\(function \(\) \{ if \(sg !== VF\.gen\) return null; return invoke\("startSignup", \{ email: em \}\)/);
  assert.match(ui, /\$\("mailPass"\)\.parentNode\.style\.display = "none"/);
  assert.match(ui, /\$\("mailSend"\)\.style\.display = "none"/);
});
test('no periodic poll for verification any more', () => {
  assert.match(ui, /function vCheck\(\) \{\}/);
  assert.ok(!/setInterval\(function \(\) \{ if \(!document\.hidden\) vCheck/.test(ui));
});
test('signup token comes only from the hash, is stripped from the URL, and holds the site open', () => {
  assert.match(ui, /\(\?:\^#\|&\)signup=\(\[A-Za-z0-9_-\]\{43\}\)/);
  assert.match(ui, /history\.replaceState\(null, "", location\.pathname \+ location\.search\)/);
  assert.match(br, /signup=\[A-Za-z0-9_-\]\{43\}/);
  assert.match(ui, /rl\.mode === "signup" \? startSignupLink/);
});
test('link page sets the password and completes through completeSignup only', () => {
  const sub = ui.slice(ui.indexOf('if (suToken) {'), ui.indexOf('call("confirmReset"'));
  assert.match(sub, /call\("completeSignup", \{ token: tk, password: p1 \}/);
  assert.match(sub, /sendEmailLink/); assert.match(sub, /checkEmailVerified/);
  assert.match(sub, /r\.status === "invalid"/); assert.match(sub, /r\.status === "exists"/);
});
test('bridge signup calls: no credentials, no referrer, fixed gateway URL, password never logged or stored', () => {
  const b = br.slice(br.indexOf('const SIGNUP_API'), br.indexOf('B.resendEmailLink'));
  assert.match(b, /SIGNUP_API = "https:\/\/bliss-gateway\.cairohbis\.workers\.dev\/v1\/signup\/"/);
  assert.match(b, /credentials: "omit"/); assert.match(b, /referrerPolicy: "no-referrer"/);
  assert.ok(!/console\.|localStorage|sessionStorage/.test(b));
  assert.match(b, /busy = true;[\s\S]*signInWithEmailAndPassword/);
  assert.match(b, /resetHold = false/);
});
test('hash token regex accepts only 43-char urlsafe tokens', () => {
  const re = /(?:^#|&)signup=([A-Za-z0-9_-]{43})(?:&|$)/;
  assert.ok(re.test('#signup=' + 'a'.repeat(43)));
  for (const h of ['#signup=short', '#signup=' + 'a'.repeat(44), '#x=signup=' + 'a'.repeat(43), '#signup=' + 'a'.repeat(42) + '!']) assert.ok(!re.test(h), h);
});

test('bot check is off on the client: no widget, no token wait, release of busy state on rejection', () => {
  assert.doesNotMatch(ui, /tsWait|tsTake|tsEnsure|challenges\.cloudflare/);
  assert.equal((ui.match(/Promise\.resolve\(\)\.then\(function \(\) \{ if \(s?r?[gs] !== VF\.gen\) return null; return invoke\("startSignup"/g) || []).length, 2);
  assert.equal((ui.match(/function \(\) \{ if \(r[gs] !== VF\.gen\) return; VF\.busy = false;|function \(\) \{ if \(sg !== VF\.gen\) return; VF\.busy = false;/g) || []).length, 2);
  assert.match(br, /error: r\.error, message: suMsg/);
});
