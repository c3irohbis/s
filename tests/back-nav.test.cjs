const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/back-nav.js'), 'utf8');
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));

function browser(initialState = null, olderStates = []) {
  const listeners = {}, timers = [], traversals = [], observers = [], elements = {};
  const entries = [...olderStates.map(copy), copy(initialState)];
  let index = entries.length - 1, backCalls = 0, escapes = 0, pushes = 0;
  const url = 'https://example.test/s/?_refresh=1795350000000';
  const history = {
    get state() { return copy(entries[index]); },
    get length() { return entries.length; },
    replaceState(state, title, nextUrl) {
      assert.equal(nextUrl, undefined, 'rebasing must not change the URL');
      entries[index] = copy(state);
    },
    pushState(state) {
      entries.splice(index + 1);
      entries.push(copy(state)); index++; pushes++;
    },
    back() { backCalls++; traversals.push(true); }
  };
  const ctx = {
    console, history, location: {href: url},
    document: {readyState: 'complete', getElementById: id => elements[id] || null},
    MutationObserver: class {
      constructor(fn) { observers.push(fn); }
      observe() {}
    },
    setTimeout(fn, ms) { timers.push({fn, ms}); },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const load = () => vm.runInContext(source, ctx);
  const flushBack = () => {
    while (traversals.length) {
      traversals.shift();
      if (index === 0) { escapes++; continue; }
      index--;
      for (const fn of listeners.popstate || []) fn({state: history.state});
    }
  };
  load();
  return {
    ctx, history, entries, elements, timers, load, flushBack,
    get backCalls() { return backCalls; },
    get escapes() { return escapes; },
    get pushes() { return pushes; },
    notify(id) { for (const fn of observers) fn([{target: {id}}]); },
    runTimers() { const pending = timers.splice(0); pending.forEach(t => t.fn()); }
  };
}

test('fresh history starts at depth zero without adding an entry or changing the URL', () => {
  const b = browser();
  assert.deepEqual(b.history.state, {navDepth: 0});
  assert.equal(b.history.length, 1);
  assert.equal(b.pushes, 0);
  assert.equal(b.ctx.location.href, 'https://example.test/s/?_refresh=1795350000000');
});

test('fresh stack rebases stale numeric depth and preserves unrelated state', () => {
  const b = browser({navDepth: 7, route: 'home', custom: {a: 1}});
  assert.deepEqual(b.history.state, {navDepth: 0, route: 'home', custom: {a: 1}});
  assert.equal(b.history.length, 1);
});

test('fresh stack preserves unrelated state even when navDepth was absent', () => {
  const b = browser({route: 'home', custom: ['keep']});
  assert.deepEqual(b.history.state, {route: 'home', custom: ['keep'], navDepth: 0});
});

test('first close after a reload-style stale state restores the modal exactly once', () => {
  const b = browser({navDepth: 1});
  let closes = 0;
  b.ctx._navPush('apk-prompt', () => closes++);
  assert.equal(b.ctx._navGoBackIfMatches('apk-prompt'), true);
  b.flushBack();
  assert.equal(closes, 1);
  assert.equal(b.history.state.navDepth, 0);
  assert.equal(b.escapes, 0);
});

test('repeated matching closes before popstate issue only one browser back', () => {
  const b = browser();
  let closes = 0;
  b.ctx._navPush('apk-prompt', () => closes++);
  for (let i = 0; i < 10; i++) assert.equal(b.ctx._navGoBackIfMatches('apk-prompt'), true);
  assert.equal(b.backCalls, 1);
  assert.equal(closes, 0, 'restoration belongs to popstate');
  b.flushBack();
  assert.equal(closes, 1);
  assert.equal(b.escapes, 0);
  assert.equal(b.ctx._navGoBackIfMatches('apk-prompt'), false);
});

test('four dismiss/reopen cycles cannot traverse into older document history', () => {
  const b = browser({navDepth: 1}, [{navDepth: 4}, {navDepth: 3}, {navDepth: 2}]);
  const rootIndex = b.entries.length - 1;
  let closes = 0;
  for (let cycle = 0; cycle < 4; cycle++) {
    b.ctx._navPush('apk-prompt', () => closes++);
    for (let tap = 0; tap < 3; tap++) b.ctx._navGoBackIfMatches('apk-prompt');
    b.flushBack();
    assert.equal(closes, cycle + 1);
    assert.equal(b.history.state.navDepth, 0);
    assert.equal(b.entries[rootIndex].navDepth, 0);
  }
  assert.equal(b.backCalls, 4);
  assert.equal(b.escapes, 0);
});

test('closing the top modal preserves its parent page until a separate back', () => {
  const b = browser();
  const closed = [];
  b.ctx._navPush('page:chat', () => closed.push('chat'));
  b.ctx._navPush('apk-prompt', () => closed.push('apk'));
  b.ctx._navGoBackIfMatches('apk-prompt');
  b.flushBack();
  assert.deepEqual(closed, ['apk']);
  assert.equal(b.history.state.navDepth, 1);
  b.ctx._navGoBackIfMatches('page:chat');
  b.flushBack();
  assert.deepEqual(closed, ['apk', 'chat']);
});

test('browser Back still restores the top modal without a manual close request', () => {
  const b = browser();
  let closed = 0;
  b.ctx._navPush('apk-prompt', () => closed++);
  b.history.back(); b.flushBack();
  assert.equal(closed, 1);
  assert.equal(b.history.state.navDepth, 0);
});

test('mismatched close tags keep their fallback behavior, including while back is pending', () => {
  const b = browser();
  assert.equal(b.ctx._navGoBackIfMatches('missing'), false);
  b.ctx._navPush('apk-prompt', () => {});
  assert.equal(b.ctx._navGoBackIfMatches('other'), false);
  b.ctx._navGoBackIfMatches('apk-prompt');
  assert.equal(b.ctx._navGoBackIfMatches('other'), false);
  assert.equal(b.backCalls, 1);
});

test('a deferred open waits for pending back and is registered after it settles', () => {
  const b = browser();
  let secondClosed = 0;
  b.ctx._navPush('first', () => {});
  b.ctx._navGoBackIfMatches('first');
  b.ctx._navPush('second', () => secondClosed++);
  assert.equal(b.pushes, 1);
  assert.equal(b.timers[0].ms, 30);
  b.flushBack(); b.runTimers();
  assert.equal(b.pushes, 2);
  assert.equal(b.ctx._navGoBackIfMatches('second'), true);
  b.flushBack(); assert.equal(secondClosed, 1);
});

test('restoration cannot accidentally push another history entry', () => {
  const b = browser();
  b.ctx._navPush('modal', () => b.ctx._navPush('unexpected', () => {}));
  b.ctx._navGoBackIfMatches('modal'); b.flushBack();
  assert.equal(b.pushes, 1);
  assert.equal(b.ctx._navGoBackIfMatches('unexpected'), false);
});

test('pending guard resets on popstate so a later reopen can close normally', () => {
  const b = browser();
  let closes = 0;
  for (let i = 0; i < 3; i++) {
    b.ctx._navPush('apk-prompt', () => closes++);
    b.ctx._navGoBackIfMatches('apk-prompt');
    b.ctx._navGoBackIfMatches('apk-prompt');
    b.flushBack();
  }
  assert.equal(closes, 3);
  assert.equal(b.backCalls, 3);
});

test('registered settings modal still consumes one entry when manually hidden', () => {
  const b = browser();
  const classes = new Set();
  b.elements.settingsModal = {classList: {contains: c => classes.has(c)}};
  classes.add('open'); b.notify('settingsModal');
  assert.equal(b.history.state.navDepth, 1);
  classes.delete('open'); b.notify('settingsModal');
  assert.equal(b.backCalls, 1);
  b.flushBack();
  assert.equal(b.history.state.navDepth, 0);
  assert.equal(b.ctx._navGoBackIfMatches('modal:settingsModal'), false);
});
