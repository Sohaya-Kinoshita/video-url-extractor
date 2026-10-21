import assert from "node:assert/strict";
import { it } from "node:test";

import { onRequestPost } from "../functions/api/extract.js";

it("returns playback URLs without turning API file names into broken links", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url) === "https://video.twimg-image.com/AbC123") {
      return new Response("<!doctype html><html></html>", {
        headers: { "Content-Type": "text/html" },
      });
    }

    assert.equal(new URL(url).pathname, "/app-api/flow/land-page/getInfo");
    return Response.json({
      code: 0,
      data: {
        info: {
          netDiskInfo: {
            fileName: "missing.mp4",
            title: "missing-title.mp4",
            fileUrl: "https://media.example.com/playable.mp4",
            m3u8Url: "https://media.example.com/playlist.m3u8",
          },
        },
      },
    });
  });

  const response = await onRequestPost({
    request: new Request("https://extractor.example.com/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://video.twimg-image.com/AbC123",
        scanLinkedPages: false,
      }),
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.count, 2);
  assert.deepEqual(payload.results.map((item) => item.url), [
    "https://media.example.com/playable.mp4",
    "https://media.example.com/playlist.m3u8",
  ]);
  assert.ok(payload.results.every((item) =>
    item.sourcePage === "https://video.twimg-image.com/AbC123"));
});
