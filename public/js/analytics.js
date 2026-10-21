/**
 * Behaviour analytics: small events are queued in memory and sent in batches to /api/events
 * (every 30 s, when 40 events pile up, or right away when the tab is hidden/closed).
 * Analytics must never disturb the app: every error here is swallowed.
 */
import { apiRequest } from './api.js';

const FLUSH_MS = 30000;
const BATCH = 40;
const MAX_QUEUE = 300;

const sessionId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
let queue = [];
let timer = null;
let sending = false;
let contextFn = () => ({});
const gameOpenedAt = new Map();
let lastPage = { page: null, at: 0 };

/** Extra fields for every event (the app tells us the student's group) */
export function setAnalyticsContext(fn) {
  contextFn = typeof fn === 'function' ? fn : () => ({});
}

function loggedIn() {
  try { return Boolean(window.__stepupAuth && window.__stepupAuth.isLoggedIn); } catch (e) { return false; }
}

export function track(type, props = {}) {
  try {
    if (!loggedIn()) return;
    let ctx = {};
    try { ctx = contextFn() || {}; } catch (e) { ctx = {}; }
    if (type === 'page_view') {
      // The router may report the same page twice while redirecting
      if (lastPage.page === props.page && Date.now() - lastPage.at < 1500) return;
      lastPage = { page: props.page, at: Date.now() };
      if (props.page === 'games') gameOpenedAt.set('*', Date.now());
    }
    queue.push({ t: type, ts: new Date().toISOString(), sid: sessionId, gid: ctx.gid || undefined, p: props });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    if (queue.length >= BATCH) flush();
    else if (!timer) timer = setTimeout(() => flush(), FLUSH_MS);
  } catch (e) { /* ignore */ }
}

export async function flush({ keepalive = false } = {}) {
  clearTimeout(timer);
  timer = null;
  if (sending || !queue.length || !loggedIn()) return;
  const batch = queue.splice(0, 50);
  sending = true;
  try {
    await apiRequest('/api/events', { body: { events: batch }, keepalive, timeoutMs: 15000 });
  } catch (e) {
    // Network problem: keep the events for the next attempt; other errors (e.g. logged out): drop them
    if (e && e.network) queue = batch.concat(queue).slice(-MAX_QUEUE);
  } finally {
    sending = false;
    if (queue.length && !timer) timer = setTimeout(() => flush(), FLUSH_MS);
  }
}

// ---------- Helpers for specific events ----------
export function deviceInfo() {
  try {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return { device: coarse ? 'mobile' : 'desktop', w: window.innerWidth };
  } catch (e) { return {}; }
}

export function trackGameOpen(game) {
  gameOpenedAt.set(game, Date.now());
  track('game_open', { game });
}

export function trackGameEnd(game, score, award) {
  const since = gameOpenedAt.get(game) || gameOpenedAt.get('*');
  const props = { game, score: Number(score) || 0, award: Number(award) || 0 };
  if (since) props.dur = Math.round((Date.now() - since) / 1000);
  gameOpenedAt.set(game, Date.now()); // the next round is timed from here
  track('game_end', props);
}

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { track('app_hide'); flush({ keepalive: true }); }
    else track('app_show');
  });
  window.addEventListener('pagehide', () => flush({ keepalive: true }));
}
