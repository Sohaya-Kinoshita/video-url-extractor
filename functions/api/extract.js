import {
  extractVideoUrls,
  fetchHtml,
  jsonResponse,
  readJsonBody,
  validatePageUrl,
} from "../../src/extractor.js";

export async function onRequestPost({ request }) {
  try {
    const body = await readJsonBody(request);
    const targetUrl = validatePageUrl(body.url);
    const { html, pageUrl } = await fetchHtml(targetUrl);
    const results = extractVideoUrls(html, pageUrl);

    return jsonResponse({
      pageUrl,
      count: results.length,
      results,
    });
  } catch (error) {
    return jsonResponse(
      { error: error.message || "解析に失敗しました。" },
      error.status || 500,
    );
  }
}

export async function onRequestGet() {
  return jsonResponse({ error: "POSTでURLを送信してください。" }, 405);
}
