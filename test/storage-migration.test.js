import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { it } from 'node:test';

const key = 'video-url-extractor:saved-videos';
function storage(items, fetchImpl) {
  const data = new Map([[key, JSON.stringify(items)]]);
  const context = {
    window: {}, URL, localStorage: { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) }, fetch: fetchImpl,
  };
  runInNewContext(readFileSync(new URL('../public/storage.js', import.meta.url), 'utf8'), context);
  return { api: context.window.videoUrlStorage, data };
}

it('imports the full legacy list in free-tier sized batches and retains the original backup', async () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ url: `https://media.example/${i}.mp4`, savedAt: '2026-01-01T00:00:00.000Z' }));
  const batches = [];
  const { api, data } = storage(items, async (path, options) => {
    assert.equal(path, '/api/import');
    batches.push(JSON.parse(options.body).items);
    return Response.json({ imported: batches.at(-1).length });
  });
  assert.equal(api.localImportNeeded(), true);
  assert.equal(await api.importLocalVideos(), 200);
  assert.deepEqual(batches.flat(), items);
  assert.ok(batches.every((batch) => batch.length <= 40));
  assert.equal(api.localImportNeeded(), false);
  assert.equal(data.get(key), JSON.stringify(items));
});

it('leaves legacy data and the import action available after a partial network failure', async () => {
  const items = Array.from({ length: 80 }, (_, i) => ({ url: `https://media.example/${i}.mp4` }));
  let calls = 0;
  const { api, data } = storage(items, async () => {
    if (++calls === 2) throw new Error('offline');
    return Response.json({ imported: 40 });
  });
  await assert.rejects(api.importLocalVideos(), /offline/);
  assert.equal(api.localImportNeeded(), true);
  assert.equal(data.get(key), JSON.stringify(items));
  await api.importLocalVideos();
  assert.equal(api.localImportNeeded(), false);
});
