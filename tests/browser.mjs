// Headless Chrome test with no dependencies (Node >= 22 for the global WebSocket and fetch).
// Usage: node tests/browser.mjs [screenshot-dir] [url]
// Without a url it starts tests/serve.mjs (public/ + the _headers rules) on a free port.
// With a url (e.g. a Cloudflare Pages preview) it tests that deployment instead.
// Fails on: missing security headers, repo files being served, uncaught JS errors,
// console errors, CSP violations, fonts or style.css not loading, or a blank canvas.
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
  for (let i = 0; i < 50 && !target; i++) {
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

  const csp = (await evalJs('window.__csp')) || [];
  for (const v of csp) problems.push(`CSP violation: ${v}`);
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
  console.log('OK: headers set, repo files not served, canvas rendered, fonts loaded, no JS errors or CSP violations');
}
