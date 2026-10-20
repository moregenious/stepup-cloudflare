/**
 * Prepares the move of an existing Step Up English database + lesson files to Cloudflare.
 *
 *   node tools/prepare-migration.mjs --backup english_crm_backup.json --uploads "C:\path\to\uploads"
 *
 * Produces in ./data/migration:
 *   import.sql      -> load into D1:  npx wrangler d1 execute stepup --remote --file=data/migration/import.sql
 *   files.json      -> list of files for tools/upload-files.mjs
 *   converted/      -> WAV files converted to MP3 (only when ffmpeg is installed)
 *
 * Options:
 *   --no-convert    keep WAV files as they are
 *   --local         also load everything into the local dev environment (data/dev.sqlite, data/files)
 *
 * Accepts: the old site's "Экспорт данных" JSON, the old Python db.json, or a new /api/admin export.
 * Lesson file links /uploads/<name> are rewritten to /files/lessons/<name>.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDatabaseFromState, backupToState } from '../src/lib/engine.js';
import { META_PATH, CREDS_PATH, shardPath, serializeShard, serializeMeta } from '../src/lib/shards.js';
import { contentTypeFor } from '../src/lib/files.js';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const backupFile = arg('--backup');
const uploadsDir = arg('--uploads');
const CONVERT = !args.includes('--no-convert');
const LOCAL = args.includes('--local');

if (!backupFile || !fs.existsSync(backupFile)) {
  console.error('Использование: node tools/prepare-migration.mjs --backup <файл.json> --uploads <папка uploads> [--no-convert] [--local]');
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'migration');
const CONV = path.join(OUT, 'converted');
fs.mkdirSync(CONV, { recursive: true });

function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
}

function oldName(url) {
  const m = String(url || '').match(/^(?:https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)?\.?\/uploads\/([^?#]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
}

const keyFor = (name) => 'lessons/' + name;
const urlFor = (key) => '/files/' + key.split('/').map(encodeURIComponent).join('/');

async function main() {
  const raw = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  const state = backupToState(raw);
  if (!Array.isArray(state.students)) throw new Error('В файле нет списка учеников — это не резервная копия Step Up English');

  const ffmpeg = CONVERT && hasFfmpeg();
  const files = new Map(); // old name -> { key, local, size, contentType }
  let missing = [];
  const convertFailed = [];

  const register = (name) => {
    if (files.has(name)) return files.get(name);
    let local = uploadsDir ? path.join(uploadsDir, name) : null;
    if (!local || !fs.existsSync(local)) {
      missing.push(name);
      files.set(name, null);
      return null;
    }
    let finalName = name;
    if (ffmpeg && name.toLowerCase().endsWith('.wav')) {
      const mp3Name = name.replace(/\.wav$/i, '.mp3');
      const out = path.join(CONV, mp3Name);
      try {
        if (!fs.existsSync(out)) {
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', local, '-codec:a', 'libmp3lame', '-b:a', '128k', out], { stdio: 'pipe' });
        }
        local = out;
        finalName = mp3Name;
      } catch (e) {
        try { fs.unlinkSync(out); } catch (e2) { /* ignore */ }
        convertFailed.push(name);
      }
    }
    const entry = { key: keyFor(finalName), local, size: fs.statSync(local).size, contentType: contentTypeFor(finalName), name: finalName };
    files.set(name, entry);
    return entry;
  };

  // 1. Lesson files: { url, download_url, name, type, ... }
  let rewritten = 0;
  for (const months of Object.values(state.textbookLessons || {})) {
    for (const lessons of Object.values(months || {})) {
      for (const lesson of Object.values(lessons || {})) {
        for (const f of (lesson && Array.isArray(lesson.files)) ? lesson.files : []) {
          const n = oldName(f.url) || oldName(f.download_url);
          if (!n) continue;
          const e = register(n);
          if (!e) continue;
          f.url = urlFor(e.key);
          f.download_url = urlFor(e.key) + '?download=1';
          if (e.name !== n && f.name && /\.wma$/i.test(f.name)) f.name = f.name.replace(/\.wma$/i, '.mp3');
          rewritten++;
        }
      }
    }
  }
  // 2. Any other /uploads links (shop photos, avatars)
  const walk = (v) => {
    if (typeof v === 'string') {
      const n = oldName(v);
      if (!n) return v;
      const e = register(n);
      return e ? urlFor(e.key) : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = walk(v[k]); }
    return v;
  };
  for (const k of Object.keys(state)) if (k !== 'textbookLessons') state[k] = walk(state[k]);

  // 3. Build the database
  const built = await buildDatabaseFromState(state, { rev: 1 });
  const docs = [];
  for (const [key, sh] of Object.entries(built.shards)) docs.push({ path: shardPath(key), obj: serializeShard(key, sh) });
  docs.push({ path: CREDS_PATH, obj: { json: JSON.stringify(built.creds) } });
  docs.push({ path: META_PATH, obj: serializeMeta(built.meta) });

  // 4. SQL for D1 (statements < 100 KB each)
  const q = (s) => (s === null || s === undefined ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'");
  const CHUNK = 30000;
  const lines = [
    'CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, ver INTEGER NOT NULL DEFAULT 0, tok TEXT, data TEXT, body TEXT);',
    'DELETE FROM docs;'
  ];
  for (const { path: p, obj } of docs) {
    const { json, ...rest } = obj;
    const body = typeof json === 'string' ? json : null;
    const first = body === null ? null : body.slice(0, CHUNK);
    lines.push(`INSERT INTO docs (path, ver, tok, data, body) VALUES (${q(p)}, 1, NULL, ${q(JSON.stringify(rest))}, ${q(first)});`);
    for (let i = CHUNK; body !== null && i < body.length; i += CHUNK) {
      lines.push(`UPDATE docs SET body = body || ${q(body.slice(i, i + CHUNK))} WHERE path = ${q(p)};`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'import.sql'), lines.join('\n') + '\n');

  const manifest = [...files.values()].filter(Boolean);
  fs.writeFileSync(path.join(OUT, 'files.json'), JSON.stringify(manifest, null, 1));

  const total = manifest.reduce((s, f) => s + f.size, 0);
  console.log(`Учеников: ${state.students.length}, групп: ${(state.groups || []).length}, учебников: ${Object.keys(state.textbookLessons || {}).length}`);
  console.log(`Ссылок на файлы в уроках обновлено: ${rewritten}`);
  console.log(`Файлов к загрузке: ${manifest.length}, объём ${(total / 1e6).toFixed(0)} МБ${ffmpeg ? ' (WAV сжаты в MP3)' : CONVERT ? ' (ffmpeg не найден — WAV загрузятся как есть)' : ''}`);
  if (convertFailed.length) console.log(`Не удалось сжать в MP3 (загрузятся как WAV): ${convertFailed.length}`);
  if (missing.length) console.log(`Не найдено в папке uploads: ${missing.length} (ссылки оставлены как были), например: ${missing.slice(0, 3).join(', ')}`);
  console.log(`\nГотово: ${path.relative(process.cwd(), path.join(OUT, 'import.sql'))} (${(fs.statSync(path.join(OUT, 'import.sql')).size / 1e6).toFixed(1)} МБ)`);

  if (LOCAL) {
    const { createLocalEnv } = await import('../dev/local-env.mjs');
    const env = createLocalEnv();
    const sql = fs.readFileSync(path.join(OUT, 'import.sql'), 'utf8');
    env.DB.db.exec(sql);
    for (const f of manifest) {
      await env.FILES.put(f.key, fs.readFileSync(f.local), { httpMetadata: { contentType: f.contentType } });
    }
    console.log(`Загружено в локальную среду (data/dev.sqlite, data/files): ${manifest.length} файлов.`);
  } else {
    console.log('\nДальше:');
    console.log('  npx wrangler d1 execute stepup --remote --file=data/migration/import.sql');
    console.log('  node tools/upload-files.mjs --site https://<ваш-сайт>.workers.dev --login admin');
  }
}

main().catch(err => {
  console.error('Ошибка:', err.message || err);
  process.exit(1);
});
