/**
 * Behaviour analytics: append-only event log in its own D1 table (not part of the synced app data).
 *
 *   events(id, ts, day, role, uid, gid, sid, type, props)
 *     ts    ISO time the event happened (client clock, checked against the server clock)
 *     day   school day (UTC+5) for fast filtering
 *     uid   user id from the session (never taken from the client), gid = student's group
 *     sid   random id of one app session (page load), to group events into visits
 *     type  e.g. app_open, page_view, game_end; props = small JSON object
 *
 * Free tier: one event = one row written (+1 for the index). ~90 students give a few thousand rows a day,
 * far below the 100 000 rows/day D1 limit.
 */
import { getEnv } from './env.js';
import { schoolDay } from '../../public/js/shared/gameStreak.js';
import { anonId } from './security.js';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL, role TEXT, uid TEXT, gid TEXT, sid TEXT, type TEXT NOT NULL, props TEXT)',
  'CREATE INDEX IF NOT EXISTS events_day ON events(day)'
];
export const MAX_BATCH = 50;
const MAX_PROPS = 1000;
const TYPE_RE = /^[a-z][a-z0-9_]{1,39}$/;

let ready = null;
async function ensureTable(db) {
  if (!ready) {
    ready = db.batch(SCHEMA.map(sql => db.prepare(sql))).catch(err => { ready = null; throw err; });
  }
  return ready;
}

function cleanProps(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const out = {};
  for (const [k, v] of Object.entries(p).slice(0, 20)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
  }
  const s = JSON.stringify(out);
  return s === '{}' ? null : s.slice(0, MAX_PROPS);
}

/** Validate client events; the user comes from the session, the time is clamped to the last 3 days */
export function normalizeEvents(user, raw, now = new Date()) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_BATCH) : [];
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object' || !TYPE_RE.test(String(e.t || ''))) continue;
    let ts = new Date(e.ts);
    if (isNaN(ts) || ts > new Date(now.getTime() + 300000) || ts < new Date(now.getTime() - 3 * 86400000)) ts = now;
    out.push({
      ts: ts.toISOString(),
      day: schoolDay(ts),
      role: user.role,
      uid: user.uid,
      gid: typeof e.gid === 'string' ? e.gid.slice(0, 80) : null,
      sid: typeof e.sid === 'string' ? e.sid.slice(0, 40) : null,
      type: String(e.t),
      props: cleanProps(e.p)
    });
  }
  return out;
}

export async function saveEvents(rows) {
  if (!rows.length) return 0;
  const db = getEnv().DB;
  await ensureTable(db);
  const stmt = db.prepare('INSERT INTO events (ts, day, role, uid, gid, sid, type, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  await db.batch(rows.map(r => stmt.bind(r.ts, r.day, r.role, r.uid, r.gid, r.sid, r.type, r.props)));
  return rows.length;
}

/** Server-side event (e.g. a successful login). Never breaks the request it is attached to. */
export async function logServerEvent(user, type, props = {}) {
  try { await saveEvents(normalizeEvents(user, [{ t: type, p: props }])); } catch (e) { console.warn('[events]', e?.message || e); }
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** CSV export for analysis. anon=true replaces user ids with stable pseudonyms. */
export async function exportEventsCsv({ from, to, anon = false, limit = 200000 }) {
  const db = getEnv().DB;
  await ensureTable(db);
  const res = await db.prepare('SELECT id, ts, day, role, uid, gid, sid, type, props FROM events WHERE day >= ? AND day <= ? ORDER BY id LIMIT ?')
    .bind(from, to, limit).all();
  const rows = res.results || [];
  const ids = new Map();
  const pseudo = async (id) => {
    if (!id || !anon) return id;
    if (!ids.has(id)) ids.set(id, id === 'admin' ? 'admin' : await anonId(id));
    return ids.get(id);
  };
  const lines = ['id,ts,day,role,user,group,session,type,props'];
  for (const r of rows) {
    lines.push([r.id, r.ts, r.day, r.role, await pseudo(r.uid), r.gid, r.sid, r.type, r.props].map(csvCell).join(','));
  }
  return { csv: '﻿' + lines.join('\n') + '\n', count: rows.length };
}
