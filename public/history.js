const historyResults = document.querySelector('#history-results');
const historyStatus = document.querySelector('#history-status');
const historyMore = document.querySelector('#history-more');
let historyCursor = null;
let historyLoaded = false;
async function loadHistory() {
  historyMore.disabled = true;
  historyStatus.textContent = '';
  try {
    const data = await window.videoUrlStorage.api(`/api/history${historyCursor ? `?cursor=${encodeURIComponent(historyCursor)}` : ''}`);
    if (!historyLoaded) { historyResults.replaceChildren(); historyResults.className = 'results'; }
    historyLoaded = true;
    for (const item of data.items) {
      const row = document.createElement('article');
      row.className = 'result-item result-item--without-thumbnail';
      const content = document.createElement('div');
      const url = document.createElement('span');
      url.className = 'url-text';
      url.textContent = item.inputUrl;
      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = `${new Date(item.createdAt).toLocaleString('ja-JP')} · ${item.count}件 · ${item.scannedPageCount}ページ探索`;
      content.append(url, meta);
      const link = document.createElement('a');
      link.className = 'download-link';
      link.href = `/?url=${encodeURIComponent(item.inputUrl)}`;
      link.textContent = '再探索';
      row.append(content, link);
      historyResults.append(row);
    }
    if (!historyResults.childElementCount) { historyResults.className = 'results empty'; historyResults.textContent = '抽出履歴はまだありません。'; }
    historyCursor = data.cursor;
    historyMore.hidden = !historyCursor;
  } catch (error) {
    historyStatus.textContent = error.message;
    historyStatus.classList.add('error');
    historyMore.hidden = false;
  } finally { historyMore.disabled = false; }
}
historyMore.addEventListener('click', loadHistory);
loadHistory();
