/**
 * Sync engine: bootstrap/migration, role-aware reads and validated, transactional writes.
 */
import { config } from './config.js';
import { getStorage } from './storage/index.js';
import { HttpError } from './http.js';
import { hashPassword, derivePin } from './security.js';
import {
  META_PATH, CREDS_PATH, SETTINGS, LIST_COLLS,
  shardPath, shardKeyFor, collOfShard, isKnownColl, isValidShardKey, emptyShard, parseShardDoc,
  serializeShard, pruneTombs, parseMeta, serializeMeta, stateToRows
} from './shards.js';
import {
  STUDENT_SERVER_FIELDS, STUDENT_DERIVED_FIELDS, SELF_DENY, collectionWritable, filterSelfPatch, sanitizeRow
} from './rules.js';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const ACTIVITY_LOG_CAP = 300;
const DEFAULT_ADMIN_LOGINS = ['admin'];

// ======================================================================
// Path helpers for patch ops
// ======================================================================
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function setPath(target, path, value) {
  let node = target;
  for (let i = 0; i < path.length - 1; i++) {
    const k = String(path[i]);
    if (!isPlainObject(node[k])) node[k] = {};
    node = node[k];
  }
  node[String(path[path.length - 1])] = clone(value);
}

function unsetPath(target, path) {
  let node = target;
  for (let i = 0; i < path.length - 1; i++) {
    node = node?.[String(path[i])];
    if (!isPlainObject(node)) return;
  }
  if (isPlainObject(node)) delete node[String(path[path.length - 1])];
}

export function applyPatch(base, op) {
  const value = isPlainObject(base) ? clone(base) : {};
  for (const path of op.unset || []) if (Array.isArray(path) && path.length) unsetPath(value, path);
  for (const [path, v] of op.set || []) if (Array.isArray(path) && path.length) setPath(value, path, v);
  return value;
}

// ======================================================================
// Points ledger (server-authoritative balances)
// ======================================================================
function pointContribution(rec) {
  if (!rec || !rec.studentId) return null;
  const pts = Number(rec.points) || 0;
  return { sid: rec.studentId, gross: pts, life: (pts > 0 && !rec.excludeFromRating) ? pts : 0, spent: 0 };
}

function purchaseContribution(p) {
  if (!p || !p.studentId || p.status === 'cancelled') return null;
  return { sid: p.studentId, gross: 0, life: 0, spent: Number(p.itemPrice) || Number(p.price) || 0 };
}

function emptyLedger() {
  return { gross: 0, life: 0, spent: 0 };
}

function applyLedgerToStudent(student, ledger) {
  const net = Math.max(0, ledger.gross - ledger.spent);
  student.pointsLedger = { gross: ledger.gross, life: ledger.life, spent: ledger.spent };
  student.totalPoints = net;
  student.lifetimePoints = Math.max(net, ledger.life);
}

function masteredWordsFromPool(pool) {
  const out = {};
  if (!isPlainObject(pool)) return out;
  for (const [tb, words] of Object.entries(pool)) {
    if (!Array.isArray(words)) continue;
    const list = words.filter(w => w && w.isMastered && w.word).map(w => String(w.word).toLowerCase().trim());
    if (list.length) out[tb] = [...new Set(list)].sort();
  }
  return out;
}

function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ======================================================================
// Bootstrap / import
// ======================================================================
async function buildAdminCreds(adminRow, existing = null) {
  const pass = config.bootstrapAdminPassword || adminRow?.password;
  if (!pass && !existing?.hash) {
    throw new Error('Не задан пароль администратора: добавьте секрет ADMIN_PASSWORD (npx wrangler secret put ADMIN_PASSWORD) или импортируйте резервную копию.');
  }
  const logins = new Set(DEFAULT_ADMIN_LOGINS);
  if (config.bootstrapAdminLogin) logins.add(config.bootstrapAdminLogin.toLowerCase());
  if (adminRow?.login) logins.add(String(adminRow.login).toLowerCase());
  if (adminRow?.email) logins.add(String(adminRow.email).toLowerCase());
  return {
    hash: existing?.hash && !adminRow?.password && !config.bootstrapAdminPassword ? existing.hash : await hashPassword(String(pass)),
    logins: [...logins]
  };
}

