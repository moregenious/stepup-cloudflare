/**
 * Classroom Cabinet Modal Component - Step Up English
 * Displays:
 * 1. Group info & metadata (teacher, textbook, schedule, room, shift)
 * 2. Class Leaderboard (sorted by points descending: 🥇 1st, 🥈 2nd, 🥉 3rd place badges)
 * 3. Mini-games Weekly Tracker (points earned this week vs 100 pts cap, progress bar, streaks)
 * 4. Fast actions: 1-click points award/deduct, 1-click monthly payment, print QR/PIN memos
 */

import { store } from '../store.js';
import { auth } from '../auth.js';
import { modal } from './modal.js';
import { toast } from './toast.js';
import { renderStudentAvatarHtml } from './avatarCustomization.js';
import { GroupsView } from '../views/groupsView.js';
import { SCORING_TEMPLATES } from '../views/scoringView.js';
import { MONTH_NAMES } from '../data/seedData.js';

export function openClassroomModal(groupId, onRefresh = null) {
  const group = store.getGroupById(groupId);
  if (!group) {
    toast.error('Группа не найдена');
    return;
  }

  const teacher = store.getTeacherById(group.teacherId);
  const now = new Date();
  const monthNames = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];
  const currMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currMonthName = monthNames[now.getMonth()];
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  // Active filter tab inside classroom: 'leaderboard' | 'games' | 'lessons' | 'schedule'
  let activeTab = 'leaderboard';
  const currAcademicMonth = store.getCurrentAcademicMonth();
  let selectedLessonMonth = currAcademicMonth ? (currAcademicMonth.num || 2) : 1;

  const renderModalContent = () => {
    // Re-fetch fresh state
    const freshGroup = store.getGroupById(groupId) || group;
    const freshTeacher = store.getTeacherById(freshGroup.teacherId);
    const students = store.getStudentsByGroupId(groupId);
    const lessons = store.getSchedule({ groupId });

    // Calculate ranking & points for each student
    const studentStats = students.map(st => {
      const allStudentRecords = store.getPointRecords({ studentId: st.id }) || [];
      const monthPoints = allStudentRecords
        .filter(r => {
          if (!r.date) return false;
          const dt = new Date(r.date).getTime();
          return dt >= currentMonthStart && !r.excludeFromRating;
        })
        .reduce((sum, r) => sum + (Number(r.points) || 0), 0);

      const progress = store.getStudentGameProgress(st.id);
      const weeklyPoints = progress.weeklyPoints || 0;
      const weeklyLimit = progress.weeklyLimit || 100;
      const weeklyPercent = Math.min(100, Math.round((weeklyPoints / weeklyLimit) * 100));

      const payment = store.getPayment(st.id, currMonthKey);
      const isPaid = payment && payment.status === 'paid';

      return {
        student: st,
        totalPoints: Number(st.totalPoints) || 0,
        monthPoints,
        weeklyPoints,
        weeklyLimit,
        weeklyPercent,
        isPaid,
        progress
      };
    });

    // Sort strictly by month points descending (academic rating!), then total points if equal
    studentStats.sort((a, b) => {
      if (b.monthPoints !== a.monthPoints) return b.monthPoints - a.monthPoints;
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      return a.student.fullName.localeCompare(b.student.fullName, 'ru');
    });

    // Counters & Leader of the month (only if they have positive rating points)
    const leader = (studentStats.length > 0 && studentStats[0].monthPoints > 0) ? studentStats[0] : null;
    const paidCount = studentStats.filter(s => s.isPaid).length;
    const activeGamers = studentStats.filter(s => s.weeklyPoints > 0).length;
    const capReachedCount = studentStats.filter(s => s.weeklyPoints >= s.weeklyLimit).length;
    const groupConducted = store.getGroupConductedLessons(freshGroup.id);
    const groupConductedCount = groupConducted.length;

    return `
      <div class="classroom-modal-wrap" style="display:flex; flex-direction:column; gap:16px;">
        <!-- Header Class Banner -->
        <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 60%, #4338ca 100%); color:#fff; padding:16px 20px; border-radius:var(--radius-xl); box-shadow:var(--shadow-md);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span style="font-size:1.6rem;">🏫</span>
                <h2 style="margin:0; font-size:1.25rem; font-weight:800; color:#fff;">
                  ${freshGroup.name}
                </h2>
                <span class="badge badge-level level-${freshGroup.level.toLowerCase().replace(/[^a-z0-9]/g, '-')}" style="font-size:0.75rem;">
                  ${freshGroup.level}
                </span>
                <span class="badge ${freshGroup.shift === 'Первая' ? 'badge-shift-1' : 'badge-shift-2'}" style="font-size:0.75rem;">
                  ${freshGroup.shift} смена
                </span>
              </div>
              <div style="margin-top:6px; font-size:0.8rem; color:#c7d2fe; display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
                <span>👨‍🏫 Преподаватель: <strong>${freshTeacher ? freshTeacher.fullName : '—'}</strong></span>
                <span>•</span>
                <span>📚 Учебник: <strong>${freshGroup.textbook || '—'}</strong></span>
                <span>•</span>
                <span>📍 ${freshGroup.classroom || 'Кабинет школы'}</span>
                <span>•</span>
                <span>⏰ Расписание: <strong>${store.getGroupScheduleSummary(freshGroup.id).full}</strong></span>
              </div>
            </div>

            <div style="display:flex; gap:8px;">
              <button type="button" class="btn btn-sm btn-outline-light" id="btn-cls-print-memos" style="border:1px solid rgba(255,255,255,0.4); color:#fff; font-size:0.78rem; font-weight:700; background:rgba(255,255,255,0.1);" title="Распечатать памятки с QR-кодами и PIN для учеников группы">
                🖨️ Памятки QR (${students.length})
              </button>
            </div>
          </div>

          <!-- Quick Stats Pills Grid -->
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:10px; margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.15);">
            <div style="background:rgba(255,255,255,0.08); padding:8px 12px; border-radius:var(--radius-md); border:1px solid rgba(255,255,255,0.12);">
              <div style="font-size:0.7rem; color:#c7d2fe; text-transform:uppercase; font-weight:700;">🥇 Лидер месяца (${currMonthName})</div>
              <div style="font-size:0.95rem; font-weight:800; color:#fef08a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${leader ? leader.student.fullName : 'Пока нет начислений'}">
                ${leader ? `${leader.student.fullName}` : '—'}
              </div>
              <div style="font-size:0.7rem; color:#e0e7ff;">${leader ? `⭐ +${leader.monthPoints} в рейтинге` : 'Пока 0 баллов'}</div>
            </div>

            <div style="background:rgba(255,255,255,0.08); padding:8px 12px; border-radius:var(--radius-md); border:1px solid rgba(255,255,255,0.12);">
              <div style="font-size:0.7rem; color:#c7d2fe; text-transform:uppercase; font-weight:700;">🎮 Игры недели (лимит 100 ⭐)</div>
              <div style="font-size:0.95rem; font-weight:800; color:#67e8f9;">
                ${activeGamers} из ${students.length} играют
              </div>
              <div style="font-size:0.7rem; color:#a5f3fc;">
                ${capReachedCount > 0 ? `🟢 ${capReachedCount} закрыли лимит!` : '⚪ Лимит закрыт: 0'}
              </div>
            </div>

            <div style="background:rgba(255,255,255,0.08); padding:8px 12px; border-radius:var(--radius-md); border:1px solid rgba(255,255,255,0.12);">
              <div style="font-size:0.7rem; color:#c7d2fe; text-transform:uppercase; font-weight:700;">💳 Оплата (${currMonthName})</div>
              <div style="font-size:0.95rem; font-weight:800; color:${paidCount === students.length && students.length > 0 ? '#86efac' : '#fdba74'};">
                ${paidCount} из ${students.length} оплатили
              </div>
              <div style="font-size:0.7rem; color:#e0e7ff;">
                ${students.length - paidCount === 0 ? '✓ Все оплатили' : `Ожидают: ${students.length - paidCount}`}
              </div>
            </div>
          </div>
        </div>

        <!-- Segmented Tab Navigation -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; border-bottom:1px solid var(--color-border); padding-bottom:8px;">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="btn btn-sm ${activeTab === 'leaderboard' ? 'btn-primary' : 'btn-ghost'} btn-cls-tab" data-tab="leaderboard" style="font-weight:700;">
              🏆 Рейтинг
            </button>
            <button type="button" class="btn btn-sm ${activeTab === 'games' ? 'btn-primary' : 'btn-ghost'} btn-cls-tab" data-tab="games" style="font-weight:700;">
              🎮 Лимиты игр (${activeGamers}/${students.length})
            </button>
            <button type="button" class="btn btn-sm ${activeTab === 'lessons' ? 'btn-primary' : 'btn-ghost'} btn-cls-tab" data-tab="lessons" style="font-weight:700;">
              📚 Уроки (${groupConductedCount}/80)
            </button>
            <button type="button" class="btn btn-sm ${activeTab === 'schedule' ? 'btn-primary' : 'btn-ghost'} btn-cls-tab" data-tab="schedule" style="font-weight:700;">
              📅 Расписание (${lessons.length})
            </button>
          </div>

          <div style="display:flex; align-items:center; gap:8px;">
            <button type="button" class="btn btn-sm btn-outline-primary" id="btn-cls-batch-award" title="Начислить баллы всей группе">
              ⭐ Баллы всей группе
            </button>
          </div>
        </div>

        <!-- Tab 1: Leaderboard View (Default) -->
        ${activeTab === 'leaderboard' ? `
          <div class="classroom-leaderboard-list" style="display:flex; flex-direction:column; gap:8px; max-height:460px; overflow-y:auto; padding-right:4px;">
            ${studentStats.length === 0 ? `
              <div style="text-align:center; padding:32px 16px; color:var(--color-text-muted);">
                <div style="font-size:2rem; margin-bottom:6px;">👥</div>
                <div style="font-weight:600;">В этой группе пока нет учеников</div>
                <div class="text-xs" style="margin-top:4px;">Распределите учеников в группу в разделе «Учебные группы»</div>
              </div>
            ` : studentStats.map((item, idx) => {
              const st = item.student;
              const pin = store.getStudentPin(st);

              // Rank Badge Styling
              let rankBadge = '';
              let rowStyle = 'background:var(--color-bg-app); border:1px solid var(--color-border);';

              const hasPoints = item.monthPoints > 0;
              if (idx === 0 && hasPoints) {
                rankBadge = `<div style="font-size:1.35rem; font-weight:800; min-width:38px; height:38px; border-radius:var(--radius-full); background:linear-gradient(135deg, #fef08a, #f59e0b); color:#78350f; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(245,158,11,0.3); border:2px solid #fbbf24;" title="1 место (Лидер месяца)">🥇</div>`;
                rowStyle = 'background:linear-gradient(90deg, rgba(254,243,199,0.35) 0%, var(--color-bg-card) 100%); border:1.5px solid #fde68a;';
              } else if (idx === 1 && hasPoints) {
                rankBadge = `<div style="font-size:1.25rem; font-weight:800; min-width:38px; height:38px; border-radius:var(--radius-full); background:linear-gradient(135deg, #e2e8f0, #94a3b8); color:#1e293b; display:flex; align-items:center; justify-content:center; border:2px solid #cbd5e1;" title="2 место">🥈</div>`;
                rowStyle = 'background:linear-gradient(90deg, rgba(241,245,249,0.6) 0%, var(--color-bg-card) 100%); border:1px solid #cbd5e1;';
              } else if (idx === 2 && hasPoints) {
                rankBadge = `<div style="font-size:1.25rem; font-weight:800; min-width:38px; height:38px; border-radius:var(--radius-full); background:linear-gradient(135deg, #fed7aa, #ea580c); color:#431407; display:flex; align-items:center; justify-content:center; border:2px solid #fdba74;" title="3 место">🥉</div>`;
                rowStyle = 'background:linear-gradient(90deg, rgba(255,237,213,0.35) 0%, var(--color-bg-card) 100%); border:1px solid #fed7aa;';
              } else {
                rankBadge = `<div style="font-size:0.9rem; font-weight:700; min-width:38px; height:38px; border-radius:var(--radius-full); background:var(--color-bg-subtle); color:var(--color-text-muted); display:flex; align-items:center; justify-content:center; border:1px solid var(--color-border);">${idx + 1}</div>`;
              }

              // Mini-games status badge
              let gamesBadge = '';
              if (item.weeklyPoints >= item.weeklyLimit) {
                gamesBadge = `<span class="badge badge-success" style="font-size:0.7rem; font-weight:700;" title="Максимальный недельный лимит игр закрыт">🟢 ${item.weeklyPoints}/${item.weeklyLimit} ⭐ Лимит закрыт</span>`;
              } else if (item.weeklyPoints > 0) {
                gamesBadge = `<span class="badge badge-warning" style="font-size:0.7rem; font-weight:700;" title="Набрано ${item.weeklyPoints} из ${item.weeklyLimit} ⭐ в играх на этой неделе">🟡 ${item.weeklyPoints}/${item.weeklyLimit} ⭐ (ещё ${item.weeklyLimit - item.weeklyPoints} ⭐)</span>`;
              } else {
                gamesBadge = `<span class="badge badge-planned" style="font-size:0.7rem; color:#64748b; font-weight:600;" title="Не играл на этой неделе">⚪ 0/${item.weeklyLimit} ⭐ (не играл)</span>`;
              }

              return `
                <div class="classroom-student-row" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-radius:var(--radius-lg); ${rowStyle} gap:12px; flex-wrap:wrap; transition:all 0.15s ease;">
                  <!-- Left: Rank & Avatar & Details -->
                  <div style="display:flex; align-items:center; gap:12px; min-width:220px; flex:1;">
                    ${rankBadge}
                    ${renderStudentAvatarHtml(st, { size: 'md' })}
                    <div>
                      <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                        <span style="font-weight:700; font-size:var(--font-size-sm); color:var(--color-text-main);">
                          ${st.fullName}
                        </span>
                        ${st.studentTitle ? `<span class="student-title-badge light" style="font-size:0.65rem; padding:1px 6px;">${st.studentTitle}</span>` : ''}
                      </div>
                      <div class="text-xs text-muted" style="margin-top:2px;">
                        ${st.grade || 'Класс не указан'} • 
                        <span style="font-family:monospace; background:rgba(0,0,0,0.04); padding:1px 4px; border-radius:4px; font-weight:600;" title="PIN-код ученика">PIN: ${pin}</span>
                        ${st.phone ? ` • <a href="tel:${st.phone}" style="color:inherit; text-decoration:none;">📞 ${st.phone}</a>` : ''}
                      </div>
                    </div>
                  </div>

                  <!-- Middle: Mini-games status & progress bar -->
                  <div style="display:flex; flex-direction:column; gap:4px; min-width:140px;">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
                      <span class="text-xs text-muted" style="font-weight:600;">Мини-игры:</span>
                      ${gamesBadge}
                    </div>
                    <div style="height:5px; width:100%; background:var(--color-border); border-radius:9999px; overflow:hidden;">
                      <div style="height:100%; width:${item.weeklyPercent}%; background:${item.weeklyPoints >= item.weeklyLimit ? '#16a34a' : item.weeklyPoints > 0 ? '#f59e0b' : '#94a3b8'}; transition:width 0.2s ease;"></div>
                    </div>
                    ${item.progress.wordsStreak > 0 || item.progress.irregularStreak > 0 ? `
                      <div class="text-xs text-muted" style="font-size:0.68rem; margin-top:1px;">
                        🔥 Стрик: ${Math.max(item.progress.wordsStreak, item.progress.irregularStreak)}
                      </div>
                    ` : ''}
                  </div>

                  <!-- Right: Rating Points & Shop Balance -->
                  <div style="display:flex; align-items:center; gap:10px;">
                    <div style="text-align:right;">
                      <div style="font-size:1.15rem; font-weight:800; color:#b45309;" title="Рейтинговые баллы за ${currMonthName}">
                        ⭐ ${item.monthPoints >= 0 ? `+${item.monthPoints}` : item.monthPoints}
                      </div>
                      <div style="font-size:0.7rem; color:var(--color-text-muted);" title="Баланс для покупок в магазине Step Up (включая подарочные бонусы)">
                        Баланс: ${item.totalPoints} ⭐
                      </div>
                    </div>

                    <div style="display:flex; gap:6px;">
                      <button type="button" class="btn btn-xs btn-primary btn-cls-award-single" data-sid="${st.id}" title="Поставить или списать баллы ученику">
                        ⭐ Оценить
                      </button>
                      ${item.isPaid ? `
                        <span class="badge badge-success" style="font-size:0.7rem; padding:4px 8px;" title="Оплата за ${currMonthName} внесена">✓ Оплачено</span>
                      ` : `
                        <button type="button" class="btn btn-xs btn-outline-success btn-cls-mark-paid" data-sid="${st.id}" title="Отметить оплату за ${currMonthName}">
                          💳 Оплатить
                        </button>
                      `}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        <!-- Tab 2: Detailed Mini-Games Tracker View -->
        ${activeTab === 'games' ? `
          <div style="display:flex; flex-direction:column; gap:10px; max-height:460px; overflow-y:auto; padding-right:4px;">
            <div style="background:var(--color-bg-app); border:1px solid var(--color-border); border-radius:var(--radius-md); padding:10px 14px; font-size:var(--font-size-xs); color:var(--color-text-secondary);">
              ℹ️ <strong>Система лимитов:</strong> Каждый ученик может заработать максимум <strong>100 ⭐ в неделю</strong> в мини-играх и тренажерах (слова, неправильные глаголы, времена). Лимит сбрасывается каждый понедельник. Это мотивирует детей тренироваться регулярно, не допуская накрутки.
            </div>

            <div style="display:flex; flex-direction:column; gap:8px;">
              ${studentStats.map(item => {
                const st = item.student;
                const p = item.progress;
                return `
                  <div style="background:var(--color-bg-card); border:1px solid var(--color-border); border-radius:var(--radius-lg); padding:12px 14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                      ${renderStudentAvatarHtml(st, { size: 'sm' })}
                      <div>
                        <div style="font-weight:700; font-size:var(--font-size-sm); color:var(--color-text-main);">${st.fullName}</div>
                        <div class="text-xs text-muted">${st.grade || ''} • Уровень: ${st.level || freshGroup.level}</div>
                      </div>
                    </div>

                    <!-- Progress status bar -->
                    <div style="flex:1; min-width:200px; max-width:320px;">
                      <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:4px;">
                        <span style="font-weight:700; color:var(--color-text-main);">
                          ${item.weeklyPoints} / ${item.weeklyLimit} ⭐
                        </span>
                        <span style="color:${item.weeklyPoints >= item.weeklyLimit ? '#16a34a' : '#b45309'}; font-weight:700;">
                          ${item.weeklyPoints >= item.weeklyLimit ? '✓ Лимит недели закрыт' : `Осталось: ${item.weeklyLimit - item.weeklyPoints} ⭐`}
                        </span>
                      </div>
                      <div style="height:8px; width:100%; background:var(--color-border); border-radius:9999px; overflow:hidden;">
                        <div style="height:100%; width:${item.weeklyPercent}%; background:${item.weeklyPoints >= item.weeklyLimit ? 'linear-gradient(90deg, #22c55e, #16a34a)' : item.weeklyPoints > 0 ? 'linear-gradient(90deg, #f59e0b, #d97706)' : '#94a3b8'}; transition:width 0.2s ease;"></div>
                      </div>
                    </div>

                    <!-- Streaks & Records -->
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                      <span class="badge" style="background:#f1f5f9; color:#334155; font-size:0.72rem; border:1px solid #cbd5e1;">
                        🔤 Слова: стрик ${p.wordsStreak || 0}
                      </span>
                      <span class="badge" style="background:#f1f5f9; color:#334155; font-size:0.72rem; border:1px solid #cbd5e1;">
                        ⚡ Глаголы: стрик ${p.irregularStreak || 0}
                      </span>
                      <span class="badge" style="background:#f1f5f9; color:#334155; font-size:0.72rem; border:1px solid #cbd5e1;">
                        ⏱️ Времена: стрик ${p.tensesStreak || 0}
                      </span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Tab 3: Group Course Lessons -->
        ${activeTab === 'lessons' ? `
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${!freshGroup.textbook ? `
              <div style="text-align:center; padding:32px 16px; color:var(--color-text-muted); background:var(--color-bg-app); border:1px dashed var(--color-border); border-radius:var(--radius-lg);">
                <div style="font-size:2rem; margin-bottom:6px;">📚</div>
                <div style="font-weight:700; color:var(--color-text-main);">Учебник не выбран для этой группы</div>
                <div class="text-xs" style="margin-top:4px;">Назначьте учебник (например, «Project 4») в настройках группы, чтобы отмечать уроки и домашние задания.</div>
              </div>
            ` : (() => {
              const progressPct = Math.min(100, Math.round((groupConductedCount / 80) * 100));
              const monthLessons = store.getLessonsForMonth(freshGroup.textbook, selectedLessonMonth);
              const selectedMonthObj = MONTH_NAMES.find(m => m.num === selectedLessonMonth) || { name: `Месяц ${selectedLessonMonth}` };
              const conductedInThisMonth = [1,2,3,4,5,6,7,8].filter(l => store.isLessonConductedForGroup(freshGroup.id, selectedLessonMonth, l)).length;
              const isMonthFullyConducted = conductedInThisMonth === 8;

              return `
                <!-- Fixed Header: Progress & Month Switcher Toolbar (Never scrolls away) -->
                <div style="background:var(--color-bg-app); border:1px solid var(--color-border); border-radius:var(--radius-lg); padding:10px 14px; display:flex; flex-direction:column; gap:8px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <div>
                      <div style="font-size:0.75rem; text-transform:uppercase; font-weight:700; color:var(--color-text-muted);">
                        Программа курса: <strong style="color:var(--color-primary); font-size:0.9rem;">📚 ${freshGroup.textbook}</strong>
                      </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                      <span class="badge ${groupConductedCount > 0 ? 'badge-success' : 'badge-planned'}" style="font-size:0.75rem; font-weight:700;">
                        Всего проведено: ${groupConductedCount} из 80 уроков (${progressPct}%)
                      </span>
                      ${isMonthFullyConducted ? `
                        <button type="button" class="btn btn-xs btn-outline-secondary btn-cls-unconduct-all-month" data-m="${selectedLessonMonth}" title="Снять отметку проведения со всех 8 уроков выбранного месяца">
                          ↩ Снять отметку с месяца
                        </button>
                      ` : `
                        <button type="button" class="btn btn-xs btn-success btn-cls-conduct-all-month" data-m="${selectedLessonMonth}" title="Отметить все 8 уроков выбранного месяца как проведенные в 1 клик">
                          ✓ Отметить весь месяц (8 ур.)
                        </button>
                      `}
                    </div>
                  </div>

                  <!-- Progress Bar -->
                  <div style="height:5px; width:100%; background:var(--color-border); border-radius:9999px; overflow:hidden;">
                    <div style="height:100%; width:${progressPct}%; background:linear-gradient(90deg, #3b82f6, #10b981); transition:width 0.25s ease;"></div>
                  </div>

                  <!-- Prominent Month Selector Toolbar -->
                  <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; padding-top:6px; border-top:1px dashed var(--color-border);">
                    <div style="display:flex; align-items:center; gap:6px;">
                      <label for="select-cls-month-dropdown" style="font-size:var(--font-size-xs); font-weight:700; color:var(--color-text-main); margin:0; white-space:nowrap;">
                        📅 Выбор месяца:
                      </label>
                      <select id="select-cls-month-dropdown" class="form-control form-control-sm" style="font-weight:700; border-radius:8px; padding:3px 8px; font-size:0.8rem; min-width:180px;">
                        ${MONTH_NAMES.map(m => {
                          const mCount = [1,2,3,4,5,6,7,8].filter(l => store.isLessonConductedForGroup(freshGroup.id, m.num, l)).length;
                          const isCurrentCalendar = currAcademicMonth && currAcademicMonth.num === m.num;
                          return `
                            <option value="${m.num}" ${selectedLessonMonth === m.num ? 'selected' : ''}>
                              ${m.name} (${mCount}/8 ур.)${isCurrentCalendar ? ' 📍 Текущий' : ''}
                            </option>
                          `;
                        }).join('')}
                      </select>
                    </div>

                    <!-- Month Navigation Quick Pills -->
                    <div style="display:flex; gap:4px; overflow-x:auto; padding-bottom:2px; scrollbar-width:thin;">
                      ${MONTH_NAMES.map(m => {
                        const mConducted = [1,2,3,4,5,6,7,8].filter(l => store.isLessonConductedForGroup(freshGroup.id, m.num, l)).length;
                        const isSelected = selectedLessonMonth === m.num;
                        const isCurrentCal = currAcademicMonth && currAcademicMonth.num === m.num;
                        const shortLabels = ['01.Сен', '02.Окт', '03.Ноя', '04.Дек', '05.Янв', '06.Фев', '07.Мар', '08.Апр', '09.Май', '10.Июн'];
                        const shortName = shortLabels[m.num - 1] || m.name.slice(0, 6);
                        return `
                          <button type="button" 
                                  class="btn btn-xs ${isSelected ? 'btn-primary' : 'btn-outline-secondary'} btn-cls-month-pill" 
                                  data-m="${m.num}" 
                                  style="font-size:0.72rem; font-weight:700; white-space:nowrap; border-radius:var(--radius-full); padding:3px 8px;"
                                  title="${m.name} (проведено: ${mConducted}/8)">
                            ${shortName} <span style="opacity:0.85; font-size:0.65rem;">(${mConducted}/8)</span>${isCurrentCal ? '📍' : ''}
                          </button>
                        `;
                      }).join('')}
                    </div>
                  </div>
                </div>

                <!-- Lessons Grid Header -->
                <div style="display:flex; justify-content:space-between; align-items:center; padding:0 2px;">
                  <span style="font-weight:700; font-size:0.85rem; color:var(--color-text-main);">
                    📅 ${selectedMonthObj.name} — 8 уроков месяца
                  </span>
                  <span class="text-xs text-muted">
                    Проведено в этом месяце: <strong>${conductedInThisMonth} из 8</strong>
                  </span>
                </div>

                <!-- Scrollable Lessons Grid for Selected Month -->
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(360px, 1fr)); gap:10px; max-height:410px; overflow-y:auto; padding-right:4px;">
                  ${monthLessons.map(l => {
                    const isConducted = store.isLessonConductedForGroup(freshGroup.id, selectedLessonMonth, l.lessonNumber);
                    const wordsCount = Array.isArray(l.vocabulary) ? l.vocabulary.length : 0;
                    const filesCount = Array.isArray(l.files) ? l.files.length : 0;
                    const hwText = (l.homework?.text || '').trim();
                    const globalLessonNum = ((selectedLessonMonth - 1) * 8) + l.lessonNumber;

                    return `
                      <div style="background:${isConducted ? 'linear-gradient(90deg, rgba(240,253,244,0.6) 0%, var(--color-bg-card) 100%)' : 'var(--color-bg-card)'}; border:${isConducted ? '1.5px solid #86efac' : '1px solid var(--color-border)'}; border-radius:var(--radius-lg); padding:12px 14px; display:flex; flex-direction:column; justify-content:space-between; gap:10px; transition:all 0.15s ease;">
                        <div>
                          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                            <span style="font-size:0.75rem; font-weight:800; background:var(--color-bg-app); border:1px solid var(--color-border); padding:2px 8px; border-radius:var(--radius-full); color:var(--color-primary);">
                              Урок ${globalLessonNum} (${l.lessonNumber}-й ур. месяца)
                            </span>
                            ${isConducted ? `
                              <span class="badge badge-success" style="font-size:0.7rem; font-weight:700;">🟢 Проведен</span>
                            ` : `
                              <span class="badge badge-planned" style="font-size:0.7rem; color:#64748b; font-weight:600;">⚪ По плану</span>
                            `}
                          </div>

                          <div style="font-weight:700; font-size:0.85rem; color:var(--color-text-main); margin-top:8px; line-height:1.3;">
                            ${l.topic || `Урок ${l.lessonNumber}: Тема месяца`}
                          </div>

                          <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
                            <span class="badge" style="background:#f1f5f9; color:#334155; font-size:0.7rem; border:1px solid #cbd5e1;" title="Новые слова">
                              🔤 ${wordsCount} слов
                            </span>
                            <span class="badge" style="background:#f1f5f9; color:#334155; font-size:0.7rem; border:1px solid #cbd5e1;" title="Прикрепленные файлы">
                              📎 ${filesCount} файлов
                            </span>
                          </div>

                          ${hwText ? `
                            <div style="margin-top:8px; font-size:0.75rem; color:var(--color-text-secondary); background:rgba(0,0,0,0.02); border-left:3px solid var(--color-primary); padding:4px 8px; border-radius:0 var(--radius-sm) var(--radius-sm) 0; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;" title="${hwText}">
                              <strong>ДЗ:</strong> ${hwText}
                            </div>
                          ` : `
                            <div style="margin-top:8px; font-size:0.72rem; color:var(--color-text-muted); font-style:italic;">
                              Домашнее задание не заполнено
                            </div>
                          `}
                        </div>

                        <div style="padding-top:8px; border-top:1px dashed var(--color-border);">
                          <button type="button" class="btn btn-xs ${isConducted ? 'btn-outline-danger' : 'btn-success'} btn-cls-toggle-grp-lesson" data-m="${selectedLessonMonth}" data-l="${l.lessonNumber}" data-conducted="${isConducted ? '1' : '0'}" style="width:100%; font-weight:700; padding:6px 10px;">
                            ${isConducted ? '↩ Отменить проведение' : '✓ Провести урок'}
                          </button>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              `;
            })()}
          </div>
        ` : ''}

        <!-- Tab 4: Group Schedule & Lessons -->
        ${activeTab === 'schedule' ? `
          <div style="display:flex; flex-direction:column; gap:8px; max-height:460px; overflow-y:auto; padding-right:4px;">
            ${lessons.length === 0 ? `
              <div style="text-align:center; padding:32px 16px; color:var(--color-text-muted);">
                <div style="font-size:2rem; margin-bottom:6px;">📅</div>
                <div>Занятия для этой группы пока не назначены в расписании</div>
              </div>
            ` : lessons.map(l => {
              const statusMap = {
                planned: '<span class="badge badge-planned">Запланирован</span>',
                completed: '<span class="badge badge-completed">Проведен</span>',
                cancelled: '<span class="badge badge-cancelled">Отменен</span>'
              };
              const todayStr = new Date().toISOString().slice(0, 10);
              const lessonDate = l.date || todayStr;
              const lParts = lessonDate.split('-');
              const lShort = lParts.length === 3 ? `${lParts[2]}.${lParts[1]}` : '';
              const actualStatus = l.exceptions?.[lessonDate]?.status || l.exceptions?.[lShort]?.status || l.status || 'planned';
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:var(--color-bg-app); border:1px solid var(--color-border); border-radius:var(--radius-md); flex-wrap:wrap; gap:8px;">
                  <div>
                    <div style="font-weight:700; font-size:var(--font-size-sm); color:var(--color-text-main);">
                      ${l.dayOfWeek} • ${l.time} ${lessonDate ? `(${lessonDate})` : ''}
                    </div>
                    <div class="text-xs text-muted" style="margin-top:2px;">
                      Тема: <strong>${l.topic || 'Регулярный урок'}</strong> • ${l.format || 'Офлайн'}
                    </div>
                  </div>

                  <div style="display:flex; align-items:center; gap:8px;">
                    ${statusMap[actualStatus] || actualStatus}
                    <button type="button" class="btn btn-xs ${actualStatus === 'completed' ? 'btn-success' : 'btn-outline-success'} btn-cls-toggle-conduct" data-lid="${l.id}" data-date="${lessonDate}" title="Отметить статус урока">
                      ${actualStatus === 'completed' ? '✓ Проведен' : '✓ Провести'}
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    `;
  };

  // Helper to open student points scoring modal from inside classroom
  const openSingleScoring = (studentId) => {
    const student = store.getStudentById(studentId);
    if (!student) return;

    let scoringTab = 'add'; // 'add' | 'deduct'

    const renderPointsContent = () => {
      const templates = scoringTab === 'deduct' ? SCORING_TEMPLATES.deduct : SCORING_TEMPLATES.add;
      const isDeduct = scoringTab === 'deduct';
      const liveStudent = store.getStudentById(studentId) || student;

      return `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--color-bg-app); border-radius:var(--radius-lg); margin-bottom:12px; border:1px solid var(--color-border);">
          <div style="display:flex; align-items:center; gap:10px;">
            ${renderStudentAvatarHtml(liveStudent, { size: 'sm' })}
            <div>
              <div style="font-weight:700; font-size:var(--font-size-sm);">${liveStudent.fullName}</div>
              <div class="text-xs text-muted">${liveStudent.grade || ''} • ${liveStudent.school || ''}</div>
            </div>
          </div>
          <div>
            <span style="font-weight:800; font-size:1.1rem; color:#b45309; background:#fef3c7; border:1px solid #fde68a; padding:4px 10px; border-radius:9999px;">
              ⭐ ${liveStudent.totalPoints || 0}
            </span>
          </div>
        </div>

        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <button type="button" class="group-scoring-tab-btn ${!isDeduct ? 'active tab-add' : ''}" id="cls-score-tab-add" style="flex:1; padding:6px 10px; font-size:0.82rem;">
            🟢 Начисление (+)
          </button>
          <button type="button" class="group-scoring-tab-btn ${isDeduct ? 'active tab-deduct' : ''}" id="cls-score-tab-deduct" style="flex:1; padding:6px 10px; font-size:0.82rem;">
            🔴 Списание (-)
          </button>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:6px; max-height:220px; overflow-y:auto; padding:2px;">
          ${templates.map(tpl => `
            <button type="button" class="scoring-category-pill ${isDeduct ? 'pill-deduct' : ''} btn-cls-cat-pill" 
              data-pts="${tpl.points}" 
              data-type="${isDeduct ? 'deduct' : 'add'}" 
              data-cat="${tpl.category}" 
              data-label="${tpl.label}"
              data-exclude="${tpl.excludeFromRating ? '1' : '0'}"
              style="padding:6px 12px; font-size:0.78rem;">
              <span>${tpl.icon}</span>
              <span>${tpl.label}</span>
              <span class="pill-pts-badge ${isDeduct ? 'deduct' : 'add'}">
                ${isDeduct ? '-' : '+'}${tpl.points} ⭐
              </span>
            </button>
          `).join('')}
        </div>

        <div style="margin-top:12px; padding-top:10px; border-top:1px dashed var(--color-border); display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <span class="text-xs text-muted" style="font-weight:600;">✏️ Свои баллы:</span>
          <input type="number" id="cls-custom-pts-input" class="form-control form-control-sm" style="width:75px;" value="15" min="1" max="2000">
          <input type="text" id="cls-custom-pts-comment" class="form-control form-control-sm" style="flex:1; min-width:120px;" placeholder="Причина...">
          <button type="button" id="btn-cls-custom-submit" class="btn btn-sm btn-secondary" style="font-size:var(--font-size-xs);">
            ${isDeduct ? 'Списать' : 'Начислить'}
          </button>
        </div>
      `;
    };

    // Sub-modal for scoring
    const scoringDialog = document.createElement('dialog');
    scoringDialog.className = 'app-modal';
    scoringDialog.style.maxWidth = '520px';
    scoringDialog.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">⭐ Баллы: ${student.fullName}</h3>
        <button type="button" class="btn btn-ghost btn-icon" id="cls-submodal-close">✕</button>
      </div>
      <div class="modal-body" id="cls-submodal-body">
        ${renderPointsContent()}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary btn-sm" id="cls-submodal-cancel">Закрыть</button>
      </div>
    `;
    document.body.appendChild(scoringDialog);
    scoringDialog.showModal();

    const bindScoringSubEvents = () => {
      const body = scoringDialog.querySelector('#cls-submodal-body');
      if (!body) return;

      body.querySelector('#cls-score-tab-add')?.addEventListener('click', () => {
        scoringTab = 'add';
        body.innerHTML = renderPointsContent();
        bindScoringSubEvents();
      });

      body.querySelector('#cls-score-tab-deduct')?.addEventListener('click', () => {
        scoringTab = 'deduct';
        body.innerHTML = renderPointsContent();
        bindScoringSubEvents();
      });

      body.querySelectorAll('.btn-cls-cat-pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const pts = parseInt(e.currentTarget.getAttribute('data-pts'), 10);
          const type = e.currentTarget.getAttribute('data-type') || 'add';
          const cat = e.currentTarget.getAttribute('data-cat') || 'Активность';
          const label = e.currentTarget.getAttribute('data-label') || cat;
          const excludeFromRating = e.currentTarget.getAttribute('data-exclude') === '1';

          store.awardPoints({
            studentId: student.id,
            teacherId: teacher ? teacher.id : 'admin',
            points: pts,
            type,
            category: cat,
            comment: `${label} (кабинет класса)`,
            excludeFromRating
          });

          const sign = type === 'deduct' ? '-' : '+';
          toast.success(`${sign}${pts} ⭐ («${label}») для ${student.fullName}`);
          scoringDialog.close();
          scoringDialog.remove();

          // Refresh classroom view
          refreshClassroomModal();
        });
      });

      body.querySelector('#btn-cls-custom-submit')?.addEventListener('click', () => {
        const inputPts = parseInt(body.querySelector('#cls-custom-pts-input')?.value, 10);
        const comment = body.querySelector('#cls-custom-pts-comment')?.value.trim() || (scoringTab === 'deduct' ? 'Списание баллов' : 'Начисление баллов');

        if (isNaN(inputPts) || inputPts <= 0) {
          toast.warning('Введите корректное число баллов');
          return;
        }

        store.awardPoints({
          studentId: student.id,
          teacherId: teacher ? teacher.id : 'admin',
          points: inputPts,
          type: scoringTab,
          category: comment,
          comment,
          excludeFromRating: false
        });

        const sign = scoringTab === 'deduct' ? '-' : '+';
        toast.success(`${sign}${inputPts} ⭐ («${comment}») для ${student.fullName}`);
        scoringDialog.close();
        scoringDialog.remove();

        refreshClassroomModal();
      });
    };

    bindScoringSubEvents();

    scoringDialog.querySelector('#cls-submodal-close')?.addEventListener('click', () => {
      scoringDialog.close();
      scoringDialog.remove();
    });
    scoringDialog.querySelector('#cls-submodal-cancel')?.addEventListener('click', () => {
      scoringDialog.close();
      scoringDialog.remove();
    });
  };

  // Helper for batch awarding points to the entire group
  const openBatchGroupScoring = () => {
    const students = store.getStudentsByGroupId(groupId);
    if (students.length === 0) {
      toast.warning('В этой группе нет учеников');
      return;
    }

    let mode = 'add';
    const batchDialog = document.createElement('dialog');
    batchDialog.className = 'app-modal';
    batchDialog.style.maxWidth = '550px';

    const renderBatchContent = () => {
      const templates = mode === 'deduct' ? SCORING_TEMPLATES.deduct : SCORING_TEMPLATES.add;
      return `
        <div style="background:var(--color-bg-app); padding:10px 14px; border-radius:var(--radius-md); border:1px solid var(--color-border); margin-bottom:12px;">
          <div style="font-weight:700; font-size:var(--font-size-sm);">👥 Баллы всей группе: ${group.name} (${students.length} чел.)</div>
          <div class="text-xs text-muted" style="margin-top:2px;">Каждому ученику будет начислено или списано выбранное количество баллов</div>
        </div>

        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <button type="button" class="group-scoring-tab-btn ${mode !== 'deduct' ? 'active tab-add' : ''}" id="batch-tab-add" style="flex:1; padding:6px 10px; font-size:0.82rem;">
            🟢 Начисление всей группе (+)
          </button>
          <button type="button" class="group-scoring-tab-btn ${mode === 'deduct' ? 'active tab-deduct' : ''}" id="batch-tab-deduct" style="flex:1; padding:6px 10px; font-size:0.82rem;">
            🔴 Списание всей группе (-)
          </button>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:6px; max-height:240px; overflow-y:auto; padding:2px;">
          ${templates.map(tpl => `
            <button type="button" class="scoring-category-pill ${mode === 'deduct' ? 'pill-deduct' : ''} btn-batch-pill" 
              data-pts="${tpl.points}" 
              data-type="${mode === 'deduct' ? 'deduct' : 'add'}" 
              data-cat="${tpl.category}" 
              data-label="${tpl.label}"
              style="padding:6px 12px; font-size:0.78rem;">
              <span>${tpl.icon}</span>
              <span>${tpl.label}</span>
              <span class="pill-pts-badge ${mode === 'deduct' ? 'deduct' : 'add'}">
                ${mode === 'deduct' ? '-' : '+'}${tpl.points} ⭐
              </span>
            </button>
          `).join('')}
        </div>
      `;
    };

    batchDialog.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">⭐ Начисление группе (${students.length} уч.)</h3>
        <button type="button" class="btn btn-ghost btn-icon" id="batch-close">✕</button>
      </div>
      <div class="modal-body" id="batch-body">
        ${renderBatchContent()}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary btn-sm" id="batch-cancel">Отмена</button>
      </div>
    `;
    document.body.appendChild(batchDialog);
    batchDialog.showModal();

    const bindBatchEvents = () => {
      const bBody = batchDialog.querySelector('#batch-body');
      if (!bBody) return;

      bBody.querySelector('#batch-tab-add')?.addEventListener('click', () => {
        mode = 'add';
        bBody.innerHTML = renderBatchContent();
        bindBatchEvents();
      });

      bBody.querySelector('#batch-tab-deduct')?.addEventListener('click', () => {
        mode = 'deduct';
        bBody.innerHTML = renderBatchContent();
        bindBatchEvents();
      });

      bBody.querySelectorAll('.btn-batch-pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const pts = parseInt(e.currentTarget.getAttribute('data-pts'), 10);
          const type = e.currentTarget.getAttribute('data-type') || 'add';
          const cat = e.currentTarget.getAttribute('data-cat') || 'Активность';
          const label = e.currentTarget.getAttribute('data-label') || cat;

          store.awardPointsBatch({
            studentIds: students.map(s => s.id),
            teacherId: teacher ? teacher.id : 'admin',
            points: pts,
            type,
            category: cat,
            comment: `${label} (групповое начисление)`
          });

          const sign = type === 'deduct' ? '-' : '+';
          toast.success(`${sign}${pts} ⭐ («${label}») начислено всем ${students.length} ученикам группы!`);
          batchDialog.close();
          batchDialog.remove();

          refreshClassroomModal();
        });
      });
    };

    bindBatchEvents();

    batchDialog.querySelector('#batch-close')?.addEventListener('click', () => {
      batchDialog.close();
      batchDialog.remove();
    });
    batchDialog.querySelector('#batch-cancel')?.addEventListener('click', () => {
      batchDialog.close();
      batchDialog.remove();
    });
  };

  const bindEvents = () => {
    const container = document.getElementById('classroom-modal-mount');
    if (!container) return;

    // Tab buttons
    container.querySelectorAll('.btn-cls-tab').forEach(b => {
      b.addEventListener('click', (e) => {
        activeTab = e.currentTarget.getAttribute('data-tab') || 'leaderboard';
        container.innerHTML = renderModalContent();
        bindEvents();
      });
    });

    // Print Memos
    container.querySelector('#btn-cls-print-memos')?.addEventListener('click', () => {
      GroupsView.printGroupCards(groupId);
    });

    // Batch group award
    container.querySelector('#btn-cls-batch-award')?.addEventListener('click', () => {
      openBatchGroupScoring();
    });

    // Single student award button
    container.querySelectorAll('.btn-cls-award-single').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sid = e.currentTarget.getAttribute('data-sid');
        if (sid) openSingleScoring(sid);
      });
    });

    // Fast 1-click Payment button
    container.querySelectorAll('.btn-cls-mark-paid').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sid = e.currentTarget.getAttribute('data-sid');
        const st = store.getStudentById(sid);
        if (st) {
          store.recordPayment({
            studentId: sid,
            month: currMonthKey,
            amount: 13000,
            status: 'paid',
            date: new Date().toISOString()
          });
          toast.success(`Оплата за ${currMonthName} отмечена для ${st.fullName}!`);
          refreshClassroomModal();
        }
      });
    });

    // Toggle Lesson Conducted (in Schedule Tab)
    container.querySelectorAll('.btn-cls-toggle-conduct').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const lid = e.currentTarget.getAttribute('data-lid');
        const lDate = e.currentTarget.getAttribute('data-date') || new Date().toISOString().slice(0, 10);
        const lesson = store.getLessonById(lid);
        if (lesson) {
          const lParts = lDate.split('-');
          const lShort = lParts.length === 3 ? `${lParts[2]}.${lParts[1]}` : '';
          const currentStatus = lesson.exceptions?.[lDate]?.status || lesson.exceptions?.[lShort]?.status || lesson.status || 'planned';
          const nextStatus = currentStatus === 'completed' ? 'planned' : 'completed';
          store.updateLessonStatus(lid, nextStatus, lDate);
          toast.success(nextStatus === 'completed' ? 'Урок отмечен как проведенный!' : 'Статус урока возвращен в запланированные');
          refreshClassroomModal();
        }
      });
    });

    // Lesson Month Navigation Pills (in Lessons Tab)
    container.querySelectorAll('.btn-cls-month-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const m = parseInt(e.currentTarget.getAttribute('data-m'), 10);
        if (!isNaN(m)) {
          selectedLessonMonth = m;
          container.innerHTML = renderModalContent();
          bindEvents();
        }
      });
    });

    // Lesson Month Select Dropdown
    container.querySelector('#select-cls-month-dropdown')?.addEventListener('change', (e) => {
      const m = parseInt(e.target.value, 10);
      if (!isNaN(m)) {
        selectedLessonMonth = m;
        container.innerHTML = renderModalContent();
        bindEvents();
      }
    });

    // Conduct all 8 lessons of selected month
    container.querySelectorAll('.btn-cls-conduct-all-month').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const m = parseInt(e.currentTarget.getAttribute('data-m'), 10);
        const freshGroup = store.getGroupById(groupId) || group;
        store.setGroupMonthConducted(freshGroup.id, m, true);
        const mName = MONTH_NAMES.find(mn => mn.num === m)?.name || `Месяц ${m}`;
        toast.success(`Все 8 уроков за ${mName} отмечены как проведенные для группы «${freshGroup.name}»!`);
        refreshClassroomModal();
      });
    });

    // Unconduct all 8 lessons of selected month
    container.querySelectorAll('.btn-cls-unconduct-all-month').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const m = parseInt(e.currentTarget.getAttribute('data-m'), 10);
        const freshGroup = store.getGroupById(groupId) || group;
        store.setGroupMonthConducted(freshGroup.id, m, false);
        const mName = MONTH_NAMES.find(mn => mn.num === m)?.name || `Месяц ${m}`;
        toast.info(`Отметка проведения уроков за ${mName} снята для группы «${freshGroup.name}».`);
        refreshClassroomModal();
      });
    });

    // Toggle Group Lesson Conducted (in Lessons Tab)
    container.querySelectorAll('.btn-cls-toggle-grp-lesson').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const m = parseInt(e.currentTarget.getAttribute('data-m'), 10);
        const l = parseInt(e.currentTarget.getAttribute('data-l'), 10);
        const isCurrentlyConducted = e.currentTarget.getAttribute('data-conducted') === '1';
        const nextStatus = !isCurrentlyConducted;

        const freshGroup = store.getGroupById(groupId) || group;
        store.setGroupLessonConducted(freshGroup.id, m, l, nextStatus);

        if (nextStatus) {
          toast.success(`Урок ${l} месяца ${m} отмечен как проведенный для группы «${freshGroup.name}»! ДЗ и новые слова открыты.`);
        } else {
          toast.info(`Проведение урока ${l} месяца ${m} для группы «${freshGroup.name}» отменено.`);
        }
        refreshClassroomModal();
      });
    });
  };

  const refreshClassroomModal = () => {
    const mount = document.getElementById('classroom-modal-mount');
    if (mount) {
      mount.innerHTML = renderModalContent();
      bindEvents();
    }
    if (typeof onRefresh === 'function') {
      try { onRefresh(); } catch (_) {}
    }
  };

  modal.open({
    title: `🏫 Кабинет класса: ${group.name}`,
    width: '840px',
    bodyHtml: `<div id="classroom-modal-mount">${renderModalContent()}</div>`,
    footerHtml: `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; flex-wrap:wrap; gap:8px;">
        <button type="button" class="btn btn-outline-primary btn-sm" id="btn-footer-cls-print">
          🖨️ Распечатать памятки группы с QR
        </button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('main-modal').close()">
          Закрыть
        </button>
      </div>
    `,
    onOpen: () => {
      bindEvents();
      document.getElementById('btn-footer-cls-print')?.addEventListener('click', () => {
        GroupsView.printGroupCards(groupId);
      });
    }
  });
}
