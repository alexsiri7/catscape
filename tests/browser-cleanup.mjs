// Checks that tests/browser.mjs cleans up when it is interrupted (Ctrl-C, or CI cancelling a run):
// Chrome's whole process group is killed, its profile directory removed, and the script still dies
// of the signal. A stub stands in for Chrome, so this needs no browser. Usage: node tests/browser-cleanup.mjs
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const work = mkdtempSync(join(tmpdir(), 'catscape-cleanup-'));
const stub = join(work, 'chrome');
// Like Chrome: writes into its profile and leaves a helper process in its process group.
writeFileSync(stub, `#!/bin/sh
for a; do case "$a" in --user-data-dir=*) dir="\${a#--user-data-dir=}";; esac; done
mkdir -p "$dir/Default" && echo x > "$dir/Default/Preferences"
sleep 60 &
echo "$$ $! $dir" > "$STUB_INFO.tmp" && mv "$STUB_INFO.tmp" "$STUB_INFO"
wait
`);
chmodSync(stub, 0o755);

const failures = [];
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  const info = join(work, `${sig}.info`);
  const test = spawn(process.execPath, [new URL('./browser.mjs', import.meta.url).pathname], {
    stdio: 'ignore', env: { ...process.env, CHROME_BIN: stub, STUB_INFO: info },
  });
  const exited = once(test, 'exit');
  for (let i = 0; i < 100 && !existsSync(info); i++) await sleep(100);
  if (!existsSync(info)) { test.kill('SIGKILL'); failures.push(`${sig}: the Chrome stub never started`); continue; }
  const [chromePid, helperPid, profileDir] = readFileSync(info, 'utf8').trim().split(' ');
  test.kill(sig);
  const timeout = new Promise((r) => setTimeout(r, 10000, null).unref());
  const result = await Promise.race([exited, timeout]);
  if (!result) {
    failures.push(`${sig}: the browser test was still running 10 s after the signal`);
    test.kill('SIGKILL');
    for (const pid of [chromePid, helperPid]) try { process.kill(+pid, 'SIGKILL'); } catch {}
    rmSync(profileDir, { recursive: true, force: true });
    continue;
  }
  const [status, signal] = result;
  const exitCode = status ?? { SIGINT: 130, SIGTERM: 143 }[signal];
  if (exitCode !== code) failures.push(`${sig}: exit code ${exitCode}, expected ${code}`);
  // The orphaned helper is reaped by init, which can take a moment.
  for (let i = 0; i < 20 && (alive(+chromePid) || alive(+helperPid)); i++) await sleep(100);
  for (const [name, pid] of [['Chrome', chromePid], ['Chrome helper', helperPid]]) {
    if (alive(+pid)) { failures.push(`${sig}: ${name} (pid ${pid}) is still running`); process.kill(+pid, 'SIGKILL'); }
  }
  if (existsSync(profileDir)) { failures.push(`${sig}: profile directory ${profileDir} was left behind`); rmSync(profileDir, { recursive: true, force: true }); }
}
rmSync(work, { recursive: true, force: true });

if (failures.length) {
  console.error('FAIL\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exitCode = 1;
} else {
  console.log('OK: on SIGINT and SIGTERM the browser test stops Chrome, removes its profile and exits with the signal');
}
