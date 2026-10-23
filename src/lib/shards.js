/**
 * Data layout (Cloudflare D1 table `docs`, one row per document; free-tier friendly):
 *
 *   stepup/meta                   { rev, shards: "<json {shardKey: rev}>", version }   <- polled by browsers (1 row read)
 *   stepup_shards/<shardKey>      { v: rev, json: "<json {rows:{id:{d,r}}, tomb:{id:[r,ts]}, th}>" }
 *   stepup_private/credentials    { json: "<json {admin:{hash,logins}, teachers:{id:hash}}>" }
 *   stepup_private/login_guard    { json: "<json {key:[timestamps]}>" }
 *
 * Every entity ("row") belongs to a collection (students, groups, ...). Rows of one collection are
 * spread over a fixed number of shard documents so that each document stays far below the 2 MB
 * row limit and a full load costs ~25 row reads instead of one read per entity.
 * Each row keeps the revision `r` of its last change, so clients download only what changed.
 */

export const META_PATH = 'stepup/meta';
export const CREDS_PATH = 'stepup_private/credentials';
export const GUARD_PATH = 'stepup_private/login_guard';

export const shardPath = (key) => `stepup_shards/${key}`;

/** Array-of-entities collections (have `id`) and their bucket counts */
export const LIST_COLLS = {
  students: 4,
  teachers: 1,
  groups: 1,
  schedule: 1,
  pointRecords: 8,
  purchases: 2,
  shopItems: 1,
  activityLogs: 1
};

/** Object-map collections: row id = map key */
export const MAP_COLLS = {
  payments: 2,
  attendance: 2   // key: <groupId or ind-studentId>_<YYYY-MM-DD> -> { date, groupId, marks: { studentId: 'present' | 'absent' } }
};

/** Object-map collections where every key gets its own shard (large values, e.g. one textbook) */
export const PER_KEY_COLLS = new Set(['textbookLessons', 'textbookVocabularyPool']);

/** Anything else at the top level of the app state becomes a row of the "settings" collection */
export const SETTINGS = 'settings';

/** Top-level keys of the client state that are never persisted */
export const TRANSIENT_KEYS = new Set(['lastUpdated']);

export const MAX_SHARD_BYTES = 950 * 1024;
const TOMB_TTL_MS = 45 * 24 * 3600 * 1000;

export function isKnownColl(coll) {
  return coll in LIST_COLLS || coll in MAP_COLLS || PER_KEY_COLLS.has(coll) || coll === SETTINGS;
}

export function collKind(coll) {
  if (coll in LIST_COLLS) return 'list';
  if (coll in MAP_COLLS || PER_KEY_COLLS.has(coll)) return 'map';
  if (coll === SETTINGS) return 'settings';
  return null;
}

function hashStr(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function b64urlUtf8(s) {
  let bin = '';
  new TextEncoder().encode(String(s)).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function utf8Length(str) {
  // Fast upper bound first; exact count only when it matters
  if (str.length * 3 <= MAX_SHARD_BYTES) return str.length;
  return new TextEncoder().encode(str).length;
}

export function shardKeyFor(coll, id) {
  if (coll in LIST_COLLS) return `${coll}~${hashStr(id) % LIST_COLLS[coll]}`;
  if (coll in MAP_COLLS) return `${coll}~${hashStr(id) % MAP_COLLS[coll]}`;
  if (PER_KEY_COLLS.has(coll)) return `${coll}~k${b64urlUtf8(id)}`.slice(0, 1400);
  if (coll === SETTINGS) return `${SETTINGS}~0`;
  throw new Error('Unknown collection: ' + coll);
}

export function collOfShard(key) {
  return String(key).split('~')[0];
}

export function isValidShardKey(key) {
  return typeof key === 'string' && /^[A-Za-z]+~[A-Za-z0-9_-]+$/.test(key) && isKnownColl(collOfShard(key));
}

export function emptyShard() {
  return { v: 0, rows: {}, tomb: {}, th: 0 };
}

export function parseShardDoc(doc) {
  if (!doc) return emptyShard();
  let body = {};
  try { body = JSON.parse(doc.json || '{}'); } catch (e) { body = {}; }
  return {
    v: Number(doc.v) || 0,
    rows: body.rows || {},
    tomb: body.tomb || {},
    th: Number(body.th) || 0
  };
}

export function serializeShard(key, shard) {
  const json = JSON.stringify({ rows: shard.rows, tomb: shard.tomb, th: shard.th });
  if (utf8Length(json) > MAX_SHARD_BYTES) {
    const err = new Error(`Хранилище "${key}" почти заполнено (лимит строки D1 — 2 МБ, запас 950 КБ). Удалите лишние данные или увеличьте число шардов в src/lib/shards.js.`);
    err.code = 'shard_full';
    throw err;
  }
  return { v: shard.v, json };
}

export function pruneTombs(shard, now = Date.now()) {
  for (const [id, [r, ts]] of Object.entries(shard.tomb)) {
    if (now - (ts || 0) > TOMB_TTL_MS) {
      shard.th = Math.max(shard.th, r);
      delete shard.tomb[id];
    }
  }
}

export function parseMeta(doc) {
  if (!doc) return null;
  let shards = {};
  try { shards = typeof doc.shards === 'string' ? JSON.parse(doc.shards) : (doc.shards || {}); } catch (e) { shards = {}; }
  return { rev: Number(doc.rev) || 0, shards, version: doc.version || 2 };
}

export function serializeMeta(meta) {
  return {
    rev: meta.rev,
    shards: JSON.stringify(meta.shards),
    version: 2,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Convert a classic whole-state object (old db.json / Firestore crm/app_data + lessons_data / exportJSON)
 * into rows.
 */
export function stateToRows(state) {
  const rows = [];
  for (const [key, value] of Object.entries(state || {})) {
    if (TRANSIENT_KEYS.has(key) || value === undefined) continue;
    if (key in LIST_COLLS) {
      if (!Array.isArray(value)) continue;
      const seen = new Set();
      value.forEach((item, idx) => {
        if (!item || typeof item !== 'object') return;
        let id = item.id ? String(item.id) : `${key}-imported-${idx}`;
        while (seen.has(id)) id = id + '-dup';
        seen.add(id);
        rows.push({ coll: key, id, data: { ...item, id } });
      });
    } else if (key in MAP_COLLS || PER_KEY_COLLS.has(key)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      for (const [id, data] of Object.entries(value)) {
        if (data === undefined) continue;
        rows.push({ coll: key, id, data });
      }
    } else {
      rows.push({ coll: SETTINGS, id: key, data: value });
    }
  }
  return rows;
}
