// Local stand-in for Cloudflare Pages, with no dependencies.
// Serves public/ only and applies the rules in public/_headers, so tests see the production CSP.
// Usage: node tests/serve.mjs [port]   (default 8080; PORT env also works)
// Like Pages: `_headers` itself is not served, `/` and `/dir/` map to index.html,
// unknown paths get public/404.html with status 404.
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

// Parse _headers: a line starting at column 0 is a URL pattern; indented `Name: value` lines belong to it.
export function parseHeaders(text) {
  const rules = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { rules.push({ pattern: line.trim(), headers: [] }); continue; }
    const m = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (!m || !rules.length) throw new Error(`bad _headers line: ${line}`);
    rules.at(-1).headers.push([m[1].trim(), m[2]]);
  }
  return rules;
}
const matches = (pattern, path) =>
  new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(path);

const rules = parseHeaders(readFileSync(join(ROOT, '_headers'), 'utf8'));

function resolve(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT) || file.split(sep).includes('..')) return null;
  if (file === join(ROOT, '_headers') || file === join(ROOT, '_redirects')) return null;
  try { return statSync(file).isFile() ? file : null; } catch { return null; }
}

const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  for (const r of rules) if (matches(r.pattern, path)) for (const [k, v] of r.headers) res.setHeader(k, v);
  let file = resolve(req.url);
  let status = 200;
  if (!file) { file = join(ROOT, '404.html'); status = 404; }
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => console.log(`serving public/ with _headers on http://127.0.0.1:${PORT}/`));
}
export { server };
