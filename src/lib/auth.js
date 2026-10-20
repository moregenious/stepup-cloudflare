/**
 * Server-side authentication for staff (login/password) and students (phone|login + PIN, or QR).
 */
import { config } from './config.js';
import { getStorage } from './storage/index.js';
import { HttpError, parseCookies, sessionCookie, clientIp } from './http.js';
import { verifyPassword, signToken, verifyToken, normalizePhone, derivePin } from './security.js';
import { ensureBootstrapped, appendActivityLog, loadCreds } from './engine.js';
import { LIST_COLLS, GUARD_PATH, shardPath, parseShardDoc, shardKeyFor } from './shards.js';

// ---------- Brute-force guard (persisted in Firestore, written only on failures) ----------
async function guardCheck(key) {
  const storage = getStorage();
  const doc = await storage.get(GUARD_PATH);
  const data = doc ? JSON.parse(doc.json || '{}') : {};
  const now = Date.now();
  const fails = (data[key] || []).filter(t => now - t < config.loginWindowSec * 1000);
  if (fails.length >= config.loginMaxFails) {
    const waitMin = Math.ceil((config.loginWindowSec * 1000 - (now - fails[0])) / 60000);
    throw new HttpError(429, `Слишком много неудачных попыток входа. Попробуйте снова через ${waitMin} мин.`);
  }
  return data;
}

async function guardRecord(key, success) {
  const storage = getStorage();
  try {
    await storage.transaction(async (tx) => {
      const doc = await tx.get(GUARD_PATH);
      const data = doc ? JSON.parse(doc.json || '{}') : {};
      const now = Date.now();
      for (const k of Object.keys(data)) {
        data[k] = (data[k] || []).filter(t => now - t < config.loginWindowSec * 1000);
        if (!data[k].length) delete data[k];
      }
      if (success) {
        if (!data[key]) return;
        delete data[key];
      } else {
        data[key] = [...(data[key] || []), now].slice(-50);
      }
      tx.set(GUARD_PATH, { json: JSON.stringify(data) });
    });
  } catch (e) {
    console.warn('[auth] guard write failed:', e.message);
  }
}

// ---------- Data access ----------
async function loadAllRows(coll) {
  const storage = getStorage();
  const n = LIST_COLLS[coll];
  const keys = Array.from({ length: n }, (_, i) => `${coll}~${i}`);
  const docs = await storage.getMany(keys.map(shardPath));
  const rows = [];
  docs.forEach(doc => {
    const sh = parseShardDoc(doc);
    for (const { d } of Object.values(sh.rows)) if (d) rows.push(d);
  });
  return rows;
}

async function loadRow(coll, id) {
  const storage = getStorage();
  const sh = parseShardDoc(await storage.get(shardPath(shardKeyFor(coll, id))));
  return sh.rows[id]?.d || null;
}

async function issueSession(request, payload) {
  const ttl = config.sessionDays * 86400;
  const token = await signToken(payload, ttl);
  return { token, cookie: sessionCookie(request, token, ttl) };
}

function initials(name) {
  return String(name || '').split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('');
}

// ---------- Public API ----------
export async function getSessionUser(request) {
  const cookies = parseCookies(request);
  let token = cookies[config.cookieName];
  const authz = request.headers.get('authorization');
  if (!token && authz && authz.startsWith('Bearer ')) token = authz.slice(7);
  const payload = await verifyToken(token);
  if (!payload || !payload.role || !payload.uid) return null;
  return { role: payload.role, uid: payload.uid, name: payload.name || '' };
}

export async function requireUser(request, roles = null) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, 'Требуется вход в систему', { code: 'session_invalid' });
  if (roles && !roles.includes(user.role)) throw new HttpError(403, 'Недостаточно прав');
  return user;
}

export function logoutCookie(request) {
  return sessionCookie(request, '', 0);
}

