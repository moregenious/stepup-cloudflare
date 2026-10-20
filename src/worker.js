/**
 * Step Up English — Cloudflare Worker entry point.
 *   /api/*    -> API handlers (src/api)
 *   /files/*  -> lesson files from R2 (logged-in users only)
 *   others    -> static site from ./public (served by Cloudflare without invoking this Worker)
 */
import { setEnv } from './lib/env.js';
import { json } from './lib/http.js';
import { getSessionUser } from './lib/auth.js';
import { serveFile, isValidKey } from './lib/files.js';
import * as auth from './api/auth.js';
import * as state from './api/state.js';
import * as push from './api/push.js';
import * as files from './api/files.js';
import * as admin from './api/admin.js';
import * as cfg from './api/config.js';

const API = { auth, state, push, files, admin, config: cfg };

export default {
  async fetch(request, env) {
    setEnv(env);
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      const m = path.match(/^\/api\/([a-z-]+)\/?$/);
      if (m) {
        const mod = API[m[1]];
        if (!mod) return json({ success: false, error: 'Not found' }, 404);
        const handler = mod[request.method];
        if (!handler) return json({ success: false, error: 'Method not allowed' }, 405);
        return await handler(request);
      }

      if (path.startsWith('/files/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
        const user = await getSessionUser(request);
        if (!user) return new Response('Требуется вход в систему', { status: 401 });
        const key = path.slice('/files/'.length).split('/').map(decodeURIComponent).join('/');
        if (!isValidKey(key)) return new Response('Bad key', { status: 400 });
        return await serveFile(request, key);
      }

      // Old links from the Python server era: /uploads/<name> -> /files/lessons/<name>
      if (path.startsWith('/uploads/')) {
        return Response.redirect(new URL('/files/lessons/' + path.slice('/uploads/'.length) + url.search, url).toString(), 301);
      }

      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.error('[worker]', err);
      return json({ success: false, error: 'Внутренняя ошибка сервера: ' + (err?.message || err) }, 500);
    }
  }
};
