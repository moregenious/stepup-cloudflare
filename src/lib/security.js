/**
 * Password hashing (PBKDF2 via WebCrypto), signed session tokens (HMAC-SHA256),
 * PIN derivation and phone normalisation. Works in Cloudflare Workers and Node 20+.
 */
import { config } from './config.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
// Workers Free allows 10 ms of CPU per request; 4000 iterations cost ~2 ms.
// Brute force is additionally limited by the login guard (8 attempts / 15 min).
const PBKDF2_ITER = 4000;

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function b64urlFromBytes(bytes) {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlFromString(str) {
  return b64urlFromBytes(enc.encode(str));
}
function stringFromB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomHex(bytes = 8) {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

async function pbkdf2(password, salt, iterations) {
  const key = await subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!iterations || iterations > 200000) return false;
  try {
    const hash = await pbkdf2(password, fromHex(parts[2]), iterations);
    return constantTimeEqual(toHex(hash), parts[3]);
  } catch (e) {
    return false;
  }
}

// ---------- Session tokens ----------
let hmacKeyCache = { secret: null, key: null };
async function hmacKey() {
  const secret = config.sessionSecret;
  if (hmacKeyCache.secret !== secret) {
    hmacKeyCache = {
      secret,
      key: await subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    };
  }
  return hmacKeyCache.key;
}

async function sign(body) {
  return b64urlFromBytes(new Uint8Array(await subtle.sign('HMAC', await hmacKey(), enc.encode(body))));
}

export async function signToken(payload, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64urlFromString(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  return `${body}.${await sign(body)}`;
}

export async function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = await sign(body);
  if (!constantTimeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(stringFromB64url(body));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ---------- Phones & PINs (exact ports of js/store.js helpers) ----------
export function normalizePhone(rawPhone) {
  if (!rawPhone) return '';
  const digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) return '+7' + digits.slice(1);
  if (digits.length === 10) return '+7' + digits;
  return '+' + digits;
}

export function derivePin(student) {
  if (!student) return '1234';
  if (student.pin && /^\d{4}$/.test(String(student.pin).trim())) return String(student.pin).trim();
  let hash = 5381;
  const seed = String(student.id || '') + String(student.phone || '') + 'ep-pin-salt';
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }
  return String(Math.abs(hash) % 9000 + 1000);
}
