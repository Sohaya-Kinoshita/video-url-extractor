import {
  getDownloadFileName,
  getTransportStreamFileName,
  isHlsUrl,
  parseHlsPlaylist,
  validateDownloadUrl,
} from "../../src/extractor.js";

const MAX_HLS_SEGMENTS = 300;

export async function onRequestGet({ request }) {
  try {
    const requestUrl = new URL(request.url);
    const targetUrl = validateDownloadUrl(requestUrl.searchParams.get("url"));

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
  const segmentUrls = await getHlsSegmentUrls(targetUrl);

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

async function getHlsSegmentUrls(targetUrl) {
  const masterResponse = await fetch(targetUrl, {
    headers: { Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*" },
  });

  if (!masterResponse.ok) {
    throw new Error("HLSプレイリストの取得に失敗しました。");
  }

  let playlistUrl = targetUrl;
  let playlist = parseHlsPlaylist(await masterResponse.text(), playlistUrl);

  if (playlist.variants.length) {
    playlistUrl = playlist.variants[0].url;
    const mediaResponse = await fetch(playlistUrl, {
      headers: { Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*" },
    });

    if (!mediaResponse.ok) {
      throw new Error("HLS動画情報の取得に失敗しました。");
    }

    playlist = parseHlsPlaylist(await mediaResponse.text(), playlistUrl);
  }

  return playlist.segments;
}
