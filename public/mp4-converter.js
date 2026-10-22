export const MAX_VIDEO_BYTES = 128 * 1024 * 1024;

export async function convertHlsToMp4({
  url,
  Transmuxer,
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

  const transmuxer = new Transmuxer({ remux: true });
  const parts = [];
  let bytes = 0;
  let outputBytes = 0;
  transmuxer.on("data", (segment) => {
    if (segment.type === "audio") {
      throw new Error("この動画の映像形式はMP4変換に対応していません。元のURLから開いてください。");
    }
    if (!parts.length) parts.push(setMp4Duration(segment.initSegment, duration));
    outputBytes += segment.data.byteLength;
    if (outputBytes > maxBytes) throw new Error("動画が大きすぎるためMP4に変換できません。128 MB以下の動画をお試しください。");
    parts.push(segment.data);
  });

  try {
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
          if (bytes > maxBytes) {
            throw new Error("動画が大きすぎるためMP4に変換できません。128 MB以下の動画をお試しください。");
          }
          transmuxer.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      transmuxer.flush();
      onProgress({ completed: index + 1, total: segments.length, bytes });
    }
    if (parts.length < 2) throw new Error("この動画の映像・音声形式はMP4変換に対応していません。");
    return { blob: new Blob(parts, { type: "video/mp4" }), fileName, duration };
  } finally {
    transmuxer.dispose();
  }
}

// mux.js produces fragmented MP4 with unspecified durations for streaming.
// Write the VOD duration so a standalone file has a finite seekable timeline.
export function setMp4Duration(initSegment, seconds) {
  const result = initSegment.slice();
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  const boxes = [];
  function visit(start, end) {
    for (let offset = start; offset + 8 <= end;) {
      const size = view.getUint32(offset);
      if (size < 8 || offset + size > end) throw new Error("MP4データの形式を確認できませんでした。");
      const type = String.fromCharCode(...result.subarray(offset + 4, offset + 8));
      const body = offset + 8;
      if (["mvhd", "mdhd", "tkhd"].includes(type)) boxes.push({ type, body });
      if (["moov", "trak", "mdia"].includes(type)) visit(body, offset + size);
      offset += size;
    }
  }
  visit(0, result.byteLength);
  const movie = boxes.find((box) => box.type === "mvhd");
  if (!movie) throw new Error("MP4の動画情報が見つかりませんでした。");
  const movieTimescale = view.getUint32(movie.body + (view.getUint8(movie.body) === 1 ? 20 : 12));
  for (const { type, body } of boxes) {
    const is64Bit = view.getUint8(body) === 1;
    const timescale = type === "tkhd"
      ? movieTimescale
      : view.getUint32(body + (is64Bit ? 20 : 12));
    const durationOffset = body + (type === "tkhd" ? (is64Bit ? 28 : 20) : (is64Bit ? 24 : 16));
    const ticks = Math.round(seconds * timescale);
    if (is64Bit) view.setBigUint64(durationOffset, BigInt(ticks));
    else view.setUint32(durationOffset, Math.min(ticks, 0xfffffffe));
  }
  return result;
}
