/**
 * Main Application Orchestrator - Step Up English
 * Includes Groups, Schedule, Scoring, Login/PIN & QR Auth, and Lesson Plans & Materials
 */

import { store } from './store.js';
import { auth } from './auth.js';
import { modal } from './components/modal.js';
import { toast } from './components/toast.js';
import { onCloudStatusChange } from './api.js';
import { logger } from './utils/logger.js';
import { track, setAnalyticsContext, deviceInfo } from './analytics.js';

// Views
import { AuthView } from './views/authView.js';
import { AdminDashboard } from './views/adminDashboard.js';
import { GroupsView } from './views/groupsView.js';
import { StudentsView } from './views/studentsView.js';
import { TeachersView } from './views/teachersView.js';
import { ScheduleView } from './views/scheduleView.js';
import { ScoringView } from './views/scoringView.js';
import { LessonPlansView } from './views/lessonPlansView.js';
import { TeacherCabinet } from './views/teacherCabinet.js';
import { StudentCabinet } from './views/studentCabinet.js';
import { VocabularyView } from './views/vocabularyView.js';
import { PaymentsView } from './views/paymentsView.js';
import { AttendanceView } from './views/attendanceView.js';
import { GamesView } from './views/gamesView.js';
import { ShopView } from './views/shopView.js';
import { HomeworkView } from './views/homeworkView.js';
import { IrregularVerbsView } from './views/irregularVerbsView.js';
import { SurveyView } from './views/surveyView.js';

export class App {
  constructor() {
    this.checkQrLogin();
    this.currentHash = window.location.hash || '#dashboard';
    this.init();
  }