/**
 * Turn a whole classic state object into shard documents + credentials.
 * Used for the first start (migration from crm/app_data) and for restoring backups.
 */
export async function buildDatabaseFromState(state, { rev = 1, existingCreds = null } = {}) {
  const rows = stateToRows(state);
  const creds = { admin: null, teachers: {} };

  // Ledgers from point records and purchases
  const ledgers = new Map();
  const surveyAwarded = new Set();
  for (const row of rows) {
    const c = row.coll === 'pointRecords' ? pointContribution(row.data)
      : row.coll === 'purchases' ? purchaseContribution(row.data) : null;
    if (!c) continue;
    const l = ledgers.get(c.sid) || emptyLedger();
    l.gross += c.gross; l.life += c.life; l.spent += c.spent;
    ledgers.set(c.sid, l);
    if (row.coll === 'pointRecords' && row.data.category === 'Анкета') surveyAwarded.add(c.sid);
  }

  let adminRow = null;
  for (const row of rows) {
    if (row.coll === 'teachers') {
      const { password, ...rest } = row.data;
      const existingHash = existingCreds?.teachers?.[row.id];
      creds.teachers[row.id] = (!password && existingHash) ? existingHash : await hashPassword(String(password || '123').trim());
      row.data = rest;
    } else if (row.coll === 'students') {
      const s = { ...row.data };
      if (s.vocabularyPool) {
        const mastered = masteredWordsFromPool(s.vocabularyPool);
        s.masteredWords = { ...(s.masteredWords || {}), ...mastered };
      }
      for (const f of STUDENT_DERIVED_FIELDS) delete s[f];
      delete s.password;
      s.pin = derivePin(s);
      applyLedgerToStudent(s, ledgers.get(s.id) || emptyLedger());
      if (surveyAwarded.has(s.id)) s.surveyBonusAwarded = true;
      row.data = s;
    } else if (row.coll === SETTINGS && row.id === 'admin') {
      adminRow = row.data || {};
      const { password, ...rest } = adminRow;
      row.data = rest;
    }
  }
  creds.admin = await buildAdminCreds(adminRow, existingCreds?.admin);
  if (!rows.some(r => r.coll === SETTINGS && r.id === 'admin')) {
    rows.push({ coll: SETTINGS, id: 'admin', data: { name: 'Администратор', login: config.bootstrapAdminLogin || 'admin' } });
  }

  const shards = {};
  for (const row of rows) {
    const key = shardKeyFor(row.coll, row.id);
    if (!shards[key]) shards[key] = emptyShard();
    shards[key].rows[row.id] = { d: row.data, r: rev };
  }
  // Make sure the always-present shards exist even when empty
  for (const coll of Object.keys(LIST_COLLS)) {
    for (let i = 0; i < LIST_COLLS[coll]; i++) {
      const key = `${coll}~${i}`;
      if (!shards[key]) shards[key] = emptyShard();
    }
  }
  if (!shards[`${SETTINGS}~0`]) shards[`${SETTINGS}~0`] = emptyShard();

  const meta = { rev, shards: {} };
  for (const [key, sh] of Object.entries(shards)) {
    sh.v = rev;
    sh.th = rev; // clients holding an older copy must re-download the whole shard
    meta.shards[key] = rev;
  }
  return { shards, meta, creds };
}

function seedState() {
  return {
    admin: { name: 'Администратор', login: config.bootstrapAdminLogin || 'admin', email: '' },
    teachers: [], groups: [], students: [], schedule: [], pointRecords: [], purchases: [],
    activityLogs: [], payments: {}, textbookLessons: {}, textbookVocabularyPool: {},
    deletedStudents: [], deletedGroups: [], deletedTextbooks: [], vacationMode: false
  };
}

