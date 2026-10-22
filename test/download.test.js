import assert from "node:assert/strict";
import { it } from "node:test";
import { onRequestGet } from "../functions/api/download.js";

function request(mode, url) {
  return { request: new Request(`https://tool.example/api/download?mode=${mode}&url=${encodeURIComponent(url)}`) };
}

it("resolves the highest-quality VOD into individual requests for MP4 conversion", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url));
    return new Response(calls.length === 1
      ? "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow/video.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000\nhigh/video.m3u8"
      : "#EXTM3U\n" + Array.from({ length: 75 }, (_, i) => `#EXTINF:4,\npart${i}.ts?token=abc`).join("\n") + "\n#EXT-X-ENDLIST");
  });
  const response = await onRequestGet(request("manifest", "https://media.example.com/master.m3u8"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.duration, 300);
  assert.equal(payload.segments.length, 75);
  assert.equal(payload.fileName, "master.mp4");
  assert.equal(payload.segments[0], "https://media.example.com/high/part0.ts?token=abc");
  assert.equal(calls.length, 2);
});

it("rejects live and discontinuous HLS instead of producing incomplete MP4s", async (t) => {
  let text;
  t.mock.method(globalThis, "fetch", async () => new Response(text));
  for (const playlist of [
    "#EXTM3U\n#EXTINF:4,\npart.ts",
    "#EXTM3U\n#EXT-X-DISCONTINUITY\n#EXTINF:4,\npart.ts\n#EXT-X-ENDLIST",
    "#EXTM3U\n#EXT-X-BYTERANGE:100@0\n#EXTINF:4,\npart.ts\n#EXT-X-ENDLIST",
    "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128\n#EXTINF:4,\npart.ts\n#EXT-X-ENDLIST",
    "#EXTM3U\n#EXT-X-MAP:URI=init.mp4\n#EXTINF:4,\npart.m4s\n#EXT-X-ENDLIST",
  ]) {
    text = playlist;
    assert.equal((await onRequestGet(request("manifest", "https://media.example.com/video.m3u8"))).status, 400);
  }
});

it("rejects playlists exceeding the segment limit before downloading video data", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(
    "#EXTM3U\n" + "#EXTINF:4,\npart.ts\n".repeat(301) + "#EXT-X-ENDLIST",
  ));
  assert.equal((await onRequestGet(request("manifest", "https://media.example.com/video.m3u8"))).status, 400);
});

it("rejects private segment targets and redirects without contacting the private host", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private.ts" } });
  });
  assert.equal((await onRequestGet(request("segment", "http://192.168.1.1/private.ts"))).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await onRequestGet(request("segment", "https://media.example.com/part.ts"))).status, 400);
  assert.equal(calls.length, 1);
});

it("checks URLs found inside playlists before exposing them to the converter", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("#EXTM3U\n#EXTINF:4,\nhttp://10.0.0.1/part.ts\n#EXT-X-ENDLIST"));
  assert.equal((await onRequestGet(request("manifest", "https://media.example.com/video.m3u8"))).status, 400);
});

it("streams individual TS segments while rejecting HTML masquerading as media", async (t) => {
  let upstream = new Response(new Uint8Array([0x47, 1, 2]), { headers: { "Content-Type": "video/mp2t" } });
  t.mock.method(globalThis, "fetch", async () => upstream);
  const response = await onRequestGet(request("segment", "https://media.example.com/part.ts?token=abc"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "video/mp2t");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0x47, 1, 2]));
  upstream = new Response("<html>Not found</html>", { headers: { "Content-Type": "text/html" } });
  assert.equal((await onRequestGet(request("segment", "https://media.example.com/part.ts"))).status, 502);
});
