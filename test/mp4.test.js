import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { BlobSource, BufferSource, EncodedPacketSink, Input, MP4, MPEG_TS } from "../public/vendor/mediabunny-1.62.0.min.mjs";
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

function findBoxes(bytes, path) {
  const result = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset);
    assert.ok(size >= 8 && offset + size <= bytes.length);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (type === path[0]) {
      const body = bytes.subarray(offset + 8, offset + size);
      result.push(...(path.length === 1 ? [body] : findBoxes(body, path.slice(1))));
    }
    offset += size;
  }
  return result;
}

it("writes regular Fast Start MP4 with populated audio/video sample tables", async () => {
  const progress = [];
  const result = await convertHlsToMp4({
    url: "https://media.example.com/master.m3u8",
    fetchImpl: fixtureFetch,
    onProgress: (value) => progress.push(value),
  });
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  assert.equal(result.blob.type, "video/mp4");
  assert.equal(result.fileName, "video.mp4");
  assert.equal(new TextDecoder().decode(bytes.subarray(4, 8)), "ftyp");
  assert.equal(findBoxes(bytes, ["moof"]).length, 0);
  assert.equal(findBoxes(bytes, ["mdat"]).length, 1);
  assert.ok(new TextDecoder().decode(bytes).indexOf("moov") < new TextDecoder().decode(bytes).indexOf("mdat"));
  const sizes = findBoxes(bytes, ["moov", "trak", "mdia", "minf", "stbl", "stsz"]);
  assert.equal(sizes.length, 2);
  for (const stsz of sizes) {
    assert.ok(new DataView(stsz.buffer, stsz.byteOffset, stsz.byteLength).getUint32(8) > 0);
  }
  const input = new Input({ source: new BlobSource(result.blob), formats: [MP4] });
  try {
    assert.deepEqual((await input.getTracks()).map((track) => track.type).sort(), ["audio", "video"]);
    const duration = await input.computeDuration();
    assert.ok(duration > 0 && duration < 20);
  } finally { input.dispose(); }
  assert.deepEqual(progress.filter((p) => p.phase === "download"), [{ phase: "download", completed: 1, total: 1, bytes: fixture.length }]);
  assert.ok(progress.some((p) => p.phase === "convert"));
});

it("preserves every H.264 B-frame and AAC packet without transcoding", async () => {
  const visible = readFileSync(new URL("./fixtures/visible-h264-aac.bin", import.meta.url));
  const result = await convertHlsToMp4({
    url: "https://media.example.com/video.m3u8",
    fetchImpl: async (url) => url.includes("mode=manifest")
      ? Response.json({ ...manifest, duration: 3 }) : new Response(visible),
  });
  const original = new Input({ source: new BufferSource(visible), formats: [MPEG_TS] });
  const converted = new Input({ source: new BlobSource(result.blob), formats: [MP4] });
  try {
    for (const getTrack of ["getPrimaryVideoTrack", "getPrimaryAudioTrack"]) {
      async function packetHashes(input, transportStream) {
        const track = await input[getTrack]();
        const hashes = [];
        for await (const packet of new EncodedPacketSink(track).packets()) {
          let payload;
          if (track.type === "video") {
            // TS uses Annex B start codes; MP4 uses length-prefixed NALs.
            let units;
            if (transportStream) {
              units = Buffer.from(packet.data).toString("hex")
                .split(/00000001|000001/).filter(Boolean).map((hex) => Buffer.from(hex, "hex"));
            } else {
              units = [];
              const view = new DataView(packet.data.buffer, packet.data.byteOffset, packet.data.byteLength);
              for (let offset = 0; offset < packet.data.length;) {
                const size = view.getUint32(offset);
                units.push(packet.data.subarray(offset + 4, offset + 4 + size));
                offset += 4 + size;
              }
            }
            payload = Buffer.concat(units.filter((unit) => [1, 5].includes(unit[0] & 31)));
          } else {
            // The ADTS transport header is omitted from MP4 AAC samples.
            const headerBytes = transportStream ? (packet.data[1] & 1 ? 7 : 9) : 0;
            payload = packet.data.subarray(headerBytes);
          }
          assert.ok(payload.length > 0);
          hashes.push(createHash("sha256").update(payload).digest("hex"));
        }
        return hashes;
      }
      const hashes = await packetHashes(original, true);
      assert.ok(hashes.length >= 90);
      assert.deepEqual(await packetHashes(converted, false), hashes);
    }
  } finally { original.dispose(); converted.dispose(); }
});

it("stops conversion when video data exceeds the memory limit", async () => {
  await assert.rejects(convertHlsToMp4({
    url: "https://media.example.com/master.m3u8",
    fetchImpl: fixtureFetch,
    maxBytes: 1000,
  }), /動画が大きすぎる/);
});

it("shows upstream failures instead of producing an empty MP4", async () => {
  await assert.rejects(convertHlsToMp4({
    url: "https://media.example.com/master.m3u8",
    fetchImpl: async () => new Response("配信元に接続できません。", { status: 502 }),
  }), /配信元に接続できません/);
});

it("does not save invalid media as a renamed MP4", async () => {
  await assert.rejects(convertHlsToMp4({
    url: "https://media.example.com/master.m3u8",
    fetchImpl: async (url) => url.includes("mode=manifest")
      ? Response.json(manifest)
      : new Response("not MPEG-TS media"),
  }), /映像・音声形式/);
});

it("keeps MP4 conversion separate from original playback, preserving signed URLs", () => {
  const opened = [];
  const context = { window: { open: (...args) => opened.push(args) }, URL };
  runInNewContext(readFileSync(new URL("../public/storage.js", import.meta.url), "utf8"), context);
  const storage = context.window.videoUrlStorage;
  const url = "https://media.example.com/video.m3u8?token=a%2Bb&expires=123";
  storage.openUrl(url);
  storage.downloadUrl(url);
  storage.openUrl("https://media.example.com/movie.mp4");
  storage.openOriginalUrl(url);
  assert.equal(opened[0][0], `/mp4.html?url=${encodeURIComponent(url)}`);
  assert.equal(opened[1][0], `/mp4.html?url=${encodeURIComponent(url)}&download=1`);
  assert.equal(opened[2][0], "https://media.example.com/movie.mp4");
  assert.equal(opened[3][0], url);
});