export async function writeDatabase(storage, built, { previousMeta = null } = {}) {
  const entries = [];
  for (const [key, sh] of Object.entries(built.shards)) {
    entries.push({ path: shardPath(key), data: serializeShard(key, sh) });
  }
  // Shards that existed before but are absent now: keep them, but empty (clients will drop their rows)
  if (previousMeta) {
    for (const key of Object.keys(previousMeta.shards || {})) {
      if (!built.shards[key]) {
        const sh = emptyShard();
        sh.v = built.meta.rev; sh.th = built.meta.rev;
        entries.push({ path: shardPath(key), data: serializeShard(key, sh) });
        built.meta.shards[key] = built.meta.rev;
      }
    }
  }
  entries.push({ path: CREDS_PATH, data: { json: JSON.stringify(built.creds) } });
  await storage.setMany(entries);
  // Meta last: its existence marks a complete database
  await storage.setMany([{ path: META_PATH, data: serializeMeta(built.meta) }]);
}

let bootstrapPromise = null;

export function ensureBootstrapped() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const storage = getStorage();
      const metaDoc = await storage.get(META_PATH);
      if (metaDoc) return true;
      // Empty database (no import yet): create a minimal one with the bootstrap admin
      const built = await buildDatabaseFromState(seedState(), { rev: 1 });
      await writeDatabase(storage, built);
      console.info('[bootstrap] database initialised:', Object.keys(built.shards).length, 'shards');
      return true;
    })().catch(err => {
      bootstrapPromise = null;
      throw err;
    });
  }
  return bootstrapPromise;
}

export async function importState(state) {
  const storage = getStorage();
  const [metaDoc, credsDoc] = await storage.getMany([META_PATH, CREDS_PATH]);
  const previousMeta = parseMeta(metaDoc);
  const existingCreds = credsDoc ? JSON.parse(credsDoc.json || '{}') : null;
  const rev = (previousMeta?.rev || 0) + 1;
  const built = await buildDatabaseFromState(state, { rev, existingCreds });
  await writeDatabase(storage, built, { previousMeta });
  return { rev, shards: Object.keys(built.shards).length };
}

// ======================================================================
// Reads
// ======================================================================
async function loadCreds(storage) {
  const doc = await storage.get(CREDS_PATH);
  return doc ? JSON.parse(doc.json || '{}') : { admin: null, teachers: {} };
}
export { loadCreds };

export function findRowInShard(shard, id) {
  return shard?.rows?.[id]?.d;
}

/** Throws 401 when the session user no longer exists / was deactivated */
export function assertUserAlive(user, shardsByKey) {
  if (user.role === 'teacher') {
    const t = findRowInShard(shardsByKey[shardKeyFor('teachers', user.uid)], user.uid);
    if (!t || t.status === 'inactive' || t.status === 'archived') {
      throw new HttpError(401, 'Учетная запись преподавателя отключена', { code: 'session_invalid' });
    }
  } else if (user.role === 'student') {
    const s = findRowInShard(shardsByKey[shardKeyFor('students', user.uid)], user.uid);
    if (!s) throw new HttpError(401, 'Ученик не найден в базе', { code: 'session_invalid' });
  }
}

function userShardKey(user) {
  if (user.role === 'teacher') return shardKeyFor('teachers', user.uid);
  if (user.role === 'student') return shardKeyFor('students', user.uid);
  return null;
}

function shardDelta(user, key, shard, known) {
  const coll = collOfShard(key);
  const full = !known || known < shard.th;
  const rows = {};
  const del = [];
  for (const [id, { d, r }] of Object.entries(shard.rows)) {
    if (!full && r <= known) continue;
    const visible = sanitizeRow(user, coll, id, d);
    if (visible === undefined) {
      if (!full) del.push(id);
      continue;
    }
    rows[id] = visible;
  }
  if (!full) {
    for (const [id, [r]] of Object.entries(shard.tomb)) if (r > known) del.push(id);
  }
  return { rev: shard.v, full, rows, del };
}

/** Collections a role receives unmodified: their shards can be passed through without parsing */
function passThrough(user, coll) {
  if (user.role === 'admin' || user.role === 'teacher') return true;
  return ['groups', 'schedule', 'purchases', 'shopItems', 'pointRecords', 'textbookLessons', 'textbookVocabularyPool'].includes(coll);
}

/** Collections a role never receives */
function hiddenFor(user, coll) {
  return user.role === 'student' && coll === 'activityLogs';
}

