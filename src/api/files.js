import { config } from '../lib/config.js';
import { json, route, HttpError } from '../lib/http.js';
import { requireUser } from '../lib/auth.js';
import { bucket, newKey, isValidKey, describeFile, contentTypeFor, extOf, IMAGE } from '../lib/files.js';

/**
 * PUT /api/files?name=<file name>&folder=<materials|audio|images|avatars>&target=<student|teacher_admin>
 * Body: raw file bytes. Returns the lesson-file descriptor used by the app.
 * Admins may pass &key=<exact key> (used by the migration tool).
 */
export const PUT = route(async (request) => {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const name = url.searchParams.get('name') || 'file';
  const folder = url.searchParams.get('folder') || '';
  const target = url.searchParams.get('target') || null;
  const size = Number(request.headers.get('content-length') || 0);
  if (!request.body) throw new HttpError(400, 'Файл не передан');
  if (!size) throw new HttpError(411, 'Не указан размер файла (Content-Length)');
  if (size > config.uploadMaxMb * 1024 * 1024) throw new HttpError(413, `Файл больше ${config.uploadMaxMb} МБ`);

  if (user.role === 'student') {
    if (folder !== 'avatars' || !IMAGE.includes(extOf(name)) || size > 2 * 1024 * 1024) {
      throw new HttpError(403, 'Ученики могут загружать только фото профиля (до 2 МБ)');
    }
  }

  let key = newKey(folder, name);
  const explicit = url.searchParams.get('key');
  if (explicit) {
    if (user.role !== 'admin') throw new HttpError(403, 'Недостаточно прав');
    if (!isValidKey(explicit)) throw new HttpError(400, 'Некорректный ключ файла');
    key = explicit;
  }

  await bucket().put(key, request.body, {
    httpMetadata: { contentType: request.headers.get('content-type') || contentTypeFor(name) }
  });
  return json({ success: true, file: describeFile(name, key, size, target) });
});
