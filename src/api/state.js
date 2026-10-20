import { readJson, route } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { readState, stateToJson } from '../lib/engine.js';

/**
 * POST /api/state
 *   { known: { shardKey: knownRev } } -> every shard newer than the client's copy (1 row read when nothing changed)
 *   { want:  { shardKey: knownRev } } -> only these shards
 */
export const POST = route(async (request) => {
  const user = await requireUser(request);
  const body = await readJson(request, 256 * 1024);
  const data = await readState(user, body.want || null, body.known || {});
  return new Response(stateToJson(data), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
});
