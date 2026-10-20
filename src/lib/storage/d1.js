/**
 * Cloudflare D1 document store.
 *
 * Table docs(path TEXT PRIMARY KEY, ver INTEGER, tok TEXT, data TEXT, body TEXT)
 *   data = JSON of the document fields except `json`
 *   body = the document's `json` field stored raw (large shard payloads are never double-escaped)
 *
 * Transactions are optimistic: every write transaction of the app also writes the document it read
 * first (the "anchor", normally stepup/meta). The commit batch first updates the anchor only if its
 * version is unchanged (stamping a unique token); all other writes run only if that token is present.
 * D1 runs a batch atomically and sequentially, so either everything is written or nothing is.
 */
import { META_PATH } from '../shards.js';
import { randomHex } from '../security.js';

const SCHEMA = 'CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, ver INTEGER NOT NULL DEFAULT 0, tok TEXT, data TEXT, body TEXT)';
const MAX_IN = 90; // D1: max 100 bound parameters per query

function toRow(obj) {
  const { json, ...rest } = obj || {};
  return { data: JSON.stringify(rest), body: typeof json === 'string' ? json : null };
}

function fromRow(row) {
  if (!row) return null;
  let obj = {};
  try { obj = row.data ? JSON.parse(row.data) : {}; } catch (e) { obj = {}; }
  if (row.body !== null && row.body !== undefined) obj.json = row.body;
  return obj;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class D1Storage {
  constructor(db) {
    this.db = db;
    this.ready = null;
  }

  init() {
    if (!this.ready) {
      this.ready = this.db.prepare(SCHEMA).run().catch(err => { this.ready = null; throw err; });
    }
    return this.ready;
  }

  async readRows(paths) {
    await this.init();
    const unique = [...new Set(paths)];
    const map = new Map();
    for (let i = 0; i < unique.length; i += MAX_IN) {
      const chunk = unique.slice(i, i + MAX_IN);
      const sql = `SELECT path, ver, data, body FROM docs WHERE path IN (${chunk.map(() => '?').join(',')})`;
      const res = await this.db.prepare(sql).bind(...chunk).all();
      (res.results || []).forEach(r => map.set(r.path, r));
    }
    return map;
  }

  async get(path) {
    const map = await this.readRows([path]);
    return fromRow(map.get(path));
  }

  async getMany(paths) {
    const map = await this.readRows(paths);
    return paths.map(p => fromRow(map.get(p)));
  }

  upsertStmt(path, obj) {
    const { data, body } = toRow(obj);
    return this.db.prepare(
      'INSERT INTO docs (path, ver, tok, data, body) VALUES (?, 1, NULL, ?, ?) ' +
      'ON CONFLICT(path) DO UPDATE SET data = excluded.data, body = excluded.body, ver = docs.ver + 1, tok = NULL'
    ).bind(path, data, body);
  }

  async setMany(entries) {
    await this.init();
    const stmts = entries.map(({ path, data }) => data === null
      ? this.db.prepare('DELETE FROM docs WHERE path = ?').bind(path)
      : this.upsertStmt(path, data));
    for (let i = 0; i < stmts.length; i += 40) await this.db.batch(stmts.slice(i, i + 40));
  }

  async transaction(fn, { retries = 8 } = {}) {
    await this.init();
    for (let attempt = 1; ; attempt++) {
      const versions = new Map();
      const order = [];
      const writes = new Map();
      let wrote = false;
      const tx = {
        getMany: async (paths) => {
          if (wrote) throw new Error('Transaction: все чтения должны выполняться до записей');
          const map = await this.readRows(paths);
          paths.forEach(p => {
            if (!versions.has(p)) { versions.set(p, map.get(p)?.ver || 0); order.push(p); }
          });
          return paths.map(p => fromRow(map.get(p)));
        },
        get: async (p) => (await tx.getMany([p]))[0],
        set: (p, data) => { wrote = true; writes.set(p, data); },
        delete: (p) => { wrote = true; writes.set(p, null); }
      };

      const result = await fn(tx);
      if (!writes.size) return result;

      const anchor = versions.has(META_PATH) ? META_PATH : order[0];
      const token = randomHex(12);
      const stmts = [];
      const anchorVer = anchor ? versions.get(anchor) : 0;
      if (anchor) {
        const w = writes.has(anchor) ? writes.get(anchor) : undefined;
        if (w === undefined || w === null) {
          stmts.push(this.db.prepare('UPDATE docs SET ver = ver + 1, tok = ? WHERE path = ? AND ver = ?').bind(token, anchor, anchorVer));
        } else if (anchorVer > 0) {
          const { data, body } = toRow(w);
          stmts.push(this.db.prepare('UPDATE docs SET data = ?, body = ?, ver = ver + 1, tok = ? WHERE path = ? AND ver = ?').bind(data, body, token, anchor, anchorVer));
        } else {
          const { data, body } = toRow(w);
          stmts.push(this.db.prepare('INSERT INTO docs (path, ver, tok, data, body) VALUES (?, 1, ?, ?, ?) ON CONFLICT(path) DO NOTHING').bind(anchor, token, data, body));
        }
      }
      const guard = 'EXISTS (SELECT 1 FROM docs WHERE path = ? AND tok = ?)';
      for (const [p, w] of writes) {
        if (p === anchor) continue;
        if (w === null) {
          stmts.push(this.db.prepare(`DELETE FROM docs WHERE path = ? AND ${guard}`).bind(p, anchor, token));
        } else {
          const { data, body } = toRow(w);
          stmts.push(this.db.prepare(
            `INSERT INTO docs (path, ver, tok, data, body) SELECT ?, 1, NULL, ?, ? WHERE ${guard} ` +
            'ON CONFLICT(path) DO UPDATE SET data = excluded.data, body = excluded.body, ver = docs.ver + 1'
          ).bind(p, data, body, anchor, token));
        }
      }
      if (anchor && writes.get(anchor) === null) {
        stmts.push(this.db.prepare('DELETE FROM docs WHERE path = ? AND tok = ?').bind(anchor, token));
      }

      const results = await this.db.batch(stmts);
      if (!anchor || (results[0]?.meta?.changes || 0) === 1) return result;
      if (attempt >= retries) {
        const err = new Error('Не удалось сохранить: слишком много одновременных изменений, повторите попытку');
        err.status = 409;
        throw err;
      }
      await sleep(Math.min(1500, 40 * 2 ** attempt) + Math.random() * 60);
    }
  }
}
