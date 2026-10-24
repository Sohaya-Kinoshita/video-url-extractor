import assert from 'node:assert/strict';
import { it } from 'node:test';
import { localD1 } from '../scripts/local-d1.mjs';
import { sha256 } from '../src/private-storage.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequest as auth } from '../functions/api/auth.js';
import { onRequest as saved } from '../functions/api/saved.js';
import { onRequestPost as importSaved } from '../functions/api/import.js';
import { onRequestGet as history } from '../functions/api/history.js';
import { onRequestPost as extract } from '../functions/api/extract.js';
import { onRequestPost as capture } from '../functions/api/capture.js';

const origin = 'https://extractor.example.com';
const password = 'test-only-random-password-0123456789';
async function fixture(t) {
  const DB = localD1();
  t.after(() => DB.sqlite.close());
  const env = { DB, OWNER_PASSWORD_SHA256: await sha256(password) };
  let cookie = '';
  async function request(path, method = 'GET', body, extra = {}) {
    const req = new Request(origin + path, { method,
      headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const handler = { '/api/auth': auth, '/api/saved': saved, '/api/import': importSaved, '/api/history': history, '/api/extract': extract, '/api/capture': capture }[new URL(req.url).pathname];
    const context = { request: req, env, next: () => handler ? handler(context) : new Response('private page') };
    return middleware(context);
  }
  async function login() {
    const response = await request('/api/auth', 'POST', { password });
    assert.equal(response.status, 200);
    cookie = response.headers.get('Set-Cookie').split(';')[0];
    return response;
  }
  return { request, login, env, get cookie() { return cookie; } };
}

it('protects all APIs and private pages; missing configuration fails closed', async (t) => {
  const f = await fixture(t);
  for (const path of ['/api/saved', '/api/history', '/api/extract', '/api/capture', '/api/download?url=https://media.example/a.mp4']) {
    assert.equal((await f.request(path)).status, 401);
  }
  for (const path of ['/', '/saved', '/saved.html', '/history', '/mp4.html?url=x']) {
    const response = await f.request(path);
    assert.equal(response.status, 302);
    assert.ok(response.headers.get('Location').startsWith('/login.html?next='));
  }
  f.env.OWNER_PASSWORD_SHA256 = '';
  assert.equal((await f.request('/api/saved')).status, 503);
});

it('imports browser results with authentication, validates URLs and records history without refetching the protected page', async (t) => {
  const f = await fixture(t);
  await f.login();
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Capture must not refetch remote pages'); });
  const signed = 'https://media.example/clip.m3u8?key=a%2Bb';
  const response = await f.request('/api/capture', 'POST', { pageUrl: 'https://article.example/article/id', items: [{ url: signed }, { url: signed }] });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.historySaved, true);
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].url, signed);
  assert.equal(data.results[0].kind, 'hls');
  assert.equal((await (await f.request('/api/history')).json()).items.length, 1);
  for (const url of ['http://127.0.0.1/x.mp4', 'javascript:alert(1)', 'https://media.example/not-video']) {
    assert.equal((await f.request('/api/capture', 'POST', { pageUrl: 'https://article.example/article/id', items: [{ url }] })).status, 400);
  }
  assert.equal((await (await f.request('/api/history')).json()).items.length, 1);
});

it('logs in with a secure cookie, rejects cross-origin writes and revokes logout/rotated sessions', async (t) => {
  const f = await fixture(t);
  const login = await f.login();
  const cookie = login.headers.get('Set-Cookie');
  assert.match(cookie, /^__Host-vue_session=/);
  assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=2592000; Secure/);
  const row = f.env.DB.sqlite.prepare('SELECT * FROM sessions').get();
  assert.notEqual(row.token_hash, f.cookie.split('=')[1]);
  assert.equal((await f.request('/api/saved')).status, 200);
  assert.equal((await f.request('/api/saved', 'POST', { url: 'https://media.example/a.mp4' }, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await f.request('/api/auth', 'POST', { password }, { Origin: '' })).status, 403);
  assert.equal((await f.request('/api/auth', 'DELETE')).status, 200);
  assert.equal((await f.request('/api/saved')).status, 401);
  await f.login();
  f.env.OWNER_PASSWORD_SHA256 = await sha256('a new password');
  assert.equal((await f.request('/api/saved')).status, 401);
});

