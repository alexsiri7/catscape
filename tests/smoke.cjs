// Headless smoke tests for Catscape.
// Loads public/game.js in Node with stubbed DOM/canvas, then plays key routes.
// Run: node tests/smoke.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'game.js'), 'utf8');

// Seeded PRNG: makes kibble velocities, particle spawns and the fuzz test reproducible.
const SEED = Number(process.env.CATSCAPE_SEED) || 1;
console.log('seed', SEED);
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(SEED);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => k in t ? t[k] : (k === 'measureText' ? () => ({ width: 40 }) : noop), set: (t, k, v) => { t[k] = v; return true; } });
const makeEl = id => ({
  id, getContext: () => ctx, style: {}, clientWidth: 640, clientHeight: 400, dataset: {}, classList: { add: noop, remove: noop },
  blur: noop, hidden: true, textContent: '', listeners: {},
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
});
const els = {};
const makeButton = k => ({
  dataset: { k }, listeners: {}, classList: { add: noop, remove: noop }, setPointerCapture: noop,
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
});
const padButtons = ['left', 'right', 'down', 'jump', 'paw'].map(makeButton);
const pad = Object.fromEntries(padButtons.map(b => [b.dataset.k, b]));
const winListeners = {};
Object.assign(globalThis, {
  window: globalThis, devicePixelRatio: 2, performance: { now: () => 0 },
  addEventListener: (ev, fn) => { winListeners[ev] = fn; },
  requestAnimationFrame: noop, ResizeObserver: class { observe() {} },
  document: {
    getElementById: id => els[id] ||= makeEl(id),
    querySelectorAll: sel => sel === '#pad button' ? padButtons : [],
    createElement: () => ({ getContext: () => ctx }),
    fonts: null, fullscreenEnabled: false,
  },
  __CATSCAPE_TEST__: {},
});
vm.runInThisContext(src);
const t = globalThis.__CATSCAPE_TEST__;

const fire = (target, ev, detail = {}) => (target.listeners[ev] || []).forEach(fn => fn(detail));
const step = (n = 1) => { for (let i = 0; i < n; i++) { t.update(); if (i % 10 === 0) t.render(); } };
const tap = k => { t.press(k); step(); t.release(k); };
const hold = (k, n) => { t.press(k); step(n); t.release(k); };
const P = () => t.player;
const fresh = () => { t.newGame(); hold('right', 3); step(100); };
function until(cond, max) {
  for (let i = 0; i < max; i++) { if (cond()) return; step(); }
  if (!cond()) throw new Error(`until: condition not met after ${max} frames`);
}
// Drowns Lyra in the bathtub from the bath rim and waits out the respawn. Leaves t.deaths === 1.
const drown = () => {
  t.enterRoom('bathroom', 146, 134, -1);
  hold('left', 30);
  until(() => t.state === 'dead', 120);
  step(80);
};
// The study escape: radiator valve -> heat builds -> hooman opens the window -> bap the net down -> exit.
const escapeRoute = () => {
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
};
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
  escapeRoute();
});

test('hints: solving the blue plate moves the map target on, standing on it does not', () => {
  t.enterRoom('bathroom', 1*16 + 2, 166, -1); step(10);
  assert.equal(t.gateOpen.Y, true);         // Lyra on the plate opens the gate...
  assert.equal(t.hint.step, 'Y');           // ...but that is not solving it
  assert.equal(t.hint.room, 'bathroom');
  assert.equal(t.hint.auto.solved, 0);
  t.enterRoom('bathroom', 13*16+2, 166, -1); step(10);
  t.press('left'); tap('jump'); step(30); tap('jump'); step(25); t.release('left');
  hold('left', 60); hold('left', 8); step(20);
  t.press('left'); tap('jump'); step(35); t.release('left');
  tap('jump'); step(25); hold('left', 20); tap('paw'); step(90);
  assert.equal(t.gateOpen.Y, true);
  step(300);                                // the hint waits for room behind Lyra's other thoughts
  assert.equal(t.hint.step, 'X');
  assert.equal(t.hint.room, 'kitchen');
  assert.equal(t.hint.auto.solved, 1);
  assert.ok(t.thoughts.some(th => /kitchen/.test(th.text)), 'next-step thought names the kitchen');
  t.enterRoom('hall', 160, 166, 1); step(5);
  assert.equal(t.hint.room, 'kitchen');     // rooms without a puzzle point at the next step
});