/**
 * @param want   { shardKey: knownRev } — refresh only these shards
 * @param known  used when `want` is empty: read meta and return every shard that is newer than `known`
 * Returns shards either as parsed deltas or as raw JSON strings (`raw`) for full shards that need
 * no filtering — this keeps CPU time per request low on Cloudflare Workers Free (10 ms).
 */
export async function readState(user, want, knownForFull = {}) {
  await ensureBootstrapped();
  const storage = getStorage();
  let meta = null;
  let known = {};
  let keys;
  if (!want || typeof want !== 'object' || Object.keys(want).length === 0) {
    meta = parseMeta(await storage.get(META_PATH));
    keys = Object.keys(meta.shards);
    known = (knownForFull && typeof knownForFull === 'object') ? knownForFull : {};
    keys = keys.filter(key => !(Number(known[key]) >= meta.shards[key]));
  } else {
    keys = Object.keys(want).filter(isValidShardKey).slice(0, 400);
    known = want;
  }
  keys = keys.filter(key => !hiddenFor(user, collOfShard(key)));

  const result = {
    rev: meta ? meta.rev : null,
    keys: meta ? Object.keys(meta.shards).filter(key => !hiddenFor(user, collOfShard(key))) : null,
    shards: {}
  };
  if (!keys.length) return result;

  const own = userShardKey(user);
  const readKeys = [...new Set([...keys, ...(own ? [own] : [])])];
  const docs = await storage.getMany(readKeys.map(shardPath));
  const docsByKey = {};
  readKeys.forEach((k, i) => { docsByKey[k] = docs[i]; });

  const parsed = {};
  const parse = (k) => (parsed[k] || (parsed[k] = parseShardDoc(docsByKey[k])));
  if (own) assertUserAlive(user, { [own]: parse(own) });

  for (const key of keys) {
    const doc = docsByKey[key];
    const k = Number(known[key]) || 0;
    const v = Number(doc?.v) || 0;
    if (k && k >= v) continue;
    if (!k && doc && passThrough(user, collOfShard(key)) && !parsed[key]) {
      result.shards[key] = { rev: v, full: true, raw: doc.json || '{}' };
      continue;
    }
    result.shards[key] = shardDelta(user, key, parse(key), k);
  }
  return result;
}

/** Serialise readState() output; raw shards are embedded without re-encoding */
export function stateToJson(data) {
  const parts = [];
  for (const [key, s] of Object.entries(data.shards)) {
    if (typeof s.raw === 'string') {
      parts.push(`${JSON.stringify(key)}:{"rev":${s.rev},"full":true,"shard":${s.raw}}`);
    } else {
      parts.push(`${JSON.stringify(key)}:${JSON.stringify(s)}`);
    }
  }
  return `{"success":true,"rev":${JSON.stringify(data.rev)},"keys":${JSON.stringify(data.keys)},"shards":{${parts.join(',')}}}`;
}

// ======================================================================
// Writes
// ======================================================================
const OP_TYPES = new Set(['put', 'patch', 'del']);

function validateOps(ops) {
  if (!Array.isArray(ops)) throw new HttpError(400, 'ops должен быть массивом');
  if (ops.length > 2000) throw new HttpError(413, 'Слишком много изменений за один запрос');
  return ops.map((op, i) => {
    if (!op || typeof op !== 'object' || !OP_TYPES.has(op.t) || typeof op.c !== 'string' || op.id === undefined || op.id === null || op.id === '') {
      return { i, invalid: 'Некорректная операция' };
    }
    if (!isKnownColl(op.c)) return { i, invalid: 'Неизвестная коллекция ' + op.c };
    return { i, c: op.c, id: String(op.id), t: op.t, v: op.v, set: op.set, unset: op.unset };
  });
}

function sameDay(dateIso, refDate, toleranceDays = 1) {
  const d = new Date(dateIso);
  if (isNaN(d)) return false;
  return Math.abs(d - refDate) <= toleranceDays * 86400000;
}

/**
 * Rules for point records a student creates from their own cabinet (survey bonus, birthday, mini-games).
 */
