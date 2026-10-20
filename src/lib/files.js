/**
 * Lesson files, audio and photos in Cloudflare R2 (binding `FILES`).
 * Files are served through the Worker at /files/<key> to logged-in users only.
 */
import { getEnv } from './env.js';
import { HttpError } from './http.js';
import { randomHex } from './security.js';

export const AUDIO = ['.mp3', '.wav', '.wma', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.weba', '.webm', '.opus', '.mid', '.midi', '.amr', '.aiff', '.aif'];
export const IMAGE = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
export const DOCS = ['.doc', '.docx', '.docm', '.dotx', '.rtf', '.txt'];

const MIME = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wma': 'audio/x-ms-wma', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.webm': 'audio/webm', '.weba': 'audio/webm',
  '.opus': 'audio/opus', '.mid': 'audio/midi', '.midi': 'audio/midi', '.amr': 'audio/amr', '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.rtf': 'application/rtf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docm': 'application/vnd.ms-word.document.macroEnabled.12', '.dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  '.mp4': 'video/mp4', '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

export function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

export function contentTypeFor(name) {
  return MIME[extOf(name)] || 'application/octet-stream';
}

export function bucket() {
  const b = getEnv().FILES;
  if (!b) throw new HttpError(501, 'Хранилище файлов R2 не подключено (r2_buckets, binding "FILES" в wrangler.jsonc)');
  return b;
}

export function safeFileName(name) {
  const base = String(name || 'file').split(/[\\/]/).pop();
  const clean = base.replace(/[\s#%&{}<>*?$!'":@+`|=\\]/g, '_').replace(/_+/g, '_').slice(-120);
  return clean || 'file';
}

export function isValidKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length < 512 && !key.includes('..') && !key.startsWith('/') && !/[\u0000-\u001f\\]/.test(key);
}

export function newKey(folder, name) {
  const f = String(folder || 'materials').replace(/[^a-z0-9_-]/gi, '') || 'materials';
  return `${f}/${randomHex(4)}_${safeFileName(name)}`;
}

export function fileUrl(key) {
  return '/files/' + key.split('/').map(encodeURIComponent).join('/');
}

/** Same shape the app has always stored in lessons: { id, name, type, target, url, download_url, size } */
export function describeFile(name, key, sizeBytes, target) {
  const ext = extOf(name);
  let type = 'document';
  if (AUDIO.includes(ext)) type = 'audio';
  else if (IMAGE.includes(ext)) type = 'image';
  else if (ext === '.pdf') type = 'pdf';
  const url = fileUrl(key);
  return {
    id: 'f-' + randomHex(4),
    name,
    type,
    target: target || (DOCS.includes(ext) ? 'teacher_admin' : 'student'),
    url,
    download_url: url + '?download=1',
    size: `${Math.round((sizeBytes / 1024) * 10) / 10} KB`
  };
}

function originalName(key) {
  return decodeURIComponent(key.split('/').pop()).replace(/^[0-9a-f]{8}_/, '');
}

/** GET/HEAD /files/<key> with HTTP Range support (audio seeking) */
export async function serveFile(request, key) {
  const b = bucket();
  const url = new URL(request.url);
  const headers = new Headers();
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, max-age=86400');
  headers.set('x-content-type-options', 'nosniff');

  if (request.method === 'HEAD') {
    const head = await b.head(key);
    if (!head) return new Response(null, { status: 404 });
    head.writeHttpMetadata(headers);
    headers.set('etag', head.httpEtag);
    headers.set('content-length', String(head.size));
    return new Response(null, { status: 200, headers });
  }

  const hasRange = request.headers.has('range');
  const obj = await b.get(key, { range: hasRange ? request.headers : undefined, onlyIf: request.headers });
  if (!obj) return new Response('Файл не найден', { status: 404 });
  obj.writeHttpMetadata(headers);
  if (!headers.get('content-type')) headers.set('content-type', contentTypeFor(key));
  headers.set('etag', obj.httpEtag);
  if (url.searchParams.has('download')) {
    headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName(key))}`);
  }
  if (!('body' in obj) || !obj.body) {
    return new Response(null, { status: request.headers.has('if-none-match') ? 304 : 412, headers });
  }
  if (hasRange && obj.range) {
    const size = obj.size;
    let offset = obj.range.offset;
    let length = obj.range.length;
    if (obj.range.suffix !== undefined) { offset = Math.max(0, size - obj.range.suffix); length = size - offset; }
    offset = offset || 0;
    if (length === undefined) length = size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${size}`);
    headers.set('content-length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}