export async function loginStaff(request, loginOrPhone, password) {
  await ensureBootstrapped();
  const q = String(loginOrPhone || '').trim().toLowerCase();
  const pass = String(password || '').trim();
  if (!q || !pass) throw new HttpError(400, 'Введите логин и пароль');

  const guardKey = `staff:${clientIp(request)}:${q}`;
  await guardCheck(guardKey);

  const creds = await loadCreds(getStorage());
  // 1. Admin
  const adminLogins = (creds.admin?.logins || []).map(s => String(s).toLowerCase());
  if (adminLogins.includes(q) && await verifyPassword(pass, creds.admin?.hash)) {
    await guardRecord(guardKey, true);
    const session = await issueSession(request, { role: 'admin', uid: 'admin', name: 'Администратор' });
    await appendActivityLog({ type: 'auth', title: 'Вход Администратора', details: 'Администратор выполнил вход в систему', authorName: 'Администратор', authorRole: 'admin' });
    return { session, body: { success: true, role: 'admin', user: { id: 'admin' }, message: 'Вход в панель Администратора выполнен успешно' } };
  }

  // 2. Teacher
  const qPhone = normalizePhone(loginOrPhone);
  const teachers = await loadAllRows('teachers');
  const teacher = teachers.find(t => {
    if (t.status !== 'active') return false;
    const matchLogin = t.login && String(t.login).toLowerCase() === q;
    const matchEmail = t.email && String(t.email).toLowerCase() === q;
    const matchPhone = qPhone && qPhone.length > 5 && normalizePhone(t.phone) === qPhone;
    return matchLogin || matchEmail || matchPhone;
  });
  if (teacher && await verifyPassword(pass, creds.teachers?.[teacher.id])) {
    await guardRecord(guardKey, true);
    const session = await issueSession(request, { role: 'teacher', uid: teacher.id, name: teacher.fullName });
    await appendActivityLog({ type: 'auth', title: 'Вход преподавателя', details: `Преподаватель ${teacher.fullName} выполнил вход в систему`, authorName: teacher.fullName, authorRole: 'teacher' });
    return { session, body: { success: true, role: 'teacher', user: { id: teacher.id, fullName: teacher.fullName }, message: `Добро пожаловать, ${teacher.fullName}!` } };
  }

  await guardRecord(guardKey, false);
  throw new HttpError(401, 'Неверный логин, телефон или пароль сотрудника. Регистрация преподавателей осуществляется только Администратором.');
}

export async function loginStudentPin(request, phoneOrLogin, pin) {
  await ensureBootstrapped();
  const rawInput = String(phoneOrLogin || '').trim();
  const cleanPin = String(pin || '').trim();
  if (!rawInput) throw new HttpError(400, 'Пожалуйста, введите ваш номер телефона или логин.');
  if (!/^\d{4}$/.test(cleanPin)) throw new HttpError(400, 'Пожалуйста, введите ваш персональный 4-значный PIN-код из памятки.');

  const cleanLogin = rawInput.toLowerCase();
  const cleanPhone = normalizePhone(rawInput);
  const guardKey = `student:${clientIp(request)}:${cleanLogin}`;
  await guardCheck(guardKey);

  if (cleanPhone && cleanPhone.length > 5) {
    const teachers = await loadAllRows('teachers');
    const teacher = teachers.find(t => t.status === 'active' && normalizePhone(t.phone) === cleanPhone);
    if (teacher) {
      throw new HttpError(409, `Номер принадлежит преподавателю (${teacher.fullName}). Пожалуйста, переключитесь на вкладку «👨‍🏫 Преподавателям и Администрации».`, { isTeacherPhone: true });
    }
  }

  const students = await loadAllRows('students');
  const matches = (s) => {
    const sPhone = normalizePhone(s.phone);
    const sParentPhone = normalizePhone(s.parentPhone);
    const matchPhone = cleanPhone && cleanPhone.length > 5 && (sPhone === cleanPhone || sParentPhone === cleanPhone);
    const matchId = s.id && String(s.id).toLowerCase() === cleanLogin;
    const matchLogin = s.login && String(s.login).toLowerCase() === cleanLogin;
    const matchEmail = s.email && String(s.email).toLowerCase() === cleanLogin;
    return matchPhone || matchId || matchLogin || matchEmail;
  };
  // Several siblings may share a parent phone: accept the one whose PIN matches.
  const candidates = students.filter(s => s.status === 'active' && matches(s));
  const student = candidates.find(s => derivePin(s) === cleanPin);

  if (!student) {
    await guardRecord(guardKey, false);
    if (candidates.length) {
      throw new HttpError(401, 'Неверный 4-значный PIN-код. Проверьте памятку ученика или обратитесь к вашему преподавателю.');
    }
    throw new HttpError(404, 'Ученик с таким номером телефона или логином не найден в базе школы.');
  }

  await guardRecord(guardKey, true);
  const session = await issueSession(request, { role: 'student', uid: student.id, name: student.fullName });
  await appendActivityLog({ type: 'auth', title: 'Вход по PIN', details: `Ученик ${student.fullName} вошел в систему по номеру/логину и PIN-коду`, authorName: student.fullName, authorRole: 'student' });
  return { session, body: { success: true, role: 'student', user: { id: student.id, fullName: student.fullName }, message: `Добро пожаловать, ${student.fullName}!` } };
}

