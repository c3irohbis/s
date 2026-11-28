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
  for (const c of ["auth/popup-blocked", "auth/internal-error", "auth/operation-not-supported-in-this-environment"])
    assert.ok(m[1].includes(c), c);
  assert.ok(!m[1].includes("popup-closed-by-user"), "a plain cancel must not auto-redirect");
  assert.ok(!m[1].includes("network-request-failed"), "a network error is not proof the popup is unsupported");
  assert.ok(!m[1].includes("web-storage-unsupported"), "redirect needs the same storage");
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

/* behavioural: run the real googleFlow() with stubbed storage */
function flow({ local = {}, session = {}, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/120", touch = 0 } = {}) {
  const vm = require("node:vm");
  const body = source.slice(source.indexOf("const isMobileLike"), source.indexOf("function authDiag"));
  const mk = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: (k) => { delete o[k]; } });
  const ctx = { localStorage: mk(local), sessionStorage: mk(session), navigator: { userAgent: ua, maxTouchPoints: touch } };
  vm.createContext(ctx);
  vm.runInContext(body + "\nthis.googleFlow = googleFlow;", ctx);
  return { f: () => ctx.googleFlow(), session };
}
test("googleFlow: desktop popup by default, mobile redirect", () => {
  assert.strictEqual(flow().f(), "popup");
  assert.strictEqual(flow({ ua: "Mozilla/5.0 (Linux; Android 14) Mobile" }).f(), "redirect");
});
test("hint persists for the rest of the tab (never consumed, also after a redirect round trip)", () => {
  const h = flow({ session: { bis_auth_flow_hint: "redirect" } });
  assert.strictEqual(h.f(), "redirect");
  assert.strictEqual(h.f(), "redirect");
  assert.strictEqual(h.session.bis_auth_flow_hint, "redirect");
});
test("manual override bis_auth_flow=popup wins over the hint, and redirect override wins too", () => {
  assert.strictEqual(flow({ local: { bis_auth_flow: "popup" }, session: { bis_auth_flow_hint: "redirect" } }).f(), "popup");
  assert.strictEqual(flow({ local: { bis_auth_flow: "redirect" } }).f(), "redirect");
});
test("a failed redirect clears the marker and releases the lock (no leaked state)", () => {
  const r = source.slice(source.indexOf("async function googleRedirect"), source.indexOf("B.google = async function"));
  assert.match(r, /\} catch \(e\) \{\s*clearMarker\(\); busy = false;\s*return \{ status: "error", message: errMsg\(e\) \};/);
});
test("network-request-failed on the popup returns the error, no automatic redirect", () => {
  const popup = source.slice(source.indexOf("B.google = async function"), source.indexOf("/* مرحلة 1"));
  assert.ok(!/network-request-failed/.test(popup));
  assert.match(popup, /return \{ status: "error", message: errMsg\(e\) \}/);
});