function validateStudentPointRecord(rec, student, now) {
  const points = Number(rec.points);
  if (!Number.isFinite(points) || points <= 0) return 'Ученик не может списывать баллы';
  const out = {
    ...rec,
    studentId: student.id,
    teacherId: 'admin',
    type: 'add',
    points,
    excludeFromRating: Boolean(rec.excludeFromRating),
    date: sameDay(rec.date, now, 2) ? rec.date : now.toISOString()
  };
  switch (rec.category) {
    case 'Анкета':
      if (points !== 200) return 'Неверная сумма бонуса за анкету';
      if (student.surveyBonusAwarded) return 'Бонус за анкету уже начислен';
      student.surveyBonusAwarded = true;
      return out;
    case 'День рождения': {
      if (points !== 500) return 'Неверная сумма бонуса';
      const year = now.getFullYear();
      if (student.lastBirthdayBonusYear === year) return 'Бонус ко дню рождения уже начислен в этом году';
      const parts = String(student.birthDate || '').split('-');
      if (parts.length < 3) return 'Не указана дата рождения';
      const bd = new Date(year, Number(parts[1]) - 1, Number(parts[2]), 12);
      if (!sameDay(bd.toISOString(), now, 1.5)) return 'Сегодня не день рождения ученика';
      student.lastBirthdayBonusYear = year;
      out.excludeFromRating = true;
      return out;
    }
    case 'Мини-игры': {
      if (points > 100) return 'Слишком много баллов за одну игру';
      const week = isoWeekKey(now);
      const gl = (student.gameLedger && student.gameLedger.week === week) ? student.gameLedger : { week, pts: 0 };
      if (gl.pts + points > 520) return 'Достигнут недельный лимит баллов за мини-игры';
      student.gameLedger = { week, pts: gl.pts + points };
      return out;
    }
    default:
      return 'Ученик не может начислять баллы в категории «' + rec.category + '»';
  }
}

