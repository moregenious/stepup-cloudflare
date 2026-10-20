import { json, readJson, route, HttpError } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { exportStateJson, importState, backupToState } from '../lib/engine.js';

/** GET /api/admin?action=export — full backup (admin only) */
export const GET = route(async (request) => {
  await requireUser(request, ['admin']);
  const url = new URL(request.url);
  if (url.searchParams.get('action') !== 'export') throw new HttpError(400, 'Неизвестное действие');
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(await exportStateJson(), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="stepup-backup-${stamp}.json"`,
      'Cache-Control': 'no-store'
    }
  });
});

/** POST /api/admin { action: 'import', state } — restore a (small) backup. Large ones: tools/prepare-migration.mjs */
export const POST = route(async (request) => {
  await requireUser(request, ['admin']);
  const body = await readJson(request, 8 * 1024 * 1024);
  if (body.action !== 'import') throw new HttpError(400, 'Неизвестное действие');
  const state = backupToState(body.state);
  if (!state || !Array.isArray(state.students)) throw new HttpError(400, 'Файл резервной копии не распознан (нет списка учеников)');
  const result = await importState(state);
  return json({ success: true, ...result });
});
