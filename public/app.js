const form = document.querySelector("#extract-form");
const urlInput = document.querySelector("#page-url");
const pasteButton = document.querySelector("#paste-button");
const scanLinkedPagesInput = document.querySelector("#scan-linked-pages");
const submitButton = document.querySelector("#submit-button");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const countEl = document.querySelector("#result-count");

restoreTemporaryExtraction();
restoreBrowserCapture();
const requestedUrl = new URLSearchParams(location.search).get("url");
if (requestedUrl) {
  urlInput.value = requestedUrl;
  setStatus("履歴のURLを入力しました。「探索」で再取得できます。");
}

async function restoreBrowserCapture() {
  let raw;
  try { raw = sessionStorage.getItem('video-url-extractor:pending-capture'); } catch { return; }
  if (!raw) return;
  setLoading(true);
  setStatus('ブラウザから動画URLを取り込んでいます…');
  try {
    const payload = await window.videoUrlStorage.api('/api/capture', { method: 'POST', body: JSON.parse(raw) });
    renderResults(payload.results);
    urlInput.value = payload.pageUrl;
    scanLinkedPagesInput.checked = false;
    window.videoUrlStorage.saveTemporaryExtraction({ inputUrl: payload.pageUrl, ...payload, scanLinkedPages: false });
    sessionStorage.removeItem('video-url-extractor:pending-capture');
    setStatus(`ブラウザから${payload.count}件を取り込みました。保存する動画は「記憶」を押してください。`);
    if (!payload.historySaved) setStatus(`${statusEl.textContent} 履歴の保存に失敗しました。`, true);
  } catch (error) {
    if (error.status >= 400 && error.status < 500 && error.status !== 401) sessionStorage.removeItem('video-url-extractor:pending-capture');
    setStatus(error.message || '取り込みに失敗しました。', true);
  }
  finally { setLoading(false); }
}

pasteButton.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    urlInput.value = text.trim();
    urlInput.focus();
    setStatus("クリップボードから貼り付けました。");
  } catch {
    setStatus("ブラウザの権限によりペーストできませんでした。", true);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const url = urlInput.value.trim();
  if (!url) {
    setStatus("URLを入力してください。", true);
    return;
  }

  setLoading(true);
  setStatus("ページを取得して解析しています...");
  renderResults([]);

  try {
    const scanLinkedPages = scanLinkedPagesInput.checked;
    const payload = await window.videoUrlStorage.api("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { url, scanLinkedPages },
    });

    const results = payload.results || [];
    renderResults(results);
    window.videoUrlStorage.saveTemporaryExtraction({
      inputUrl: url,
      pageUrl: payload.pageUrl,
      results,
      scanLinkedPages,
      scannedPageCount: payload.scannedPageCount || 1,
      savedAt: new Date().toISOString(),
    });
    setStatus(buildExtractedMessage(payload.pageUrl, payload.scannedPageCount || 1));
    if (payload.warnings?.length) setStatus(`${statusEl.textContent} ${payload.warnings.join(" ")}`);
    if (!payload.historySaved) setStatus(`${statusEl.textContent} 履歴の保存に失敗しました。`, true);
  } catch (error) {
    renderResults([]);
    setStatus(error.message || "解析に失敗しました。", true);
  } finally {
    setLoading(false);
  }
});

