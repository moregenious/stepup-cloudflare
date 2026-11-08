/**
 * Client sync engine: the browser's cached copy must not pass for server data
 * (automatic awards in store.runStaffAutomation are decided only on what the server has answered).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const cache = new Map();
globalThis.localStorage = {
  getItem: (k) => (cache.has(k) ? cache.get(k) : null),
  setItem: (k, v) => cache.set(k, String(v)),
  removeItem: (k) => cache.delete(k),
  key: (i) => [...cache.keys()][i],
  get length() { return cache.size; }
};

const { SyncEngine } = await import('../public/js/sync.js');

function makeEngine() {
  const seen = [];
  let state = null;
  const engine = new SyncEngine({
    getState: () => state,
    setState: (next) => { state = next; seen.push({ fresh: engine.fresh, records: next.pointRecords.length }); },
    materialize: () => {},
    beforeDiff: () => {},
    getSession: () => ({ role: 'admin', uid: 'admin' }),
    onRejected: () => {},
    onChange: () => {}
  });
  return { engine, seen };
}

function answerWith(shards) {
  globalThis.fetch = async (url) => new Response(JSON.stringify(
    String(url).includes('/api/state')
      ? { success: true, rev: 2, keys: ['pointRecords~0'], shards }
      : { success: true }
  ), { status: 200, headers: { 'content-type': 'application/json' } });
}

const cached = () => localStorage.setItem('stepup_cache_v2_admin_admin', JSON.stringify({
  shards: { 'pointRecords~0': { rev: 1, rows: { old: { id: 'old', date: '2026-11-01' } } } }
}));

test('the cached copy is not server data; the server answer is', async () => {
  cached();
  answerWith({ 'pointRecords~0': { rev: 2, full: false, rows: { gift: { id: 'gift', date: '2026-11-06' } }, del: [] } });
  const { engine, seen } = makeEngine();
  engine.startRealtime = async () => {}; // no polling timers in tests
  await engine.start();
  engine.stop();
  assert.deepEqual(seen, [{ fresh: false, records: 1 }, { fresh: true, records: 2 }]);
});

test('nothing new on the server still counts as its answer', async () => {
  cached();
  answerWith({});
  const { engine, seen } = makeEngine();
  engine.startRealtime = async () => {}; // no polling timers in tests
  await engine.start();
  engine.stop();
  assert.deepEqual(seen, [{ fresh: false, records: 1 }, { fresh: true, records: 1 }]);
});

test('no answer from the server: still only the cached copy', async () => {
  cached();
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const { engine, seen } = makeEngine();
  engine.startRealtime = async () => {}; // no polling timers in tests
  await engine.start();
  engine.stop();
  assert.deepEqual(seen, [{ fresh: false, records: 1 }]);
});
