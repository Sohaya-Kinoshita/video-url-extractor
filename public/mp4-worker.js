import { convertHlsToMp4 } from "./mp4-converter.js?v=2";

self.onmessage = async ({ data }) => {
  try {
    const result = await convertHlsToMp4({
      url: data.url,
      onProgress: (progress) => self.postMessage({ type: "progress", ...progress }),
    });
    self.postMessage({ type: "done", ...result });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message || "MP4の準備に失敗しました。" });
  }
};
