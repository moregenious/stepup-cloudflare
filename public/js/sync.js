/**
 * Client sync engine.
 *
 * The app keeps working with one big `store.state` object exactly like before. This engine:
 *  - downloads the state from the server split into shards (only what changed since last time),
 *  - computes a row-level diff between the last server copy and the local state on every save,
 *  - sends only the changed rows/fields to /api/push (the server validates permissions),
 *  - rebases local unsaved edits on top of fresh server data, so nothing is lost when two
 *    devices edit different things at the same time,
 *  - polls the server for changes (one tiny request; only changed shards are downloaded).
 */
import { apiRequest, setStatus, getServerConfig, getCloudStatus } from './api.js';

export const LIST_COLLS = ['students', 'teachers', 'groups', 'schedule', 'pointRecords', 'purchases', 'shopItems', 'activityLogs'];
export const MAP_COLLS = ['payments', 'attendance', 'textbookLessons', 'textbookVocabularyPool'];
const LIST_SET = new Set(LIST_COLLS);
const MAP_SET = new Set(MAP_COLLS);
const TRANSIENT_KEYS = new Set(['lastUpdated', 'exportedAt']);

/** Student fields computed by the server or derived on the client — never diffed */
const IGNORED_FIELDS = {
  students: new Set(['vocabularyPool', 'totalPoints', 'lifetimePoints', 'pointsLedger', 'gameLedger', 'surveyBonusAwarded', 'lastBirthdayBonusYear'])
};

const CACHE_PREFIX = 'stepup_cache_v2_';
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const jclone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const jeq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const byDateDesc = (field) => (a, b) => String(b?.[field] || b?.createdAt || '').localeCompare(String(a?.[field] || a?.createdAt || ''));
const SORTERS = {
  students: (a, b) => String(a?.fullName || '').localeCompare(String(b?.fullName || ''), 'ru'),  // alphabetical everywhere
  pointRecords: byDateDesc('date'),
  purchases: byDateDesc('date'),
  activityLogs: byDateDesc('timestamp'),
  shopItems: byDateDesc('createdAt')
};

function prepareRow(coll, data) {
  const ignored = IGNORED_FIELDS[coll];
  if (!ignored || !isPlain(data)) return data;
  const out = {};
  for (const [k, v] of Object.entries(data)) if (!ignored.has(k)) out[k] = v;
  return out;
}

function diffObj(a, b, path, set, unset) {
  for (const k of Object.keys(b)) {
    const bv = b[k];
    if (bv === undefined || typeof bv === 'function') continue;
    const av = a[k];
    if (av === undefined) set.push([[...path, k], jclone(bv)]);
    else if (isPlain(av) && isPlain(bv)) diffObj(av, bv, [...path, k], set, unset);
    else if (!jeq(av, bv)) set.push([[...path, k], jclone(bv)]);
  }
  for (const k of Object.keys(a)) {
    if (a[k] !== undefined && (b[k] === undefined || !(k in b))) unset.push([...path, k]);
  }
}

function rowOp(coll, id, oldVal, newVal) {
  const o = prepareRow(coll, oldVal);
  const n = prepareRow(coll, newVal);
  if (o === undefined && n === undefined) return null;
  if (n === undefined) return { c: coll, id, t: 'del' };
  if (o === undefined || !isPlain(o) || !isPlain(n)) {
    return jeq(o, n) ? null : { c: coll, id, t: 'put', v: jclone(n) };
  }
  if (jeq(o, n)) return null;
  const set = [];
  const unset = [];
  diffObj(o, n, [], set, unset);
  if (!set.length && !unset.length) return null;
  return { c: coll, id, t: 'patch', set, unset };
}

function indexList(list) {
  const m = new Map();
  (Array.isArray(list) ? list : []).forEach(item => {
    if (item && item.id !== undefined && item.id !== null && item.id !== '') m.set(String(item.id), item);
  });
  return m;
}

/** Row-level diff between two whole states */
export function diffStates(base, state) {
  const ops = [];
  for (const coll of LIST_COLLS) {
    const a = indexList(base?.[coll]);
    const b = indexList(state?.[coll]);
    for (const [id, nv] of b) { const op = rowOp(coll, id, a.get(id), nv); if (op) ops.push(op); }
    for (const id of a.keys()) if (!b.has(id)) ops.push({ c: coll, id, t: 'del' });
  }
  for (const coll of MAP_COLLS) {
    const a = isPlain(base?.[coll]) ? base[coll] : {};
    const b = isPlain(state?.[coll]) ? state[coll] : {};
    for (const id of Object.keys(b)) { const op = rowOp(coll, id, a[id], b[id]); if (op) ops.push(op); }
    for (const id of Object.keys(a)) if (b[id] === undefined && a[id] !== undefined) ops.push({ c: coll, id, t: 'del' });
  }
  const settingsKeys = new Set([...Object.keys(base || {}), ...Object.keys(state || {})]);
  for (const key of settingsKeys) {
    if (LIST_SET.has(key) || MAP_SET.has(key) || TRANSIENT_KEYS.has(key)) continue;
    const av = base?.[key];
    const bv = state?.[key];
    if (bv === undefined && av !== undefined) ops.push({ c: 'settings', id: key, t: 'del' });
    else if (bv !== undefined && typeof bv !== 'function' && !jeq(av, bv)) ops.push({ c: 'settings', id: key, t: 'put', v: jclone(bv) });
  }
  return ops;
}

