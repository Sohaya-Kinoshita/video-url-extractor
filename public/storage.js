(function () {
  const STORAGE_KEY = "video-url-extractor:saved-videos";
  const TEMP_EXTRACTION_KEY = "video-url-extractor:temporary-extraction";

  function readLocalSavedVideos() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter((item) => item && item.url) : [];
    } catch {
      return [];
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    let payload;
    try { payload = await response.json(); } catch { throw new Error("サーバーに接続できませんでした。"); }
    if (!response.ok) {
      if (response.status === 401 && path !== "/api/auth") {
        window.location.assign(`/login.html?next=${encodeURIComponent(location.pathname + location.search)}`);
      }
      throw Object.assign(new Error(payload.error || "操作に失敗しました。"), { status: response.status });
    }
    return payload;
  }

  function readSavedVideos(cursor) {
    return api(`/api/saved${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  }

  async function saveVideoUrl(item) {
    return (await api("/api/saved", { method: "POST", body: item })).item;
  }

  function deleteSavedVideo(url) {
    return api("/api/saved", { method: "DELETE", body: { url } });
  }

  function localImportNeeded() {
    return !localStorage.getItem(`${STORAGE_KEY}:imported`) && readLocalSavedVideos().length > 0;
  }

  async function importLocalVideos(onProgress = () => {}) {
    const items = readLocalSavedVideos();
    for (let i = 0; i < items.length; i += 40) {
      await api("/api/import", { method: "POST", body: { items: items.slice(i, i + 40) } });
      onProgress(Math.min(i + 40, items.length), items.length);
    }
    localStorage.setItem(`${STORAGE_KEY}:imported`, "true");
    return items.length;
  }

  function downloadUrl(url) {
    if (isHlsUrl(url)) {
      openUrl(url, true);
      return;
    }
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

  function isHlsUrl(url) {
    try {
      return new URL(url).pathname.toLowerCase().endsWith(".m3u8");
    } catch {
      return false;
    }
  }

  function openUrl(url, download = false) {
    const href = isHlsUrl(url)
      ? `/mp4.html?url=${encodeURIComponent(url)}${download ? "&download=1" : ""}`
      : url;
    openOriginalUrl(href);
  }

  function openOriginalUrl(url) {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
  }

  function suggestFileName(url) {
    try {
      const parsed = new URL(url);
      const lastSegment = parsed.pathname.split("/").filter(Boolean).pop();
      return safeDecodeURIComponent(lastSegment || "video");
    } catch {
      return "video";
    }
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch {
      return String(value || "");
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
    api,
    importLocalVideos,
    localImportNeeded,
    deleteSavedVideo,
    downloadUrl,
    openUrl,
    openOriginalUrl,
    readTemporaryExtraction,
    readSavedVideos,
    saveVideoUrl,
    saveTemporaryExtraction,
  };
})();
