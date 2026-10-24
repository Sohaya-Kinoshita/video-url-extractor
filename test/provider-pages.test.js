import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createExtractionFetch, extractKnownProviderUrls, extractPageVideos, fetchHtml } from '../src/extractor.js';
import { onRequestPost } from '../functions/api/extract.js';

function row(name, id = 'folder', thumbnail = '/thumb.jpg') {
  const token = Buffer.from(JSON.stringify({ f: id, n: name, e: 2000000000 })).toString('base64url') + '.signature';
  return `<div class="fm-row" onclick="window.location.href='/go/${token}'"><img src="${thumbnail}"></div>`;
}

it('uses same-origin APIs for alphabetic and numeric /d/ IDs on compatible mirrors', async () => {
  for (const id of ['uypLsJ', '0604']) {
    const requests = [];
    const signed = 'https://media.example/video.mov?X-Amz-Signature=a%2Bb&X-Amz-Expires=600';
    const results = await extractKnownProviderUrls(`https://mirror.example/d/${id}`, async (url) => {
      requests.push(url.href);
      assert.equal(url.origin, 'https://mirror.example');
      assert.equal(url.pathname, '/api.php');
      if (url.searchParams.get('endpoint').endsWith('getInfo')) return Response.json({ code: 0, data: { info: {
        netDiskInfo: { fileName: 'fake.mp4', fileUrl: signed, coverImage: '/thumb.php?code=a' },
        extraInfo: { externalLinks: id },
      } } });
      return Response.json({ code: 0, data: { list: [{ landingPage: '/d/NextAb', m3u8Url: 'https://media.example/next.m3u8' }], total: 1 } });
    });
    assert.equal(results[0].url, signed);
    assert.equal(results[0].thumbnailUrl, 'https://mirror.example/thumb.php?code=a');
    assert.equal(results[1].sourcePage, 'https://mirror.example/d/NextAb');
    assert.equal(requests.length, 2);
    assert.ok(results.every((item) => !item.url.includes('fake.mp4')));
  }
});

it('falls back to the shared API when a /d/ mirror has no local API', async () => {
  const requests = [];
  const results = await extractKnownProviderUrls('https://mirror.example/d/AbCd', async (url) => {
    requests.push(url.href);
    if (url.pathname === '/api.php') return new Response('<html>not an API</html>');
    return Response.json({ code: 0, data: { info: { fileUrl: 'https://media.example/real.mp4' } } });
  });
  assert.equal(requests.length, 2);
  assert.equal(results[0].url, 'https://media.example/real.mp4');
});

it('uses Workers-compatible manual redirects and never follows an API redirect to a private target', async () => {
  let calls = 0;
  const results = await extractKnownProviderUrls('https://twimg.com.pl/d/AbCd12', async (_url, options) => {
    calls += 1;
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private-api' } });
  });
  assert.equal(calls, 1);
  assert.deepEqual(results, []);
});

it('resolves signed file rows through public HTML players, keeping thumbnails and skipping folder rows', async () => {
  const html = row('video1.mp4') + row('subfolder') + row('video2.mov');
  const calls = [];
  const results = await extractPageVideos(html, 'https://directory.example/d/0604', async (url) => {
    const parsed = new URL(url);
    calls.push(parsed.href);
    assert.equal(parsed.origin, 'https://directory.example');
    if (parsed.pathname.startsWith('/go/')) return new Response(null, { status: 302, headers: { Location: `/lp/cdn.example/${calls.length}.mov` } });
    return new Response(`<a href="${parsed.href}">Player link</a><video><source src="https://cdn.example/${parsed.pathname.split('/').at(-1)}?key=a%2Bb"></video>`, { headers: { 'Content-Type': 'text/html' } });
  });
  assert.equal(calls.length, 4);
  assert.equal(results.length, 2);
  assert.ok(results.every((item) => new URL(item.url).hostname === 'cdn.example'));
  assert.ok(results.every((item) => item.thumbnailUrl === 'https://directory.example/thumb.jpg'));
  assert.ok(results.every((item) => item.sourcePage.startsWith('https://directory.example/lp/')));
});

it('accepts a real media redirect without reading video bytes', async () => {
  let canceled = false;
  const results = await extractPageVideos(row('movie.mp4'), 'https://directory.example/d/1234', async (url) => {
    if (new URL(url).pathname.startsWith('/go/')) return new Response(null, { status: 302, headers: { Location: 'https://cdn.example/real.mp4?token=a%2Bb' } });
    return new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'Content-Type': 'video/mp4' } });
  });
  assert.equal(canceled, true);
  assert.equal(results[0].url, 'https://cdn.example/real.mp4?token=a%2Bb');
});

it('rejects private redirect targets before contacting them', async () => {
  const calls = [];
  const results = await extractPageVideos(row('movie.mp4'), 'https://directory.example/d/1234', async (url) => {
    calls.push(String(url));
    return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private.mp4' } });
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(results, []);
});

it('resolves iframe players and retains unresolved embeds', async () => {
  const html = '<iframe src="https://player.example/embed/clip"></iframe><iframe src="https://other.example/embed/clip"></iframe>';
  const results = await extractPageVideos(html, 'https://page.example/article/clip', async (url) => {
    if (new URL(url).hostname === 'other.example') throw new Error('offline');
    return new Response('<video src="https://media.example/clip.m3u8"></video>', { headers: { 'Content-Type': 'text/html' } });
  });
  assert.ok(results.some((item) => item.url === 'https://media.example/clip.m3u8' && item.kind === 'hls'));
  assert.ok(results.some((item) => item.url === 'https://other.example/embed/clip' && item.kind === 'embed'));
  assert.ok(!results.some((item) => item.url === 'https://player.example/embed/clip'));
});

it('reports browser verification rather than inventing a video URL', async () => {
  let calls = 0;
  await assert.rejects(fetchHtml('https://article.example/article/abc', async () => {
    calls += 1;
    return new Response('<form method="POST" action="/__pow"><input name="token"></form>', { headers: { 'Content-Type': 'text/html' } });
  }), /ブラウザ確認/);
  assert.equal(calls, 1);
});

it('does not report a substituted article as a successful empty extraction', async () => {
  await assert.rejects(fetchHtml('https://article.example/article/abc', async () => new Response(
    '<html><link rel="stylesheet" href="https://news.wokao.win/style.css"></html>', { headers: { 'Content-Type': 'text/html' } },
  )), /ブラウザ確認/);
});

it('shares one request budget across linked pages and directory redirects and reports partial results', async (t) => {
  let calls = 0;
  const html = Array.from({ length: 20 }, (_, i) => row(`file${i}.mp4`, `row${i}`)).join('');
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls += 1;
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/d/')) return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    if (parsed.pathname.startsWith('/go/')) return new Response(null, { status: 302, headers: { Location: `/lp/${calls}.html` } });
    return new Response(`<video src="https://media.example/${calls}.mp4"></video>`, { headers: { 'Content-Type': 'text/html' } });
  });
  const response = await onRequestPost({ request: new Request('https://tool.example/api/extract', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://directory.example/d/1234', scanLinkedPages: true }),
  }) });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls, 40);
  assert.ok(payload.count > 0 && payload.count < 20);
  assert.equal(payload.warnings.length, 1);
});

it('enforces the fetch budget even when requests are concurrent', async () => {
  let calls = 0;
  const budget = createExtractionFetch(async () => { calls += 1; return new Response('ok'); }, 3);
  await Promise.allSettled(Array.from({ length: 10 }, () => budget.fetch('https://example.com/')));
  assert.equal(calls, 3);
  assert.equal(budget.limited, true);
});