export async function push(user, rawOps) {
  await ensureBootstrapped();
  const ops = validateOps(rawOps);
  const storage = getStorage();
  const now = new Date();

  return storage.transaction(async (tx) => {
    const results = ops.map(op => ({ i: op.i, ok: !op.invalid, reason: op.invalid || null }));
    const live = ops.filter(op => !op.invalid);

    // ---------- Phase A reads ----------
    const keysA = new Set();
    live.forEach(op => keysA.add(shardKeyFor(op.c, op.id)));
    const own = userShardKey(user);
    if (own) keysA.add(own);
    if (user.role === 'student' && live.some(op => op.c === 'purchases')) keysA.add('shopItems~0');
    const needCreds = user.role === 'admin' && live.some(op => op.c === 'teachers' || (op.c === SETTINGS && op.id === 'admin'));
    const keysAList = [...keysA];
    const docsA = await tx.getMany([META_PATH, ...keysAList.map(shardPath), ...(needCreds ? [CREDS_PATH] : [])]);
    const meta = parseMeta(docsA[0]);
    if (!meta) throw new HttpError(503, 'База данных не инициализирована');
    const shards = {};
    keysAList.forEach((k, i) => { shards[k] = parseShardDoc(docsA[i + 1]); });
    let creds = needCreds ? JSON.parse(docsA[docsA.length - 1]?.json || '{}') : null;
    if (creds) { creds.teachers = creds.teachers || {}; }
    assertUserAlive(user, shards);

    // ---------- Phase B reads: student shards for ledger updates ----------
    const ledgerStudentIds = new Set();
    live.forEach(op => {
      if (op.c !== 'pointRecords' && op.c !== 'purchases') return;
      const existing = findRowInShard(shards[shardKeyFor(op.c, op.id)], op.id);
      if (existing?.studentId) ledgerStudentIds.add(String(existing.studentId));
      const incoming = op.t === 'put' ? op.v : null;
      if (incoming?.studentId) ledgerStudentIds.add(String(incoming.studentId));
      (op.set || []).forEach(([path, v]) => { if (path?.[0] === 'studentId' && v) ledgerStudentIds.add(String(v)); });
    });
    const keysB = [...new Set([...ledgerStudentIds].map(sid => shardKeyFor('students', sid)))].filter(k => !shards[k]);
    if (keysB.length) {
      const docsB = await tx.getMany(keysB.map(shardPath));
      keysB.forEach((k, i) => { shards[k] = parseShardDoc(docsB[i]); });
    }

    // ---------- Apply ----------
    const newRev = meta.rev + 1;
    const changed = new Set();
    const touchedStudents = new Set();
    const ledgers = new Map();
    const getLedger = (sid) => {
      if (!ledgers.has(sid)) {
        const st = findRowInShard(shards[shardKeyFor('students', sid)], sid);
        ledgers.set(sid, st?.pointsLedger ? { ...emptyLedger(), ...st.pointsLedger } : emptyLedger());
      }
      return ledgers.get(sid);
    };
    const addContribution = (c, sign) => {
      if (!c) return;
      const l = getLedger(c.sid);
      l.gross += sign * c.gross; l.life += sign * c.life; l.spent += sign * c.spent;
      touchedStudents.add(c.sid);
    };
    const selfStudent = user.role === 'student' ? findRowInShard(shards[own], user.uid) : null;
    let selfStudentDirty = false;

    const writeRow = (key, id, data) => {
      const sh = shards[key];
      sh.rows[id] = { d: data, r: newRev };
      delete sh.tomb[id];
      changed.add(key);
    };
    const deleteRow = (key, id) => {
      const sh = shards[key];
      if (!sh.rows[id]) return false;
      delete sh.rows[id];
      sh.tomb[id] = [newRev, now.getTime()];
      changed.add(key);
      return true;
    };
    const reject = (res, reason) => { res.ok = false; res.reason = reason; };

    for (const op of live) {
      const res = results[op.i];
      const key = shardKeyFor(op.c, op.id);
      const sh = shards[key];
      const existing = findRowInShard(sh, op.id);

      if (!collectionWritable(user, op.c, op.id)) { reject(res, 'Недостаточно прав'); continue; }

      // ---------------- Student role ----------------
      if (user.role === 'student') {
        if (op.c === 'students') {
          if (op.id !== user.uid || op.t === 'del' || !existing) { reject(res, 'Можно изменять только свою карточку'); continue; }
          let patchOp = op;
          if (op.t === 'put') {
            patchOp = { set: Object.entries(op.v || {}).map(([k, v]) => [[k], v]), unset: [] };
          }
          const filtered = filterSelfPatch(patchOp, SELF_DENY.student);
          const next = applyPatch(existing, filtered);
          Object.assign(selfStudent, next);
          for (const k of Object.keys(selfStudent)) if (!(k in next)) delete selfStudent[k];
          selfStudentDirty = true;
          continue;
        }
        if (op.t !== 'put' || existing) { reject(res, 'Можно только добавлять новые записи'); continue; }
        const v = isPlainObject(op.v) ? { ...op.v, id: op.id } : null;
        if (!v) { reject(res, 'Пустая запись'); continue; }

        if (op.c === 'activityLogs') {
          writeRow(key, op.id, {
            ...v,
            type: String(v.type || 'system').slice(0, 40),
            title: String(v.title || '').slice(0, 300),
            details: String(v.details || '').slice(0, 1000),
            authorRole: 'student',
            authorName: selfStudent.fullName,
            timestamp: now.toISOString()
          });
          continue;
        }
        if (v.studentId !== user.uid) { reject(res, 'Запись принадлежит другому ученику'); continue; }

        if (op.c === 'pointRecords') {
          const checked = validateStudentPointRecord(v, selfStudent, now);
          if (typeof checked === 'string') { reject(res, checked); continue; }
          writeRow(key, op.id, checked);
          addContribution(pointContribution(checked), +1);
          selfStudentDirty = true;
          continue;
        }

        if (op.c === 'purchases') {
          const price = Math.max(0, Number(v.price) || 0);
          if (v.type === 'staff') {
            const item = findRowInShard(shards['shopItems~0'], v.itemId);
            if (!item) { reject(res, 'Товар не найден'); continue; }
            if (price !== Math.max(0, Number(item.price) || 0)) { reject(res, 'Цена товара изменилась, обновите страницу'); continue; }
          }
          const rec = { ...v, price, status: 'completed', studentName: selfStudent.fullName, date: now.toISOString() };
          delete rec.itemPrice; delete rec.cancelledAt; delete rec.cancelledBy;
          const l = getLedger(user.uid);
          if (Math.max(0, l.gross - l.spent) < price) { reject(res, 'Недостаточно баллов'); continue; }
          writeRow(key, op.id, rec);
          addContribution(purchaseContribution(rec), +1);
          continue;
        }
        reject(res, 'Недостаточно прав');
        continue;
      }

      // ---------------- Staff roles ----------------
      if (op.c === 'teachers' && user.role === 'teacher') {
        if (op.id !== user.uid || op.t !== 'patch' || !existing) { reject(res, 'Преподаватель может менять только свой профиль'); continue; }
        writeRow(key, op.id, applyPatch(existing, filterSelfPatch(op, SELF_DENY.teacher)));
        continue;
      }

      if (op.t === 'del') {
        if (op.c === 'pointRecords') addContribution(pointContribution(existing), -1);
        if (op.c === 'purchases') addContribution(purchaseContribution(existing), -1);
        if (op.c === 'teachers' && creds) delete creds.teachers[op.id];
        deleteRow(key, op.id);
        continue;
      }

      let next = op.t === 'put' ? clone(op.v) : applyPatch(existing, op);
      if (next === undefined) next = null;

      if (op.c === 'settings' && (op.id === 'deletedStudents' || op.id === 'deletedGroups')) {
        next = [...new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(next) ? next : [])])];
      }

      if (op.c === 'settings' && op.id === 'admin') {
        next = isPlainObject(next) ? next : {};
        if (creds) {
          const newPass = typeof next.password === 'string' ? next.password.trim() : '';
          creds.admin = creds.admin || { logins: [...DEFAULT_ADMIN_LOGINS] };
          if (newPass) creds.admin.hash = await hashPassword(newPass);
          const logins = new Set(creds.admin.logins || DEFAULT_ADMIN_LOGINS);
          if (next.login) logins.add(String(next.login).toLowerCase());
          if (next.email) logins.add(String(next.email).toLowerCase());
          creds.admin.logins = [...logins];
        }
        delete next.password;
      }

      if (op.c === 'teachers') {
        if (!isPlainObject(next)) { reject(res, 'Некорректные данные преподавателя'); continue; }
        next.id = op.id;
        const newPass = typeof next.password === 'string' ? next.password.trim() : '';
        if (creds) {
          if (newPass) creds.teachers[op.id] = await hashPassword(newPass);
          else if (!existing && !creds.teachers[op.id]) creds.teachers[op.id] = await hashPassword('123');
        }
        delete next.password;
      }

      if (op.c === 'students') {
        if (!isPlainObject(next)) { reject(res, 'Некорректные данные ученика'); continue; }
        next.id = op.id;
        for (const f of STUDENT_DERIVED_FIELDS) delete next[f];
        for (const f of STUDENT_SERVER_FIELDS) {
          if (existing && existing[f] !== undefined) next[f] = existing[f];
          else delete next[f];
        }
        next.pin = derivePin(next);
        if (!existing) applyLedgerToStudent(next, getLedger(op.id));
        touchedStudents.add(op.id);
      }

      if (op.c === 'pointRecords') {
        addContribution(pointContribution(existing), -1);
        addContribution(pointContribution(next), +1);
      }
      if (op.c === 'purchases') {
        addContribution(purchaseContribution(existing), -1);
        addContribution(purchaseContribution(next), +1);
      }
      if (LIST_COLLS[op.c] && isPlainObject(next)) next.id = op.id;
      writeRow(key, op.id, next);
    }

    // ---------- Server-maintained student fields ----------
    if (selfStudentDirty && selfStudent) {
      selfStudent.pin = derivePin(selfStudent);
      writeRow(own, user.uid, selfStudent);
    }
    for (const sid of touchedStudents) {
      const key = shardKeyFor('students', sid);
      const st = findRowInShard(shards[key], sid);
      if (!st) continue;
      const before = JSON.stringify([st.totalPoints, st.lifetimePoints, st.pointsLedger]);
      applyLedgerToStudent(st, getLedger(sid));
      if (before !== JSON.stringify([st.totalPoints, st.lifetimePoints, st.pointsLedger]) || shards[key].rows[sid].r === newRev) {
        writeRow(key, sid, st);
      }
    }

    // ---------- Housekeeping ----------
    if (changed.has('activityLogs~0')) {
      const sh = shards['activityLogs~0'];
      const ids = Object.keys(sh.rows);
      if (ids.length > ACTIVITY_LOG_CAP) {
        ids.sort((a, b) => String(sh.rows[b].d?.timestamp || '').localeCompare(String(sh.rows[a].d?.timestamp || '')));
        ids.slice(ACTIVITY_LOG_CAP).forEach(id => deleteRow('activityLogs~0', id));
      }
    }

    if (!changed.size) {
      return { success: true, rev: meta.rev, results, shards: {} };
    }

    const response = {};
    for (const key of changed) {
      const sh = shards[key];
      const prev = sh.v;
      sh.v = newRev;
      pruneTombs(sh, now.getTime());
      try {
        tx.set(shardPath(key), serializeShard(key, sh));
      } catch (e) {
        if (e.code === 'shard_full') throw new HttpError(507, e.message);
        throw e;
      }
      meta.shards[key] = newRev;
      const coll = collOfShard(key);
      const rows = {};
      const del = [];
      for (const [id, { d, r }] of Object.entries(sh.rows)) {
        if (r !== newRev) continue;
        const vis = sanitizeRow(user, coll, id, d);
        if (vis === undefined) del.push(id); else rows[id] = vis;
      }
      for (const [id, [r]] of Object.entries(sh.tomb)) if (r === newRev) del.push(id);
      response[key] = { prev, rev: newRev, rows, del };
    }
    meta.rev = newRev;
    tx.set(META_PATH, serializeMeta(meta));
    if (creds) tx.set(CREDS_PATH, { json: JSON.stringify(creds) });

    return { success: true, rev: newRev, results, shards: response };
  });
}

