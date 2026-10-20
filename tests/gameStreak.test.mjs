import test from 'node:test';
import assert from 'node:assert/strict';
import { playGame, viewLedger, migrateLedger, schoolDay, weekKeyOfDay } from '../public/js/shared/gameStreak.js';

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

test('+10 every 7 days, two weeks = 120', () => {
  let gl = playDays(null, '2026-10-05', 7);
  assert.equal(viewLedger(gl, at('2026-10-11')).weeklyLimit, 110);
  gl = playDays(gl, '2026-10-12', 7);
  const v = viewLedger(gl, at('2026-10-18'));
  assert.equal(v.weeklyLimit, 120);
  assert.equal(v.dailyStreak, 14);
});

test('each missed day costs 10, never below 100, 7-day count restarts', () => {
  let gl = playDays(null, '2026-09-07', 28); // level 4 -> 140, last play 2026-10-04
  assert.equal(viewLedger(gl, at('2026-10-04')).weeklyLimit, 140);
  assert.equal(viewLedger(gl, at('2026-10-05')).weeklyLimit, 140, 'today is not missed yet');
  assert.equal(viewLedger(gl, at('2026-10-06')).weeklyLimit, 130, 'one missed day');
  const v = viewLedger(gl, at('2026-10-07'));
  assert.equal(v.weeklyLimit, 120);
  assert.equal(v.dailyStreak, 0);
  gl = playGame(gl, 10, at('2026-10-07')).ledger;   // back after 2 missed days
  gl = playDays(gl, '2026-10-08', 5);              // 6 days so far
  assert.equal(viewLedger(gl, at('2026-10-12')).weeklyLimit, 120);
  gl = playGame(gl, 10, at('2026-10-13')).ledger;  // 7th day
  assert.equal(viewLedger(gl, at('2026-10-13')).weeklyLimit, 130);
  assert.equal(viewLedger(gl, at('2026-12-31')).weeklyLimit, 100, 'floor is 100');
  // penalty is not applied twice
  const once = playGame(gl, 1, at('2026-12-31')).ledger;
  assert.equal(viewLedger(once, at('2026-12-31')).weeklyLimit, 100);
});

test('a played day below 10 points counts as missed', () => {
  let gl = playDays(null, '2026-09-07', 14); // 120
  gl = playGame(gl, 5, at('2026-09-21')).ledger; // not enough
  assert.equal(viewLedger(gl, at('2026-09-22')).weeklyLimit, 110);
});

test('max is 500 after 280 days', () => {
  const gl = playDays(null, '2025-01-06', 300);
  assert.equal(viewLedger(gl, at(addDays('2025-01-06', 299))).weeklyLimit, 500);
});

test('weekly limit caps awards and resets on Monday', () => {
  let gl = null; let total = 0;
  for (let i = 0; i < 15; i++) { const r = playGame(gl, 10, at('2026-10-19')); gl = r.ledger; total += r.award; }
  assert.equal(total, 100);
  const r = playGame(gl, 10, at('2026-10-26'));
  assert.equal(r.award, 10);
  assert.equal(r.weeklyPoints, 10);
});

test('migration keeps this week points and a live streak', () => {
  const gl = migrateLedger({ week: weekKeyOfDay('2026-10-20'), pts: 40 }, { dailyStreak: 8, lastGameDate: '2026-10-19' }, at('2026-10-20'));
  const v = viewLedger(gl, at('2026-10-20'));
  assert.equal(v.weeklyPoints, 40);
  assert.equal(v.weeklyLimit, 110);
  assert.equal(v.dailyStreak, 8);
  const dead = migrateLedger(null, { dailyStreak: 30, lastGameDate: '2026-10-01' }, at('2026-10-20'));
  assert.equal(viewLedger(dead, at('2026-10-20')).weeklyLimit, 100);
});
