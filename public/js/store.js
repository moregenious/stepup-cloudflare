/**
 * Central State Store & Persistence Layer for Step Up English
 * Supports Windows Explorer Hierarchy: Textbook -> 10 Months (1..10) -> 8 Lessons (1..8) -> Files & Homework
 */

import { MONTH_NAMES } from './data/seedData.js';
import { SyncEngine } from './sync.js';
import { trackGameEnd } from './analytics.js';
import { GAME_RULES, viewLedger, playGame, migrateLedger } from './shared/gameStreak.js';
import { apiRequest, getServerConfig, onUnauthorized } from './api.js';
import { logger } from './utils/logger.js';
import { toast } from './components/toast.js';

const LEGACY_STORAGE_KEYS = ['step_into_future_crm_v1', 'step_into_future_crm_v2', 'step_into_future_crm_v3', 'step_into_future_crm_v4', 'step_into_future_crm_v5', 'step_into_future_crm_v6'];

function readSession() {
  try {
    if (localStorage.getItem('crm_is_logged_in') !== 'true') return null;
    const role = localStorage.getItem('crm_current_role');
    if (!role) return null;
    const uid = role === 'admin' ? 'admin'
      : role === 'teacher' ? localStorage.getItem('crm_current_teacher_id')
      : localStorage.getItem('crm_current_student_id');
    return uid ? { role, uid } : null;
  } catch (e) {
    return null;
  }
}

function createEmptyState() {
  return {
    admin: { name: 'Администратор' },
    teachers: [],
    groups: [],
    students: [],
    schedule: [],
    pointRecords: [],
    purchases: [],
    shopItems: [],
    activityLogs: [],
    payments: {},
    textbookLessons: {},
    textbookVocabularyPool: {},
    textbooks: [],
    deletedStudents: [],
    deletedGroups: [],
    deletedTextbooks: [],
    vacationMode: false
  };
}

export function normalizePhone(rawPhone) {
  if (!rawPhone) return '';
  const digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) {
    return '+7' + digits.slice(1);
  }
  if (digits.length === 10) {
    return '+7' + digits;
  }
  return '+' + digits;
}

export function formatPhoneForDisplay(rawPhone) {
  const norm = normalizePhone(rawPhone);
  if (norm.length === 12 && norm.startsWith('+7')) {
    const d = norm.slice(2);
    return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
  }
  return rawPhone || '';
}

export const RUSSIAN_DAYS = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье'
];

export const RUSSIAN_DAYS_SHORT = [
  'Пн',
  'Вт',
  'Ср',
  'Чт',
  'Пт',
  'Сб',
  'Вс'
];


