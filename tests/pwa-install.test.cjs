const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/pwa-install.js'), 'utf8');
const promotion = fs.readFileSync(path.join(root, 'js/apk-prompt.js'), 'utf8').replace(/^import[^\n]+\n/, '');

function element() {
  const events = {}, classes = new Set(), children = {};
  return {
    style: {}, hidden: false, disabled: false, textContent: '',
    setAttribute(k, v) { this[k] = v; },
    classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v) },
    addEventListener(k, fn) { (events[k] ||= []).push(fn); },
    click() { if (!this.disabled) (events.click || []).forEach(fn => fn({ target: this })); },
    querySelector(k) { return children[k] ||= element(); }
  };
}
function setup(options = {}) {
  let ready = false;
  const listeners = {}, docListeners = {}, timers = [], appended = [], toasts = [];
  const button = element(), entry = element(), status = element(), card = element(), sub = element();
  const store = new Map(options.twa ? [['__bariqApp', '1']] : []);
  let reads = 0, writes = 0;
  const ctx = {
    console, CustomEvent: function (type, init) { this.type = type; this.detail = init.detail; },
    navigator: { standalone: !!options.iosApp, userActivation: { hasBeenActive: true } },
    matchMedia: q => ({ matches: q === '(display-mode: ' + options.mode + ')' }),
    sessionStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) },
    addEventListener(k, fn) { (listeners[k] ||= []).push(fn); },
    removeEventListener(k, fn) { listeners[k] = (listeners[k] || []).filter(f => f !== fn); },
    dispatchEvent(e) { (listeners[e.type] || []).forEach(fn => fn(e)); },
    toast: (text, type) => toasts.push({ text, type }),
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {},
    requestAnimationFrame: fn => fn(),
    doc: () => ({}), getDoc: async () => { reads++; return { exists: () => !!options.enabled, data: () => ({ enabled: true }) }; },
    setDoc: () => { writes++; throw Error('settings writes forbidden'); }, serverTimestamp: () => ({}),
    currentUser: options.loggedIn ? { uid: 'test' } : null, db: {},
    document: {
      referrer: options.referrer || '',
      body: { appendChild: el => appended.push(el) }, createElement: element,
      querySelectorAll(selector) {
        if (!ready) return [];
        if (selector.includes('[data-pwa-install-entry]')) return [entry, button];
        return selector === '[data-pwa-install-action]' ? [button] : [status];
      },
      getElementById(id) { return ready ? ({ pwaInstallCard: card, pwaInstallCardSub: sub }[id] || null) : null; },
      addEventListener(k, fn) { (docListeners[k] ||= []).push(fn); }
    }
  };
  if (options.chromium !== false) ctx.BeforeInstallPromptEvent = function () {};
  ctx.window = ctx;
  vm.createContext(ctx); vm.runInContext(source, ctx);
  function dom() { ready = true; (docListeners.DOMContentLoaded || []).forEach(fn => fn()); }
  function emit(type, extra = {}) { ctx.dispatchEvent({ type, ...extra }); }
  function offer(outcome = 'accepted', prompt = async () => {}) {
    let prevented = false;
    const event = { prompt, userChoice: Promise.resolve({ outcome }), preventDefault() { prevented = true; } };
    emit('beforeinstallprompt', event);
    assert.ok(prevented);
  }
  return { ctx, dom, emit, offer, button, entry, status, sub, card, toasts, timers, appended,
    promotion() { vm.runInContext(promotion, ctx); },
    state: () => ctx.getPWAInstallState(), run: code => vm.runInContext(code, ctx),
    counts: () => ({ reads, writes }),
    async login() { ctx.__apkPromptAfterLogin(); const timer = timers.find(t => t.delay === 1500); if (timer) await timer.fn(); }
  };
}

