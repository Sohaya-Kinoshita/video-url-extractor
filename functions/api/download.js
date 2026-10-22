import {
  getDownloadFileName,
  getTransportStreamFileName,
  isHlsUrl,
  parseHlsPlaylist,
  validateDownloadUrl,
  validatePageUrl,
  jsonResponse,
} from "../../src/extractor.js";

const MAX_HLS_SEGMENTS = 300;

export async function onRequestGet({ request }) {
  try {
    const requestUrl = new URL(request.url);
    const mode = requestUrl.searchParams.get("mode");
    if (mode === "segment") {
      return await downloadSegment(requestUrl.searchParams.get("url"));
    }
    const targetUrl = validateDownloadUrl(requestUrl.searchParams.get("url"));

    if (mode === "manifest") {
      if (!isHlsUrl(targetUrl)) {
        return new Response("HLS動画のURLを指定してください。", { status: 400 });
      }
      const { segments, duration } = await getHlsPlaylist(targetUrl, true);
      if (!segments.length || segments.length > MAX_HLS_SEGMENTS || duration <= 0) {
        return new Response("この動画の長さはMP4変換に対応していません。", { status: 400 });
      }
      segments.forEach((url) => validateSegmentUrl(url));
      return jsonResponse({
        segments,
        duration,
        fileName: getDownloadFileName(targetUrl).replace(/\.m3u8$/i, ".mp4"),
      });
    }

    if (isHlsUrl(targetUrl)) {
      return await downloadHlsAsTransportStream(targetUrl);
    }

    const response = await fetch(targetUrl, {
      headers: {
        Accept: "video/*,application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
      },
      redirect: "follow",
    });

    if (!response.ok || !response.body) {
      return new Response("ファイルの取得に失敗しました。", { status: 502 });
    }

    const headers = new Headers(response.headers);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${getDownloadFileName(targetUrl)}"`,
    );
    headers.set("Cache-Control", "no-store");
    headers.delete("Content-Encoding");
    headers.delete("Content-Length");

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    return new Response(error.message || "保存用URLを確認できませんでした。", {
      status: error.status || 400,
    });
  }
}

async function downloadHlsAsTransportStream(targetUrl) {
  const { segments: segmentUrls } = await getHlsPlaylist(targetUrl);

  if (!segmentUrls.length) {
    return new Response("保存できる動画セグメントが見つかりませんでした。", {
      status: 400,
    });
  }

  if (segmentUrls.length > MAX_HLS_SEGMENTS) {
    return new Response("動画が長すぎるため、この保存方式では対応できません。", {
      status: 400,
    });
  }

  let index = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (index >= segmentUrls.length) {
        controller.close();
        return;
      }

      const segmentResponse = await fetch(segmentUrls[index]);
      index += 1;

      if (!segmentResponse.ok || !segmentResponse.body) {
        controller.error(new Error("動画セグメントの取得に失敗しました。"));
        return;
      }

      const reader = segmentResponse.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        controller.enqueue(value);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "video/mp2t",
      "Content-Disposition": `attachment; filename="${getTransportStreamFileName(targetUrl)}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function getHlsPlaylist(targetUrl, forMp4 = false) {
  const masterResponse = await fetchPublicMedia(targetUrl, {
    headers: { Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*" },
  });

  if (!masterResponse.ok) {
    throw new Error("HLSプレイリストの取得に失敗しました。");
  }

  let playlistUrl = masterResponse.url || targetUrl;
  let text = await masterResponse.text();
  let playlist = parseHlsPlaylist(text, playlistUrl);

  if (playlist.variants.length) {
    playlistUrl = playlist.variants[0].url;
    const mediaResponse = await fetchPublicMedia(playlistUrl, {
      headers: { Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*" },
    });

    if (!mediaResponse.ok) {
      throw new Error("HLS動画情報の取得に失敗しました。");
    }

    playlistUrl = mediaResponse.url || playlistUrl;
    text = await mediaResponse.text();
    playlist = parseHlsPlaylist(text, playlistUrl);
  }

  if (forMp4 && (!text.includes("#EXT-X-ENDLIST") || /#EXT-X-(?:DISCONTINUITY|BYTERANGE)(?::|\s|$)/m.test(text))) {
    throw new Error("このHLS形式はMP4変換に対応していません。元のURLから開いてください。");
  }

  return playlist;
}

function validateSegmentUrl(value) {
  const url = validatePageUrl(value);
  if (!new URL(url).pathname.toLowerCase().endsWith(".ts")) {
    throw new Error("この動画形式はMP4変換に対応していません。");
  }
  return url;
}

async function downloadSegment(value) {
  const response = await fetchPublicMedia(validateSegmentUrl(value));
  if (!response.ok || !response.body || /(?:text\/html|application\/json)/i.test(response.headers.get("Content-Type") || "")) {
    await response.body?.cancel();
    return new Response("動画データの取得に失敗しました。", { status: 502 });
  }
  return new Response(response.body, {
    headers: { "Content-Type": "video/mp2t", "Cache-Control": "no-store" },
  });
}

async function fetchPublicMedia(value, options = {}) {
  let url = validatePageUrl(value);
  for (let redirects = 0; redirects < 5; redirects += 1) {
    const response = await fetch(url, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("Location");
    await response.body?.cancel();
    if (!location) throw new Error("配信先のURLを確認できませんでした。");
    url = validatePageUrl(new URL(location, url).toString());
  }
  throw new Error("動画の転送回数が多すぎます。");
}
