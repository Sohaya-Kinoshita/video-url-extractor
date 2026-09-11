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
  /^(video\.twimg-image\.com|video\.twimgx\.com|cdn\d+\.(mvfile\.com|twimg-media\.com|image-share\.cc))$/;
const VILOLO_SHORT_LINK_RE = /^[A-Za-z0-9_-]{4,64}$/;
const VILOLO_GENERIC_SHORT_LINK_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{4,64}$/;
const VILOLO_API_BASE = "https://rwzugqnp.fun800.click/app-api";
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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
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
  };
}

export async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; VideoURLExtractor/1.0; +https://pages.dev)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw httpError(`取得先ページがHTTP ${response.status} を返しました。`, 502);
  }

  const contentType = response.headers.get("content-type") || "";
  if (
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw httpError("HTMLページのURLを入力してください。", 400);
  }

  const html = await response.text();
  if (html.length > MAX_HTML_CHARS) {
    throw httpError("HTMLが大きすぎるため解析を中止しました。", 400);
  }

  return {
    html,
    pageUrl: response.url || url,
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

export async function extractKnownProviderUrls(pageUrl, fetchImpl = fetch) {
  const url = new URL(pageUrl);
  const shortLink = getViloloLikeShortLink(url);
  if (!shortLink) {
    return [];
  }

  const payload = await fetchViloloJson(
    "/flow/land-page/getInfo",
    {
      externalLinks: shortLink,
      domain: url.hostname,
    },
    fetchImpl,
  );

  if (!payload) {
    return [];
  }

  const currentResults = extractFromJson(payload, pageUrl, "Vilolo media API");
  const relatedResults = await extractViloloRelatedUrls(
    payload,
    url.hostname,
    pageUrl,
    fetchImpl,
  );

  return dedupeCandidates([...currentResults, ...relatedResults]);
}

function getViloloLikeShortLink(url) {
  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (pathSegments.length !== 1 || url.search || url.hash) {
    return "";
  }

  const shortLink = pathSegments[0];
  if (!VILOLO_SHORT_LINK_RE.test(shortLink)) {
    return "";
  }

  if (VILOLO_PAGE_HOST_RE.test(url.hostname)) {
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

async function extractViloloRelatedUrls(payload, domain, pageUrl, fetchImpl) {
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
      sourcePage: buildViloloLandingPageUrl(domain, result.landingPage) || pageUrl,
    }))
    .map(({ landingPage, ...result }) => result);
}

async function fetchViloloJson(path, params, fetchImpl) {
  const apiUrl = new URL(`${VILOLO_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    apiUrl.searchParams.set(key, value);
  });

  const response = await fetchImpl(apiUrl, {
    headers: { Accept: "application/json" },
    redirect: "follow",
  });

  if (!response.ok) {
    return null;
  }

  try {
    const payload = await response.json();
    return payload?.code === 0 ? payload : null;
  } catch {
    return null;
  }
}

function getNestedValue(value, path) {
  return path.reduce((current, key) => current?.[key], value) || "";
}

function buildViloloLandingPageUrl(domain, landingPage) {
  if (!landingPage) {
    return "";
  }

  return `https://${domain}/${encodeURIComponent(landingPage)}`;
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

  return [...deduped.values()];
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

  function visitJson(item, inheritedThumbnailUrl, inheritedLandingPage) {
    if (typeof item === "string") {
      const normalized = normalizeUrl(item, pageUrl);
      if (normalized && isVideoFile(normalized) && !seen.has(normalized)) {
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
        visitJson(child, inheritedThumbnailUrl, inheritedLandingPage),
      );
      return;
    }

    if (item && typeof item === "object") {
      const thumbnailUrl = findThumbnailUrl(item, pageUrl) || inheritedThumbnailUrl;
      const landingPage =
        typeof item.landingPage === "string"
          ? item.landingPage
          : inheritedLandingPage;
      Object.values(item).forEach((child) =>
        visitJson(child, thumbnailUrl, landingPage),
      );
    }
  }
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
      if (!normalized || !isVideoFile(normalized)) continue;

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
  return IMAGE_EXTENSIONS.some((extension) => path.endsWith(`.${extension}`))
    ? normalized
    : "";
}

function shouldSkipLinkedPage(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) return true;

  const extension = parsed.pathname.split(".").pop()?.toLowerCase() || "";
  return NON_PAGE_EXTENSIONS.includes(extension);
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
