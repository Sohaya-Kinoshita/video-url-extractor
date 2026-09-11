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

  it("ignores page URLs disguised as video files", () => {
    const html = `
      <a href="https://gofile.rocks/%E8%8B%A5%E3%81%84%E3%82%AB%E3%83%83%E3%83%97%E3%83%AB%E3%81%AE%E6%97%A5%E5%B8%B8%20(18).mp4">fake file</a>
      <a href="https://vid.fun800.click/9c078a92-e070-44c8-8656-a649a433450a/playlist.m3u8">hls</a>
    `;

    assert.deepEqual(extractVideoUrls(html, "https://example.com/page"), [
      {
        url: "https://vid.fun800.click/9c078a92-e070-44c8-8656-a649a433450a/playlist.m3u8",
        kind: "hls",
        source: "<a> href",
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

  it("decodes percent-encoded file names", () => {
    assert.equal(
      getDownloadFileName(
        "https://cdn1.twimg-media.com/%E5%90%8C%E3%81%98JK%20%E9%81%95%E3%81%86%E3%82%B7%E3%83%BC%E3%83%B3%E3%81%A7%E8%87%AA%E6%92%AE%E3%82%8A%20(13).mov",
      ),
      "同じJK 違うシーンで自撮り (13).mov",
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
  it("extracts public Gofile video links from folder contents", async () => {
    const requests = [];
    const results = await extractKnownProviderUrls(
      "https://gofile.io/d/65pGBWhc",
      async (url, options = {}) => {
        requests.push({
          url: url.toString(),
          method: options.method || "GET",
          headers: options.headers || {},
        });

        if (url.pathname === "/accounts") {
          return Response.json({
            status: "ok",
            data: {
              token: "guest-token",
            },
          });
        }

        return Response.json({
          status: "ok",
          data: {
            type: "folder",
            children: {
              video: {
                type: "file",
                name: "movie without extension",
                mimeType: "video/mp4",
                link: "https://store1.gofile.io/download/direct-video",
                thumbnail: "https://store1.gofile.io/thumbs/direct-video.webp",
              },
              document: {
                type: "file",
                name: "notes.pdf",
                mimeType: "application/pdf",
                link: "https://store1.gofile.io/download/notes.pdf",
              },
              nestedFolder: {
                type: "folder",
                childs: {
                  nestedVideo: {
                    type: "file",
                    name: "nested.mov",
                    mimeType: "application/octet-stream",
                    link: "https://store1.gofile.io/download/nested-file",
                  },
                },
              },
            },
          },
        });
      },
    );

    assert.equal(requests[0].url, "https://api.gofile.io/accounts");
    assert.equal(requests[0].method, "POST");
    assert.equal(
      requests[1].url,
      "https://api.gofile.io/contents/65pGBWhc?contentFilter=&page=1&pageSize=1000&sortField=name&sortDirection=1",
    );
    assert.equal(requests[1].headers.Authorization, "Bearer guest-token");
    assert.match(requests[1].headers["X-Website-Token"], /^[a-f0-9]{64}$/);
    assert.equal(requests[1].headers["X-BL"], "en-US");

    assert.deepEqual(results, [
      {
        url: "https://store1.gofile.io/download/direct-video",
        kind: "file",
        source: "Gofile API",
        thumbnailUrl: "https://store1.gofile.io/thumbs/direct-video.webp",
      },
      {
        url: "https://store1.gofile.io/download/nested-file",
        kind: "file",
        source: "Gofile API",
      },
    ]);
  });

  it("ignores non-Gofile pages when checking Gofile support", async () => {
    const requestedUrls = [];
    const results = await extractKnownProviderUrls(
      "https://example.com/d/65pGBWhc",
      async (url) => {
        requestedUrls.push(url.toString());
        return Response.json({ status: "ok" });
      },
    );

    assert.deepEqual(requestedUrls, []);
    assert.deepEqual(results, []);
  });

  it("extracts Vilolo media URLs from the provider API", async () => {
    const requestedUrls = [];
    const results = await extractKnownProviderUrls(
      "https://video.twimg-image.com/jVU9c2",
      async (url) => {
        requestedUrls.push(url.toString());

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

    assert.deepEqual(requestedUrls, [
      "https://rwzugqnp.fun800.click/app-api/flow/land-page/getInfo?externalLinks=jVU9c2&domain=video.twimg-image.com",
    ]);

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

  it("keeps the playable HLS when a provider payload also contains a fake same-thumbnail file URL", async () => {
    const results = await extractKnownProviderUrls(
      "https://video.twimg-image.com/jVU9c2",
      async () =>
        Response.json({
          code: 0,
          data: {
            info: {
              netDiskInfo: {
                fileUrl:
                  "https://vid.fun800.click/9c078a92-e070-44c8-8656-a649a433450a/playlist.m3u8",
                originalUrl:
                  "https://gofile.rocks/%E8%8B%A5%E3%81%84%E3%82%AB%E3%83%83%E3%83%97%E3%83%AB%E3%81%AE%E6%97%A5%E5%B8%B8%20(18).mp4",
                coverImage:
                  "https://vid.fun800.click/9c078a92-e070-44c8-8656-a649a433450a/preview.webp",
              },
            },
          },
        }),
    );

    assert.deepEqual(results, [
      {
        url: "https://vid.fun800.click/9c078a92-e070-44c8-8656-a649a433450a/playlist.m3u8",
        kind: "hls",
        source: "Vilolo media API",
        thumbnailUrl:
          "https://vid.fun800.click/9c078a92-e070-44c8-8656-a649a433450a/preview.webp",
      },
    ]);
  });

  it("supports mvfile pages reached from t.co redirects", async () => {
    const requestedUrls = [];
    const results = await extractKnownProviderUrls(
      "https://cdn4.mvfile.com/WuSf1I",
      async (url) => {
        requestedUrls.push(url.toString());

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

    assert.deepEqual(requestedUrls, [
      "https://rwzugqnp.fun800.click/app-api/flow/land-page/getInfo?externalLinks=WuSf1I&domain=cdn4.mvfile.com",
    ]);

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

  it("supports similar Vilolo hostnames", async () => {
    const cases = [
      {
        pageUrl: "https://video.twimgx.com/5eiIv3",
        apiUrl:
          "https://rwzugqnp.fun800.click/app-api/flow/land-page/getInfo?externalLinks=5eiIv3&domain=video.twimgx.com",
      },
      {
        pageUrl: "https://cdn1.twimg-media.com/a1jzNI",
        apiUrl:
          "https://rwzugqnp.fun800.click/app-api/flow/land-page/getInfo?externalLinks=a1jzNI&domain=cdn1.twimg-media.com",
      },
      {
        pageUrl: "https://cdn2.image-share.cc/9aZhBN",
        apiUrl:
          "https://rwzugqnp.fun800.click/app-api/flow/land-page/getInfo?externalLinks=9aZhBN&domain=cdn2.image-share.cc",
      },
    ];

    for (const item of cases) {
      const requests = [];
      const results = await extractKnownProviderUrls(item.pageUrl, async (url) => {
        requests.push(url.toString());
        return Response.json({
          code: 0,
          data: {
            info: {
              netDiskInfo: {
                fileUrl: "https://vid.fun800.click/example/playlist.m3u8",
                coverImage: "https://vid.fun800.click/example/thumbnail.jpg",
              },
            },
          },
        });
      });

      assert.deepEqual(requests, [item.apiUrl]);
      assert.deepEqual(results, [
        {
          url: "https://vid.fun800.click/example/playlist.m3u8",
          kind: "hls",
          source: "Vilolo media API",
          thumbnailUrl: "https://vid.fun800.click/example/thumbnail.jpg",
        },
      ]);
    }
  });

  it("tries the provider API for unknown hosts with a similar short-link structure", async () => {
    const requestedUrls = [];
    const results = await extractKnownProviderUrls(
      "https://cdn9.example-mirror.net/XyZ_123",
      async (url) => {
        requestedUrls.push(url.toString());
        return Response.json({
          code: 0,
          data: {
            info: {
              netDiskInfo: {
                fileUrl: "https://vid.fun800.click/mirror/playlist.m3u8",
                previewUrl: "https://vid.fun800.click/mirror/preview.webp",
              },
            },
          },
        });
      },
    );

    assert.deepEqual(requestedUrls, [
      "https://rwzugqnp.fun800.click/app-api/flow/land-page/getInfo?externalLinks=XyZ_123&domain=cdn9.example-mirror.net",
    ]);

    assert.deepEqual(results, [
      {
        url: "https://vid.fun800.click/mirror/playlist.m3u8",
        kind: "hls",
        source: "Vilolo media API",
        thumbnailUrl: "https://vid.fun800.click/mirror/preview.webp",
      },
    ]);
  });

  it("does not call the provider API for ordinary multi-segment pages", async () => {
    const requestedUrls = [];
    const results = await extractKnownProviderUrls(
      "https://example.com/watch/video-123",
      async (url) => {
        requestedUrls.push(url.toString());
        return Response.json({ code: 0 });
      },
    );

    assert.deepEqual(requestedUrls, []);
    assert.deepEqual(results, []);
  });

  it("does not call the provider API for common short word pages on unknown hosts", async () => {
    const requestedUrls = [];
    const results = await extractKnownProviderUrls(
      "https://example.com/about",
      async (url) => {
        requestedUrls.push(url.toString());
        return Response.json({ code: 0 });
      },
    );

    assert.deepEqual(requestedUrls, []);
    assert.deepEqual(results, []);
  });

  it("extracts related videos from the lower video list", async () => {
    const requestedUrls = [];
    const results = await extractKnownProviderUrls(
      "https://cdn4.mvfile.com/WuSf1I",
      async (url) => {
        const requestUrl = url.toString();
        requestedUrls.push(requestUrl);
        if (requestUrl.includes("/flow/land-page/getInfo")) {
          return Response.json({
            code: 0,
            data: {
              info: {
                netDiskInfo: {
                  fileUrl:
                    "https://vid.fun800.click/current/playlist.m3u8",
                  coverImage: "https://vid.fun800.click/current/thumbnail.jpg",
                },
                extraInfo: {
                  externalLinks: "1zAbXY",
                  sortOrder: "3",
                },
              },
            },
          });
        }

        const request = new URL(requestUrl);
        const pageNo = request.searchParams.get("pageNo");
        const videoId = pageNo === "1" ? "related-page-1" : "related-page-2";
        const landingPage = pageNo === "1" ? "A1VIjM" : "B2VIjM";

        return Response.json({
          code: 0,
          data: {
            list: [
              {
                landingPage,
                coverImage: `https://vid.fun800.click/${videoId}/thumbnail.jpg`,
                m3u8Url: `https://vid.fun800.click/${videoId}/playlist.m3u8`,
              },
            ],
            total: 21,
          },
        });
      },
    );

    assert.deepEqual(requestedUrls, [
      "https://rwzugqnp.fun800.click/app-api/flow/land-page/getInfo?externalLinks=WuSf1I&domain=cdn4.mvfile.com",
      "https://rwzugqnp.fun800.click/app-api/flow/land-page/list_by_links_page?externalLinks=1zAbXY&domain=cdn4.mvfile.com&pageNo=1&pageSize=20&sortOrder=3",
      "https://rwzugqnp.fun800.click/app-api/flow/land-page/list_by_links_page?externalLinks=1zAbXY&domain=cdn4.mvfile.com&pageNo=2&pageSize=20&sortOrder=3",
    ]);

    assert.deepEqual(results, [
      {
        url: "https://vid.fun800.click/current/playlist.m3u8",
        kind: "hls",
        source: "Vilolo media API",
        thumbnailUrl: "https://vid.fun800.click/current/thumbnail.jpg",
      },
      {
        url: "https://vid.fun800.click/related-page-1/playlist.m3u8",
        kind: "hls",
        source: "Vilolo related API",
        thumbnailUrl: "https://vid.fun800.click/related-page-1/thumbnail.jpg",
        sourcePage: "https://cdn4.mvfile.com/A1VIjM",
      },
      {
        url: "https://vid.fun800.click/related-page-2/playlist.m3u8",
        kind: "hls",
        source: "Vilolo related API",
        thumbnailUrl: "https://vid.fun800.click/related-page-2/thumbnail.jpg",
        sourcePage: "https://cdn4.mvfile.com/B2VIjM",
      },
    ]);
  });
});
