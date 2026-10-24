import { bodyJson, fail, json, savedItem, saveStatement, video, webUrl } from '../../src/private-storage.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method === 'GET') {
      const cursor = new URL(request.url).searchParams.get('cursor');
      let statement;
      if (cursor) {
        let values;
        try { values = JSON.parse(cursor); } catch { fail('ページ情報が正しくありません。'); }
        if (!Array.isArray(values) || values.length !== 2 || values.some((v) => typeof v !== 'string')) fail('ページ情報が正しくありません。');
        statement = env.DB.prepare('SELECT * FROM saved_videos WHERE (saved_at,url) < (?,?) ORDER BY saved_at DESC,url DESC LIMIT 51').bind(...values);
      } else statement = env.DB.prepare('SELECT * FROM saved_videos ORDER BY saved_at DESC,url DESC LIMIT 51');
      const { results } = await statement.all();
      const items = results.slice(0, 50).map(savedItem);
      const last = items.at(-1);
      return json({ items, cursor: results.length > 50 ? JSON.stringify([last.savedAt, last.url]) : null });
    }
    if (request.method === 'POST') {
      const item = video(await bodyJson(request));
      await saveStatement(env.DB, item).run();
      return json({ item });
    }
    if (request.method === 'DELETE') {
      const { url } = await bodyJson(request);
      await env.DB.prepare('DELETE FROM saved_videos WHERE url = ?').bind(webUrl(url)).run();
      return json({ ok: true });
    }
    return json({ error: '対応していない操作です。' }, 405);
  } catch (error) {
    return json({ error: error.status ? error.message : '保存リストを更新・取得できませんでした。' }, error.status || 503);
  }
}