  checkQrLogin() {
    const hash = window.location.hash || '';
    if (!(hash.startsWith('#qr=') || hash.startsWith('#qr-login='))) return false;
    const token = hash.replace(/^#(qr|qr-login)=/, '');
    if (!token) return false;

    let overlay = document.getElementById('qr-sync-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'qr-sync-overlay';
      overlay.style.cssText = 'position:fixed; inset:0; z-index:99999; background:linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); color:#ffffff; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:24px; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
      overlay.innerHTML = `
        <div style="font-size:3.2rem; margin-bottom:16px;">📸 ➔ ⚡</div>
        <div style="font-size:1.35rem; font-weight:800; margin-bottom:8px;">Вход по QR-коду</div>
        <div style="font-size:0.92rem; opacity:0.85; max-width:320px; line-height:1.45; margin-bottom:24px;">
          Подключение к базе Step Up English и загрузка профиля ученика...
        </div>
        <div style="width:36px; height:36px; border:3px solid rgba(255,255,255,0.25); border-top-color:#ffffff; border-radius:50%; animation:qr-spin 0.8s linear infinite;"></div>
        <style>@keyframes qr-spin { to { transform: rotate(360deg); } }</style>
      `;
      document.body.appendChild(overlay);
    }

    // Remove the token from the address bar right away (it should not stay in history)
    try { history.replaceState(null, '', window.location.pathname + window.location.search + '#login'); } catch (e) { /* ignore */ }

    auth.loginStudentWithQr(token).then(res => {
      try { overlay.remove(); } catch (e) { /* ignore */ }
      if (res.success) {
        toast.success(res.message);
        window.location.hash = '#student-cabinet';
      } else {
        toast.error(res.message || 'Ученик по данному QR-коду не найден. Обратитесь к вашему преподавателю.');
        window.location.hash = '#login';
      }
    });
    return true;
  }

  init() {
    window.app = this;
    modal.init();

    const NO_BACKGROUND_RELOAD_ROUTES = new Set([
      '#games',
      '#vocabulary',
      '#irregular-verbs',
      '#survey',
      '#lesson-plans',
      '#schedule',
      '#homework',
      '#student-cabinet',
      '#teacher-cabinet',
      '#shop',
      '#scoring'
    ]);

    let isUserScrolling = false;
    let scrollDebounceTimer = null;
    window.addEventListener('scroll', () => {
      isUserScrolling = true;
      if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
      scrollDebounceTimer = setTimeout(() => {
        isUserScrolling = false;
      }, 1500);
    }, { passive: true });

    let isUserInteracting = false;
    let touchDebounceTimer = null;
    window.addEventListener('touchstart', () => {
      isUserInteracting = true;
    }, { passive: true });
    window.addEventListener('touchend', () => {
      if (touchDebounceTimer) clearTimeout(touchDebounceTimer);
      touchDebounceTimer = setTimeout(() => {
        isUserInteracting = false;
      }, 1500);
    }, { passive: true });

    // Re-render when store changes
    store.subscribe(() => {
      if (auth.isAuthenticated()) {
        // Always keep badges and header profile up to date smoothly
        this.updateSidebarBadges();
        this.updateMobileBottomBar();
        this.updateHeaderProfile();

        const currentHash = this.currentHash || window.location.hash || '';
        const isInteractiveRoute = NO_BACKGROUND_RELOAD_ROUTES.has(currentHash);
        const hasFocusedInput = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
        const isModalOpen = modal.isOpen || Boolean(document.querySelector('.modal-backdrop.open, #modal-backdrop.open'));

        // Prevent destructive DOM rebuilds during scrolling, touch momentum, reading, or active forms
        if (!isInteractiveRoute && !isUserScrolling && !isUserInteracting && !hasFocusedInput && !isModalOpen) {
          this.renderCurrentView(false);
        }
      }
    });

    // Re-render when auth changes
    auth.subscribe(() => {
      this.updateAppLayout();
      this.updateSidebarNavigation();
      this.updateMobileBottomBar();
      this.updateHeaderProfile();
      this.navigateBasedOnRole();
    });

    // Handle hash route change
    window.addEventListener('hashchange', () => {
      if (this.checkQrLogin()) return;
      this.currentHash = window.location.hash || (auth.isAuthenticated() ? '#dashboard' : '#login');
      track('page_view', { page: this.currentHash.replace(/^#/, '').split(/[?&=]/)[0] });
      this.updateSidebarActiveState();
      this.updateMobileBottomBarActive();
      this.renderCurrentView(true);
    });

    // Analytics: students' events carry their group; a page load with a saved session is a visit
    setAnalyticsContext(() => (auth.isStudent() ? { gid: store.getStudentById(auth.currentStudentId)?.groupId } : {}));
    if (auth.isAuthenticated()) {
      track('app_open', { via: 'resume', ...deviceInfo() });
      track('page_view', { page: (window.location.hash || '#dashboard').replace(/^#/, '').split(/[?&=]/)[0] });
    }

    this.bindHeaderAndSidebarEvents();
    this.updateAppLayout();
    this.updateSidebarNavigation();
    this.updateMobileBottomBar();
    this.updateHeaderProfile();
    this.navigateBasedOnRole();

    // Listen to Firebase cloud synchronization status
    onCloudStatusChange((status, errDetails) => {
      this.updateCloudSyncBadge(status, errDetails);
    });

    const badgeEl = document.getElementById('cloud-sync-indicator');
    if (badgeEl && !badgeEl._hasClickListener) {
      badgeEl._hasClickListener = true;
      badgeEl.style.cursor = 'pointer';
      badgeEl.addEventListener('click', () => {
        const currentStatus = badgeEl.className.replace('cloud-sync-badge', '').trim();
        const currentTitle = badgeEl.getAttribute('title') || '';
        if (currentStatus === 'connected') {
          toast.success('☁️ Сервер подключен! Все устройства синхронизированы в реальном времени.');
        } else if (currentStatus === 'saving') {
          toast.info('⏳ Идет сохранение изменений на сервер...');
        } else {
          toast.warning(`⚡ Статус: Офлайн (локальный кэш). ${currentTitle}`);
        }
      });
    }
  }

  updateCloudSyncBadge(status, errDetails = null) {
    const badge = document.getElementById('cloud-sync-indicator');
    if (!badge) return;

    badge.className = `cloud-sync-badge ${status}`;
    const textEl = badge.querySelector('.cloud-sync-text');
    if (!textEl) return;

    switch (status) {
      case 'connected':
        textEl.textContent = '☁️ Онлайн база';
        badge.title = 'Сервер подключен. Все устройства (ПК, телефоны) синхронизированы в реальном времени.';
        break;
      case 'saving':
        textEl.textContent = '☁️ Сохранение...';
        badge.title = 'Сохранение изменений в облачную базу данных...';
        break;
      case 'connecting':
        textEl.textContent = '☁️ Подключение...';
        badge.title = 'Подключение к серверу...';
        break;
      case 'offline':
      case 'error':
        textEl.textContent = '⚡ Офлайн (кэш)';
        badge.title = errDetails 
          ? `Офлайн / ошибка подключения: ${errDetails}` 
          : 'Работа в локальном режиме. Нажмите для подробностей.';
        break;
      default:
        textEl.textContent = '☁️ Онлайн база';
    }
  }

  updateAppLayout() {
    const sidebar = document.querySelector('.app-sidebar');
    const header = document.querySelector('.top-header');
    const bottomBar = document.getElementById('mobile-bottom-bar');
    const isAuth = auth.isAuthenticated();

    if (sidebar) sidebar.style.display = isAuth ? '' : 'none';
    if (header) header.style.display = isAuth ? '' : 'none';
    if (bottomBar) bottomBar.style.display = isAuth ? '' : 'none';
  }

  navigateBasedOnRole() {
    if (!auth.isAuthenticated()) {
      window.location.hash = '#login';
      this.renderCurrentView(true);
      return;
    }

    const role = auth.getRole();
    if (role === auth.ROLE_STUDENT) {
      window.location.hash = '#student-cabinet';
    } else if (role === auth.ROLE_TEACHER) {
      if (!window.location.hash || window.location.hash === '#login' || window.location.hash === '#dashboard') {
        window.location.hash = '#teacher-cabinet';
      } else {
        this.renderCurrentView(true);
      }
    } else {
      if (window.location.hash === '#student-cabinet' || window.location.hash === '#login') {
        window.location.hash = '#dashboard';
      } else {
        this.renderCurrentView(true);
      }
    }
  }

  updateSidebarNavigation() {
    if (!auth.isAuthenticated()) return;

    const role = auth.getRole();
    const navContainer = document.getElementById('sidebar-nav-list');
    if (!navContainer) return;

    let menuHtml = '';

    if (role === auth.ROLE_ADMIN) {
      menuHtml = `
        <div class="nav-section-title">Главное меню</div>
        <a href="#dashboard" class="nav-item ${this.currentHash === '#dashboard' ? 'active' : ''}">
          <span class="nav-item-icon">📊</span>
          <span>Дашборд</span>
        </a>
        <a href="#groups" class="nav-item ${this.currentHash === '#groups' ? 'active' : ''}">
          <span class="nav-item-icon">👥</span>
          <span>Группы</span>
          <span class="nav-item-badge" id="badge-groups-count">${store.getGroups().length}</span>
        </a>
        <a href="#lesson-plans" class="nav-item ${this.currentHash === '#lesson-plans' ? 'active' : ''}">
          <span class="nav-item-icon">📚</span>
          <span>Планы уроков и ДЗ</span>
          <span class="nav-item-badge" id="badge-plans-count">${store.getLessonPlans().length}</span>
        </a>
        <a href="#students" class="nav-item ${this.currentHash === '#students' ? 'active' : ''}">
          <span class="nav-item-icon">🎒</span>
          <span>Ученики</span>
          <span class="nav-item-badge" id="badge-students-count">${store.getStudents().length}</span>
        </a>
        <a href="#teachers" class="nav-item ${this.currentHash === '#teachers' ? 'active' : ''}">
          <span class="nav-item-icon">👨‍🏫</span>
          <span>Преподаватели</span>
          <span class="nav-item-badge" id="badge-teachers-count">${store.getTeachers().length}</span>
        </a>
        <a href="#schedule" class="nav-item ${this.currentHash === '#schedule' ? 'active' : ''}">
          <span class="nav-item-icon">📅</span>
          <span>Расписание</span>
          <span class="nav-item-badge" id="badge-schedule-count">${store.getSchedule().length}</span>
        </a>
        <a href="#vocabulary" class="nav-item ${this.currentHash === '#vocabulary' ? 'active' : ''}">
          <span class="nav-item-icon">📖</span>
          <span>Словарь (Vocabulary)</span>
          <span class="nav-item-badge" id="badge-vocabulary-count">${store.getTotalVocabularyCount()}</span>
        </a>
        <a href="#irregular-verbs" class="nav-item ${this.currentHash === '#irregular-verbs' ? 'active' : ''}">
          <span class="nav-item-icon">📝</span>
          <span>Неправильные глаголы</span>
          <span class="nav-item-badge">200</span>
        </a>
        <a href="#survey" class="nav-item ${this.currentHash === '#survey' ? 'active' : ''}">
          <span class="nav-item-icon">📋</span>
          <span>Анкеты учеников</span>
        </a>
        <a href="#scoring" class="nav-item ${this.currentHash === '#scoring' ? 'active' : ''}">
          <span class="nav-item-icon">⭐</span>
          <span>Баллы и оценки</span>
        </a>
        <a href="#payments" class="nav-item ${this.currentHash === '#payments' ? 'active' : ''}">
          <span class="nav-item-icon">💳</span>
          <span>Оплата обучения</span>
        </a>
        <a href="#attendance" class="nav-item ${this.currentHash === '#attendance' ? 'active' : ''}">
          <span class="nav-item-icon">📅</span>
          <span>Посещаемость</span>
        </a>
        <a href="#games" class="nav-item ${this.currentHash === '#games' ? 'active' : ''}">
          <span class="nav-item-icon">🎮</span>
          <span>Мини-игры</span>
        </a>
        <a href="#shop" class="nav-item ${this.currentHash === '#shop' ? 'active' : ''}">
          <span class="nav-item-icon">🛍️</span>
          <span>Магазин</span>
        </a>
      `;
    } else if (role === auth.ROLE_TEACHER) {
      menuHtml = `
        <div class="nav-section-title">Кабинет Учителя</div>
        <a href="#teacher-cabinet" class="nav-item ${this.currentHash === '#teacher-cabinet' ? 'active' : ''}">
          <span class="nav-item-icon">👨‍🏫</span>
          <span>Мой кабинет</span>
        </a>
        <a href="#lesson-plans" class="nav-item ${this.currentHash === '#lesson-plans' ? 'active' : ''}">
          <span class="nav-item-icon">📚</span>
          <span>Планы уроков и ДЗ</span>
          <span class="nav-item-badge" id="badge-plans-count">${store.getLessonPlans().length}</span>
        </a>
        <a href="#groups" class="nav-item ${this.currentHash === '#groups' ? 'active' : ''}">
          <span class="nav-item-icon">👥</span>
          <span>Мои группы</span>
        </a>
        <a href="#schedule" class="nav-item ${this.currentHash === '#schedule' ? 'active' : ''}">
          <span class="nav-item-icon">📅</span>
          <span>Мое расписание</span>
        </a>
        <a href="#students" class="nav-item ${this.currentHash === '#students' ? 'active' : ''}">
          <span class="nav-item-icon">🎒</span>
          <span>Список учеников</span>
        </a>
        <a href="#vocabulary" class="nav-item ${this.currentHash === '#vocabulary' ? 'active' : ''}">
          <span class="nav-item-icon">📖</span>
          <span>Словарь (Vocabulary)</span>
          <span class="nav-item-badge" id="badge-vocabulary-count">${store.getTotalVocabularyCount()}</span>
        </a>
        <a href="#irregular-verbs" class="nav-item ${this.currentHash === '#irregular-verbs' ? 'active' : ''}">
          <span class="nav-item-icon">📝</span>
          <span>Неправильные глаголы</span>
          <span class="nav-item-badge">200</span>
        </a>
        <a href="#survey" class="nav-item ${this.currentHash === '#survey' ? 'active' : ''}">
          <span class="nav-item-icon">📋</span>
          <span>Анкеты учеников</span>
        </a>
        <a href="#payments" class="nav-item ${this.currentHash === '#payments' ? 'active' : ''}">
          <span class="nav-item-icon">💳</span>
          <span>Оплата обучения</span>
        </a>
        <a href="#attendance" class="nav-item ${this.currentHash === '#attendance' ? 'active' : ''}">
          <span class="nav-item-icon">📅</span>
          <span>Посещаемость</span>
        </a>
        <a href="#scoring" class="nav-item ${this.currentHash === '#scoring' ? 'active' : ''}">
          <span class="nav-item-icon">⭐</span>
          <span>Оценить ученика</span>
        </a>
        <a href="#games" class="nav-item ${this.currentHash === '#games' ? 'active' : ''}">
          <span class="nav-item-icon">🎮</span>
          <span>Мини-игры</span>
        </a>
        <a href="#shop" class="nav-item ${this.currentHash === '#shop' ? 'active' : ''}">
          <span class="nav-item-icon">🛍️</span>
          <span>Магазин</span>
        </a>
      `;
    } else if (role === auth.ROLE_STUDENT) {
      const studentId = auth.currentStudentId || auth.getCurrentUser()?.id;
      const studentVocabCount = store.getTotalVocabularyCountForStudent(studentId);
      menuHtml = `
        <div class="nav-section-title">Кабинет Ученика</div>
        <a href="#student-cabinet" class="nav-item ${this.currentHash === '#student-cabinet' ? 'active' : ''}">
          <span class="nav-item-icon">🎓</span>
          <span>Главный кабинет</span>
        </a>
        <a href="#survey" class="nav-item ${this.currentHash === '#survey' ? 'active' : ''}">
          <span class="nav-item-icon">📋</span>
          <span>Анкета ученика</span>
          <span class="nav-item-badge" style="background:#10b981; color:white; font-weight:700;">+200 ⭐</span>
        </a>
        <a href="#homework" class="nav-item ${this.currentHash === '#homework' ? 'active' : ''}">
          <span class="nav-item-icon">📚</span>
          <span>Домашнее задание</span>
        </a>
        <a href="#vocabulary" class="nav-item ${this.currentHash === '#vocabulary' ? 'active' : ''}">
          <span class="nav-item-icon">📖</span>
          <span>Словарь (Vocabulary)</span>
          <span class="nav-item-badge" id="badge-student-vocab-count">${studentVocabCount}</span>
        </a>
        <a href="#irregular-verbs" class="nav-item ${this.currentHash === '#irregular-verbs' ? 'active' : ''}">
          <span class="nav-item-icon">📝</span>
          <span>Неправильные глаголы</span>
          <span class="nav-item-badge">200</span>
        </a>
        <a href="#games" class="nav-item ${this.currentHash === '#games' ? 'active' : ''}">
          <span class="nav-item-icon">🎮</span>
          <span>Мини-игры</span>
        </a>
        <a href="#shop" class="nav-item ${this.currentHash === '#shop' ? 'active' : ''}">
          <span class="nav-item-icon">🛍️</span>
          <span>Магазин бонусов</span>
        </a>
      `;
    }

    // Common exit item at the bottom of navigation
    menuHtml += `
      <div style="margin-top:auto; padding-top:var(--space-3); border-top:1px solid rgba(255,255,255,0.08);">
        <a href="javascript:void(0)" class="nav-item btn-app-logout" style="color:#f87171;" title="Выйти на главный экран входа">
          <span class="nav-item-icon">🚪</span>
          <span style="font-weight:600;">Выход на главный экран</span>
        </a>
      </div>
    `;

    navContainer.innerHTML = menuHtml;
    this.updateSidebarActiveState();
  }

  updateMobileBottomBar() {
    if (!auth.isAuthenticated()) return;

    const role = auth.getRole();
    const bottomContainer = document.getElementById('mobile-bottom-bar');
    if (!bottomContainer) return;

    let barHtml = '';

    if (role === auth.ROLE_ADMIN) {
      barHtml = `
        <a href="#dashboard" class="mobile-bottom-item ${this.currentHash === '#dashboard' ? 'active' : ''}">
          <span class="bottom-icon">📊</span>
          <span>Дашборд</span>
        </a>
        <a href="#lesson-plans" class="mobile-bottom-item ${this.currentHash === '#lesson-plans' ? 'active' : ''}">
          <span class="bottom-icon">📚</span>
          <span>Уроки/ДЗ</span>
        </a>
        <a href="#groups" class="mobile-bottom-item ${this.currentHash === '#groups' ? 'active' : ''}">
          <span class="bottom-icon">👥</span>
          <span>Группы</span>
        </a>
        <a href="#students" class="mobile-bottom-item ${this.currentHash === '#students' ? 'active' : ''}">
          <span class="bottom-icon">🎒</span>
          <span>Ученики</span>
        </a>
        <a href="#irregular-verbs" class="mobile-bottom-item ${this.currentHash === '#irregular-verbs' ? 'active' : ''}">
          <span class="bottom-icon">📝</span>
          <span>Непр. глаголы</span>
        </a>
        <button type="button" class="mobile-bottom-item" id="btn-mobile-more" title="Все разделы">
          <span class="bottom-icon">☰</span>
          <span>Меню</span>
        </button>
      `;
    } else if (role === auth.ROLE_TEACHER) {
      barHtml = `
        <a href="#teacher-cabinet" class="mobile-bottom-item ${this.currentHash === '#teacher-cabinet' ? 'active' : ''}">
          <span class="bottom-icon">👨‍🏫</span>
          <span>Кабинет</span>
        </a>
        <a href="#lesson-plans" class="mobile-bottom-item ${this.currentHash === '#lesson-plans' ? 'active' : ''}">
          <span class="bottom-icon">📚</span>
          <span>Уроки/ДЗ</span>
        </a>
        <a href="#schedule" class="mobile-bottom-item ${this.currentHash === '#schedule' ? 'active' : ''}">
          <span class="bottom-icon">📅</span>
          <span>Расписание</span>
        </a>
        <a href="#students" class="mobile-bottom-item ${this.currentHash === '#students' ? 'active' : ''}">
          <span class="bottom-icon">🎒</span>
          <span>Ученики</span>
        </a>
        <a href="#irregular-verbs" class="mobile-bottom-item ${this.currentHash === '#irregular-verbs' ? 'active' : ''}">
          <span class="bottom-icon">📝</span>
          <span>Непр. глаголы</span>
        </a>
        <button type="button" class="mobile-bottom-item" id="btn-mobile-more" title="Все разделы">
          <span class="bottom-icon">☰</span>
          <span>Меню</span>
        </button>
      `;
    } else if (role === auth.ROLE_STUDENT) {
      barHtml = `
        <a href="#student-cabinet" class="mobile-bottom-item ${this.currentHash === '#student-cabinet' ? 'active' : ''}">
          <span class="bottom-icon">🎓</span>
          <span>Кабинет</span>
        </a>
        <a href="#homework" class="mobile-bottom-item ${this.currentHash === '#homework' ? 'active' : ''}">
          <span class="bottom-icon">📚</span>
          <span>Домашка</span>
        </a>
        <a href="#shop" class="mobile-bottom-item ${this.currentHash === '#shop' ? 'active' : ''}">
          <span class="bottom-icon">🛍️</span>
          <span>Магазин</span>
        </a>
        <a href="#games" class="mobile-bottom-item ${this.currentHash === '#games' ? 'active' : ''}">
          <span class="bottom-icon">🎮</span>
          <span>Мини-игры</span>
        </a>
        <a href="#irregular-verbs" class="mobile-bottom-item ${this.currentHash === '#irregular-verbs' ? 'active' : ''}">
          <span class="bottom-icon">📝</span>
          <span>Непр. глаголы</span>
        </a>
        <button type="button" class="mobile-bottom-item" id="btn-mobile-more" title="Все разделы">
          <span class="bottom-icon">☰</span>
          <span>Меню</span>
        </button>
      `;
    }

    bottomContainer.innerHTML = barHtml;
    this.updateMobileBottomBarActive();
  }

  updateMobileBottomBarActive() {
    document.querySelectorAll('.mobile-bottom-bar .mobile-bottom-item').forEach(item => {
      const href = item.getAttribute('href');
      if (href && href === this.currentHash) {
        item.classList.add('active');
      } else if (href) {
        item.classList.remove('active');
      }
    });
  }

  updateSidebarActiveState() {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
      const href = item.getAttribute('href');
      if (href === this.currentHash) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  updateSidebarBadges() {
    const badgeGroups = document.getElementById('badge-groups-count');
    const badgeStudents = document.getElementById('badge-students-count');
    const badgeTeachers = document.getElementById('badge-teachers-count');
    const badgeSchedule = document.getElementById('badge-schedule-count');
    const badgePlans = document.getElementById('badge-plans-count');
    const badgeVocab = document.getElementById('badge-vocabulary-count');
    const badgeStudentVocab = document.getElementById('badge-student-vocab-count');

    if (badgeGroups) badgeGroups.textContent = store.getGroups().length;
    if (badgeStudents) badgeStudents.textContent = store.getStudents().length;
    if (badgeTeachers) badgeTeachers.textContent = store.getTeachers().length;
    if (badgeSchedule) badgeSchedule.textContent = store.getSchedule().length;
    if (badgePlans) badgePlans.textContent = store.getLessonPlans().length;
    if (badgeVocab) badgeVocab.textContent = store.getTotalVocabularyCount();
    if (badgeStudentVocab) {
      const studentId = auth.currentStudentId || auth.getCurrentUser()?.id;
      badgeStudentVocab.textContent = store.getTotalVocabularyCountForStudent(studentId);
    }
  }

  updateHeaderProfile() {
    if (!auth.isAuthenticated()) return;

    const user = auth.getCurrentUser();
    const role = auth.getRole();

    const nameEl = document.getElementById('header-user-name');
    const roleEl = document.getElementById('header-user-role');
    const avatarEl = document.getElementById('header-user-avatar');
    const sidebarRoleBadge = document.getElementById('sidebar-role-badge');

    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) {
      if (role === 'student' && user.studentTitle) {
        roleEl.textContent = `${user.studentTitle} • ${user.roleLabel}`;
      } else {
        roleEl.textContent = user.roleLabel;
      }
    }
    if (avatarEl) {
      if (role === 'student' && user.avatarUrl) {
        if (user.avatarUrl.startsWith('http://') || user.avatarUrl.startsWith('https://') || user.avatarUrl.startsWith('/') || user.avatarUrl.startsWith('data:image')) {
          avatarEl.innerHTML = `<img src="${user.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />`;
        } else {
          avatarEl.innerHTML = `<span style="font-size:1.15rem;line-height:1;">${user.avatarUrl}</span>`;
        }
      } else {
        avatarEl.textContent = user.initials;
      }
      avatarEl.style.backgroundColor = user.avatarColor || '#4f46e5';
    }

    if (sidebarRoleBadge) {
      sidebarRoleBadge.textContent = role === 'admin' ? 'Администратор' : role === 'teacher' ? 'Учитель' : 'Ученик';
    }


  }

  bindHeaderAndSidebarEvents() {
    const toggleBtn = document.getElementById('btn-toggle-sidebar');
    const sidebar = document.querySelector('.app-sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');

    const closeSidebar = () => {
      sidebar?.classList.remove('open');
      backdrop?.classList.remove('open');
    };

    const toggleSidebar = () => {
      sidebar?.classList.toggle('open');
      backdrop?.classList.toggle('open');
    };

    toggleBtn?.addEventListener('click', toggleSidebar);
    backdrop?.addEventListener('click', closeSidebar);

    // Bottom bar 'More/Menu' button delegation
    document.addEventListener('click', (e) => {
      const moreBtn = e.target.closest('#btn-mobile-more');
      if (moreBtn) {
        e.preventDefault();
        toggleSidebar();
      }
      // Auto-close sidebar on mobile when navigating
      const navLink = e.target.closest('.sidebar-nav .nav-item');
      if (navLink && window.innerWidth <= 900) {
        closeSidebar();
      }
    });

    // Global Delegated Logout button handler
    document.addEventListener('click', (e) => {
      const logoutBtn = e.target.closest('.btn-app-logout');
      if (logoutBtn) {
        e.preventDefault();
        closeSidebar();
        auth.logout().then((done) => {
          if (!done) return;
          toast.info('Вы вышли на главный экран');
          window.location.hash = '#login';
        });
      }
    });


    const globalSearch = document.getElementById('global-search-input');
    globalSearch?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = e.target.value.trim();
        if (q) {
          window.location.hash = '#students';
          setTimeout(() => {
            const input = document.getElementById('input-student-search');
            if (input) {
              input.value = q;
              input.dispatchEvent(new Event('input'));
            }
          }, 50);
        }
      }
    });
  }

  renderCurrentView(isNavigation = false) {
    const container = document.getElementById('main-view-container');
    if (!container) return;

    // Save scroll position if this is an internal/store update (not a deliberate route navigation)
    const prevScrollY = !isNavigation ? window.scrollY : 0;

    if (!auth.isAuthenticated() || this.currentHash === '#login') {
      this.updateAppLayout();
      AuthView.render(container);
      if (isNavigation) window.scrollTo(0, 0);
      return;
    }

    this.updateAppLayout();
    const role = auth.getRole();
    const hash = this.currentHash;

    // First data load after login / page open: show a loader instead of empty screens
    if (!store.isReady()) {
      container.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:50vh; gap:14px; color:var(--color-text-muted);">
          <div style="width:34px; height:34px; border:3px solid var(--color-border, #e2e8f0); border-top-color:var(--color-primary, #4f46e5); border-radius:50%; animation:qr-spin 0.8s linear infinite;"></div>
          <div style="font-weight:600;">Загрузка данных школы...</div>
          <style>@keyframes qr-spin { to { transform: rotate(360deg); } }</style>
        </div>`;
      if (!this._waitingForData) {
        this._waitingForData = true;
        store.whenReady().then(() => {
          this._waitingForData = false;
          this.updateSidebarNavigation();
          this.updateHeaderProfile();
          this.renderCurrentView(true);
        });
      }
      return;
    }

    // Student routing
    if (role === auth.ROLE_STUDENT) {
      if (hash === '#homework') {
        HomeworkView.render(container);
      } else if (hash === '#vocabulary') {
        VocabularyView.render(container);
      } else if (hash === '#irregular-verbs') {
        IrregularVerbsView.render(container);
      } else if (hash === '#games') {
        GamesView.render(container);
      } else if (hash === '#shop') {
        ShopView.render(container);
      } else if (hash === '#survey') {
        SurveyView.render(container);
      } else {
        StudentCabinet.render(container);
      }
    } else if (role === auth.ROLE_TEACHER && (hash === '#teacher-cabinet' || hash === '#dashboard')) {
      // Teacher specific landing
      TeacherCabinet.render(container);
    } else {
      // Route dispatching
      switch (hash) {
        case '#dashboard':
          AdminDashboard.render(container);
          break;
        case '#homework':
          HomeworkView.render(container);
          break;
        case '#groups':
          GroupsView.render(container);
          break;
        case '#lesson-plans':
          LessonPlansView.render(container);
          break;
        case '#students':
          StudentsView.render(container);
          break;
        case '#teachers':
          TeachersView.render(container);
          break;
        case '#schedule':
          ScheduleView.render(container);
          break;
        case '#vocabulary':
          VocabularyView.render(container);
          break;
        case '#irregular-verbs':
          IrregularVerbsView.render(container);
          break;
        case '#survey':
          SurveyView.render(container);
          break;
        case '#games':
          GamesView.render(container);
          break;
        case '#shop':
          ShopView.render(container);
          break;
        case '#scoring':
          ScoringView.render(container);
          break;
        case '#teacher-cabinet':
          TeacherCabinet.render(container);
          break;
        case '#student-cabinet':
          StudentCabinet.render(container);
          break;
        case '#payments':
          PaymentsView.render(container);
          break;
        case '#attendance':
          AttendanceView.render(container);
          break;
        default:
          AdminDashboard.render(container);
          break;
      }
    }

    if (isNavigation) {
      window.scrollTo(0, 0);
    } else if (prevScrollY > 0) {
      requestAnimationFrame(() => {
        window.scrollTo(0, prevScrollY);
      });
    }
  }
}

// Start application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.AppInstance = new App();
});
