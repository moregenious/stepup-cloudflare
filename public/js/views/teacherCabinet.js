/**
 * Teacher Personal Cabinet View - Groups, Personal Schedule, Lesson Plans, Homework & Student Phone Management
 */

import { store, formatPhoneForDisplay } from '../store.js';
import { auth } from '../auth.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { openAttendanceModal } from '../components/attendanceModal.js';
import { LessonPlansView } from './lessonPlansView.js';
import { StudentsView } from './studentsView.js';
import { SCORING_TEMPLATES } from './scoringView.js';
import { ScheduleView } from './scheduleView.js';
import { logger } from '../utils/logger.js';
import { AdminDashboard } from './adminDashboard.js';
import { openClassroomModal } from '../components/classroomModal.js';

export const TeacherCabinet = {
  selectedGroupId: null,
  groupScoringMode: 'add', // 'add' | 'deduct'
  selectedStudentIds: null,
  _autoRefreshTimer: null,
  _container: null,
  _visibilityBound: false,

  setupAutoRefresh(container) {
    this._container = container;
    if (this._autoRefreshTimer) {
      clearInterval(this._autoRefreshTimer);
      this._autoRefreshTimer = null;
    }

    this._autoRefreshTimer = setInterval(() => {
      if (document.body.contains(container) && window.location.hash.includes('teacher-cabinet')) {
        try {
          store.autoCompletePastLessons();
        } catch (_) {}
        this.render(container);
      } else {
        clearInterval(this._autoRefreshTimer);
        this._autoRefreshTimer = null;
      }
    }, 30000);

    if (!this._visibilityBound) {
      this._visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this._container && document.body.contains(this._container) && window.location.hash.includes('teacher-cabinet')) {
          try {
            store.autoCompletePastLessons();
          } catch (_) {}
          this.render(this._container);
        }
      });
    }
  },

  render(container) {
    try {
      store.autoCompletePastLessons();
    } catch (_) {}
    this.setupAutoRefresh(container);

    const teacherUser = auth.getCurrentUser();
    const teacherId = teacherUser.id;
    const teacher = store.getTeacherById(teacherId) || store.getTeachers()[0];

    const myGroups = store.getGroups({ teacherId: teacher.id });
    const mySchedule = store.getSchedule({ teacherId: teacher.id });

    // Calculate current week dates
    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(now);
    monday.setDate(now.getDate() + distanceToMonday);
    monday.setHours(0, 0, 0, 0);

    const weekDays = [];
    const weekDateStrings = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dayStr = String(d.getDate()).padStart(2, '0');
      const monthStr = String(d.getMonth() + 1).padStart(2, '0');
      const yearStr = d.getFullYear();
      weekDateStrings.push(`${dayStr}.${monthStr}`);
      weekDateStrings.push(`${dayStr}.${monthStr}.${yearStr}`);
      weekDateStrings.push(`${yearStr}-${monthStr}-${dayStr}`);
      weekDays.push({
        dayName: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'][i],
        formattedDDMM: `${dayStr}.${monthStr}`
      });
    }

    // Accurately resolve current week schedule using store engine
    const weekScheduleData = store.getWeekSchedule(monday, { teacherId: teacher.id });
    const currentWeekSchedule = (weekScheduleData.lessons || []).slice();
    currentWeekSchedule.sort((a, b) => {
      const dayDiff = (a.dayIndex || 99) - (b.dayIndex || 99);
      if (dayDiff !== 0) return dayDiff;
      return (a.time || '').localeCompare(b.time || '');
    });

    // Collect all students from teacher's groups and direct lessons
    let allTeacherStudents = [];
    myGroups.forEach(g => {
      allTeacherStudents.push(...store.getStudentsByGroupId(g.id));
    });
    mySchedule.forEach(l => {
      if (l.studentId) {
        const st = store.getStudentById(l.studentId);
        if (st && !allTeacherStudents.some(s => s.id === st.id)) {
          allTeacherStudents.push(st);
        }
      }
    });

    const teacherStudentIds = allTeacherStudents.map(s => s.id);
    const allPurchases = store.getPurchases ? store.getPurchases() : [];
    const teacherPurchases = allPurchases.filter(p => teacherStudentIds.includes(p.studentId) || myGroups.some(g => g.id === p.groupId));

    // Current / Live Lesson detection strictly for TODAY
    const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    const dayShorts = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const todayDayIndex = now.getDay() === 0 ? 7 : now.getDay();
    const todayDayName = dayNames[now.getDay()];
    const todayDayShort = dayShorts[now.getDay()];
    const todayYear = now.getFullYear();
    const todayMonth = String(now.getMonth() + 1).padStart(2, '0');
    const todayDateNum = String(now.getDate()).padStart(2, '0');
    const todayDateStr = `${todayYear}-${todayMonth}-${todayDateNum}`;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const parseTimeRange = (timeStr) => {
      if (!timeStr) return null;
      const parts = timeStr.split('-').map(s => s.trim());
      const parseOne = (t) => {
        const m = t.match(/(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      };
      const start = parseOne(parts[0]);
      const end = parts[1] ? parseOne(parts[1]) : (start !== null ? start + 90 : null);
      return (start !== null && end !== null) ? { start, end } : null;
    };

    const formatCountdown = (diffMinutes) => {
      if (diffMinutes <= 0) return 'прямо сейчас';
      const h = Math.floor(diffMinutes / 60);
      const m = diffMinutes % 60;
      if (h > 0 && m > 0) return `через ${h} ч ${m} мин`;
      if (h > 0) return `через ${h} ч`;
      return `через ${m} мин`;
    };

    // Strictly find lessons for TODAY from resolved week schedule
    const todayLessons = currentWeekSchedule.filter(l => {
      if (l.isVacationPaused || l.status === 'cancelled' || l.status === 'vacation') return false;
      return l.dayIndex === todayDayIndex || l.date === todayDateStr;
    });

    todayLessons.sort((a, b) => {
      const trA = parseTimeRange(a.time) || { start: 0 };
      const trB = parseTimeRange(b.time) || { start: 0 };
      return trA.start - trB.start;
    });

    let liveLesson = null;
    let upcomingLesson = null;
    let lastCompletedLesson = null;

    for (const l of todayLessons) {
      const tr = parseTimeRange(l.time);
      if (!tr) continue;

      // A lesson is live strictly during its timeframe (with a 5 min prep buffer before start, up to end)
      if (currentMinutes >= tr.start - 5 && currentMinutes <= tr.end) {
        liveLesson = l;
        break; // Current lesson taking place right now
      } else if (currentMinutes < tr.start - 5) {
        if (!upcomingLesson) {
          upcomingLesson = l;
        }
      } else if (currentMinutes > tr.end) {
        lastCompletedLesson = l;
      }
    }

    const isLiveNow = Boolean(liveLesson);

    // Determine active group to display
    let activeGroupId = this.selectedGroupId;
    if (!activeGroupId || !myGroups.some(g => g.id === activeGroupId)) {
      if (liveLesson && liveLesson.groupId) {
        activeGroupId = liveLesson.groupId;
      } else if (upcomingLesson && upcomingLesson.groupId) {
        activeGroupId = upcomingLesson.groupId;
      } else if (lastCompletedLesson && lastCompletedLesson.groupId) {
        activeGroupId = lastCompletedLesson.groupId;
      } else if (myGroups.length > 0) {
        activeGroupId = myGroups[0].id;
      }
    }

    const activeGroup = myGroups.find(g => g.id === activeGroupId) || myGroups[0] || null;
    const activeGroupStudents = activeGroup ? store.getStudentsByGroupId(activeGroup.id) : [];
    const activeGroupSchedule = activeGroup ? store.getGroupScheduleSummary(activeGroup.id) : { days: '', time: '', full: '—' };

    if (!this.selectedStudentIds) {
      this.selectedStudentIds = new Set(activeGroupStudents.map(s => s.id));
    } else {
      const validIds = new Set(activeGroupStudents.map(s => s.id));
      this.selectedStudentIds = new Set([...this.selectedStudentIds].filter(id => validIds.has(id)));
      if (this.selectedStudentIds.size === 0 && activeGroupStudents.length > 0) {
        this.selectedStudentIds = new Set(activeGroupStudents.map(s => s.id));
      }
    }

    // Check if activeGroup has a scheduled lesson TODAY
    const groupLessonToday = activeGroup ? (todayLessons.find(l => l.groupId === activeGroup.id) || null) : null;
    const isThisGroupLive = Boolean(liveLesson && groupLessonToday && liveLesson.id === groupLessonToday.id);
    const isThisGroupUpcoming = Boolean(!isThisGroupLive && groupLessonToday && parseTimeRange(groupLessonToday.time)?.start > currentMinutes);

    // activeLesson: today's lesson if one exists for this group; otherwise look up general planned lesson for materials reference
    const activeLesson = groupLessonToday || (activeGroup ? (
      mySchedule.find(l => l.groupId === activeGroup.id && l.status === 'planned') ||
      mySchedule.find(l => l.groupId === activeGroup.id) || null
    ) : null);

    const activePlan = groupLessonToday ?
      (store.getLessonPlanByScheduleId(groupLessonToday.baseId || groupLessonToday.id) || (activeGroup ? store.getLessonPlans({ groupId: activeGroup.id }).find(p => !p.isConducted) : null)) :
      (activeLesson ? store.getLessonPlanByScheduleId(activeLesson.id) : (activeGroup ? store.getLessonPlans({ groupId: activeGroup.id }).find(p => !p.isConducted) : null));

    const currMonth = store.getCurrentAcademicMonth();
    const groupStudentPayments = activeGroupStudents.map(st => ({
      student: st,
      payment: store.getPayment(st.id, currMonth.key)
    }));
    const paidCount = groupStudentPayments.filter(sp => sp.payment.status === 'paid').length;
    const unpaidCount = activeGroupStudents.length - paidCount;

    container.innerHTML = `
      <div class="section-header">
        <div class="section-title-wrap">
          <h1>Кабинет Преподавателя</h1>
          <p>Добро пожаловать, ${teacher.fullName}! Ваши учебные группы, расписание, планы уроков, домашние задания и новые слова.</p>
        </div>
        <div class="section-actions" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <a href="#lesson-plans" class="btn btn-secondary btn-sm">
            📚 Планы уроков
          </a>
          <button class="btn btn-primary btn-sm" id="btn-teacher-award-points">
            ⭐ Баллы
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="btn-cabinet-activity-logs" title="Журнал действий">
            📜 Журнал
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="btn-cabinet-copy-diag" title="Скопировать лог диагностики">
            📋 Диагностика
          </button>
          <button type="button" class="btn btn-logout-header btn-app-logout" title="Выйти на главный экран входа">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            <span>Выйти</span>
          </button>
        </div>
      </div>

      <!-- Teacher Info Card -->
      <div class="card" style="margin-bottom: var(--space-6); background: linear-gradient(135deg, #0f172a, #1e293b); color: #fff;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4);">
          <div style="display: flex; align-items: center; gap: var(--space-4);">
            <div style="width: 56px; height: 56px; border-radius: var(--radius-full); background: ${teacher.avatarColor || '#0d9488'}; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 700;">
              ${teacher.fullName.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
            <div>
              <h2 style="color: #fff; font-size: var(--font-size-lg);">${teacher.fullName}</h2>
              <p style="color: #94a3b8; font-size: var(--font-size-sm);">${teacher.specialization}</p>
              <div style="font-size:0.75rem; color:#38bdf8; margin-top:2px;">
                Логин для входа: <strong>${teacher.login || '—'}</strong>
              </div>
            </div>
          </div>
          <div style="display: flex; gap: var(--space-4);">
            <div style="background: rgba(255,255,255,0.08); padding: var(--space-3) var(--space-5); border-radius: var(--radius-md); text-align: center; cursor: pointer; transition: transform 0.15s ease;" id="stat-teacher-my-groups" title="Нажмите, чтобы открыть кабинет класса">
              <div style="font-size: 1.25rem; font-weight: 700; color: #a855f7;">${myGroups.length}</div>
              <div style="font-size: var(--font-size-xs); color: #94a3b8;">Моих групп ➔</div>
            </div>
            <div style="background: rgba(255,255,255,0.08); padding: var(--space-3) var(--space-5); border-radius: var(--radius-md); text-align: center;">
              <div style="font-size: 1.25rem; font-weight: 700; color: #38bdf8;">${allTeacherStudents.length}</div>
              <div style="font-size: var(--font-size-xs); color: #94a3b8;">Учеников</div>
            </div>
            <div style="background: rgba(255,255,255,0.08); padding: var(--space-3) var(--space-5); border-radius: var(--radius-md); text-align: center;">
              <div style="font-size: 1.25rem; font-weight: 700; color: #10b981;">${currentWeekSchedule.length}</div>
              <div style="font-size: var(--font-size-xs); color: #94a3b8;">Уроков на этой неделе</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Plans Banner -->
      <div class="card" style="margin-bottom: var(--space-6); background: var(--color-bg-card); border-left: 4px solid var(--color-success); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:var(--space-3);">
        <div>
          <h3 style="font-size:var(--font-size-md); font-weight:700;">📚 Управление планами уроков и ДЗ</h3>
          <p class="text-xs text-muted" style="margin-top:2px;">Загружайте аудиозаписи, Word-документы и новые слова. Они откроются ученикам сразу после нажатия «✓ Провести урок».</p>
        </div>
        <a href="#lesson-plans" class="btn btn-primary btn-sm">
          Перейти к планам уроков ➔
        </a>
      </div>

      <!-- Active / Live Lesson Widget Card -->
      <div class="card live-lesson-card ${isLiveNow ? 'is-live' : ''}">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:var(--space-4);">
          <div style="flex: 1; min-width: 280px;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
              ${isLiveNow ? `
                <span class="live-pulse-dot"></span>
                <span class="badge badge-success" style="font-weight:700; letter-spacing:0.04em;">🟢 УРОК ИДЕТ ПРЯМО СЕЙЧАС (${liveLesson.time})</span>
              ` : upcomingLesson ? `
                <span class="badge" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-weight:700;">☕ СЕЙЧАС УРОКОВ НЕТ • ПЕРЕРЫВ</span>
                <span class="badge" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-weight:700;">⏳ Следующий урок: ${upcomingLesson.groupName} в ${upcomingLesson.time} (${formatCountdown((parseTimeRange(upcomingLesson.time)?.start || 0) - currentMinutes)})</span>
              ` : todayLessons.length > 0 ? `
                <span class="badge" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-weight:700;">☕ СЕЙЧАС УРОКОВ НЕТ</span>
                <span class="badge" style="background:#dcfce7; color:#15803d; border:1px solid #86efac; font-weight:700;">✓ Все уроки на сегодня завершены (${todayLessons.length})</span>
              ` : `
                <span class="badge" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; font-weight:700;">☕ СЕЙЧАС УРОКОВ НЕТ</span>
                <span class="badge" style="background:#e0e7ff; color:#4338ca; border:1px solid #c7d2fe; font-weight:700;">🏖️ Сегодня нет уроков по расписанию</span>
              `}
              <span class="text-xs text-muted" style="margin-left:auto;">Сегодня: <strong>${todayDayName}, ${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}</strong></span>
            </div>

            <div style="display:flex; align-items:center; gap:var(--space-3); flex-wrap:wrap;">
              <h2 style="font-size:var(--font-size-lg); font-weight:800; color:var(--color-text-main); margin:0;">
                👥 ${activeGroup ? activeGroup.name : 'Группа не выбрана'}
              </h2>
              ${activeGroup ? `<span class="badge badge-level level-${(activeGroup.level || 'beginner').toLowerCase()}">${activeGroup.level}</span>` : ''}
              ${groupLessonToday ? (
                isThisGroupLive ? `
                  <span class="badge badge-success" style="font-size:0.7rem; font-weight:700;">🟢 Идет урок</span>
                ` : isThisGroupUpcoming ? `
                  <span class="badge" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-size:0.7rem; font-weight:700;">⏳ Урок сегодня в ${groupLessonToday.time}</span>
                ` : `
                  <span class="badge badge-completed" style="font-size:0.7rem; font-weight:700;">✓ Урок завершен (${groupLessonToday.time})</span>
                `
              ) : activeGroup ? `
                <span class="badge" style="background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0; font-size:0.7rem;">ℹ️ Сегодня нет урока</span>
              ` : ''}
            </div>

            <div class="text-xs text-muted" style="margin-top:4px; display:flex; gap:12px; flex-wrap:wrap;">
              <span>📚 <strong>Учебник:</strong> ${activeGroup?.textbook || '—'}</span>
              <span>⏰ <strong>Время:</strong> ${groupLessonToday ? groupLessonToday.time : (activeGroupSchedule.full || '—')}</span>
              <span>🏫 <strong>Кабинет:</strong> ${activeGroup?.classroom || 'Каб.'}</span>
              <span>👨‍🎓 <strong>В группе:</strong> ${activeGroupStudents.length} уч.</span>
            </div>

            ${groupLessonToday ? `
              <div style="margin-top:10px; padding:8px 12px; background:var(--color-bg-app); border-radius:var(--radius-md); border-left:3px solid var(--color-primary); font-size:var(--font-size-xs);">
                <div><strong>Тема урока:</strong> ${groupLessonToday.topic || 'Урок группы'}</div>
                ${activePlan ? `
                  <div style="margin-top:2px; color:var(--color-text-muted);">
                    📝 ДЗ: ${activePlan.homework?.text ? (activePlan.homework.isFromPrevious ? `(с Урока ${activePlan.homework.sourceLesson.lessonNumber}) ` : '') + (activePlan.homework.text.slice(0, 60) + '...') : 'Не задано'} • 🔤 Слов: ${activePlan.vocabulary?.length || 0}
                  </div>
                ` : ''}
              </div>
            ` : activeGroup ? `
              <div style="margin-top:10px; padding:8px 12px; background:var(--color-bg-subtle); border-radius:var(--radius-md); border-left:3px solid #94a3b8; font-size:var(--font-size-xs); color:var(--color-text-muted);">
                <div>ℹ️ <strong>У группы «${activeGroup.name}» сегодня нет урока в расписании.</strong></div>
                <div style="margin-top:2px;">Регулярные дни: <strong>${activeGroupSchedule.full || '—'}</strong>. Вы можете выставить баллы ученикам, проверить домашнее задание или провести внеплановый урок.</div>
              </div>
            ` : ''}
          </div>

          <!-- Right actions & group switcher -->
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
              <label for="select-cabinet-active-group" class="text-xs text-muted" style="font-weight:600; white-space:nowrap;">Группа:</label>
              <select id="select-cabinet-active-group" class="form-control form-control-sm" style="font-weight:700; min-width:190px;">
                ${myGroups.map(g => {
                  const gToday = todayLessons.find(l => l.groupId === g.id);
                  const isLiveG = liveLesson && liveLesson.groupId === g.id;
                  const gSched = store.getGroupScheduleSummary(g.id);
                  const tag = isLiveG ? '🟢 Идет' : gToday ? `⏰ ${gToday.time}` : (gSched.days ? `${gSched.days} ${gSched.time}` : '—');
                  return `
                    <option value="${g.id}" ${activeGroup && activeGroup.id === g.id ? 'selected' : ''}>
                      ${g.name} (${tag})
                    </option>
                  `;
                }).join('')}
              </select>
              ${activeGroup ? `
                <button type="button" class="btn btn-xs btn-primary btn-cabinet-open-classroom" data-gid="${activeGroup.id}" title="Перейти в кабинет класса: турнирная таблица и статус мини-игр">
                  🏫 Кабинет класса ➔
                </button>
              ` : ''}
            </div>

            <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
              ${groupLessonToday ? `
                <button class="btn btn-xs ${groupLessonToday.status === 'completed' ? 'btn-success' : 'btn-outline-success'} btn-cabinet-conduct-lesson" data-lid="${groupLessonToday.id}" data-date="${groupLessonToday.date || ''}" title="Отметить проведение урока">
                  ${groupLessonToday.status === 'completed' ? '✓ Урок проведен' : '✓ Провести урок'}
                </button>
                <button class="btn btn-xs btn-primary btn-teacher-attendance" data-id="${groupLessonToday.id}" title="Отметить присутствующих">
                  👥 Посещаемость
                </button>
              ` : activeLesson ? `
                <button class="btn btn-xs btn-outline-primary btn-teacher-attendance" data-id="${activeLesson.id}" title="Отметить присутствующих">
                  👥 Посещаемость
                </button>
              ` : ''}
              ${activePlan ? `
                <button class="btn btn-xs btn-secondary btn-teacher-edit-plan" data-plan-id="${activePlan.id}" title="Редактировать материалы урока">
                  ✏️ ДЗ и слова
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        <!-- Section 1: Category Scoring Toolbar for selected students / group -->
        <div style="margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px dashed var(--color-border);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
            <div style="font-size:var(--font-size-xs); font-weight:700; color:var(--color-text-main); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span>⭐ Баллы выбранным (<span id="selected-students-count">${this.selectedStudentIds.size}</span> из ${activeGroupStudents.length} уч.):</span>
              <div style="display:inline-flex; gap:4px;">
                <button type="button" class="btn btn-xs btn-ghost" id="btn-select-all-students" style="padding:1px 6px; font-size:0.7rem; border:1px solid var(--color-border);">Выбрать всех</button>
                <button type="button" class="btn btn-xs btn-ghost" id="btn-deselect-all-students" style="padding:1px 6px; font-size:0.7rem; border:1px solid var(--color-border);">Снять выбор</button>
              </div>
            </div>
            <div style="display:flex; gap:6px;">
              <button type="button" class="group-scoring-tab-btn ${this.groupScoringMode !== 'deduct' ? 'active tab-add' : ''}" data-mode="add">
                🟢 Начисление (+)
              </button>
              <button type="button" class="group-scoring-tab-btn ${this.groupScoringMode === 'deduct' ? 'active tab-deduct' : ''}" data-mode="deduct">
                🔴 Списание (-)
              </button>
            </div>
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            ${(this.groupScoringMode === 'deduct' ? SCORING_TEMPLATES.deduct : SCORING_TEMPLATES.add).map(tpl => `
              <button type="button" class="scoring-category-pill ${this.groupScoringMode === 'deduct' ? 'pill-deduct' : ''} btn-batch-cat-pill" data-points="${tpl.points}" data-type="${this.groupScoringMode === 'deduct' ? 'deduct' : 'add'}" data-category="${tpl.category}" data-label="${tpl.label}" title="${this.groupScoringMode === 'deduct' ? 'Списать' : 'Начислить'} ${tpl.points} ⭐ выбранным ученикам">
                <span>${tpl.icon}</span>
                <span>${tpl.label}</span>
                <span class="pill-pts-badge ${this.groupScoringMode === 'deduct' ? 'deduct' : 'add'}">
                  ${this.groupScoringMode === 'deduct' ? '-' : '+'}${tpl.points} ⭐
                </span>
              </button>
            `).join('')}
            <button type="button" class="btn btn-sm btn-ghost btn-batch-group-pts-custom" style="border:1px dashed var(--color-border); border-radius:9999px; padding:6px 14px; font-size:var(--font-size-xs); font-weight:700;">
              ✏️ Свои баллы...
            </button>
          </div>
        </div>

        <!-- Section 2: Students List of this active group with Category Pills and 1-Click Payments -->
        <div style="margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px dashed var(--color-border);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-size:var(--font-size-xs); font-weight:700; color:var(--color-text-main);">
                👨‍🎓 Ученики на уроке (${activeGroupStudents.length})
              </div>
              ${activeGroup ? `
                <button type="button" class="btn btn-xs btn-outline-primary btn-cabinet-open-classroom" data-gid="${activeGroup.id}" title="Посмотреть турнирную таблицу и статус мини-игр этого класса">
                  🏆 Рейтинг и игры класса ➔
                </button>
              ` : ''}
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="text-xs text-muted">
                Оплата за <strong>${currMonth.name}</strong>:
                <strong style="color:${unpaidCount === 0 ? '#16a34a' : '#ea580c'};">${paidCount} из ${activeGroupStudents.length} оплатили</strong>
              </span>
              ${unpaidCount > 0 ? `
                <button class="btn btn-xs btn-outline-success btn-cabinet-pay-all-group" title="Отметить оплату всем ${unpaidCount} неоплатившим ученикам">
                  💳 Отметить оплату всей группе
                </button>
              ` : `
                <span class="badge badge-success" style="font-size:0.7rem;">✓ Все оплатили</span>
              `}
            </div>
          </div>

          ${activeGroupStudents.length === 0 ? `
            <div style="padding:var(--space-5); text-align:center; background:var(--color-bg-app); border-radius:var(--radius-lg);">
              <div style="font-size:1.5rem; margin-bottom:4px;">👥</div>
              <div style="font-weight:600; font-size:var(--font-size-sm);">В этой группе пока нет добавленных учеников</div>
              <div class="text-xs text-muted" style="margin-top:2px; margin-bottom:12px;">Загрузите список детей через трафарет Word или распределите их из базы</div>
              <button class="btn btn-primary btn-sm btn-cabinet-import-docx-trigger">
                📥 Загрузить учеников из Word (.docx)
              </button>
            </div>
          ` : `
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${activeGroupStudents.map(st => {
                const payment = store.getPayment(st.id, currMonth.key);
                const isPaid = payment && payment.status === 'paid';
                return `
                  <div class="active-group-student-row">
                    <!-- Checkbox & Student Info -->
                    <div style="display:flex; align-items:center; gap:10px; min-width:200px;">
                      <label style="display:flex; align-items:center; margin:0; cursor:pointer;" title="Выбрать для начисления/списания баллов">
                        <input type="checkbox" class="student-select-cb" data-sid="${st.id}" ${this.selectedStudentIds.has(st.id) ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer; accent-color:var(--color-primary);">
                      </label>
                      <div style="width:36px; height:36px; border-radius:var(--radius-full); background:#4f46e5; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.85rem; flex-shrink:0;">
                        ${st.avatarUrl && st.avatarUrl.length <= 4 ? st.avatarUrl : st.fullName.split(' ').map(n=>n[0]).slice(0,2).join('')}
                      </div>
                      <div>
                        <div style="font-weight:700; font-size:var(--font-size-sm); color:var(--color-text-main);">
                          ${st.fullName}
                        </div>
                        <div class="text-xs text-muted">
                          ${st.grade || ''} • ${st.phone ? `<a href="tel:${st.phone}" style="color:inherit; text-decoration:none;">📞 ${st.phone}</a>` : 'тел. не указан'}
                        </div>
                      </div>
                    </div>

                    <!-- Category Points Section (Direct 1-Click Pills + Category Modals) -->
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                      <span class="student-live-points" data-sid="${st.id}" style="font-size:0.85rem; font-weight:800; background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:4px 10px; border-radius:9999px; min-width:65px; text-align:center;">
                        ⭐ ${st.totalPoints || 0}
                      </span>

                      <button type="button" class="scoring-category-pill sm btn-student-cat-pill" data-sid="${st.id}" data-pts="10" data-type="add" data-cat="Активность" data-label="Хороший ответ" title="Начислить +10 за хороший ответ">
                        <span>👍</span>
                        <span>Хороший ответ</span>
                        <span class="pill-pts-badge add">+10 ⭐</span>
                      </button>

                      <button type="button" class="scoring-category-pill sm btn-student-cat-pill" data-sid="${st.id}" data-pts="15" data-type="add" data-cat="Активность" data-label="Хорошая работа на уроке" title="Начислить +15 за работу на уроке">
                        <span>⭐</span>
                        <span>Хорошая работа</span>
                        <span class="pill-pts-badge add">+15 ⭐</span>
                      </button>

                      <button type="button" class="scoring-category-pill sm btn-student-cat-pill" data-sid="${st.id}" data-pts="20" data-type="add" data-cat="Домашнее задание" data-label="Домашнее задание" title="Начислить +20 за ДЗ">
                        <span>📝</span>
                        <span>ДЗ</span>
                        <span class="pill-pts-badge add">+20 ⭐</span>
                      </button>

                      <button type="button" class="scoring-category-pill sm btn-student-cat-pill" data-sid="${st.id}" data-pts="15" data-type="add" data-cat="Чтение / Reading" data-label="Чтение" title="Начислить +15 за чтение">
                        <span>📖</span>
                        <span>Чтение</span>
                        <span class="pill-pts-badge add">+15 ⭐</span>
                      </button>

                      <!-- Open All Plus Categories Modal -->
                      <button type="button" class="scoring-category-pill sm btn-open-student-scoring-modal" data-sid="${st.id}" data-tab="add" title="Все категории начисления баллов" style="background:#f0fdf4; border-color:#86efac; color:#15803d; font-weight:700;">
                        <span>➕ Категории...</span>
                      </button>

                      <!-- Open Deduction Minus Categories Modal -->
                      <button type="button" class="scoring-category-pill sm pill-deduct btn-open-student-scoring-modal" data-sid="${st.id}" data-tab="deduct" title="Списать баллы (не сделал ДЗ, телефон, нарушение)" style="font-weight:700;">
                        <span>➖ Списать...</span>
                      </button>

                      <button type="button" class="btn btn-xs btn-ghost btn-quick-custom-pts" data-sid="${st.id}" title="Свои произвольные баллы" style="padding:4px 8px; border:1px dashed var(--color-border); border-radius:9999px;">
                        ✏️
                      </button>
                    </div>

                    <!-- Payment Status & 1-Click Action -->
                    <div style="display:flex; align-items:center; gap:6px; margin-left:auto;">
                      ${isPaid ? `
                        <span class="badge" style="background:#dcfce7; color:#15803d; border:1px solid #86efac; font-weight:700; font-size:0.75rem; padding:5px 10px; border-radius:var(--radius-full);" title="Оплачено ${payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('ru-RU') : ''}">
                          ✓ Оплачено
                        </span>
                        <button class="btn btn-xs btn-ghost text-muted btn-toggle-cabinet-payment" data-sid="${st.id}" data-action="unpaid" title="Отменить отметку оплаты при ошибке" style="font-size:0.7rem; padding:2px 6px;">
                          ✕ отмена
                        </button>
                      ` : `
                        <button class="btn btn-xs btn-toggle-cabinet-payment" data-sid="${st.id}" data-action="paid" style="background:#fee2e2; border:1.5px solid #ef4444; color:#b91c1c; font-weight:700; font-size:0.75rem; padding:5px 12px; border-radius:var(--radius-full); cursor:pointer; display:inline-flex; align-items:center; gap:5px;" title="Нажмите, чтобы отметить оплату за ${currMonth.name}">
                          <span>⏳ Не оплачено</span>
                          <span style="background:#b91c1c; color:#fff; padding:1px 6px; border-radius:10px; font-size:0.65rem;">+ 💳 Принять</span>
                        </button>
                      `}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </div>

      <!-- Full Interactive Weekly Schedule Section (Matches Screenshot 1) -->
      <div style="margin-bottom: var(--space-6);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:var(--space-2); margin-bottom:var(--space-3);">
          <div>
            <h2 style="font-size:1.3rem; font-weight:800; color:var(--color-text-main); margin:0;">
              📅 Мое расписание занятий
            </h2>
            <p class="text-xs text-muted" style="margin-top:2px;">
              Интерактивная недельная сетка с автоматическим продлением уроков. Кликните по слоту для добавления или редактирования урока.
            </p>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <button type="button" class="btn btn-vacation-toggle ${store.isVacation() ? 'status-vacation' : 'status-study'}" id="btn-cabinet-vacation-toggle">
              ${store.isVacation() ? '🎓 Выход на учёбу' : '🏖️ Выход на каникулы'}
            </button>
            <button type="button" class="btn btn-primary btn-sm" id="btn-cabinet-add-lesson">
              ➕ Добавить урок
            </button>
          </div>
        </div>

        <div class="weekly-schedule-wrapper">
          ${store.isVacation() ? `
            <div class="schedule-vacation-banner">
              <div style="display:flex; align-items:center; gap:12px;">
                <span style="font-size:1.8rem;">🏖️</span>
                <div>
                  <div class="vacation-title">Школа на каникулах — регулярные занятия приостановлены</div>
                  <div class="vacation-desc">Уроки временно заморожены. Для возобновления занятий нажмите «🎓 Выход на учёбу».</div>
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-success btn-cabinet-resume-school-trigger" style="font-weight:700;">
                🎓 Возобновить занятия
              </button>
            </div>
          ` : ''}

          <div class="weekly-schedule-toolbar">
            <div class="weekly-nav-controls">
              <button type="button" class="weekly-nav-btn" id="btn-cab-week-prev" title="Предыдущая неделя">◀</button>
              <button type="button" class="weekly-nav-btn" id="btn-cab-week-today" title="Текущая неделя">Сегодня</button>
              <button type="button" class="weekly-nav-btn" id="btn-cab-week-next" title="Следующая неделя">▶</button>
              <span class="weekly-range-title">${ScheduleView.formatWeekRangeTitle(ScheduleView.getMondayDate())}</span>
            </div>

            <div class="weekly-actions-group">
              <div style="display:flex; align-items:center; gap:6px;">
                <label class="form-label text-xs" style="margin:0; font-weight:700;">Группа:</label>
                <select id="filter-cab-weekly-group" class="form-control form-control-sm" style="font-weight:600; min-width:170px;">
                  <option value="all">🌐 Все мои группы</option>
                  ${myGroups.map(g => `<option value="${g.id}">👥 ${g.name}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <div class="weekly-grid-container-mount" id="cabinet-weekly-grid-mount">
            ${ScheduleView.renderWeeklyGridHtml({ teacherId: teacher.id })}
          </div>
        </div>
      </div>

      <!-- Students Directory & Phone Management Card (Full Width) -->
      <div class="card" style="margin-bottom: var(--space-6);">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:var(--space-2);">
            <div>
              <h3 class="card-title">🎒 Мои ученики и доступы (${allTeacherStudents.length})</h3>
              <p class="card-subtitle">Телефоны и 4-значные PIN-коды для входа</p>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button class="btn btn-outline-primary btn-sm" id="btn-cabinet-import-docx" style="font-size:var(--font-size-xs);" title="Загрузить сразу нескольких учеников из Word (.docx)">
                📥 Импорт из Word
              </button>
              <a href="#groups" class="btn btn-ghost btn-sm" style="font-size:var(--font-size-xs); border:1px solid var(--color-border);" title="Перейти к группам для печати карточек">
                🖨️ Карточки ➔
              </a>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: var(--space-3); max-height: 520px; overflow-y: auto;">
            ${allTeacherStudents.length === 0 ? `
              <div class="text-sm text-muted text-center" style="padding: var(--space-6) 0;">
                Закрепленных учеников нет
              </div>
            ` : allTeacherStudents.map(st => {
              const grp = store.getGroupById(st.groupId);
              const pin = store.getStudentPin(st);
              return `
                <div style="border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-3); background: var(--color-bg-subtle);">
                  <div style="display: flex; align-items: flex-start; justify-content: space-between;">
                    <div>
                      <div style="font-weight: 700; font-size: var(--font-size-sm);">${st.fullName}</div>
                      <div class="text-xs text-muted">${st.grade} • ${st.shift} смена • ${st.school}</div>
                      ${grp ? `<button type="button" class="badge badge-planned btn-cabinet-open-classroom" data-gid="${grp.id}" style="font-size:0.65rem; margin-top:2px; cursor:pointer; border:none; text-decoration:none;" title="Открыть кабинет класса: турнирная таблица и игры">👥 ${grp.name} ➔</button>` : ''}
                    </div>
                    <span class="student-points-badge">⭐ ${st.totalPoints || 0}</span>
                  </div>

                  <div style="margin-top: var(--space-2); padding: var(--space-2); background: #ffffff; border-radius: var(--radius-md); border: 1px dashed var(--color-border); font-size: var(--font-size-xs);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                      <span>📱 <strong>Логин / Телефон:</strong></span>
                      <strong style="color:var(--color-primary);">${st.phone || '<span style="color:var(--color-danger)">Не указан</span>'}</strong>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
                      <span>🔑 <strong>Персональный PIN:</strong></span>
                      <strong style="color:#4338ca; font-family:monospace; font-size:0.85rem; letter-spacing:0.1em; background:#e0e7ff; padding:1px 6px; border-radius:4px;">${pin}</strong>
                    </div>
                  </div>

                  <div style="margin-top: var(--space-2); display: flex; justify-content: flex-end; align-items: center; gap: var(--space-2);">
                    <button class="btn btn-sm btn-secondary btn-teacher-edit-phone" data-id="${st.id}" style="padding: 2px 8px; font-size: 0.75rem;">
                      📱 Номер
                    </button>
                    <button class="btn btn-sm btn-outline-primary btn-teacher-student-details" data-id="${st.id}" style="padding: 2px 8px; font-size: 0.75rem;">
                      Карточка
                    </button>
                    <button class="btn btn-sm btn-ghost btn-teacher-delete-student" data-id="${st.id}" title="Удалить ученика" style="padding: 2px 6px; font-size: 0.8rem; color:var(--color-danger);">
                      🗑️
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
            </div>
          </div>
        </div>

      <!-- Student Purchases Section in Teacher Cabinet -->
      <div class="card" style="margin-top: var(--space-6);">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2);">
          <div>
            <h3 class="card-title">🛍️ Покупки моих учеников в магазине</h3>
            <p class="card-subtitle">Список купленных аватаров, рамок, титулов и товаров. Вы можете отменить покупку без штрафа для ученика с автоматическим возвратом баллов.</p>
          </div>
          <a href="#shop" class="btn btn-secondary btn-sm">Перейти в магазин ➔</a>
        </div>

        <div>
          ${teacherPurchases.length === 0 ? `
            <div class="empty-state" style="padding: var(--space-6) 0;">
              <div class="empty-state-icon">🛍️</div>
              <div class="empty-state-title">Покупок пока нет</div>
              <div class="empty-state-desc">Когда ученики совершат покупки в магазине за баллы, они отобразятся здесь.</div>
            </div>
          ` : `
            <div class="table-responsive">
              <table class="table" style="font-size: var(--font-size-xs);">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Ученик</th>
                    <th>Товар</th>
                    <th>Тип</th>
                    <th>Списано</th>
                    <th>Статус</th>
                    <th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  ${teacherPurchases.map(pur => {
                    const st = store.getStudentById(pur.studentId);
                    const isCompleted = pur.status === 'completed';
                    return `
                      <tr>
                        <td>${new Date(pur.date).toLocaleDateString('ru-RU')}</td>
                        <td><strong>${st ? st.fullName : pur.studentName || '—'}</strong></td>
                        <td>${pur.itemName}</td>
                        <td>
                          <span class="badge" style="font-size:0.65rem;">
                            ${pur.itemType === 'avatar' ? '🎭 Аватар' : pur.itemType === 'frame' ? '🖼️ Рамка' : pur.itemType === 'title' ? '👑 Титул' : '📦 Товар'}
                          </span>
                        </td>
                        <td><strong style="color:#f59e0b;">${pur.price} ⭐</strong></td>
                        <td>
                          <span class="badge badge-${isCompleted ? 'completed' : 'cancelled'}">
                            ${isCompleted ? '✓ Оплачен' : '✕ Отменен'}
                          </span>
                        </td>
                        <td>
                          ${isCompleted ? `
                            <button class="btn btn-danger btn-xs btn-teacher-cancel-purchase" data-id="${pur.id}" title="Отменить покупку и вернуть ${pur.price} баллов">
                              ❌ Отменить покупку
                            </button>
                          ` : `
                            <span class="text-muted text-xs">Баллы возвращены (${pur.cancelledBy || 'отмена'})</span>
                          `}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;

    this.bindEvents(container, teacher, { activeGroup, activeGroupStudents, activeLesson, currMonth });
  },

  bindEvents(container, teacher, context = {}) {
    const { activeGroup, activeGroupStudents = [], activeLesson, currMonth = store.getCurrentAcademicMonth() } = context;

    // Active Group Selector
    container.querySelector('#select-cabinet-active-group')?.addEventListener('change', (e) => {
      this.selectedGroupId = e.target.value;
      this.selectedStudentIds = null;
      this.render(container);
    });

    // Classroom Cabinet Modal (Class ranking & Mini-games weekly cap tracker)
    container.querySelectorAll('.btn-cabinet-open-classroom').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const gid = e.currentTarget.getAttribute('data-gid') || this.selectedGroupId || (activeGroup ? activeGroup.id : null);
        if (gid) {
          openClassroomModal(gid, () => this.render(container));
        } else {
          toast.info('Пожалуйста, выберите группу');
        }
      });
    });

    container.querySelector('#stat-teacher-my-groups')?.addEventListener('click', () => {
      const gid = this.selectedGroupId || (activeGroup ? activeGroup.id : null);
      if (gid) {
        openClassroomModal(gid, () => this.render(container));
      } else {
        window.location.hash = '#groups';
      }
    });

    // Activity Logs & Diagnostics in Teacher Cabinet
    container.querySelector('#btn-cabinet-activity-logs')?.addEventListener('click', () => {
      AdminDashboard.openActivityLogsModal();
    });

    container.querySelector('#btn-cabinet-copy-diag')?.addEventListener('click', async () => {
      const ok = await logger.copyDiagnosticsToClipboard();
      if (ok) toast.success('Технический лог диагностики скопирован в буфер обмена!');
    });

    // Conduct Lesson / Toggle Status in 1-Click
    container.querySelectorAll('.btn-cabinet-conduct-lesson').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const lid = e.currentTarget.getAttribute('data-lid');
        const lDate = e.currentTarget.getAttribute('data-date') || new Date().toISOString().slice(0, 10);
        const lParts = lDate.split('-');
        const lShort = lParts.length === 3 ? `${lParts[2]}.${lParts[1]}` : '';
        const currentStatus = currentLesson?.exceptions?.[lDate]?.status || currentLesson?.exceptions?.[lShort]?.status || currentLesson?.status || 'planned';

        if (currentStatus === 'completed') {
          modal.open({
            title: `Статус урока группы «${activeGroup ? activeGroup.name : ''}»`,
            bodyHtml: `
              <div style="font-size:var(--font-size-sm); margin-bottom:16px;">
                Урок на <strong>${lDate}</strong> сейчас отмечен как <strong>✓ Проведен</strong>.
                <br>Выберите действие:
              </div>
              <div style="display:flex; flex-direction:column; gap:10px;">
                <button type="button" class="btn btn-outline-primary btn-set-status-planned" style="justify-content:flex-start; text-align:left; padding:10px 14px;">
                  ⏳ <strong>Сделать «Запланирован»</strong>
                  <div class="text-xs text-muted">Вернуть урок в статус ожидания проведения</div>
                </button>
                <button type="button" class="btn btn-outline-danger btn-set-status-cancelled" style="justify-content:flex-start; text-align:left; padding:10px 14px;">
                  🚫 <strong>Отметить «Отменен»</strong>
                  <div class="text-xs text-muted">Урок не состоялся</div>
                </button>
              </div>
            `,
            footerHtml: `
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Закрыть</button>
            `,
            onOpen: () => {
              document.querySelector('.btn-set-status-planned')?.addEventListener('click', () => {
                store.updateLessonStatus(lid, 'planned', lDate);
                modal.close();
                toast.info('Статус урока изменен на «Запланирован»');
                this.render(container);
              });
              document.querySelector('.btn-set-status-cancelled')?.addEventListener('click', () => {
                store.updateLessonStatus(lid, 'cancelled', lDate);
                modal.close();
                toast.warning('Урок отмечен как «Отменен»');
                this.render(container);
              });
            }
          });
        } else {
          store.updateLessonStatus(lid, 'completed', lDate);
          toast.success('Урок отмечен как проведенный! Домашнее задание и новые слова открыты для учеников.');
          this.render(container);
        }
      });
    });

    // Student selection checkboxes
    container.querySelectorAll('.student-select-cb').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const sid = e.target.getAttribute('data-sid');
        if (e.target.checked) {
          this.selectedStudentIds.add(sid);
        } else {
          this.selectedStudentIds.delete(sid);
        }
        const countEl = container.querySelector('#selected-students-count');
        if (countEl) countEl.textContent = this.selectedStudentIds.size;
      });
    });

    container.querySelector('#btn-select-all-students')?.addEventListener('click', () => {
      activeGroupStudents.forEach(s => this.selectedStudentIds.add(s.id));
      container.querySelectorAll('.student-select-cb').forEach(cb => { cb.checked = true; });
      const countEl = container.querySelector('#selected-students-count');
      if (countEl) countEl.textContent = this.selectedStudentIds.size;
    });

    container.querySelector('#btn-deselect-all-students')?.addEventListener('click', () => {
      this.selectedStudentIds.clear();
      container.querySelectorAll('.student-select-cb').forEach(cb => { cb.checked = false; });
      const countEl = container.querySelector('#selected-students-count');
      if (countEl) countEl.textContent = 0;
    });

    // Lesson Attendance modal
    container.querySelectorAll('.btn-teacher-attendance').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const lid = e.currentTarget.getAttribute('data-id');
        if (lid) {
          openAttendanceModal(lid, () => {
            this.render(container);
          });
        }
      });
    });

    // Toggle Group Scoring Mode (add / deduct)
    container.querySelectorAll('.group-scoring-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.groupScoringMode = e.currentTarget.getAttribute('data-mode') || 'add';
        this.render(container);
      });
    });

    // Batch Category Pills for Selected Students
    container.querySelectorAll('.btn-batch-cat-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const pts = parseInt(e.currentTarget.getAttribute('data-points'), 10);
        const type = e.currentTarget.getAttribute('data-type') || 'add';
        const cat = e.currentTarget.getAttribute('data-category');
        const label = e.currentTarget.getAttribute('data-label');

        const targetStudents = activeGroupStudents.filter(s => this.selectedStudentIds && this.selectedStudentIds.has(s.id));
        if (targetStudents.length === 0) {
          toast.warning('Выберите хотя бы одного ученика с помощью чекбоксов');
          return;
        }

        const items = targetStudents.map(s => ({
          studentId: s.id,
          teacherId: teacher.id,
          points: pts,
          type: type === 'deduct' ? 'deduct' : 'add',
          category: cat || label,
          comment: `${label} (группа ${activeGroup ? activeGroup.name : ''})`
        }));

        store.awardPointsBatch(items);
        const sign = type === 'deduct' ? '-' : '+';
        toast.success(`${sign}${pts} ⭐ («${label}») для ${targetStudents.length} выбранных учеников!`);
        this.render(container);
      });
    });

    // Custom Batch Points for Selected Students
    container.querySelector('.btn-batch-group-pts-custom')?.addEventListener('click', () => {
      const targetStudents = activeGroupStudents.filter(s => this.selectedStudentIds && this.selectedStudentIds.has(s.id));
      if (targetStudents.length === 0) {
        toast.warning('Выберите хотя бы одного ученика с помощью чекбоксов');
        return;
      }
      modal.open({
        title: `⭐ Начисление баллов (${targetStudents.length} уч.)`,
        bodyHtml: `
          <form id="form-batch-custom-pts">
            <div class="form-group">
              <label class="form-label">Количество баллов каждому выбранному ученику <span class="required">*</span></label>
              <input type="number" name="points" class="form-control" value="20" min="1" max="2000" required autofocus>
            </div>
            <div class="form-group">
              <label class="form-label">Категория начисления</label>
              <select name="category" class="form-control">
                <option value="Активность на уроке">Активность на уроке</option>
                <option value="Чтение / Reading">Чтение / Reading</option>
                <option value="Домашнее задание">Домашнее задание</option>
                <option value="Контрольная работа / Тест">Контрольная работа / Тест</option>
                <option value="Отличная работа">Отличная работа</option>
                <option value="Спец. задание">Спец. задание</option>
                <option value="Бонус тестирования">🎁 Бонус тестирования</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Комментарий</label>
              <input type="text" name="comment" class="form-control" placeholder="например, Чтение текста">
            </div>
            <div class="form-group" style="background: #fefce8; border: 1.5px solid #fde047; padding: 10px 14px; border-radius: var(--radius-md);">
              <label style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer; margin: 0; font-size: var(--font-size-xs); color: #854d0e; font-weight: 700;">
                <input type="checkbox" name="excludeFromRating" style="margin-top: 2px; width: 15px; height: 15px;">
                <span>
                  🎁 Без учёта в рейтинге месяца (только на баланс магазина)
                  <span style="display: block; font-size: 0.72rem; color: #a16207; font-weight: normal; margin-top: 2px;">
                    Баллы поступят на баланс учеников для покупок в магазине, но не будут влиять на ежемесячный лидерборд.
                  </span>
                </span>
              </label>
            </div>
          </form>
        `,
        footerHtml: `
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Отмена</button>
          <button type="submit" form="form-batch-custom-pts" class="btn btn-primary">Начислить (${targetStudents.length} уч.)</button>
        `,
        onOpen: () => {
          document.getElementById('form-batch-custom-pts')?.addEventListener('submit', (ev) => {
            ev.preventDefault();
            const fd = new FormData(ev.target);
            const pts = parseInt(fd.get('points'), 10);
            const cat = fd.get('category');
            const comm = fd.get('comment')?.trim() || cat;
            const excludeFromRating = Boolean(fd.get('excludeFromRating'));
            if (!pts || isNaN(pts)) return;
            const items = targetStudents.map(s => ({
              studentId: s.id,
              teacherId: teacher.id,
              points: pts,
              category: cat,
              comment: comm,
              excludeFromRating
            }));
            store.awardPointsBatch(items, { excludeFromRating });
            modal.close();
            toast.success(`Начислено по +${pts} ⭐ для ${targetStudents.length} учеников!${excludeFromRating ? ' (без рейтинга)' : ''}`);
            this.render(container);
          });
        }
      });
    });

    // Individual 1-Click Category Pill on Student Row
    container.querySelectorAll('.btn-student-cat-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sid = e.currentTarget.getAttribute('data-sid');
        const pts = parseInt(e.currentTarget.getAttribute('data-pts'), 10);
        const type = e.currentTarget.getAttribute('data-type') || 'add';
        const cat = e.currentTarget.getAttribute('data-cat') || 'Активность';
        const label = e.currentTarget.getAttribute('data-label') || cat;
        const st = store.getStudentById(sid);

        store.awardPoints({
          studentId: sid,
          teacherId: teacher.id,
          points: pts,
          type: type,
          category: cat,
          comment: `${label} (урок ${activeGroup ? activeGroup.name : ''})`
        });

        const sign = type === 'deduct' ? '-' : '+';
        toast.success(`${sign}${pts} ⭐ («${label}») для ${st ? st.fullName : 'ученика'}`);

        const badge = container.querySelector(`.student-live-points[data-sid="${sid}"]`);
        if (badge) {
          const updatedSt = store.getStudentById(sid);
          badge.textContent = `⭐ ${updatedSt ? updatedSt.totalPoints : 0}`;
          badge.style.transform = 'scale(1.25)';
          badge.style.transition = 'transform 0.2s ease';
          setTimeout(() => { badge.style.transform = 'scale(1)'; }, 200);
        }
      });
    });

    // Open Student Full Scoring Modal (All Categories for + and -)
    container.querySelectorAll('.btn-open-student-scoring-modal').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sid = e.currentTarget.getAttribute('data-sid');
        const tab = e.currentTarget.getAttribute('data-tab') || 'add';
        this.openStudentScoringModal(sid, tab, container);
      });
    });

    // Custom Individual Points in Active Group Card
    container.querySelectorAll('.btn-quick-custom-pts').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sid = e.currentTarget.getAttribute('data-sid');
        const st = store.getStudentById(sid);
        if (!st) return;
        modal.open({
          title: `⭐ Баллы: ${st.fullName}`,
          bodyHtml: `
            <form id="form-indiv-custom-pts">
              <div class="form-group">
                <label class="form-label">Количество баллов (+ или -)</label>
                <input type="number" name="points" class="form-control" value="15" min="-2000" max="2000" required autofocus>
              </div>
              <div class="form-group">
                <label class="form-label">Причина / Категория</label>
                <input type="text" name="comment" class="form-control" value="Активность на уроке" placeholder="Причина">
              </div>
              <div class="form-group" style="background: #fefce8; border: 1.5px solid #fde047; padding: 8px 12px; border-radius: var(--radius-md);">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 0; font-size: var(--font-size-xs); color: #854d0e; font-weight: 700;">
                  <input type="checkbox" name="excludeFromRating" style="width: 15px; height: 15px;">
                  <span>🎁 Без учёта в рейтинге месяца (только на баланс магазина)</span>
                </label>
              </div>
            </form>
          `,
          footerHtml: `
            <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Отмена</button>
            <button type="submit" form="form-indiv-custom-pts" class="btn btn-primary">Сохранить</button>
          `,
          onOpen: () => {
            document.getElementById('form-indiv-custom-pts')?.addEventListener('submit', (ev) => {
              ev.preventDefault();
              const fd = new FormData(ev.target);
              const rawPts = parseInt(fd.get('points'), 10);
              const comm = fd.get('comment')?.trim() || 'Активность на уроке';
              const excludeFromRating = Boolean(fd.get('excludeFromRating'));
              if (isNaN(rawPts) || rawPts === 0) return;
              store.awardPoints({
                studentId: sid,
                teacherId: teacher.id,
                points: Math.abs(rawPts),
                type: rawPts >= 0 ? 'add' : 'deduct',
                category: comm,
                comment: comm,
                excludeFromRating
              });
              modal.close();
              toast.success(`${rawPts > 0 ? '+' : ''}${rawPts} ⭐ для ${st.fullName}${excludeFromRating ? ' (без рейтинга)' : ''}`);
              this.render(container);
            });
          }
        });
      });
    });

    // Toggle Payment in Active Group Card
    container.querySelectorAll('.btn-toggle-cabinet-payment').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sid = e.currentTarget.getAttribute('data-sid');
        const action = e.currentTarget.getAttribute('data-action');
        const st = store.getStudentById(sid);
        store.setPaymentStatus(sid, currMonth.key, action, { notes: 'Отметка на уроке в кабинете учителя' });
        if (action === 'paid') {
          toast.success(`✓ Оплата за ${currMonth.name} для ${st ? st.fullName : 'ученика'} сохранена!`);
        } else {
          toast.info(`Отметка оплаты для ${st ? st.fullName : 'ученика'} отменена.`);
        }
        this.render(container);
      });
    });

    // Bulk Pay All Unpaid in Active Group
    container.querySelectorAll('.btn-cabinet-pay-all-group').forEach(btn => {
      btn.addEventListener('click', () => {
        const unpaid = activeGroupStudents.filter(s => store.getPayment(s.id, currMonth.key).status !== 'paid');
        if (unpaid.length === 0) {
          toast.info('Все ученики этой группы уже оплатили абонемент за текущий месяц!');
          return;
        }
        if (confirm(`Отметить оплату за ${currMonth.name} для всех ${unpaid.length} неоплативших учеников группы «${activeGroup?.name}»?\n\nСумма: ${(unpaid.length * 25000).toLocaleString('ru-RU')} ₸`)) {
          store.bulkSetPaymentStatus(unpaid.map(s => s.id), currMonth.key, 'paid');
          toast.success(`Оплата за ${currMonth.name} зафиксирована для всех учеников группы!`);
          this.render(container);
        }
      });
    });

    // Import Students from Word Trigger
    container.querySelectorAll('#btn-cabinet-import-docx, .btn-cabinet-import-docx-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        StudentsView.openImportModal(container);
      });
    });
    container.querySelectorAll('.btn-teacher-cancel-purchase').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const purId = e.currentTarget.getAttribute('data-id');
        const pur = (store.getPurchases ? store.getPurchases() : []).find(p => p.id === purId);
        if (!pur) return;
        const st = store.getStudentById(pur.studentId);
        const name = st ? st.fullName : 'ученика';
        const teacherName = teacher?.fullName || auth.getCurrentUser()?.name || 'Преподаватель';
        if (confirm(`Отменить покупку «${pur.itemName}» для ${name}?\n\nБаллы (${pur.price} ⭐) будут мгновенно возвращены на баланс ученика без штрафов.`)) {
          const res = store.cancelPurchase(purId, teacherName);
          if (res.success) {
            toast.success(res.message || `Покупка отменена! ${pur.price} ⭐ возвращены на баланс.`);
            this.render(container);
          } else {
            toast.error(res.message || 'Не удалось отменить покупку');
          }
        }
      });
    });

    container.querySelector('#btn-teacher-award-points')?.addEventListener('click', () => {
      window.location.hash = '#scoring';
      setTimeout(() => document.getElementById('btn-award-points')?.click(), 100);
    });

    // --- Cabinet Weekly Interactive Schedule Grid Events ---
    const cabGridMount = container.querySelector('#cabinet-weekly-grid-mount');

    container.querySelector('#btn-cab-week-prev')?.addEventListener('click', () => {
      ScheduleView.prevWeek();
      this.render(container);
    });

    container.querySelector('#btn-cab-week-next')?.addEventListener('click', () => {
      ScheduleView.nextWeek();
      this.render(container);
    });

    container.querySelector('#btn-cab-week-today')?.addEventListener('click', () => {
      ScheduleView.resetToToday();
      this.render(container);
    });

    container.querySelector('#btn-cabinet-vacation-toggle')?.addEventListener('click', () => {
      ScheduleView.handleVacationToggle(container);
    });

    container.querySelector('.btn-cabinet-resume-school-trigger')?.addEventListener('click', () => {
      ScheduleView.handleVacationToggle(container);
    });

    container.querySelector('#btn-cabinet-add-lesson')?.addEventListener('click', () => {
      const monStr = ScheduleView.getMondayDate().toISOString().split('T')[0];
      ScheduleView.openLessonModal(null, 1, 10, monStr, () => {
        this.render(container);
      });
    });

    container.querySelector('#filter-cab-weekly-group')?.addEventListener('change', (e) => {
      const gVal = e.target.value;
      if (cabGridMount) {
        cabGridMount.innerHTML = ScheduleView.renderWeeklyGridHtml({
          teacherId: teacher.id,
          groupId: gVal !== 'all' ? gVal : null
        });
      }
    });

    if (cabGridMount) {
      cabGridMount.addEventListener('click', (e) => {
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
            ScheduleView.openLessonModal(lesson, lesson.dayIndex || cardDayIdx, parseInt(lesson.startTime, 10) || 10, lessonDate, () => {
              this.render(container);
            });
          }
          return;
        }

        const slotEl = e.target.closest('.weekly-hour-slot');
        if (slotEl) {
          const dayIdx = parseInt(slotEl.dataset.dayIndex, 10) || 1;
          const dateStr = slotEl.dataset.date;
          const hour = parseInt(slotEl.dataset.hour, 10) || 10;
          ScheduleView.openLessonModal(null, dayIdx, hour, dateStr, () => {
            this.render(container);
          });
        }
      });
    }

    ScheduleView.scrollToActiveHour();

    container.querySelectorAll('.btn-teacher-edit-plan').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const planId = e.currentTarget.getAttribute('data-plan-id');
        const plan = store.getLessonPlanById(planId);
        if (plan) {
          LessonPlansView.openPlanModal(plan, container);
        }
      });
    });

    container.querySelectorAll('.btn-teacher-student-details').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        import('./studentsView.js').then(module => {
          module.StudentsView.openProfileModal(id);
        });
      });
    });

    // Teacher quick phone edit modal
    container.querySelectorAll('.btn-teacher-edit-phone').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.openEditPhoneModal(id, container);
      });
    });

    // Teacher delete student
    container.querySelectorAll('.btn-teacher-delete-student').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const st = store.getStudentById(id);
        if (confirm(`Удалить ученика "${st ? st.fullName : ''}" из базы школы?`)) {
          store.deleteStudent(id);
          toast.success('Ученик удален');
          this.render(container);
        }
      });
    });
  },

  openEditPhoneModal(studentId, container) {
    const student = store.getStudentById(studentId);
    if (!student) return;

    modal.open({
      title: `📱 Номер телефона: ${student.fullName}`,
      bodyHtml: `
        <form id="form-teacher-edit-phone">
          <div class="form-hint" style="margin-bottom:var(--space-4); background:var(--color-bg-app); padding:var(--space-3); border-radius:var(--radius-md);">
            По этому номеру телефона и PIN-коду из памятки ученик входит в свой личный кабинет.
          </div>

          <div class="form-group">
            <label class="form-label">Основной номер телефона ученика <span class="required">*</span></label>
            <input type="tel" name="phone" class="form-control" value="${student.phone || ''}" placeholder="+7 (999) 000-00-00" required autofocus>
          </div>

          <div class="form-group">
            <label class="form-label">Телефон родителей (запасной для связи)</label>
            <input type="tel" name="parentPhone" class="form-control" value="${student.parentPhone || ''}" placeholder="+7 (999) 000-00-00">
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Отмена</button>
        <button type="submit" form="form-teacher-edit-phone" class="btn btn-primary">Сохранить номер</button>
      `,
      onOpen: () => {
        document.getElementById('form-teacher-edit-phone')?.addEventListener('submit', (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const newPhone = formData.get('phone');
          const newParentPhone = formData.get('parentPhone');

          store.updateStudent(studentId, {
            phone: newPhone,
            parentPhone: newParentPhone
          });

          modal.close();
          toast.success(`Номер для ${student.fullName} сохранен! Теперь ученик может войти по номеру телефона и PIN.`);
          this.render(container);
        });
      }
    });
  },

  openStudentScoringModal(studentId, initialTab = 'add', container) {
    const student = store.getStudentById(studentId);
    if (!student) return;

    const teacherUser = auth.getCurrentUser();
    const teacherId = teacherUser.id;
    const teacher = store.getTeacherById(teacherId) || store.getTeachers()[0];

    let currentTab = initialTab; // 'add' | 'deduct'

    const renderModalContent = () => {
      const templates = currentTab === 'deduct' ? SCORING_TEMPLATES.deduct : SCORING_TEMPLATES.add;
      const isDeduct = currentTab === 'deduct';
      const liveStudent = store.getStudentById(studentId) || student;

      return `
        <!-- Student Info Header -->
        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background:var(--color-bg-app); border-radius:var(--radius-lg); margin-bottom:14px; border:1px solid var(--color-border);">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:42px; height:42px; border-radius:var(--radius-full); background:#4f46e5; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:1rem; flex-shrink:0;">
              ${liveStudent.avatarUrl && liveStudent.avatarUrl.length <= 4 ? liveStudent.avatarUrl : liveStudent.fullName.split(' ').map(n=>n[0]).slice(0,2).join('')}
            </div>
            <div>
              <div style="font-weight:700; font-size:var(--font-size-base); color:var(--color-text-main);">${liveStudent.fullName}</div>
              <div class="text-xs text-muted">${liveStudent.grade || ''} • ${liveStudent.school || ''}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <span class="student-live-points" data-sid="${liveStudent.id}" style="font-size:0.95rem; font-weight:800; background:#fef3c7; color:#b45309; border:1px solid #fde68a; padding:5px 12px; border-radius:9999px; display:inline-block;">
              ⭐ ${liveStudent.totalPoints || 0}
            </span>
          </div>
        </div>

        <!-- Mode Segmented Tabs -->
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <button type="button" class="group-scoring-tab-btn ${!isDeduct ? 'active tab-add' : ''}" id="modal-tab-add" style="flex:1; padding:8px 12px; text-align:center; font-size:0.85rem;">
            🟢 Начисление (+)
          </button>
          <button type="button" class="group-scoring-tab-btn ${isDeduct ? 'active tab-deduct' : ''}" id="modal-tab-deduct" style="flex:1; padding:8px 12px; text-align:center; font-size:0.85rem;">
            🔴 Списание (-)
          </button>
        </div>

        <div class="text-xs text-muted" style="margin-bottom:10px; font-weight:600;">
          ${isDeduct ? '⚠️ Выберите причину списания баллов (штраф / несданное ДЗ):' : '✨ Выберите категорию поощрения (нажмите для мгновенного начисления):'}
        </div>

        <!-- Category Pills Grid -->
        <div style="display:flex; flex-wrap:wrap; gap:8px; max-height:280px; overflow-y:auto; padding:2px;">
          ${templates.map(tpl => `
            <button type="button" class="scoring-category-pill ${isDeduct ? 'pill-deduct' : ''} btn-modal-category-pill" 
              data-pts="${tpl.points}" 
              data-type="${isDeduct ? 'deduct' : 'add'}" 
              data-cat="${tpl.category}" 
              data-label="${tpl.label}"
              data-exclude="${tpl.excludeFromRating ? '1' : '0'}"
              title="${isDeduct ? 'Списать' : 'Начислить'} ${tpl.points} ⭐"
              style="padding:8px 14px; font-size:0.85rem;">
              <span style="font-size:1.15rem;">${tpl.icon}</span>
              <span>${tpl.label}</span>
              <span class="pill-pts-badge ${isDeduct ? 'deduct' : 'add'}">
                ${isDeduct ? '-' : '+'}${tpl.points} ⭐
              </span>
            </button>
          `).join('')}
        </div>

        <!-- Custom points row -->
        <div style="margin-top:16px; padding-top:12px; border-top:1px dashed var(--color-border); display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span class="text-xs text-muted" style="font-weight:600; white-space:nowrap;">✏️ Свои баллы:</span>
          <input type="number" id="modal-custom-pts-input" class="form-control form-control-sm" style="width:85px;" value="15" min="1" max="2000" placeholder="Баллы">
          <input type="text" id="modal-custom-pts-comment" class="form-control form-control-sm" style="flex:1; min-width:140px;" placeholder="Причина / комментарий...">
          <button type="button" id="btn-modal-custom-pts-submit" class="btn btn-sm btn-secondary" style="font-size:var(--font-size-xs);">
            ${isDeduct ? 'Списать' : 'Начислить'}
          </button>
          <label style="display:flex; align-items:center; gap:6px; font-size:var(--font-size-xs); color:#854d0e; cursor:pointer; width:100%; margin-top:6px;">
            <input type="checkbox" id="modal-custom-pts-no-rating" style="width:14px; height:14px;">
            <span>🎁 Без учёта в рейтинге месяца (только на баланс магазина)</span>
          </label>
        </div>
      `;
    };

    const bindModalEvents = () => {
      const modalBody = document.querySelector('#main-modal .modal-body');
      if (!modalBody) return;

      // Tab switcher
      modalBody.querySelector('#modal-tab-add')?.addEventListener('click', () => {
        currentTab = 'add';
        modalBody.innerHTML = renderModalContent();
        bindModalEvents();
      });

      modalBody.querySelector('#modal-tab-deduct')?.addEventListener('click', () => {
        currentTab = 'deduct';
        modalBody.innerHTML = renderModalContent();
        bindModalEvents();
      });

      // Category Pill Click
      modalBody.querySelectorAll('.btn-modal-category-pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const pts = parseInt(e.currentTarget.getAttribute('data-pts'), 10);
          const type = e.currentTarget.getAttribute('data-type') || 'add';
          const cat = e.currentTarget.getAttribute('data-cat') || 'Активность';
          const label = e.currentTarget.getAttribute('data-label') || cat;
          const excludeFromRating = e.currentTarget.getAttribute('data-exclude') === '1';

          store.awardPoints({
            studentId: student.id,
            teacherId: teacher.id,
            points: pts,
            type: type,
            category: cat,
            comment: `${label} (урок)`,
            excludeFromRating
          });

          const sign = type === 'deduct' ? '-' : '+';
          toast.success(`${sign}${pts} ⭐ («${label}») для ${student.fullName}${excludeFromRating ? ' (без рейтинга)' : ''}`);
          modal.close();

          // Animate and update student points badge in row
          const badge = container.querySelector(`.student-live-points[data-sid="${student.id}"]`);
          if (badge) {
            const updatedSt = store.getStudentById(student.id);
            badge.textContent = `⭐ ${updatedSt ? updatedSt.totalPoints : 0}`;
            badge.style.transform = 'scale(1.25)';
            badge.style.transition = 'transform 0.2s ease';
            setTimeout(() => { badge.style.transform = 'scale(1)'; }, 200);
          }
        });
      });

      // Custom Points Submit
      modalBody.querySelector('#btn-modal-custom-pts-submit')?.addEventListener('click', () => {
        const inputPts = parseInt(modalBody.querySelector('#modal-custom-pts-input')?.value, 10);
        const comment = modalBody.querySelector('#modal-custom-pts-comment')?.value.trim() || (currentTab === 'deduct' ? 'Списание баллов' : 'Начисление баллов');
        const excludeFromRating = Boolean(modalBody.querySelector('#modal-custom-pts-no-rating')?.checked);

        if (isNaN(inputPts) || inputPts <= 0) {
          toast.warning('Введите корректное число баллов');
          return;
        }

        store.awardPoints({
          studentId: student.id,
          teacherId: teacher.id,
          points: inputPts,
          type: currentTab,
          category: comment,
          comment: comment,
          excludeFromRating
        });

        const sign = currentTab === 'deduct' ? '-' : '+';
        toast.success(`${sign}${inputPts} ⭐ («${comment}») для ${student.fullName}${excludeFromRating ? ' (без рейтинга)' : ''}`);
        modal.close();

        const badge = container.querySelector(`.student-live-points[data-sid="${student.id}"]`);
        if (badge) {
          const updatedSt = store.getStudentById(student.id);
          badge.textContent = `⭐ ${updatedSt ? updatedSt.totalPoints : 0}`;
          badge.style.transform = 'scale(1.25)';
          badge.style.transition = 'transform 0.2s ease';
          setTimeout(() => { badge.style.transform = 'scale(1)'; }, 200);
        }
      });
    };

    modal.open({
      title: `⭐ Управление баллами: ${student.fullName}`,
      bodyHtml: renderModalContent(),
      footerHtml: `
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Закрыть</button>
      `,
      onOpen: () => {
        bindModalEvents();
      }
    });
  }
};
