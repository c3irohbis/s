const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const ui = fs.readFileSync(__dirname + '/../js/auth-ui.js', 'utf8');
const br = fs.readFileSync(__dirname + '/../js/auth-bridge.js', 'utf8');
test('register creates no Firebase account before the link; password is asked in the form and kept in the field only', () => {
  const click = ui.slice(ui.indexOf('vBtn.addEventListener("click"'), ui.indexOf('function sendMail()'));
  assert.ok(!/sendVerification|resendEmailLink/.test(click));
  assert.match(click, /invoke\("newSignupHandle"\)/);
  assert.match(click, /invoke\("startSignup", \{ email: em, handle: nh2 \}\)/);
  assert.match(click, /كلمة المرور يجب ألا تقل عن 6 أحرف/);
  assert.ok(!/mailPass"\)\.parentNode\.style\.display = "none"/.test(ui));
  assert.match(ui, /\$\("mailSend"\)\.style\.display = "none"/);
  assert.ok(!/localStorage[^\n]*mailPass|S\.draft[^\n]*mailPass/.test(ui));
});
test('starting browser polls with its handle, completes with the password it holds, and shares the save path', () => {
  const v = ui.slice(ui.indexOf('function vPoll()'), ui.indexOf('document.addEventListener("visibilitychange"'));
  assert.match(v, /invoke\("pollSignup", \{ handle: h \}\)/);
  assert.match(v, /r\.status === "confirmed"\) return vComplete\(\)/);
  assert.match(v, /call\("completeSignup", \{ handle: h, password: pw \}/);
  assert.match(v, /finishCreated\(r\.email/);
  assert.match(ui, /if \(VF\.state !== "sent" \|\| !VF\.handle \|\| VF\.polling \|\| document\.hidden\) return;/);
});
test('link page only confirms when a handle exists, with a delayed fallback to the password page', () => {
  const l = ui.slice(ui.indexOf('function startSignupLink'), ui.indexOf('function startReset'));
  assert.match(l, /call\("confirmSignup"/); assert.match(l, /r\.status === "ok" && r\.poll/); assert.match(l, /go\("confirmed"\)/);
  assert.match(l, /> 25000/); assert.match(l, /openPasswordPage\(token, p\.email\)/);
  assert.match(l, /call\("peekSignup"/);
  assert.match(ui, /confirmed: function \(\) \{ openScreen\("Confirmed"\); \}/);
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
  assert.match(sub, /finishCreated\(r\.email\)/);
  const fc = ui.slice(ui.indexOf('function finishCreated'), ui.indexOf('function finish()'));
  assert.match(fc, /sendEmailLink/); assert.match(fc, /checkEmailVerified/);
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
  assert.equal((ui.match(/invoke\("startSignup", \{ email: (VF\.email|em), handle: nh2?/g) || []).length, 2);
  assert.equal((ui.match(/function \(\) \{ if \(r[gs] !== VF\.gen\) return; VF\.busy = false;|function \(\) \{ if \(sg !== VF\.gen\) return; VF\.busy = false;/g) || []).length, 2);
  assert.match(br, /error: r\.error, message: suMsg/);
});
test('client scripts parse (syntax check)', () => {
  const fs = require('node:fs');
  new Function(fs.readFileSync('js/auth-ui.js', 'utf8'));
  new Function(fs.readFileSync('js/auth-bridge.js', 'utf8').replace(/^import[\s\S]*?from\s+"[^"]+";?/mg, '').replace(/^export /mg, '').replace(/^\}\s*from\s+"[^"]+";?/mg, ''));
});
