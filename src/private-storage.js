export function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

export async function bodyJson(request, maxBytes = 65536) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) fail('JSON形式で送信してください。', 415);
  const reader = request.body?.getReader();
  if (!reader) fail('データがありません。');
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); fail('データが大きすぎます。', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { fail('JSONを読み取れませんでした。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('JSONオブジェクトを送信してください。');
  return body;
}

export function configured(env) {
  return !!env?.DB && /^[a-f0-9]{64}$/.test(env.OWNER_PASSWORD_SHA256 || '');
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function cookie(request, token = '', maxAge = 0) {
  const secure = new URL(request.url).protocol === 'https:';
  const name = secure ? '__Host-vue_session' : 'vue_session';
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function sessionToken(request) {
  const name = new URL(request.url).protocol === 'https:' ? '__Host-vue_session' : 'vue_session';
  return request.headers.get('Cookie')?.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}

export async function authenticated(request, env) {
  if (!configured(env)) return false;
  const token = sessionToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const session = await env.DB.prepare('SELECT password_version, expires_at FROM sessions WHERE token_hash = ?')
    .bind(await sha256(token)).first();
  return !!session && session.expires_at > Date.now() && session.password_version === await sha256(env.OWNER_PASSWORD_SHA256);
}

export function webUrl(value, optional = false) {
  if (optional && !value) return '';
  if (typeof value !== 'string' || value.length > 8192) fail('URLが正しくありません。');
  let url;
  try { url = new URL(value); } catch { fail('URLが正しくありません。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('HTTP/HTTPSのURLを指定してください。');
  return value;
}

export function video(item, importing = false) {
  if (!item || typeof item !== 'object') fail('保存データが正しくありません。');
  const time = importing && item.savedAt ? new Date(item.savedAt) : new Date();
  if (Number.isNaN(time.getTime()) || time.getTime() > Date.now() + 60000) fail('保存日時が正しくありません。');
  return {
    url: webUrl(item.url), kind: item.kind === 'hls' ? 'hls' : 'file',
    source: typeof item.source === 'string' ? item.source.slice(0, 256) : '',
    sourcePage: webUrl(item.sourcePage, true), thumbnailUrl: webUrl(item.thumbnailUrl, true),
    savedAt: time.toISOString(),
  };
}

export function saveStatement(db, item) {
  return db.prepare(`INSERT INTO saved_videos (url,kind,source,source_page,thumbnail_url,saved_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET
    kind=excluded.kind,source=excluded.source,source_page=excluded.source_page,
    thumbnail_url=excluded.thumbnail_url,saved_at=excluded.saved_at
    WHERE excluded.saved_at > saved_videos.saved_at`)
    .bind(item.url, item.kind, item.source, item.sourcePage, item.thumbnailUrl, item.savedAt);
}

export function savedItem(row) {
  return { url: row.url, kind: row.kind, source: row.source, sourcePage: row.source_page, thumbnailUrl: row.thumbnail_url, savedAt: row.saved_at };
}
