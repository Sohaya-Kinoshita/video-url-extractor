(function () {
  const STORAGE_KEY = "video-url-extractor:saved-videos";
  const TEMP_EXTRACTION_KEY = "video-url-extractor:temporary-extraction";

  function readSavedVideos() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter((item) => item && item.url) : [];
    } catch {
      return [];
    }
  }

  function writeSavedVideos(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function saveVideoUrl(item) {
    const now = new Date().toISOString();
    const saved = readSavedVideos();
    const nextItem = {
      url: item.url,
      kind: item.kind || "file",
      source: item.source || "",
      thumbnailUrl: item.thumbnailUrl || "",
      savedAt: now,
    };
    const existingIndex = saved.findIndex((savedItem) => savedItem.url === item.url);

    if (existingIndex >= 0) {
      saved.splice(existingIndex, 1);
    }

    saved.unshift(nextItem);
    writeSavedVideos(saved.slice(0, 200));
    return nextItem;
  }

  function deleteSavedVideo(url) {
    writeSavedVideos(readSavedVideos().filter((item) => item.url !== url));
  }

  function downloadUrl(url) {
    const downloadHref = `/api/download?url=${encodeURIComponent(url)}`;
    if (isIOS()) {
      window.location.href = downloadHref;
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = downloadHref;
    anchor.download = suggestFileName(url);
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function suggestFileName(url) {
    try {
      const parsed = new URL(url);
      const lastSegment = parsed.pathname.split("/").filter(Boolean).pop();
      return lastSegment || "video";
    } catch {
      return "video";
    }
  }

  function isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent);
  }

  function readTemporaryExtraction() {
    try {
      return JSON.parse(sessionStorage.getItem(TEMP_EXTRACTION_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveTemporaryExtraction(payload) {
    sessionStorage.setItem(TEMP_EXTRACTION_KEY, JSON.stringify(payload));
  }

  window.videoUrlStorage = {
    deleteSavedVideo,
    downloadUrl,
    readTemporaryExtraction,
    readSavedVideos,
    saveVideoUrl,
    saveTemporaryExtraction,
  };
})();
