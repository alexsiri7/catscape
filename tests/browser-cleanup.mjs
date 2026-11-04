// Checks that tests/browser.mjs cleans up Chrome: when a run ends on its own (here because Chrome
// exits early or is missing) and when it is interrupted (Ctrl-C, or CI cancelling a run), Chrome's
// whole process group is killed and its profile directory removed; an interrupted run still dies
// of the signal, reporting a profile it could not remove. A stub stands in for Chrome, so this needs no browser. Usage: node tests/browser-cleanup.mjs
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLEANUP_SIGNALS, stopChromeOrdered } from './browser.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const work = mkdtempSync(join(tmpdir(), 'catscape-cleanup-'));
const stub = join(work, 'chrome');
// Like Chrome: writes into its profile and leaves a helper process in its process group.
writeFileSync(stub, `#!/bin/sh
for a; do case "$a" in --user-data-dir=*) dir="\${a#--user-data-dir=}";; esac; done
mkdir -p "$dir/Default" && echo x > "$dir/Default/Preferences"
[ -n "$STUB_LOCK" ] && chmod 555 "$dir/Default"
sleep 60 &
echo "$$ $! $dir" > "$STUB_INFO.tmp" && mv "$STUB_INFO.tmp" "$STUB_INFO"
[ -n "$STUB_EXIT" ] && exit 0
wait
`);
chmodSync(stub, 0o755);

const browserTest = fileURLToPath(new URL('./browser.mjs', import.meta.url));
const browserTestLink = join(work, 'browser.mjs');
symlinkSync(browserTest, browserTestLink);
const failures = [];
const removeDir = (dir, what) => {
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { failures.push(`${what}: could not remove ${dir}: ${e.message}`); }
};

// Unit test: stopChromeOrdered must not remove the profile before Chrome's exit is observed
// (the ordering a mutation of tests/browser.mjs's stopChrome could silently drop).
{
  let resolveExited;
  const exited = new Promise((r) => { resolveExited = r; });
  const calls = [];
  const done = stopChromeOrdered({
    killGroup: () => calls.push('kill'),
    exited,
    removeProfile: () => calls.push('remove'),
  });
  await sleep(50);
  if (calls.includes('remove')) failures.push('stopChromeOrdered: removeProfile ran before the exited promise resolved');
  resolveExited();
  await done;
  if (calls.join(',') !== 'kill,remove') failures.push(`stopChromeOrdered: calls were ${calls.join(',') || '(none)'}, expected kill,remove`);
}

// Runs that end on their own go through the finally block. TMPDIR points at a fresh directory, so
// any profile left behind shows up there, even one whose path the stub never got to report.
// Run through a symlink, the test must still recognise itself as the entry point and run.
for (const [name, script, bin, env] of [
  ['Chrome exits early', browserTest, stub, { STUB_EXIT: '1' }],
  ['Chrome is missing', browserTest, join(work, 'missing'), {}],
  ['run through a symlink', browserTestLink, stub, { STUB_EXIT: '1' }],
]) {
  const tmp = mkdtempSync(join(work, 'tmp-'));
  const info = join(work, `${name.replaceAll(' ', '-')}.info`);
  const test = spawn(process.execPath, [script], {
    stdio: 'ignore', env: { ...process.env, ...env, CHROME_BIN: bin, STUB_INFO: info, TMPDIR: tmp },
  });
  const timeout = new Promise((r) => setTimeout(r, 20000, null).unref());
  const result = await Promise.race([once(test, 'exit'), timeout]);
  if (!result) { test.kill('SIGKILL'); failures.push(`${name}: the browser test was still running after 20 s`); }
  else if (result[0] !== 1) failures.push(`${name}: exit code ${result[0]} (signal ${result[1]}), expected 1`);
  if (existsSync(info)) {
    const helperPid = +readFileSync(info, 'utf8').split(' ')[1];
    for (let i = 0; i < 20 && alive(helperPid); i++) await sleep(100);
    if (alive(helperPid)) { failures.push(`${name}: Chrome helper (pid ${helperPid}) is still running`); try { process.kill(helperPid, 'SIGKILL'); } catch {} }
  }
  const left = readdirSync(tmp).filter((f) => f.startsWith('catscape-'));
  if (left.length) failures.push(`${name}: profile directory ${left.join(', ')} was left behind`);
}

// A profile that cannot be removed (the stub makes it read-only) must still be reported when a
// signal ends the run. Root can remove it regardless, so that case only runs as another user.
const signalCases = CLEANUP_SIGNALS.map((sig) => [sig, sig, false]);
if (process.getuid?.() !== 0) signalCases.push(['SIGTERM with a stuck profile', 'SIGTERM', true]);
for (const [name, sig, lock] of signalCases) {
  const code = 128 + constants.signals[sig];
  const info = join(work, `${name.replaceAll(' ', '-')}.info`);
  const test = spawn(process.execPath, [browserTest], {
    stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, CHROME_BIN: stub, STUB_INFO: info, ...(lock && { STUB_LOCK: '1' }) },
  });
  let stderr = '';
  test.stderr.on('data', (d) => { stderr += d; });
  const exited = once(test, 'exit');
  for (let i = 0; i < 100 && !existsSync(info); i++) await sleep(100);
  if (!existsSync(info)) { test.kill('SIGKILL'); failures.push(`${name}: the Chrome stub never started`); continue; }
  const [chromePid, helperPid, profileDir] = readFileSync(info, 'utf8').trim().split(' ');
  const removeProfile = () => {
    if (lock) try { chmodSync(join(profileDir, 'Default'), 0o755); } catch {}
    removeDir(profileDir, name);
  };
  test.kill(sig);
  const timeout = new Promise((r) => setTimeout(r, 10000, null).unref());
  const result = await Promise.race([exited, timeout]);
  if (!result) {
    failures.push(`${name}: the browser test was still running 10 s after the signal`);
    test.kill('SIGKILL');
    for (const pid of [chromePid, helperPid]) try { process.kill(+pid, 'SIGKILL'); } catch {}
    removeProfile();
    continue;
  }
  const [status, signal] = result;
  const exitCode = status ?? 128 + constants.signals[signal];
  if (exitCode !== code) failures.push(`${name}: exit code ${exitCode}, expected ${code}`);
  // The orphaned helper is reaped by init, which can take a moment.
  for (let i = 0; i < 20 && (alive(+chromePid) || alive(+helperPid)); i++) await sleep(100);
  for (const [what, pid] of [['Chrome', chromePid], ['Chrome helper', helperPid]]) {
    if (alive(+pid)) { failures.push(`${name}: ${what} (pid ${pid}) is still running`); try { process.kill(+pid, 'SIGKILL'); } catch {} }
  }
  if (lock) {
    if (!stderr.includes('could not remove the Chrome profile')) failures.push(`${name}: the failed profile removal was not reported`);
    removeProfile();
  } else if (existsSync(profileDir)) { failures.push(`${name}: profile directory ${profileDir} was left behind`); removeProfile(); }
}
removeDir(work, 'scratch directory');

if (failures.length) {
  console.error('FAIL\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exitCode = 1;
} else {
  console.log('OK: the browser test stops Chrome and removes its profile when it ends, and on SIGINT and SIGTERM exits with the signal, reporting a profile it could not remove');
}
