import { getEnv } from '../env.js';
import { D1Storage } from './d1.js';

let instance = null;
let boundDb = null;

/** Storage backed by the D1 binding `DB` (Cloudflare) or a compatible fake (dev/tests). */
export function getStorage() {
  const db = getEnv().DB;
  if (!db) throw new Error('База D1 не подключена: проверьте d1_databases (binding "DB") в wrangler.jsonc');
  if (!instance || boundDb !== db) {
    instance = new D1Storage(db);
    boundDb = db;
  }
  return instance;
}
