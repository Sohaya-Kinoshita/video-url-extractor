const captureStatus = document.querySelector('#capture-status');
const captureSource = document.querySelector('#capture-source');
const captureConfirm = document.querySelector('#capture-confirm');
let capturePayload;
try {
  const raw = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  if (raw.length > 500000) throw new Error();
  capturePayload = JSON.parse(decodeURIComponent(raw));
  const page = new URL(capturePayload.pageUrl);
  if (!/^https?:$/.test(page.protocol) || !Array.isArray(capturePayload.items) || !capturePayload.items.length || capturePayload.items.length > 150) throw new Error();
  captureStatus.textContent = `${capturePayload.items.length}件の動画URLを検出しました。`;
  captureSource.textContent = capturePayload.pageUrl;
  captureConfirm.disabled = false;
} catch {
  captureStatus.textContent = '取り込みデータがありません。元のサイトで動画を再生してから、取り込み用ブックマークを実行してください。';
}
captureConfirm.addEventListener('click', () => {
  try {
    sessionStorage.setItem('video-url-extractor:pending-capture', JSON.stringify(capturePayload));
    location.assign('/');
  } catch { captureStatus.textContent = '一時保存できませんでした。ブラウザのストレージ設定を確認してください。'; }
});