function setAt(obj, path, value) {
  let node = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!isPlain(node[path[i]])) node[path[i]] = {};
    node = node[path[i]];
  }
  node[path[path.length - 1]] = jclone(value);
}

function unsetAt(obj, path) {
  let node = obj;
  for (let i = 0; i < path.length - 1; i++) {
    node = node?.[path[i]];
    if (!isPlain(node)) return;
  }
  if (isPlain(node)) delete node[path[path.length - 1]];
}

function applyPatchInPlace(target, op) {
  (op.unset || []).forEach(p => unsetAt(target, p));
  (op.set || []).forEach(([p, v]) => setAt(target, p, v));
}

/** Apply row ops to a whole state object (in place) */
export function applyOps(state, ops) {
  for (const op of ops) {
    if (LIST_SET.has(op.c)) {
      if (!Array.isArray(state[op.c])) state[op.c] = [];
      const list = state[op.c];
      const idx = list.findIndex(x => x && String(x.id) === op.id);
      if (op.t === 'del') { if (idx !== -1) list.splice(idx, 1); }
      else if (op.t === 'put') {
        if (idx !== -1) list[idx] = jclone(op.v);
        else if (SORTERS[op.c]) list.unshift(jclone(op.v));
        else list.push(jclone(op.v));
      } else if (op.t === 'patch' && idx !== -1) applyPatchInPlace(list[idx], op);
    } else if (MAP_SET.has(op.c)) {
      if (!isPlain(state[op.c])) state[op.c] = {};
      if (op.t === 'del') delete state[op.c][op.id];
      else if (op.t === 'put') state[op.c][op.id] = jclone(op.v);
      else if (op.t === 'patch') {
        if (!isPlain(state[op.c][op.id])) state[op.c][op.id] = {};
        applyPatchInPlace(state[op.c][op.id], op);
      }
    } else if (op.c === 'settings') {
      if (op.t === 'del') delete state[op.id];
      else if (op.t === 'put') state[op.id] = jclone(op.v);
      else if (op.t === 'patch') {
        if (!isPlain(state[op.id])) state[op.id] = {};
        applyPatchInPlace(state[op.id], op);
      }
    }
  }
  return state;
}

const opKey = (op) => `${op.c}\u0001${op.id}`;