test('hints: knocking the vase onto the red plates points at the pantry, then the next step', () => {
  t.enterRoom('kitchen', 13*16 + 1, 134, -1); step(5);
  assert.equal(t.hint.room, 'kitchen');
  hold('left', 4); tap('paw'); step(90);
  assert.equal(t.gateOpen.X, true);
  step(300);
  assert.equal(t.hint.room, 'kitchen');
  assert.match(t.hint.text, /Gate iz open/);
  assert.equal(t.hint.auto.solved, 1);
  assert.ok(t.thoughts.some(th => th.text === t.hint.text), 'solved hint queued');
  t.cheat.zoomies(); step(300);
  assert.equal(t.hint.room, 'bathroom');    // next unsolved step: the blue plate upstairs
  assert.equal(t.hint.auto.solved, 2);
});

test('hints: the idle hint fires once per step after a minute without progress', () => {
  const IDLE = 3600;
  step(IDLE - t.hint.idleT - 10);
  assert.equal(t.hint.auto.idle, 0);
  step(20);
  assert.equal(t.hint.auto.idle, 1);
  assert.ok(t.thoughts.some(th => th.text === t.hint.text), 'idle hint queued');
  step(IDLE + 400);
  assert.equal(t.hint.auto.idle, 1);
  t.cheat.zoomies(); step(1);               // progress: a new step
  assert.equal(t.hint.idleT, 1);
  step(IDLE + 10);
  assert.equal(t.hint.auto.idle, 2);
  step(IDLE + 400);
  assert.equal(t.hint.auto.idle, 2);
  assert.equal(t.state, 'play');            // hints never pause the game
});

test('drowning in the bath kills Lyra, respawns her at the room entry, and counts lives', () => {
  t.enterRoom('bathroom', 146, 134, -1);
  hold('left', 30);
  until(() => t.state === 'dead', 120);
  assert.equal(t.deaths, 1);
  assert.equal(t.thoughts[0].text, 'WET. I iz WET. Worst. Day. Ever.');
  const xWhileDead = P().x;
  hold('right', 10);
  assert.equal(P().x, xWhileDead);          // dead: input does not move her
  step(80);
  assert.equal(t.state, 'play');
  assert.equal(P().x, 146);
  assert.equal(P().y, 134);
  assert.equal(P().state, 'normal');
  hold('left', 30);
  until(() => t.state === 'dead', 120);
  assert.equal(t.deaths, 2);
  assert.ok(['Ow. Undignified.', 'Dat was anuvver life.', 'Nine lives iz not dat many.'].includes(t.thoughts[0].text));
});

