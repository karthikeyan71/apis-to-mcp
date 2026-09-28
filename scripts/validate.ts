/**
 * Sends the same request to the proxy and directly to the upstream, and checks
 * that status code and body match. Usage:
 *   PROXY_URL=http://localhost:3000 npm run validate
 */
import { RESOURCES, NESTED } from '../src/resources';

const PROXY_URL = process.env.PROXY_URL ?? 'http://localhost:3000';
const UPSTREAM_URL = process.env.UPSTREAM_BASE_URL ?? 'https://jsonplaceholder.typicode.com';

type Case = { method: string; path: string; body?: unknown };

const cases: Case[] = [];
for (const r of RESOURCES) {
  cases.push(
    { method: 'GET', path: `/${r}` },
    { method: 'GET', path: `/${r}/1` },
    { method: 'GET', path: `/${r}/999999` },
    { method: 'POST', path: `/${r}`, body: { title: 'foo', body: 'bar', userId: 1 } },
    { method: 'PUT', path: `/${r}/1`, body: { id: 1, title: 'foo', body: 'bar', userId: 1 } },
    { method: 'PATCH', path: `/${r}/1`, body: { title: 'patched' } },
    { method: 'DELETE', path: `/${r}/1` },
  );
}
for (const { parent, child } of NESTED) cases.push({ method: 'GET', path: `/${parent}/1/${child}` });
cases.push(
  { method: 'GET', path: '/comments?postId=1' },
  { method: 'GET', path: '/posts?userId=1' },
  { method: 'GET', path: '/photos?albumId=2' },
  { method: 'GET', path: '/todos?userId=1&completed=true' },
);

async function call(base: string, c: Case) {
  const res = await fetch(base + c.path, {
    method: c.method,
    headers: c.body ? { 'Content-Type': 'application/json' } : undefined,
    body: c.body ? JSON.stringify(c.body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function main() {
  let failed = 0;
  for (const c of cases) {
    const [p, u] = await Promise.all([call(PROXY_URL, c), call(UPSTREAM_URL, c)]);
    const ok = p.status === u.status && JSON.stringify(p.json) === JSON.stringify(u.json);
    const size = Array.isArray(p.json) ? `${p.json.length} items` : 'object';
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.method.padEnd(6)} ${c.path.padEnd(34)} ${p.status}  ${size}`);
    if (!ok) {
      failed++;
      console.log(`      proxy=${p.status} ${JSON.stringify(p.json).slice(0, 120)}`);
      console.log(`      upstream=${u.status} ${JSON.stringify(u.json).slice(0, 120)}`);
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
}

main();
