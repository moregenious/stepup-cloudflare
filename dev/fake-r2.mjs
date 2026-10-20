/**
 * R2-compatible binding backed by a local folder (for `npm run dev` and tests).
 * Implements put/get/head with Range support used by src/lib/files.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  if (m[1] === '' && m[2] !== '') return { suffix: Number(m[2]) };
  const offset = Number(m[1] || 0);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return { offset, length: end - offset + 1 };
}

export class FakeR2 {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }
  file(key) {
    const p = path.normalize(path.join(this.dir, key));
    if (!p.startsWith(path.normalize(this.dir))) throw new Error('bad key');
    return p;
  }
  meta(key, stat, contentType) {
    return {
      key,
      size: stat.size,
      httpEtag: `"${stat.size}-${Math.floor(stat.mtimeMs)}"`,
      writeHttpMetadata(h) { if (contentType) h.set('content-type', contentType); }
    };
  }
  readMeta(key) {
    try { return JSON.parse(fs.readFileSync(this.file(key) + '.meta.json', 'utf8')); } catch (e) { return {}; }
  }
  async put(key, body, opts = {}) {
    const p = this.file(key);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let buf;
    if (body instanceof ReadableStream) buf = Buffer.from(await new Response(body).arrayBuffer());
    else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) buf = Buffer.from(body);
    else buf = Buffer.from(String(body ?? ''));
    fs.writeFileSync(p, buf);
    fs.writeFileSync(p + '.meta.json', JSON.stringify({ contentType: opts.httpMetadata?.contentType || null }));
    return this.meta(key, fs.statSync(p), opts.httpMetadata?.contentType);
  }
  async head(key) {
    const p = this.file(key);
    if (!fs.existsSync(p)) return null;
    return this.meta(key, fs.statSync(p), this.readMeta(key).contentType);
  }
  async get(key, opts = {}) {
    const p = this.file(key);
    if (!fs.existsSync(p)) return null;
    const stat = fs.statSync(p);
    const obj = this.meta(key, stat, this.readMeta(key).contentType);
    const rangeHeader = opts.range && typeof opts.range.get === 'function' ? opts.range.get('range') : null;
    let start = 0;
    let end = stat.size - 1;
    if (rangeHeader) {
      const r = parseRange(rangeHeader, stat.size);
      if (r) {
        obj.range = r;
        if (r.suffix !== undefined) start = Math.max(0, stat.size - r.suffix);
        else { start = r.offset; end = r.offset + r.length - 1; }
      }
    }
    obj.body = stat.size ? Readable.toWeb(fs.createReadStream(p, { start, end })) : new Response('').body;
    return obj;
  }
}
