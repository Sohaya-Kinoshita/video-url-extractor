const VIDEO_EXTENSIONS = ["mp4", "m3u8", "webm", "mov", "m4v", "ogv"];
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

const TAG_RE = /<(?<tag>video|source|iframe|embed|object|meta|link)\b(?<attrs>[^>]*)>/gi;
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

function extractFromTags(html, pageUrl) {
  const candidates = [];

  for (const match of html.matchAll(TAG_RE)) {
    const tag = match.groups.tag.toLowerCase();
    const attrs = parseAttrs(match.groups.attrs || "");
    const type = (attrs.type || "").toLowerCase();
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
        });
      }
    }
  }

  return candidates;
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

function kindForUrl(url) {
  return new URL(url).pathname.toLowerCase().endsWith(".m3u8") ? "hls" : "file";
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
