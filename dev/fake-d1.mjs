/**
 * D1-compatible binding over Node's built-in SQLite (node:sqlite, Node 22.13+).
 * Implements the subset used by src/lib/storage/d1.js: prepare().bind().all()/first()/run() and batch().
 */
import { DatabaseSync } from 'node:sqlite';

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params.map(p => (p === undefined ? null : p)));
  }
  exec() {
    const st = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH)/i.test(this.sql)) {
      const rows = st.all(...this.params).map(r => ({ ...r }));
      return { success: true, results: rows, meta: { changes: 0, rows_read: rows.length } };
    }
    const info = st.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
  async all() { return this.exec(); }
  async run() { return this.exec(); }
  async first(col) {
    const r = this.exec().results[0] || null;
    return col && r ? r[col] : r;
  }
}

export class FakeD1 {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.queue = Promise.resolve();
  }
  prepare(sql) {
    return new Statement(this.db, sql);
  }
  /** Atomic, sequential batch (like D1). Serialised to mimic a single D1 primary. */
  batch(stmts) {
    const run = this.queue.then(() => {
      this.db.exec('BEGIN');
      try {
        const out = stmts.map(s => s.exec());
        this.db.exec('COMMIT');
        return out;
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
