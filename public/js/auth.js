/**
 * Auth & Role Management Context for Step Up English CRM & LMS
 * Supports:
 * - Students: Personal PIN / Login or QR Code (matched with student database cards)
 * - Teachers & Admin: Credentials login (Registration strictly by Admin)
 */

import { store, normalizePhone, formatPhoneForDisplay } from './store.js';
import { apiRequest } from './api.js';

class Auth {
  constructor() {
    this.ROLE_ADMIN = 'admin';
    this.ROLE_TEACHER = 'teacher';
    this.ROLE_STUDENT = 'student';

    this.currentRole = localStorage.getItem('crm_current_role') || null;
    this.currentTeacherId = localStorage.getItem('crm_current_teacher_id') || null;
    this.currentStudentId = localStorage.getItem('crm_current_student_id') || null;
    this.isLoggedIn = localStorage.getItem('crm_is_logged_in') === 'true';

    this.listeners = [];

    if (typeof window !== 'undefined') window.__stepupAuth = this;
    if (this.isLoggedIn) this.verifySession();
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener({
          isLoggedIn: this.isLoggedIn,
          role: this.currentRole,
          user: this.getCurrentUser()
        });
      } catch (e) {
        console.error('Error in auth listener:', e);
      }
    }
  }

  isAuthenticated() {
    return this.isLoggedIn && !!this.currentRole;
  }

  /** The session cookie is the source of truth: check it once on startup */
  async verifySession() {
    try {
      const res = await apiRequest('/api/auth', { method: 'GET' });
      if (!res.authenticated) {
        this.forceLogout();
        return;
      }
      const expectedId = res.role === 'teacher' ? this.currentTeacherId : res.role === 'student' ? this.currentStudentId : 'admin';
      if (res.role !== this.currentRole || res.user?.id !== expectedId) {
        this.applySession(res.role, res.user?.id);
      }
    } catch (e) {
      // Offline: keep the cached session, data will sync when the connection returns
    }
  }

  applySession(role, userId) {
    // Different user on this device? Drop the previous user's cached data first.
    const prevKey = `${this.currentRole}:${this.currentRole === 'teacher' ? this.currentTeacherId : this.currentStudentId}`;
    const nextKey = `${role}:${userId}`;
    if (this.isLoggedIn && prevKey !== nextKey) store.stopSync();

    this.currentRole = role;
    this.isLoggedIn = true;
    this.currentTeacherId = role === this.ROLE_TEACHER ? userId : null;
    this.currentStudentId = role === this.ROLE_STUDENT ? userId : null;

    localStorage.setItem('crm_current_role', role);
    localStorage.setItem('crm_is_logged_in', 'true');
    if (this.currentTeacherId) localStorage.setItem('crm_current_teacher_id', this.currentTeacherId);
    else localStorage.removeItem('crm_current_teacher_id');
    if (this.currentStudentId) localStorage.setItem('crm_current_student_id', this.currentStudentId);
    else localStorage.removeItem('crm_current_student_id');

    store.startSync();
    this.notify();
  }

  async serverLogin(payload) {
    try {
      // Switching accounts on this device: first save what the previous user changed
      if (this.isLoggedIn && store.sync.hasPendingChanges()) await store.sync.flush(15000);
      const res = await apiRequest('/api/auth', { body: payload });
      this.applySession(res.role, res.user?.id);
      // Wait for the first data load so the cabinet opens with data
      await Promise.race([store.whenReady(), new Promise(r => setTimeout(r, 15000))]);
      return { success: true, role: res.role, message: res.message, student: res.role === 'student' ? store.getStudentById(res.user?.id) : undefined };
    } catch (err) {
      return {
        success: false,
        isTeacherPhone: Boolean(err.data?.isTeacherPhone),
        message: err.message || 'Ошибка входа'
      };
    }
  }

  // --- Student QR Code Auto-Login ---
  async loginStudentWithQr(tokenOrId) {
    if (!tokenOrId) return { success: false, message: 'Отсутствует код авторизации' };
    return this.serverLogin({ action: 'qr', token: String(tokenOrId).trim() });
  }

  // --- Student PIN / Login Authentication ---
  async loginStudentWithPin(phoneOrLogin, pin) {
    const rawInput = String(phoneOrLogin || '').trim();
    const cleanPin = String(pin || '').trim();
    if (!rawInput) {
      return { success: false, message: 'Пожалуйста, введите ваш номер телефона или логин.' };
    }
    if (!cleanPin || cleanPin.length !== 4) {
      return { success: false, message: 'Пожалуйста, введите ваш персональный 4-значный PIN-код из памятки.' };
    }
    return this.serverLogin({ action: 'student', login: rawInput, pin: cleanPin });
  }

  // --- Staff Authentication (Admin & Teachers) ---
  async loginStaff(loginOrPhone, password) {
    return this.serverLogin({ action: 'staff', login: String(loginOrPhone || '').trim(), password: String(password || '').trim() });
  }

  // --- Quick Switch / Demo Helper ---
  setRole(role, specificId = null) {
    this.currentRole = role;
    this.isLoggedIn = true;
    localStorage.setItem('crm_is_logged_in', 'true');
    localStorage.setItem('crm_current_role', role);

    if (role === this.ROLE_TEACHER && specificId) {
      this.currentTeacherId = specificId;
      localStorage.setItem('crm_current_teacher_id', specificId);
    } else if (role === this.ROLE_STUDENT && specificId) {
      this.currentStudentId = specificId;
      localStorage.setItem('crm_current_student_id', specificId);
    }

    this.notify();
  }

  /** Clear the local session (and cached data) without contacting the server */
  forceLogout() {
    if (!this.isLoggedIn && !this.currentRole) return;
    this.isLoggedIn = false;
    this.currentRole = null;
    this.currentTeacherId = null;
    this.currentStudentId = null;
    localStorage.removeItem('crm_is_logged_in');
    localStorage.removeItem('crm_current_role');
    localStorage.removeItem('crm_current_teacher_id');
    localStorage.removeItem('crm_current_student_id');
    store.stopSync();
    this.notify();
  }

  /**
   * Log out after unsaved changes reach the server (a slow connection must not lose the last marks).
   * Resolves false if the user chose to stay because changes could not be saved.
   */
  async logout() {
    if (this._loggingOut) return this._loggingOut;
    this._loggingOut = (async () => {
      try {
        if (store.sync.hasPendingChanges()) {
          let toast = null;
          try { toast = (await import('./components/toast.js')).toast; } catch (e) { /* ignore */ }
          toast?.info('Сохраняем изменения перед выходом…');
          const saved = await store.sync.flush(20000);
          if (!saved && !window.confirm('Не удалось сохранить последние изменения: нет связи с сервером.\n\nВыйти всё равно? Несохранённые изменения пропадут.')) {
            return false;
          }
        }
        apiRequest('/api/auth', { body: { action: 'logout' } }).catch(() => {});
        this.forceLogout();
        return true;
      } finally {
        this._loggingOut = null;
      }
    })();
    return this._loggingOut;
  }

  getRole() {
    return this.currentRole;
  }

  isAdmin() {
    return this.isLoggedIn && this.currentRole === this.ROLE_ADMIN;
  }

  isTeacher() {
    return this.isLoggedIn && this.currentRole === this.ROLE_TEACHER;
  }

  isStudent() {
    return this.isLoggedIn && this.currentRole === this.ROLE_STUDENT;
  }

  getCurrentUser() {
    if (!this.isLoggedIn) {
      return {
        id: null,
        name: 'Гость',
        roleLabel: 'Не авторизован',
        avatarColor: '#64748b',
        initials: '?'
      };
    }

    if (this.currentRole === this.ROLE_ADMIN) {
      return {
        id: 'admin',
        name: store.state.admin?.name || 'Администратор',
        email: store.state.admin?.email || '',
        roleLabel: 'Главный администратор',
        avatarColor: '#4f46e5',
        initials: String(store.state.admin?.name || 'Администратор').split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase()
      };
    } else if (this.currentRole === this.ROLE_TEACHER) {
      const teacher = store.getTeacherById(this.currentTeacherId);
      if (teacher) {
        return {
          id: teacher.id,
          name: teacher.fullName,
          roleLabel: 'Преподаватель',
          avatarColor: teacher.avatarColor || '#0d9488',
          initials: String(teacher.fullName || '').split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('')
        };
      }
      return { id: this.currentTeacherId, name: 'Преподаватель', roleLabel: 'Преподаватель', avatarColor: '#0d9488', initials: 'П' };
    } else if (this.currentRole === this.ROLE_STUDENT) {
      const student = store.getStudentById(this.currentStudentId);
      if (student) {
        return {
          id: student.id,
          name: student.fullName,
          roleLabel: 'Ученик' + (student.level ? ' (' + student.level + ')' : ''),
          avatarColor: '#6366f1',
          initials: String(student.fullName || '').split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join(''),
          avatarUrl: student.avatarUrl || null,
          avatarFrame: student.avatarFrame || 'frame-none',
          studentTitle: student.studentTitle || '',
          groupId: student.groupId || null
        };
      }
      return { id: this.currentStudentId, name: 'Ученик', roleLabel: 'Ученик', avatarColor: '#6366f1', initials: 'У', groupId: null };
    }
    return {
      id: 'guest',
      name: 'Гость',
      roleLabel: 'Гость',
      avatarColor: '#64748b',
      initials: 'Г'
    };
  }
}

export const auth = new Auth();
