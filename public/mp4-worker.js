import "./vendor/mux-mp4.min.js";
import { convertHlsToMp4 } from "./mp4-converter.js";

self.onmessage = async ({ data }) => {
  try {
    const result = await convertHlsToMp4({
      url: data.url,
      Transmuxer: globalThis.muxjs.Transmuxer,
      onProgress: (progress) => self.postMessage({ type: "progress", ...progress }),
    });
    self.postMessage({ type: "done", ...result });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || "MP4の準備に失敗しました。" });
  }
};
