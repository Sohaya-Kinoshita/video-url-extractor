const VIDEO_EXTENSIONS = ["mp4", "m3u8", "webm", "mov", "m4v", "ogv"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "gif"];
const NON_PAGE_EXTENSIONS = [
  "7z",
  "avi",
  "css",
  "csv",
  "doc",
  "docx",
  "exe",
  "gz",
  "ico",
  "jpeg",
  "jpg",
  "js",
  "json",
  "m4v",
  "mov",
  "mp3",
  "mp4",
  "pdf",
  "png",
  "rar",
  "svg",
  "ts",
  "txt",
  "webm",
  "webp",
  "xls",
  "xlsx",
  "zip",
];
const THUMBNAIL_KEYS = [
  "cover",
  "coverimage",
  "image",
  "poster",
  "previewurl",
  "thumbnail",
  "thumbnailurl",
];
const VILOLO_PAGE_HOST_RE =
  /^(video\.twimg-image\.com|video\.twimgx\.com|twimg\.com\.pl|cdn\d+\.(mvfile\.com|twimg-media\.com|image-share\.cc))$/;
const VILOLO_SHORT_LINK_RE = /^[A-Za-z0-9_-]{4,64}$/;
const VILOLO_GENERIC_SHORT_LINK_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{4,64}$/;
const VILOLO_API_BASE = "https://rwzugqnp.fun800.click/app-api";
const GOFILE_PAGE_HOST_RE = /^(www\.)?gofile\.io$/;
const GOFILE_CONTENT_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;
const GOFILE_API_BASE = "https://api.gofile.io";
const GOFILE_LANGUAGE = "en-US";
const GOFILE_WEBSITE_TOKEN_SALT = "5d4f7g8sd45fsd";
const NON_PLAYABLE_VIDEO_PAGE_HOST_RE = /^(www\.)?gofile\.rocks$/;
const PROVIDER_USER_AGENT =
  "Mozilla/5.0 (compatible; VideoURLExtractor/1.0; +https://pages.dev)";
const PAGE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const RELATED_VIDEO_PAGE_SIZE = 20;
const RELATED_VIDEO_MAX_PAGES = 5;
const MAX_HTML_CHARS = 5 * 1024 * 1024;
const MEDIA_ATTRS = [
  "src",
  "href",
  "data-src",
  "data-url",
  "data-video",
  "data-video-url",
  "data-hls",
  "data-file",
  "content",
];

const TAG_RE = /<(?<tag>video|source|iframe|embed|object|meta|link|a)\b(?<attrs>[^>]*)>/gi;
const ANCHOR_RE = /<a\b(?<attrs>[^>]*)>/gi;
const ATTR_RE = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const ABSOLUTE_VIDEO_RE = new RegExp(
  `((?:https?:)?//[^\\s"'<>]+?\\.(?:${VIDEO_EXTENSIONS.join("|")})(?:\\?[^\\s"'<>]*)?)`,
  "gi",
);
const RELATIVE_VIDEO_RE = new RegExp(
  `((?:/|\\.\\.?/)[^\\s"'<>]+?\\.(?:${VIDEO_EXTENSIONS.join("|")})(?:\\?[^\\s"'<>]*)?)`,
  "gi",
);

export async function readJsonBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw httpError("Content-Typeはapplication/jsonにしてください。", 415);
  }

  try {
    return await request.json();
  } catch {
    throw httpError("JSONの形式を確認してください。", 400);
  }
}

export function validatePageUrl(value) {
  const rawUrl = String(value || "").trim();
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw httpError("http または https のURLを入力してください。", 400);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw httpError("http または https のURLを入力してください。", 400);
  }

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw httpError("公開WebページのURLを入力してください。", 400);
  }

  return url.toString();
}

export function validateDownloadUrl(value) {
  const url = validatePageUrl(value);

  if (!isVideoFile(url)) {
    throw httpError("保存できる動画URLではありません。", 400);
  }

  return url;
}

export function isHlsUrl(url) {
  return new URL(url).pathname.toLowerCase().endsWith(".m3u8");
}

