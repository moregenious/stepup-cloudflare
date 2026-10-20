/**
 * Local Cloudflare-like environment for Node: D1 (node:sqlite), R2 (folder), static assets, secrets.
 * Data lives in ./data (dev.sqlite, files/).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.mjs';
import { FakeR2 } from './fake-r2.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = process.env.STEPUP_DATA_DIR || path.join(ROOT, 'data');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.woff2': 'font/woff2'
};

function readDevVars() {
  const out = {};
  for (const name of ['.dev.vars', '.env']) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
      if (m && out[m[1]] === undefined) out[m[1]] = m[2];
    }
  }
  return out;
}

export function createLocalEnv() {
  fs.mkdirSync(DATA, { recursive: true });
  const vars = { ...readDevVars(), ...process.env };
  if (!vars.SESSION_SECRET) {
    const f = path.join(DATA, '.session-secret');
    if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'));
    vars.SESSION_SECRET = fs.readFileSync(f, 'utf8').trim();
  }
  const publicDir = path.join(ROOT, 'public');
  return {
    ...vars,
    DB: new FakeD1(path.join(DATA, 'dev.sqlite')),
    FILES: new FakeR2(path.join(DATA, 'files')),
    ASSETS: {
      async fetch(request) {
        let rel = decodeURIComponent(new URL(request.url).pathname);
        if (rel.endsWith('/')) rel += 'index.html';
        const file = path.normalize(path.join(publicDir, rel));
        if (!file.startsWith(publicDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return new Response('Not found', { status: 404 });
        }
        return new Response(fs.readFileSync(file), {
          headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' }
        });
      }
    }
  };
}
