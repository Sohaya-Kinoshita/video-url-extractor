import { bodyJson, fail, json, saveStatement, video } from '../../src/private-storage.js';

export async function onRequestPost({ request, env }) {
  try {
    const { items } = await bodyJson(request, 4 * 1024 * 1024);
    if (!Array.isArray(items) || !items.length || items.length > 40) fail('1〜40件の保存データを指定してください。');
    const valid = items.map((item) => video(item, true));
    // D1 batch is atomic; failed imports leave the local backup untouched.
    await env.DB.batch(valid.map((item) => saveStatement(env.DB, item)));
    return json({ imported: valid.length });
  } catch (error) {
    return json({ error: error.status ? error.message : '取り込みに失敗しました。端末のデータは残っています。' }, error.status || 503);
  }
}
