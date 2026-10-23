/**
 * Role-based access rules: what each role may change and what each role may see.
 */

/** Fields of a student row that only the server computes */
export const STUDENT_SERVER_FIELDS = ['totalPoints', 'lifetimePoints', 'pointsLedger', 'gameLedger', 'surveyBonusAwarded', 'lastBirthdayBonusYear'];
/** Fields derived on the client and never stored */
export const STUDENT_DERIVED_FIELDS = ['vocabularyPool'];

/** Student editing their own card (survey, avatar, games): everything except these */
const STUDENT_SELF_DENY = new Set([
  'id', 'pin', 'login', 'password', 'status', 'groupId', 'level', 'textbook', 'teacherId', 'createdAt', 'notes',
  ...STUDENT_SERVER_FIELDS, ...STUDENT_DERIVED_FIELDS
]);

/** Teacher editing their own profile */
const TEACHER_SELF_DENY = new Set(['id', 'login', 'password', 'status']);

/** What a student can see about classmates (needed for leaderboards, shop, games) */
const PUBLIC_STUDENT_FIELDS = [
  'id', 'fullName', 'groupId', 'level', 'textbook', 'textbooksStudied', 'status', 'grade', 'shift', 'createdAt',
  'totalPoints', 'lifetimePoints', 'avatarUrl', 'avatarFrame', 'studentTitle', 'unlockedTitles', 'gameStats'
];

const PUBLIC_TEACHER_FIELDS = ['id', 'fullName', 'phone', 'email', 'specialization', 'status', 'avatarColor'];

export function isStaff(user) {
  return user && (user.role === 'admin' || user.role === 'teacher');
}

/** Can the role touch this collection at all (coarse filter; fine checks happen in engine) */
export function collectionWritable(user, coll, id) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'teacher') {
    if (coll === 'settings' && id === 'admin') return false;
    return true;
  }
  if (user.role === 'student') {
    return ['students', 'pointRecords', 'purchases', 'activityLogs'].includes(coll);
  }
  return false;
}

/** Filter a patch op's paths for a student editing their own card / teacher editing own profile */
export function filterSelfPatch(op, denySet) {
  const allowed = (path) => Array.isArray(path) && path.length > 0 && !denySet.has(String(path[0]));
  return {
    ...op,
    set: (op.set || []).filter(([path]) => allowed(path)),
    unset: (op.unset || []).filter(path => allowed(path))
  };
}

export const SELF_DENY = { student: STUDENT_SELF_DENY, teacher: TEACHER_SELF_DENY };

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

/**
 * Returns the row as the given user may see it, or undefined to hide it.
 */
export function sanitizeRow(user, coll, id, data) {
  if (data === undefined || data === null) return data;
  const role = user?.role;

  if (coll === 'teachers') {
    const { password, ...rest } = data;
    if (role === 'student') return pick(rest, PUBLIC_TEACHER_FIELDS);
    return rest;
  }

  if (coll === 'settings' && id === 'admin') {
    const { password, ...rest } = data || {};
    if (role === 'student') return { name: rest.name || 'Администратор' };
    return rest;
  }

  if (role !== 'student') return data;

  // ---- Student view ----
  switch (coll) {
    case 'students':
      if (id === user.uid) {
        const { password, ...rest } = data;
        return rest;
      }
      return pick(data, PUBLIC_STUDENT_FIELDS);
    case 'pointRecords':
      if (data.studentId === user.uid) return data;
      return { ...data, comment: '' };
    case 'attendance': {
      // A student sees only their own marks (for the attendance stats in their cabinet)
      const mark = data && data.marks ? data.marks[user.uid] : undefined;
      if (mark === undefined) return undefined;
      return { ...data, marks: { [user.uid]: mark } };
    }
    case 'payments':
      return (data.studentId === user.uid || String(id).startsWith(user.uid + '_')) ? data : undefined;
    case 'activityLogs':
      return undefined;
    default:
      return data;
  }
}
