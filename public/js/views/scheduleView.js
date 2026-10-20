/**
 * Modern Interactive Weekly Schedule View & Vacation Controls
 * Replaces old yearly 80-lesson matrix with clean weekly grid, recurrence engine & vacation pause.
 * Matches screenshots:
 * 1. Weekly Grid with 5:00-23:00 hours, pastel cards, Sunday pink pill, red current time line, + Add slot
 * 2. "Урок" modal with Group selection, Duration, Date & Time picker, Status & Action buttons
 * 3. "Изменение урока" recurrence dialog ("Повторяющиеся" vs "Только этот")
 */

import { store, RUSSIAN_DAYS, RUSSIAN_DAYS_SHORT } from '../store.js';
import { auth } from '../auth.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { openAttendanceModal } from '../components/attendanceModal.js';

export const ScheduleView = {
  currentMonday: null,
  filterTeacher: 'all',
  filterGroup: 'all',
  startHour: 7,
  endHour: 20,
  hourRowHeight: 52,

  initMonday() {
    if (!this.currentMonday) {
      const now = new Date();
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const m = new Date(now);
      m.setDate(diff);
      m.setHours(0, 0, 0, 0);
      this.currentMonday = m;
    }
    return this.currentMonday;
  },

  getMondayDate() {
    return this.initMonday();
  },

  nextWeek() {
    const m = new Date(this.getMondayDate());
    m.setDate(m.getDate() + 7);
    this.currentMonday = m;
  },

  prevWeek() {
    const m = new Date(this.getMondayDate());
    m.setDate(m.getDate() - 7);
    this.currentMonday = m;
  },

  resetToToday() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const m = new Date(now);
    m.setDate(diff);
    m.setHours(0, 0, 0, 0);
    this.currentMonday = m;
  },

  formatWeekRangeTitle(mondayDate) {
    const monthsRu = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ];
    const mon = new Date(mondayDate);
    const sun = new Date(mondayDate);
    sun.setDate(mon.getDate() + 6);

    const monD = mon.getDate();
    const monM = monthsRu[mon.getMonth()];
    const sunD = sun.getDate();
    const sunM = monthsRu[sun.getMonth()];
    const year = sun.getFullYear();

    if (mon.getMonth() === sun.getMonth()) {
      return `${monD} — ${sunD} ${sunM} ${year}`;
    }
    return `${monD} ${monM} — ${sunD} ${sunM} ${year}`;
  },

  render(container) {
    this.container = container;
    const isAdmin = auth.isAdmin();
    const isTeacher = auth.isTeacher();
    const currentUser = auth.getCurrentUser();
    const teachers = store.getTeachers();
    const groups = store.getGroups();

    if (isTeacher && this.filterTeacher === 'all' && currentUser?.id) {
      this.filterTeacher = currentUser.id;
    }

    const monday = this.getMondayDate();
    const rangeTitle = this.formatWeekRangeTitle(monday);
    const isVacation = store.isVacation();

    container.innerHTML = `
      <div class="section-header">
        <div class="section-title-wrap">
          <h1>📅 Расписание занятий</h1>
          <p>Интерактивная недельная сетка уроков, автоматическое продление на следующие недели и управление каникулами</p>
        </div>
        <div class="section-actions" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <button type="button" class="btn btn-vacation-toggle ${isVacation ? 'status-vacation' : 'status-study'}" id="btn-schedule-vacation-toggle">
            ${isVacation ? '🎓 Выход на учёбу' : '🏖️ Выход на каникулы'}
          </button>
          <button type="button" class="btn btn-primary" id="btn-schedule-add-lesson">
            ➕ Добавить урок
          </button>
        </div>
      </div>

      <!-- Schedule Wrapper Card -->
      <div class="weekly-schedule-wrapper">
        <!-- Vacation Status Banner if active -->
        ${isVacation ? `
          <div class="schedule-vacation-banner">
            <div style="display:flex; align-items:center; gap:12px;">
              <span style="font-size:1.8rem;">🏖️</span>
              <div>
                <div class="vacation-title">Школа на каникулах — регулярные занятия приостановлены</div>
                <div class="vacation-desc">Уроки временно заморожены. Для возобновления занятий нажмите «🎓 Выход на учёбу».</div>
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-success btn-resume-school-trigger" style="font-weight:700;">
              🎓 Возобновить занятия
            </button>
          </div>
        ` : ''}

        <!-- Toolbar with Navigation & Filters -->
        <div class="weekly-schedule-toolbar">
          <div class="weekly-nav-controls">
            <button type="button" class="weekly-nav-btn" id="btn-week-prev" title="Предыдущая неделя">◀</button>
            <button type="button" class="weekly-nav-btn" id="btn-week-today" title="Текущая неделя">Сегодня</button>
            <button type="button" class="weekly-nav-btn" id="btn-week-next" title="Следующая неделя">▶</button>
            <span class="weekly-range-title">${rangeTitle}</span>
          </div>

          <div class="weekly-actions-group">
            <div style="display:flex; align-items:center; gap:6px;">
              <label class="form-label text-xs" style="margin:0; font-weight:700;">Группа:</label>
              <select id="filter-weekly-group" class="form-control form-control-sm" style="font-weight:600; min-width:170px;">
                <option value="all" ${this.filterGroup === 'all' ? 'selected' : ''}>🌐 Все группы</option>
                ${groups.map(g => `<option value="${g.id}" ${this.filterGroup === g.id ? 'selected' : ''}>👥 ${g.name}</option>`).join('')}
              </select>
            </div>

            ${isAdmin ? `
              <div style="display:flex; align-items:center; gap:6px;">
                <label class="form-label text-xs" style="margin:0; font-weight:700;">Учитель:</label>
                <select id="filter-weekly-teacher" class="form-control form-control-sm" style="font-weight:600; min-width:160px;">
                  <option value="all" ${this.filterTeacher === 'all' ? 'selected' : ''}>Все учителя</option>
                  ${teachers.map(t => `<option value="${t.id}" ${this.filterTeacher === t.id ? 'selected' : ''}>${t.fullName}</option>`).join('')}
                </select>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Weekly Interactive Calendar Grid Container -->
        <div class="weekly-grid-container-mount" id="weekly-grid-mount">
          ${this.renderWeeklyGridHtml()}
        </div>
      </div>
    `;

    this.bindEvents(container);
    this.scrollToActiveHour();
  },

  /**
   * Generates the weekly calendar grid HTML according to Screenshot 1
   */
  renderWeeklyGridHtml(customFilter = {}) {
    const monday = this.getMondayDate();
    const effectiveFilter = {
      teacherId: customFilter.teacherId || (this.filterTeacher !== 'all' ? this.filterTeacher : null),
      groupId: customFilter.groupId || (this.filterGroup !== 'all' ? this.filterGroup : null),
      status: customFilter.status || (this.filterStatus !== 'all' ? this.filterStatus : null)
    };

    const weekData = store.getWeekSchedule(monday, effectiveFilter);
    const weekDays = weekData.weekDays;
    const lessons = weekData.lessons;

    // Check if current real-world date is in this week
    const now = new Date();
    const todayYYYYMMDD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayIndex = weekDays.findIndex(w => w.dateStr === todayYYYYMMDD);
    const nowMinutesTotal = now.getHours() * 60 + now.getMinutes();
    const isNowVisible = todayIndex !== -1 && now.getHours() >= this.startHour && now.getHours() <= this.endHour;
    const nowTopPx = isNowVisible ? ((now.getHours() - this.startHour) + (now.getMinutes() / 60)) * this.hourRowHeight : -999;

    let timeGutterHtml = '';
    for (let h = this.startHour; h <= this.endHour; h++) {
      timeGutterHtml += `<div class="weekly-hour-label">${h}:00</div>`;
    }

    // Generate day columns with hour slots & lesson cards
    let dayColumnsHtml = '';
    weekDays.forEach((day, dayIdx) => {
      const isToday = day.dateStr === todayYYYYMMDD;
      let slotsHtml = '';

      for (let h = this.startHour; h <= this.endHour; h++) {
        slotsHtml += `
          <div class="weekly-hour-slot" data-day-index="${day.dayIndex}" data-date="${day.dateStr}" data-hour="${h}">
            <span class="weekly-slot-add-btn">➕ Добавить</span>
          </div>
        `;
      }

      // Filter lessons for this day
      const dayLessons = lessons.filter(l => l.dayIndex === day.dayIndex);
      let cardsHtml = '';

      dayLessons.forEach(l => {
        let [sH, sM] = (l.startTime || '10:00').split(':').map(n => parseInt(n, 10) || 0);
        let durationMin = l.duration || 60;

        // Position calculations
        let topPx = ((sH - this.startHour) + (sM / 60)) * this.hourRowHeight;
        let heightPx = Math.max(34, (durationMin / 60) * this.hourRowHeight - 4);

        if (topPx < 0) topPx = 0;

        // Group avatar initials / icon
        let groupName = l.groupName || (l.group ? l.group.name : 'Группа');
        let avatarInitial = groupName.trim()[0] || 'G';
        if (l.group && l.group.name) {
          const parts = l.group.name.split(' ');
          avatarInitial = parts[0][0] + (parts[1] ? parts[1][0] : '');
        }

        // Color styles matching Screenshot 1
        const bgColor = l.color || '#bbf7d0';
        const isVacationPaused = l.isVacationPaused;

        cardsHtml += `
          <div class="weekly-lesson-card ${isVacationPaused ? 'vacation-paused' : ''}"
               data-lesson-id="${l.baseId || l.id}"
               data-group-id="${l.groupId || ''}"
               data-day-index="${day.dayIndex}"
               data-date="${day.dateStr}"
               style="top: ${topPx}px; height: ${heightPx}px; background-color: ${bgColor}; border: 1.5px solid rgba(0,0,0,0.12);"
               title="${groupName} (${l.time})">
            <div class="weekly-card-avatar" style="background: rgba(0,0,0,0.15); color: #1e293b;">
              ${avatarInitial}
            </div>
            <div class="weekly-card-content">
              <div class="weekly-card-title" style="color: #0f172a;">
                ${groupName}
              </div>
              <div class="weekly-card-time" style="color: #334155;">
                ${l.time} ${isVacationPaused ? '• 🏖️ Каникулы' : l.actualStatus === 'completed' ? '• ✓ Проведен' : ''}
              </div>
            </div>
          </div>
        `;
      });

      // Red current time line inside today's column if active
      let todayLineHtml = '';
      if (isToday && isNowVisible) {
        todayLineHtml = `
          <div class="weekly-current-time-line" style="top: ${nowTopPx}px;">
            <span class="weekly-current-time-dot"></span>
          </div>
        `;
      }

      dayColumnsHtml += `
        <div class="weekly-day-col ${isToday ? 'is-today-col' : ''}" data-day-index="${day.dayIndex}">
          ${todayLineHtml}
          ${slotsHtml}
          ${cardsHtml}
        </div>
      `;
    });

    return `
      <div class="weekly-grid-scroll" id="weekly-scroll-viewport">
        <div class="weekly-grid-table">
          <!-- Top Day Headers: Gutter + 7 Days -->
          <div class="weekly-days-header-row">
            <div class="weekly-gutter-header"></div>
            ${weekDays.map(w => {
              const isToday = w.dateStr === todayYYYYMMDD;
              return `
                <div class="weekly-day-header-cell ${isToday ? 'is-today' : ''}">
                  ${w.isSunday ? `
                    <span class="sunday-pill-badge">${w.dayShort}, ${w.dayNumber}</span>
                  ` : isToday ? `
                    <span class="today-pill-badge">${w.dayShort}, ${w.dayNumber}</span>
                  ` : `
                    <span>${w.dayShort}, ${w.dayNumber}</span>
                  `}
                </div>
              `;
            }).join('')}
          </div>

          <!-- Time Gutter -->
          <div class="weekly-time-gutter-col">
            ${timeGutterHtml}
          </div>

          <!-- 7 Day Columns with Slots & Cards -->
          ${dayColumnsHtml}
        </div>
      </div>
    `;
  },

  scrollToActiveHour() {
    setTimeout(() => {
      const scrollEl = document.getElementById('weekly-scroll-viewport');
      if (scrollEl) {
        scrollEl.scrollTop = 0;
      }
    }, 50);
  },

  bindEvents(container) {
    // Week navigation
    const btnPrev = container.querySelector('#btn-week-prev');
    const btnNext = container.querySelector('#btn-week-next');
    const btnToday = container.querySelector('#btn-week-today');

    if (btnPrev) btnPrev.addEventListener('click', () => { this.prevWeek(); this.render(container); });
    if (btnNext) btnNext.addEventListener('click', () => { this.nextWeek(); this.render(container); });
    if (btnToday) btnToday.addEventListener('click', () => { this.resetToToday(); this.render(container); });

    // Vacation Toggle
    const btnVacation = container.querySelector('#btn-schedule-vacation-toggle');
    const btnResumeSchool = container.querySelector('.btn-resume-school-trigger');

    if (btnVacation) {
      btnVacation.addEventListener('click', () => this.handleVacationToggle(container));
    }
    if (btnResumeSchool) {
      btnResumeSchool.addEventListener('click', () => this.handleVacationToggle(container));
    }

    // Filter Group & Teacher
    const filterGroupEl = container.querySelector('#filter-weekly-group');
    if (filterGroupEl) {
      filterGroupEl.addEventListener('change', (e) => {
        this.filterGroup = e.target.value;
        this.render(container);
      });
    }

    const filterTeacherEl = container.querySelector('#filter-weekly-teacher');
    if (filterTeacherEl) {
      filterTeacherEl.addEventListener('change', (e) => {
        this.filterTeacher = e.target.value;
        this.render(container);
      });
    }

    // Add Lesson Button
    const btnAddLesson = container.querySelector('#btn-schedule-add-lesson');
    if (btnAddLesson) {
      btnAddLesson.addEventListener('click', () => {
        const monday = this.getMondayDate();
        const monYYYYMMDD = monday.toISOString().split('T')[0];
        this.openLessonModal(null, 1, 10, monYYYYMMDD);
      });
    }

    // Click on Empty Slot (+ Добавить)
    const mountEl = container.querySelector('#weekly-grid-mount');
    if (mountEl) {
      mountEl.addEventListener('click', (e) => {
        const cardEl = e.target.closest('.weekly-lesson-card');
        if (cardEl) {
          const lessonId = cardEl.dataset.lessonId;
          const lessonDate = cardEl.dataset.date;
          const cardDayIdx = parseInt(cardEl.dataset.dayIndex, 10) || 1;
          let lesson = store.getLessonById(lessonId);
          if (!lesson) {
            lesson = (store.state.schedule || []).find(s => s.id === lessonId || (s.groupId === cardEl.dataset.groupId && s.dayIndex === cardDayIdx));
          }
          if (lesson) {
            this.openLessonModal(lesson, lesson.dayIndex || cardDayIdx, parseInt(lesson.startTime, 10) || 10, lessonDate);
          }
          return;
        }

        const slotEl = e.target.closest('.weekly-hour-slot');
        if (slotEl) {
          const dayIdx = parseInt(slotEl.dataset.dayIndex, 10) || 1;
          const dateStr = slotEl.dataset.date;
          const hour = parseInt(slotEl.dataset.hour, 10) || 10;
          this.openLessonModal(null, dayIdx, hour, dateStr);
        }
      });
    }
  },

  handleVacationToggle(container) {
    const isCurrentlyVacation = store.isVacation();
    if (!isCurrentlyVacation) {
      modal.confirm({
        title: '🏖️ Выход на каникулы',
        message: 'При выходе на каникулы регулярные занятия будут временно приостановлены. Расписание возобновится при нажатии «Выход на учёбу». Продолжить?',
        confirmText: 'Да, объявить каникулы',
        onConfirm: () => {
          store.setVacationMode(true);
          toast.success('🏖️ Объявлены каникулы. Регулярные уроки приостановлены.');
          if (container) this.render(container);
        }
      });
    } else {
      store.setVacationMode(false);
      toast.success('🎓 Каникулы завершены! Занятия возобновлены по регулярному расписанию.');
      if (container) this.render(container);
    }
  },

  /**
   * Refreshes the active schedule grid without full-page reloads
   */
  refresh() {
    if (this.container && document.getElementById('weekly-grid-mount')) {
      this.render(this.container);
      return;
    }
    const cabMount = document.getElementById('cabinet-weekly-grid-mount');
    if (cabMount) {
      const user = auth.getCurrentUser();
      const teacher = store.getTeachers().find(t => t.id === user?.id) || store.getTeachers()[0];
      cabMount.innerHTML = this.renderWeeklyGridHtml({ teacherId: teacher?.id });
      this.scrollToActiveHour();
      return;
    }
    const mainContainer = document.getElementById('main-view-container');
    if (mainContainer) {
      if (window.location.hash === '#teacher-cabinet') {
        TeacherCabinet.render(mainContainer);
      } else {
        this.render(mainContainer);
      }
    }
  },

  /**
   * Opens the Lesson Edit / Create Modal matching Screenshots 2 & 3
   */
  openLessonModal(lesson = null, defaultDayIdx = 1, defaultHour = 10, defaultDateStr = null, onSaved = null) {
    const groups = store.getGroups();
    const isEditing = !!lesson;
    const currentGroupId = lesson ? lesson.groupId : (groups[0]?.id || '');
    const currentGroup = groups.find(g => g.id === currentGroupId) || groups[0] || null;

    const monday = this.getMondayDate();
    const monthsRuShort = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

    const getWeekDateObj = (dayIdx) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + (dayIdx - 1));
      return d;
    };

    const getWeekDateStr = (dayIdx) => {
      const d = getWeekDateObj(dayIdx);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    let initialDayIdx = defaultDayIdx || 1;
    if (lesson?.dayIndex) {
      initialDayIdx = lesson.dayIndex;
    } else if (lesson?.dayOfWeek) {
      const idx = RUSSIAN_DAYS.indexOf(lesson.dayOfWeek);
      if (idx !== -1) initialDayIdx = idx + 1;
    }

    if (defaultDateStr) {
      const dObj = new Date(defaultDateStr);
      if (!isNaN(dObj.getTime())) {
        const dD = dObj.getDay();
        initialDayIdx = dD === 0 ? 7 : dD;
      }
    }

    let initialDateStr = defaultDateStr || lesson?.date || getWeekDateStr(initialDayIdx);

    let startHour = defaultHour;
    let startMin = 0;
    if (lesson?.startTime) {
      const [h, m] = lesson.startTime.split(':').map(n => parseInt(n, 10) || 0);
      startHour = h;
      startMin = m;
    }

    const duration = lesson ? (Number(lesson.duration) || 60) : 60;
    const status = lesson ? (lesson.actualStatus || lesson.status || 'planned') : 'planned';
    const isRecurring = lesson ? (lesson.isRecurring !== false) : true;

    const calcEndTimeStr = (sH, sM, dur) => {
      const totalM = sH * 60 + sM + dur;
      const eH = Math.floor(totalM / 60) % 24;
      const eM = totalM % 60;
      return `${String(eH).padStart(2, '0')}:${String(eM).padStart(2, '0')}`;
    };

    let startHourStr = String(startHour).padStart(2, '0');
    let startMinStr = String(startMin).padStart(2, '0');
    let endCalculated = calcEndTimeStr(startHour, startMin, duration);

    let groupInitials = '👥';
    if (currentGroup) {
      groupInitials = currentGroup.name.split(' ').map(n => n[0]).slice(0, 2).join('');
    }

    const hourOptions = [];
    for (let h = 7; h <= 20; h++) {
      const s = String(h).padStart(2, '0');
      hourOptions.push(`<option value="${h}" ${h === startHour ? 'selected' : ''}>${s}</option>`);
    }

    const minuteOptions = [0, 15, 30, 45].map(m => {
      const s = String(m).padStart(2, '0');
      return `<option value="${m}" ${m === startMin ? 'selected' : ''}>${s}</option>`;
    }).join('');

    const modalHtml = `
      <div class="lesson-modal-dialog">
        <!-- Header -->
        <div class="lesson-modal-header">
          <h3 class="lesson-modal-title">${isEditing ? 'Урок' : 'Новый урок'}</h3>
          <button type="button" class="lesson-modal-close" id="btn-lesson-modal-close" aria-label="Закрыть">✕</button>
        </div>

        <!-- Group Selector (Matches Screenshot 2) -->
        <div class="lesson-group-selector-wrap">
          <div class="lesson-group-avatar-large" id="modal-group-avatar-preview">
            ${groupInitials}
          </div>
          <div style="flex:1;">
            <label class="form-label text-xs" style="margin-bottom:3px; font-weight:700; color:#64748b;">Группа:</label>
            <select id="modal-lesson-group" class="form-control" style="font-weight:700; font-size:1rem; border-radius:12px; height:42px;">
              ${groups.length === 0 ? `<option value="">Нет созданных групп</option>` : ''}
              ${groups.map(g => `<option value="${g.id}" ${g.id === currentGroupId ? 'selected' : ''}>👥 ${g.name} (${g.level || 'General'})</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Duration Select (Matches Screenshot 2) -->
        <div class="lesson-duration-select-wrap">
          <label class="form-label text-xs" style="margin-bottom:3px; font-weight:700; color:#64748b;">Продолжительность урока:</label>
          <select id="modal-lesson-duration" class="form-control" style="font-weight:600; border-radius:12px; height:42px;">
            <option value="45" ${duration === 45 ? 'selected' : ''}>🕒 45 мин</option>
            <option value="60" ${duration === 60 ? 'selected' : ''}>🕒 60 мин</option>
            <option value="90" ${duration === 90 ? 'selected' : ''}>🕒 90 мин</option>
            <option value="120" ${duration === 120 ? 'selected' : ''}>🕒 120 мин</option>
          </select>
        </div>

        <!-- Day of the Week Selector Pills (Allows easy 1-click day change) -->
        <div class="lesson-days-wrap">
          <div class="lesson-days-header">
            <span>День недели:</span>
            <span id="modal-lesson-day-label" style="color:#0284c7; font-weight:700;">${RUSSIAN_DAYS[initialDayIdx - 1]}</span>
          </div>
          <div class="lesson-days-pills" id="modal-lesson-days-pills">
            ${[1, 2, 3, 4, 5, 6, 7].map(dNum => {
              const shortName = RUSSIAN_DAYS_SHORT[dNum - 1];
              const isActive = dNum === initialDayIdx;
              const isSun = dNum === 7;
              return `
                <button type="button" 
                        class="btn-day-pill ${isActive ? 'active' : ''} ${isSun ? 'pill-sunday' : ''}" 
                        data-day-index="${dNum}" 
                        title="${RUSSIAN_DAYS[dNum - 1]}">
                  ${shortName}
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Time & Date Row (Matches Screenshot 2) -->
        <div class="lesson-time-row">
          <div class="lesson-time-header">
            <span>Время урока</span>
            <span id="modal-lesson-utc-note" style="color:#64748b; font-weight:600;">🕒 У группы ${startHourStr}:${startMinStr} (UTC+5)</span>
          </div>

          <div class="lesson-time-inputs">
            <select id="modal-lesson-day-select" class="form-control" style="border-radius:10px; font-weight:600; flex:1; height:42px;">
              ${[1, 2, 3, 4, 5, 6, 7].map(dIdx => {
                const dDate = getWeekDateStr(dIdx);
                const dParts = dDate.split('-');
                const dayNum = parseInt(dParts[2], 10);
                const monthShort = monthsRuShort[parseInt(dParts[1], 10) - 1];
                const label = `${RUSSIAN_DAYS_SHORT[dIdx - 1]}, ${dayNum} ${monthShort}`;
                return `<option value="${dIdx}" data-date="${dDate}" ${dIdx === initialDayIdx ? 'selected' : ''}>${label}</option>`;
              }).join('')}
            </select>
            <span style="font-weight:600; color:#64748b;">в</span>
            <select id="modal-lesson-hour" class="form-control" style="width:74px; border-radius:10px; font-weight:700; height:42px; text-align:center;">
              ${hourOptions.join('')}
            </select>
            <span style="font-weight:800; color:#64748b;">:</span>
            <select id="modal-lesson-minute" class="form-control" style="width:74px; border-radius:10px; font-weight:700; height:42px; text-align:center;">
              ${minuteOptions}
            </select>
          </div>

          <div id="modal-lesson-timerange-display" style="font-size:0.82rem; color:#64748b; margin-top:8px;">
            Интервал урока: <strong>${startHourStr}:${startMinStr} - ${endCalculated}</strong> (${duration} мин)
          </div>
        </div>

        <!-- Status Select (Matches Screenshot 2) -->
        <div class="lesson-status-select-wrap">
          <label class="form-label text-xs" style="margin-bottom:4px; font-weight:700; color:#64748b;">Статус урока</label>
          <select id="modal-lesson-status" class="form-control" style="font-weight:700; border-radius:12px; height:42px; color:#b45309; background:#fffbeb; border-color:#fde68a;">
            <option value="planned" ${status === 'planned' ? 'selected' : ''}>⏳ Урок запланирован</option>
            <option value="completed" ${status === 'completed' ? 'selected' : ''}>✓ Урок проведен</option>
            <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>✕ Урок отменен</option>
          </select>
        </div>

        <!-- Recurrence Checkbox (Matches Requirements) -->
        <div class="lesson-recurring-toggle-box">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:700; font-size:0.88rem; color:#1e293b; margin:0;">
            <input type="checkbox" id="modal-lesson-recurrence-chk" style="width:18px; height:18px; accent-color:#0284c7;" ${isRecurring ? 'checked' : ''}>
            <span>Повторять каждую неделю (продлевать расписание)</span>
          </label>
          <div class="text-xs text-muted" style="margin-top:4px; margin-left:26px;">
            Учителю достаточно настроить 1 раз: сайт автоматически продлит этот день и время на все последующие недели.
          </div>
        </div>

        <!-- Modal Actions (Matches Screenshot 2) -->
        <div class="lesson-modal-actions">
          ${isEditing ? `
            <button type="button" class="btn-modal-delete" id="btn-modal-action-delete">Удалить</button>
          ` : `
            <button type="button" class="btn btn-ghost" id="btn-modal-action-cancel" style="border:1px solid #cbd5e1; border-radius:12px; font-weight:700;">Отмена</button>
          `}
          <button type="button" class="btn-modal-conduct" id="btn-modal-action-conduct">
            ${status === 'completed' ? '✓ В класс (Проведен)' : 'Войти в класс'}
          </button>
        </div>

        <div style="margin-top:10px;">
          <button type="button" class="btn btn-primary" id="btn-modal-action-save" style="width:100%; border-radius:12px; padding:12px; font-weight:700; font-size:1rem;">
            💾 ${isEditing ? 'Сохранить изменения' : 'Создать урок'}
          </button>
        </div>
      </div>
    `;

    modal.open({
      content: modalHtml,
      width: '460px'
    });

    const modalDialog = document.querySelector('.lesson-modal-dialog');
    if (!modalDialog) return;

    let currentSelectedDayIdx = initialDayIdx;
    let currentSelectedDateStr = initialDateStr;

    // Elements
    const groupSelect = modalDialog.querySelector('#modal-lesson-group');
    const avatarBadge = modalDialog.querySelector('#modal-group-avatar-preview');
    const durationSelect = modalDialog.querySelector('#modal-lesson-duration');
    const dayPillsBox = modalDialog.querySelector('#modal-lesson-days-pills');
    const dayLabelEl = modalDialog.querySelector('#modal-lesson-day-label');
    const daySelect = modalDialog.querySelector('#modal-lesson-day-select');
    const hourSelect = modalDialog.querySelector('#modal-lesson-hour');
    const minSelect = modalDialog.querySelector('#modal-lesson-minute');
    const utcNote = modalDialog.querySelector('#modal-lesson-utc-note');
    const timerangeDisplay = modalDialog.querySelector('#modal-lesson-timerange-display');
    const statusSelect = modalDialog.querySelector('#modal-lesson-status');
    const recurrenceChk = modalDialog.querySelector('#modal-lesson-recurrence-chk');

    // Dynamic Time and Day Updater
    const updateTimePreview = () => {
      const h = parseInt(hourSelect.value, 10);
      const m = parseInt(minSelect.value, 10);
      const dur = parseInt(durationSelect.value, 10);
      const hStr = String(h).padStart(2, '0');
      const mStr = String(m).padStart(2, '0');
      const endStr = calcEndTimeStr(h, m, dur);

      const dName = RUSSIAN_DAYS[currentSelectedDayIdx - 1];
      const dShort = RUSSIAN_DAYS_SHORT[currentSelectedDayIdx - 1];

      if (dayLabelEl) dayLabelEl.textContent = dName;
      if (utcNote) utcNote.textContent = `🕒 У группы ${hStr}:${mStr} (UTC+5)`;
      if (timerangeDisplay) {
        timerangeDisplay.innerHTML = `День: <strong>${dName} (${dShort})</strong> • Интервал: <strong>${hStr}:${mStr} – ${endStr}</strong> (${dur} мин)`;
      }
    };

    // Day Pills Click Handler
    dayPillsBox?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-day-pill');
      if (!btn) return;
      const dIdx = parseInt(btn.dataset.dayIndex, 10);
      if (!dIdx) return;

      currentSelectedDayIdx = dIdx;
      currentSelectedDateStr = getWeekDateStr(dIdx);

      dayPillsBox.querySelectorAll('.btn-day-pill').forEach(p => {
        p.classList.toggle('active', parseInt(p.dataset.dayIndex, 10) === dIdx);
      });

      if (daySelect) daySelect.value = String(dIdx);
      updateTimePreview();
    });

    // Day Select Dropdown Change Handler
    daySelect?.addEventListener('change', () => {
      const dIdx = parseInt(daySelect.value, 10);
      currentSelectedDayIdx = dIdx;
      currentSelectedDateStr = getWeekDateStr(dIdx);

      dayPillsBox?.querySelectorAll('.btn-day-pill').forEach(p => {
        p.classList.toggle('active', parseInt(p.dataset.dayIndex, 10) === dIdx);
      });

      updateTimePreview();
    });

    // Group change handler
    groupSelect?.addEventListener('change', () => {
      const g = groups.find(item => item.id === groupSelect.value);
      if (g) {
        avatarBadge.textContent = g.name.split(' ').map(n => n[0]).slice(0, 2).join('');
      }
    });

    hourSelect?.addEventListener('change', updateTimePreview);
    minSelect?.addEventListener('change', updateTimePreview);
    durationSelect?.addEventListener('change', updateTimePreview);

    modalDialog.querySelector('#btn-lesson-modal-close')?.addEventListener('click', () => modal.close());
    modalDialog.querySelector('#btn-modal-action-cancel')?.addEventListener('click', () => modal.close());

    // DELETE Action
    modalDialog.querySelector('#btn-modal-action-delete')?.addEventListener('click', () => {
      if (!lesson) return;
      const lessonId = lesson.id;
      const targetDate = currentSelectedDateStr;
      const dateParts = targetDate ? targetDate.split('-') : [];
      const dateRu = dateParts.length === 3 ? `${dateParts[2]}.${dateParts[1]}` : (targetDate || '');
      const isRec = Boolean(lesson.isRecurring || lesson.id?.startsWith('rec-') || (recurrenceChk && recurrenceChk.checked));

      if (isRec) {
        this.openDeleteRecurrenceModal(
          dateRu,
          () => {
            store.deleteLesson(lessonId, 'recurring');
            modal.close();
            toast.success('🗑️ Серия уроков удалена из расписания');
            if (typeof onSaved === 'function') onSaved();
            else this.refresh();
          },
          () => {
            store.deleteLesson(lessonId, 'single', targetDate);
            modal.close();
            toast.success(`🗑️ Урок удален на дату ${dateRu || targetDate}`);
            if (typeof onSaved === 'function') onSaved();
            else this.refresh();
          }
        );
      } else {
        modal.confirm({
          title: 'Удалить урок',
          message: 'Вы уверены, что хотите удалить этот урок из расписания?',
          confirmText: 'Удалить',
          cancelText: 'Отмена',
          isDanger: true,
          onConfirm: () => {
            store.deleteLesson(lessonId, 'single', targetDate);
            modal.close();
            toast.success('🗑️ Урок удален из расписания');
            if (typeof onSaved === 'function') onSaved();
            else this.refresh();
          }
        });
      }
    });

    // CONDUCT Action
    modalDialog.querySelector('#btn-modal-action-conduct')?.addEventListener('click', () => {
      const gId = groupSelect.value;
      const targetDate = currentSelectedDateStr;
      if (lesson) {
        store.updateLesson(lesson.id, { status: 'completed' }, 'single', targetDate);
        modal.close();
        toast.success('✓ Урок проведен! Ученикам открыты материалы и домашнее задание.');
        if (typeof onSaved === 'function') onSaved();
        else this.refresh();
        if (lesson.groupId) {
          openAttendanceModal(lesson.id, lesson.groupId, targetDate);
        }
      } else {
        const dur = parseInt(durationSelect.value, 10) || 60;
        const h = parseInt(hourSelect.value, 10);
        const m = parseInt(minSelect.value, 10);
        const startHStr = String(h).padStart(2, '0');
        const startMStr = String(m).padStart(2, '0');
        const startTime = `${startHStr}:${startMStr}`;
        const endTime = calcEndTimeStr(h, m, dur);
        const grp = store.getGroupById(gId);
        const newL = store.addLesson({
          groupId: gId,
          targetType: 'group',
          dayOfWeek: RUSSIAN_DAYS[currentSelectedDayIdx - 1],
          dayIndex: currentSelectedDayIdx,
          date: targetDate,
          startTime,
          endTime,
          time: `${startTime} - ${endTime}`,
          duration: dur,
          status: 'completed',
          isRecurring: recurrenceChk.checked,
          topic: grp ? `Урок группы ${grp.name}` : 'English Lesson',
          format: grp?.classroom || 'Очно (Кабинет 1)',
          color: grp ? store.pickColorForGroup(gId) : '#bbf7d0'
        });
        modal.close();
        toast.success('✓ Урок создан и отмечен как проведенный!');
        if (typeof onSaved === 'function') onSaved();
        else this.refresh();
        if (newL?.groupId) {
          openAttendanceModal(newL.id, newL.groupId, targetDate);
        }
      }
    });

    // SAVE Action
    modalDialog.querySelector('#btn-modal-action-save')?.addEventListener('click', () => {
      const gId = groupSelect.value;
      if (!gId) {
        toast.error('Пожалуйста, выберите группу для урока');
        return;
      }

      const dur = parseInt(durationSelect.value, 10) || 60;
      const h = parseInt(hourSelect.value, 10);
      const m = parseInt(minSelect.value, 10);
      const startHStr = String(h).padStart(2, '0');
      const startMStr = String(m).padStart(2, '0');
      const startTime = `${startHStr}:${startMStr}`;
      const endTime = calcEndTimeStr(h, m, dur);
      const timeStr = `${startTime} - ${endTime}`;

      const dayIdx = currentSelectedDayIdx;
      const dayName = RUSSIAN_DAYS[dayIdx - 1];
      const dateVal = currentSelectedDateStr;
      const statusVal = statusSelect.value || 'planned';
      const isRecChecked = recurrenceChk.checked;

      const grp = store.getGroupById(gId);
      const color = grp ? store.pickColorForGroup(gId) : (lesson?.color || '#bbf7d0');

      const payload = {
        groupId: gId,
        targetType: 'group',
        dayOfWeek: dayName,
        dayIndex: dayIdx,
        date: dateVal,
        startTime,
        endTime,
        time: timeStr,
        duration: dur,
        status: statusVal,
        isRecurring: isRecChecked,
        topic: grp ? `Урок группы ${grp.name}` : 'English Lesson',
        format: grp?.classroom || 'Очно (Кабинет 1)',
        color
      };

      if (!isEditing) {
        store.addLesson(payload);
        modal.close();
        toast.success('✅ Урок успешно добавлен в расписание и продлен на последующие недели!');
        if (typeof onSaved === 'function') onSaved();
        else this.refresh();
        return;
      }

      // Editing existing lesson
      if (lesson.isRecurring) {
        this.openRecurrenceConfirmModal(
          'Изменение урока',
          'Изменить только этот урок или все повторяющиеся уроки? Прошедшие уроки изменены не будут.',
          () => {
            store.updateLesson(lesson.id, payload, 'recurring', dateVal);
            modal.close();
            toast.success('✅ Расписание группы обновлено для всех последующих недель');
            if (typeof onSaved === 'function') onSaved();
            else this.refresh();
          },
          () => {
            store.updateLesson(lesson.id, payload, 'single', dateVal);
            modal.close();
            toast.success('✅ Изменения сохранены для этого урока');
            if (typeof onSaved === 'function') onSaved();
            else this.refresh();
          }
        );
      } else {
        store.updateLesson(lesson.id, payload, 'single', dateVal);
        modal.close();
        toast.success('✅ Урок успешно обновлен');
        if (typeof onSaved === 'function') onSaved();
        else this.refresh();
      }
    });
  },

  /**
   * Recurrence Choice Dialog matching Screenshot 3 (media_1791113392599.png)
   */
  openRecurrenceConfirmModal(title, description, onAll, onSingle) {
    const dialogHtml = `
      <div class="recurrence-confirm-dialog">
        <button type="button" class="lesson-modal-close" id="btn-rec-dialog-close" style="position:absolute; top:16px; right:16px;">✕</button>
        <div class="recurrence-info-circle">i</div>
        <h3 class="recurrence-modal-title">${title || 'Изменение урока'}</h3>
        <p class="recurrence-modal-desc">
          ${description || 'Изменить только этот урок или все повторяющиеся уроки? Прошедшие уроки изменены не будут.'}
        </p>
        <div class="recurrence-actions-row">
          <button type="button" class="btn-recurrence-all" id="btn-dialog-rec-all">Повторяющиеся</button>
          <button type="button" class="btn-recurrence-single" id="btn-dialog-rec-single">Только этот</button>
        </div>
      </div>
    `;

    modal.open({
      content: dialogHtml,
      width: '420px'
    });

    const dialogEl = document.querySelector('.recurrence-confirm-dialog');
    if (!dialogEl) return;

    dialogEl.querySelector('#btn-rec-dialog-close')?.addEventListener('click', () => modal.close());
    dialogEl.querySelector('#btn-dialog-rec-all')?.addEventListener('click', () => {
      modal.close();
      if (typeof onAll === 'function') onAll();
    });
    dialogEl.querySelector('#btn-dialog-rec-single')?.addEventListener('click', () => {
      modal.close();
      if (typeof onSingle === 'function') onSingle();
    });
  },

  /**
   * Confirmation Dialog specifically for deleting a recurring lesson instance or series
   */
  openDeleteRecurrenceModal(dateRu, onDeleteAll, onDeleteSingle) {
    const dialogHtml = `
      <div class="recurrence-confirm-dialog" style="padding: 28px 24px 20px;">
        <button type="button" class="lesson-modal-close" id="btn-del-dialog-close" style="position:absolute; top:16px; right:16px;" aria-label="Закрыть">✕</button>
        <div style="width: 60px; height: 60px; border-radius: 50%; background: #fee2e2; color: #ef4444; display: inline-flex; align-items: center; justify-content: center; font-size: 1.8rem; margin-bottom: 16px;">
          🗑️
        </div>
        <h3 class="recurrence-modal-title" style="margin-bottom: 8px;">Удаление урока</h3>
        <p class="recurrence-modal-desc" style="margin-bottom: 20px;">
          Этот урок настроен как повторяющийся каждую неделю. Как вы хотите его удалить?
        </p>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <button type="button" class="btn" id="btn-dialog-del-single" style="background: #ef4444; color: #ffffff; padding: 12px 16px; border-radius: 12px; font-weight: 700; font-size: 0.95rem; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <span>📅 Удалить только этот урок ${dateRu ? `(${dateRu})` : ''}</span>
          </button>
          <button type="button" class="btn" id="btn-dialog-del-all" style="background: #fef2f2; color: #dc2626; border: 1.5px solid #fca5a5; padding: 12px 16px; border-radius: 12px; font-weight: 700; font-size: 0.95rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <span>🗑️ Удалить всю серию уроков</span>
          </button>
          <button type="button" class="btn btn-ghost" id="btn-dialog-del-cancel" style="padding: 10px 16px; border-radius: 12px; font-weight: 600; color: #64748b; border: 1px solid #cbd5e1; cursor: pointer; margin-top: 4px;">
            Отмена
          </button>
        </div>
      </div>
    `;

    modal.open({
      content: dialogHtml,
      width: '420px'
    });

    const dialogEl = document.querySelector('.recurrence-confirm-dialog');
    if (!dialogEl) return;

    dialogEl.querySelector('#btn-del-dialog-close')?.addEventListener('click', () => modal.close());
    dialogEl.querySelector('#btn-dialog-del-cancel')?.addEventListener('click', () => modal.close());

    dialogEl.querySelector('#btn-dialog-del-single')?.addEventListener('click', () => {
      modal.close();
      if (typeof onDeleteSingle === 'function') onDeleteSingle();
    });

    dialogEl.querySelector('#btn-dialog-del-all')?.addEventListener('click', () => {
      modal.close();
      if (typeof onDeleteAll === 'function') onDeleteAll();
    });
  }
};
