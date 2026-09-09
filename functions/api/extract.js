import {
  extractVideoUrls,
  extractKnownProviderUrls,
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
    const results = dedupeResults([
      ...(await extractKnownProviderUrls(pageUrl)),
      ...extractVideoUrls(html, pageUrl),
    ]);

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

function dedupeResults(results) {
  const deduped = new Map();

  for (const result of results) {
    if (!deduped.has(result.url)) {
      deduped.set(result.url, result);
    }
  }

  return [...deduped.values()];
}