it('rate limits failed passwords and expires sessions', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await f.request('/api/auth', 'POST', { password: 'wrong' })).status, 401);
  assert.equal((await f.request('/api/auth', 'POST', { password })).status, 429);
  f.env.DB.sqlite.prepare('UPDATE login_attempts SET expires_at = 0').run();
  await f.login();
  f.env.DB.sqlite.prepare('UPDATE sessions SET expires_at = 0').run();
  assert.equal((await f.request('/api/saved')).status, 401);
});

it('persists shared bookmarks, deduplicates and paginates tied timestamps without gaps', async (t) => {
  const f = await fixture(t);
  await f.login();
  const items = Array.from({ length: 75 }, (_, i) => ({ url: `https://media.example/${String(i).padStart(3, '0')}.mp4`, savedAt: '2026-01-01T00:00:00.000Z' }));
  for (let i = 0; i < items.length; i += 40) assert.equal((await f.request('/api/import', 'POST', { items: items.slice(i, i + 40) })).status, 200);
  const first = await (await f.request('/api/saved')).json();
  assert.equal(first.items.length, 50);
  const second = await (await f.request(`/api/saved?cursor=${encodeURIComponent(first.cursor)}`)).json();
  assert.equal(second.items.length, 25);
  assert.equal(second.cursor, null);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.url)).size, 75);
  const response = await f.request('/api/saved', 'POST', { ...items[0], source: 'updated', sourcePage: 'https://page.example/video', kind: 'hls' });
  assert.equal(response.status, 200);
  const updated = (await response.json()).item;
  await f.request('/api/import', 'POST', { items: [items[0]] });
  const current = (await (await f.request('/api/saved')).json()).items[0];
  assert.equal(current.source, 'updated');
  assert.equal(current.sourcePage, 'https://page.example/video');
  assert.equal(current.savedAt, updated.savedAt);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM saved_videos').get().n, 75);
  assert.equal((await f.request('/api/saved', 'DELETE', { url: items[0].url })).status, 200);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM saved_videos').get().n, 74);
});

it('rejects unsafe URLs and invalid imports without partially saving data', async (t) => {
  const f = await fixture(t);
  await f.login();
  for (const item of [{ url: 'javascript:alert(1)' }, { url: 'https://media.example/a', thumbnailUrl: 'data:image/png,abc' }]) {
    assert.equal((await f.request('/api/saved', 'POST', item)).status, 400);
  }
  const response = await f.request('/api/import', 'POST', { items: [{ url: 'https://media.example/good.mp4' }, { url: 'bad' }] });
  assert.equal(response.status, 400);
  assert.equal(f.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM saved_videos').get().n, 0);
  assert.equal((await f.request('/api/import', 'POST', { items: Array(41).fill({ url: 'https://media.example/a.mp4' }) })).status, 400);
  assert.equal((await f.request('/api/saved', 'POST', null)).status, 400);
  assert.equal((await f.request('/api/auth', 'POST', [])).status, 400);
  assert.equal((await f.request('/api/saved', 'POST', { url: `https://media.example/${'x'.repeat(70000)}` })).status, 413);
});

it('records successful extractions and returns history across sessions, excluding failed extractions', async (t) => {
  const f = await fixture(t);
  await f.login();
  t.mock.method(globalThis, 'fetch', async () => new Response('<video src="https://media.example/a.mp4"></video>', { headers: { 'Content-Type': 'text/html' } }));
  const response = await f.request('/api/extract', 'POST', { url: 'https://page.example/watch/video', scanLinkedPages: false });
  const payload = await response.json();
  assert.equal(payload.historySaved, true);
  await f.request('/api/extract', 'POST', { url: 'not a URL' });
  await f.login();
  const data = await (await f.request('/api/history')).json();
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].inputUrl, 'https://page.example/watch/video');
  assert.equal(data.items[0].count, 1);
  assert.equal(data.cursor, null);
});
