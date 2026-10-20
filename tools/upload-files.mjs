/**
 * Uploads lesson files listed in data/migration/files.json to the deployed site (Cloudflare R2).
 * Safe to re-run: files already uploaded with the same size are skipped.
 *
 *   node tools/upload-files.mjs --site https://stepup-english.<name>.workers.dev --login admin
 *   (the password is asked interactively, or pass --password ...)
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const site = (arg('--site') || '').replace(/\/$/, '');
const login = arg('--login') || 'admin';
const manifestFile = arg('--manifest') || path.join('data', 'migration', 'files.json');
const CONCURRENCY = Number(arg('--parallel') || 3);

if (!site || !fs.existsSync(manifestFile)) {
  console.error('Использование: node tools/upload-files.mjs --site https://<сайт> --login admin [--password ...]');
  console.error('Сначала выполните tools/prepare-migration.mjs (создаёт data/migration/files.json)');
  process.exit(1);
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, a => { rl.close(); res(a); }));
}

const fileUrl = (key) => `${site}/files/${key.split('/').map(encodeURIComponent).join('/')}`;

async function main() {
  const password = arg('--password') || await ask(`Пароль для ${login}: `);
  const auth = await fetch(`${site}/api/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'staff', login, password })
  });
  const authJson = await auth.json().catch(() => ({}));
  if (!auth.ok || authJson.role !== 'admin') throw new Error('Вход администратора не удался: ' + (authJson.error || auth.status));
  const cookie = (auth.headers.get('set-cookie') || '').split(';')[0];

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  let done = 0, skipped = 0, failed = 0, bytes = 0;
  const queue = [...manifest];

  async function workerLoop() {
    while (queue.length) {
      const f = queue.shift();
      try {
        const head = await fetch(fileUrl(f.key), { method: 'HEAD', headers: { cookie } });
        if (head.ok && Number(head.headers.get('content-length')) === f.size) { skipped++; continue; }
        const body = fs.readFileSync(f.local);
        const params = new URLSearchParams({ name: f.name, key: f.key, folder: 'lessons' });
        let res;
        for (let attempt = 1; attempt <= 3; attempt++) {
          res = await fetch(`${site}/api/files?${params}`, {
            method: 'PUT',
            headers: { cookie, 'content-type': f.contentType, 'content-length': String(body.length) },
            body
          });
          if (res.ok) break;
          await new Promise(r => setTimeout(r, 1500 * attempt));
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        done++;
        bytes += f.size;
      } catch (err) {
        failed++;
        console.error(`\n  ошибка: ${f.name}: ${err.message}`);
      }
      process.stdout.write(`\r  загружено ${done}, пропущено ${skipped}, ошибок ${failed} из ${manifest.length} (${(bytes / 1e6).toFixed(0)} МБ)   `);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, workerLoop));
  console.log(failed ? '\nЕсть ошибки — запустите команду ещё раз, загруженные файлы будут пропущены.' : '\nВсе файлы загружены.');
}

main().catch(err => {
  console.error('Ошибка:', err.message || err);
  process.exit(1);
});
