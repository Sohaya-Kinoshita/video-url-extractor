import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractVideoUrls, normalizeUrl, validatePageUrl } from "../src/extractor.js";

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
