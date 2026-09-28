// Headless smoke tests for Catscape.
// Loads public/game.js in Node with stubbed DOM/canvas, then plays key routes.
// Run: node tests/smoke.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'game.js'), 'utf8');

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => k in t ? t[k] : (k === 'measureText' ? () => ({ width: 40 }) : noop), set: (t, k, v) => { t[k] = v; return true; } });
const el = { getContext: () => ctx, addEventListener: noop, style: {}, clientWidth: 640, clientHeight: 400, dataset: {}, classList: { add: noop, remove: noop }, blur: noop, hidden: true, textContent: '' };
Object.assign(globalThis, {
  window: globalThis, devicePixelRatio: 2, addEventListener: noop, performance: { now: () => 0 },
  requestAnimationFrame: noop, ResizeObserver: class { observe() {} },
  document: { getElementById: () => el, querySelectorAll: () => [], createElement: () => ({ getContext: () => ctx }), fonts: null, fullscreenEnabled: false },
  __CATSCAPE_TEST__: {},
});
vm.runInThisContext(src);
const t = globalThis.__CATSCAPE_TEST__;

const step = (n = 1) => { for (let i = 0; i < n; i++) { t.update(); if (i % 10 === 0) t.render(); } };
const tap = k => { t.press(k); step(); t.release(k); };
const hold = (k, n) => { t.press(k); step(n); t.release(k); };
const P = () => t.player;
const fresh = () => { t.newGame(); hold('right', 3); step(100); };
let passed = 0;
const test = (name, fn) => { fresh(); fn(); passed++; console.log('ok -', name); };

test('bird flies off when Lyra moves, then she leaves the bedroom', () => {
  t.enterRoom('bedroom', 10*16, 166, 1); step(30);
  t.press('right'); tap('jump'); step(25); assert.equal(P().state, 'hang');
  tap('jump'); step(25); tap('jump'); step(25); tap('jump'); step(25);
  step(150); t.release('right');
  assert.equal(t.cur.id, 'landing');
});

test('landing stairs door goes to the hall', () => {
  t.enterRoom('landing', 9*16+2, 10*16+6, 1); step(40); tap('jump'); step(20);
  assert.equal(t.cur.id, 'hall');
});

test('bathroom: basket into the bath, bottle onto the blue plate', () => {
  t.enterRoom('bathroom', 13*16+2, 166, -1); step(10);
  t.press('left'); tap('jump'); step(30); tap('jump'); step(25); t.release('left');
  hold('left', 60); hold('left', 8); step(20);
  t.press('left'); tap('jump'); step(35); t.release('left');
  tap('jump'); step(25); hold('left', 20); tap('paw'); step(90);
  assert.equal(t.gateOpen.Y, true);
  assert.equal(t.deaths, 0);
});

test('kitchen: vase knocked onto the red plates opens the pantry', () => {
  // stand on the counter between the vase and the hob, facing the vase
  t.enterRoom('kitchen', 13*16 + 1, 134, -1); step(5);
  hold('left', 4); tap('paw'); step(90);
  assert.equal(t.gateOpen.X, true);
});

test('living room: double jump reaches the switch cabinet', () => {
  t.cheat.zoomies();
  t.enterRoom('living', 16*16, 150, 1); step(10);
  hold('right', 10); tap('jump'); step(13); tap('jump'); step(20);
  assert.equal(P().state, 'hang');
});

test('office: fan can be swatted off', () => {
  t.cheat.zoomies(); t.cheat.gate('Y', true);
  t.enterRoom('office', 10*16+2, 134, 1); step(3); hold('right', 80); tap('paw'); step(5);
  assert.equal(t.cur.fans[0].on, false);
});

test('study: radiator -> hooman opens window -> net -> escape', () => {
  t.cheat.zoomies(); t.cheat.heating(true);
  t.enterRoom('study', 3*16+4, 166, -1); step(5); tap('paw'); step(2);
  assert.equal(t.story.valveOpen, true);
  step(14*60);
  assert.equal(t.story.windowOpen, true);
  t.enterRoom('study', 14*16+2, 166, 1); step(5);
  t.press('right'); tap('jump'); step(13); tap('jump'); step(25); tap('jump'); step(25); t.release('right');
  hold('right', 6); for (let i = 0; i < 5; i++) { tap('paw'); step(8); }
  hold('right', 20); step(60);
  assert.equal(t.story.netDown, true);
  assert.equal(t.state, 'win');
});

test('fuzz: random input in every room never throws', () => {
  t.cheat.zoomies();
  for (const id of t.ROOM_IDS) {
    t.enterRoom(id, 160, 100, 1);
    for (let i = 0; i < 2000; i++) {
      if (t.state !== 'play') { tap('jump'); continue; }
      for (const k of ['left', 'right', 'jump', 'paw', 'down']) Math.random() < 0.05 ? t.press(k) : Math.random() < 0.1 && t.release(k);
      step();
    }
  }
});

console.log(`\n${passed} passed`);
