/**
 * Local development server that runs the real Worker code (src/worker.js) in Node.
 *   npm run dev   -> http://localhost:8787
 * (Alternatively: npx wrangler dev — Cloudflare's own local runtime.)
 */
import http from 'node:http';
import { Readable } from 'node:stream';
import worker from '../src/worker.js';
import { createLocalEnv, DATA } from './local-env.mjs';

const PORT = Number(process.env.PORT || 8787);
const env = createLocalEnv();

http.createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const request = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? 'half' : undefined
    });
    // Static files are served by Cloudflare before the Worker; emulate run_worker_first patterns
    const p = new URL(request.url).pathname;
    const response = (p.startsWith('/api/') || p.startsWith('/files/') || p.startsWith('/uploads/'))
      ? await worker.fetch(request, env)
      : await env.ASSETS.fetch(request);
    const out = {};
    response.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(response.status, out);
    if (response.body && req.method !== 'HEAD') Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: String(err?.message || err) }));
  }
}).listen(PORT, () => {
  console.log(`Step Up English (local Worker): http://localhost:${PORT}   data: ${DATA}`);
});
