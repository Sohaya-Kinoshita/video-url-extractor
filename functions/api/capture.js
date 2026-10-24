import { bodyJson, fail, json, webUrl } from '../../src/private-storage.js';
import { validatePageUrl } from '../../src/extractor.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await bodyJson(request, 512000);
    const pageUrl = validatePageUrl(webUrl(body.pageUrl));
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 150) fail('1〜150件の動画URLを指定してください。');
    const unique = new Map();
    for (const item of body.items) {
      if (!item || typeof item !== 'object') fail('動画データが正しくありません。');
      const url = validatePageUrl(webUrl(item.url));
      const path = new URL(url).pathname.toLowerCase();
      if (!/\.(mp4|m3u8|webm|mov|m4v|ogv)$/.test(path)) fail('動画ファイルのURLを指定してください。');
      const thumbnailUrl = item.thumbnailUrl ? validatePageUrl(webUrl(item.thumbnailUrl)) : '';
      unique.set(url, { url, kind: path.endsWith('.m3u8') ? 'hls' : 'file', source: 'Browser capture', sourcePage: pageUrl, ...(thumbnailUrl ? { thumbnailUrl } : {}) });
    }
    const results = [...unique.values()];
    let historySaved = false;
    try {
      await env.DB.prepare(`INSERT INTO extraction_history (input_url,page_url,result_count,scanned_page_count,created_at) VALUES (?,?,?,?,?)`)
        .bind(pageUrl, pageUrl, results.length, 1, new Date().toISOString()).run();
      historySaved = true;
    } catch { /* Captured results remain usable when history storage is temporarily unavailable. */ }
    return json({ pageUrl, count: results.length, scannedPageCount: 1, results, historySaved });
  } catch (error) {
    return json({ error: error.status ? error.message : 'ブラウザからの取り込みに失敗しました。' }, error.status || 503);
  }
}
