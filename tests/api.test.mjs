/**
 * API tests: the real Worker (src/worker.js) with a D1-compatible SQLite database and a folder-backed R2.
 *   npm test        (Node 22.13+)
 * Uses synthetic data only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import worker from '../src/worker.js';
import { FakeD1 } from '../dev/fake-d1.mjs';
import { FakeR2 } from '../dev/fake-r2.mjs';
import { setEnv } from '../src/lib/env.js';
import { importState } from '../src/lib/engine.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stepup-test-'));
const env = {
  SESSION_SECRET: 'test-secret-'.padEnd(48, 'x'),
  DB: new FakeD1(':memory:'),
  FILES: new FakeR2(path.join(tmp, 'files')),
  ASSETS: { fetch: async () => new Response('static') }
};

function syntheticState() {
  const students = Array.from({ length: 24 }, (_, i) => ({
    id: `stu-${i}`, fullName: `Ученик ${i}`, phone: `+7 (700) 000-00-${String(i).padStart(2, '0')}`,
    parentPhone: `+7 (701) 111-11-${String(i).padStart(2, '0')}`, status: 'active', groupId: i % 2 ? 'grp-a' : 'grp-b',
    level: 'Elementary', textbook: 'Book A', createdAt: '2026-09-01T00:00:00.000Z', birthDate: '2015-01-01'
  }));
  return {
    admin: { login: 'admin', email: 'boss@example.com', password: 'AdminPass1', name: 'Админ' },
    teachers: [{ id: 'tch-1', login: 'teacher1', password: 'TeachPass1', fullName: 'Учитель Один', phone: '+7 (777) 000-00-01', status: 'active' }],
    groups: [{ id: 'grp-a', name: 'A', textbook: 'Book A', teacherId: 'tch-1' }, { id: 'grp-b', name: 'B', textbook: 'Book A', teacherId: 'tch-1' }],
    students,
    pointRecords: [{ id: 'pt-0', studentId: 'stu-1', points: 100, category: 'Активность', date: '2026-10-01T10:00:00.000Z' }],
    purchases: [], shopItems: [{ id: 'staff-1', name: 'Блокнот', price: 50, category: 'staff' }],
    schedule: [], activityLogs: [], payments: { 'stu-1_2026-10': { studentId: 'stu-1', monthKey: '2026-10', status: 'paid', amount: 1 } },
    textbookLessons: { 'Book A': { 1: { 1: { topic: 'Unit 1', isConducted: true, vocabulary: [{ word: 'apple', translation: 'яблоко' }], files: [] } } } },
    textbookVocabularyPool: {}, deletedStudents: [], deletedGroups: [], deletedTextbooks: [], vacationMode: false
  };
}

async function call(pathname, { method = 'POST', body, cookie, headers = {}, raw } = {}) {
  const req = new Request('http://test' + pathname, {
    method,
    headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers },
    body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined)
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* binary */ }
  const sc = res.headers.get('set-cookie');
  return { status: res.status, json, text, headers: res.headers, cookie: sc ? sc.split(';')[0] : null };
}

const rowsOf = (resp, coll) => Object.entries(resp.json.shards)
  .filter(([k]) => k.startsWith(coll + '~'))
  .flatMap(([, s]) => s.shard ? Object.values(s.shard.rows).map(r => r.d) : Object.values(s.rows));

