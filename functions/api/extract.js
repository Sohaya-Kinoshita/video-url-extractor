import {
  createExtractionFetch,
  extractPageVideos,
  extractLinkedPageUrls,
  fetchHtml,
  jsonResponse,
  readJsonBody,
  validatePageUrl,
} from "../../src/extractor.js";

const LINKED_PAGE_LIMIT = 8;

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const targetUrl = validatePageUrl(body.url);
    const budget = createExtractionFetch();
    const { html, pageUrl } = await fetchHtml(targetUrl, budget.fetch);
    const primaryResults = (await extractPageVideos(html, pageUrl, budget.fetch))
      .map((result) => ({ ...result, sourcePage: result.sourcePage || pageUrl }));

    const linkedPageResults =
      body.scanLinkedPages === false
        ? []
        : await extractLinkedPageResults(html, pageUrl, budget.fetch);
    const results = dedupeResults([...primaryResults, ...linkedPageResults]);
    const scannedPageCount = Math.max(1, budget.scannedPages);

    let historySaved = false;
    if (env?.DB) {
      try {
        await env.DB.prepare(`INSERT INTO extraction_history
          (input_url,page_url,result_count,scanned_page_count,created_at) VALUES (?,?,?,?,?)`)
          .bind(targetUrl.href || String(targetUrl), pageUrl, results.length,
            scannedPageCount, new Date().toISOString()).run();
        historySaved = true;
      } catch { /* Extraction results remain usable when history storage is unavailable. */ }
    }
    return jsonResponse({
      historySaved,
      ...(body.diagnostics === true ? { diagnostics: budget.diagnostics } : {}),
      warnings: budget.limited ? ["探索件数の上限に達したため、一部のリンクを省略しました。必要なページのURLで再探索してください。"] : [],
      pageUrl,
      scannedPageCount,
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

async function extractLinkedPageResults(html, pageUrl, fetchImpl) {
  const linkedPages = extractLinkedPageUrls(html, pageUrl, LINKED_PAGE_LIMIT);
  const collected = [];
  let scannedPageCount = 0;

  await Promise.all(
    linkedPages.map(async (linkedPageUrl) => {
      try {
        const safeUrl = validatePageUrl(linkedPageUrl);
        const linkedPage = await fetchHtml(safeUrl, fetchImpl);
        scannedPageCount += 1;

        const results = (await extractPageVideos(linkedPage.html, linkedPage.pageUrl, fetchImpl)).map((result) => ({
          ...result,
          source: `${result.source} / リンク先`,
          sourcePage: result.sourcePage || linkedPage.pageUrl,
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