function decodeQrToken(raw) {
  let token = String(raw || '').trim();
  try { token = decodeURIComponent(token); } catch (e) { /* keep */ }
  let id = token;
  let pin = null;
  if (token.startsWith('ey') || /^[A-Za-z0-9+/_-]+={1,2}$/.test(token)) {
    try {
      const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
      const decoded = new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
      if (decoded.includes('{')) {
        const parsed = JSON.parse(decoded);
        if (parsed.id) { id = parsed.id; pin = parsed.pin || null; }
      } else if (decoded.includes(':')) {
        [id, pin] = decoded.split(':');
      }
    } catch (e) { /* not base64 */ }
  } else if (token.includes(':')) {
    [id, pin] = token.split(':');
  }
  return { id: String(id || '').trim(), pin: pin ? String(pin).trim() : null };
}

export async function loginStudentQr(request, rawToken) {
  await ensureBootstrapped();
  const { id, pin } = decodeQrToken(rawToken);
  if (!id) throw new HttpError(400, 'Отсутствует код авторизации');
  const guardKey = `qr:${clientIp(request)}`;
  await guardCheck(guardKey);

  let student = await loadRow('students', id);
  if (!student) {
    const all = await loadAllRows('students');
    student = all.find(s => s.id === id || s.login === id) || null;
  }
  const pinOk = student && (pin ? derivePin(student) === pin : config.allowLegacyQr);
  if (!student || !pinOk || student.status === 'archived') {
    await guardRecord(guardKey, false);
    throw new HttpError(404, 'Ученик по данному QR-коду не найден. Обратитесь к вашему преподавателю.');
  }
  const session = await issueSession(request, { role: 'student', uid: student.id, name: student.fullName });
  await appendActivityLog({ type: 'auth', title: 'Вход по QR-коду', details: `Ученик ${student.fullName} успешно вошел по персональному QR-коду`, authorName: student.fullName, authorRole: 'student' });
  return { session, body: { success: true, role: 'student', user: { id: student.id, fullName: student.fullName }, message: `Добро пожаловать, ${student.fullName}!` } };
}

export async function describeSession(request) {
  const user = await getSessionUser(request);
  if (!user) return { success: true, authenticated: false };
  await ensureBootstrapped();
  if (user.role === 'teacher') {
    const t = await loadRow('teachers', user.uid);
    if (!t || t.status !== 'active') return { success: true, authenticated: false };
  } else if (user.role === 'student') {
    const s = await loadRow('students', user.uid);
    if (!s) return { success: true, authenticated: false };
  }
  return { success: true, authenticated: true, role: user.role, user: { id: user.uid, name: user.name, initials: initials(user.name) } };
}
