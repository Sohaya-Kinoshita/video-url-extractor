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
      throw new Error(payload.detail || "解析に失敗しました。");
    }

    renderResults(payload.results || []);
    setStatus(`${payload.page_url} を解析しました。`);
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

    const content = document.createElement("div");
    const urlText = document.createElement("span");
    urlText.className = "url-text";
    urlText.textContent = item.url;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.append(createBadge(item.kind), createBadge(item.source));

    content.append(urlText, meta);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-button";
    copyButton.textContent = "コピー";
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(item.url);
      copyButton.textContent = "完了";
      setTimeout(() => {
        copyButton.textContent = "コピー";
      }, 1200);
    });

    row.append(content, copyButton);
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
