import { authenticated, configured, json } from '../src/private-storage.js';

const pages = new Set(['/', '/index', '/index.html', '/saved', '/saved.html', '/history', '/history.html', '/mp4', '/mp4.html']);

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const api = url.pathname.startsWith('/api/');
  if (!api && !pages.has(url.pathname.replace(/\/$/, '') || '/')) return context.next();
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('Origin') !== url.origin) {
      return json({ error: 'このサイトの画面から操作してください。' }, 403);
    }
    if (url.pathname !== '/api/auth') {
      if (!configured(env)) return json({ error: '専用ストレージの接続設定が完了していません。' }, 503);
      if (!await authenticated(request, env)) {
        if (api) return json({ error: 'ログインしてください。' }, 401);
        return new Response(null, { status: 302, headers: { Location: `/login.html?next=${encodeURIComponent(url.pathname + url.search)}`, 'Cache-Control': 'no-store' } });
      }
    }
    const original = await context.next();
    const response = new Response(original.body, original);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.delete('Access-Control-Allow-Origin');
    return response;
  } catch {
    return json({ error: 'ストレージに接続できません。時間をおいて再度お試しください。' }, 503);
  }
}