class Store {
  constructor() {
    this._gameOverlay = new Map();
    this.listeners = [];
    this._serverSynced = false;
    this._lastLocalSave = 0;
    this._lessonsModified = false;

    // Old versions kept the whole school database in the browser: remove those copies.
    LEGACY_STORAGE_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });

    this.state = createEmptyState();
    this.materialize(this.state);

    this.sync = new SyncEngine({
      getState: () => this.state,
      setState: (next) => {
        this.state = next;
        this._serverSynced = true;
      },
      materialize: (next) => this.materialize(next),
      beforeDiff: (st) => this.prepareForDiff(st),
      getSession: () => readSession(),
      onRejected: (results) => this.handleRejectedChanges(results),
      onChange: () => {
        this.notify();
        this.runStaffAutomation();
      }
    });

    onUnauthorized(() => {
      if (typeof window !== 'undefined' && window.__stepupAuth) window.__stepupAuth.forceLogout();
    });

    if (readSession()) this.startSync();
    this.initAutoSync();
  }

  /** Start syncing with the server for the logged-in user */
  startSync() {
    this.sync.start();
  }

  /** Stop syncing and wipe local data (logout) */
  stopSync() {
    this.sync.stop({ clearCache: true });
    this.state = createEmptyState();
    this.materialize(this.state);
    this._serverSynced = false;
    this.notify();
  }

  whenReady() {
    return this.sync.whenReady();
  }

  isReady() {
    return this.sync.ready;
  }

  /** Normalisations that used to run on load/sync. Idempotent. */
  materialize(result) {
    const empty = createEmptyState();
    for (const [k, v] of Object.entries(empty)) {
      if (Array.isArray(v) && !Array.isArray(result[k])) result[k] = [];
      else if (v && typeof v === 'object' && !Array.isArray(v) && (!result[k] || typeof result[k] !== 'object' || Array.isArray(result[k]))) result[k] = { ...v };
    }
    if (typeof result.vacationMode !== 'boolean') result.vacationMode = false;

    this.normalizeFilesTarget(result);
    this.normalizeShopAndStudentBalances(result);
    this.normalizeGroupConductedLessons(result);
    this.ensureVocabularyPoolSynced(result);
    this.applyMasteredWords(result);
    this.normalizeRecurringSchedule(result);
    this.recalculateBalances(result);
    return result;
  }

  /** Balances = sum of point records - active purchases (same formula as the server ledger) */
  recalculateBalances(target) {
    if (!Array.isArray(target.students) || !Array.isArray(target.pointRecords)) return;
    const pointSums = new Map();
    const lifetimeSums = new Map();
    target.pointRecords.forEach(r => {
      if (!r || !r.studentId) return;
      const pts = Number(r.points) || 0;
      pointSums.set(r.studentId, (pointSums.get(r.studentId) || 0) + pts);
      if (pts > 0 && !r.excludeFromRating) lifetimeSums.set(r.studentId, (lifetimeSums.get(r.studentId) || 0) + pts);
    });
    const spentSums = new Map();
    (target.purchases || []).forEach(p => {
      if (p && p.studentId && p.status !== 'cancelled') {
        spentSums.set(p.studentId, (spentSums.get(p.studentId) || 0) + (Number(p.itemPrice) || Number(p.price) || 0));
      }
    });
    target.students.forEach(s => {
      // Classmates seen by a student only carry public totals (their point records are not complete)
      if (!pointSums.has(s.id) && !spentSums.has(s.id) && typeof s.totalPoints === 'number') return;
      const net = Math.max(0, (pointSums.get(s.id) || 0) - (spentSums.get(s.id) || 0));
      s.totalPoints = net;
      s.lifetimePoints = Math.max(net, lifetimeSums.get(s.id) || 0);
    });
  }

  /** Persist "mastered" vocabulary flags compactly (the per-student pool itself is derived data) */
  prepareForDiff(target) {
    (target?.students || []).forEach(s => {
      if (!s || !s.vocabularyPool || typeof s.vocabularyPool !== 'object') return;
      const mastered = {};
      for (const [tb, words] of Object.entries(s.vocabularyPool)) {
        if (!Array.isArray(words)) continue;
        const list = [...new Set(words.filter(w => w && w.isMastered && w.word).map(w => String(w.word).toLowerCase().trim()))].sort();
        if (list.length) mastered[tb] = list;
      }
      const prev = s.masteredWords || {};
      if (JSON.stringify(prev) !== JSON.stringify(mastered)) {
        if (Object.keys(mastered).length || Object.keys(prev).length) s.masteredWords = mastered;
      }
    });
  }

  applyMasteredWords(target) {
    (target?.students || []).forEach(s => {
      if (!s || !s.masteredWords || !s.vocabularyPool) return;
      for (const [tb, words] of Object.entries(s.masteredWords)) {
        const pool = s.vocabularyPool[tb];
        if (!Array.isArray(pool) || !Array.isArray(words)) continue;
        const set = new Set(words);
        pool.forEach(w => { if (w && w.word) w.isMastered = set.has(String(w.word).toLowerCase().trim()); });
      }
    });
  }

  handleRejectedChanges(results) {
    const reasons = [...new Set((results || []).map(r => r.reason).filter(Boolean))];
    logger.warn('Server rejected changes: ' + reasons.join('; '));
    try {
      toast.warning('Часть изменений не сохранена: ' + (reasons.slice(0, 2).join('; ') || 'нет прав'));
    } catch (e) { /* ignore */ }
  }

  isStaffSession() {
    const s = readSession();
    return Boolean(s && (s.role === 'admin' || s.role === 'teacher'));
  }

  runStaffAutomation() {
    if (!this.isStaffSession() || this._automationRunning) return;
    this._automationRunning = true;
    try { this.autoCompletePastLessons(); } catch (e) { /* ignore */ }
    this._automationRunning = false;
  }

  /** Kept for compatibility: refresh data from the server */
  async syncWithServer() {
    return this.sync.pull({ full: true });
  }

  initAutoSync() {
    if (typeof window === 'undefined') return;
    window.addEventListener('focus', () => this.runStaffAutomation());
    setInterval(() => {
      if (!document.hidden) this.runStaffAutomation();
    }, 60000);
  }

  normalizeFilesTarget(obj) {
    if (!obj || !obj.textbookLessons) return;
    for (const tb of Object.values(obj.textbookLessons)) {
      if (!tb) continue;
      for (const m of Object.values(tb)) {
        if (!m) continue;
        for (const l of Object.values(m)) {
          if (!l || !Array.isArray(l.files)) continue;
          l.files.forEach(f => {
            if (!f.target) {
              const name = (f.name || '').toLowerCase();
              const isWord = name.endsWith('.docx') || name.endsWith('.doc') || name.endsWith('.docm') || name.endsWith('.dotx') || f.type === 'document';
              f.target = isWord ? 'teacher_admin' : 'student';
            }
          });
        }
      }
    }
  }

  normalizeShopAndStudentBalances(obj) {
    if (!obj) return;
    if (!obj.shopItems || !Array.isArray(obj.shopItems)) {
      obj.shopItems = [
        {
          id: 'item-stickers',
          name: 'Стикерпак «Step Up English»',
          description: 'Набор виниловых ярких наклеек для ноутбука, тетрадей и телефона',
          price: 120,
          category: 'staff',
          photoUrl: 'https://images.unsplash.com/photo-1572375992501-4b0892d50c69?w=400&auto=format&fit=crop&q=80',
          createdAt: '2026-09-01T10:00:00.000Z'
        },
        {
          id: 'item-notebook',
          name: 'Фирменный блокнот + ручка',
          description: 'Удобный блокнот в твердом переплете с логотипом школы для конспектов и словаря',
          price: 250,
          category: 'staff',
          photoUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&auto=format&fit=crop&q=80',
          createdAt: '2026-09-01T10:00:00.000Z'
        },
        {
          id: 'item-mug',
          name: 'Термокружка школы',
          description: 'Металлическая термокружка 450 мл, сохраняет тепло до 8 часов',
          price: 400,
          category: 'staff',
          photoUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400&auto=format&fit=crop&q=80',
          createdAt: '2026-09-01T10:00:00.000Z'
        },
        {
          id: 'item-lesson',
          name: 'Сертификат: Индивидуальный урок',
          description: '1 персональное занятие с преподавателем (разговорная практика или грамматика)',
          price: 600,
          category: 'staff',
          photoUrl: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400&auto=format&fit=crop&q=80',
          createdAt: '2026-09-01T10:00:00.000Z'
        },
        {
          id: 'item-hoodie',
          name: 'Фирменная толстовка (Hoodie)',
          description: 'Теплое качественное худи оверсайз с вышивкой Step Up English',
          price: 800,
          category: 'staff',
          photoUrl: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=400&auto=format&fit=crop&q=80',
          createdAt: '2026-09-01T10:00:00.000Z'
        }
      ];
    }
    if (!obj.purchases || !Array.isArray(obj.purchases)) {
      obj.purchases = [];
    }
    if (Array.isArray(obj.students)) {
      obj.students.forEach(s => {
        if (s.totalPoints === undefined || s.totalPoints === null) {
          s.totalPoints = 0;
        }
        if (s.lifetimePoints === undefined || s.lifetimePoints === null) {
          s.lifetimePoints = Math.max(0, s.totalPoints || 0);
        }
        if (!Array.isArray(s.unlockedAvatars)) {
          s.unlockedAvatars = s.avatarUrl ? [s.avatarUrl] : [];
        }
        if (!Array.isArray(s.unlockedFrames)) {
          s.unlockedFrames = ['frame-none'];
          if (s.avatarFrame && s.avatarFrame !== 'frame-none') {
            s.unlockedFrames.push(s.avatarFrame);
          }
        }
        if (!Array.isArray(s.unlockedTitles)) {
          s.unlockedTitles = s.studentTitle ? [s.studentTitle] : [];
        }
      });
    }
  }

  normalizeGroupConductedLessons(obj) {
    if (!obj || !Array.isArray(obj.groups)) return false;
    let changed = false;

    // September lessons 1..8
    const septemberKeys = ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8'];

    obj.groups.forEach(group => {
      if (!Array.isArray(group.conductedLessons)) {
        group.conductedLessons = [];
        changed = true;
      }

      // If group had early lessons conducted (e.g. 1-1, 1-2, 1-3) which were conducted in October:
      // ensure October lessons 2-1..2-N are marked as well
      const hadOnlyEarlyLessons = group.conductedLessons.length >= 1 && group.conductedLessons.every(k => k.startsWith('1-'));
      if (hadOnlyEarlyLessons && group.conductedLessons.length <= 4) {
        const count = group.conductedLessons.length;
        for (let l = 1; l <= count; l++) {
          const octKey = `2-${l}`;
          if (!group.conductedLessons.includes(octKey)) {
            group.conductedLessons.push(octKey);
            changed = true;
          }
        }
      }

      // Ensure all September lessons are marked as conducted for all groups
      septemberKeys.forEach(k => {
        if (!group.conductedLessons.includes(k)) {
          group.conductedLessons.push(k);
          changed = true;
        }
      });

      // Sort chronologically
      group.conductedLessons.sort((a, b) => {
        const [mA, lA] = a.split('-').map(Number);
        const [mB, lB] = b.split('-').map(Number);
        return (mA * 100 + lA) - (mB * 100 + lB);
      });
    });

    return changed;
  }

  saveState(immediate = false) {
    this._lastLocalSave = Date.now();
    this._lessonsModified = false;
    this.notify();
    this.sync.schedulePush(immediate);
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
        listener(this.state);
      } catch (err) {
        console.error('Error in store listener:', err);
      }
    }
  }

  logActivity({ type = 'system', title, details = '', authorName = null, authorRole = null }) {
    if (!this.state) this.state = {};
    if (!Array.isArray(this.state.activityLogs)) {
      this.state.activityLogs = [];
    }

    const currentTeacherId = (typeof localStorage !== 'undefined') ? localStorage.getItem('crm_current_teacher_id') : null;
    const teacher = currentTeacherId ? this.getTeacherById(currentTeacherId) : null;
    const currentRole = (typeof localStorage !== 'undefined') ? (localStorage.getItem('crm_current_role') || 'system') : 'system';

    let resolvedAuthor = authorName;
    let resolvedRole = authorRole || currentRole;

    if (!resolvedAuthor) {
      if (currentRole === 'teacher' && teacher) {
        resolvedAuthor = teacher.fullName;
      } else if (currentRole === 'admin') {
        resolvedAuthor = this.state.admin?.name || 'Администратор';
      } else {
        resolvedAuthor = 'Система';
      }
    }

    const entry = {
      id: 'act-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
      type, // 'lesson' | 'points' | 'auth' | 'student' | 'system'
      title: String(title || ''),
      details: String(details || ''),
      authorName: resolvedAuthor,
      authorRole: resolvedRole
    };

    this.state.activityLogs.unshift(entry);
    if (this.state.activityLogs.length > 300) {
      this.state.activityLogs = this.state.activityLogs.slice(0, 300);
    }

    logger.info(`[Activity:${type}] ${title}: ${details}`);
    return entry;
  }

  getActivityLogs(filter = {}) {
    let logs = this.state.activityLogs || [];
    if (filter.type && filter.type !== 'all') {
      logs = logs.filter(l => l.type === filter.type);
    }
    return logs;
  }

  /** Admin: replace all server data with a backup file (exportJSON / /api/admin export / old db.json) */
  async restoreBackup(backupState) {
    const res = await apiRequest('/api/admin', { body: { action: 'import', state: backupState }, timeoutMs: 0 });
    this.sync.stop({ clearCache: true });
    return res;
  }

  // --- Auth & Lookup Helpers ---
  getStudentPin(student) {
    if (!student) return '1234';
    if (student.pin && /^\d{4}$/.test(String(student.pin).trim())) {
      return String(student.pin).trim();
    }
    // Generate deterministic 4-digit PIN from student ID
    let hash = 5381;
    const seed = String(student.id || '') + String(student.phone || '') + 'ep-pin-salt';
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) + hash) + seed.charCodeAt(i);
      hash = hash & hash;
    }
    return String(Math.abs(hash) % 9000 + 1000);
  }

  setStudentPin(studentId, newPin) {
    const cleanPin = String(newPin || '').trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      return { success: false, message: 'PIN-код должен состоять ровно из 4 цифр' };
    }
    const student = this.getStudentById(studentId);
    if (!student) {
      return { success: false, message: 'Ученик не найден' };
    }
    this.updateStudent(studentId, { pin: cleanPin });
    return { success: true, pin: cleanPin };
  }

  findStudentByPhone(phoneQuery) {
    const targetNorm = normalizePhone(phoneQuery);
    if (!targetNorm || targetNorm.length < 5) return null;

    return (this.state.students || []).find(s => {
      if (s.status !== 'active') return false;
      const sPhone = normalizePhone(s.phone);
      const sParentPhone = normalizePhone(s.parentPhone);
      return sPhone === targetNorm || sParentPhone === targetNorm;
    }) || null;
  }

  findTeacherByPhone(phoneQuery) {
    const targetNorm = normalizePhone(phoneQuery);
    if (!targetNorm || targetNorm.length < 5) return null;

    return (this.state.teachers || []).find(t => {
      if (t.status !== 'active') return false;
      return normalizePhone(t.phone) === targetNorm;
    }) || null;
  }

  // --- File Upload Service ---
  /**
   * Upload a file to the school storage (Cloudflare R2 via /api/files).
   * Returns { id, name, type, target, url, download_url, size } — the format lessons have always used.
   */
  async uploadFileToServer(file, targetCategory = null, options = {}) {
    if (!file) return null;
    const cfg = await getServerConfig().catch(() => ({}));
    const maxMb = cfg.uploadMaxMb || 95;
    const name = file.name || 'file';
    if (file.size > maxMb * 1024 * 1024) {
      throw new Error(`Файл больше ${maxMb} МБ — сожмите его или разделите на части`);
    }
    if (name.toLowerCase().endsWith('.wma')) {
      toast.warning('Формат WMA не воспроизводится в браузерах. Файл будет доступен только для скачивания — лучше загрузите MP3.');
    }
    const lower = name.toLowerCase();
    const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
    const AUDIO = ['.mp3', '.wav', '.wma', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.weba', '.webm', '.opus'];
    const IMAGE = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
    const folder = options.folder || (AUDIO.includes(ext) ? 'audio' : (IMAGE.includes(ext) ? 'images' : 'materials'));
    const params = new URLSearchParams({ name, folder });
    if (targetCategory) params.set('target', targetCategory);

    const resp = await fetch('/api/files?' + params.toString(), {
      method: 'PUT',
      body: file,
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream' }
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !json.success) throw new Error(json.error || `Ошибка загрузки файла (${resp.status})`);
    return json.file;
  }

  // =========================================================================
  // Windows Explorer Hierarchy: Textbook -> 10 Months -> 8 Lessons -> Files
  // =========================================================================
  
  getTextbooks() {
    const deleted = new Set(this.state?.deletedTextbooks || []);
    const fromSeed = Object.keys(this.state?.textbookLessons || {}).filter(tb => !deleted.has(tb));
    const fromGroups = (this.state?.groups || []).map(g => g.textbook).filter(tb => tb && !deleted.has(tb));
    const fromStudents = (this.state?.students || []).map(s => s.textbook).filter(tb => tb && !deleted.has(tb));
    const combined = [...new Set([...fromSeed, ...fromGroups, ...fromStudents])];
    return combined.sort((a, b) => a.localeCompare(b, 'ru'));
  }

  addTextbook(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return false;
    if (!this.state.textbookLessons) this.state.textbookLessons = {};
    if (!this.state.textbookLessons[trimmed]) {
      this.state.textbookLessons[trimmed] = {};
    }
    if (Array.isArray(this.state.deletedTextbooks)) {
      this.state.deletedTextbooks = this.state.deletedTextbooks.filter(tb => tb !== trimmed);
    }
    this._lessonsModified = true;
    this.saveState();
    return true;
  }

  deleteTextbook(name) {
    if (!name) return false;
    // 1. Remove from textbookLessons
    if (this.state.textbookLessons && this.state.textbookLessons[name]) {
      delete this.state.textbookLessons[name];
    }
    // 2. Remove from any groups that used this textbook
    if (this.state.groups) {
      this.state.groups.forEach(g => {
        if (g.textbook === name) g.textbook = '';
      });
    }
    // 3. Remove from any students that had this textbook assigned
    if (this.state.students) {
      this.state.students.forEach(s => {
        if (s.textbook === name) s.textbook = '';
      });
    }
    // 4. Remove from textbookVocabularyPool
    if (this.state.textbookVocabularyPool && this.state.textbookVocabularyPool[name]) {
      delete this.state.textbookVocabularyPool[name];
    }
    // 5. Track in deletedTextbooks so syncWithServer & INITIAL_DATA won't resurrect it
    if (!Array.isArray(this.state.deletedTextbooks)) {
      this.state.deletedTextbooks = [];
    }
    if (!this.state.deletedTextbooks.includes(name)) {
      this.state.deletedTextbooks.push(name);
    }
    this._lessonsModified = true;
    this.saveState(true);
    return true;
  }

  getMonthsForTextbook(textbookName) {
    const tbData = (this.state.textbookLessons && this.state.textbookLessons[textbookName]) || {};
    
    return MONTH_NAMES.map(m => {
      const monthData = tbData[m.num] || {};
      let conductedCount = 0;
      let filesCount = 0;
      
      for (let i = 1; i <= 8; i++) {
        const lesson = monthData[i];
        if (lesson) {
          if (lesson.isConducted) conductedCount++;
          if (lesson.files) filesCount += lesson.files.length;
        }
      }

      return {
        ...m,
        conductedCount,
        totalLessons: 8,
        filesCount
      };
    });
  }

  getLessonsForMonth(textbookName, monthNumber) {
    const mNum = Number(monthNumber);
    const tbData = (this.state.textbookLessons && this.state.textbookLessons[textbookName]) || {};
    const monthData = tbData[mNum] || {};

    const lessons = [];
    for (let i = 1; i <= 8; i++) {
      const lessonData = monthData[i] || {
        topic: `Урок ${i}: Материалы темы месяца`,
        isConducted: false,
        homework: { text: "", deadline: "к следующему уроку" },
        vocabulary: [],
        files: []
      };

      lessons.push({
        lessonNumber: i,
        monthNumber: mNum,
        textbookName,
        topic: lessonData.topic,
        isConducted: lessonData.isConducted || false,
        homework: lessonData.homework || { text: "", deadline: "к следующему уроку" },
        vocabulary: lessonData.vocabulary || [],
        files: lessonData.files || []
      });
    }

    return lessons;
  }

  getLessonDetails(textbookName, monthNumber, lessonNumber) {
    const mNum = Number(monthNumber);
    const lNum = Number(lessonNumber);
    const tbData = (this.state.textbookLessons && this.state.textbookLessons[textbookName]) || {};
    const monthData = tbData[mNum] || {};

    const lessonData = monthData[lNum] || {
      topic: `Урок ${lNum}: Тема занятия`,
      isConducted: false,
      homework: { text: "", deadline: "к следующему уроку" },
      vocabulary: [],
      files: []
    };

    return {
      textbookName,
      monthNumber: mNum,
      lessonNumber: lNum,
      ...lessonData
    };
  }

  saveLessonDetails(textbookName, monthNumber, lessonNumber, data) {
    const mNum = Number(monthNumber);
    const lNum = Number(lessonNumber);

    if (!this.state.textbookLessons) this.state.textbookLessons = {};
    if (!this.state.textbookLessons[textbookName]) this.state.textbookLessons[textbookName] = {};
    if (!this.state.textbookLessons[textbookName][mNum]) this.state.textbookLessons[textbookName][mNum] = {};

    this.state.textbookLessons[textbookName][mNum][lNum] = {
      ...this.state.textbookLessons[textbookName][mNum][lNum],
      ...data,
      updatedAt: new Date().toISOString()
    };

    this._lessonsModified = true;
    this.saveState(true);
    return this.state.textbookLessons[textbookName][mNum][lNum];
  }

  conductLessonByHierarchy(textbookName, monthNumber, lessonNumber) {
    const details = this.getLessonDetails(textbookName, monthNumber, lessonNumber);
    details.isConducted = true;
    details.conductedAt = new Date().toISOString();
    this.saveLessonDetails(textbookName, monthNumber, lessonNumber, details);
    try {
      this.syncVocabularyPoolForLesson(textbookName, monthNumber, lessonNumber);
    } catch (err) {
      console.warn('⚠️ syncVocabularyPoolForLesson warning:', err);
    }
    return details;
  }

  getEffectiveHomeworkForLesson(textbookName, monthNumber, lessonNumber) {
    if (!textbookName || !monthNumber || !lessonNumber) return null;
    const currentLesson = this.getLessonDetails(textbookName, monthNumber, lessonNumber);
    const currentText = (currentLesson?.homework?.text || '').trim();

    if (currentText.length > 0) {
      return {
        text: currentLesson.homework.text,
        deadline: currentLesson.homework.deadline || 'к следующему уроку',
        isFromPrevious: false,
        sourceLesson: currentLesson
      };
    }

    // Homework in this lesson is empty! Find preceding lesson with homework.
    const tbData = (this.state.textbookLessons && this.state.textbookLessons[textbookName]) || {};
    const curM = Number(monthNumber);
    const curL = Number(lessonNumber);

    // Search backwards across months and lessons
    // 1st pass: prioritize conducted lessons with homework
    // 2nd pass: any preceding lesson with homework
    for (let pass = 1; pass <= 2; pass++) {
      for (let m = curM; m >= 1; m--) {
        const monthData = tbData[m];
        if (!monthData) continue;
        const maxL = (m === curM) ? (curL - 1) : 8;
        for (let l = maxL; l >= 1; l--) {
          const cand = monthData[l];
          if (!cand) continue;
          const candText = (cand.homework?.text || '').trim();
          if (candText.length > 0) {
            if (pass === 1 && !cand.isConducted) {
              continue; // Only take conducted lesson on 1st pass
            }
            return {
              text: cand.homework.text,
              deadline: (currentLesson?.homework?.deadline && currentLesson.homework.deadline !== 'к следующему уроку')
                ? currentLesson.homework.deadline
                : (cand.homework.deadline || 'к следующему уроку'),
              isFromPrevious: true,
              sourceLesson: {
                textbookName,
                monthNumber: m,
                monthName: MONTH_NAMES.find(mn => mn.num === m)?.name || `Месяц ${m}`,
                lessonNumber: l,
                ...cand
              }
            };
          }
        }
      }
    }

    return {
      text: '',
      deadline: currentLesson?.homework?.deadline || 'к следующему уроку',
      isFromPrevious: false,
      sourceLesson: currentLesson
    };
  }

  getLatestUnlockedLessonForTextbook(textbookName) {
    if (!textbookName) return null;
    const tbData = (this.state.textbookLessons && this.state.textbookLessons[textbookName]) || {};

    let latest = null;
    // Iterate through months 1..10, then lessons 1..8
    for (let m = 1; m <= 10; m++) {
      const monthData = tbData[m];
      if (monthData) {
        for (let l = 1; l <= 8; l++) {
          const lesson = monthData[l];
          if (lesson && lesson.isConducted) {
            latest = {
              textbookName,
              monthNumber: m,
              monthName: MONTH_NAMES.find(mn => mn.num === m)?.name || `Месяц ${m}`,
              lessonNumber: l,
              ...lesson
            };
          }
        }
      }
    }

    if (latest) {
      const effHw = this.getEffectiveHomeworkForLesson(textbookName, latest.monthNumber, latest.lessonNumber);
      latest.effectiveHomework = effHw;
      if (effHw && effHw.isFromPrevious && (!latest.homework?.text || !latest.homework.text.trim())) {
        latest.homework = {
          ...(latest.homework || {}),
          text: effHw.text,
          deadline: effHw.deadline,
          isFromPrevious: true,
          sourceLesson: effHw.sourceLesson
        };
      }
    }

    return latest;
  }

  getGroupConductedLessons(groupId) {
    if (!groupId) return [];
    const group = this.getGroupById(groupId);
    if (!group) return [];
    if (!Array.isArray(group.conductedLessons)) {
      group.conductedLessons = [];
    }
    return group.conductedLessons;
  }

  isLessonConductedForGroup(groupId, monthNumber, lessonNumber) {
    if (!groupId) return false;
    const group = this.getGroupById(groupId);
    if (!group) return false;
    const key = `${Number(monthNumber)}-${Number(lessonNumber)}`;
    if (Array.isArray(group.conductedLessons)) {
      return group.conductedLessons.includes(key);
    }
    return false;
  }

  setGroupLessonConducted(groupId, monthNumber, lessonNumber, isConducted) {
    if (!groupId) return false;
    const group = this.getGroupById(groupId);
    if (!group) return false;
    if (!Array.isArray(group.conductedLessons)) {
      group.conductedLessons = [];
    }
    const key = `${Number(monthNumber)}-${Number(lessonNumber)}`;
    if (isConducted) {
      if (!group.conductedLessons.includes(key)) {
        group.conductedLessons.push(key);
      }
      try {
        if (group.textbook) {
          this.syncVocabularyPoolForGroupLesson(groupId, group.textbook, monthNumber, lessonNumber);
        }
      } catch (err) {
        console.warn('⚠️ syncVocabularyPoolForGroupLesson warning:', err);
      }
    } else {
      group.conductedLessons = group.conductedLessons.filter(k => k !== key);
    }

    this.saveState(true);
    return true;
  }

  setGroupMonthConducted(groupId, monthNumber, isConducted = true) {
    if (!groupId) return false;
    const group = this.getGroupById(groupId);
    if (!group) return false;
    if (!Array.isArray(group.conductedLessons)) {
      group.conductedLessons = [];
    }
    const m = Number(monthNumber);
    for (let l = 1; l <= 8; l++) {
      const key = `${m}-${l}`;
      if (isConducted) {
        if (!group.conductedLessons.includes(key)) {
          group.conductedLessons.push(key);
        }
        if (group.textbook) {
          try {
            this.syncVocabularyPoolForGroupLesson(groupId, group.textbook, m, l);
          } catch (_) {}
        }
      } else {
        group.conductedLessons = group.conductedLessons.filter(k => k !== key);
      }
    }
    group.conductedLessons.sort((a, b) => {
      const [mA, lA] = a.split('-').map(Number);
      const [mB, lB] = b.split('-').map(Number);
      return (mA * 100 + lA) - (mB * 100 + lB);
    });
    this.saveState(true);
    return true;
  }

  syncVocabularyPoolForGroupLesson(groupId, textbookName, monthNumber, lessonNumber) {
    if (!groupId || !textbookName || !monthNumber || !lessonNumber) return;
    const details = this.getLessonDetails(textbookName, monthNumber, lessonNumber);
    if (!details || !Array.isArray(details.vocabulary) || details.vocabulary.length === 0) return;

    if (!this.state.textbookVocabularyPool) {
      this.state.textbookVocabularyPool = {};
    }
    if (!this.state.textbookVocabularyPool[textbookName]) {
      this.state.textbookVocabularyPool[textbookName] = [];
    }

    const conductedTime = new Date().toISOString();
    const nowIso = new Date().toISOString();

    // 1. Sync to global textbook vocabulary pool (for general word bank)
    details.vocabulary.forEach(v => {
      if (!v || !v.word || !v.word.trim()) return;
      const cleanWord = v.word.trim();
      const existing = this.state.textbookVocabularyPool[textbookName].find(
        item => item.word.toLowerCase().trim() === cleanWord.toLowerCase()
      );
      if (!existing) {
        this.state.textbookVocabularyPool[textbookName].push({
          id: `vocab-${textbookName}-${monthNumber}-${lessonNumber}-${cleanWord.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          word: cleanWord,
          transcription: (v.transcription || '').trim(),
          translation: (v.translation || '').trim(),
          example: (v.example || '').trim(),
          textbook: textbookName,
          monthNumber: Number(monthNumber),
          lessonNumber: Number(lessonNumber),
          conductedAt: conductedTime,
          dateAdded: conductedTime
        });
      }
    });

    // 2. Sync specifically to students of this group
    const groupStudents = (this.state.students || []).filter(s => s.groupId === groupId);

    groupStudents.forEach(student => {
      if (!student.vocabularyPool) student.vocabularyPool = {};
      if (!student.vocabularyPool[textbookName]) student.vocabularyPool[textbookName] = [];
      if (!student.textbooksStudied) student.textbooksStudied = [];
      if (!student.textbooksStudied.includes(textbookName)) {
        student.textbooksStudied.push(textbookName);
      }

      details.vocabulary.forEach(v => {
        if (!v || !v.word || !v.word.trim()) return;
        const cleanWord = v.word.trim();
        const wordExists = student.vocabularyPool[textbookName].some(
          item => item.word.toLowerCase().trim() === cleanWord.toLowerCase()
        );
        if (!wordExists) {
          student.vocabularyPool[textbookName].push({
            id: `vocab-${student.id}-${textbookName}-${monthNumber}-${lessonNumber}-${cleanWord.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
            word: cleanWord,
            transcription: (v.transcription || '').trim(),
            translation: (v.translation || '').trim(),
            example: (v.example || '').trim(),
            textbook: textbookName,
            monthNumber: Number(monthNumber),
            lessonNumber: Number(lessonNumber),
            conductedAt: conductedTime,
            dateAdded: nowIso,
            isMastered: false
          });
        }
      });
    });
  }

  getLatestUnlockedLessonForGroup(groupId) {
    if (!groupId) return null;
    const group = this.getGroupById(groupId);
    if (!group || !group.textbook) return null;
    const textbookName = group.textbook;

    const conductedKeys = Array.isArray(group.conductedLessons) ? group.conductedLessons : [];
    if (conductedKeys.length === 0) {
      return null;
    }

    const sorted = conductedKeys.map(k => {
      const [m, l] = k.split('-').map(Number);
      return { m, l, sortVal: (m || 0) * 100 + (l || 0) };
    }).sort((a, b) => a.sortVal - b.sortVal);

    const latestKey = sorted[sorted.length - 1];
    if (!latestKey) return null;

    const details = this.getLessonDetails(textbookName, latestKey.m, latestKey.l);
    const mObj = MONTH_NAMES.find(mn => mn.num === latestKey.m);
    const latest = {
      textbookName,
      monthNumber: latestKey.m,
      monthName: mObj?.name || `Месяц ${latestKey.m}`,
      lessonNumber: latestKey.l,
      ...details,
      isConducted: true
    };

    const effHw = this.getEffectiveHomeworkForLesson(textbookName, latest.monthNumber, latest.lessonNumber);
    latest.effectiveHomework = effHw;
    if (effHw && effHw.isFromPrevious && (!latest.homework?.text || !latest.homework.text.trim())) {
      latest.homework = {
        ...(latest.homework || {}),
        text: effHw.text,
        deadline: effHw.deadline,
        isFromPrevious: true,
        sourceLesson: effHw.sourceLesson
      };
    }
    return latest;
  }

  getLatestUnlockedLessonForStudent(studentId) {
    if (!studentId) return null;
    const student = this.getStudentById(studentId);
    if (!student) return null;

    if (student.groupId) {
      const grpLesson = this.getLatestUnlockedLessonForGroup(student.groupId);
      if (grpLesson) return grpLesson;
    }

    const textbookName = student.textbook || (student.groupId ? this.getGroupById(student.groupId)?.textbook : null);
    if (!textbookName) return null;
    return this.getLatestUnlockedLessonForTextbook(textbookName);
  }

  getConductedLessonsForStudent(studentId) {
    if (!studentId) return [];
    const student = this.getStudentById(studentId);
    if (!student) return [];
    const group = student.groupId ? this.getGroupById(student.groupId) : null;
    const textbookName = student.textbook || group?.textbook;
    if (!textbookName) return [];

    if (group && Array.isArray(group.conductedLessons) && group.conductedLessons.length > 0) {
      return group.conductedLessons.map(k => {
        const [m, l] = k.split('-').map(Number);
        const details = this.getLessonDetails(textbookName, m, l);
        return {
          id: `plan-${textbookName}-${m}-${l}`,
          textbook: textbookName,
          textbookName,
          monthNumber: m,
          lessonNumber: l,
          ...details,
          isConducted: true
        };
      }).sort((a, b) => (a.monthNumber * 100 + a.lessonNumber) - (b.monthNumber * 100 + b.lessonNumber));
    }

    // Fallback for students without group-specific conductedLessons
    const allLessonPlans = this.getLessonPlans({ textbook: textbookName });
    return allLessonPlans.filter(p => p.isConducted);
  }

  getLessonPlans(filter = {}) {
    const list = [];
    const tbData = this.state.textbookLessons || {};
    for (const [tbName, months] of Object.entries(tbData)) {
      if (filter.textbook && filter.textbook !== tbName) continue;
      for (const [mNum, lessons] of Object.entries(months || {})) {
        for (const [lNum, lData] of Object.entries(lessons || {})) {
          list.push({
            id: `plan-${tbName}-${mNum}-${lNum}`,
            textbook: tbName,
            textbookName: tbName,
            monthNumber: Number(mNum),
            lessonNumber: Number(lNum),
            ...lData
          });
        }
      }
    }
    return list;
  }

  getLessonPlanByScheduleId(scheduleId) {
    const lesson = this.getLessonById(scheduleId);
    if (!lesson) return null;
    const group = lesson.groupId ? this.getGroupById(lesson.groupId) : null;
    const student = lesson.studentId ? this.getStudentById(lesson.studentId) : null;
    const tbName = group?.textbook || student?.textbook;
    if (!tbName) return null;
    if (group) {
      const grpLesson = this.getLatestUnlockedLessonForGroup(group.id);
      if (grpLesson) return grpLesson;
    }
    if (student) {
      const stuLesson = this.getLatestUnlockedLessonForStudent(student.id);
      if (stuLesson) return stuLesson;
    }
    return this.getLatestUnlockedLessonForTextbook(tbName);
  }

  getLessonPlanById(planId) {
    if (!planId) return null;
    return this.getLessonPlans().find(p => p.id === planId) || null;
  }

  conductLesson(scheduleId) {
    return this.updateLessonStatus(scheduleId, 'completed');
  }

  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  }

  // =========================================================================
  // Dedicated Vocabulary Pool (Partitioned by Textbook & Preserved across Years)
  // =========================================================================

  /**
   * Synchronize words into the vocabulary pool when a lesson is conducted.
   * Words are partitioned by textbook and assigned to all students currently or
   * previously studying that textbook.
   */
  syncVocabularyPoolForLesson(textbookName, monthNumber, lessonNumber) {
    if (!textbookName || !monthNumber || !lessonNumber) return;
    const details = this.getLessonDetails(textbookName, monthNumber, lessonNumber);
    if (!details || !Array.isArray(details.vocabulary) || details.vocabulary.length === 0) return;

    if (!this.state.textbookVocabularyPool) {
      this.state.textbookVocabularyPool = {};
    }
    if (!this.state.textbookVocabularyPool[textbookName]) {
      this.state.textbookVocabularyPool[textbookName] = [];
    }

    const conductedTime = details.conductedAt || '2026-09-01T00:00:00.000Z';
    const nowIso = new Date().toISOString();

    // 1. Sync to global textbook vocabulary pool
    details.vocabulary.forEach(v => {
      if (!v || !v.word || !v.word.trim()) return;
      const cleanWord = v.word.trim();
      const existing = this.state.textbookVocabularyPool[textbookName].find(
        item => item.word.toLowerCase().trim() === cleanWord.toLowerCase()
      );
      if (!existing) {
        this.state.textbookVocabularyPool[textbookName].push({
          id: `vocab-${textbookName}-${monthNumber}-${lessonNumber}-${cleanWord.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          word: cleanWord,
          transcription: (v.transcription || '').trim(),
          translation: (v.translation || '').trim(),
          example: (v.example || '').trim(),
          textbook: textbookName,
          monthNumber: Number(monthNumber),
          lessonNumber: Number(lessonNumber),
          conductedAt: conductedTime,
          dateAdded: conductedTime
        });
      } else {
        if (!existing.transcription && v.transcription) existing.transcription = v.transcription.trim();
        if (!existing.translation && v.translation) existing.translation = v.translation.trim();
        if (!existing.example && v.example) existing.example = v.example.trim();
        if (!existing.monthNumber) existing.monthNumber = Number(monthNumber);
        if (!existing.lessonNumber) existing.lessonNumber = Number(lessonNumber);
      }
    });

    // 2. Sync to individual student vocabulary pools
    const matchingGroups = (this.state.groups || []).filter(g => g.textbook === textbookName).map(g => g.id);

    (this.state.students || []).forEach(student => {
      const studentTextbook = student.textbook || (student.groupId ? this.getGroupById(student.groupId)?.textbook : null);
      const isCurrentlyStudying = (studentTextbook === textbookName) || (student.groupId && matchingGroups.includes(student.groupId));
      const hasStudiedBefore = Array.isArray(student.textbooksStudied) && student.textbooksStudied.includes(textbookName);

      if (isCurrentlyStudying || hasStudiedBefore) {
        if (!student.vocabularyPool) student.vocabularyPool = {};
        if (!student.vocabularyPool[textbookName]) student.vocabularyPool[textbookName] = [];
        if (!student.textbooksStudied) student.textbooksStudied = [];
        if (!student.textbooksStudied.includes(textbookName)) {
          student.textbooksStudied.push(textbookName);
        }

        details.vocabulary.forEach(v => {
          if (!v || !v.word || !v.word.trim()) return;
          const cleanWord = v.word.trim();
          const wordExists = student.vocabularyPool[textbookName].some(
            item => item.word.toLowerCase().trim() === cleanWord.toLowerCase()
          );
          if (!wordExists) {
            student.vocabularyPool[textbookName].push({
              id: `vocab-${student.id}-${textbookName}-${monthNumber}-${lessonNumber}-${cleanWord.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
              word: cleanWord,
              transcription: (v.transcription || '').trim(),
              translation: (v.translation || '').trim(),
              example: (v.example || '').trim(),
              textbook: textbookName,
              monthNumber: Number(monthNumber),
              lessonNumber: Number(lessonNumber),
              conductedAt: conductedTime,
              dateAdded: nowIso,
              isMastered: false
            });
          }
        });
      }
    });

    this.saveState();
  }

  /**
   * Retroactive deep sync: ensures all conducted lessons across all textbooks are reflected in
   * the vocabulary pool and student pools. Safe to run multiple times (idempotent).
   */
  ensureVocabularyPoolSynced(targetState = this.state) {
    if (!targetState || !targetState.textbookLessons) return;
    if (!targetState.textbookVocabularyPool) targetState.textbookVocabularyPool = {};

    const deletedSet = new Set(targetState.deletedTextbooks || []);
    const fallbackDate = '2026-09-01T00:00:00.000Z';

    // 1. Scan all conducted lessons from textbookLessons
    for (const [tbName, months] of Object.entries(targetState.textbookLessons)) {
      if (!tbName || !months || deletedSet.has(tbName)) continue;
      if (!targetState.textbookVocabularyPool[tbName]) {
        targetState.textbookVocabularyPool[tbName] = [];
      }

      for (const [mNum, lessons] of Object.entries(months)) {
        if (!lessons) continue;
        for (const [lNum, lesson] of Object.entries(lessons)) {
          if (lesson && lesson.isConducted && Array.isArray(lesson.vocabulary) && lesson.vocabulary.length > 0) {
            lesson.vocabulary.forEach(v => {
              if (!v || !v.word || !v.word.trim()) return;
              const cleanWord = v.word.trim();
              const existing = targetState.textbookVocabularyPool[tbName].find(
                item => item.word.toLowerCase().trim() === cleanWord.toLowerCase()
              );
              if (!existing) {
                targetState.textbookVocabularyPool[tbName].push({
                  id: `vocab-${tbName}-${mNum}-${lNum}-${cleanWord.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
                  word: cleanWord,
                  transcription: (v.transcription || '').trim(),
                  translation: (v.translation || '').trim(),
                  example: (v.example || '').trim(),
                  textbook: tbName,
                  monthNumber: Number(mNum),
                  lessonNumber: Number(lNum),
                  conductedAt: lesson.conductedAt || fallbackDate,
                  dateAdded: lesson.conductedAt || fallbackDate
                });
              } else {
                if (!existing.transcription && v.transcription) existing.transcription = v.transcription.trim();
                if (!existing.translation && v.translation) existing.translation = v.translation.trim();
                if (!existing.example && v.example) existing.example = v.example.trim();
              }
            });
          }
        }
      }
    }

    // 2. Scan all students and assign vocabulary partitioned by textbooks they've studied
    if (Array.isArray(targetState.students)) {
      targetState.students.forEach(student => {
        if (!student.vocabularyPool) student.vocabularyPool = {};
        if (!student.textbooksStudied) student.textbooksStudied = [];

        // Determine current textbook
        let currentTb = student.textbook;
        if (!currentTb && student.groupId) {
          const g = (targetState.groups || []).find(gr => gr.id === student.groupId);
          if (g) currentTb = g.textbook;
        }

        if (currentTb && !student.textbooksStudied.includes(currentTb)) {
          student.textbooksStudied.push(currentTb);
        }

        // Include any textbook already in student's vocabularyPool
        Object.keys(student.vocabularyPool).forEach(tb => {
          if (!student.textbooksStudied.includes(tb)) {
            student.textbooksStudied.push(tb);
          }
        });

        // Ensure words from conducted lessons of these textbooks are in student's pool
        student.textbooksStudied.forEach(tbName => {
          if (!student.vocabularyPool[tbName]) student.vocabularyPool[tbName] = [];
          const tbWords = targetState.textbookVocabularyPool[tbName] || [];

          tbWords.forEach(w => {
            const exists = student.vocabularyPool[tbName].some(
              sw => sw.word.toLowerCase().trim() === w.word.toLowerCase().trim()
            );
            if (!exists) {
              student.vocabularyPool[tbName].push({
                ...w,
                id: `vocab-${student.id}-${w.id || w.word.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
                isMastered: false
              });
            }
          });
        });
      });
    }
  }

  /**
   * Get student's vocabulary pool, partitioned by textbooks studied.
   */
  getStudentVocabularyPool(studentId, textbookFilter = null) {
    this.ensureVocabularyPoolSynced();
    const student = this.getStudentById(studentId);
    if (!student) {
      return {
        student: null,
        textbooks: [],
        poolByTextbook: {},
        allWords: [],
        totalWordsCount: 0,
        masteredWordsCount: 0
      };
    }

    const poolByTextbook = {};
    const studiedList = student.textbooksStudied || [];
    const pool = student.vocabularyPool || {};

    // Collect all textbooks that have words or are in studiedList
    const allTextbookKeys = Array.from(new Set([
      ...studiedList,
      ...Object.keys(pool),
      ...(student.textbook ? [student.textbook] : [])
    ])).filter(Boolean);

    let allWords = [];
    let masteredCount = 0;

    allTextbookKeys.forEach(tb => {
      let words = pool[tb] || [];
      // Fallback: if student pool for this textbook was empty but textbook has words
      if (words.length === 0 && this.state.textbookVocabularyPool && this.state.textbookVocabularyPool[tb]) {
        words = this.state.textbookVocabularyPool[tb].map(w => ({
          ...w,
          id: `vocab-${student.id}-${w.id}`,
          isMastered: false
        }));
      }

      poolByTextbook[tb] = words;
      words.forEach(w => {
        allWords.push({ ...w, textbook: tb });
        if (w.isMastered) masteredCount++;
      });
    });

    const activeTextbooks = Object.keys(poolByTextbook);

    if (textbookFilter && textbookFilter !== 'all') {
      const filteredWords = poolByTextbook[textbookFilter] || [];
      return {
        student,
        currentTextbook: student.textbook || activeTextbooks[0] || '',
        textbooks: activeTextbooks,
        selectedTextbook: textbookFilter,
        words: filteredWords,
        poolByTextbook,
        allWords,
        totalWordsCount: filteredWords.length,
        masteredWordsCount: filteredWords.filter(w => w.isMastered).length
      };
    }

    return {
      student,
      currentTextbook: student.textbook || activeTextbooks[0] || '',
      textbooks: activeTextbooks,
      selectedTextbook: 'all',
      words: allWords,
      poolByTextbook,
      allWords,
      totalWordsCount: allWords.length,
      masteredWordsCount: masteredCount
    };
  }

  /**
   * Get all textbook vocabulary pools (for Teacher & Admin views)
   */
  getTextbookVocabularyPool(textbookFilter = null) {
    this.ensureVocabularyPoolSynced();
    const deletedSet = new Set(this.state?.deletedTextbooks || []);
    const pool = this.state.textbookVocabularyPool || {};
    const availableTextbooks = Object.keys(pool).filter(tb => !deletedSet.has(tb));

    // Also include any textbooks from textbookLessons that might not have words yet
    if (this.state.textbookLessons) {
      Object.keys(this.state.textbookLessons).forEach(tb => {
        if (!availableTextbooks.includes(tb) && !deletedSet.has(tb)) availableTextbooks.push(tb);
      });
    }

    let allWords = [];
    availableTextbooks.forEach(tb => {
      const words = pool[tb] || [];
      words.forEach(w => allWords.push({ ...w, textbook: tb }));
    });

    if (textbookFilter && textbookFilter !== 'all') {
      const words = pool[textbookFilter] || [];
      return {
        textbooks: availableTextbooks,
        selectedTextbook: textbookFilter,
        words,
        poolByTextbook: pool,
        allWords,
        totalWordsCount: words.length
      };
    }

    return {
      textbooks: availableTextbooks,
      selectedTextbook: 'all',
      words: allWords,
      poolByTextbook: pool,
      allWords,
      totalWordsCount: allWords.length
    };
  }

  /**
   * Toggle or set isMastered status for a student word
   */
  toggleWordMastered(studentId, textbookName, wordText, explicitValue = null) {
    const student = this.getStudentById(studentId);
    if (!student || !student.vocabularyPool || !student.vocabularyPool[textbookName]) return false;

    const wordItem = student.vocabularyPool[textbookName].find(
      w => w.word.toLowerCase().trim() === wordText.toLowerCase().trim()
    );
    if (!wordItem) return false;

    wordItem.isMastered = explicitValue !== null ? Boolean(explicitValue) : !wordItem.isMastered;
    this.saveState();
    return wordItem.isMastered;
  }

  /**
   * Add a custom word directly to a textbook pool and/or student pool
   */
  addCustomWordToPool(textbookName, wordData, studentId = null) {
    if (!textbookName || !wordData || !wordData.word) return null;

    const cleanWord = wordData.word.trim();
    const cleanTranscription = (wordData.transcription || '').trim();
    const cleanTranslation = (wordData.translation || '').trim();
    const cleanExample = (wordData.example || '').trim();
    const nowIso = new Date().toISOString();

    if (!this.state.textbookVocabularyPool) this.state.textbookVocabularyPool = {};
    if (!this.state.textbookVocabularyPool[textbookName]) this.state.textbookVocabularyPool[textbookName] = [];

    const newWordObj = {
      id: `vocab-${textbookName}-custom-${Date.now()}`,
      word: cleanWord,
      transcription: cleanTranscription,
      translation: cleanTranslation,
      example: cleanExample,
      textbook: textbookName,
      monthNumber: Number(wordData.monthNumber) || 1,
      lessonNumber: Number(wordData.lessonNumber) || 1,
      conductedAt: nowIso,
      dateAdded: nowIso
    };

    this.state.textbookVocabularyPool[textbookName].push(newWordObj);

    if (studentId) {
      const student = this.getStudentById(studentId);
      if (student) {
        if (!student.vocabularyPool) student.vocabularyPool = {};
        if (!student.vocabularyPool[textbookName]) student.vocabularyPool[textbookName] = [];
        student.vocabularyPool[textbookName].push({
          ...newWordObj,
          id: `vocab-${student.id}-custom-${Date.now()}`,
          isMastered: false
        });
      }
    } else {
      // Sync to all students studying this textbook
      (this.state.students || []).forEach(s => {
        const studTb = s.textbook || (s.groupId ? this.getGroupById(s.groupId)?.textbook : null);
        if (studTb === textbookName || (s.textbooksStudied && s.textbooksStudied.includes(textbookName))) {
          if (!s.vocabularyPool) s.vocabularyPool = {};
          if (!s.vocabularyPool[textbookName]) s.vocabularyPool[textbookName] = [];
          s.vocabularyPool[textbookName].push({
            ...newWordObj,
            id: `vocab-${s.id}-custom-${Date.now()}`,
            isMastered: false
          });
        }
      });
    }

    this._lessonsModified = true;
    this.saveState();
    return newWordObj;
  }

  getTotalVocabularyCountForStudent(studentId) {
    const data = this.getStudentVocabularyPool(studentId);
    return data.totalWordsCount || 0;
  }

  getTotalVocabularyCount() {
    const data = this.getTextbookVocabularyPool();
    return data.totalWordsCount || 0;
  }

  // --- Groups CRUD ---
  getGroups(filter = {}) {
    let list = [...(this.state.groups || [])];
    if (filter.status) {
      list = list.filter(g => g.status === filter.status);
    }
    if (filter.level && filter.level !== 'all') {
      list = list.filter(g => g.level === filter.level);
    }
    if (filter.shift && filter.shift !== 'all') {
      list = list.filter(g => g.shift === filter.shift);
    }
    if (filter.teacherId && filter.teacherId !== 'all') {
      list = list.filter(g => g.teacherId === filter.teacherId);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase().trim();
      list = list.filter(g =>
        g.name.toLowerCase().includes(q) ||
        (g.textbook && g.textbook.toLowerCase().includes(q)) ||
        (g.description && g.description.toLowerCase().includes(q))
      );
    }
    return list;
  }

  getGroupById(id) {
    return (this.state.groups || []).find(g => g.id === id) || null;
  }

  getStudentsByGroupId(groupId) {
    return this.state.students.filter(s => s.groupId === groupId && s.status === 'active');
  }

  addGroup(groupData) {
    const id = 'grp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const textbookName = groupData.textbook?.trim() || '';
    if (textbookName) {
      this.addTextbook(textbookName);
    }
    const newGroup = {
      id,
      name: groupData.name.trim(),
      level: groupData.level || 'Pre-Intermediate',
      textbook: textbookName,
      teacherId: groupData.teacherId || '',
      shift: groupData.shift || 'Первая',
      classroom: groupData.classroom?.trim() || 'Кабинет 1',
      description: groupData.description?.trim() || '',
      status: 'active',
      createdAt: new Date().toISOString()
    };
    if (!this.state.groups) this.state.groups = [];
    this.state.groups.push(newGroup);

    // Automatically generate full 80-lesson yearly schedule for this group based on its textbook
    if (textbookName) {
      this.generateYearlyScheduleForGroup({
        groupId: newGroup.id,
        time: groupData.scheduleTime || '16:00 - 17:00',
        format: newGroup.classroom || 'Кабинет 1'
      });
    }

    this.saveState();
    return newGroup;
  }

  updateGroup(id, groupData) {
    const index = this.state.groups.findIndex(g => g.id === id);
    if (index !== -1) {
      const oldTextbook = this.state.groups[index].textbook;
      const newTextbook = groupData.textbook !== undefined ? (groupData.textbook?.trim() || '') : oldTextbook;

      if (newTextbook) {
        this.addTextbook(newTextbook);
      }

      this.state.groups[index] = {
        ...this.state.groups[index],
        ...groupData,
        textbook: newTextbook
      };

      // If textbook changed, update all enrolled students and group schedule topics
      if (newTextbook && newTextbook !== oldTextbook) {
        if (this.state.students) {
          this.state.students.forEach(s => {
            if (s.groupId === id) {
              s.textbook = newTextbook;
              if (!s.textbooksStudied) s.textbooksStudied = [];
              if (oldTextbook && !s.textbooksStudied.includes(oldTextbook)) {
                s.textbooksStudied.push(oldTextbook);
              }
              if (!s.textbooksStudied.includes(newTextbook)) {
                s.textbooksStudied.push(newTextbook);
              }
              if (!s.vocabularyPool) s.vocabularyPool = {};
              if (!s.vocabularyPool[newTextbook]) s.vocabularyPool[newTextbook] = [];
            }
          });
        }
        if (this.state.schedule) {
          this.state.schedule.forEach(sch => {
            if (sch.groupId === id) {
              const mNum = sch.monthNumber || 1;
              const lNum = sch.lessonNumber || sch.lessonNumberInMonth || 1;
              const hierDetails = this.getLessonDetails(newTextbook, mNum, lNum);
              if (hierDetails && hierDetails.topic) {
                sch.topic = hierDetails.topic;
              }
            }
          });
        }
      }

      this.saveState();
      return this.state.groups[index];
    }
    return null;
  }

  deleteGroup(id) {
    this.state.groups = this.state.groups.filter(g => g.id !== id);
    this.state.students.forEach(s => {
      if (s.groupId === id) s.groupId = null;
    });
    this.state.schedule = this.state.schedule.filter(sch => sch.groupId !== id);
    this.state.deletedGroups = this.state.deletedGroups || [];
    if (!this.state.deletedGroups.includes(id)) {
      this.state.deletedGroups.push(id);
    }
    this.saveState(true);
  }

  // --- Students CRUD ---
  getStudents(filter = {}) {
    let result = [...this.state.students];
    if (filter.status) {
      result = result.filter(s => s.status === filter.status);
    }
    if (filter.groupId && filter.groupId !== 'all') {
      if (filter.groupId === 'none') {
        result = result.filter(s => !s.groupId);
      } else {
        result = result.filter(s => s.groupId === filter.groupId);
      }
    }
    if (filter.level && filter.level !== 'all') {
      result = result.filter(s => s.level === filter.level);
    }
    if (filter.shift && filter.shift !== 'all') {
      result = result.filter(s => s.shift === filter.shift);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase().trim();
      result = result.filter(s =>
        s.fullName.toLowerCase().includes(q) ||
        (s.school && s.school.toLowerCase().includes(q)) ||
        (s.phone && s.phone.includes(q)) ||
        (s.parentName && s.parentName.toLowerCase().includes(q)) ||
        (s.textbook && s.textbook.toLowerCase().includes(q))
      );
    }
    return result;
  }

  getStudentById(id) {
    return this.state.students.find(s => s.id === id) || null;
  }

  addStudent(studentData) {
    const id = 'stu-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    let level = studentData.level || 'Beginner';
    let textbook = studentData.textbook?.trim() || '';

    if (studentData.groupId) {
      const group = this.getGroupById(studentData.groupId);
      if (group) {
        if (!studentData.level) level = group.level;
        if (!textbook) textbook = group.textbook;
      }
    }

    const formattedPhone = formatPhoneForDisplay(studentData.phone);
    const formattedParentPhone = formatPhoneForDisplay(studentData.parentPhone);

    const newStudent = {
      id,
      groupId: studentData.groupId || null,
      fullName: studentData.fullName.trim(),
      phone: formattedPhone,
      parentName: studentData.parentName?.trim() || '',
      parentPhone: formattedParentPhone,
      grade: studentData.grade?.trim() || '',
      school: studentData.school?.trim() || '',
      shift: studentData.shift || 'Первая',
      level: level,
      textbook: textbook,
      totalPoints: Number(studentData.totalPoints) || 0,
      createdAt: new Date().toISOString(),
      status: 'active',
      notes: studentData.notes?.trim() || '',
      avatarUrl: studentData.avatarUrl || null,
      avatarFrame: studentData.avatarFrame || 'frame-none',
      studentTitle: studentData.studentTitle || ''
    };
    this.state.students.unshift(newStudent);
    this.saveState();
    return newStudent;
  }

  addStudentsBatch(studentsList = []) {
    if (!Array.isArray(studentsList) || studentsList.length === 0) return [];
    const addedStudents = [];
    const nowIso = new Date().toISOString();

    for (let i = 0; i < studentsList.length; i++) {
      const item = studentsList[i];
      if (!item || !item.fullName || !item.fullName.trim()) continue;

      const id = 'stu-' + Date.now() + '-' + i + '-' + Math.random().toString(36).slice(2, 6);
      let level = item.level || 'Beginner';
      let textbook = item.textbook?.trim() || '';

      if (item.groupId) {
        const group = this.getGroupById(item.groupId);
        if (group) {
          if (!item.level) level = group.level;
          if (!textbook) textbook = group.textbook;
        }
      }

      const formattedPhone = formatPhoneForDisplay(item.phone);
      const formattedParentPhone = formatPhoneForDisplay(item.parentPhone);

      const newStudent = {
        id,
        groupId: item.groupId || null,
        fullName: item.fullName.trim(),
        phone: formattedPhone,
        parentName: item.parentName?.trim() || '',
        parentPhone: formattedParentPhone,
        grade: item.grade?.trim() || '',
        school: item.school?.trim() || '',
        shift: item.shift || 'Первая',
        level: level,
        textbook: textbook,
        totalPoints: Number(item.totalPoints) || 0,
        lifetimePoints: Number(item.totalPoints) || 0,
        createdAt: nowIso,
        status: 'active',
        notes: item.notes?.trim() || '',
        avatarUrl: item.avatarUrl || '🦁',
        avatarFrame: item.avatarFrame || 'frame-none',
        studentTitle: item.studentTitle || '',
        gameStats: {
          weekly: { weekKey: `${new Date().getFullYear()}-W${Math.ceil((new Date().getDate() + new Date(new Date().getFullYear(), 0, 1).getDay()) / 7)}`, points: 0 },
          unlockedTenseLevels: ['easy'],
          unlockedSecretTitles: [],
          irregularRecentIds: []
        }
      };

      this.state.students.unshift(newStudent);
      addedStudents.push(newStudent);
    }

    this.saveState();
    return addedStudents;
  }

  updateStudentCustomization(id, customizationData = {}) {
    const student = this.getStudentById(id);
    if (!student) return null;
    const patch = {};
    if (customizationData.avatarUrl !== undefined) patch.avatarUrl = customizationData.avatarUrl;
    if (customizationData.avatarFrame !== undefined) patch.avatarFrame = customizationData.avatarFrame;
    if (customizationData.studentTitle !== undefined) patch.studentTitle = customizationData.studentTitle;
    return this.updateStudent(id, patch);
  }

  updateStudent(id, studentData) {
    const index = this.state.students.findIndex(s => s.id === id);
    if (index !== -1) {
      const oldStudent = this.state.students[index];
      const oldTextbook = oldStudent.textbook;
      const newTextbook = studentData.textbook !== undefined ? (studentData.textbook?.trim() || '') : oldTextbook;

      const updated = {
        ...oldStudent,
        ...studentData
      };
      if (studentData.phone) updated.phone = formatPhoneForDisplay(studentData.phone);
      if (studentData.parentPhone) updated.parentPhone = formatPhoneForDisplay(studentData.parentPhone);

      // Preserve multi-year textbook history
      if (!updated.textbooksStudied) updated.textbooksStudied = [...(oldStudent.textbooksStudied || [])];
      if (oldTextbook && !updated.textbooksStudied.includes(oldTextbook)) {
        updated.textbooksStudied.push(oldTextbook);
      }
      if (newTextbook && !updated.textbooksStudied.includes(newTextbook)) {
        updated.textbooksStudied.push(newTextbook);
      }
      if (!updated.vocabularyPool) updated.vocabularyPool = { ...(oldStudent.vocabularyPool || {}) };
      if (oldTextbook && !updated.vocabularyPool[oldTextbook] && oldStudent.vocabularyPool?.[oldTextbook]) {
        updated.vocabularyPool[oldTextbook] = oldStudent.vocabularyPool[oldTextbook];
      }
      if (newTextbook && !updated.vocabularyPool[newTextbook]) {
        updated.vocabularyPool[newTextbook] = [];
      }

      this.state.students[index] = updated;
      this.saveState();
      if (newTextbook && newTextbook !== oldTextbook) {
        this.ensureVocabularyPoolSynced();
      }
      return this.state.students[index];
    }
    return null;
  }

  deleteStudent(id) {
    if (!Array.isArray(this.state.deletedStudents)) {
      this.state.deletedStudents = [];
    }
    if (!this.state.deletedStudents.includes(id)) {
      this.state.deletedStudents.push(id);
    }
    this.state.students = (this.state.students || []).filter(s => s.id !== id);
    this.state.schedule = (this.state.schedule || []).filter(sch => sch.studentId !== id);
    this.state.pointRecords = (this.state.pointRecords || []).filter(pt => pt.studentId !== id);
    this.saveState(true);
  }

  // --- Teachers CRUD ---
  getTeachers(filter = {}) {
    let result = [...this.state.teachers];
    if (filter.status) {
      result = result.filter(t => t.status === filter.status);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase().trim();
      result = result.filter(t =>
        t.fullName.toLowerCase().includes(q) ||
        (t.specialization && t.specialization.toLowerCase().includes(q)) ||
        (t.email && t.email.toLowerCase().includes(q)) ||
        (t.phone && t.phone.includes(q))
      );
    }
    return result;
  }

  getTeacherById(id) {
    return this.state.teachers.find(t => t.id === id) || null;
  }

  addTeacher(teacherData) {
    const id = 'tch-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const colors = ['#4f46e5', '#0d9488', '#d97706', '#8b5cf6', '#0284c7', '#e11d48'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const autoLogin = (teacherData.login?.trim()) || ('teacher' + Math.floor(100 + Math.random() * 900));
    const autoPassword = (teacherData.password?.trim()) || '123';

    const newTeacher = {
      id,
      login: autoLogin,
      password: autoPassword,
      fullName: teacherData.fullName.trim(),
      phone: formatPhoneForDisplay(teacherData.phone),
      email: teacherData.email?.trim() || '',
      specialization: teacherData.specialization?.trim() || 'General English',
      status: teacherData.status || 'active',
      avatarColor: teacherData.avatarColor || randomColor
    };
    this.state.teachers.push(newTeacher);
    this.saveState();
    return newTeacher;
  }

  updateTeacher(id, teacherData) {
    const index = this.state.teachers.findIndex(t => t.id === id);
    if (index !== -1) {
      this.state.teachers[index] = {
        ...this.state.teachers[index],
        ...teacherData
      };
      if (teacherData.phone) this.state.teachers[index].phone = formatPhoneForDisplay(teacherData.phone);
      this.saveState();
      return this.state.teachers[index];
    }
    return null;
  }

  deleteTeacher(id) {
    this.state.teachers = this.state.teachers.filter(t => t.id !== id);
    this.saveState(true);
  }

  // --- Schedule CRUD ---

  /**
   * Helper: Parse lesson date & time into a Date object for automatic completion checks
   */
  parseLessonDateTime(lesson, baseYear = 2026) {
    if (!lesson || !lesson.date) return null;
    let dStr = String(lesson.date).trim();
    let year = baseYear;
    let month = 1;
    let day = 1;

    if (dStr.includes('-')) {
      const parts = dStr.split('-').map(Number);
      if (parts.length >= 3) {
        year = parts[0];
        month = parts[1];
        day = parts[2];
      }
    } else if (dStr.includes('.')) {
      const parts = dStr.split('.').map(Number);
      day = parts[0];
      month = parts[1];
      if (parts.length >= 3) {
        year = parts[2];
      } else {
        if (lesson.monthNumber) {
          year = lesson.monthNumber >= 5 ? (baseYear + 1) : baseYear;
        } else {
          year = month >= 8 ? baseYear : (baseYear + 1);
        }
      }
    } else {
      return null;
    }

    let hours = 23;
    let minutes = 59;
    if (lesson.time && typeof lesson.time === 'string') {
      const timeMatches = lesson.time.match(/(\d{1,2}):(\d{2})/g);
      if (timeMatches && timeMatches.length > 0) {
        const targetTimeStr = timeMatches[timeMatches.length - 1];
        const [h, m] = targetTimeStr.split(':').map(Number);
        hours = h;
        minutes = m;
      }
    }

    return new Date(year, month - 1, day, hours, minutes, 0);
  }

  /**
   * Helper: compute and synchronize the real schedule days and times for a group
   */
  getGroupScheduleSummary(groupId) {
    if (!groupId) return { days: '—', time: '—', full: '—' };
    const group = this.getGroupById(groupId);
    const schedule = this.getSchedule({ groupId });

    if (!schedule || schedule.length === 0) {
      const days = group?.scheduleDays || '—';
      const time = group?.scheduleTime || '—';
      return { days, time, full: `${days} ${time}`.trim() };
    }

    const daysOrder = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    const daysShortMap = {
      'Понедельник': 'Пн', 'Вторник': 'Вт', 'Среда': 'Ср', 'Четверг': 'Чт',
      'Пятница': 'Пт', 'Суббота': 'Сб', 'Воскресенье': 'Вс'
    };

    const uniqueDays = [...new Set(schedule.map(s => s.dayOfWeek).filter(Boolean))].sort((a, b) => {
      return daysOrder.indexOf(a) - daysOrder.indexOf(b);
    });

    const uniqueTimes = [...new Set(schedule.map(s => s.time).filter(Boolean))];

    const daysShort = uniqueDays.map(d => daysShortMap[d] || d).join(', ');
    const timeStr = uniqueTimes.join(', ') || group?.scheduleTime || '—';

    // Auto-sync to group object if changed
    if (group && (group.scheduleDays !== daysShort || group.scheduleTime !== timeStr)) {
      group.scheduleDays = daysShort;
      group.scheduleTime = timeStr;
    }

    return {
      days: daysShort || group?.scheduleDays || '—',
      time: timeStr,
      full: daysShort ? `${daysShort} ${timeStr}` : timeStr
    };
  }

  /**
   * Automatic Completion: Lessons whose scheduled date/time has passed
   * automatically become 'completed', while preserving explicit 'cancelled' status.
   * Supports both recurring weekly schedule instances and single dated lessons.
   */
  autoCompletePastLessons(now = new Date()) {
    if (!this._serverSynced) return 0;
    if (this.isVacation()) return 0;
    if (!this.state || !Array.isArray(this.state.schedule)) return 0;
    let updatedCount = 0;

    const nowDay = now.getDay();
    const todayDayIndex = nowDay === 0 ? 7 : nowDay;
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const todayDateStr = `${yyyy}-${mm}-${dd}`;
    const todayShortStr = `${dd}.${mm}`;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    this.state.schedule.forEach(lesson => {
      // 1. RECURRING WEEKLY LESSONS
      if (lesson.isRecurring) {
        // Check if lesson takes place today
        const isToday = lesson.dayIndex === todayDayIndex ||
          (lesson.dayOfWeek && lesson.dayOfWeek.toLowerCase() === RUSSIAN_DAYS[todayDayIndex - 1]?.toLowerCase());
        if (!isToday) return;

        // Check if already completed, cancelled, deleted, or manually kept planned for today
        const exc = lesson.exceptions && (lesson.exceptions[todayDateStr] || lesson.exceptions[todayShortStr]);
        if (exc && (exc.deleted || exc.status === 'cancelled' || exc.status === 'completed' || exc.status === 'planned' || exc.manualPlanned)) {
          return;
        }

        // Parse lesson end time
        const timeStr = exc?.time || lesson.time || '10:00 - 11:00';
        let endMinutes = null;
        if (timeStr.includes('-')) {
          const parts = timeStr.split('-').map(s => s.trim());
          if (parts[1]) {
            const [eH, eM] = parts[1].split(':').map(Number);
            if (!isNaN(eH) && !isNaN(eM)) {
              endMinutes = eH * 60 + eM;
            }
          }
        }
        if (endMinutes === null && lesson.startTime) {
          const [sH, sM] = lesson.startTime.split(':').map(Number);
          const dur = Number(lesson.duration) || 60;
          if (!isNaN(sH) && !isNaN(sM)) {
            endMinutes = sH * 60 + sM + dur;
          }
        }

        // If lesson has ended today, auto-complete its instance for today
        if (endMinutes !== null && currentMinutes >= endMinutes) {
          if (!lesson.exceptions) lesson.exceptions = {};
          lesson.exceptions[todayDateStr] = {
            ...(lesson.exceptions[todayDateStr] || {}),
            status: 'completed',
            completedAt: now.toISOString()
          };
          lesson.exceptions[todayShortStr] = {
            ...(lesson.exceptions[todayShortStr] || {}),
            status: 'completed',
            completedAt: now.toISOString()
          };
          updatedCount++;

          if (lesson.groupId) {
            try {
              this._handleLessonCompletion(lesson, todayDateStr);
            } catch (err) {
              console.warn('⚠️ _handleLessonCompletion error on auto-complete:', err);
            }
          }
        }
        return;
      }

      // 2. SINGLE DATED LESSONS
      if (lesson.status === 'planned' && !lesson.manualPlanned) {
        const lessonD = this.parseLessonDateTime(lesson);
        if (lessonD && lessonD < now) {
          lesson.status = 'completed';
          updatedCount++;

          if (lesson.groupId) {
            try {
              this._handleLessonCompletion(lesson, lesson.date || todayDateStr);
            } catch (err) {
              console.warn('⚠️ _handleLessonCompletion error on auto-complete:', err);
            }
          }
        }
      }
    });

    if (updatedCount > 0) {
      const currentRole = (typeof localStorage !== 'undefined' ? localStorage.getItem('crm_current_role') : null);
      if (currentRole === 'admin' || currentRole === 'teacher') {
        this.saveState(true);
      }
    }
    return updatedCount;
  }

  // =========================================================================
  // Vacation Mode & Modern Recurring Weekly Schedule Engine
  // =========================================================================

  isVacation() {
    return !!this.state.vacationMode;
  }

  setVacationMode(enabled) {
    this.state.vacationMode = !!enabled;
    this.saveState();
    this.notify();
    return this.state.vacationMode;
  }

  toggleVacation() {
    return this.setVacationMode(!this.state.vacationMode);
  }

  pickColorForGroup(groupId) {
    const palette = [
      '#bbf7d0', // pastel green
      '#fecdd3', // pastel pink
      '#bae6fd', // pastel sky blue
      '#e9d5ff', // pastel purple
      '#fed7aa', // pastel peach
      '#fef08a', // pastel yellow
      '#a7f3d0', // pastel mint
      '#c7d2fe'  // pastel indigo
    ];
    if (!groupId) return palette[0];
    let hash = 0;
    for (let i = 0; i < groupId.length; i++) {
      hash = (hash * 31 + groupId.charCodeAt(i)) & 0xffff;
    }
    return palette[Math.abs(hash) % palette.length];
  }

  normalizeRecurringSchedule(targetState) {
    if (typeof targetState.vacationMode !== 'boolean') {
      targetState.vacationMode = false;
    }
    if (!Array.isArray(targetState.schedule)) {
      targetState.schedule = [];
      return;
    }

    const hasRecurring = targetState.schedule.some(s => s && s.isRecurring);
    if (!hasRecurring && targetState.schedule.length > 0) {
      // Migrate old 80-lesson matrix entries to clean weekly recurring templates
      const recurringRules = [];
      const groups = targetState.groups || [];

      groups.forEach(g => {
        const groupSched = targetState.schedule.filter(s => s.groupId === g.id);
        if (!groupSched.length) return;

        const slotsMap = new Map();
        groupSched.forEach(s => {
          const rawDay = (s.dayOfWeek || 'Понедельник').trim();
          const rawTime = (s.time || '10:00 - 11:00').trim();
          const key = `${rawDay}_${rawTime}`;
          if (!slotsMap.has(key)) {
            slotsMap.set(key, {
              dayOfWeek: rawDay,
              time: rawTime,
              completedDates: []
            });
          }
          if (s.status === 'completed' && s.date) {
            slotsMap.get(key).completedDates.push(s.date);
          }
        });

        slotsMap.forEach(slot => {
          const dayName = slot.dayOfWeek;
          const dayIdx = RUSSIAN_DAYS.indexOf(dayName) !== -1 ? (RUSSIAN_DAYS.indexOf(dayName) + 1) : 1;
          const timeParts = slot.time.split('-').map(t => t.trim());
          const startTime = timeParts[0] || '10:00';
          const endTime = timeParts[1] || '11:00';

          const exceptions = {};
          slot.completedDates.forEach(d => {
            exceptions[d] = { status: 'completed' };
          });

          recurringRules.push({
            id: `rec-${g.id}-${dayIdx}-${startTime.replace(/[^0-9]/g, '')}`,
            targetType: 'group',
            groupId: g.id,
            studentId: null,
            teacherId: g.teacherId || (targetState.teachers[0]?.id || 'tch-1789335916072'),
            dayOfWeek: dayName,
            dayIndex: dayIdx,
            startTime,
            endTime,
            time: slot.time,
            duration: 90,
            topic: `Урок группы ${g.name}`,
            format: g.classroom || 'Очно (Кабинет 1)',
            status: 'planned',
            isRecurring: true,
            color: this.pickColorForGroup(g.id),
            exceptions
          });
        });
      });

      if (recurringRules.length > 0) {
        targetState.schedule = recurringRules;
      }
    }

    targetState.schedule.forEach(l => {
      if (l.isRecurring) {
        if (!l.dayIndex && l.dayOfWeek) {
          const idx = RUSSIAN_DAYS.indexOf(l.dayOfWeek);
          l.dayIndex = idx !== -1 ? idx + 1 : 1;
        }
        if (!l.color && l.groupId) {
          l.color = this.pickColorForGroup(l.groupId);
        }
        if (!l.exceptions) {
          l.exceptions = {};
        } else {
          // Clean legacy September test exceptions so groups never show 12 phantom completed lessons
          Object.keys(l.exceptions).forEach(k => {
            if (k.endsWith('.09') || k.startsWith('2026-09') || k === '01.10' || k === '02.10' || k === '11.01') {
              delete l.exceptions[k];
            }
          });
        }
        if (l.status !== 'planned') {
          l.status = 'planned';
        }
      }
    });
  }

  getSchedule(filter = {}) {
    if (this._serverSynced) {
      this.autoCompletePastLessons();
    }
    let result = [...(this.state.schedule || [])];

    if (filter.teacherId && filter.teacherId !== 'all') {
      result = result.filter(s => s.teacherId === filter.teacherId);
    }

    if (filter.groupId && filter.groupId !== 'all') {
      result = result.filter(s => s.groupId === filter.groupId);
    }

    if (filter.studentId) {
      const student = this.getStudentById(filter.studentId);
      const studentGroupId = student ? student.groupId : null;
      result = result.filter(s =>
        s.studentId === filter.studentId ||
        (studentGroupId && s.groupId === studentGroupId)
      );
    }

    if (filter.status && filter.status !== 'all') {
      result = result.filter(s => s.status === filter.status);
    }

    if (filter.dayOfWeek && filter.dayOfWeek !== 'all') {
      result = result.filter(s => s.dayOfWeek === filter.dayOfWeek);
    }

    return result;
  }

  getLessonById(id) {
    if (!id) return null;
    return (this.state.schedule || []).find(s => s.id === id || s.baseId === id || String(s.id) === String(id) || String(s.baseId) === String(id)) || null;
  }

  getWeekSchedule(mondayDate, filter = {}) {
    const monday = new Date(mondayDate);
    monday.setHours(0, 0, 0, 0);

    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const shortStr = `${dd}.${mm}`;
      const dayIndex = i + 1;

      weekDays.push({
        dayIndex,
        dayName: RUSSIAN_DAYS[i],
        dayShort: RUSSIAN_DAYS_SHORT[i],
        dateStr,
        shortStr,
        dateObj: d,
        isSunday: dayIndex === 7,
        dayNumber: d.getDate()
      });
    }

    const isVacation = this.isVacation();
    const allLessons = this.getSchedule(filter);
    const resolvedLessons = [];

    allLessons.forEach(l => {
      if (l.isRecurring) {
        const targetDay = weekDays.find(w => w.dayIndex === l.dayIndex || (l.dayOfWeek && w.dayName.toLowerCase() === l.dayOfWeek.toLowerCase()));
        if (!targetDay) return;

        const exc = l.exceptions && (l.exceptions[targetDay.dateStr] || l.exceptions[targetDay.shortStr]);
        if (exc && exc.deleted) return;

        const status = exc?.status || 'planned';
        const time = exc?.time || l.time || '10:00 - 11:00';
        const startTime = exc?.startTime || l.startTime || time.split('-')[0].trim();
        const duration = Number(exc?.duration || l.duration || 60);
        const group = l.groupId ? this.getGroupById(l.groupId) : null;
        const teacher = l.teacherId ? this.getTeacherById(l.teacherId) : null;

        resolvedLessons.push({
          ...l,
          id: l.id,
          baseId: l.id,
          date: targetDay.dateStr,
          dateFormatted: targetDay.shortStr,
          dayIndex: targetDay.dayIndex,
          dayOfWeek: targetDay.dayName,
          dayShort: targetDay.dayShort,
          dayNumber: targetDay.dayNumber,
          time,
          startTime,
          duration,
          status: isVacation ? 'vacation' : status,
          actualStatus: status,
          isVacationPaused: isVacation,
          group,
          teacher,
          groupName: group ? group.name : (l.topic || 'Группа'),
          color: l.color || this.pickColorForGroup(l.groupId),
          isRecurringInstance: true
        });
      } else {
        const targetDay = weekDays.find(w => w.dateStr === l.date || w.shortStr === l.date);
        if (!targetDay) return;

        const status = l.status || 'planned';
        const group = l.groupId ? this.getGroupById(l.groupId) : null;
        const teacher = l.teacherId ? this.getTeacherById(l.teacherId) : null;

        resolvedLessons.push({
          ...l,
          baseId: l.id,
          date: targetDay.dateStr,
          dateFormatted: targetDay.shortStr,
          dayIndex: targetDay.dayIndex,
          dayOfWeek: targetDay.dayName,
          dayShort: targetDay.dayShort,
          dayNumber: targetDay.dayNumber,
          status: isVacation ? 'vacation' : status,
          actualStatus: status,
          isVacationPaused: isVacation,
          group,
          teacher,
          groupName: group ? group.name : (l.topic || 'Урок'),
          color: l.color || this.pickColorForGroup(l.groupId),
          isRecurringInstance: false
        });
      }
    });

    return {
      weekDays,
      monday,
      sunday: weekDays[6].dateObj,
      isVacation,
      lessons: resolvedLessons
    };
  }

  addLesson(lessonData) {
    const id = 'rec-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    const isGroup = lessonData.targetType === 'group' || !!lessonData.groupId;
    const isRecurring = lessonData.isRecurring !== false;

    let dayName = lessonData.dayOfWeek || 'Понедельник';
    let dayIdx = RUSSIAN_DAYS.indexOf(dayName) !== -1 ? (RUSSIAN_DAYS.indexOf(dayName) + 1) : (lessonData.dayIndex || 1);

    if (lessonData.date && (!lessonData.dayOfWeek || lessonData.dayOfWeek === 'auto')) {
      const d = new Date(lessonData.date);
      if (!isNaN(d.getTime())) {
        const dDay = d.getDay();
        dayIdx = dDay === 0 ? 7 : dDay;
        dayName = RUSSIAN_DAYS[dayIdx - 1];
      }
    }

    const duration = Number(lessonData.duration) || 60;
    let startTime = lessonData.startTime || '10:00';
    if (!startTime && lessonData.time) {
      startTime = lessonData.time.split('-')[0].trim();
    }
    const [sH, sM] = startTime.split(':').map(n => parseInt(n, 10) || 0);
    const totalEndM = sH * 60 + sM + duration;
    const endH = Math.floor(totalEndM / 60) % 24;
    const endM = totalEndM % 60;
    const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    const timeStr = `${startTime} - ${endTime}`;

    const group = lessonData.groupId ? this.getGroupById(lessonData.groupId) : null;
    const teacherId = lessonData.teacherId || group?.teacherId || this.state.teachers[0]?.id || null;

    const newLesson = {
      id,
      targetType: isGroup ? 'group' : 'individual',
      groupId: lessonData.groupId || null,
      studentId: isGroup ? null : (lessonData.studentId || null),
      teacherId,
      dayOfWeek: dayName,
      dayIndex: dayIdx,
      startTime,
      endTime,
      time: timeStr,
      duration,
      date: lessonData.date || new Date().toISOString().split('T')[0],
      topic: lessonData.topic?.trim() || (group ? `Урок группы ${group.name}` : 'English Lesson'),
      status: lessonData.status || 'planned',
      format: lessonData.format || (group?.classroom || 'Очно (Кабинет 1)'),
      isRecurring,
      color: lessonData.color || this.pickColorForGroup(lessonData.groupId),
      exceptions: {}
    };

    this.state.schedule.push(newLesson);
    this.saveState(true);
    return newLesson;
  }

  updateLesson(id, lessonData, updateScope = 'recurring', targetDate = null) {
    let index = this.state.schedule.findIndex(s => s.id === id || String(s.id) === String(id));
    if (index === -1 && id) {
      index = this.state.schedule.findIndex(s => s.baseId === id || String(s.baseId) === String(id));
    }
    if (index === -1) return null;

    const lesson = this.state.schedule[index];
    const oldStatus = lesson.status;

    if (lesson.isRecurring && updateScope === 'single') {
      const effectiveDate = targetDate || lesson.date || new Date().toISOString().slice(0, 10);
      if (!lesson.exceptions) lesson.exceptions = {};
      const prevExc = lesson.exceptions[effectiveDate] || {};
      const wasCompleted = prevExc.status === 'completed' || (oldStatus === 'completed' && !prevExc.status);

      const newExcData = { ...lessonData };
      if (lessonData.status === 'planned') {
        newExcData.manualPlanned = true;
        delete newExcData.completedAt;
      } else if (lessonData.status === 'completed') {
        delete newExcData.manualPlanned;
      }

      lesson.exceptions[effectiveDate] = {
        ...(lesson.exceptions[effectiveDate] || {}),
        ...newExcData
      };
      if (lessonData.status === 'planned') {
        delete lesson.exceptions[effectiveDate].completedAt;
      }

      if (typeof effectiveDate === 'string' && effectiveDate.includes('-')) {
        const parts = effectiveDate.split('-');
        if (parts.length === 3) {
          const shortStr = `${parts[2]}.${parts[1]}`;
          lesson.exceptions[shortStr] = {
            ...(lesson.exceptions[shortStr] || {}),
            ...newExcData
          };
          if (lessonData.status === 'planned') {
            delete lesson.exceptions[shortStr].completedAt;
          }
        }
      }

      if (lessonData.status === 'completed' && !wasCompleted) {
        try {
          this._handleLessonCompletion(lesson, effectiveDate);
        } catch (err) {
          console.warn('⚠️ _handleLessonCompletion warning:', err);
        }
        const group = lesson.groupId ? this.getGroupById(lesson.groupId) : null;
        this.logActivity({
          type: 'lesson',
          title: 'Урок проведен',
          details: `Урок группы «${group?.name || lesson.topic || 'Урок'}» (${effectiveDate}) отмечен как проведенный`
        });
      } else if ((lessonData.status === 'planned' || lessonData.status === 'cancelled') && wasCompleted) {
        try {
          this._rollbackLessonCompletion(lesson, effectiveDate);
        } catch (err) {
          console.warn('⚠️ _rollbackLessonCompletion warning:', err);
        }
        const group = lesson.groupId ? this.getGroupById(lesson.groupId) : null;
        this.logActivity({
          type: 'lesson',
          title: lessonData.status === 'planned' ? 'Урок возвращен в запланированные' : 'Урок отменен',
          details: `Статус урока группы «${group?.name || lesson.topic || 'Урок'}» (${effectiveDate}) изменен на ${lessonData.status === 'planned' ? '«Запланирован»' : '«Отменен»'}`
        });
      }

      this.saveState(true);
      return { ...lesson, ...lesson.exceptions[effectiveDate], date: effectiveDate };
    }

    if (lessonData.date && !lessonData.dayOfWeek) {
      const d = new Date(lessonData.date);
      if (!isNaN(d.getTime())) {
        const dDay = d.getDay();
        const dIdx = dDay === 0 ? 7 : dDay;
        lessonData.dayIndex = dIdx;
        lessonData.dayOfWeek = RUSSIAN_DAYS[dIdx - 1];
      }
    } else if (lessonData.dayOfWeek && !lessonData.dayIndex) {
      const idx = RUSSIAN_DAYS.indexOf(lessonData.dayOfWeek);
      if (idx !== -1) lessonData.dayIndex = idx + 1;
    }

    if (lessonData.duration) {
      lessonData.duration = Number(lessonData.duration);
    }

    if (lessonData.startTime) {
      const dur = lessonData.duration || lesson.duration || 60;
      const [sH, sM] = lessonData.startTime.split(':').map(n => parseInt(n, 10) || 0);
      const totalEndM = sH * 60 + sM + dur;
      const endH = Math.floor(totalEndM / 60) % 24;
      const endM = totalEndM % 60;
      lessonData.endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
      lessonData.time = `${lessonData.startTime} - ${lessonData.endTime}`;
    }

    if (lesson.isRecurring && lessonData.status === 'completed' && updateScope !== 'single') {
      delete lessonData.status;
    }

    if (lesson.isRecurring && lessonData.status === 'planned') {
      const effectiveDate = targetDate || lesson.date;
      if (effectiveDate && lesson.exceptions) {
        const prevExc = lesson.exceptions[effectiveDate];
        if (prevExc) {
          const wasCompleted = prevExc.status === 'completed';
          lesson.exceptions[effectiveDate] = {
            ...lesson.exceptions[effectiveDate],
            status: 'planned',
            manualPlanned: true
          };
          delete lesson.exceptions[effectiveDate].completedAt;
          if (wasCompleted) {
            this._rollbackLessonCompletion(lesson, effectiveDate);
          }
        }
        if (typeof effectiveDate === 'string' && effectiveDate.includes('-')) {
          const parts = effectiveDate.split('-');
          if (parts.length === 3) {
            const shortStr = `${parts[2]}.${parts[1]}`;
            if (lesson.exceptions[shortStr]) {
              lesson.exceptions[shortStr] = {
                ...lesson.exceptions[shortStr],
                status: 'planned',
                manualPlanned: true
              };
              delete lesson.exceptions[shortStr].completedAt;
            }
          }
        }
      }
    }

    if (!lesson.isRecurring) {
      if (lessonData.status === 'planned') {
        lessonData.manualPlanned = true;
        delete lessonData.completedAt;
      } else if (lessonData.status === 'completed') {
        delete lessonData.manualPlanned;
      }
    }

    this.state.schedule[index] = {
      ...this.state.schedule[index],
      ...lessonData
    };

    if (lessonData.status === 'completed' && oldStatus !== 'completed') {
      this._handleLessonCompletion(this.state.schedule[index], targetDate || lesson.date);
      const group = this.state.schedule[index].groupId ? this.getGroupById(this.state.schedule[index].groupId) : null;
      this.logActivity({
        type: 'lesson',
        title: 'Урок проведен',
        details: `Урок «${group?.name || this.state.schedule[index].topic || 'Урок'}» (${targetDate || lesson.date || ''}) отмечен как проведенный`
      });
    } else if ((lessonData.status === 'planned' || lessonData.status === 'cancelled') && oldStatus === 'completed' && !lesson.isRecurring) {
      this._rollbackLessonCompletion(this.state.schedule[index], targetDate || lesson.date);
      const group = this.state.schedule[index].groupId ? this.getGroupById(this.state.schedule[index].groupId) : null;
      this.logActivity({
        type: 'lesson',
        title: lessonData.status === 'planned' ? 'Урок возвращен в запланированные' : 'Урок отменен',
        details: `Статус урока «${group?.name || this.state.schedule[index].topic || 'Урок'}» (${targetDate || lesson.date || ''}) изменен на ${lessonData.status === 'planned' ? '«Запланирован»' : '«Отменен»'}`
      });
    }

    this.saveState(true);
    return this.state.schedule[index];
  }

  updateLessonStatus(id, newStatus, targetDate = null, updateScope = 'single') {
    return this.updateLesson(id, { status: newStatus }, updateScope, targetDate);
  }

  deleteLesson(id, deleteScope = 'recurring', targetDate = null) {
    if (!Array.isArray(this.state.schedule)) return;
    let index = this.state.schedule.findIndex(s => s.id === id || String(s.id) === String(id));
    if (index === -1 && id) {
      index = this.state.schedule.findIndex(s => s.baseId === id || String(s.baseId) === String(id));
    }
    if (index === -1) {
      console.warn('deleteLesson: lesson not found by id', id);
      return;
    }

    const lesson = this.state.schedule[index];
    const isRecurring = Boolean(lesson.isRecurring || lesson.id?.startsWith('rec-'));

    if (isRecurring && deleteScope === 'single' && targetDate) {
      if (!lesson.exceptions) lesson.exceptions = {};
      lesson.exceptions[targetDate] = { deleted: true };
      if (typeof targetDate === 'string') {
        if (targetDate.includes('-')) {
          const parts = targetDate.split('-');
          if (parts.length === 3) {
            lesson.exceptions[`${parts[2]}.${parts[1]}`] = { deleted: true };
          }
        } else if (targetDate.includes('.')) {
          const parts = targetDate.split('.');
          if (parts.length >= 2) {
            const year = parts[2] || new Date().getFullYear();
            lesson.exceptions[`${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`] = { deleted: true };
          }
        }
      }
      this.saveState(true);
      return;
    }

    this.state.schedule.splice(index, 1);
    this.saveState(true);
  }

  _handleLessonCompletion(lesson, dateStr) {
    const group = lesson.groupId ? this.getGroupById(lesson.groupId) : null;
    const student = lesson.studentId ? this.getStudentById(lesson.studentId) : null;
    const tbName = group?.textbook || student?.textbook;
    if (!tbName) return;

    try {
      if (group) {
        // Advance lesson specifically for this group
        if (!Array.isArray(group.conductedLessons)) {
          group.conductedLessons = [];
        }
        let conducted = false;
        for (let m = 1; m <= 10; m++) {
          for (let l = 1; l <= 8; l++) {
            const key = `${m}-${l}`;
            if (!group.conductedLessons.includes(key)) {
              this.setGroupLessonConducted(group.id, m, l, true);
              conducted = true;
              break;
            }
          }
          if (conducted) break;
        }
      } else {
        // Fallback for non-group individual lessons
        const months = this.getMonthsForTextbook(tbName);
        for (const m of months) {
          const lessons = this.getLessonsForMonth(tbName, m.num);
          const nextL = lessons.find(l => !l.isConducted);
          if (nextL) {
            this.conductLessonByHierarchy(tbName, m.num, nextL.lessonNumber);
            break;
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ Error in _handleLessonCompletion for', tbName, err);
    }
  }

  _rollbackLessonCompletion(lesson, dateStr) {
    const group = lesson.groupId ? this.getGroupById(lesson.groupId) : null;
    if (!group || !Array.isArray(group.conductedLessons) || group.conductedLessons.length === 0) return;
    try {
      // Find and remove the latest conducted lesson key for this group
      for (let m = 10; m >= 1; m--) {
        for (let l = 8; l >= 1; l--) {
          const key = `${m}-${l}`;
          if (group.conductedLessons.includes(key)) {
            this.setGroupLessonConducted(group.id, m, l, false);
            return;
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ Error in _rollbackLessonCompletion:', err);
    }
  }

  // =========================================================================
  // Yearly Schedule Matrix & Generator (10 Months x 8 Lessons = 80 Dates)
  // =========================================================================

  calculateDefaultYearlyDates(param1 = 'пн-чт', param2 = 2026, param3 = '11.01') {
    let startDate = '07.09';
    let dayPair = 'пн-чт';
    let customWeekdays = null;
    let holidayStart = '25.12';
    let holidayEnd = '10.01';
    let baseYear = 2026;

    if (typeof param1 === 'object' && param1 !== null) {
      startDate = param1.startDate || '07.09';
      dayPair = param1.dayPair || 'пн-чт';
      customWeekdays = param1.customWeekdays || null;
      holidayStart = param1.holidayStart || '25.12';
      holidayEnd = param1.holidayEnd || (param1.januaryResumeDate ? param1.januaryResumeDate : '10.01');
      if (param1.januaryResumeDate && !param1.holidayEnd) {
        holidayEnd = '10.01';
      }
      baseYear = param1.baseYear || 2026;
    } else {
      dayPair = param1 || 'пн-чт';
      baseYear = param2 || 2026;
      if (param3) {
        if (typeof param3 === 'string' && param3.includes('-')) {
          const parts = param3.split('-');
          holidayStart = parts[0];
          holidayEnd = parts[1];
        } else {
          holidayEnd = '10.01';
        }
      }
    }

    // Parse start date
    let startD = new Date(baseYear, 8, 7); // Default 07.09
    if (typeof startDate === 'string') {
      if (startDate.includes('-')) {
        const p = startDate.split('-').map(Number);
        startD = new Date(p[0], p[1] - 1, p[2]);
      } else if (startDate.includes('.')) {
        const p = startDate.split('.').map(Number);
        const y = p.length > 2 ? p[2] : baseYear;
        startD = new Date(y, p[1] - 1, p[0]);
      }
    }

    // Parse holiday interval
    let holStartD = new Date(baseYear, 11, 25); // Default 25.12
    if (typeof holidayStart === 'string' && holidayStart.includes('.')) {
      const p = holidayStart.split('.').map(Number);
      const y = p.length > 2 ? p[2] : baseYear;
      holStartD = new Date(y, p[1] - 1, p[0]);
    }

    let holEndD = new Date(baseYear + 1, 0, 10); // Default 10.01
    if (typeof holidayEnd === 'string' && holidayEnd.includes('.')) {
      const p = holidayEnd.split('.').map(Number);
      const y = p.length > 2 ? p[2] : (baseYear + 1);
      holEndD = new Date(y, p[1] - 1, p[0]);
    }

    // Target weekdays (Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6)
    const pairMap = {
      'пн-чт': [1, 4],
      'вт-пт': [2, 5],
      'ср-пт': [3, 5],
      'ср-сб': [3, 6],
      'пн-ср': [1, 3],
      'вт-чт': [2, 4],
      'сб-вс': [6, 0],
      'пн-ср-пт': [1, 3, 5]
    };

    let targetWeekdays = [1, 4];
    if (customWeekdays && Array.isArray(customWeekdays) && customWeekdays.length > 0) {
      targetWeekdays = customWeekdays;
    } else if (typeof dayPair === 'string') {
      const cleaned = dayPair.toLowerCase().replace(/\s+/g, '');
      targetWeekdays = pairMap[cleaned] || [1, 4];
    }

    const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    const shortDayNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

    const monthNamesList = [
      '', '01. Сентябрь', '02. Октябрь', '03. Ноябрь', '04. Декабрь',
      '05. Январь', '06. Февраль', '07. Март', '08. Апрель', '09. Май', '10. Июнь'
    ];

    let curr = new Date(startD);
    while (!targetWeekdays.includes(curr.getDay())) {
      curr.setDate(curr.getDate() + 1);
    }

    const matrix = [];

    for (let m = 1; m <= 10; m++) {
      const monthLessons = [];

      // If month 5 (Jan) and curr <= holEndD, jump past holiday
      if (m === 5 && curr <= holEndD) {
        curr = new Date(holEndD);
        curr.setDate(curr.getDate() + 1);
        while (!targetWeekdays.includes(curr.getDay())) {
          curr.setDate(curr.getDate() + 1);
        }
      }

      for (let l = 1; l <= 8; l++) {
        // Check if inside holiday
        if (curr >= holStartD && curr <= holEndD) {
          curr = new Date(holEndD);
          curr.setDate(curr.getDate() + 1);
          while (!targetWeekdays.includes(curr.getDay())) {
            curr.setDate(curr.getDate() + 1);
          }
        }

        const y = curr.getFullYear();
        const mm = String(curr.getMonth() + 1).padStart(2, '0');
        const dd = String(curr.getDate()).padStart(2, '0');
        const isoDate = `${y}-${mm}-${dd}`;
        const shortDisplay = `${dd}.${mm}`;
        const dayOfWeek = dayNames[curr.getDay()];
        const shortDay = shortDayNames[curr.getDay()];

        monthLessons.push({
          monthNumber: m,
          monthIndex: m,
          lessonNumber: l,
          lessonNumberInMonth: l,
          date: shortDisplay,
          isoDate,
          shortDisplay,
          displayDate: shortDisplay,
          dayOfWeek,
          dayOfWeekShort: shortDay,
          shortDay
        });

        // Advance to next target weekday
        curr.setDate(curr.getDate() + 1);
        while (!targetWeekdays.includes(curr.getDay())) {
          curr.setDate(curr.getDate() + 1);
        }
      }

      matrix.push({
        monthNumber: m,
        monthIndex: m,
        monthName: monthNamesList[m] || `Месяц ${m}`,
        lessons: monthLessons,
        dates: monthLessons
      });
    }

    return matrix;
  }

  generateYearlyScheduleForGroup({
    groupId,
    teacherId = null,
    time = '16:00 - 17:00',
    format = 'Очно (Кабинет 2)',
    startDate = '07.09',
    dayPair = 'пн-чт',
    customWeekdays = null,
    holidayStart = '25.12',
    holidayEnd = '10.01',
    baseYear = 2026,
    januaryResumeDate = '11.01',
    customDatesMatrix = null,
    replaceExisting = true
  }) {
    if (!groupId) return null;
    const group = this.getGroupById(groupId);
    if (!group) return null;

    const teacher = teacherId ? this.getTeacherById(teacherId) : this.getTeacherById(group.teacherId);
    const assignedTeacherId = teacher ? teacher.id : (group.teacherId || (this.state.teachers[0]?.id || ''));
    const textbookName = group.textbook || (this.getTextbooks()[0] || 'English world 1');

    if (replaceExisting) {
      // Remove previous group lessons so clean 80 lessons are installed
      this.state.schedule = this.state.schedule.filter(s => s.groupId !== groupId);
    }

    const matrix = customDatesMatrix || this.calculateDefaultYearlyDates({
      startDate,
      dayPair,
      customWeekdays,
      holidayStart,
      holidayEnd: holidayEnd || (januaryResumeDate === '11.01' ? '10.01' : holidayEnd),
      baseYear
    });

    const createdLessons = [];

    matrix.forEach(mObj => {
      const mNum = mObj.monthNumber || mObj.monthIndex || 1;
      const lessonList = mObj.lessons || mObj.dates || [];

      lessonList.forEach(lObj => {
        const lNum = lObj.lessonNumber || lObj.lessonNumberInMonth || 1;
        const hierDetails = this.getLessonDetails(textbookName, mNum, lNum);
        const topic = hierDetails.topic || `Урок ${lNum}: Материалы ${mNum} месяца`;

        const id = 'sch-' + groupId + '-m' + mNum + '-l' + lNum + '-' + Date.now().toString(36);
        const newLesson = {
          id,
          targetType: 'group',
          groupId,
          studentId: null,
          teacherId: assignedTeacherId,
          monthNumber: mNum,
          lessonNumber: lNum,
          lessonNumberInMonth: lNum,
          dayOfWeek: lObj.dayOfWeek || 'Понедельник',
          dayOfWeekShort: lObj.dayOfWeekShort || lObj.shortDay || 'пн',
          time: lObj.time || time,
          date: lObj.date || lObj.shortDisplay || '01.09',
          topic,
          status: (mNum === 1 && lNum <= 4) ? 'completed' : 'planned',
          format
        };

        this.state.schedule.push(newLesson);
        createdLessons.push(newLesson);
      });
    });

    group.scheduleDays = dayPair;
    group.scheduleTime = time;
    if (teacher) group.teacherId = teacher.id;
    if (format) group.classroom = format;

    this.saveState();
    return createdLessons;
  }

  copyScheduleToGroup({
    sourceGroupId,
    targetGroupId,
    newTime = '18:00 - 19:00',
    newTeacherId = null,
    newFormat = null,
    replaceExisting = true
  }) {
    if (!sourceGroupId || !targetGroupId) return null;
    const sourceGroup = this.getGroupById(sourceGroupId);
    const targetGroup = this.getGroupById(targetGroupId);
    if (!sourceGroup || !targetGroup) return null;

    let sourceSchedule = this.getSchedule({ groupId: sourceGroupId });
    if (!sourceSchedule.length) {
      // If source group doesn't have schedule yet, generate one for it first
      sourceSchedule = this.generateYearlyScheduleForGroup({
        groupId: sourceGroupId,
        time: sourceGroup.scheduleTime || '16:00 - 17:00',
        format: sourceGroup.classroom || 'Кабинет 2'
      });
    }

    const targetTeacherId = newTeacherId || targetGroup.teacherId || sourceGroup.teacherId;
    const targetFormat = newFormat || targetGroup.classroom || 'Кабинет 2';
    const targetTextbook = targetGroup.textbook || sourceGroup.textbook;

    if (replaceExisting) {
      this.state.schedule = this.state.schedule.filter(s => s.groupId !== targetGroupId);
    }

    const createdLessons = [];
    sourceSchedule.forEach(sLesson => {
      const mNum = sLesson.monthNumber || 1;
      const lNum = sLesson.lessonNumber || sLesson.lessonNumberInMonth || 1;
      const hierDetails = this.getLessonDetails(targetTextbook, mNum, lNum);
      const topic = hierDetails.topic || sLesson.topic;

      const id = 'sch-' + targetGroupId + '-m' + mNum + '-l' + lNum + '-' + Date.now().toString(36);
      const newLesson = {
        id,
        targetType: 'group',
        groupId: targetGroupId,
        studentId: null,
        teacherId: targetTeacherId,
        monthNumber: mNum,
        lessonNumber: lNum,
        lessonNumberInMonth: lNum,
        dayOfWeek: sLesson.dayOfWeek,
        dayOfWeekShort: sLesson.dayOfWeekShort || sLesson.dayOfWeek?.slice(0, 2).toLowerCase() || 'пн',
        time: newTime || sLesson.time,
        date: sLesson.date,
        topic,
        status: 'planned',
        format: targetFormat
      };

      this.state.schedule.push(newLesson);
      createdLessons.push(newLesson);
    });

    targetGroup.scheduleDays = sourceGroup.scheduleDays || 'пн - чт';
    targetGroup.scheduleTime = newTime || sourceGroup.scheduleTime;
    if (newTeacherId) targetGroup.teacherId = newTeacherId;
    if (newFormat) targetGroup.classroom = newFormat;

    this.saveState();
    return createdLessons;
  }

  getYearlyScheduleMatrix(groupId) {
    if (!groupId) return [];
    const group = this.getGroupById(groupId);
    if (!group) return [];

    let groupLessons = this.getSchedule({ groupId });
    if (!groupLessons.length) {
      // Auto-populate 80 lessons if group is newly created
      groupLessons = this.generateYearlyScheduleForGroup({
        groupId,
        time: group.scheduleTime || '16:00 - 17:00',
        format: group.classroom || 'Кабинет 2'
      }) || [];
    }

    const textbookName = group.textbook || (this.getTextbooks()[0] || 'English world 1');

    return MONTH_NAMES.map(m => {
      const monthNumber = m.num;
      const monthScheduleLessons = groupLessons.filter(s => s.monthNumber === monthNumber);

      const lessons = [];
      for (let l = 1; l <= 8; l++) {
        const existing = monthScheduleLessons.find(s => (s.lessonNumber === l || s.lessonNumberInMonth === l));
        const hierDetails = this.getLessonDetails(textbookName, monthNumber, l);

        if (existing) {
          lessons.push({
            id: existing.id,
            monthNumber,
            monthIndex: monthNumber,
            lessonNumber: l,
            lessonNumberInMonth: l,
            date: existing.date,
            displayDate: existing.date,
            dayOfWeek: existing.dayOfWeek,
            dayOfWeekShort: existing.dayOfWeekShort || existing.dayOfWeek?.slice(0, 2).toLowerCase() || 'пн',
            time: existing.time,
            status: existing.status,
            topic: existing.topic,
            format: existing.format,
            isConducted: existing.status === 'completed' || hierDetails.isConducted,
            hasFiles: (hierDetails.files && hierDetails.files.length > 0),
            hasHomework: (hierDetails.homework && !!hierDetails.homework.text),
            vocabularyCount: (hierDetails.vocabulary ? hierDetails.vocabulary.length : 0)
          });
        } else {
          lessons.push({
            id: null,
            monthNumber,
            monthIndex: monthNumber,
            lessonNumber: l,
            lessonNumberInMonth: l,
            date: '',
            displayDate: '—',
            dayOfWeek: '',
            dayOfWeekShort: '',
            time: group.scheduleTime || '16:00 - 17:00',
            status: 'unassigned',
            topic: hierDetails.topic || `Урок ${l}`,
            format: group.classroom || 'Очно',
            isConducted: false,
            hasFiles: false,
            hasHomework: false,
            vocabularyCount: 0
          });
        }
      }

      return {
        monthNumber,
        monthIndex: monthNumber,
        monthName: m.name,
        lessons,
        dates: lessons
      };
    });
  }

  // --- Points & Grades System ---
  getPointRecords(studentId = null) {
    let list = [...this.state.pointRecords];
    if (studentId) {
      list = list.filter(p => p.studentId === studentId);
    }
    return list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  awardPoints({ studentId, teacherId, points, type = 'add', category, comment, date, excludeFromRating = false }) {
    let parsedPoints = Math.abs(Number(points));
    if (isNaN(parsedPoints) || parsedPoints === 0) return null;

    if (type === 'deduct') {
      parsedPoints = -parsedPoints;
    }

    const defaultCategory = parsedPoints >= 0 ? 'Активность' : 'Несданное ДЗ';
    const finalCategory = category || defaultCategory;
    const finalComment = comment?.trim() || finalCategory;

    // Guard against awarding one-time Survey (+200) bonus more than once
    if (finalCategory === 'Анкета' && parsedPoints > 0) {
      const alreadyHasSurveyRecord = Array.isArray(this.state.pointRecords) &&
        this.state.pointRecords.some(r => r.studentId === studentId && r.category === 'Анкета');
      const student = this.getStudentById(studentId);
      if (alreadyHasSurveyRecord || student?.surveyBonusAwarded) {
        console.warn(`[Store] Survey bonus already awarded to student ${studentId}. Skipping duplicate.`);
        return null;
      }
      if (student) {
        student.surveyBonusAwarded = true;
      }
    }

    const id = 'pt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const record = {
      id,
      studentId,
      teacherId: teacherId || 'admin',
      type: parsedPoints >= 0 ? 'add' : 'deduct',
      date: date || new Date().toISOString(),
      points: parsedPoints,
      category: finalCategory,
      comment: finalComment,
      excludeFromRating: Boolean(excludeFromRating)
    };

    this.state.pointRecords.unshift(record);

    const student = this.getStudentById(studentId);
    if (student) {
      student.totalPoints = Math.max(0, (student.totalPoints || 0) + parsedPoints);
      if (parsedPoints > 0 && !excludeFromRating) {
        student.lifetimePoints = (student.lifetimePoints || 0) + parsedPoints;
      }
    }

    this.logActivity({
      type: 'points',
      title: parsedPoints >= 0 ? 'Начисление баллов' : 'Списание баллов',
      details: `${parsedPoints > 0 ? '+' : ''}${parsedPoints} ⭐ ученику ${student?.fullName || studentId} (${finalCategory}${finalComment && finalComment !== finalCategory ? ': ' + finalComment : ''})${excludeFromRating ? ' [Вне рейтинга]' : ''}`
    });

    this.saveState();
    return record;
  }

  awardPointsBatch(items = [], options = {}) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const nowIso = new Date().toISOString();
    const createdRecords = [];
    const batchExcludeFromRating = Boolean(options.excludeFromRating);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let parsedPoints = Math.abs(Number(item.points));
      if (isNaN(parsedPoints) || parsedPoints === 0) continue;

      if (item.type === 'deduct') {
        parsedPoints = -parsedPoints;
      }

      const defaultCategory = parsedPoints >= 0 ? 'Активность' : 'Несданное ДЗ';
      const finalCategory = item.category || defaultCategory;
      const finalComment = item.comment?.trim() || finalCategory;
      const excludeFromRating = Boolean(item.excludeFromRating !== undefined ? item.excludeFromRating : batchExcludeFromRating);

      const id = 'pt-' + Date.now() + '-' + i + '-' + Math.random().toString(36).slice(2, 6);
      const record = {
        id,
        studentId: item.studentId,
        teacherId: item.teacherId || 'admin',
        type: parsedPoints >= 0 ? 'add' : 'deduct',
        date: item.date || nowIso,
        points: parsedPoints,
        category: finalCategory,
        comment: finalComment,
        excludeFromRating
      };

      createdRecords.push(record);
      this.state.pointRecords.unshift(record);

      const student = this.getStudentById(item.studentId);
      if (student) {
        student.totalPoints = Math.max(0, (student.totalPoints || 0) + parsedPoints);
        if (parsedPoints > 0 && !excludeFromRating) {
          student.lifetimePoints = (student.lifetimePoints || 0) + parsedPoints;
        }
      }
    }

    if (createdRecords.length > 0) {
      this.logActivity({
        type: 'points',
        title: 'Групповое начисление баллов',
        details: `Баллы выставлены ${createdRecords.length} ученикам`
      });
      this.saveState();
    }

    return createdRecords;
  }

  deletePointRecord(id) {
    const record = this.state.pointRecords.find(p => p.id === id);
    if (record) {
      const student = this.getStudentById(record.studentId);
      if (student) {
        student.totalPoints = Math.max(0, (student.totalPoints || 0) - record.points);
        if (record.points > 0) {
          student.lifetimePoints = Math.max(0, (student.lifetimePoints || 0) - record.points);
        }
      }
      this.state.pointRecords = this.state.pointRecords.filter(p => p.id !== id);
      this.logActivity({
        type: 'points',
        title: 'Удаление записи баллов',
        details: `Удалена запись на ${record.points} ⭐ у ученика ${student?.fullName || record.studentId}`
      });
      this.saveState(true);
    }
  }

  // --- Monthly Group Competition & Leaderboard System ---
  getAcademicMonthsList() {
    return [
      { key: '2026-09', name: 'Сентябрь 2026', shortName: 'Сентябрь', year: 2026, monthIndex: 8, num: 1 },
      { key: '2026-10', name: 'Октябрь 2026', shortName: 'Октябрь', year: 2026, monthIndex: 9, num: 2 },
      { key: '2026-11', name: 'Ноябрь 2026', shortName: 'Ноябрь', year: 2026, monthIndex: 10, num: 3 },
      { key: '2026-12', name: 'Декабрь 2026', shortName: 'Декабрь', year: 2026, monthIndex: 11, num: 4 },
      { key: '2027-01', name: 'Январь 2027', shortName: 'Январь', year: 2027, monthIndex: 0, num: 5 },
      { key: '2027-02', name: 'Февраль 2027', shortName: 'Февраль', year: 2027, monthIndex: 1, num: 6 },
      { key: '2027-03', name: 'Март 2027', shortName: 'Март', year: 2027, monthIndex: 2, num: 7 },
      { key: '2027-04', name: 'Апрель 2027', shortName: 'Апрель', year: 2027, monthIndex: 3, num: 8 },
      { key: '2027-05', name: 'Май 2027', shortName: 'Май', year: 2027, monthIndex: 4, num: 9 },
      { key: '2027-06', name: 'Июнь 2027', shortName: 'Июнь', year: 2027, monthIndex: 5, num: 10 }
    ];
  }

  /**
   * Calculates monthly leaderboard for a group strictly within the specified month/year.
   * Total/previous months' points are completely ignored.
   * Only positive additions and negative deductions that occurred in this month are calculated.
   */
  /**
   * Monthly Group Leaderboard - calculates points strictly for the target academic month
   * Excludes bonus points (excludeFromRating: true) and limits to students of this group
   */
  getGroupMonthlyLeaderboard(groupId, year, monthIndex) {
    if (!groupId) {
      return [];
    }

    let targetYear = Number(year);
    let targetMonth = Number(monthIndex);

    if (isNaN(targetYear) || isNaN(targetMonth)) {
      const now = new Date();
      targetYear = now.getFullYear();
      targetMonth = now.getMonth();
    }

    const group = this.getGroupById(groupId);
    let students = this.getStudentsByGroupId(groupId);
    if (!students || students.length === 0) {
      students = this.getStudents().filter(s => s.groupId === groupId);
    }
    if (!students || students.length === 0) {
      return [];
    }

    const allRecords = this.getPointRecords();

    const leaderboard = students.map(student => {
      const monthlyRecords = allRecords.filter(r => {
        if (r.studentId !== student.id) return false;
        if (r.excludeFromRating || r.noRating) return false;
        if (!r.date) return false;
        const d = new Date(r.date);
        if (isNaN(d.getTime())) return false;
        return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
      });

      let addedPoints = 0;
      let deductedPoints = 0;

      monthlyRecords.forEach(r => {
        const pts = Number(r.points) || 0;
        if (pts > 0) {
          addedPoints += pts;
        } else if (pts < 0) {
          deductedPoints += Math.abs(pts);
        }
      });

      const netMonthlyPoints = addedPoints - deductedPoints;

      return {
        studentId: student.id,
        fullName: student.fullName,
        grade: student.grade,
        school: student.school,
        level: student.level,
        groupId: student.groupId,
        groupName: group ? group.name : 'Индивидуально',
        lifetimePoints: student.totalPoints || 0,
        addedPoints,
        deductedPoints,
        netMonthlyPoints,
        operationsCount: monthlyRecords.length,
        records: monthlyRecords
      };
    });

    leaderboard.sort((a, b) => {
      if (b.netMonthlyPoints !== a.netMonthlyPoints) {
        return b.netMonthlyPoints - a.netMonthlyPoints;
      }
      if (b.addedPoints !== a.addedPoints) {
        return b.addedPoints - a.addedPoints;
      }
      return a.fullName.localeCompare(b.fullName, 'ru');
    });

    return leaderboard.map((item, idx) => ({
      ...item,
      rank: idx + 1,
      isFirstPlace: idx === 0 && item.netMonthlyPoints > 0,
      isSecondPlace: idx === 1 && item.netMonthlyPoints > 0,
      isThirdPlace: idx === 2 && item.netMonthlyPoints > 0
    }));
  }

  /**
   * School-Wide Monthly Leaderboard - ranks all active students across all groups
   * Filtered strictly by target academic month, excluding non-rating records
   */
  getSchoolMonthlyLeaderboard(year, monthIndex) {
    let targetYear = Number(year);
    let targetMonth = Number(monthIndex);

    if (isNaN(targetYear) || isNaN(targetMonth)) {
      const now = new Date();
      targetYear = now.getFullYear();
      targetMonth = now.getMonth();
    }

    const students = this.getStudents();
    const allRecords = this.getPointRecords();
    const groupsMap = new Map((this.getGroups() || []).map(g => [g.id, g.name]));

    const leaderboard = students.map(student => {
      const monthlyRecords = allRecords.filter(r => {
        if (r.studentId !== student.id) return false;
        if (r.excludeFromRating || r.noRating) return false;
        if (!r.date) return false;
        const d = new Date(r.date);
        if (isNaN(d.getTime())) return false;
        return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
      });

      let addedPoints = 0;
      let deductedPoints = 0;

      monthlyRecords.forEach(r => {
        const pts = Number(r.points) || 0;
        if (pts > 0) {
          addedPoints += pts;
        } else if (pts < 0) {
          deductedPoints += Math.abs(pts);
        }
      });

      const netMonthlyPoints = addedPoints - deductedPoints;

      return {
        studentId: student.id,
        fullName: student.fullName,
        grade: student.grade,
        school: student.school,
        level: student.level,
        groupId: student.groupId,
        groupName: groupsMap.get(student.groupId) || 'Индивидуально',
        lifetimePoints: student.totalPoints || 0,
        addedPoints,
        deductedPoints,
        netMonthlyPoints,
        operationsCount: monthlyRecords.length,
        records: monthlyRecords
      };
    });

    leaderboard.sort((a, b) => {
      if (b.netMonthlyPoints !== a.netMonthlyPoints) {
        return b.netMonthlyPoints - a.netMonthlyPoints;
      }
      if (b.addedPoints !== a.addedPoints) {
        return b.addedPoints - a.addedPoints;
      }
      return a.fullName.localeCompare(b.fullName, 'ru');
    });

    return leaderboard.map((item, idx) => ({
      ...item,
      rank: idx + 1,
      isFirstPlace: idx === 0 && item.netMonthlyPoints > 0,
      isSecondPlace: idx === 1 && item.netMonthlyPoints > 0,
      isThirdPlace: idx === 2 && item.netMonthlyPoints > 0
    }));
  }

  // --- Analytics ---
  getAnalytics() {
    const totalStudents = this.state.students.filter(s => s.status === 'active').length;
    const totalTeachers = this.state.teachers.filter(t => t.status === 'active').length;
    const totalGroups = (this.state.groups || []).filter(g => g.status === 'active').length;
    const totalLessons = this.state.schedule.length;
    const completedLessons = this.state.schedule.filter(s => s.status === 'completed').length;
    const plannedLessons = this.state.schedule.filter(s => s.status === 'planned').length;

    const allPoints = this.state.students.map(s => s.totalPoints || 0);
    const avgPoints = allPoints.length ? Math.round(allPoints.reduce((a, b) => a + b, 0) / allPoints.length) : 0;

    return {
      totalStudents,
      totalTeachers,
      totalGroups,
      totalLessons,
      completedLessons,
      plannedLessons,
      avgPoints
    };
  }

  // --- Student Survey (Анкета) System (+200 баллов) ---
  saveStudentSurvey(studentId, surveyData = {}) {
    const student = this.getStudentById(studentId);
    if (!student) return { success: false, error: 'Ученик не найден' };

    const wasCompleted = Boolean(student.surveyCompleted);
    if (surveyData.fullName && surveyData.fullName.trim()) student.fullName = surveyData.fullName.trim();
    if (surveyData.birthDate) student.birthDate = surveyData.birthDate.trim();
    if (surveyData.phone) student.phone = surveyData.phone.trim();
    if (surveyData.parent1Name) student.parent1Name = surveyData.parent1Name.trim();
    if (surveyData.parent1Phone) student.parent1Phone = surveyData.parent1Phone.trim();
    if (student.parent1Name) student.parentName = student.parent1Name;
    if (student.parent1Phone) student.parentPhone = student.parent1Phone;
    if (surveyData.parent2Name !== undefined) student.parent2Name = surveyData.parent2Name?.trim() || '';
    if (surveyData.parent2Phone !== undefined) student.parent2Phone = surveyData.parent2Phone?.trim() || '';
    if (surveyData.parent1Role) student.parent1Role = surveyData.parent1Role.trim();
    if (surveyData.parent2Role) student.parent2Role = surveyData.parent2Role.trim();
    if (surveyData.school) student.school = surveyData.school.trim();
    if (surveyData.grade) student.grade = surveyData.grade.trim();
    if (surveyData.shift) student.shift = surveyData.shift.trim();

    student.surveyCompleted = true;
    student.surveyCompletedAt = student.surveyCompletedAt || new Date().toISOString();

    let bonusAwarded = false;
    if (!wasCompleted) {
      this.awardPoints({
        studentId: student.id,
        teacherId: 'admin',
        points: 200,
        type: 'add',
        category: 'Анкета',
        comment: 'Бонус за заполнение анкеты ученика (+200 ⭐)',
        excludeFromRating: false
      });
      bonusAwarded = true;
    }

    this.saveState(true);
    return { success: true, bonusAwarded, student };
  }

  // --- Birthday Bonus System (+500 баллов) ---
  checkAndAwardBirthdayBonus(studentId) {
    const student = this.getStudentById(studentId);
    if (!student || !student.birthDate) return { isBirthday: false, awarded: false };

    const parts = student.birthDate.split('-');
    if (parts.length < 3) return { isBirthday: false, awarded: false };

    const bMonth = parseInt(parts[1], 10);
    const bDay = parseInt(parts[2], 10);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();

    const isTodayBirthday = (bMonth === currentMonth && bDay === currentDay);
    if (!isTodayBirthday) {
      return { isBirthday: false, awarded: false };
    }

    if (student.lastBirthdayBonusYear === currentYear) {
      return { isBirthday: true, awarded: false, alreadyAwardedThisYear: true, student };
    }

    student.lastBirthdayBonusYear = currentYear;
    this.awardPoints({
      studentId: student.id,
      teacherId: 'admin',
      points: 500,
      type: 'add',
      category: 'День рождения',
      comment: `Праздничный подарок от Step Up English на День Рождения ${currentYear}! 🎂🎁 (без рейтинга)`,
      excludeFromRating: true
    });

    this.saveState(true);
    return { isBirthday: true, awarded: true, points: 500, student };
  }

  // --- Curriculum Helper: Next upcoming lesson in current month ---
  getNextUpcomingLessonForTextbook(textbookName) {
    if (!textbookName) return null;
    const currentMonth = this.getCurrentAcademicMonth();
    const mNum = currentMonth ? currentMonth.num : 2; // Default to October (Month 2)
    const monthLessons = this.getLessonsForMonth(textbookName, mNum);
    
    // First unconducted lesson in current month
    const nextLesson = monthLessons.find(l => !l.isConducted) || monthLessons[0];
    const prevConducted = monthLessons.filter(l => l.isConducted).slice(-1)[0] || this.getLatestUnlockedLessonForTextbook(textbookName);

    return {
      ...nextLesson,
      monthName: currentMonth ? currentMonth.name : 'Октябрь 2026',
      prevConductedLesson: prevConducted
    };
  }

  // =========================================================================
  // Lesson Attendance Management
  // =========================================================================

  getLessonAttendance(lessonId) {
    const lesson = this.getLessonById(lessonId);
    return (lesson && lesson.attendance) ? lesson.attendance : {};
  }

  saveLessonAttendance(lessonId, attendanceMap) {
    const lesson = this.getLessonById(lessonId);
    if (!lesson) return null;
    lesson.attendance = { ...(lesson.attendance || {}), ...attendanceMap };

    // If lesson was planned, marking attendance marks it as completed
    if (lesson.status === 'planned') {
      lesson.status = 'completed';
      if (lesson.groupId) {
        try {
          this._handleLessonCompletion(lesson, lesson.date || new Date().toISOString().slice(0, 10));
        } catch (e) {
          console.warn('⚠️ _handleLessonCompletion on attendance error:', e);
        }
      }
    }
    this.saveState(true);
    return lesson.attendance;
  }

  getStudentAttendanceStats(studentId) {
    const student = this.getStudentById(studentId);
    if (!student) return { total: 0, attended: 0, missed: 0, percentage: 100, history: [] };
    const allLessons = this.state.schedule || [];
    const myLessons = allLessons.filter(l => {
      if (l.studentId === studentId) return true;
      if (student.groupId && l.groupId === student.groupId) return true;
      return false;
    });

    let totalConducted = 0;
    let attended = 0;
    let missed = 0;
    const history = [];

    myLessons.forEach(l => {
      if (l.status === 'completed' || (l.attendance && l.attendance[studentId])) {
        totalConducted++;
        const attStatus = l.attendance ? (l.attendance[studentId] || 'absent') : 'present';
        if (attStatus === 'present') {
          attended++;
          history.push({ lessonId: l.id, date: l.date, time: l.time, topic: l.topic, status: 'present' });
        } else {
          missed++;
          history.push({ lessonId: l.id, date: l.date, time: l.time, topic: l.topic, status: 'absent' });
        }
      }
    });

    const percentage = totalConducted > 0 ? Math.round((attended / totalConducted) * 100) : 100;
    return {
      total: totalConducted,
      attended,
      missed,
      percentage,
      history: history.reverse()
    };
  }

  // =========================================================================
  // Monthly Payments & Warning System
  // =========================================================================

  getCurrentAcademicMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const key = `${year}-${month}`;
    const list = this.getAcademicMonthsList();
    return list.find(m => m.key === key) || list[0]; // defaults to 2026-09
  }

  getPayment(studentId, monthKey) {
    if (!this.state.payments) this.state.payments = {};
    const key = `${studentId}_${monthKey}`;
    return this.state.payments[key] || {
      studentId,
      monthKey,
      status: 'unpaid',
      paidAt: null,
      amount: 25000,
      notes: ''
    };
  }

  setPaymentStatus(studentId, monthKey, status, extra = {}) {
    if (!this.state.payments) this.state.payments = {};
    const key = `${studentId}_${monthKey}`;
    const existing = this.getPayment(studentId, monthKey);
    const newStatus = status === 'paid' ? 'paid' : 'unpaid';
    this.state.payments[key] = {
      ...existing,
      studentId,
      monthKey,
      status: newStatus,
      paidAt: newStatus === 'paid' ? (existing.paidAt || new Date().toISOString()) : null,
      ...extra
    };
    this.saveState();
    return this.state.payments[key];
  }

  bulkSetPaymentStatus(studentIds, monthKey, status) {
    if (!Array.isArray(studentIds) || !monthKey) return;
    if (!this.state.payments) this.state.payments = {};
    studentIds.forEach(id => {
      this.setPaymentStatus(id, monthKey, status);
    });
  }

  isPaymentDueWarningActive(studentId, monthKey = null) {
    if (!studentId) return false;
    const targetMonth = monthKey ? (this.getAcademicMonthsList().find(m => m.key === monthKey) || this.getCurrentAcademicMonth()) : this.getCurrentAcademicMonth();
    
    // If payment is made, warning is strictly hidden
    const payment = this.getPayment(studentId, targetMonth.key);
    if (payment && payment.status === 'paid') {
      return false;
    }

    // "предупреждение включать с первого дня. убирать если оплата есть"
    const now = new Date();
    const firstDay = new Date(targetMonth.year, targetMonth.monthIndex, 1);

    // If today is on or past the 1st of the target academic month (or within current academic year)
    if (now >= firstDay || now.getFullYear() >= targetMonth.year) {
      return true;
    }

    return true;
  }

  getMonthPaymentsSummary(monthKey, groupId = 'all') {
    let students = this.getStudents();
    if (groupId && groupId !== 'all') {
      students = students.filter(s => s.groupId === groupId);
    }
    const total = students.length;
    let paidCount = 0;
    let unpaidCount = 0;

    students.forEach(s => {
      const p = this.getPayment(s.id, monthKey);
      if (p.status === 'paid') {
        paidCount++;
      } else {
        unpaidCount++;
      }
    });

    const percent = total > 0 ? Math.round((paidCount / total) * 100) : 0;
    return {
      total,
      paidCount,
      unpaidCount,
      percent
    };
  }

  // =========================================================================
  // Mini-Games & Quizzes System (Points, 100-pt Weekly Cap, Progress & Titles)
  // =========================================================================

  getCurrentIsoWeekKey(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  getLocalDateString(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  getStudentGameProgress(studentId) {
    const student = this.getStudentById(studentId);
    if (!student) {
      return {
        weeklyPoints: 0,
        weeklyLimit: 100,
        dailyStreak: 0,
        streakBonus: 0,
        currentWeekKey: this.getCurrentIsoWeekKey(),
        irregularStreak: 0,
        conditionalStreak: 0,
        unlockedTenseLevels: ['easy'],
        unlockedSecretTitles: [],
        irregularRecentIds: []
      };
    }

    if (!student.gameStats) {
      student.gameStats = {};
    }

    const currentWeekKey = this.getCurrentIsoWeekKey();
    if (!student.gameStats.weekly) {
      student.gameStats.weekly = { weekKey: currentWeekKey, points: 0 };
    } else if (student.gameStats.weekly.weekKey !== currentWeekKey) {
      student.gameStats.weekly = { weekKey: currentWeekKey, points: 0 };
    }

    // Weekly limit and streak are kept by the server (student.gameLedger); a just-played game is shown until the server answers
    const game = viewLedger(this.effectiveGameLedger(student));

    if (!Array.isArray(student.gameStats.unlockedTenseLevels) || student.gameStats.unlockedTenseLevels.length === 0) {
      student.gameStats.unlockedTenseLevels = ['easy'];
    }

    if (!Array.isArray(student.unlockedTitles)) {
      student.unlockedTitles = [];
    }

    if (!Array.isArray(student.gameStats.unlockedSecretTitles)) {
      student.gameStats.unlockedSecretTitles = [...student.unlockedTitles];
    }

    if (!Array.isArray(student.gameStats.irregularRecentIds)) {
      student.gameStats.irregularRecentIds = [];
    }

    return {
      weeklyPoints: game.weeklyPoints,
      weeklyLimit: game.weeklyLimit,
      dailyStreak: game.dailyStreak,
      streakBonus: game.streakBonus,
      daysToNextLevel: game.daysToNextLevel,
      todayScore: game.todayScore,
      todayCounted: game.todayCounted,
      minDailyScore: GAME_RULES.MIN_DAILY_SCORE,
      currentWeekKey: game.currentWeekKey,
      wordsStreak: student.gameStats.wordsStreak || 0,
      irregularStreak: student.gameStats.irregularStreak || 0,
      conditionalStreak: student.gameStats.conditionalStreak || 0,
      tensesStreak: student.gameStats.tensesStreak || 0,
      builderStreak: student.gameStats.builderStreak || 0,
      prepositionsStreak: student.gameStats.prepositionsStreak || 0,
      phrasalStreak: student.gameStats.phrasalStreak || 0,
      mistakesStreak: student.gameStats.mistakesStreak || 0,
      synonymsStreak: student.gameStats.synonymsStreak || 0,
      unlockedTenseLevels: student.gameStats.unlockedTenseLevels,
      unlockedSecretTitles: student.unlockedTitles,
      irregularRecentIds: student.gameStats.irregularRecentIds,
      conditionalModesCompleted: student.gameStats.conditionalModesCompleted || []
    };
  }

  awardGamePoints(studentId, pointsEarned, gameKey, gameTitle = 'Мини-игра') {
    const student = this.getStudentById(studentId);
    if (!student) return { pointsEarned: 0, pointsAwarded: 0, weeklyTotal: 0, weeklyLimit: 100, dailyStreak: 0, streakBonus: 0, capReached: false };

    if (!student.gameStats) student.gameStats = {};

    const rawPoints = Math.max(0, Math.floor(Number(pointsEarned) || 0));
    if (rawPoints <= 0) {
      trackGameEnd(gameKey, 0, 0);
      const g = viewLedger(this.effectiveGameLedger(student));
      return { pointsEarned: 0, pointsAwarded: 0, weeklyTotal: g.weeklyPoints, weeklyLimit: g.weeklyLimit, dailyStreak: g.dailyStreak, streakBonus: g.streakBonus, capReached: g.weeklyPoints >= g.weeklyLimit };
    }

    // Same calculation the server makes; the server's answer replaces this preview
    const result = playGame(this.effectiveGameLedger(student), rawPoints);
    this._gameOverlay.set(studentId, result.ledger);
    trackGameEnd(gameKey, result.score, result.award);

    this.state.pointRecords.unshift({
      id: 'pt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      studentId,
      teacherId: 'admin',
      type: 'add',
      date: new Date().toISOString(),
      points: result.award,
      gameScore: result.score,
      gameKey,
      gameTitle,
      category: 'Мини-игры',
      comment: `🎮 ${gameTitle}: набрано ${result.score} (начислено +${result.award} ⭐ в профиль)`,
      excludeFromRating: false
    });
    if (result.award > 0) {
      student.totalPoints = Math.max(0, (student.totalPoints || 0) + result.award);
      student.lifetimePoints = (student.lifetimePoints || 0) + result.award;
    }
    this.saveState(true);

    return {
      pointsEarned: rawPoints,
      pointsAwarded: result.award,
      weeklyTotal: result.weeklyPoints,
      weeklyLimit: result.weeklyLimit,
      dailyStreak: result.dailyStreak,
      streakBonus: result.streakBonus,
      capReached: result.weeklyPoints >= result.weeklyLimit
    };
  }

  /** Server ledger, or the local preview of games the server has not confirmed yet */
  effectiveGameLedger(student) {
    const server = student.gameLedger && student.gameLedger.v === 2 ? student.gameLedger : migrateLedger(student.gameLedger, student.gameStats);
    const local = this._gameOverlay.get(student.id);
    if (local && local.n > (server.n || 0)) return local;
    if (local) this._gameOverlay.delete(student.id);
    return server;
  }

  unlockSecretTitle(studentId, titleName) {
    const student = this.getStudentById(studentId);
    if (!student) return false;

    if (!Array.isArray(student.unlockedTitles)) {
      student.unlockedTitles = [];
    }
    if (!student.gameStats) {
      student.gameStats = {};
    }
    if (!Array.isArray(student.gameStats.unlockedSecretTitles)) {
      student.gameStats.unlockedSecretTitles = [];
    }

    const alreadyUnlocked = student.unlockedTitles.includes(titleName);
    if (!alreadyUnlocked) {
      student.unlockedTitles.push(titleName);
      student.gameStats.unlockedSecretTitles.push(titleName);
      this.saveState();
      return true; // newly unlocked
    }
    return false;
  }

  recordGameResult(studentId, gameKey, score, total = 10, meta = {}) {
    const student = this.getStudentById(studentId);
    if (!student) return { newTitleUnlocked: null, levelUnlocked: null };

    this.getStudentGameProgress(studentId); // ensure gameStats is initialized
    let newTitleUnlocked = null;
    let levelUnlocked = null;

    if (gameKey === 'words') {
      if (score === total && total >= 10) {
        student.gameStats.wordsStreak = (student.gameStats.wordsStreak || 0) + 1;
        if (student.gameStats.wordsStreak >= 3) {
          const unlocked = this.unlockSecretTitle(studentId, 'знаток слов');
          if (unlocked) {
            newTitleUnlocked = 'знаток слов';
          }
        }
      } else {
        student.gameStats.wordsStreak = 0;
      }
    } else if (gameKey === 'irregular') {
      if (score === total && total >= 10) {
        student.gameStats.irregularStreak = (student.gameStats.irregularStreak || 0) + 1;
        if (student.gameStats.irregularStreak >= 3) {
          const unlocked = this.unlockSecretTitle(studentId, 'знаток irregular');
          if (unlocked) {
            newTitleUnlocked = 'знаток irregular';
          }
        }
      } else {
        student.gameStats.irregularStreak = 0;
      }

      if (Array.isArray(meta.verbIds) && meta.verbIds.length > 0) {
        student.gameStats.irregularRecentIds = meta.verbIds.slice(0, 10);
      }
    } else if (gameKey === 'conditionals') {
      if (score === total && total >= 10) {
        student.gameStats.conditionalStreak = (student.gameStats.conditionalStreak || 0) + 1;
        if (student.gameStats.conditionalStreak >= 3) {
          const unlocked = this.unlockSecretTitle(studentId, 'знаток conditional');
          if (unlocked) {
            newTitleUnlocked = 'знаток conditional';
          }
        }
        if (meta.mode) {
          if (!Array.isArray(student.gameStats.conditionalModesCompleted)) {
            student.gameStats.conditionalModesCompleted = [];
          }
          if (!student.gameStats.conditionalModesCompleted.includes(meta.mode)) {
            student.gameStats.conditionalModesCompleted.push(meta.mode);
          }
          if (['type1', 'type2', 'type3', 'mixed'].every(m => student.gameStats.conditionalModesCompleted.includes(m))) {
            const unlockedArch = this.unlockSecretTitle(studentId, 'архитектор условий');
            if (unlockedArch) {
              newTitleUnlocked = newTitleUnlocked || 'архитектор условий';
            }
          }
        }
      } else {
        student.gameStats.conditionalStreak = 0;
      }
    } else if (gameKey === 'tenses') {
      const currentLevel = meta.level || 'easy';
      const tiersOrder = ['easy', 'middle', 'hard', 'impossible', 'rampage'];
      const curIndex = tiersOrder.indexOf(currentLevel);

      // Streak tracking for 10/10 in Tenses
      if (score === total && total >= 10) {
        student.gameStats.tensesStreak = (student.gameStats.tensesStreak || 0) + 1;
        if (student.gameStats.tensesStreak >= 3) {
          const unlocked = this.unlockSecretTitle(studentId, 'повелитель времён');
          if (unlocked) {
            newTitleUnlocked = 'повелитель времён';
          }
        }
      } else {
        student.gameStats.tensesStreak = 0;
      }

      if (score >= 8) {
        if (curIndex !== -1 && curIndex < tiersOrder.length - 1) {
          const nextTier = tiersOrder[curIndex + 1];
          if (!student.gameStats.unlockedTenseLevels.includes(nextTier)) {
            student.gameStats.unlockedTenseLevels.push(nextTier);
            levelUnlocked = nextTier;
          }
        }
        if (currentLevel === 'rampage') {
          const unlocked = this.unlockSecretTitle(studentId, 'гений времён');
          if (unlocked) {
            newTitleUnlocked = newTitleUnlocked || 'гений времён';
          }
        }
      }
    } else if (gameKey === 'builder') {
      if (score === total && total >= 10) {
        student.gameStats.builderStreak = (student.gameStats.builderStreak || 0) + 1;
        if (student.gameStats.builderStreak >= 3) {
          const unlocked = this.unlockSecretTitle(studentId, 'мастер предложений');
          if (unlocked) {
            newTitleUnlocked = 'мастер предложений';
          }
        }
      } else {
        student.gameStats.builderStreak = 0;
      }
    } else if (gameKey === 'prepositions') {
      if (score === total && total >= 10) {
        student.gameStats.prepositionsStreak = (student.gameStats.prepositionsStreak || 0) + 1;
        if (student.gameStats.prepositionsStreak >= 3) {
          const unlocked = this.unlockSecretTitle(studentId, 'повелитель предлогов');
          if (unlocked) {
            newTitleUnlocked = 'повелитель предлогов';
          }
        }
      } else {
        student.gameStats.prepositionsStreak = 0;
      }
    } else if (gameKey === 'phrasal') {
      if (score === total && total >= 10) {
        student.gameStats.phrasalStreak = (student.gameStats.phrasalStreak || 0) + 1;
        if (student.gameStats.phrasalStreak >= 3) {
          const unlocked = this.unlockSecretTitle(studentId, 'знаток phrasal verbs');
          if (unlocked) {
            newTitleUnlocked = 'знаток phrasal verbs';
          }
        }
      } else {
        student.gameStats.phrasalStreak = 0;
      }
    } else if (gameKey === 'mistakes') {
      if (score === total && total >= 10) {
        student.gameStats.mistakesStreak = (student.gameStats.mistakesStreak || 0) + 1;
        if (student.gameStats.mistakesStreak >= 3) {
          const unlocked = this.unlockSecretTitle(studentId, 'грамматический детектив');
          if (unlocked) {
            newTitleUnlocked = 'грамматический детектив';
          }
        }
      } else {
        student.gameStats.mistakesStreak = 0;
      }
    } else if (gameKey === 'synonyms') {
      if (score === total && total >= 10) {
        student.gameStats.synonymsStreak = (student.gameStats.synonymsStreak || 0) + 1;
        if (student.gameStats.synonymsStreak >= 3) {
          const unlocked = this.unlockSecretTitle(studentId, 'спринтер слов');
          if (unlocked) {
            newTitleUnlocked = 'спринтер слов';
          }
        }
      } else {
        student.gameStats.synonymsStreak = 0;
      }
    }

    // Meta check: Unlocking 5 secret titles awards "легенда мини-игр"
    const SECRET_NAMES = ['знаток слов', 'знаток irregular', 'знаток conditional', 'архитектор условий', 'повелитель времён', 'гений времён', 'мастер предложений', 'повелитель предлогов', 'знаток phrasal verbs', 'грамматический детектив', 'спринтер слов'];
    const secretCount = Array.isArray(student.unlockedTitles) ? student.unlockedTitles.filter(t => SECRET_NAMES.includes(t)).length : 0;
    if (secretCount >= 5) {
      const unlockedLegend = this.unlockSecretTitle(studentId, 'легенда мини-игр');
      if (unlockedLegend) {
        newTitleUnlocked = newTitleUnlocked || 'легенда мини-игр';
      }
    }

    this.saveState();
    let currentStreak = 0;
    if (gameKey === 'words') currentStreak = student.gameStats.wordsStreak || 0;
    else if (gameKey === 'irregular') currentStreak = student.gameStats.irregularStreak || 0;
    else if (gameKey === 'conditionals') currentStreak = student.gameStats.conditionalStreak || 0;
    else if (gameKey === 'tenses') currentStreak = student.gameStats.tensesStreak || 0;
    else if (gameKey === 'builder') currentStreak = student.gameStats.builderStreak || 0;
    else if (gameKey === 'prepositions') currentStreak = student.gameStats.prepositionsStreak || 0;
    else if (gameKey === 'phrasal') currentStreak = student.gameStats.phrasalStreak || 0;
    else if (gameKey === 'mistakes') currentStreak = student.gameStats.mistakesStreak || 0;
    else if (gameKey === 'synonyms') currentStreak = student.gameStats.synonymsStreak || 0;

    return {
      newTitleUnlocked,
      levelUnlocked,
      currentStreak
    };
  }

  getPrioritizedVocabularyForGame(studentId, targetCount = 10) {
    const poolData = this.getStudentVocabularyPool(studentId);
    let allWords = [...(poolData?.allWords || [])];

    // Filter out invalid/empty items
    allWords = allWords.filter(w => w && w.word && w.word.trim() && w.translation && w.translation.trim());

    // Fallback 1: global textbook vocabulary pool if student pool is too small
    if (allWords.length < targetCount && this.state.textbookVocabularyPool) {
      for (const tbWords of Object.values(this.state.textbookVocabularyPool)) {
        if (Array.isArray(tbWords)) {
          tbWords.forEach(w => {
            if (w && w.word && w.translation && !allWords.some(x => x.word.toLowerCase() === w.word.toLowerCase())) {
              allWords.push({ ...w });
            }
          });
        }
      }
    }

    // Fallback 2: seed vocabulary pairs if system has very few words
    const defaultPairs = [
      { word: 'Disappear', transcription: '[dɪsəˈpɪə]', translation: 'исчезать', example: 'She suddenly disappeared.' },
      { word: 'Adventure', transcription: '[ədˈventʃə]', translation: 'приключение', example: 'They went on an exciting adventure.' },
      { word: 'Challenge', transcription: '[ˈtʃælɪndʒ]', translation: 'вызов, испытание', example: 'It was a difficult challenge.' },
      { word: 'Knowledge', transcription: '[ˈnɒlɪdʒ]', translation: 'знания', example: 'Knowledge is power.' },
      { word: 'Celebrate', transcription: '[ˈselɪbreɪt]', translation: 'праздновать', example: 'We celebrate our victories.' },
      { word: 'Imagine', transcription: '[ɪˈmædʒɪn]', translation: 'воображать', example: 'Imagine the possibilities.' },
      { word: 'Discover', transcription: '[dɪˈskʌvə]', translation: 'открывать, исследовать', example: 'Scientists discover new planets.' },
      { word: 'Protect', transcription: '[prəˈtekt]', translation: 'защищать', example: 'We must protect our planet.' },
      { word: 'Improve', transcription: '[ɪmˈpruːv]', translation: 'улучшать', example: 'Practice helps improve your skills.' },
      { word: 'Inspire', transcription: '[ɪnˈspaɪə]', translation: 'вдохновлять', example: 'Her stories inspire everyone.' }
    ];

    defaultPairs.forEach(dp => {
      if (allWords.length < targetCount && !allWords.some(x => x.word.toLowerCase() === dp.word.toLowerCase())) {
        allWords.push({ ...dp });
      }
    });

    // Determine the latest conducted lesson words
    const wordsWithLesson = allWords.filter(w => w.monthNumber && w.lessonNumber);
    let latestLessonWords = [];
    let otherWords = [];

    if (wordsWithLesson.length > 0) {
      wordsWithLesson.sort((a, b) => {
        if (b.monthNumber !== a.monthNumber) return b.monthNumber - a.monthNumber;
        return b.lessonNumber - a.lessonNumber;
      });

      const maxMonth = wordsWithLesson[0].monthNumber;
      const maxLesson = wordsWithLesson[0].lessonNumber;

      latestLessonWords = wordsWithLesson.filter(w => w.monthNumber === maxMonth && w.lessonNumber === maxLesson);
      otherWords = allWords.filter(w => !(w.monthNumber === maxMonth && w.lessonNumber === maxLesson));
    } else {
      otherWords = allWords;
    }

    // Shuffle helper
    const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

    // Pick from latest lesson first
    let selected = shuffle(latestLessonWords);

    // Backfill with other words if under targetCount
    if (selected.length < targetCount) {
      const remainingNeeded = targetCount - selected.length;
      const shuffledOthers = shuffle(otherWords);
      for (const w of shuffledOthers) {
        if (!selected.some(x => x.word.toLowerCase() === w.word.toLowerCase())) {
          selected.push(w);
          if (selected.length >= targetCount) break;
        }
      }
    }

    return selected.slice(0, targetCount);
  }

  // --- Shop & Staff Goods Management ---
  getShopItems() {
    return this.state.shopItems || [];
  }

  getShopItemById(id) {
    return (this.state.shopItems || []).find(it => it.id === id);
  }

  addShopItem(itemData) {
    const id = 'staff-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const newItem = {
      id,
      name: itemData.name?.trim() || 'Новый товар',
      description: itemData.description?.trim() || '',
      price: Math.max(1, Number(itemData.price) || 100),
      photoUrl: itemData.photoUrl?.trim() || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&auto=format&fit=crop&q=80',
      category: 'staff',
      createdAt: new Date().toISOString()
    };
    if (!this.state.shopItems) this.state.shopItems = [];
    this.state.shopItems.unshift(newItem);
    this.saveState(true);
    return newItem;
  }

  updateShopItem(id, itemData) {
    if (!this.state.shopItems) return null;
    const idx = this.state.shopItems.findIndex(it => it.id === id);
    if (idx !== -1) {
      this.state.shopItems[idx] = {
        ...this.state.shopItems[idx],
        ...itemData,
        price: Math.max(1, Number(itemData.price !== undefined ? itemData.price : this.state.shopItems[idx].price))
      };
      this.saveState(true);
      return this.state.shopItems[idx];
    }
    return null;
  }

  deleteShopItem(id) {
    if (!this.state.shopItems) return;
    this.state.shopItems = this.state.shopItems.filter(it => it.id !== id);
    this.saveState(true);
  }

  // --- Purchase System & Order Refunding ---
  getPurchases(filter = {}) {
    let list = this.state.purchases || [];
    if (filter.studentId) {
      list = list.filter(p => p.studentId === filter.studentId);
    }
    if (filter.teacherId) {
      list = list.filter(p => p.teacherId === filter.teacherId);
    }
    if (filter.status) {
      list = list.filter(p => p.status === filter.status);
    }
    return list;
  }

  makePurchase(studentId, item) {
    const student = this.getStudentById(studentId);
    if (!student) {
      return { success: false, message: 'Ученик не найден в системе' };
    }

    const price = Math.max(0, Number(item.price) || 0);
    const currentBalance = student.totalPoints || 0;

    if (currentBalance < price) {
      return {
        success: false,
        message: `Недостаточно баллов! Стоимость: ${price} ⭐, а на вашем балансе: ${currentBalance} ⭐`
      };
    }

    // Deduct spendable points (lifetimePoints is NOT decreased)
    student.totalPoints = currentBalance - price;

    // Ensure inventory structures exist
    if (!Array.isArray(student.unlockedAvatars)) student.unlockedAvatars = student.avatarUrl ? [student.avatarUrl] : [];
    if (!Array.isArray(student.unlockedFrames)) student.unlockedFrames = ['frame-none'];
    if (!Array.isArray(student.unlockedTitles)) student.unlockedTitles = student.studentTitle ? [student.studentTitle] : [];

    // Apply unlock if customization
    if (item.type === 'avatar') {
      const avatarVal = item.value || item.id;
      if (!student.unlockedAvatars.includes(avatarVal)) {
        student.unlockedAvatars.push(avatarVal);
      }
    } else if (item.type === 'frame') {
      const frameId = item.id;
      if (!student.unlockedFrames.includes(frameId)) {
        student.unlockedFrames.push(frameId);
      }
    } else if (item.type === 'title') {
      const titleText = item.text || item.name;
      if (!student.unlockedTitles.includes(titleText)) {
        student.unlockedTitles.push(titleText);
      }
    }

    const group = this.getGroupById(student.groupId);

    const purchaseRecord = {
      id: 'pur-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      studentId,
      studentName: student.fullName,
      groupId: student.groupId || null,
      groupName: group ? group.name : '—',
      teacherId: group?.teacherId || null,
      type: item.type, // 'avatar' | 'frame' | 'title' | 'staff'
      itemId: item.id || item.value || item.text,
      itemName: item.name || item.text || item.value || 'Товар',
      itemIcon: item.icon || item.photoUrl || item.value || '🛍️',
      price,
      date: new Date().toISOString(),
      status: 'completed'
    };

    if (!this.state.purchases) this.state.purchases = [];
    this.state.purchases.unshift(purchaseRecord);

    this.saveState(true);

    return {
      success: true,
      purchase: purchaseRecord,
      remainingBalance: student.totalPoints,
      message: `Покупка «${purchaseRecord.itemName}» успешно оформлена за ${price} ⭐!`
    };
  }

  cancelPurchase(purchaseId, cancelledBy = 'Преподаватель') {
    if (!this.state.purchases) return { success: false, message: 'Покупки не найдены' };
    const purchase = this.state.purchases.find(p => p.id === purchaseId);
    if (!purchase) {
      return { success: false, message: 'Запись о покупке не найдена' };
    }
    if (purchase.status === 'cancelled') {
      return { success: false, message: 'Эта покупка уже была отменена' };
    }

    const student = this.getStudentById(purchase.studentId);
    if (student) {
      // Refund points without penalty: points are returned to spendable balance, NOT added to lifetimePoints
      student.totalPoints = (student.totalPoints || 0) + purchase.price;

      // Re-lock if customization and revert equipped item if equipped
      if (purchase.type === 'avatar') {
        const val = purchase.itemId;
        student.unlockedAvatars = (student.unlockedAvatars || []).filter(a => a !== val);
        if (student.avatarUrl === val) {
          student.avatarUrl = student.unlockedAvatars[0] || '';
        }
      } else if (purchase.type === 'frame') {
        const val = purchase.itemId;
        student.unlockedFrames = (student.unlockedFrames || []).filter(f => f !== val);
        if (student.avatarFrame === val) {
          student.avatarFrame = 'frame-none';
        }
      } else if (purchase.type === 'title') {
        const val = purchase.itemName;
        student.unlockedTitles = (student.unlockedTitles || []).filter(t => t !== val);
        if (student.studentTitle === val) {
          student.studentTitle = '';
        }
      }
    }

    purchase.status = 'cancelled';
    purchase.cancelledAt = new Date().toISOString();
    purchase.cancelledBy = cancelledBy;

    this.saveState(true);

    return {
      success: true,
      message: `Покупка отменена. ${purchase.price} ⭐ возвращены ученику ${student ? student.fullName : ''} без штрафа!`
    };
  }
}

export const store = new Store();