/** Server-side activity log entry (logins etc.) */
export async function appendActivityLog(entry) {
  const id = 'act-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const admin = { role: 'admin', uid: 'system' };
  try {
    await push(admin, [{ c: 'activityLogs', id, t: 'put', v: { id, timestamp: new Date().toISOString(), ...entry } }]);
  } catch (e) {
    console.warn('[activity] log write failed:', e.message);
  }
}

/**
 * Full backup for admins, streamed as raw shards (no parsing, cheap on CPU).
 * Format: { "format": "stepup-shards-v1", "exportedAt": ..., "shards": { key: {rows, tomb, th} } }
 * Password hashes are not included.
 */
export async function exportStateJson() {
  await ensureBootstrapped();
  const storage = getStorage();
  const meta = parseMeta(await storage.get(META_PATH));
  const keys = Object.keys(meta.shards);
  const docs = await storage.getMany(keys.map(shardPath));
  const parts = keys.map((key, i) => `${JSON.stringify(key)}:${docs[i]?.json || '{"rows":{}}'}`);
  return `{"format":"stepup-shards-v1","exportedAt":${JSON.stringify(new Date().toISOString())},"rev":${meta.rev},"shards":{${parts.join(',')}}}`;
}

/** Convert any supported backup (shard backup or classic whole-state JSON) into a classic state */
export function backupToState(backup) {
  if (!backup || typeof backup !== 'object') throw new HttpError(400, 'Пустой файл резервной копии');
  if (backup.format !== 'stepup-shards-v1') return backup;
  const state = {};
  for (const [key, sh] of Object.entries(backup.shards || {})) {
    const coll = collOfShard(key);
    for (const [id, { d }] of Object.entries(sh.rows || {})) {
      if (LIST_COLLS[coll]) (state[coll] = state[coll] || []).push(d);
      else if (coll === SETTINGS) state[id] = d;
      else (state[coll] = state[coll] || {})[id] = d;
    }
  }
  return state;
}
