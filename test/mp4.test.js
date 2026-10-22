import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import "../public/vendor/mux-mp4.min.js";
import { convertHlsToMp4 } from "../public/mp4-converter.js";

const fixture = readFileSync(new URL("./fixtures/mux-test-segment.bin", import.meta.url));
const manifest = { segments: ["https://media.example.com/part.ts?token=abc"], duration: 2, fileName: "video.mp4" };

function fixtureFetch(url) {
  if (new URL(url, "https://tool.example").searchParams.get("mode") === "manifest") {
    return Promise.resolve(Response.json(manifest));
  }
  // Odd-sized chunks exercise TS packets split across network reads.
  return Promise.resolve(new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < fixture.length; i += 997) controller.enqueue(fixture.subarray(i, i + 997));
      controller.close();
    },
  })));
}

it("converts real H.264/AAC TS into MP4 with audio, video and finite duration", async () => {
  const progress = [];
  const result = await convertHlsToMp4({
    url: "https://media.example.com/master.m3u8",
    Transmuxer: globalThis.muxjs.Transmuxer,
    fetchImpl: fixtureFetch,
    onProgress: (value) => progress.push(value),
  });
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(result.blob.type, "video/mp4");
  assert.equal(result.fileName, "video.mp4");
  assert.equal(new TextDecoder().decode(bytes.subarray(4, 8)), "ftyp");
  const boxes = globalThis.muxjs.probe.findBox;
  assert.equal(boxes(bytes, ["moof"]).length, 2);
  assert.equal(boxes(bytes, ["mdat"]).length, 2);
  const tracks = globalThis.muxjs.probe.tracks(bytes);
  assert.deepEqual(tracks.map((track) => track.type).sort(), ["audio", "video"]);
  const mvhd = boxes(bytes, ["moov", "mvhd"])[0];
  const header = new DataView(mvhd.buffer, mvhd.byteOffset, mvhd.byteLength);
  assert.equal(header.getUint32(16) / header.getUint32(12), 2);
  const mediaHeaders = boxes(bytes, ["moov", "trak", "mdia", "mdhd"]);
  assert.equal(mediaHeaders.length, 2);
  for (const mdhd of mediaHeaders) {
    const track = new DataView(mdhd.buffer, mdhd.byteOffset, mdhd.byteLength);
    assert.equal(track.getUint32(16) / track.getUint32(12), 2);
  }
  assert.deepEqual(progress, [{ completed: 1, total: 1, bytes: fixture.length }]);
});

it("stops conversion when video data exceeds the memory limit", async () => {
  await assert.rejects(convertHlsToMp4({
    url: "https://media.example.com/master.m3u8",
    Transmuxer: globalThis.muxjs.Transmuxer,
    fetchImpl: fixtureFetch,
    maxBytes: 1000,
  }), /動画が大きすぎる/);
});

it("shows upstream failures instead of producing an empty MP4", async () => {
  await assert.rejects(convertHlsToMp4({
    url: "https://media.example.com/master.m3u8",
    Transmuxer: globalThis.muxjs.Transmuxer,
    fetchImpl: async () => new Response("配信元に接続できません。", { status: 502 }),
  }), /配信元に接続できません/);
});

it("does not save invalid media as a renamed MP4", async () => {
  await assert.rejects(convertHlsToMp4({
    url: "https://media.example.com/master.m3u8",
    Transmuxer: globalThis.muxjs.Transmuxer,
    fetchImpl: async (url) => url.includes("mode=manifest")
      ? Response.json(manifest)
      : new Response("not MPEG-TS media"),
  }), /映像・音声形式/);
});

it("routes HLS open and save actions to the MP4 page, preserving signed URLs", () => {
  const opened = [];
  const context = { window: { open: (...args) => opened.push(args) }, URL };
  runInNewContext(readFileSync(new URL("../public/storage.js", import.meta.url), "utf8"), context);
  const storage = context.window.videoUrlStorage;
  const url = "https://media.example.com/video.m3u8?token=a%2Bb&expires=123";
  storage.openUrl(url);
  storage.downloadUrl(url);
  storage.openUrl("https://media.example.com/movie.mp4");
  assert.equal(opened[0][0], `/mp4.html?url=${encodeURIComponent(url)}`);
  assert.equal(opened[1][0], `/mp4.html?url=${encodeURIComponent(url)}&download=1`);
  assert.equal(opened[2][0], "https://media.example.com/movie.mp4");
});
