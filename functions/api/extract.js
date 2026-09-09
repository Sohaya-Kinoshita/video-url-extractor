import {
  extractVideoUrls,
  extractKnownProviderUrls,
  extractLinkedPageUrls,
  fetchHtml,
  jsonResponse,
  readJsonBody,
  validatePageUrl,
} from "../../src/extractor.js";

const LINKED_PAGE_LIMIT = 8;

export async function onRequestPost({ request }) {
  try {
    const body = await readJsonBody(request);
    const targetUrl = validatePageUrl(body.url);
    const { html, pageUrl } = await fetchHtml(targetUrl);
    const primaryResults = [
      ...(await extractKnownProviderUrls(pageUrl)),
      ...extractVideoUrls(html, pageUrl),
    ].map((result) => ({ ...result, sourcePage: pageUrl }));

    const linkedPageResults =
      body.scanLinkedPages === false
        ? []
        : await extractLinkedPageResults(html, pageUrl);
    const results = dedupeResults([...primaryResults, ...linkedPageResults]);

    return jsonResponse({
      pageUrl,
      scannedPageCount: 1 + (linkedPageResults.scannedPageCount || 0),
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

async function extractLinkedPageResults(html, pageUrl) {
  const linkedPages = extractLinkedPageUrls(html, pageUrl, LINKED_PAGE_LIMIT);
  const collected = [];
  let scannedPageCount = 0;

  await Promise.all(
    linkedPages.map(async (linkedPageUrl) => {
      try {
        const safeUrl = validatePageUrl(linkedPageUrl);
        const linkedPage = await fetchHtml(safeUrl);
        scannedPageCount += 1;

        const results = [
          ...(await extractKnownProviderUrls(linkedPage.pageUrl)),
          ...extractVideoUrls(linkedPage.html, linkedPage.pageUrl),
        ].map((result) => ({
          ...result,
          source: `${result.source} / リンク先`,
          sourcePage: linkedPage.pageUrl,
        }));

        collected.push(...results);
      } catch {
        // Ignore pages that cannot be fetched or parsed.
      }
    }),
  );

  collected.scannedPageCount = scannedPageCount;
  return collected;
}

function dedupeResults(results) {
  const deduped = new Map();

  for (const result of results) {
    if (!deduped.has(result.url)) {
      deduped.set(result.url, result);
      continue;
    }

    const existing = deduped.get(result.url);
    if (!existing.thumbnailUrl && result.thumbnailUrl) {
      deduped.set(result.url, { ...existing, thumbnailUrl: result.thumbnailUrl });
    }
  }

  return [...deduped.values()];
}
