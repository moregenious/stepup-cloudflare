/**
 * Tiny helpers for Web-standard (Request -> Response) handlers (Cloudflare Workers).
 */
import { config } from './config.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

export async function readJson(request, maxBytes = 8 * 1024 * 1024) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'Слишком большой запрос');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Слишком большой запрос');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new HttpError(400, 'Некорректный JSON');
  }
}

export function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('cookie') || '';
  raw.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; }
    }
  });
  return out;
}

function isHttps(request) {
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  try { return new URL(request.url).protocol === 'https:'; } catch (e) { return false; }
}

export function sessionCookie(request, token, maxAgeSec) {
  const parts = [
    `${config.cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`
  ];
  if (isHttps(request)) parts.push('Secure');
  return parts.join('; ');
}

export function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'local';
}

/**
 * Wrap a handler so thrown HttpErrors become JSON responses.
 */
export function route(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ success: false, error: err.message, ...err.extra }, err.status);
      }
      console.error('[api] unhandled error:', err);
      return json({ success: false, error: 'Внутренняя ошибка сервера: ' + (err?.message || err) }, 500);
    }
  };
}
