import { fail, json } from '../../src/private-storage.js';

export async function onRequestGet({ request, env }) {
  try {
    const cursor = new URL(request.url).searchParams.get('cursor');
    if (cursor && (!/^\d{1,15}$/.test(cursor) || Number(cursor) < 1)) fail('ページ情報が正しくありません。');
    const query = cursor ? env.DB.prepare('SELECT * FROM extraction_history WHERE id < ? ORDER BY id DESC LIMIT 51').bind(Number(cursor))
      : env.DB.prepare('SELECT * FROM extraction_history ORDER BY id DESC LIMIT 51');
    const { results } = await query.all();
    const items = results.slice(0, 50).map((row) => ({ id: row.id, inputUrl: row.input_url, pageUrl: row.page_url,
      count: row.result_count, scannedPageCount: row.scanned_page_count, createdAt: row.created_at }));
    return json({ items, cursor: results.length > 50 ? String(items.at(-1).id) : null });
  } catch (error) {
    return json({ error: error.status ? error.message : '履歴を取得できませんでした。' }, error.status || 503);
  }
}
