import { logServerEvent } from '../lib/events.js';
import { json, readJson, route, HttpError } from '../lib/http.js';
import { loginStaff, loginStudentPin, loginStudentQr, describeSession, logoutCookie } from '../lib/auth.js';

/** GET /api/auth -> current session */
export const GET = route(async (request) => json(await describeSession(request)));

/** POST /api/auth { action: 'staff' | 'student' | 'qr' | 'logout', ... } */
export const POST = route(async (request) => {
  const body = await readJson(request, 64 * 1024);
  let result;
  switch (body.action) {
    case 'staff':
      result = await loginStaff(request, body.login, body.password);
      break;
    case 'student':
      result = await loginStudentPin(request, body.login, body.pin);
      break;
    case 'qr':
      result = await loginStudentQr(request, body.token);
      break;
    case 'logout':
      return json({ success: true }, 200, { 'Set-Cookie': logoutCookie(request) });
    default:
      throw new HttpError(400, 'Неизвестное действие');
  }
  await logServerEvent({ role: result.body.role, uid: result.body.user?.id || 'admin' }, 'login', { via: body.action });
  return json(result.body, 200, { 'Set-Cookie': result.session.cookie });
});