export function getDownloadFileName(url) {
  const parsed = new URL(url);
  const lastSegment = parsed.pathname.split("/").filter(Boolean).pop();
  return sanitizeFileName(safeDecodeURIComponent(lastSegment || "video"));
}

export function getTransportStreamFileName(url) {
  return getDownloadFileName(url).replace(/\.[^.]+$/, "") + ".ts";
}

export function parseHlsPlaylist(text, playlistUrl) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.some((line) => line.startsWith("#EXT-X-KEY"))) {
    throw httpError("暗号化されたHLSは保存できません。", 400);
  }

  if (lines.some((line) => line.startsWith("#EXT-X-MAP"))) {
    throw httpError("このHLS形式は保存に対応していません。", 400);
  }

  const variants = [];
  const segments = [];
  let duration = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("#EXTINF:")) {
      const seconds = Number(line.slice(8).split(",")[0]);
      if (Number.isFinite(seconds) && seconds > 0) duration += seconds;
    }
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      const nextLine = lines[index + 1];
      if (nextLine && !nextLine.startsWith("#")) {
        variants.push({
          url: new URL(nextLine, playlistUrl).toString(),
          bandwidth: Number(line.match(/BANDWIDTH=(\d+)/)?.[1] || 0),
        });
      }
      continue;
    }

    if (!line.startsWith("#")) {
      segments.push(new URL(line, playlistUrl).toString());
    }
  }

  variants.sort((a, b) => b.bandwidth - a.bandwidth);

  return {
    variants,
    segments: variants.length ? [] : segments,
    duration,
  };
}

export function createExtractionFetch(fetchImpl = fetch, limit = 40) {
  let count = 0;
  let scannedPages = 0;
  let limited = false;
  const diagnostics = [];
  const boundedFetch = async (url, options = {}) => {
    if (count >= limit) {
      limited = true;
      throw httpError("探索件数の上限に達しました。", 429);
    }
    count += 1;
    const parsed = new URL(validatePageUrl(url));
    const diagnostic = { host: parsed.hostname, path: parsed.pathname };
    diagnostics.push(diagnostic);
    let response;
    try { response = await fetchImpl(parsed.href, {
      ...options,
      signal: options.signal || AbortSignal.timeout(15000),
    }); } catch (error) { diagnostic.error = error.name || 'FetchError'; throw error; }
    diagnostic.status = response.status;
    diagnostic.contentType = response.headers.get('Content-Type') || '';
    if (response.ok && /text\/html|application\/xhtml\+xml/i.test(response.headers.get('Content-Type') || '')) scannedPages += 1;
    return response;
  };
  boundedFetch.note = (url, fields) => {
    const parsed = new URL(url);
    const record = diagnostics.findLast((item) => item.host === parsed.hostname && item.path === parsed.pathname);
    if (record) Object.assign(record, fields);
  };
  return { fetch: boundedFetch, diagnostics, get limited() { return limited; }, get scannedPages() { return scannedPages; } };
}

export async function fetchHtml(url, fetchImpl = fetch) {
  return fetchNavigationPage(url, fetchImpl, false);
}

