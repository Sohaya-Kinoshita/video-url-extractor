const form = document.querySelector("#extract-form");
const urlInput = document.querySelector("#page-url");
const submitButton = document.querySelector("#submit-button");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const countEl = document.querySelector("#result-count");

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
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "解析に失敗しました。");
    }

    renderResults(payload.results || []);
    setStatus(`${payload.pageUrl} を解析しました。`);
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
      const thumbnail = document.createElement("img");
      thumbnail.className = "thumbnail";
      thumbnail.src = item.thumbnailUrl;
      thumbnail.alt = "";
      thumbnail.loading = "lazy";
      row.appendChild(thumbnail);
    } else {
      row.classList.add("result-item--without-thumbnail");
    }

    const content = document.createElement("div");
    const urlText = document.createElement("span");
    urlText.className = "url-text";
    urlText.textContent = item.url;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.append(createBadge(item.kind), createBadge(item.source));

    content.append(urlText, meta);

    const actions = document.createElement("div");
    actions.className = "action-group";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "open-button";
    openButton.textContent = "開く";
    openButton.addEventListener("click", () => {
      window.videoUrlStorage.saveVideoUrl(item);
      const opened = window.open(item.url, "_blank", "noopener,noreferrer");
      if (opened) opened.opener = null;
      flashButton(openButton, "保存済み", "開く");
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-button";
    copyButton.textContent = "コピー";
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(item.url);
      flashButton(copyButton, "完了", "コピー");
    });

    actions.append(openButton, copyButton);
    row.append(content, actions);
    resultsEl.appendChild(row);
  }
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
  submitButton.textContent = isLoading ? "解析中..." : "抽出";
}

function flashButton(button, doneText, originalText) {
  button.textContent = doneText;
  setTimeout(() => {
    button.textContent = originalText;
  }, 1200);
}