function renderResults(results) {
  countEl.textContent = `${results.length}件`;
  resultsEl.innerHTML = "";

  if (!results.length) {
    resultsEl.className = "results empty";
    const empty = document.createElement("p");
    empty.textContent = "動画URLはまだ検出されていません。";
    resultsEl.appendChild(empty);
    return;
  }

  resultsEl.className = "results";

  for (const item of results) {
    const row = document.createElement("article");
    row.className = "result-item";

    if (item.thumbnailUrl) {
      row.appendChild(createThumbnail(item.thumbnailUrl));
    } else {
      row.classList.add("result-item--without-thumbnail");
    }

    const content = document.createElement("div");
    const urlText = document.createElement("span");
    urlText.className = "url-text";
    urlText.textContent = formatUrlForDisplay(item.url);
    urlText.title = item.url;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.append(createBadge(item.kind), createBadge(item.source));
    if (item.sourcePage) meta.append(createBadge(new URL(item.sourcePage).hostname));

    content.append(urlText, meta);

    const actions = document.createElement("div");
    actions.className = "action-group";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "open-button";
    openButton.textContent = item.kind === "hls" ? "MP4" : "再生";
    openButton.addEventListener("click", () => {
      window.videoUrlStorage.openUrl(item.url);
    });

    const rememberButton = document.createElement("button");
    rememberButton.type = "button";
    rememberButton.className = "remember-button";
    rememberButton.textContent = "記憶";
    rememberButton.addEventListener("click", async () => {
      rememberButton.disabled = true;
      try {
        await window.videoUrlStorage.saveVideoUrl(item);
        flashButton(rememberButton, "記憶済み", "記憶");
      } catch (error) { setStatus(error.message, true); }
      finally { rememberButton.disabled = false; }
    });

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "save-button";
    saveButton.textContent = item.kind === "hls" ? "再生" : "保存";
    if (item.kind === "hls") saveButton.title = "変換せず元の形式で再生";
    saveButton.addEventListener("click", () => {
      if (item.kind === "hls") {
        window.videoUrlStorage.openOriginalUrl(item.url);
        return;
      }
      window.videoUrlStorage.downloadUrl(item.url);
      flashButton(saveButton, "開始", "保存");
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-button";
    copyButton.textContent = "コピー";
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(item.url);
      flashButton(copyButton, "完了", "コピー");
    });

    if (item.kind === "hls") {
      actions.append(saveButton, openButton, rememberButton, copyButton);
    } else {
      actions.append(openButton, saveButton, rememberButton, copyButton);
    }
    row.append(content, actions);
    resultsEl.appendChild(row);
  }
}

function createThumbnail(src) {
  const thumbnail = document.createElement("img");
  thumbnail.className = "thumbnail";
  thumbnail.alt = "";
  thumbnail.loading = "lazy";

  const applyOrientation = () => {
    thumbnail.classList.toggle(
      "thumbnail--portrait",
      thumbnail.naturalHeight > thumbnail.naturalWidth,
    );
  };

  thumbnail.addEventListener("load", applyOrientation, { once: true });
  thumbnail.src = src;
  if (thumbnail.complete && thumbnail.naturalWidth) applyOrientation();

  return thumbnail;
}

function createBadge(text) {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = text;
  return badge;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  pasteButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "探索中..." : "探索";
}

function flashButton(button, doneText, originalText) {
  button.textContent = doneText;
  setTimeout(() => {
    button.textContent = originalText;
  }, 1200);
}

function restoreTemporaryExtraction() {
  const temporaryExtraction = window.videoUrlStorage.readTemporaryExtraction();
  if (!temporaryExtraction?.results?.length) {
    return;
  }

  urlInput.value = temporaryExtraction.inputUrl || "";
  scanLinkedPagesInput.checked = temporaryExtraction.scanLinkedPages !== false;
  renderResults(temporaryExtraction.results);
  setStatus(
    buildExtractedMessage(
      temporaryExtraction.pageUrl || temporaryExtraction.inputUrl || "前回のURL",
      temporaryExtraction.scannedPageCount || 1,
    ),
  );
}

function buildExtractedMessage(pageUrl, scannedPageCount) {
  const pageText = scannedPageCount > 1 ? `${scannedPageCount}ページ` : "1ページ";
  return `${formatUrlForDisplay(pageUrl)} を解析しました。探索: ${pageText}`;
}

function formatUrlForDisplay(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .split("/")
      .map((segment) => safeDecodeURIComponent(segment))
      .join("/");
    const search = parsed.search
      ? parsed.search
          .slice(1)
          .split("&")
          .map((pair) =>
            pair
              .split("=")
              .map((part) => safeDecodeURIComponent(part))
              .join("="),
          )
          .join("&")
      : "";

    return `${parsed.origin}${path}${search ? `?${search}` : ""}${parsed.hash}`;
  } catch {
    return safeDecodeURIComponent(url);
  }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}
