import { authenticated, bodyJson, configured, cookie, fail, json, sessionToken, sha256 } from '../../src/private-storage.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method === 'GET') return json({ configured: configured(env), authenticated: await authenticated(request, env) });
    if (!configured(env)) fail('専用ストレージの接続設定が完了していません。', 503);
    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(sessionToken(request))).run();
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(request) });
    }
    if (request.method !== 'POST') return json({ error: '対応していない操作です。' }, 405);
    const body = await bodyJson(request, 2048);
    if (typeof body.password !== 'string' || body.password.length > 256) fail('パスワードを入力してください。');
    // Reserve a rate-limit slot before verification, including concurrent requests.
    const now = Date.now();
    const ip = await sha256(request.headers.get('CF-Connecting-IP') || 'local');
    const attempt = await env.DB.prepare(`INSERT INTO login_attempts (ip_hash,attempts,expires_at) VALUES (?,1,?)
      ON CONFLICT(ip_hash) DO UPDATE SET attempts=CASE WHEN expires_at <= ? THEN 1 ELSE attempts+1 END,
      expires_at=CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END RETURNING attempts`)
      .bind(ip, now + 15 * 60 * 1000, now, now).first();
    if (attempt.attempts > 5) return json({ error: '試行回数が多いため、15分後に再度お試しください。' }, 429, { 'Retry-After': '900' });
    const hash = await sha256(body.password);
    let difference = 0;
    for (let i = 0; i < 64; i++) difference |= hash.charCodeAt(i) ^ env.OWNER_PASSWORD_SHA256.charCodeAt(i);
    if (difference) fail('パスワードが違います。', 401);
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const maxAge = 30 * 24 * 60 * 60;
    const statements = [
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM login_attempts WHERE expires_at <= ? OR ip_hash = ?').bind(now, ip),
      env.DB.prepare('INSERT INTO sessions (token_hash,password_version,expires_at) VALUES (?,?,?)')
        .bind(await sha256(token), await sha256(env.OWNER_PASSWORD_SHA256), now + maxAge * 1000),
    ];
    await env.DB.batch(statements);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, token, maxAge) });
  } catch (error) {
    return json({ error: error.status ? error.message : 'ログイン処理に失敗しました。' }, error.status || 503);
  }
}