async function fetchNavigationPage(url, fetchImpl, allowMedia) {
  let pageUrl = validatePageUrl(url);
  let response;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    response = await fetchImpl(pageUrl, {
      headers: {
        "User-Agent": PAGE_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("Location");
    await response.body?.cancel();
    if (!location || redirects === 5) throw httpError("ページの転送先を確認できませんでした。", 502);
    pageUrl = validatePageUrl(new URL(location, pageUrl).href);
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw httpError(`取得先ページがHTTP ${response.status} を返しました。`, 502);
  }

  const contentType = response.headers.get("content-type") || "";
  if (allowMedia && (/^video\//i.test(contentType) || /mpegurl/i.test(contentType) || (/^application\/octet-stream/i.test(contentType) && isVideoFile(pageUrl)))) {
    await response.body?.cancel();
    return { html: "", pageUrl, directMedia: true };
  }
  if (
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    await response.body?.cancel();
    throw httpError("HTMLページのURLを入力してください。", 400);
  }

  const html = await response.text();
  if (html.length > MAX_HTML_CHARS) {
    throw httpError("HTMLが大きすぎるため解析を中止しました。", 400);
  }
  const substitutedArticle = new URL(pageUrl).pathname.startsWith('/article/') && /https:\/\/news\.wokao\.win\/style\.css/i.test(html);
  if (substitutedArticle || /<form\b[^>]*action=["']\/?__pow["']/i.test(html) || /cf-chl-|challenge-platform\//i.test(html)) {
    throw httpError("このサイトはブラウザ確認が必要です。Safariで動画を再生し、「ブラウザから取り込む」を使ってください。", 422);
  }

  return {
    html,
    pageUrl: response.url || pageUrl,
  };
}

export function extractVideoUrls(html, pageUrl) {
  const candidates = [
    ...extractFromTags(html, pageUrl),
    ...extractFromText(html, pageUrl),
  ];
  const deduped = new Map();

  for (const candidate of candidates) {
    if (!deduped.has(candidate.url)) {
      deduped.set(candidate.url, candidate);
    }
  }

  return [...deduped.values()];
}

export async function extractPageVideos(html, pageUrl, fetchImpl = fetch) {
  const candidates = [
    ...(await extractKnownProviderUrls(pageUrl, fetchImpl, html)),
    ...extractVideoUrls(html, pageUrl).filter((item) => item.url !== pageUrl),
  ];
  const embedded = candidates.filter((item) => item.kind === "embed").slice(0, 3);
  const resolved = new Set();
  for (const item of embedded) {
    try {
      const page = await fetchNavigationPage(item.url, fetchImpl, true);
      const media = page.directMedia ? [{ url: page.pageUrl, kind: kindForUrl(page.pageUrl), source: "Embedded player" }]
        : extractVideoUrls(page.html, page.pageUrl).filter((result) => result.kind !== "embed" && result.url !== page.pageUrl);
      if (!media.length) continue;
      resolved.add(item.url);
      candidates.push(...media.map((result) => ({ ...result, sourcePage: page.pageUrl })));
    } catch { /* Keep the original embed link if its player cannot be inspected. */ }
  }
  return dedupeCandidates(candidates.filter((item) => !resolved.has(item.url)));
}

function extractDirectoryLinks(html, pageUrl) {
  const rows = [...html.matchAll(/<(?:div|a)\b(?<attrs>[^>]*\bclass\s*=\s*["'][^"']*\bfm-row\b[^"']*["'][^>]*)>/gi)];
  const links = [];
  const seen = new Set();
  for (let index = 0; index < rows.length && links.length < 100; index += 1) {
    const row = rows[index];
    const attrs = parseAttrs(row.groups.attrs);
    const raw = attrs.href || attrs.onclick?.match(/(?:window\.)?location(?:\.href)?\s*=\s*(["'])([^"']+)\1/)?.[2];
    const target = normalizeUrl(raw, pageUrl);
    if (!raw || !target || seen.has(target)) continue;
    const parsed = new URL(target);
    if (parsed.origin !== new URL(pageUrl).origin || !/^\/go\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(parsed.pathname)) continue;
    // The signed token's filename identifies file rows; it never supplies a guessed media URL.
    try {
      const token = parsed.pathname.slice(4).split('.')[0].replaceAll('-', '+').replaceAll('_', '/');
      const bytes = Uint8Array.from(atob(token.padEnd(Math.ceil(token.length / 4) * 4, '=')), (character) => character.charCodeAt(0));
      const metadata = JSON.parse(new TextDecoder().decode(bytes));
      if (typeof metadata.n !== 'string' || !VIDEO_EXTENSIONS.some((extension) => metadata.n.toLowerCase().endsWith(`.${extension}`))) continue;
    } catch { continue; }
    const content = html.slice(row.index, rows[index + 1]?.index || Math.min(html.length, row.index + 65536));
    const imageAttrs = content.match(/<img\b([^>]*)>/i)?.[1];
    const thumbnailUrl = imageAttrs ? normalizeThumbnailUrl(parseAttrs(imageAttrs).src, pageUrl) : '';
    seen.add(target);
    links.push({ url: target, thumbnailUrl });
  }
  return links;
}

async function extractDirectoryVideos(links, fetchImpl) {
  const results = Array.from({ length: links.length }, () => []);
  await Promise.all(Array.from({ length: Math.min(3, links.length) }, async (_, worker) => {
    for (let index = worker; index < links.length; index += 3) {
      const link = links[index];
      try {
        const page = await fetchNavigationPage(link.url, fetchImpl, true);
        const media = page.directMedia ? [{ url: page.pageUrl, kind: kindForUrl(page.pageUrl), source: "Directory player" }]
          : extractVideoUrls(page.html, page.pageUrl).filter((item) => item.kind !== "embed" && item.url !== page.pageUrl);
        results[index] = media.map((item) => ({
          ...item, sourcePage: page.pageUrl,
          ...(!item.thumbnailUrl && link.thumbnailUrl ? { thumbnailUrl: link.thumbnailUrl } : {}),
        }));
      } catch { /* Other public file rows remain usable when one link has expired. */ }
    }
  }));
  return dedupeCandidates(results.flat());
}

export async function extractKnownProviderUrls(pageUrl, fetchImpl = fetch, html = "") {
  const url = new URL(pageUrl);
  const directoryLinks = extractDirectoryLinks(html, pageUrl);
  if (directoryLinks.length) return extractDirectoryVideos(directoryLinks, fetchImpl);
  const gofileResults = await extractGofileUrls(url, pageUrl, fetchImpl);
  if (gofileResults.length) {
    return gofileResults;
  }

  const shortLink = getViloloLikeShortLink(url);
  if (!shortLink) {
    return [];
  }

  const useLocalApi = usesViloloLocalApi(url.hostname) || url.pathname.startsWith("/d/");
  const params = { externalLinks: shortLink, domain: url.hostname };
  let payload = await fetchViloloJson(
    "/flow/land-page/getInfo",
    params,
    fetchImpl,
    useLocalApi,
  );
  let localApi = useLocalApi;
  if (!payload && useLocalApi && !usesViloloLocalApi(url.hostname)) {
    payload = await fetchViloloJson("/flow/land-page/getInfo", params, fetchImpl, false);
    localApi = false;
  }

  if (!payload) {
    return [];
  }

  const currentResults = extractFromJson(payload, pageUrl, "Vilolo media API");
  const relatedResults = await extractViloloRelatedUrls(
    payload,
    url.hostname,
    pageUrl,
    fetchImpl,
    localApi,
  );

  return dedupeCandidates([...currentResults, ...relatedResults]);
}

async function extractGofileUrls(url, pageUrl, fetchImpl) {
  const contentId = getGofileContentId(url);
  if (!contentId) {
    return [];
  }

  const accountPayload = await fetchGofileJson("/accounts", {}, fetchImpl, {
    method: "POST",
  });
  const token = accountPayload?.data?.token;
  if (!token) {
    return [];
  }

  const websiteToken = await generateGofileWebsiteToken(token);
  const payload = await fetchGofileJson(
    `/contents/${encodeURIComponent(contentId)}`,
    {
      contentFilter: "",
      page: "1",
      pageSize: "1000",
      sortField: "name",
      sortDirection: "1",
    },
    fetchImpl,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Website-Token": websiteToken,
        "X-BL": GOFILE_LANGUAGE,
      },
    },
  );

  return dedupeCandidates(extractGofileVideoCandidates(payload, pageUrl));
}

function getGofileContentId(url) {
  if (!GOFILE_PAGE_HOST_RE.test(url.hostname)) {
    return "";
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (pathSegments[0] !== "d" || pathSegments.length !== 2) {
    return "";
  }

  return GOFILE_CONTENT_ID_RE.test(pathSegments[1]) ? pathSegments[1] : "";
}

async function fetchGofileJson(path, params, fetchImpl, options = {}) {
  const apiUrl = new URL(`${GOFILE_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    apiUrl.searchParams.set(key, value);
  });

  const response = await fetchImpl(apiUrl, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      Origin: "https://gofile.io",
      Referer: "https://gofile.io/",
      "User-Agent": PROVIDER_USER_AGENT,
      ...(options.headers || {}),
    },
    redirect: "follow",
  });

  if (!response.ok) {
    return null;
  }

  try {
    const payload = await response.json();
    return payload?.status === "ok" ? payload : null;
  } catch {
    return null;
  }
}

async function generateGofileWebsiteToken(token) {
  const period = Math.floor(Date.now() / 1000 / 14400);
  const raw = `${PROVIDER_USER_AGENT}::${GOFILE_LANGUAGE}::${token}::${period}::${GOFILE_WEBSITE_TOKEN_SALT}`;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function extractGofileVideoCandidates(payload, pageUrl) {
  const candidates = [];
  visitGofileItem(payload?.data);
  return candidates;

  function visitGofileItem(item) {
    if (Array.isArray(item)) {
      item.forEach(visitGofileItem);
      return;
    }

    if (!item || typeof item !== "object") {
      return;
    }

    const children = item.children || item.childs;
    if (children && typeof children === "object") {
      Object.values(children).forEach(visitGofileItem);
    }

    if (item.type !== "file") {
      return;
    }

    const name = typeof item.name === "string" ? item.name : "";
    const mimeType = String(item.mimeType || item.mimetype || "").toLowerCase();
    const url = getGofileItemUrl(item, pageUrl);
    if (!url || (!isVideoLikeGofileItem(url, name, mimeType) && !isVideoFile(url))) {
      return;
    }

    candidates.push({
      url,
      kind: kindForUrl(url),
      source: "Gofile API",
      ...(findThumbnailUrl(item, pageUrl) ? { thumbnailUrl: findThumbnailUrl(item, pageUrl) } : {}),
    });
  }
}

function getGofileItemUrl(item, pageUrl) {
  for (const key of ["directLink", "directlink", "downloadUrl", "downloadURL", "link", "url"]) {
    if (typeof item[key] !== "string") {
      continue;
    }

    const normalized = normalizeUrl(item[key], pageUrl);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function isVideoLikeGofileItem(url, name, mimeType) {
  if (mimeType.startsWith("video/") || mimeType.includes("mpegurl")) {
    return true;
  }

  if (isVideoFile(url)) {
    return true;
  }

  return VIDEO_EXTENSIONS.some((extension) =>
    name.toLowerCase().endsWith(`.${extension}`),
  );
}

function getViloloLikeShortLink(url) {
  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (url.search || url.hash) {
    return "";
  }

  const isKnownViloloHost = VILOLO_PAGE_HOST_RE.test(url.hostname);
  const usesDPath = pathSegments.length === 2 && pathSegments[0] === "d";
  const shortLink = pathSegments.length === 1 ? pathSegments[0] : usesDPath ? pathSegments[1] : "";
  if (!shortLink) {
    return "";
  }

  if (!VILOLO_SHORT_LINK_RE.test(shortLink)) {
    return "";
  }

  if (isKnownViloloHost || (usesDPath && looksLikeShortShareHost(url.hostname))) {
    return shortLink;
  }

  return VILOLO_GENERIC_SHORT_LINK_RE.test(shortLink) &&
    looksLikeShortShareHost(url.hostname)
    ? shortLink
    : "";
}

function looksLikeShortShareHost(hostname) {
  if (!hostname.includes(".")) {
    return false;
  }

  const labels = hostname.toLowerCase().split(".");
  if (labels.some((label) => ["localhost", "local"].includes(label))) {
    return false;
  }

  // Vilolo-like mirrors use compact one-path IDs on ordinary public hosts.
  // The provider API validates the domain/link pair; a miss simply returns no data.
  return labels.length >= 2 && labels.every((label) => /^[a-z0-9-]{1,63}$/.test(label));
}

async function extractViloloRelatedUrls(payload, domain, pageUrl, fetchImpl, localApi) {
  const externalLinks = getNestedValue(payload, [
    "data",
    "info",
    "extraInfo",
    "externalLinks",
  ]);
  if (!externalLinks) {
    return [];
  }

  const sortOrder =
    getNestedValue(payload, ["data", "info", "extraInfo", "sortOrder"]) || "3";
  const relatedPayloads = [];

  for (let pageNo = 1; pageNo <= RELATED_VIDEO_MAX_PAGES; pageNo += 1) {
    const relatedPayload = await fetchViloloJson(
      "/flow/land-page/list_by_links_page",
      {
        externalLinks,
        domain,
        pageNo: String(pageNo),
        pageSize: String(RELATED_VIDEO_PAGE_SIZE),
        sortOrder,
      },
      fetchImpl,
      localApi,
    );

    const items = Array.isArray(relatedPayload?.data?.list)
      ? relatedPayload.data.list
      : [];
    if (!items.length) {
      break;
    }

    relatedPayloads.push(relatedPayload);

    const total = Number(relatedPayload?.data?.total || 0);
    if (total > 0 && pageNo * RELATED_VIDEO_PAGE_SIZE >= total) {
      break;
    }
  }

  return extractFromJson(relatedPayloads, pageUrl, "Vilolo related API")
    .map((result) => ({
      ...result,
      sourcePage: buildViloloLandingPageUrl(domain, result.landingPage, new URL(pageUrl).pathname.startsWith("/d/")) || pageUrl,
    }))
    .map(({ landingPage, ...result }) => result);
}

async function fetchViloloJson(path, params, fetchImpl, localApi = usesViloloLocalApi(params.domain)) {
  const apiUrl = buildViloloApiUrl(path, params.domain, localApi);
  Object.entries(params).forEach(([key, value]) => {
    apiUrl.searchParams.set(key, value);
  });

  try {
    const response = await fetchImpl(apiUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": PAGE_USER_AGENT,
        Origin: `https://${params.domain}`,
        Referer: `https://${params.domain}/`,
      },
      redirect: "manual",
    });
    if (!response.ok) { await response.body?.cancel(); return null; }
    const payload = await response.json();
    fetchImpl.note?.(apiUrl, { providerCode: payload?.code, hasInfo: !!payload?.data?.info });
    return payload?.code === 0 ? payload : null;
  } catch {
    return null;
  }
}

function buildViloloApiUrl(path, domain, localApi) {
  if (localApi) {
    const apiUrl = new URL(`https://${domain}/api.php`);
    apiUrl.searchParams.set("endpoint", path);
    return apiUrl;
  }

  return new URL(`${VILOLO_API_BASE}${path}`);
}

function getNestedValue(value, path) {
  return path.reduce((current, key) => current?.[key], value) || "";
}

function buildViloloLandingPageUrl(domain, landingPage, dPath = false) {
  if (!landingPage) {
    return "";
  }

  if (usesViloloDPath(domain) || dPath || /^\/?d\//.test(landingPage)) {
    const path = String(landingPage).replace(/^\/+/, "");
    const id = path.startsWith("d/") ? path.slice(2) : path;
    return `https://${domain}/d/${encodeURIComponent(id)}`;
  }

  return `https://${domain}/${encodeURIComponent(landingPage)}`;
}

function usesViloloDPath(domain) {
  return domain === "twimg.com.pl";
}

function usesViloloLocalApi(domain) {
  return domain === "twimg.com.pl";
}

export function extractLinkedPageUrls(html, pageUrl, limit = 8) {
  const links = [];
  const seen = new Set([new URL(pageUrl).toString()]);

  for (const match of html.matchAll(ANCHOR_RE)) {
    const attrs = parseAttrs(match.groups.attrs || "");
    const linkedUrl = normalizeUrl(attrs.href, pageUrl);
    if (!linkedUrl || seen.has(linkedUrl) || shouldSkipLinkedPage(linkedUrl)) {
      continue;
    }

    try {
      validatePageUrl(linkedUrl);
    } catch {
      continue;
    }

    seen.add(linkedUrl);
    links.push(linkedUrl);
    if (links.length >= limit) {
      break;
    }
  }

  return links;
}

function dedupeCandidates(candidates) {
  const deduped = new Map();

  for (const candidate of candidates) {
    if (shouldIgnoreExtractedVideoUrl(candidate.url)) {
      continue;
    }

    if (!deduped.has(candidate.url)) {
      deduped.set(candidate.url, candidate);
      continue;
    }

    const existing = deduped.get(candidate.url);
    deduped.set(candidate.url, {
      ...existing,
      ...Object.fromEntries(
        Object.entries(candidate).filter(([, value]) => value && value !== ""),
      ),
    });
  }

  return removeLowerPriorityThumbnailDuplicates([...deduped.values()]);
}

function removeLowerPriorityThumbnailDuplicates(candidates) {
  const candidatesByThumbnail = new Map();
  candidates.forEach((candidate) => {
    if (!candidate.thumbnailUrl) {
      return;
    }

    const key = candidate.thumbnailUrl;
    const group = candidatesByThumbnail.get(key) || [];
    group.push(candidate);
    candidatesByThumbnail.set(key, group);
  });

  const urlsToDrop = new Set();
  for (const group of candidatesByThumbnail.values()) {
    const hasPlayableHls = group.some((candidate) => candidate.kind === "hls");
    if (!hasPlayableHls) {
      continue;
    }

    group
      .filter((candidate) => candidate.kind === "file")
      .filter((candidate) => isLikelyPageDisguisedAsVideo(candidate.url))
      .forEach((candidate) => urlsToDrop.add(candidate.url));
  }

  return candidates.filter((candidate) => !urlsToDrop.has(candidate.url));
}

function extractFromTags(html, pageUrl) {
  const candidates = [];

  for (const match of html.matchAll(TAG_RE)) {
    const tag = match.groups.tag.toLowerCase();
    const attrs = parseAttrs(match.groups.attrs || "");
    const type = (attrs.type || "").toLowerCase();
    const thumbnailUrl =
      tag === "video" ? normalizeThumbnailUrl(attrs.poster, pageUrl) : null;
    const isDirectMediaTag =
      tag === "video" ||
      (tag === "source" &&
        (type.startsWith("video/") || type.includes("mpegurl") || type === ""));
    const isEmbedTag = ["iframe", "embed", "object"].includes(tag);

    for (const attr of MEDIA_ATTRS) {
      const value = attrs[attr];
      if (!value) continue;

      const normalized = normalizeUrl(value, pageUrl);
      if (!normalized) continue;
      if (shouldIgnoreExtractedVideoUrl(normalized)) continue;

      if (
        isVideoFile(normalized) ||
        isDirectMediaTag ||
        (isEmbedTag && ["src", "data", "data-src", "data-url"].includes(attr))
      ) {
        candidates.push({
          url: normalized,
          kind: isVideoFile(normalized) ? kindForUrl(normalized) : "embed",
          source: `<${tag}> ${attr}`,
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
        });
      }
    }
  }

  return candidates;
}

function extractFromJson(value, pageUrl, source) {
  const candidates = [];
  const seen = new Set();
  visitJson(value, "", "");
  return candidates;

  function visitJson(item, inheritedThumbnailUrl, inheritedLandingPage, key = "") {
    if (typeof item === "string") {
      if (!isMediaUrlValue(item, key)) {
        return;
      }

      const normalized = normalizeUrl(item, pageUrl);
      if (
        normalized &&
        isVideoFile(normalized) &&
        !shouldIgnoreExtractedVideoUrl(normalized) &&
        !seen.has(normalized)
      ) {
        seen.add(normalized);
        candidates.push({
          url: normalized,
          kind: kindForUrl(normalized),
          source,
          ...(inheritedThumbnailUrl
            ? { thumbnailUrl: inheritedThumbnailUrl }
            : {}),
          ...(inheritedLandingPage ? { landingPage: inheritedLandingPage } : {}),
        });
      }
      return;
    }

    if (Array.isArray(item)) {
      item.forEach((child) =>
        visitJson(child, inheritedThumbnailUrl, inheritedLandingPage, key),
      );
      return;
    }

    if (item && typeof item === "object") {
      const thumbnailUrl = findThumbnailUrl(item, pageUrl) || inheritedThumbnailUrl;
      const landingPage =
        typeof item.landingPage === "string"
          ? item.landingPage
          : inheritedLandingPage;
      Object.entries(item).forEach(([childKey, child]) =>
        visitJson(child, thumbnailUrl, landingPage, childKey),
      );
    }
  }
}

function isMediaUrlValue(value, key) {
  // Provider metadata often contains names such as "movie.mp4". Resolving
  // these against the share page invents a file URL that does not exist.
  if (/^(?:name|title|description|(?:original)?file_?name|original_?name)$/i.test(key)) {
    return false;
  }

  return (
    /^(?:https?:\/\/|\/|\.\.?\/)/i.test(value.trim()) ||
    /(?:url|uri|src)$|^(?:file|video|hls|m3u8|source)$/i.test(key)
  );
}

function findThumbnailUrl(item, pageUrl) {
  for (const [key, value] of Object.entries(item)) {
    if (!THUMBNAIL_KEYS.includes(key.toLowerCase()) || typeof value !== "string") {
      continue;
    }

    const normalized = normalizeThumbnailUrl(value, pageUrl);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function extractFromText(html, pageUrl) {
  const candidates = [];
  const searchable = decodeHtmlEntities(html)
    .replaceAll("\\/", "/")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u002f", "/");

  for (const regex of [ABSOLUTE_VIDEO_RE, RELATIVE_VIDEO_RE]) {
    for (const match of searchable.matchAll(regex)) {
      const normalized = normalizeUrl(match[1], pageUrl);
      if (
        !normalized ||
        !isVideoFile(normalized) ||
        shouldIgnoreExtractedVideoUrl(normalized)
      ) {
        continue;
      }

      candidates.push({
        url: normalized,
        kind: kindForUrl(normalized),
        source: "HTML text scan",
      });
    }
  }

  return candidates;
}

function parseAttrs(rawAttrs) {
  const attrs = {};

  for (const match of rawAttrs.matchAll(ATTR_RE)) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(
      match[3] ?? match[4] ?? match[5] ?? "",
    );
  }

  return attrs;
}

export function normalizeUrl(rawValue, pageUrl) {
  let value = decodeHtmlEntities(String(rawValue || ""))
    .trim()
    .replaceAll("\\/", "/")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u002f", "/")
    .replace(/^url\((.*)\)$/i, "$1")
    .trim()
    .replace(/^[ "'`]+|[ "'`]+$/g, "")
    .replace(/[.,;:)\]}"']+$/g, "");

  if (!value) return null;
  if (/^(data|blob|javascript|mailto|tel):/i.test(value)) return null;

  try {
    if (value.startsWith("//")) {
      return `${new URL(pageUrl).protocol}${value}`;
    }

    return new URL(value, pageUrl).toString();
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isVideoFile(url) {
  const path = new URL(url).pathname.toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => path.endsWith(`.${extension}`));
}

function normalizeThumbnailUrl(rawValue, pageUrl) {
  const normalized = normalizeUrl(rawValue, pageUrl);
  if (!normalized) return "";

  const path = new URL(normalized).pathname.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => path.endsWith(`.${extension}`)) || /\/(?:thumb(?:nail)?|cover|poster)\.php$/i.test(path)
    ? normalized
    : "";
}

function shouldSkipLinkedPage(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) return true;

  const extension = parsed.pathname.split(".").pop()?.toLowerCase() || "";
  return NON_PAGE_EXTENSIONS.includes(extension);
}

function shouldIgnoreExtractedVideoUrl(url) {
  return isLikelyPageDisguisedAsVideo(url);
}

function isLikelyPageDisguisedAsVideo(url) {
  try {
    return NON_PLAYABLE_VIDEO_PAGE_HOST_RE.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function kindForUrl(url) {
  return isHlsUrl(url) ? "hls" : "file";
}

function sanitizeFileName(value) {
  const cleaned = String(value || "video").replace(/[\\/:*?"<>|]/g, "_");
  return cleaned || "video";
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
