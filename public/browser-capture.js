// Self-contained so the same function can be installed as a Safari bookmark.
export function collectBrowserVideos(appOrigin) {
  const found = new Map();
  function add(value, poster = '') {
    if (!value || found.size >= 150) return;
    try {
      const url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol) || !/\.(mp4|m3u8|webm|mov|m4v|ogv)$/i.test(url.pathname)) return;
      if (url.username || url.password) return;
      let thumbnailUrl = '';
      try {
        const image = new URL(poster, location.href);
        if (poster && /^https?:$/.test(image.protocol)) thumbnailUrl = image.href;
      } catch {}
      const previous = found.get(url.href);
      if (!previous || (!previous.thumbnailUrl && thumbnailUrl)) found.set(url.href, { url: url.href, thumbnailUrl });
    } catch {}
  }
  for (const element of document.querySelectorAll('video,source,a[href],[data-video-url],[data-hls]')) {
    const poster = element.poster || element.closest('video')?.poster || '';
    for (const value of [element.currentSrc, element.src, element.getAttribute('href'), element.getAttribute('data-video-url'), element.getAttribute('data-hls')]) add(value, poster);
  }
  // HLS players often expose only blob: URLs on <video>; their request URLs remain available here.
  for (const entry of performance.getEntriesByType('resource')) add(entry.name);
  const html = document.documentElement.innerHTML.replace(/\\\//g, '/').replace(/&amp;/g, '&');
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:mp4|m3u8|webm|mov|m4v|ogv)(?:\?[^\s"'<>]*)?/gi)) add(match[0]);
  if (!found.size) { alert('動画URLが見つかりません。動画を再生してからもう一度実行してください。埋め込み動画は再生ページを直接開いてお試しください。'); return; }
  const page = new URL(location.href);
  page.hash = '';
  const payload = { pageUrl: page.href, items: [...found.values()] };
  while (JSON.stringify(payload).length > 120000 && payload.items.length) payload.items.pop();
  location.assign(`${appOrigin}/capture.html#${encodeURIComponent(JSON.stringify(payload))}`);
}
