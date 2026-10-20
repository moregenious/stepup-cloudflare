/**
 * Runtime configuration (Cloudflare vars/secrets, or process.env in Node).
 */
import { getEnv } from './env.js';

const env = () => getEnv();
const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));

export const config = {
  get sessionSecret() {
    const s = env().SESSION_SECRET;
    if (!s || String(s).length < 16) {
      throw new Error('SESSION_SECRET не задан. Выполните: npx wrangler secret put SESSION_SECRET (случайная строка из 32+ символов).');
    }
    return String(s);
  },
  get sessionDays() { return num(env().SESSION_DAYS, 60); },
  cookieName: 'stepup_sid',

  /** Max upload size. Workers Free accepts request bodies up to 100 MB. */
  get uploadMaxMb() { return num(env().UPLOAD_MAX_MB, 95); },

  get allowLegacyQr() { return !['0', 'false', 'no'].includes(String(env().ALLOW_LEGACY_QR ?? '1').toLowerCase()); },
  get loginMaxFails() { return num(env().LOGIN_MAX_FAILS, 8); },
  get loginWindowSec() { return num(env().LOGIN_WINDOW_SEC, 900); },

  /** Used only when the database is empty (no import was done yet). */
  get bootstrapAdminLogin() { return env().ADMIN_LOGIN || null; },
  get bootstrapAdminPassword() { return env().ADMIN_PASSWORD || null; }
};
