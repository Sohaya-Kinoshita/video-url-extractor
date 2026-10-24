const savedResultsEl = document.querySelector("#saved-results");
const savedCountEl = document.querySelector("#saved-count");

renderSavedVideos();

function renderSavedVideos() {
  const items = window.videoUrlStorage.readSavedVideos();
  savedCountEl.textContent = `${items.length}件`;
  savedResultsEl.innerHTML = "";

  if (!items.length) {
    savedResultsEl.className = "results empty";
    const empty = document.createElement("p");
    empty.textContent = "保存済みURLはありません。";
    savedResultsEl.appendChild(empty);
    return;
  }

  savedResultsEl.className = "results";

  for (const item of items) {
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
    meta.append(createBadge(item.kind || "file"));
    if (item.source) meta.append(createBadge(item.source));
    if (item.savedAt) meta.append(createBadge(`保存: ${formatSavedAt(item.savedAt)}`));

    content.append(urlText, meta);

    const actions = document.createElement("div");
    actions.className = "action-group";

    const openButton = createButton(item.kind === "hls" ? "MP4" : "開く", "open-button", () => {
      window.videoUrlStorage.openUrl(item.url);
    });
    const saveText = item.kind === "hls" ? "再生" : "保存";
    const saveButton = createButton(saveText, "save-button", (button) => {
      if (item.kind === "hls") {
        window.videoUrlStorage.openOriginalUrl(item.url);
        return;
      }
      window.videoUrlStorage.downloadUrl(item.url);
      flashButton(button, "開始", saveText);
    });
    if (item.kind === "hls") saveButton.title = "変換せず元の形式で再生";
    const copyButton = createButton("コピー", "copy-button", async (button) => {
      await navigator.clipboard.writeText(item.url);
      flashButton(button, "完了", "コピー");
    });
    const deleteButton = createButton("削除", "delete-button", () => {
      window.videoUrlStorage.deleteSavedVideo(item.url);
      renderSavedVideos();
    });

    actions.append(openButton, saveButton, copyButton, deleteButton);
    row.append(content, actions);
    savedResultsEl.appendChild(row);
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

function createButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", () => onClick(button));
  return button;
}

function flashButton(button, doneText, originalText) {
  button.textContent = doneText;
  setTimeout(() => {
    button.textContent = originalText;
  }, 1200);
}

function formatSavedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
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
