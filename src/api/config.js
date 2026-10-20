import { config } from '../lib/config.js';
import { json, route } from '../lib/http.js';

/** Public client configuration */
export const GET = route(async () => json({
  success: true,
  platform: 'cloudflare',
  sync: 'poll',
  pollStaffSec: 15,
  pollStudentSec: 30,
  uploads: 'r2',
  uploadMaxMb: config.uploadMaxMb
}));