test('Chromium without a prompt is waiting, never evidence of an installed app', async () => {
  const f = setup(); f.dom();
  assert.equal(f.state(), 'waiting'); assert.equal(f.button.hidden, false);
  assert.equal((await f.ctx.installPWAFromCard()).outcome, 'waiting');
  assert.doesNotMatch(f.toasts[0].text, /التطبيق مثبت/);
});
test('unsupported browser keeps visible manual help', async () => {
  const f = setup({ chromium: false }); f.dom(); f.button.click();
  assert.equal(f.state(), 'unavailable'); assert.match(f.status.textContent, /iPhone/);
  assert.equal((await f.ctx.installPWAFromCard()).outcome, 'unavailable');
});
for (const timing of ['before', 'after']) test('prompt captured ' + timing + ' DOM ready updates and binds entry', async () => {
  const f = setup(); let called = 0;
  if (timing === 'after') f.dom();
  f.offer('dismissed', async () => { called++; });
  if (timing === 'before') f.dom();
  assert.equal(f.state(), 'available'); assert.equal(f.button.textContent, 'تثبيت التطبيق');
  f.button.click(); await new Promise(setImmediate);
  assert.equal(called, 1); assert.equal(f.state(), 'waiting');
});
for (const options of [{ mode: 'standalone' }, { mode: 'fullscreen' }, { mode: 'minimal-ui' }, { iosApp: true }, { twa: true }, { referrer: 'android-app://example.app' }]) {
  test('proven app context hides install entries: ' + JSON.stringify(options), async () => {
    const f = setup(options); f.dom();
    assert.equal(f.state(), 'installed'); assert.equal(f.entry.hidden, true);
    assert.equal(f.card.style.display, 'none');
    assert.equal((await f.ctx.installPWAFromCard()).outcome, 'installed');
  });
}
test('dismissal consumes the event, stays truthful on retry and permits a fresh offer', async () => {
  const f = setup(); f.dom(); let called = 0; f.offer('dismissed', async () => { called++; });
  assert.equal((await f.ctx.installPWAFromCard()).outcome, 'dismissed');
  assert.equal(f.state(), 'waiting'); assert.match(f.status.textContent, /أُلغيت/);
  await f.ctx.installPWAFromCard(); assert.equal(called, 1);
  assert.doesNotMatch(f.toasts.at(-1).text, /التطبيق مثبت/);
  f.offer(); assert.equal(f.state(), 'available');
});
test('rejected native prompt recovers UI and reports an error', async () => {
  const f = setup(); f.dom(); f.offer('accepted', async () => { throw Error('blocked'); });
  assert.equal((await f.ctx.installPWAFromCard()).outcome, 'error');
  assert.equal(f.state(), 'waiting'); assert.equal(f.button.disabled, false);
  assert.match(f.status.textContent, /تعذر/); assert.equal(f.toasts[0].type, 'error');
});
test('concurrent clicks never invoke the one-shot prompt twice; acceptance is not completion', async () => {
  const f = setup(); f.dom(); let resolve, calls = 0;
  f.offer('accepted', () => { calls++; return new Promise(r => { resolve = r; }); });
  const first = f.ctx.installPWAFromCard();
  assert.equal(f.state(), 'prompting'); assert.equal(f.button.disabled, true);
  assert.equal((await f.ctx.installPWAFromCard()).outcome, 'prompting');
  resolve(); assert.equal((await first).outcome, 'accepted'); assert.equal(calls, 1);
  assert.equal(f.state(), 'installing'); assert.equal(f.ctx.__pwaInstalled, undefined);
  f.emit('appinstalled'); assert.equal(f.state(), 'installed'); assert.equal(f.entry.hidden, true);
});
test('missing owner setting stays disabled and is never written', async () => {
  const f = setup({ loggedIn: true }); f.dom(); f.offer(); f.promotion(); await f.login();
  assert.deepEqual(f.counts(), { reads: 1, writes: 0 }); assert.equal(f.appended.length, 0);
});
test('enabled promotion waits for a real offer, then dismissal restores mini UI without completion', async () => {
  const f = setup({ enabled: true, loggedIn: true }); f.dom(); f.promotion(); await f.login();
  assert.equal(f.appended.length, 0); f.offer('dismissed');
  assert.equal(f.run('_open'), true); await f.run('_download()');
  assert.equal(f.run('_awaiting'), false); assert.equal(f.run('_installing'), false);
  assert.equal(f.run('_mini.classList.contains("show")'), true); assert.equal(f.run('_done'), null);
  assert.deepEqual(f.counts(), { reads: 1, writes: 0 });
});
test('promotion error restores mini UI and appinstalled alone shows completion after acceptance', async () => {
  const f = setup({ enabled: true, loggedIn: true }); f.dom(); f.offer('accepted', async () => { throw Error('blocked'); });
  f.promotion(); await f.login(); await f.run('_download()');
  assert.equal(f.run('_awaiting'), false); assert.equal(f.run('_mini.classList.contains("show")'), true);
  f.offer(); await f.run('_download()'); assert.equal(f.run('_done'), null);
  f.emit('appinstalled'); assert.equal(f.run('_done.classList.contains("show")'), true);
  assert.equal(f.run('_mini.classList.contains("show")'), false); assert.equal(f.run('_open'), false);
  assert.equal(f.counts().writes, 0);
});
test('logout cancels deferred promotion without enabling settings', async () => {
  const f = setup({ enabled: true, loggedIn: true }); f.dom(); f.promotion(); await f.login();
  f.ctx.__apkPromptHide(); f.offer(); assert.equal(f.appended.length, 0);
  assert.equal(f.run('_readyToOffer'), false); assert.equal(f.counts().writes, 0);
});
test('HTML exposes an install entry before the hidden login scene; manifest identity and icon sizes are truthful', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.indexOf('data-pwa-install-entry') > html.indexOf('id="page-login"'));
  assert.ok(html.indexOf('data-pwa-install-entry') < html.indexOf('id="lpScene"'));
  assert.equal((html.match(/data-pwa-install-action/g) || []).length, 2);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.equal(manifest.id, '/BIS/'); assert.equal(manifest.start_url, './index.html'); assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    const png = fs.readFileSync(path.join(root, icon.src.split('?')[0]));
    assert.equal(icon.sizes, png.readUInt32BE(16) + 'x' + png.readUInt32BE(20));
  }
  assert.ok(manifest.icons.some(i => i.sizes === '192x192' && i.purpose === 'any'));
  assert.ok(manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'));
});
