const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const channel = JSON.parse(fs.readFileSync(path.join(root, "release-channel.json"), "utf8"));
const served = fs.readFileSync(path.join(root, "release", channel.generation, "js/auth-bridge.js"), "utf8");
const source = fs.readFileSync(path.join(root, "js/auth-bridge.js"), "utf8");

test("served auth-bridge equals the reviewed source", () => { assert.strictEqual(served, source); });

test("popup failures that mean 'no popup here' fall back to the redirect path", () => {
  const m = /const POPUP_FALLBACK = \[([^\]]*)\]/.exec(source);
  assert.ok(m);
  for (const c of ["auth/popup-blocked", "auth/internal-error", "auth/network-request-failed", "auth/operation-not-supported-in-this-environment"])
    assert.ok(m[1].includes(c), c);
  assert.ok(!m[1].includes("popup-closed-by-user"), "a plain cancel must not auto-redirect");
  assert.match(source, /POPUP_FALLBACK\.indexOf\(code\) !== -1\)[\s\S]{0,200}googleRedirect\(draft\)/);
});

test("popup-closed returns a quiet cancel and only changes the NEXT click to redirect", () => {
  assert.match(source, /code === "auth\/popup-closed-by-user"\) \{[\s\S]{0,160}bis_auth_flow_hint[\s\S]{0,80}return \{ status: "cancelled" \}/);
  assert.match(source, /sessionStorage\.getItem\("bis_auth_flow_hint"\) === "redirect"\) return "redirect"/);
});

test("manual override still wins over the hint", () => {
  const f = source.slice(source.indexOf("function googleFlow()"), source.indexOf("function authDiag"));
  assert.ok(f.indexOf("bis_auth_flow\"") < f.indexOf("bis_auth_flow_hint"));
});

test("diagnostic touches only sessionStorage and console: no Firestore, no UI", () => {
  const d = source.slice(source.indexOf("function authDiag"), source.indexOf("/* ── تحويل"));
  assert.ok(!/getDoc|setDoc|updateDoc|addDoc|onSnapshot|fetch\(|toast|innerHTML|document\./.test(d));
  assert.match(d, /sessionStorage\.setItem\("bis_auth_diag"/);
});

test("redirect marker flow is unchanged and shared by mobile and fallback", () => {
  assert.match(source, /async function googleRedirect\(draft\)/);
  assert.match(source, /if \(googleFlow\(\) === "redirect"\) return await googleRedirect\(draft\)/);
  assert.match(source, /REDIRECT_KEY, JSON\.stringify\(\{ mode: draft \? "register" : "login"/);
});