export class SyncEngine {
  /**
   * @param {object} hooks
   *   getState(), setState(state), materialize(state), beforeDiff(state),
   *   getSession() -> { role, uid } | null, onRejected(results), onChange()
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.shards = {};
    this.base = null;
    this.ready = false;
    this.chain = Promise.resolve();
    this.pushTimer = null;
    this.retryTimer = null;
    this.pollTimer = null;
    this.unsubscribeMeta = null;
    this.remoteMeta = null;
    this.started = false;
    this.readyResolvers = [];
    this.sent = new Map();
    this.dirty = false;        // local edits waiting to be sent
    this.pushing = false;      // a push request is in flight
    this.retryCount = 0;
  }

  // ---------------- lifecycle ----------------
  async start() {
    if (this.started) return;
    this.started = true;
    this.loadCache();
    if (Object.keys(this.shards).length) {
      this.rebase();
      this.markReady();
    }
    setStatus('connecting');
    try {
      await this.enqueue(() => this.pullNow({ full: true }));
      this.markReady();
    } catch (err) {
      setStatus(err.network ? 'offline' : 'error', err);
      if (Object.keys(this.shards).length) this.markReady();
    }
    this.startRealtime();
    this.bindWindowEvents();
  }

  stop({ clearCache = false } = {}) {
    this.started = false;
    clearTimeout(this.pushTimer);
    clearTimeout(this.retryTimer);
    clearInterval(this.pollTimer);
    if (this.unsubscribeMeta) { try { this.unsubscribeMeta(); } catch (e) { /* ignore */ } }
    this.unsubscribeMeta = null;
    this.shards = {};
    this.base = null;
    this.ready = false;
    this.remoteMeta = null;
    this.sent.clear();
    this.dirty = false;
    this.pushing = false;
    this.retryCount = 0;
    if (clearCache) SyncEngine.clearAllCaches();
  }

  whenReady() {
    if (this.ready) return Promise.resolve();
    return new Promise(resolve => this.readyResolvers.push(resolve));
  }

  markReady() {
    if (this.ready) return;
    this.ready = true;
    this.readyResolvers.splice(0).forEach(r => r());
  }

  enqueue(task) {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => {});
    return run;
  }

  // ---------------- cache ----------------
  cacheKey() {
    const s = this.hooks.getSession();
    return s ? `${CACHE_PREFIX}${s.role}_${s.uid}` : null;
  }

  loadCache() {
    const key = this.cacheKey();
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) this.shards = JSON.parse(raw).shards || {};
    } catch (e) { this.shards = {}; }
  }

  saveCache() {
    clearTimeout(this._cacheTimer);
    this._cacheTimer = setTimeout(() => {
      const key = this.cacheKey();
      if (!key) return;
      try { localStorage.setItem(key, JSON.stringify({ shards: this.shards })); }
      catch (e) { try { localStorage.removeItem(key); } catch (e2) { /* ignore */ } }
    }, 800);
  }

  static clearAllCaches() {
    try {
      Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  }

  knownRevs() {
    const out = {};
    for (const [k, s] of Object.entries(this.shards)) out[k] = s.rev || 0;
    return out;
  }

  // ---------------- assembling ----------------
  assemble() {
    const state = {};
    LIST_COLLS.forEach(c => { state[c] = []; });
    MAP_COLLS.forEach(c => { state[c] = {}; });
    for (const [key, shard] of Object.entries(this.shards)) {
      const coll = key.split('~')[0];
      for (const [id, data] of Object.entries(shard.rows || {})) {
        if (LIST_SET.has(coll)) state[coll].push(data);
        else if (MAP_SET.has(coll)) state[coll][id] = data;
        else if (coll === 'settings') state[id] = data;
      }
    }
    for (const [coll, sorter] of Object.entries(SORTERS)) state[coll].sort(sorter);
    return jclone(state);
  }

  /** Rebuild local state = fresh server data + local edits that were not saved yet */
  rebase({ drop = null } = {}) {
    const current = this.hooks.getState();
    if (this.base && current) this.hooks.beforeDiff(current);
    let localOps = (this.base && current) ? diffStates(this.base, current) : [];
    if (drop) localOps = localOps.filter(op => !drop.has(opKey(op)));
    const newBase = this.assemble();
    const next = jclone(newBase);
    applyOps(next, localOps);
    this.base = newBase;
    this.hooks.materialize(next);
    this.hooks.setState(next);
    this.hooks.onChange();
  }

  applyShardResponse(shardsResp, { fullKeys = null } = {}) {
    let changed = false;
    for (const [key, s] of Object.entries(shardsResp || {})) {
      const sh = this.shards[key] || (this.shards[key] = { rev: 0, rows: {} });
      if (s.full) sh.rows = {};
      if (s.shard) {
        // Raw shard document: { rows: { id: { d: data, r: rev } } }
        for (const [id, row] of Object.entries(s.shard.rows || {})) sh.rows[id] = row ? row.d : row;
      }
      Object.assign(sh.rows, s.rows || {});
      (s.del || []).forEach(id => { delete sh.rows[id]; });
      if (s.prev === undefined || s.full || sh.rev === s.prev) sh.rev = s.rev;
      changed = true;
    }
    if (fullKeys) {
      for (const key of Object.keys(this.shards)) {
        if (!fullKeys.includes(key)) { delete this.shards[key]; changed = true; }
      }
    }
    return changed;
  }

  // ---------------- pull ----------------
  async pullNow({ full = false, want = null } = {}) {
    const body = want ? { want } : { known: this.knownRevs() };
    const resp = await apiRequest('/api/state', { body });
    const changed = this.applyShardResponse(resp.shards, { fullKeys: resp.keys || null });
    if (changed || !this.base) {
      this.rebase();
      this.saveCache();
    }
    if (this.dirty || this.pushing) setStatus('saving');
    else if (getCloudStatus() !== 'saving') setStatus('connected');
    return changed;
  }

  pull(opts) {
    return this.enqueue(async () => {
      // Unsaved edits go first: a slow check for updates must not hold them back
      if (this.dirty) await this.pushNow();
      return this.pullNow(opts);
    }).catch(err => {
      setStatus(err.network ? 'offline' : 'error', err);
    });
  }

  // ---------------- push ----------------
  schedulePush(immediate = false) {
    if (!this.started) return;
    this.dirty = true;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.enqueue(() => this.pushNow()).catch(() => {});
    }, immediate ? 0 : 150);
  }

  filterForRole(ops) {
    const s = this.hooks.getSession();
    if (!s) return [];
    if (s.role === 'admin') return ops;
    if (s.role === 'teacher') {
      return ops.filter(op => {
        if (op.c === 'settings' && op.id === 'admin') return false;
        if (op.c === 'teachers') return op.id === s.uid && op.t === 'patch';
        return true;
      });
    }
    // student
    return ops.filter(op => {
      if (op.c === 'students') return op.id === s.uid && op.t === 'patch';
      if (op.c === 'pointRecords' || op.c === 'purchases') return op.t === 'put' && op.v?.studentId === s.uid;
      if (op.c === 'activityLogs') return op.t === 'put';
      return false;
    });
  }

  /** Local edits not yet confirmed by the server */
  pendingOps() {
    if (!this.base) return [];
    const state = this.hooks.getState();
    if (!state) return [];
    this.hooks.beforeDiff(state);
    return this.filterForRole(diffStates(this.base, state));
  }

  hasPendingChanges() {
    if (!this.started) return false;
    return this.pushing || this.pendingOps().length > 0;
  }

  /** Send everything now and wait (used before logout). Resolves true when nothing is left unsaved. */
  async flush(timeoutMs = 20000) {
    if (!this.started) return true;
    clearTimeout(this.pushTimer);
    clearTimeout(this.retryTimer);
    const work = this.enqueue(() => this.pushNow()).catch(() => {});
    await Promise.race([work, new Promise(r => setTimeout(r, timeoutMs))]);
    return !this.hasPendingChanges();
  }

  async pushNow({ keepalive = false } = {}) {
    if (!this.base) return;
    this.dirty = false;
    const ops = this.pendingOps();
    if (!ops.length) return;

    setStatus('saving');
    let resp;
    this.pushing = true;
    try {
      const body = { ops };
      // Big batches (e.g. a whole textbook) get more time on a slow connection
      const size = JSON.stringify(body).length;
      resp = await apiRequest('/api/push', { body, timeoutMs: 10000 + Math.ceil(size / 10), keepalive });
      this.retryCount = 0;
    } catch (err) {
      this.dirty = true;
      if (err.status === 401 || err.status === 403) { setStatus('error', err); return; }
      setStatus(err.network ? 'offline' : 'error', err);
      clearTimeout(this.retryTimer);
      // 2 s, 4 s, 8 s, then every 15 s
      const delay = err.network ? Math.min(15000, 2000 * 2 ** this.retryCount) : 15000;
      this.retryCount += 1;
      this.retryTimer = setTimeout(() => this.schedulePush(true), delay);
      if (!err.network && err.status >= 400 && err.status < 500) {
        // Server refused the whole batch (validation error): drop these local edits to avoid loops
        this.hooks.onRejected([{ ok: false, reason: err.message }]);
        this.applyShardResponse({});
        this.rebase({ drop: new Set(ops.map(opKey)) });
      }
      return;
    } finally {
      this.pushing = false;
    }

    this.applyShardResponse(resp.shards);
    const rejected = (resp.results || []).filter(r => !r.ok);
    // Rows we just sent are now owned by the server version; keep only edits made during the request
    const drop = new Set();
    const now = this.hooks.getState();
    this.hooks.beforeDiff(now);
    const sentByKey = new Map(ops.map(op => [opKey(op), op]));
    const stillDiff = diffStates(this.base, now);
    for (const op of stillDiff) {
      const sent = sentByKey.get(opKey(op));
      if (sent && jeq(sent, op)) drop.add(opKey(op));
    }
    rejected.forEach(r => { if (ops[r.i]) drop.add(opKey(ops[r.i])); });
    this.rebase({ drop });
    this.saveCache();
    if (rejected.length) this.hooks.onRejected(rejected);
    setStatus(this.dirty ? 'saving' : 'connected');
  }

  // ---------------- change polling ----------------
  async startRealtime() {
    let cfg = null;
    try { cfg = await getServerConfig(); } catch (e) { cfg = null; }
    const session = this.hooks.getSession();
    const staff = session && (session.role === 'admin' || session.role === 'teacher');
    const sec = staff ? (cfg?.pollStaffSec || 15) : (cfg?.pollStudentSec || 30);
    this.startPolling(sec * 1000);
  }

  startPolling(intervalMs) {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      this.pull({ full: true });
    }, intervalMs);
  }

  bindWindowEvents() {
    if (this._eventsBound || typeof window === 'undefined') return;
    this._eventsBound = true;
    const refresh = () => {
      if (!this.started) return;
      const now = Date.now();
      if (this._lastFocusPull && now - this._lastFocusPull < 3000) return;
      this._lastFocusPull = now;
      this.pull({ full: true });
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', () => { refresh(); this.schedulePush(true); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { refresh(); return; }
      // Tab hidden / phone locked / page closing: send unsaved edits right away, surviving page close
      if (this.started && this.dirty) {
        clearTimeout(this.pushTimer);
        this.enqueue(() => this.pushNow({ keepalive: true })).catch(() => {});
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (!this.hasPendingChanges()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }
}
