import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { collectBrowserVideos } from '../public/browser-capture.js';

it('collects HLS resource URLs behind blob players, preserves signatures and never collects cookies', () => {
  const signed = 'https://media.example/stream.m3u8?key=a%2Bb&expires=123';
  let destination;
  const element = { currentSrc: 'blob:https://page.example/id', src: '', closest: () => null, getAttribute: () => null };
  const context = { URL, Map, JSON, encodeURIComponent,
    location: { href: 'https://page.example/article/clip#position=1', assign: (url) => { destination = url; } },
    document: { querySelectorAll: () => [element], documentElement: { innerHTML: '<script>const fileName="fake.mp4"</script>' }, get cookie() { throw new Error('Must not access cookies'); } },
    performance: { getEntriesByType: () => [{ name: signed }, { name: signed }, { name: 'https://media.example/poster.jpg' }] },
    alert: () => { throw new Error('No alert expected'); },
  };
  runInNewContext(`(${collectBrowserVideos.toString()})('https://tool.example')`, context);
  assert.ok(destination.startsWith('https://tool.example/capture.html#'));
  const payload = JSON.parse(decodeURIComponent(new URL(destination).hash.slice(1)));
  assert.equal(payload.pageUrl, 'https://page.example/article/clip');
  assert.deepEqual(payload.items, [{ url: signed, thumbnailUrl: '' }]);
});

it('asks for playback when a page exposes no usable URLs', () => {
  let message;
  runInNewContext(`(${collectBrowserVideos.toString()})('https://tool.example')`, { URL, Map, JSON,
    location: { href: 'https://page.example/article/clip', assign() { throw new Error('Unexpected navigation'); } },
    document: { querySelectorAll: () => [], documentElement: { innerHTML: '<p>movie.mp4</p>' } },
    performance: { getEntriesByType: () => [] }, alert: (value) => { message = value; },
  });
  assert.match(message, /動画を再生/);
});
