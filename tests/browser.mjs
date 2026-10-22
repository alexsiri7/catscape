// Headless Chrome test with no dependencies (Node >= 22 for the global WebSocket and fetch).
// Usage: node tests/browser.mjs [screenshot-dir] [url]
// Without a url it starts tests/serve.mjs (public/ + the _headers rules) on a free port.
// With a url (e.g. a Cloudflare Pages preview) it tests that deployment instead.
// Fails on: missing security headers, repo files being served, uncaught JS errors,
// console errors, CSP violations, fonts or style.css not loading, a blank canvas,
// or (on touch phones in portrait and landscape) a pad button that is under 56 CSS px
// or overlaps the canvas.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shotDir = process.argv[2];
let url = process.argv[3];
const chromeBin = process.env.CHROME_BIN || 'google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];

let server;
if (!url) {
  ({ server } = await import('./serve.mjs'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
}
console.log('testing', url);

// 1. Headers and what is (not) served.
const res = await fetch(url);
await res.arrayBuffer();
for (const h of ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) {
  if (!res.headers.get(h)) problems.push(`missing header ${h}`);
}
if (/unsafe-inline|unsafe-eval/.test(res.headers.get('content-security-policy') || '')) problems.push('CSP allows unsafe-inline/unsafe-eval');
for (const p of ['tests/smoke.cjs', 'package.json', 'CLAUDE.md', 'README.md', '.github/workflows/ci.yml', '_headers', 'Dockerfile']) {
  const r = await fetch(new URL(p, url));
  await r.arrayBuffer();
  if (r.status !== 404) problems.push(`/${p} returned ${r.status}, expected 404`);
}

// 2. The page in headless Chrome at phone size.
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromeBin, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'catscape-'))}`,
  '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' });

let ws;
try {
  let target;
  for (let i = 0; i < 150 && !target; i++) { // up to 30 s: a cold CI runner can be slow
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('Chrome did not start');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      problems.push(`uncaught: ${d.exception?.description || d.text}`);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problems.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || /Content Security Policy|Refused to/i.test(e.text)) problems.push(`log(${e.source}): ${e.text}${e.url ? ' ' + e.url : ''}`);
    }
  };
  const send = (method, params = {}) => new Promise((r) => {
    const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => {
    if (!shotDir) return;
    mkdirSync(shotDir, { recursive: true });
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shotDir, name), Buffer.from(r.result.data, 'base64'));
  };
  const key = async (k, code, ms = 80) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: 0 });
    await sleep(ms);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  // Record CSP violations from inside the page; CDP console/log events do not always carry them.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' blocked ' + (e.blockedURI || 'inline')));` });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url });
  await sleep(3000);

  const info = await evalJs(`(async () => {
    await document.fonts.ready;
    const c = document.getElementById('game');
    // Sample the visible canvas: a blank canvas has a single colour.
    const g = c && c.getContext('2d'), seen = new Set();
    if (g && c.width) { const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] << 16) | (d[i+1] << 8) | d[i+2]); }
    return { title: document.title, w: c && c.width, h: c && c.height, colours: seen.size,
      pressStart: document.fonts.check('8px "Press Start 2P"'), vt323: document.fonts.check('10px VT323'),
      styled: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() !== '' };
  })()`);
  await shot('title.png');

  // Start the game (jump starts it from the title) and walk right for a moment.
  await key(' ', 'Space');
  await sleep(1500);
  await key('ArrowRight', 'ArrowRight', 1200);
  await sleep(500);
  await shot('playing.png');
  await key('h', 'KeyH');
  await sleep(600);
  await shot('hint.png');
  // Each reload below starts a fresh window.__csp, so collect it per page.
  const collectCsp = async () => { for (const v of (await evalJs('window.__csp')) || []) problems.push(`CSP violation: ${v}`); };
  await collectCsp();

  const desktopPad = await evalJs(`getComputedStyle(document.getElementById('pad')).display`);
  if (desktopPad !== 'none') problems.push(`touch pad shown without a touch screen (display ${desktopPad})`);

  // 3. Touch phones: every pad button is big enough and none overlaps the canvas.
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  for (const [name, width, height] of [['portrait', 390, 844], ['portrait-small', 320, 568], ['landscape', 844, 390], ['landscape-small', 667, 375]]) {
    const angle = width > height ? 90 : 0;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true,
      screenOrientation: { type: angle ? 'landscapePrimary' : 'portraitPrimary', angle } });
    await send('Emulation.resetPageScaleFactor');
    await send('Page.reload');
    await sleep(2000);
    const pad = await evalJs(`(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { k: el.dataset.k, l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      return { canvas: box(document.getElementById('game')), buttons: [...document.querySelectorAll('#pad button')].map(box),
        pageWidth: document.documentElement.scrollWidth };
    })()`);
    await shot(`touch-${name}.png`);
    await collectCsp();
    if (!pad) { problems.push(`${name}: could not measure the touch pad`); continue; }
    if (pad.pageWidth > width) problems.push(`${name}: page is ${pad.pageWidth} CSS px wide, wider than the ${width} px screen`);
    const c = pad.canvas;
    for (const b of pad.buttons) {
      if (b.r - b.l < 56 || b.b - b.t < 56) problems.push(`${name}: ${b.k} button is ${b.r - b.l}x${b.b - b.t}, under 56 CSS px`);
      if (b.l < c.r && b.r > c.l && b.t < c.b && b.b > c.t) problems.push(`${name}: ${b.k} button overlaps the canvas`);
      if (b.l < 0 || b.t < 0 || b.r > width || b.b > height) problems.push(`${name}: ${b.k} button is off screen`);
    }
    if (c.r - c.l < 200) problems.push(`${name}: canvas is only ${c.r - c.l} CSS px wide`);
    // Thumb layout (issue #3): d-pad bottom-left, actions bottom-right, JUMP nearest the corner.
    const { left, right, down, paw, jump } = Object.fromEntries(pad.buttons.map((b) => [b.k, b]));
    const midX = (b) => (b.l + b.r) / 2;
    for (const b of [left, right, down]) if (midX(b) >= width / 2) problems.push(`${name}: ${b.k} button is not on the left half`);
    for (const b of [paw, jump]) if (midX(b) <= width / 2) problems.push(`${name}: ${b.k} button is not on the right half`);
    if (left.r > right.l || left.b <= right.t || left.t >= right.b) problems.push(`${name}: left and right buttons are not side by side`);
    if (down.t < Math.max(left.b, right.b) || midX(down) < left.r || midX(down) > right.l) problems.push(`${name}: down button is not below, between left and right`);
    if (jump.r - jump.l <= paw.r - paw.l) problems.push(`${name}: JUMP is not larger than SWAT`);
    if (jump.r < paw.r || jump.b < paw.b) problems.push(`${name}: JUMP is not nearest the bottom-right corner`);
    if (paw.b > jump.t && paw.r > jump.l) problems.push(`${name}: SWAT is not above or left of JUMP`);
  }

  console.log('page info:', JSON.stringify(info));
  if (!info || !/^Catscape/.test(info.title)) problems.push(`page did not load (title ${info && info.title})`);
  if (!info || !info.w || info.colours < 3) problems.push('canvas is missing or blank');
  if (!info || !info.pressStart || !info.vt323) problems.push('Google Fonts did not load (Press Start 2P / VT323)');
  if (!info || !info.styled) problems.push('style.css did not apply');
} catch (e) {
  problems.push(e.message);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill('SIGKILL');
  server && server.close();
}

if (problems.length) {
  console.error('FAIL\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exitCode = 1;
} else {
  console.log('OK: headers set, repo files not served, canvas rendered, fonts loaded, no JS errors or CSP violations, touch pad clear of the canvas');
}
