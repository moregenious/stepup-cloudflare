import { json, readJson, route } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { push } from '../lib/engine.js';

/** POST /api/push { ops: [...] } — validated, transactional write of changed rows. */
export const POST = route(async (request) => {
  const user = await requireUser(request);
  const body = await readJson(request, 4 * 1024 * 1024);
  return json(await push(user, body.ops || []));
});
