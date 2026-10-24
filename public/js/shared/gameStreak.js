/**
 * Mini-game streak and weekly point limit.
 * Shared by the browser (display) and the Worker (the only place where the result is stored).
 *
 * Rules:
 *  - A day counts for the streak when the student scores at least MIN_DAILY_SCORE points in mini-games that day.
 *  - Every DAYS_PER_LEVEL counted days in a row raise the weekly limit by STEP (BASE … MAX).
 *  - Every missed day lowers the limit by STEP (never below BASE) and restarts the 7-day count.
 *  - A streak freeze (bought in the shop or given by a teacher) is used up automatically for a missed day:
 *    the streak and the limit stay as they were. At most MAX_FREEZES can be kept.
 *  - Days and weeks follow the school's time zone (UTC+5), weeks start on Monday.
 */

export const GAME_RULES = Object.freeze({
  BASE: 100,
  STEP: 10,
  MAX: 500,
  DAYS_PER_LEVEL: 7,
  MIN_DAILY_SCORE: 10,
  MAX_PER_GAME: 100,
  TZ_OFFSET_MIN: 300,
  FREEZE_PRICE: 150,
  MAX_FREEZES: 3
});

const MAX_LEVEL = (GAME_RULES.MAX - GAME_RULES.BASE) / GAME_RULES.STEP;
const DAY_MS = 86400000;

/** 'YYYY-MM-DD' of the given moment in the school's time zone */
export function schoolDay(date = new Date(), tzOffsetMin = GAME_RULES.TZ_OFFSET_MIN) {
  return new Date(date.getTime() + tzOffsetMin * 60000).toISOString().slice(0, 10);
}

function dayIndex(day) {
  return Math.round(Date.parse(day + 'T00:00:00Z') / DAY_MS);
}

function dayFromIndex(i) {
  return new Date(i * DAY_MS).toISOString().slice(0, 10);
}

/** ISO week key ('2026-W43') of a school day */
export function weekKeyOfDay(day) {
  const d = new Date(day + 'T00:00:00Z');
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function num(v, min = 0, max = Infinity) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Bring a stored ledger (or nothing) to the current shape */
export function normalizeLedger(raw) {
  const gl = raw && typeof raw === 'object' ? raw : {};
  return {
    v: 2,
    week: typeof gl.week === 'string' ? gl.week : '',
    pts: num(gl.pts),
    day: isDay(gl.day) ? gl.day : '',
    dayScore: num(gl.dayScore),
    anchor: isDay(gl.anchor) ? gl.anchor : '',
    streak: num(gl.streak),
    level: num(gl.level, 0, MAX_LEVEL),
    n: num(gl.n),
    freezes: num(gl.freezes, 0, GAME_RULES.MAX_FREEZES),
    frozen: Array.isArray(gl.frozen) ? gl.frozen.filter(isDay).slice(-10) : []
  };
}

export function limitForLevel(level) {
  return GAME_RULES.BASE + GAME_RULES.STEP * num(level, 0, MAX_LEVEL);
}

/** Apply missed days and day/week rollover up to `today` (mutates gl) */
function settle(gl, today) {
  const t = dayIndex(today);
  if (gl.anchor) {
    const missed = t - dayIndex(gl.anchor) - 1;
    if (missed > 0) {
      const from = dayIndex(gl.anchor);
      for (let k = 1; k <= missed; k++) {
        if (gl.freezes > 0) {
          // A freeze covers the day: streak and limit are kept
          gl.freezes -= 1;
          gl.frozen = [...gl.frozen, dayFromIndex(from + k)].slice(-10);
        } else {
          gl.level = Math.max(0, gl.level - 1);
          gl.streak = 0;
        }
      }
      gl.anchor = dayFromIndex(t - 1);
    }
  }
  if (gl.day !== today) { gl.day = today; gl.dayScore = 0; }
  const week = weekKeyOfDay(today);
  if (gl.week !== week) { gl.week = week; gl.pts = 0; }
  return gl;
}

function summary(gl, today) {
  const weeklyLimit = limitForLevel(gl.level);
  return {
    weeklyPoints: gl.pts,
    weeklyLimit,
    level: gl.level,
    dailyStreak: gl.streak,
    streakBonus: weeklyLimit - GAME_RULES.BASE,
    daysToNextLevel: gl.level >= MAX_LEVEL ? 0 : GAME_RULES.DAYS_PER_LEVEL - (gl.streak % GAME_RULES.DAYS_PER_LEVEL),
    todayScore: gl.dayScore,
    todayCounted: gl.anchor === today,
    currentWeekKey: gl.week,
    freezes: gl.freezes,
    maxFreezes: GAME_RULES.MAX_FREEZES,
    frozenDays: gl.frozen
  };
}

/** Current progress for display (does not change the ledger) */
export function viewLedger(raw, now = new Date()) {
  const today = schoolDay(now);
  return summary(settle(normalizeLedger(raw), today), today);
}

/**
 * Register one finished game. Returns the new ledger and how many points to award.
 * @param raw     stored ledger
 * @param score   points scored in the game (before the weekly limit)
 */
export function playGame(raw, score, now = new Date()) {
  const today = schoolDay(now);
  const gl = settle(normalizeLedger(raw), today);
  const s = num(score, 0, GAME_RULES.MAX_PER_GAME);
  gl.n += 1;
  gl.dayScore += s;
  if (gl.anchor !== today && gl.dayScore >= GAME_RULES.MIN_DAILY_SCORE) {
    gl.anchor = today;
    gl.streak += 1;
    if (gl.streak % GAME_RULES.DAYS_PER_LEVEL === 0) gl.level = Math.min(MAX_LEVEL, gl.level + 1);
  }
  const limit = limitForLevel(gl.level);
  const award = Math.min(s, Math.max(0, limit - gl.pts));
  gl.pts += award;
  return { ledger: gl, award, score: s, ...summary(gl, today) };
}

/**
 * Add one streak freeze (purchase or teacher's gift). Missed days are settled first.
 * Returns { ok, ledger } — ok is false when the student already keeps MAX_FREEZES.
 */
export function addFreeze(raw, now = new Date()) {
  const today = schoolDay(now);
  const gl = settle(normalizeLedger(raw), today);
  if (gl.freezes >= GAME_RULES.MAX_FREEZES) return { ok: false, ledger: gl };
  gl.freezes += 1;
  gl.n += 1;
  return { ok: true, ledger: gl };
}

/**
 * First use of the new rules: carry over this week's points and a streak that is still alive
 * from the previous format ({ week, pts } + gameStats.dailyStreak / lastGameDate).
 */
export function migrateLedger(oldLedger, gameStats, now = new Date()) {
  if (oldLedger && oldLedger.v === 2) return normalizeLedger(oldLedger);
  const today = schoolDay(now);
  const gl = normalizeLedger(null);
  gl.week = weekKeyOfDay(today);
  if (oldLedger && oldLedger.week === gl.week) gl.pts = num(oldLedger.pts);
  const last = gameStats && gameStats.lastGameDate;
  if (isDay(last) && num(gameStats.dailyStreak) > 0 && dayIndex(today) - dayIndex(last) <= 1) {
    gl.streak = num(gameStats.dailyStreak, 0, 60);
    gl.level = Math.floor(gl.streak / GAME_RULES.DAYS_PER_LEVEL);
    gl.anchor = last;
  }
  return gl;
}
