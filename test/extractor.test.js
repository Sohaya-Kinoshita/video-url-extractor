import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractKnownProviderUrls,
  extractLinkedPageUrls,
  extractVideoUrls,
  getDownloadFileName,
  getTransportStreamFileName,
  parseHlsPlaylist,
  normalizeUrl,
  validateDownloadUrl,
  validatePageUrl,
} from "../src/extractor.js";

describe("extractVideoUrls", () => {
  it("extracts video and source URLs", () => {
    const html = `
      <video src="/media/clip.mp4"></video>
      <video>
        <source src="https://cdn.example.com/live/stream.m3u8?token=abc" />
      </video>
    `;

    const urls = new Set(
      extractVideoUrls(html, "https://example.com/watch/1").map((item) => item.url),
    );

    assert.ok(urls.has("https://example.com/media/clip.mp4"));
    assert.ok(urls.has("https://cdn.example.com/live/stream.m3u8?token=abc"));
  });

  it("extracts escaped URLs from inline JSON", () => {
    const html = `
      <script>
        window.__PLAYER__ = {"file":"https:\\/\\/cdn.example.com\\/movie\\/index.m3u8"};
      </script>
    `;

    assert.deepEqual(extractVideoUrls(html, "https://example.com/page"), [
      {
        url: "https://cdn.example.com/movie/index.m3u8",
        kind: "hls",
        source: "HTML text scan",
      },
    ]);
  });

  it("extracts embed URLs", () => {
    const html = '<iframe src="https://player.example.com/embed/123"></iframe>';

    assert.deepEqual(extractVideoUrls(html, "https://example.com/page"), [
      {
        url: "https://player.example.com/embed/123",
        kind: "embed",
        source: "<iframe> src",
      },
    ]);
  });

  it("extracts video poster thumbnails", () => {
    const html = '<video src="/movie.mp4" poster="/thumb.webp"></video>';

    assert.deepEqual(extractVideoUrls(html, "https://example.com/page"), [
      {
        url: "https://example.com/movie.mp4",
        kind: "file",
        source: "<video> src",
        thumbnailUrl: "https://example.com/thumb.webp",
      },
    ]);
  });
});

describe("normalizeUrl", () => {
  it("resolves relative URLs", () => {
    assert.equal(
      normalizeUrl("../movie/video.mp4", "https://example.com/posts/1"),
      "https://example.com/movie/video.mp4",
    );
  });
});

describe("validatePageUrl", () => {
  it("rejects private URLs", () => {
    assert.throws(() => validatePageUrl("http://127.0.0.1:8000"), /公開Webページ/);
  });
});

describe("validateDownloadUrl", () => {
  it("allows video file URLs", () => {
    assert.equal(
      validateDownloadUrl("https://example.com/media/video.m3u8"),
      "https://example.com/media/video.m3u8",
    );
  });

  it("rejects non-video file URLs", () => {
    assert.throws(
      () => validateDownloadUrl("https://example.com/index.html"),
      /保存できる動画URL/,
    );
  });
});

describe("getDownloadFileName", () => {
  it("returns a safe file name", () => {
    assert.equal(
      getDownloadFileName("https://example.com/media/bad:name.mp4?token=1"),
      "bad_name.mp4",
    );
  });
});

describe("getTransportStreamFileName", () => {
  it("uses a ts extension", () => {
    assert.equal(
      getTransportStreamFileName("https://example.com/media/playlist.m3u8"),
      "playlist.ts",
    );
  });
});

describe("parseHlsPlaylist", () => {
  it("chooses variants by bandwidth", () => {
    const playlist = parseHlsPlaylist(
      `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000
low/video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000
high/video.m3u8`,
      "https://example.com/master.m3u8",
    );

    assert.deepEqual(playlist.variants, [
      { url: "https://example.com/high/video.m3u8", bandwidth: 2000 },
      { url: "https://example.com/low/video.m3u8", bandwidth: 1000 },
    ]);
  });

  it("extracts segment URLs", () => {
    const playlist = parseHlsPlaylist(
      `#EXTM3U
#EXTINF:4,
video0.ts
#EXTINF:4,
video1.ts`,
      "https://example.com/720p/video.m3u8",
    );

    assert.deepEqual(playlist.segments, [
      "https://example.com/720p/video0.ts",
      "https://example.com/720p/video1.ts",
    ]);
  });
});

describe("extractLinkedPageUrls", () => {
  it("extracts page links while skipping files", () => {
    const html = `
      <a href="/watch/1">watch</a>
      <a href="https://example.com/movie.mp4">file</a>
      <a href="javascript:void(0)">bad</a>
      <a href="https://cdn4.mvfile.com/WuSf1I">mvfile</a>
    `;

    assert.deepEqual(extractLinkedPageUrls(html, "https://example.com/start"), [
      "https://example.com/watch/1",
      "https://cdn4.mvfile.com/WuSf1I",
    ]);
  });
});

describe("extractKnownProviderUrls", () => {
  it("extracts Vilolo media URLs from the provider API", async () => {
    const results = await extractKnownProviderUrls(
      "https://video.twimg-image.com/jVU9c2",
      async (url) => {
        assert.equal(
          url.toString(),
          "https://rwzugqnp.fun800.click/app-api/flow/land-page/getInfo?externalLinks=jVU9c2&domain=video.twimg-image.com",
        );

        return Response.json({
          code: 0,
          data: {
            info: {
              netDiskInfo: {
                fileUrl:
                  "https://vid.fun800.click/43098c0d-6208-4c1e-bea2-261779f50104/playlist.m3u8",
                previewUrl:
                  "https://vid.fun800.click/43098c0d-6208-4c1e-bea2-261779f50104/preview.webp",
              },
            },
          },
        });
      },
    );

    assert.deepEqual(results, [
      {
        url: "https://vid.fun800.click/43098c0d-6208-4c1e-bea2-261779f50104/playlist.m3u8",
        kind: "hls",
        source: "Vilolo media API",
        thumbnailUrl:
          "https://vid.fun800.click/43098c0d-6208-4c1e-bea2-261779f50104/preview.webp",
      },
    ]);
  });

  it("supports mvfile pages reached from t.co redirects", async () => {
    const results = await extractKnownProviderUrls(
      "https://cdn4.mvfile.com/WuSf1I",
      async (url) => {
        assert.equal(
          url.toString(),
          "https://rwzugqnp.fun800.click/app-api/flow/land-page/getInfo?externalLinks=WuSf1I&domain=cdn4.mvfile.com",
        );

        return Response.json({
          code: 0,
          data: {
            info: {
              netDiskInfo: {
                fileUrl:
                  "https://vid.fun800.click/d804fec8-bce5-45c1-a604-58a58ff11bda/playlist.m3u8",
                coverImage:
                  "https://vid.fun800.click/net-disk-cover/20260907/2ea94d08-e265-4984-aa8c-644db339aad4.jpg",
              },
            },
          },
        });
      },
    );

    assert.deepEqual(results, [
      {
        url: "https://vid.fun800.click/d804fec8-bce5-45c1-a604-58a58ff11bda/playlist.m3u8",
        kind: "hls",
        source: "Vilolo media API",
        thumbnailUrl:
          "https://vid.fun800.click/net-disk-cover/20260907/2ea94d08-e265-4984-aa8c-644db339aad4.jpg",
      },
    ]);
  });
});
