import {
  BlobSource, BufferTarget, Conversion, Input, MPEG_TS, Mp4OutputFormat, Output,
} from "./vendor/mediabunny-1.62.0.min.mjs";

export const MAX_VIDEO_BYTES = 128 * 1024 * 1024;

export async function convertHlsToMp4({
  url,
  fetchImpl = fetch,
  onProgress = () => {},
  maxBytes = MAX_VIDEO_BYTES,
}) {
  const manifestResponse = await fetchImpl(`/api/download?mode=manifest&url=${encodeURIComponent(url)}`);
  if (!manifestResponse.ok) throw new Error(await manifestResponse.text());
  const { segments, duration, fileName } = await manifestResponse.json();
  if (!segments?.length || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("動画情報を確認できませんでした。");
  }

  const parts = [];
  let bytes = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const response = await fetchImpl(`/api/download?mode=segment&url=${encodeURIComponent(segments[index])}`);
    if (!response.ok) throw new Error(await response.text());
    if (!response.body) throw new Error("動画データを取得できませんでした。");
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new Error("動画が大きすぎるためMP4に変換できません。128 MB以下の動画をお試しください。");
        parts.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    onProgress({ phase: "download", completed: index + 1, total: segments.length, bytes });
  }

  const source = new Blob(parts, { type: "video/mp2t" });
  parts.length = 0;
  const input = new Input({ source: new BlobSource(source), formats: [MPEG_TS] });
  let output;
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (video?.codec !== "avc" || (audio && audio.codec !== "aac")) {
      throw new Error("この動画の映像・音声形式はMP4変換に対応していません。");
    }

    output = new Output({
      // Normal sample tables for Safari; no streaming-only moof fragments.
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new BufferTarget(),
    });
    output.target.on("write", ({ end }) => {
      if (end > maxBytes) throw new Error("動画が大きすぎるためMP4に変換できません。");
    });
    const conversion = await Conversion.init({ input, output, copy: { mode: "forced" } });
    if (!conversion.isValid || conversion.discardedTracks.length) {
      throw new Error("映像と音声をMP4に格納できませんでした。元のURLから開いてください。");
    }
    onProgress({ phase: "convert", progress: 0 });
    conversion.onProgress = (progress) => onProgress({ phase: "convert", progress });
    await conversion.execute();
    return { blob: new Blob([output.target.buffer], { type: "video/mp4" }), fileName, duration };
  } catch (error) {
    if (output && output.state !== "finalized" && output.state !== "canceled") {
      await output.cancel().catch(() => {});
    }
    if (error.message?.match(/[\u3040-\u30ff\u3400-\u9fff]/)) throw error;
    throw new Error("動画の映像・音声形式を確認できませんでした。元のURLから開いてください。", { cause: error });
  } finally {
    input.dispose();
  }
}
