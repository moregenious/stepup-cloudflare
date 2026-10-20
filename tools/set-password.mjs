/**
 * Emergency password reset (e.g. forgotten admin password). Runs SQL on D1 through Wrangler.
 *   node tools/set-password.mjs admin <new-password> [--local]
 *   node tools/set-password.mjs teacher <login|email> <new-password> [--local]
 * Without --local it changes the production database (npx wrangler d1 execute stepup --remote).
 */
import { execFileSync } from 'node:child_process';
import { hashPassword } from '../src/lib/security.js';

const args = process.argv.slice(2).filter(a => a !== '--local');
const LOCAL = process.argv.includes('--local');
const [kind, a, b] = args;
if (!['admin', 'teacher'].includes(kind) || !a || (kind === 'teacher' && !b)) {
  console.error('Использование:\n  node tools/set-password.mjs admin <пароль> [--local]\n  node tools/set-password.mjs teacher <логин|email> <пароль> [--local]');
  process.exit(1);
}

async function runSql(sql) {
  if (LOCAL) {
    const { createLocalEnv } = await import('../dev/local-env.mjs');
    const env = createLocalEnv();
    return env.DB.db.prepare(sql).all();
  }
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'stepup', '--remote', '--json', '--command', sql], { encoding: 'utf8', shell: process.platform === 'win32' });
  const parsed = JSON.parse(out);
  return parsed[0]?.results || [];
}

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const hash = await hashPassword(kind === 'admin' ? a : b);
let pathExpr;
if (kind === 'admin') {
  pathExpr = '$.admin.hash';
} else {
  const rows = await runSql("SELECT body FROM docs WHERE path = 'stepup_shards/teachers~0'");
  const shard = JSON.parse(rows[0]?.body || '{"rows":{}}');
  const lq = a.toLowerCase();
  const t = Object.values(shard.rows).map(r => r.d).find(t => (t.login || '').toLowerCase() === lq || (t.email || '').toLowerCase() === lq);
  if (!t) { console.error('Преподаватель не найден'); process.exit(1); }
  console.log('Преподаватель:', t.fullName);
  pathExpr = `$.teachers."${t.id}"`;
}
await runSql(`UPDATE docs SET body = json_set(body, ${q(pathExpr)}, ${q(hash)}) WHERE path = 'stepup_private/credentials'`);
console.log('Пароль обновлён.');
