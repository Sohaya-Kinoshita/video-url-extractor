import { collectBrowserVideos } from './browser-capture.js';

document.querySelector('#copy-capture-bookmark').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const status = document.querySelector('#capture-help-status');
  try {
    const bookmark = `javascript:${encodeURIComponent(`(${collectBrowserVideos.toString()})(${JSON.stringify(location.origin)});void 0;`)}`;
    await navigator.clipboard.writeText(bookmark);
    button.textContent = 'コピーしました';
    status.textContent = 'SafariのブックマークのURL欄へ貼り付けてください。';
  } catch { status.textContent = 'コピーできませんでした。ブラウザのクリップボード権限を確認してください。'; }
});
