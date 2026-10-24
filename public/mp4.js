const params = new URLSearchParams(window.location.search);
const status = document.querySelector("#mp4-status");
const progress = document.querySelector("#mp4-progress");
const video = document.querySelector("#mp4-video");
const save = document.querySelector("#mp4-save");
const cancel = document.querySelector("#mp4-cancel");
const retry = document.querySelector("#mp4-retry");
const original = document.querySelector("#mp4-original");
let worker;
let objectUrl;
let targetUrl;

function showError(message) {
  worker?.terminate();
  status.textContent = message;
  status.classList.add("error");
  progress.hidden = true;
  cancel.hidden = true;
  retry.hidden = !targetUrl;
}

function start() {
  worker?.terminate();
  status.textContent = "MP4を準備しています…";
  status.classList.remove("error");
  progress.value = 0;
  progress.hidden = false;
  cancel.hidden = false;
  retry.hidden = true;
  try {
    worker = new Worker("/mp4-worker.js?v=2", { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") {
        if (data.phase === "convert") {
          progress.value = Math.round(95 + 5 * data.progress);
          status.textContent = "MP4の映像・音声を仕上げています…";
        } else {
          progress.value = Math.round(data.completed / data.total * 95);
          status.textContent = `MP4を準備しています… ${progress.value}%（${(data.bytes / 1024 / 1024).toFixed(1)} MB）`;
        }
      } else if (data.type === "done") {
        objectUrl = URL.createObjectURL(data.blob);
        video.src = objectUrl;
        video.hidden = false;
        save.href = objectUrl;
        save.download = data.fileName || "video.mp4";
        save.hidden = false;
        progress.hidden = true;
        cancel.hidden = true;
        status.textContent = "MP4の映像を読み込んでいます…";
        video.load();
        worker.terminate();
        if (params.get("download") === "1") save.click();
      } else if (data.type === "error") showError(data.message);
    };
    worker.onerror = () => showError("MP4の準備を開始できませんでした。再試行するか、元のURLから開いてください。");
    worker.postMessage({ url: targetUrl });
  } catch {
    showError("このブラウザではMP4を準備できません。元のURLから開いてください。");
  }
}

cancel.addEventListener("click", () => showError("MP4の準備を中止しました。"));
retry.addEventListener("click", start);
video.addEventListener("loadeddata", () => {
  status.textContent = "MP4の準備ができました。再生ボタンで視聴できます。";
});
video.addEventListener("playing", () => {
  status.textContent = "MP4を再生しています。";
});
video.addEventListener("error", () => {
  status.textContent = "このブラウザでは再生できません。「MP4を保存」から動画プレーヤーで開いてください。";
});
window.addEventListener("pagehide", (event) => {
  worker?.terminate();
  if (!event.persisted && objectUrl) URL.revokeObjectURL(objectUrl);
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && targetUrl && !objectUrl) start();
});

try {
  const url = new URL(params.get("url"));
  if (!["https:", "http:"].includes(url.protocol) || !url.pathname.toLowerCase().endsWith(".m3u8")) {
    throw new Error("HLS動画のURLを確認してください。");
  }
  targetUrl = url.toString();
  original.href = targetUrl;
  original.hidden = false;
  start();
} catch {
  showError("動画URLを確認できませんでした。抽出ページから開き直してください。");
}