test('Cloudflare Worker API (D1 + R2)', async () => {
  setEnv(env);
  await importState(syntheticState());

  const admin = await call('/api/auth', { body: { action: 'staff', login: 'admin', password: 'AdminPass1' } });
  assert.equal(admin.status, 200, admin.text);
  const teacher = await call('/api/auth', { body: { action: 'staff', login: 'teacher1', password: 'TeachPass1' } });
  assert.equal(teacher.status, 200, teacher.text);
  assert.equal((await call('/api/auth', { body: { action: 'staff', login: 'teacher1', password: 'wrong' } })).status, 401);

  const full = await call('/api/state', { body: { known: {} }, cookie: admin.cookie });
  assert.equal(rowsOf(full, 'students').length, 24);
  assert.ok(rowsOf(full, 'teachers').every(t => !('password' in t)));

  // Student: legacy PIN login and privacy
  const s1 = rowsOf(full, 'students').find(s => s.id === 'stu-1');
  const student = await call('/api/auth', { body: { action: 'student', login: s1.phone, pin: s1.pin } });
  assert.equal(student.status, 200, student.text);
  const sview = await call('/api/state', { body: { known: {} }, cookie: student.cookie });
  const others = rowsOf(sview, 'students').filter(s => s.id !== 'stu-1');
  assert.ok(others.every(s => s.pin === undefined && s.phone === undefined && s.parentPhone === undefined));
  assert.equal(rowsOf(sview, 'payments').length, 1);
  assert.ok(!Object.keys(sview.json.shards).some(k => k.startsWith('activityLogs')));

  // No-change poll returns nothing
  // (the student login above appended an activity log, so refresh once first)
  const known = Object.fromEntries(Object.entries(full.json.shards).map(([k, s]) => [k, s.rev]));
  const first = await call('/api/state', { body: { known }, cookie: admin.cookie });
  assert.deepEqual(Object.keys(first.json.shards), ['activityLogs~0']);
  known['activityLogs~0'] = first.json.shards['activityLogs~0'].rev;
  const poll = await call('/api/state', { body: { known }, cookie: admin.cookie });
  assert.equal(Object.keys(poll.json.shards).length, 0);

  // 25 parallel awards to one student -> optimistic transactions, no lost updates
  const N = 25;
  const res = await Promise.all(Array.from({ length: N }, (_, i) => call('/api/push', {
    cookie: teacher.cookie,
    body: { ops: [{ c: 'pointRecords', id: `pt-par-${i}`, t: 'put', v: { studentId: 'stu-1', points: 2, category: 'Активность' } }] }
  })));
  res.forEach(r => assert.equal(r.status, 200, r.text));
  const after = await call('/api/state', { body: { known: {} }, cookie: admin.cookie });
  assert.equal(rowsOf(after, 'students').find(s => s.id === 'stu-1').totalPoints, 100 + N * 2);

  // Student cannot cheat
  const hack = await call('/api/push', { cookie: student.cookie, body: { ops: [
    { c: 'pointRecords', id: 'pt-h', t: 'put', v: { studentId: 'stu-1', points: 999, category: 'Активность' } },
    { c: 'groups', id: 'grp-a', t: 'patch', set: [[['name'], 'HACK']], unset: [] },
    { c: 'students', id: 'stu-2', t: 'patch', set: [[['fullName'], 'HACK']], unset: [] }
  ] } });
  assert.deepEqual(hack.json.results.map(r => r.ok), [false, false, false]);

  // Mini-games: the server applies the weekly limit (100 at the start) and keeps the streak
  const games = [];
  for (let i = 0; i < 12; i++) {
    games.push({ c: 'pointRecords', id: `pt-game-${i}`, t: 'put', v: { studentId: 'stu-1', points: 10, gameScore: 10, gameTitle: 'Тест', category: 'Мини-игры' } });
  }
  const g = await call('/api/push', { cookie: student.cookie, body: { ops: games } });
  assert.ok(g.json.results.every(r => r.ok), JSON.stringify(g.json.results));
  const gState = await call('/api/state', { body: { known: {} }, cookie: student.cookie });
  const me = rowsOf(gState, 'students').find(s => s.id === 'stu-1');
  assert.equal(me.gameLedger.pts, 100);
  assert.equal(me.gameLedger.streak, 1);
  assert.equal(rowsOf(gState, 'pointRecords').filter(r => r.category === 'Мини-игры').reduce((a, r) => a + r.points, 0), 100);
  // Student cannot raise the limit by editing the ledger
  await call('/api/push', { cookie: student.cookie, body: { ops: [{ c: 'students', id: 'stu-1', t: 'patch', set: [[['gameLedger', 'level'], 40]], unset: [] }] } });
  const g2 = await call('/api/push', { cookie: student.cookie, body: { ops: [{ c: 'pointRecords', id: 'pt-game-x', t: 'put', v: { studentId: 'stu-1', points: 10, gameScore: 10, category: 'Мини-игры' } }] } });
  assert.equal(g2.json.results[0].ok, true);
  const gState2 = await call('/api/state', { body: { known: {} }, cookie: student.cookie });
  assert.equal(rowsOf(gState2, 'pointRecords').some(r => r.id === 'pt-game-x'), false, 'no record over the limit');
  assert.equal(rowsOf(gState2, 'students').find(s => s.id === 'stu-1').gameLedger.level, 0);
  // Re-sending an already saved record (lost response) is accepted without changes
  const again = await call('/api/push', { cookie: student.cookie, body: { ops: [games[0]] } });
  assert.equal(again.json.results[0].ok, true);

  // Purchase with balance check
  const buy = await call('/api/push', { cookie: student.cookie, body: { ops: [
    { c: 'purchases', id: 'pur-1', t: 'put', v: { studentId: 'stu-1', type: 'staff', itemId: 'staff-1', price: 50 } }
  ] } });
  assert.equal(buy.json.results[0].ok, true, JSON.stringify(buy.json));

  // Files: staff upload, range download, auth required, students only avatars
  const bytes = new Uint8Array(1000).map((_, i) => i % 256);
  const up = await call('/api/files?name=' + encodeURIComponent('Unit 1 audio.mp3') + '&folder=audio', {
    method: 'PUT', cookie: teacher.cookie, raw: bytes, headers: { 'content-type': 'audio/mpeg', 'content-length': '1000' }
  });
  assert.equal(up.status, 200, up.text);
  const fileUrl = up.json.file.url;
  assert.equal((await call(fileUrl, { method: 'GET' })).status, 401);
  const part = await worker.fetch(new Request('http://test' + fileUrl, { headers: { cookie: student.cookie, range: 'bytes=10-19' } }), env);
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], Array.from({ length: 10 }, (_, i) => 10 + i));
  const sUp = await call('/api/files?name=x.docx&folder=materials', {
    method: 'PUT', cookie: student.cookie, raw: new Uint8Array(10), headers: { 'content-length': '10' }
  });
  assert.equal(sUp.status, 403);

  // Admin changes own password through settings.admin
  const pw = await call('/api/push', { cookie: admin.cookie, body: { ops: [{ c: 'settings', id: 'admin', t: 'put', v: { name: 'Админ', login: 'admin', password: 'NewAdmin77' } }] } });
  assert.equal(pw.json.results[0].ok, true);
  assert.equal((await call('/api/auth', { body: { action: 'staff', login: 'admin', password: 'NewAdmin77' } })).status, 200);
  assert.equal((await call('/api/auth', { body: { action: 'staff', login: 'admin', password: 'AdminPass1' } })).status, 401);

  // Backup export is a shard backup that can be converted back
  const exp = await call('/api/admin?action=export', { method: 'GET', cookie: admin.cookie });
  assert.equal(exp.json.format, 'stepup-shards-v1');
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
