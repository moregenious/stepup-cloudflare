import { json, readJson, route, HttpError } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { normalizeEvents, saveEvents, exportEventsCsv } from '../lib/events.js';
import { schoolDay } from '../../public/js/shared/gameStreak.js';

/** POST /api/events { events: [{ t, ts, sid, gid, p }] } — any logged-in user, up to 50 per request */
export const POST = route(async (request) => {
  const user = await requireUser(request);
  const body = await readJson(request, 64 * 1024);
  const saved = await saveEvents(normalizeEvents(user, body.events));
  return json({ success: true, saved });
});

/** GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD&anon=1 — CSV export (admin only) */
export const GET = route(async (request) => {
  await requireUser(request, ['admin']);
  const url = new URL(request.url);
  const today = schoolDay();
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const from = isDay(url.searchParams.get('from')) ? url.searchParams.get('from') : '2000-01-01';
  const to = isDay(url.searchParams.get('to')) ? url.searchParams.get('to') : today;
  if (from > to) throw new HttpError(400, 'Неверный период');
  const anon = url.searchParams.get('anon') === '1';
  const { csv, count } = await exportEventsCsv({ from, to, anon });
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="stepup-events-${from}_${to}${anon ? '-anon' : ''}.csv"`,
      'Cache-Control': 'no-store',
      'X-Event-Count': String(count)
    }
  });
});
