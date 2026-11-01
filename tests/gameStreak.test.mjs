import test from 'node:test';
import assert from 'node:assert/strict';
import { playGame, viewLedger, migrateLedger, schoolDay, weekKeyOfDay, addFreeze } from '../public/js/shared/gameStreak.js';

// Noon in the school's time zone (UTC+5) on the given date
const at = (day, hh = 12) => new Date(Date.parse(day + 'T00:00:00Z') + (hh - 5) * 3600000);
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function playDays(gl, start, days, score = 10) {
  for (let i = 0; i < days; i++) gl = playGame(gl, score, at(addDays(start, i))).ledger;
  return gl;
}

test('school day and week use UTC+5, weeks start on Monday', () => {
  assert.equal(schoolDay(new Date('2026-10-19T19:30:00Z')), '2026-10-20'); // 00:30 local
  assert.equal(weekKeyOfDay('2026-10-19'), weekKeyOfDay('2026-10-25')); // Mon..Sun
  assert.notEqual(weekKeyOfDay('2026-10-25'), weekKeyOfDay('2026-10-26'));
});

test('a day counts only with at least 10 points', () => {
  let r = playGame(null, 6, at('2026-10-19'));
  assert.equal(r.dailyStreak, 0);
  assert.equal(r.todayCounted, false);
  r = playGame(r.ledger, 4, at('2026-10-19', 18));
  assert.equal(r.dailyStreak, 1);
  assert.equal(r.todayCounted, true);
  r = playGame(r.ledger, 10, at('2026-10-19', 20));
  assert.equal(r.dailyStreak, 1, 'same day counts once');
});

test('+10 for every streak day: one week = 170, two weeks = 240', () => {
  let gl = playDays(null, '2026-10-05', 1);
  assert.equal(viewLedger(gl, at('2026-10-05')).weeklyLimit, 110, 'the first counted day already adds 10');
  gl = playDays(gl, '2026-10-06', 6);
  assert.equal(viewLedger(gl, at('2026-10-11')).weeklyLimit, 170);
  gl = playDays(gl, '2026-10-12', 7);
  const v = viewLedger(gl, at('2026-10-18'));
  assert.equal(v.weeklyLimit, 240);
  assert.equal(v.dailyStreak, 14);
});

test('each missed day costs 10, never below 100, streak restarts', () => {
  let gl = playDays(null, '2026-09-28', 7); // 170, last play 2026-10-04
  assert.equal(viewLedger(gl, at('2026-10-04')).weeklyLimit, 170);
  assert.equal(viewLedger(gl, at('2026-10-05')).weeklyLimit, 170, 'today is not missed yet');
  assert.equal(viewLedger(gl, at('2026-10-06')).weeklyLimit, 160, 'one missed day');
  const v = viewLedger(gl, at('2026-10-07'));
  assert.equal(v.weeklyLimit, 150);
  assert.equal(v.dailyStreak, 0);
  gl = playGame(gl, 10, at('2026-10-07')).ledger;   // back after 2 missed days
  assert.equal(viewLedger(gl, at('2026-10-07')).weeklyLimit, 160, 'grows again from where it dropped');
  assert.equal(viewLedger(gl, at('2026-12-31')).weeklyLimit, 100, 'floor is 100');
  // penalty is not applied twice
  const once = playGame(gl, 1, at('2026-12-31')).ledger;
  assert.equal(viewLedger(once, at('2026-12-31')).weeklyLimit, 100);
});

test('a played day below 10 points counts as missed', () => {
  let gl = playDays(null, '2026-09-07', 3); // 130
  gl = playGame(gl, 5, at('2026-09-10')).ledger; // not enough
  assert.equal(viewLedger(gl, at('2026-09-11')).weeklyLimit, 120);
});

test('max is 300 after 20 days', () => {
  const gl = playDays(null, '2025-01-06', 40);
  assert.equal(viewLedger(playDays(null, '2025-01-06', 20), at(addDays('2025-01-06', 19))).weeklyLimit, 300);
  assert.equal(viewLedger(gl, at(addDays('2025-01-06', 39))).weeklyLimit, 300);
});

test('ledgers from the 7-day rules get the limit of their running streak', () => {
  const old = { v: 2, week: weekKeyOfDay('2026-10-20'), pts: 30, day: '2026-10-19', dayScore: 10, anchor: '2026-10-19', streak: 12, level: 1, n: 12, freezes: 1, frozen: [] };
  const v = viewLedger(old, at('2026-10-20'));
  assert.equal(v.weeklyLimit, 220);
  assert.equal(v.dailyStreak, 12);
  assert.equal(v.freezes, 1);
  const big = viewLedger({ ...old, streak: 60, level: 8 }, at('2026-10-20'));
  assert.equal(big.weeklyLimit, 300, 'capped at the new maximum');
});

test('weekly limit caps awards and resets on Monday', () => {
  let gl = null; let total = 0;
  for (let i = 0; i < 15; i++) { const r = playGame(gl, 10, at('2026-10-19')); gl = r.ledger; total += r.award; }
  assert.equal(total, 110, 'the first counted day already adds 10');
  const r = playGame(gl, 10, at('2026-10-26'));
  assert.equal(r.award, 10);
  assert.equal(r.weeklyPoints, 10);
});

test('migration keeps this week points and a live streak', () => {
  const gl = migrateLedger({ week: weekKeyOfDay('2026-10-20'), pts: 40 }, { dailyStreak: 8, lastGameDate: '2026-10-19' }, at('2026-10-20'));
  const v = viewLedger(gl, at('2026-10-20'));
  assert.equal(v.weeklyPoints, 40);
  assert.equal(v.weeklyLimit, 180);
  assert.equal(v.dailyStreak, 8);
  const dead = migrateLedger(null, { dailyStreak: 30, lastGameDate: '2026-10-01' }, at('2026-10-20'));
  assert.equal(viewLedger(dead, at('2026-10-20')).weeklyLimit, 100);
});

test('a freeze covers a missed day: streak and limit kept; max 3', () => {
  let gl = playDays(null, '2026-09-07', 14); // 240, streak 14
  gl = addFreeze(gl, at('2026-09-20')).ledger;
  let v = viewLedger(gl, at('2026-09-22')); // 21.09 missed, covered
  assert.equal(v.weeklyLimit, 240);
  assert.equal(v.dailyStreak, 14);
  assert.equal(v.freezes, 0);
  assert.deepEqual(v.frozenDays, ['2026-09-21']);
  gl = playGame(gl, 10, at('2026-09-22')).ledger;
  assert.equal(viewLedger(gl, at('2026-09-22')).dailyStreak, 15, 'streak continues after the frozen day');
  v = viewLedger(gl, at('2026-09-25')); // 250 after 22.09; 23, 24 missed, no freezes
  assert.equal(v.weeklyLimit, 230);
  assert.equal(v.dailyStreak, 0);
  let g2 = null;
  for (let i = 0; i < 3; i++) g2 = addFreeze(g2, at('2026-09-20')).ledger;
  assert.equal(addFreeze(g2, at('2026-09-20')).ok, false);
});