test('the landing light switch toggles gate K and opens the way to the study', () => {
  t.enterRoom('landing', 224, 166, 1);
  hold('right', 100);
  assert.equal(t.cur.id, 'landing');
  assert.ok(P().x + P().w <= 288.01);
  assert.ok(t.thoughts.some(th => /Won't budge/.test(th.text)));

  t.cheat.zoomies();
  t.enterRoom('living', 276, 102, 1);
  step(5); tap('paw'); step(2);
  assert.equal(t.gateOpen.K, true);
  assert.match(t.thoughts[0].text, /clunk upstairs/);
  assert.equal(t.hint.step, 'Y');            // the escape hint always nags the earliest unsolved step first

  tap('paw'); step(2);
  assert.equal(t.gateOpen.K, false);
  tap('paw'); step(2);
  assert.equal(t.gateOpen.K, true);

  t.enterRoom('landing', 224, 166, 1);
  assert.ok(t.thoughts.some(th => th.text === 'Da gate iz open! Study iz RIGHT DERE.'));
  hold('right', 100);
  assert.equal(t.cur.id, 'study');
});

test('the kitchen hob only burns Lyra while it is lit', () => {
  t.enterRoom('kitchen', 209, 134, 1);
  until(() => (t.frame + 50) % 220 === 100, 221);
  hold('right', 30);
  assert.equal(t.deaths, 0);
  assert.equal(t.state, 'play');
  assert.ok(P().x > 237);

  t.enterRoom('kitchen', 224, 134, 1);
  until(() => t.state === 'dead', 221);
  assert.ok((t.frame + 50) % 220 < 100);
  assert.equal(t.deaths, 1);
  assert.equal(t.thoughts[0].text, 'Hot hot HOT! Da hob iz not a bed.');
});

test('office wires only zap Lyra while sparking, and the cactus always stings', () => {
  t.enterRoom('office', 146, 166, 1);
  until(() => t.frame % 160 === 60, 161);
  hold('right', 55);
  assert.equal(t.deaths, 0);
  assert.ok(P().x > 206);

  t.enterRoom('office', 178, 166, 1);
  until(() => t.state === 'dead', 161);
  assert.ok(t.frame % 160 < 60);
  assert.equal(t.thoughts[0].text, 'ZAPPED. Mah fur iz all fluffy now.');

  step(80);
  t.enterRoom('office', 114, 166, -1);
  hold('left', 20);
  until(() => t.state === 'dead', 40);
  assert.equal(t.thoughts[0].text, 'Cactus. Pointy. Lesson learned.');
  assert.equal(t.deaths, 2);
});

test('the roomba kills on contact, and restart resets the room', () => {
  t.enterRoom('living', 128, 166, 1);
  assert.equal(t.cur.roombas[0].x, 176);
  until(() => t.state === 'dead', 120);
  assert.equal(t.thoughts[0].text, 'Note to self: Roomba bad.');
  assert.equal(t.deaths, 1);
  step(80);
  assert.equal(t.state, 'play');
  assert.equal(P().x, 128);

  tap('restart'); step(1);
  assert.ok(Math.abs(t.cur.roombas[0].x - 176) < 2);
  assert.equal(t.cur.roombas[0].vx, -0.6);
  assert.equal(P().x, 128);
});

test('eating the catnip in the pantry grants the double jump', () => {
  t.enterRoom('kitchen', 18, 166, 1);
  assert.equal(t.hint.room, 'kitchen');
  tap('jump'); step(8); tap('jump'); step(1);
  assert.equal(P().dbl, false);

  step(40);
  hold('right', 15);
  until(() => t.cur.items[0].got, 30);
  assert.match(t.thoughts[0].text, /CATNIP!!/);
  assert.equal(t.hint.room, 'bathroom');

  tap('jump'); step(8); tap('jump');
  assert.equal(P().dbl, true);
  assert.ok(P().vy <= -3);
});

test('the feeding robot dispenses kibble that refills a life, then cools down', () => {
  drown();
  assert.equal(t.deaths, 1);

  t.enterRoom('kitchen', 112, 166, -1);
  tap('paw'); step(2);
  assert.equal(t.cur.feeders[0].hits, 1);
  assert.ok(t.thoughts.some(th => th.text === 'It rattled. Keep bapping.'));

  tap('paw'); step(2);
  tap('paw'); step(2);
  assert.equal(t.cur.feeders[0].hits, 0);
  assert.ok(t.cur.feeders[0].cool > 590);   // set to 600 on dispense, ticking down a frame at a time
  assert.equal(t.cur.kibbles.length, 3);
  assert.match(t.thoughts[0].text, /KIBBLE!/);

  tap('paw'); step(2);
  assert.ok(t.thoughts.some(th => th.text === 'It iz sulking. Maybe later.'));
  assert.equal(t.cur.feeders[0].hits, 0);

  for (let i = 0; i < 3 && t.cur.kibbles.length > 0; i++) { hold('right', 60); hold('left', 60); }
  assert.equal(t.cur.kibbles.length, 0);
  assert.equal(t.deaths, 0);
});

test('the win screen holds, then returns to the title and starts a fresh game', () => {
  escapeRoute();
  tap('jump');
  assert.equal(t.state, 'win');
  step(61); tap('jump');
  assert.equal(t.state, 'title');
  t.render();

  tap('paw');
  assert.equal(t.state, 'play');
  assert.equal(t.cur.id, 'bedroom');
  assert.equal(P().x, 66);
  assert.equal(P().y, 150);
  assert.equal(t.deaths, 0);
  assert.deepStrictEqual(t.gateOpen, { X: false, Y: false, K: false });
  assert.equal(t.story.windowOpen, false);
  assert.equal(t.story.netDown, false);
  assert.equal(t.hint.step, 'Y');
  assert.equal(t.hint.room, 'bedroom');
});

test('the study window glass and the hooman cannot be swatted open', () => {
  t.enterRoom('study', 242, 118, 1);
  tap('paw'); step(2);
  assert.ok(t.thoughts.some(th => /Glass/.test(th.text)));
  assert.equal(t.story.netHits, 0);
  assert.equal(t.story.windowOpen, false);

  t.enterRoom('study', 130, 150, 1);
  tap('paw');
  assert.ok(t.thoughts.some(th => /Bapped da hooman/.test(th.text)));
  assert.equal(t.story.human, 'sit');
});

test('keyboard arrow keys, space, h, m and blur are wired to the game', () => {
  winListeners.keydown({ key: 'ArrowRight', repeat: false, preventDefault(){} });
  step(10);
  assert.ok(P().vx > 0);
  winListeners.keyup({ key: 'ArrowRight' });
  step(30);
  assert.equal(P().vx, 0);

  winListeners.keydown({ key: ' ', repeat: false, preventDefault(){} });
  step(1);
  assert.ok(P().vy < 0);

  winListeners.keydown({ key: 'h', repeat: false, preventDefault(){} });
  assert.equal(t.thoughts[0].text, t.hint.text);

  winListeners.keydown({ key: 'm', repeat: false, preventDefault(){} });
  assert.equal(els.btnMute.textContent, 'Sound off');
  winListeners.keydown({ key: 'm', repeat: false, preventDefault(){} });
  assert.equal(els.btnMute.textContent, 'Sound on');

  winListeners.keydown({ key: 'ArrowRight', repeat: false, preventDefault(){} });
  winListeners.blur();
  step(20);
  assert.equal(P().vx, 0);
});

test('the touch pad and toolbar buttons are wired to the game', () => {
  fire(pad.right, 'pointerdown', { pointerId: 1, preventDefault(){} });
  step(10);
  assert.ok(P().vx > 0);
  fire(pad.right, 'pointerup', {});
  step(30);
  assert.equal(P().vx, 0);

  fire(pad.jump, 'pointerdown', { pointerId: 1, preventDefault(){} });
  step(2);
  assert.ok(P().vy < 0);

  fire(pad.right, 'pointerdown', { pointerId: 1, preventDefault(){} });
  step(5);
  fire(pad.right, 'pointercancel', {});
  step(30);
  assert.equal(P().vx, 0);

  fire(els.btnHint, 'click', { currentTarget: els.btnHint });
  assert.equal(t.thoughts[0].text, t.hint.text);

  hold('right', 20);
  fire(els.btnRestart, 'click', { currentTarget: els.btnRestart });
  step(1);
  assert.equal(P().x, t.cur.entry.x);
});

test('fuzz: random input in every room never throws and keeps state sane', () => {
  t.cheat.zoomies();
  for (const id of t.ROOM_IDS) {
    t.enterRoom(id, 160, 100, 1);
    for (let i = 0; i < 2000; i++) {
      try {
        if (t.state !== 'play') { tap('jump'); }
        else {
          for (const k of ['left', 'right', 'jump', 'paw', 'down']) Math.random() < 0.05 ? t.press(k) : Math.random() < 0.1 && t.release(k);
          t.update();
          if (i % 10 === 0) t.render();
        }
        assert.ok(['play', 'dead', 'exit', 'win', 'title'].includes(t.state), `bad state ${t.state}`);
        assert.ok(Number.isFinite(P().x) && Number.isFinite(P().y), 'non-finite player position');
        assert.ok(P().x > -16 && P().x < 320, `player.x out of range: ${P().x}`);
        assert.ok(P().y >= 0 && P().y < 192, `player.y out of range: ${P().y}`);
        assert.ok(t.deaths >= 0, `negative deaths: ${t.deaths}`);
      } catch (e) {
        throw new Error(`fuzz failed: seed=${SEED} room=${id} frame=${i}: ${e.message}`);
      }
    }
  }
});

(async () => {
  const { server } = await import('./serve.mjs');
  const get = url => { const res = { setHeader() {}, writeHead(s) { this.status = s; }, end() {} }; server.emit('request', { url, method: 'GET' }, res); return res.status; };
  assert.equal(get('/%'), 404);
  assert.equal(get('/'), 200);
  passed++; console.log('ok - test server answers a malformed percent-escape with 404 instead of crashing');
  console.log(`\n${passed} passed`);
})().catch(e => { console.error(e); process.exit(1); });
