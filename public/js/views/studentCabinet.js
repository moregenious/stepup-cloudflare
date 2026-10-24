/**
 * Student Personal Cabinet View - Textbook Homework, Audio with Slowdown, Vocabulary (no voice synth), and Schedule
 */

import { store, formatGrade } from '../store.js';
import { auth } from '../auth.js';
import { modal } from '../components/modal.js';
import { AudioPlayer } from '../components/audioPlayer.js';
import { MONTH_NAMES } from '../data/seedData.js';
import { renderStudentAvatarHtml, openCustomizationModal } from '../components/avatarCustomization.js';

export const StudentCabinet = {
  selectedMonthKey: '2026-10',
  leaderboardScope: 'group', // 'group' | 'school'

  renderLeaderboardHtml(student, group, selectedKey) {
    const academicMonths = store.getAcademicMonthsList();
    const currentMonth = academicMonths.find(m => m.key === selectedKey) || academicMonths[0];
    
    const isSchoolScope = this.leaderboardScope === 'school';
    const leaderboard = isSchoolScope
      ? store.getSchoolMonthlyLeaderboard(currentMonth.year, currentMonth.monthIndex)
      : store.getGroupMonthlyLeaderboard(student.groupId, currentMonth.year, currentMonth.monthIndex);
    const myRankItem = leaderboard.find(l => l.studentId === student.id);
    const myRank = myRankItem ? myRankItem.rank : null;
    const scopeWord = isSchoolScope ? 'школе' : 'группе';
    const scopeTitle = isSchoolScope ? 'школы' : 'группы';

    // Top 3 positions for podium
    const top1 = leaderboard[0];
    const top2 = leaderboard[1];
    const top3 = leaderboard[2];
    const top1Student = top1 ? store.getStudentById(top1.studentId) : null;
    const top2Student = top2 ? store.getStudentById(top2.studentId) : null;
    const top3Student = top3 ? store.getStudentById(top3.studentId) : null;

    // Status banner message for logged-in student
    let bannerHtml = '';
    if (myRankItem) {
      if (myRank === 1 && myRankItem.netMonthlyPoints > 0) {
        bannerHtml = `
          <div class="leaderboard-status-banner gold">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.3rem;">👑</span>
              <span><strong>Поздравляем, ${student.fullName}!</strong> Вы занимаете <strong>1-е место</strong> в ${scopeWord} за ${currentMonth.shortName} с результатом <strong>+${myRankItem.netMonthlyPoints} ⭐</strong>!</span>
            </div>
            <span class="badge badge-completed" style="background:#ca8a04; color:#ffffff;">Лидер ${scopeTitle} 🥇</span>
          </div>
        `;
      } else if (myRank === 2 && myRankItem.netMonthlyPoints > 0) {
        const gap = (top1 ? top1.netMonthlyPoints : 0) - myRankItem.netMonthlyPoints;
        bannerHtml = `
          <div class="leaderboard-status-banner silver">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.3rem;">🥈</span>
              <span><strong>Отличная работа!</strong> Вы на <strong>2-м месте</strong> в ${scopeWord} (+${myRankItem.netMonthlyPoints} ⭐). ${gap > 0 ? `До 1-го места осталось всего <strong>${gap} ⭐</strong>!` : 'Вы делите лидерство!'}</span>
            </div>
            <span class="badge" style="background:#64748b; color:#ffffff;">Топ-2 ${scopeTitle}</span>
          </div>
        `;
      } else if (myRank === 3 && myRankItem.netMonthlyPoints > 0) {
        bannerHtml = `
          <div class="leaderboard-status-banner bronze">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.3rem;">🥉</span>
              <span><strong>Прекрасный результат!</strong> Вы на <strong>3-м призовом месте</strong> в ${scopeWord} (+${myRankItem.netMonthlyPoints} ⭐)!</span>
            </div>
            <span class="badge" style="background:#ea580c; color:#ffffff;">Топ-3 ${scopeTitle}</span>
          </div>
        `;
      } else {
        bannerHtml = `
          <div class="leaderboard-status-banner regular">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.3rem;">🎯</span>
              <span>Вы на <strong>${myRank ? `${myRank}-м месте` : '—'}</strong> в ${scopeWord} (${myRankItem.netMonthlyPoints >= 0 ? `+${myRankItem.netMonthlyPoints}` : myRankItem.netMonthlyPoints} ⭐ за ${currentMonth.shortName}). Зарабатывайте баллы на занятиях, чтобы подняться в Топ-3!</span>
            </div>
            <span class="badge badge-planned">Баллы за месяц</span>
          </div>
        `;
      }
    }

    return `
      <div class="card group-leaderboard-card">
        <!-- Header & Controls -->
        <div class="leaderboard-header-row" style="flex-wrap:wrap; gap:12px;">
          <div class="leaderboard-title-group">
            <span class="leaderboard-trophy-icon">${isSchoolScope ? '🌍' : '🏆'}</span>
            <div>
              <h3 class="card-title" style="color: var(--color-primary); font-size: 1.15rem; margin-bottom: 2px;">
                Рейтинг ${scopeTitle}: Лучшие за ${currentMonth.shortName}
              </h3>
              <p class="card-subtitle" style="margin:0;">
                ${isSchoolScope ? 'Сводный рейтинг всех учащихся Step Up English' : (group ? `Группа: <strong>${group.name}</strong>` : 'Индивидуальный зачет')} • Баллы считаются строго за ${currentMonth.shortName}
              </p>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <!-- Scope Switcher: Group vs School -->
            <div style="display:inline-flex; background:var(--color-bg-app); border:1px solid var(--color-border); padding:3px; border-radius:var(--radius-lg); gap:4px;">
              <button type="button" id="btn-scope-group" class="btn btn-xs ${!isSchoolScope ? 'btn-primary' : 'btn-ghost'}" style="padding:4px 10px; font-weight:700; border-radius:6px; cursor:pointer;">
                👥 Моя группа
              </button>
              <button type="button" id="btn-scope-school" class="btn btn-xs ${isSchoolScope ? 'btn-primary' : 'btn-ghost'}" style="padding:4px 10px; font-weight:700; border-radius:6px; cursor:pointer;">
                🌍 Вся школа
              </button>
            </div>

            <!-- Month Switcher -->
            <div class="leaderboard-select-box">
              <label for="select-cabinet-month" style="font-size: var(--font-size-xs); font-weight: 700; color: var(--color-text-secondary); margin:0;">
                📅 Месяц:
              </label>
              <select id="select-cabinet-month" class="form-control" style="font-size: var(--font-size-xs); padding: 4px 10px; font-weight: 600; width: auto; border:none; background:transparent; cursor:pointer;">
                ${academicMonths.map(m => `
                  <option value="${m.key}" ${m.key === selectedKey ? 'selected' : ''}>
                    ${m.name}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- Student Status Banner -->
        ${bannerHtml}

        <!-- Top-3 Visual Podium -->
        <div class="leaderboard-podium">
          <!-- 2nd Place (Silver) -->
          <div class="podium-card rank-2">
            <div class="podium-medal">🥈</div>
            <div style="margin-bottom: 6px; display: flex; justify-content: center;">
              ${top2 ? renderStudentAvatarHtml(top2Student || { fullName: top2.fullName }, { size: 'podium' }) : '<div class="podium-avatar">2</div>'}
            </div>
            <div class="podium-name" title="${top2 ? top2.fullName : 'Свободное место'}">
              ${top2 ? top2.fullName : '—'}
              ${top2 && top2.studentId === student.id ? '<span class="podium-badge-you">Вы</span>' : ''}
            </div>
            ${top2Student?.studentTitle ? `<div class="text-xs" style="color: var(--color-primary); font-weight: 600; margin-bottom: 2px;">${top2Student.studentTitle}</div>` : '<div class="text-xs text-muted">2 место</div>'}
            <div class="podium-score">
              ${top2 ? (top2.netMonthlyPoints >= 0 ? `+${top2.netMonthlyPoints}` : top2.netMonthlyPoints) : 0} ⭐
            </div>
            <div class="podium-breakdown">
              ${top2 ? `
                <span class="breakdown-add">+${top2.addedPoints}</span>
                <span>/</span>
                <span class="breakdown-deduct">-${top2.deductedPoints}</span>
              ` : '<span class="text-muted">0 баллов</span>'}
            </div>
          </div>

          <!-- 1st Place (Gold) -->
          <div class="podium-card rank-1">
            <div class="podium-medal">🥇</div>
            <div style="margin-bottom: 6px; display: flex; justify-content: center;">
              ${top1 ? renderStudentAvatarHtml(top1Student || { fullName: top1.fullName }, { size: 'podium' }) : '<div class="podium-avatar">1</div>'}
            </div>
            <div class="podium-name" title="${top1 ? top1.fullName : 'Свободное место'}">
              ${top1 ? top1.fullName : '—'}
              ${top1 && top1.studentId === student.id ? '<span class="podium-badge-you">Вы</span>' : ''}
            </div>
            <div class="text-xs" style="color: #b45309; font-weight:700;">
              ${top1Student?.studentTitle ? top1Student.studentTitle : '👑 Победитель месяца'}
            </div>
            <div class="podium-score">
              ${top1 ? (top1.netMonthlyPoints >= 0 ? `+${top1.netMonthlyPoints}` : top1.netMonthlyPoints) : 0} ⭐
            </div>
            <div class="podium-breakdown">
              ${top1 ? `
                <span class="breakdown-add">+${top1.addedPoints}</span>
                <span>/</span>
                <span class="breakdown-deduct">-${top1.deductedPoints}</span>
              ` : '<span class="text-muted">0 баллов</span>'}
            </div>
          </div>

          <!-- 3rd Place (Bronze) -->
          <div class="podium-card rank-3">
            <div class="podium-medal">🥉</div>
            <div style="margin-bottom: 6px; display: flex; justify-content: center;">
              ${top3 ? renderStudentAvatarHtml(top3Student || { fullName: top3.fullName }, { size: 'podium' }) : '<div class="podium-avatar">3</div>'}
            </div>
            <div class="podium-name" title="${top3 ? top3.fullName : 'Свободное место'}">
              ${top3 ? top3.fullName : '—'}
              ${top3 && top3.studentId === student.id ? '<span class="podium-badge-you">Вы</span>' : ''}
            </div>
            ${top3Student?.studentTitle ? `<div class="text-xs" style="color: #ea580c; font-weight: 600; margin-bottom: 2px;">${top3Student.studentTitle}</div>` : '<div class="text-xs text-muted">3 место</div>'}
            <div class="podium-score">
              ${top3 ? (top3.netMonthlyPoints >= 0 ? `+${top3.netMonthlyPoints}` : top3.netMonthlyPoints) : 0} ⭐
            </div>
            <div class="podium-breakdown">
              ${top3 ? `
                <span class="breakdown-add">+${top3.addedPoints}</span>
                <span>/</span>
                <span class="breakdown-deduct">-${top3.deductedPoints}</span>
              ` : '<span class="text-muted">0 баллов</span>'}
            </div>
          </div>
        </div>

        <!-- Full Classmates Ranking Table -->
        <div class="leaderboard-table-wrap">
          <table class="leaderboard-table">
            <thead>
              <tr>
                <th style="width: 70px; text-align: center;">Место</th>
                <th>${isSchoolScope ? 'Ученик школы' : 'Ученик группы'}</th>
                <th style="text-align: center;">➕ Начислено</th>
                <th style="text-align: center;">➖ Списано</th>
                <th style="text-align: right;">⭐ Итог за ${currentMonth.shortName}</th>
              </tr>
            </thead>
            <tbody>
              ${leaderboard.length === 0 ? `
                <tr>
                  <td colspan="5" style="text-align: center; padding: var(--space-4); color: var(--color-text-muted);">
                    В ${isSchoolScope ? 'школе' : 'этой группе'} пока нет баллов за ${currentMonth.shortName}
                  </td>
                </tr>
              ` : leaderboard.map(item => {
                const isMe = item.studentId === student.id;
                const itemStudent = store.getStudentById(item.studentId);
                const itemGroup = (isSchoolScope && itemStudent?.groupId) ? store.getGroupById(itemStudent.groupId) : null;
                let rankBadge = `<span class="rank-badge-cell">${item.rank}</span>`;
                if (item.rank === 1) rankBadge = `<span class="rank-badge-cell gold">🥇 1</span>`;
                else if (item.rank === 2) rankBadge = `<span class="rank-badge-cell silver">🥈 2</span>`;
                else if (item.rank === 3) rankBadge = `<span class="rank-badge-cell bronze">🥉 3</span>`;

                return `
                  <tr class="${isMe ? 'leaderboard-row-me' : ''}">
                    <td style="text-align: center;">${rankBadge}</td>
                    <td>
                      <div style="display:flex; align-items:center; gap:10px;">
                        ${itemStudent ? renderStudentAvatarHtml(itemStudent, { size: 'sm' }) : ''}
                        <div>
                          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span class="font-semibold">${item.fullName}</span>
                            ${isMe ? '<span class="badge badge-completed" style="font-size:0.65rem;">Это вы</span>' : ''}
                            ${itemGroup ? `<span class="badge" style="font-size:0.65rem; background:#e0e7ff; color:#3730a3;">${itemGroup.name}</span>` : `<span class="text-xs text-muted">(${formatGrade(item.grade) || 'Ученик'})</span>`}
                          </div>
                          ${itemStudent?.studentTitle ? `
                            <div style="margin-top:2px;">
                              <span class="student-title-badge light" style="font-size:0.68rem; padding: 1px 8px;">
                                ${itemStudent.studentTitle}
                              </span>
                            </div>
                          ` : ''}
                        </div>
                      </div>
                    </td>
                    <td style="text-align: center;">
                      <span class="breakdown-add">+${item.addedPoints}</span>
                    </td>
                    <td style="text-align: center;">
                      <span class="breakdown-deduct">${item.deductedPoints > 0 ? `-${item.deductedPoints}` : '0'}</span>
                    </td>
                    <td style="text-align: right;">
                      <span class="font-bold" style="font-size: 0.95rem; color: ${item.netMonthlyPoints >= 0 ? 'var(--color-primary)' : 'var(--color-danger-text)'};">
                        ${item.netMonthlyPoints >= 0 ? `+${item.netMonthlyPoints}` : item.netMonthlyPoints} ⭐
                      </span>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

      </div>
    `;
  },

  render(container) {
    const studentUser = auth.getCurrentUser();
    const studentId = studentUser.id;
    const student = store.getStudentById(studentId) || store.getStudents()[0];

    // Check Birthday Bonus (+500 points on birthday)
    const bdayCheck = store.checkAndAwardBirthdayBonus(student.id);
    if (bdayCheck && bdayCheck.awarded) {
      setTimeout(() => {
        modal.open({
          title: '🎂 С Днём Рождения!',
          bodyHtml: `
            <div style="text-align: center; padding: var(--space-4) var(--space-2);">
              <div style="font-size: 3.8rem; margin-bottom: 12px;">🎉🎂🎁</div>
              <h2 style="font-size: 1.45rem; font-weight: 800; color: var(--color-primary); margin-bottom: 8px;">
                Поздравляем с Днём Рождения, ${student.fullName.split(' ')[0]}!
              </h2>
              <p style="font-size: 0.95rem; color: var(--color-text-main); margin-bottom: 16px; line-height: 1.5;">
                Команда школы <strong>Step Up English</strong> искренне поздравляет тебя с твоим днём! Желаем отличных оценок, лёгкого английского и новых ярких побед!
              </p>
              <div style="background: linear-gradient(135deg, rgba(234, 179, 8, 0.15), rgba(245, 158, 11, 0.25)); border: 2px dashed #f59e0b; border-radius: var(--radius-lg); padding: 16px; margin: 16px 0;">
                <div style="font-size: 0.85rem; color: #b45309; font-weight: 700; text-transform: uppercase;">Твой праздничный подарок:</div>
                <div style="font-size: 2.2rem; font-weight: 900; color: #d97706; margin-top: 4px;">+500 ⭐</div>
                <div style="font-size: 0.82rem; color: var(--color-text-muted); margin-top: 4px;">Баллы зачислены на баланс для покупок в магазине (без рейтинга)!</div>
              </div>
            </div>
          `,
          footerHtml: `
            <button type="button" class="btn btn-primary" id="btn-bday-claim-modal" style="width: 100%; font-weight: 700; font-size: 1rem; padding: 11px;">
              🎉 Ура! Спасибо! 🚀
            </button>
          `,
          onOpen: (dialog) => {
            dialog.querySelector('#btn-bday-claim-modal')?.addEventListener('click', () => {
              modal.close();
            });
          }
        });
      }, 500);
    }

    const group = store.getGroupById(student.groupId);

    const mySchedule = store.getSchedule({ studentId: student.id });
    // Mini-game rounds are not shown in the history (parents need lesson reasons); only their weekly total
    const allMyPoints = store.getPointRecords(student.id);
    const myPoints = allMyPoints.filter(p => p.category !== 'Мини-игры');
    const gameWeek = store.getStudentGameProgress(student.id);

    const textbookName = student.textbook || (group ? group.textbook : '');
    const unlockedLesson = store.getLatestUnlockedLessonForStudent(student.id);

    // Current academic month & payment warning status
    const currentAcademicMonth = store.getCurrentAcademicMonth();
    const isPaymentWarning = store.isPaymentDueWarningActive(student.id, currentAcademicMonth.key);

    // Attendance stats
    const attStats = store.getStudentAttendanceStats(student.id);

    // Next upcoming lesson
    const upcomingLesson = mySchedule.find(s => s.status === 'planned');

    // Determine schedule and lesson time for the student
    const groupScheduleTime = group?.scheduleTime || '';
    const groupScheduleDays = group?.scheduleDays || '';
    const scheduleTimes = [...new Set(mySchedule.map(s => s.time).filter(Boolean))];
    const scheduleDaysShort = [...new Set(mySchedule.map(s => s.dayOfWeekShort).filter(Boolean))];
    const lessonTime = groupScheduleTime || scheduleTimes[0] || (upcomingLesson?.time) || '16:00 - 17:30';

    const rawDays = groupScheduleDays || (scheduleDaysShort.length ? scheduleDaysShort.join(', ') : '');
    const formattedDays = rawDays
      ? String(Array.isArray(rawDays) ? rawDays.join(', ') : rawDays)
          .replace(/[-–]/g, ', ')
          .replace(/пн/gi, 'Пн')
          .replace(/вт/gi, 'Вт')
          .replace(/ср/gi, 'Ср')
          .replace(/чт/gi, 'Чт')
          .replace(/пт/gi, 'Пт')
          .replace(/сб/gi, 'Сб')
          .replace(/вс/gi, 'Вс')
      : '';

    const scheduleBadgeText = formattedDays ? `${lessonTime} (${formattedDays})` : lessonTime;

    container.innerHTML = `
      <!-- Birthday Celebration Banner -->
      ${bdayCheck && bdayCheck.isBirthday ? `
        <div style="background: linear-gradient(135deg, #f59e0b, #ef4444); color: white; padding: 14px 20px; border-radius: var(--radius-xl); margin-bottom: var(--space-5); display: flex; align-items: center; justify-content: space-between; gap: 14px; box-shadow: 0 6px 18px rgba(245, 158, 11, 0.35); flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <span style="font-size: 2.2rem;">🎂</span>
            <div>
              <div style="font-weight: 800; font-size: 1.15rem;">С Днём Рождения, ${student.fullName.split(' ')[0]}! 🎉</div>
              <div style="font-size: 0.85rem; opacity: 0.95; margin-top: 2px;">Step Up English поздравляет тебя! В честь твоего праздника начислен подарок +500 ⭐ баллов для магазина бонусов!</div>
            </div>
          </div>
          <div style="font-size: 1.3rem; font-weight: 900; background: rgba(255,255,255,0.25); padding: 6px 14px; border-radius: var(--radius-lg); white-space: nowrap;">
            +500 ⭐ 🎁
          </div>
        </div>
      ` : ''}

      <!-- Payment Due Warning Banner (Shown from day 1 if unpaid, hidden if paid) -->
      ${isPaymentWarning ? `
        <div class="payment-warning-banner" style="display:flex; align-items:center; justify-content:space-between; background:linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border:2px solid #ef4444; border-radius:var(--radius-xl); padding:var(--space-4) var(--space-6); margin-bottom:var(--space-6); box-shadow:0 6px 16px -2px rgba(239, 68, 68, 0.25); flex-wrap:wrap; gap:var(--space-4);">
          <div style="display:flex; align-items:center; gap:var(--space-4);">
            <div style="width:48px; height:48px; border-radius:50%; background:#fee2e2; border:2px solid #ef4444; display:flex; align-items:center; justify-content:center; font-size:1.5rem; flex-shrink:0;">
              ⚠️
            </div>
            <div>
              <div style="font-size:1.05rem; font-weight:800; color:#991b1b;">
                Напоминание: Оплата обучения за ${currentAcademicMonth.name} не зафиксирована
              </div>
              <div style="font-size:var(--font-size-sm); color:#7f1d1d; margin-top:2px;">
                Пожалуйста, внесите оплату за текущий месяц обучения или уточните информацию у преподавателя. Предупреждение снимется сразу после отметки оплаты.
              </div>
            </div>
          </div>
          <div>
            <span class="badge" style="background:#dc2626; color:#ffffff; font-size:0.85rem; padding:6px 14px; font-weight:800; border-radius:var(--radius-full);">
              Требуется оплата
            </span>
          </div>
        </div>
      ` : `
        <div style="display:flex; align-items:center; justify-content:space-between; background:linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border:1.5px solid #22c55e; border-radius:var(--radius-lg); padding:var(--space-3) var(--space-5); margin-bottom:var(--space-5); box-shadow:0 2px 8px rgba(34, 197, 94, 0.15); flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:1.2rem;">💳</span>
            <span style="font-size:var(--font-size-sm); font-weight:700; color:#15803d;">
              Обучение за <strong>${currentAcademicMonth.name}</strong> оплачено. Спасибо!
            </span>
          </div>
          <span class="badge badge-completed" style="background:#16a34a; color:#fff; font-size:0.75rem;">
            ✓ Оплачено
          </span>
        </div>
      `}

      <!-- Hero Header Banner -->
      <div class="student-hero-banner">
        <div class="student-hero-greeting">
          <div class="student-hero-profile-row">
            <div class="student-hero-avatar-area" id="btn-hero-avatar-customization" title="Нажмите, чтобы настроить аватар, рамку и титул">
              ${renderStudentAvatarHtml(student, { size: 'hero' })}
              <div class="btn-avatar-edit-overlay" title="Сменить аватар или рамку">✏️</div>
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <h2 style="margin:0;">Привет, ${student.fullName}! 👋</h2>
                <button type="button" class="btn btn-sm" id="btn-open-customization" style="background: rgba(255,255,255,0.2); color: #ffffff; border: 1px solid rgba(255,255,255,0.4); border-radius: var(--radius-full); font-size: var(--font-size-xs); font-weight: 700; padding: 4px 12px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.2s;" title="Кастомизировать аватар, рамку и титул">
                  <span>🎨 Кастомизация</span>
                </button>
              </div>
              <div style="margin-top: 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                ${student.studentTitle ? `
                  <span class="student-title-badge" title="Ваш титул в школе">
                    <span>${student.studentTitle}</span>
                  </span>
                ` : `
                  <button type="button" id="btn-choose-first-title" style="background:none; border:none; color:#c7d2fe; font-size: var(--font-size-xs); text-decoration: underline; cursor:pointer; padding:0;">
                    + Выбрать свой забавный титул
                  </button>
                `}
                <span style="color: #a5b4fc; font-size: var(--font-size-xs);">• Ученик (${student.level})</span>
              </div>
            </div>
          </div>
          <p style="margin-bottom: var(--space-4);">Твой личный кабинет курсов «Step Up English». Учись, выполняй домашку, слушай аудио и получай баллы!</p>
          
          <div style="display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-2);">
            <div style="background: rgba(255,255,255,0.15); padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); font-size: var(--font-size-sm);">
              👥 Группа: <strong>${group ? group.name : 'Индивидуально'}</strong>
            </div>
            <div style="background: rgba(255,255,255,0.2); padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); font-size: var(--font-size-sm); border: 1px solid rgba(255,255,255,0.28); box-shadow: 0 2px 6px rgba(0,0,0,0.1);" title="Время проведения уроков по расписанию">
              ⏰ Время урока: <strong>${scheduleBadgeText}</strong>
            </div>
            <div style="background: rgba(255,255,255,0.15); padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); font-size: var(--font-size-sm);">
              📚 Учебник: <strong>${textbookName || 'Не указан'}</strong>
            </div>
            <div style="background: rgba(255,255,255,0.15); padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); font-size: var(--font-size-sm);">
              📊 Посещаемость: <strong>${attStats.percentage}%</strong> (${attStats.attended}/${attStats.total} уроков)
            </div>
            <div style="background: rgba(255,255,255,0.15); padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); font-size: var(--font-size-sm);">
              🏫 ${formatGrade(student.grade)}, ${student.school} (${student.shift} смена)
            </div>
            <div style="background: rgba(255,255,255,0.22); padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); font-size: var(--font-size-sm); border: 1px solid rgba(255,255,255,0.3);" title="Ваш личный 4-значный PIN-код для входа">
              🔑 Твой PIN-код: <strong style="font-family:monospace; letter-spacing:0.1em;">${store.getStudentPin(student)}</strong>
            </div>
            <a href="#vocabulary" style="background: rgba(255,255,255,0.25); color: #ffffff; padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); font-size: var(--font-size-sm); text-decoration: none; display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(255,255,255,0.35); font-weight: 600;">
              <span>📖 Мой словарь:</span> <strong>${store.getTotalVocabularyCountForStudent(student.id)} слов</strong> <span>➔</span>
            </a>
            <a href="#survey" style="background: ${student.surveyCompleted ? 'rgba(16, 185, 129, 0.35)' : 'linear-gradient(135deg, #10b981, #059669)'}; color: #ffffff; padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); font-size: var(--font-size-sm); text-decoration: none; display: inline-flex; align-items: center; gap: 6px; font-weight: 700; box-shadow: 0 2px 10px rgba(16, 185, 129, 0.35); border: 1px solid rgba(255, 255, 255, 0.4);">
              <span>📋 ${student.surveyCompleted ? 'Анкета заполнена ✓' : 'Анкета ученика (+200 ⭐)'}</span> <span>➔</span>
            </a>
            <a href="#games" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: #ffffff; padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); font-size: var(--font-size-sm); text-decoration: none; display: inline-flex; align-items: center; gap: 6px; font-weight: 700; box-shadow: 0 2px 10px rgba(245, 158, 11, 0.4); border: 1px solid rgba(255, 255, 255, 0.3);">
              <span>🎮 Мини-игры и тренажеры</span> <span>➔</span>
            </a>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between; gap: var(--space-3);">
          <button type="button" class="btn btn-app-logout" style="background: rgba(255,255,255,0.2); color: #ffffff; border: 1px solid rgba(255,255,255,0.35); border-radius: var(--radius-full); font-size: var(--font-size-xs); padding: 6px 14px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.2s;" title="Выйти на главный экран входа">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            <span>Выйти</span>
          </button>
          
          <div class="student-score-box" style="margin-top: auto; display: flex; gap: var(--space-4); align-items: center; background: rgba(0,0,0,0.2); padding: 8px 16px; border-radius: var(--radius-lg); border: 1px solid rgba(255,255,255,0.2);">
            <div style="text-align: right;">
              <div class="student-score-number" style="font-size: 1.5rem; color: #facc15; font-weight: 800;">${student.totalPoints || 0} ⭐</div>
              <div class="student-score-label" style="font-size: 0.72rem; opacity: 0.9;">Баланс для покупок</div>
            </div>
            <div style="height: 32px; width: 1px; background: rgba(255,255,255,0.25);"></div>
            <div style="text-align: right;">
              <div class="student-score-number" style="font-size: 1.5rem; color: #ffffff; font-weight: 800;">${student.lifetimePoints != null ? student.lifetimePoints : (student.totalPoints || 0)} ⭐</div>
              <div class="student-score-label" style="font-size: 0.72rem; opacity: 0.9;">Заработанно за всё время</div>
            </div>
          </div>
        </div>
      </div>

      <!-- MONTHLY GROUP LEADERBOARD & PODIUM SECTION -->
      <div id="leaderboard-mount">
        ${this.renderLeaderboardHtml(student, group, this.selectedMonthKey)}
      </div>

      <!-- COMPACT HOMEWORK BANNER (Redirects to full dedicated #homework view) -->
      <div class="cabinet-homework-banner">
        <div class="cabinet-homework-banner-content">
          <div class="cabinet-homework-icon-box">📚</div>
          <div>
            <div class="cabinet-homework-title">Домашнее задание на следующий урок</div>
            <div class="cabinet-homework-subtitle">
              ${unlockedLesson ? `${unlockedLesson.monthName} • Урок ${unlockedLesson.lessonNumber}: «${unlockedLesson.topic}» ${unlockedLesson.homework?.isFromPrevious ? `<span style="background:rgba(255,255,255,0.25); padding:2px 7px; border-radius:6px; font-weight:700; font-size:0.75rem;">(ДЗ с Урока ${unlockedLesson.homework.sourceLesson.lessonNumber})</span> ` : ''}${unlockedLesson.homework?.deadline ? `• ⏳ Срок сдачи: ${unlockedLesson.homework.deadline}` : ''}` : 'Задания открываются последовательно после проведенных уроков'}
            </div>
          </div>
        </div>
        <a href="#homework" class="btn btn-primary" style="text-decoration:none; font-weight:700; padding:10px 18px; border-radius:12px; white-space:nowrap; display:inline-flex; align-items:center; gap:6px;">
          <span>📖 Открыть домашнее задание</span>
          <span>➔</span>
        </a>
      </div>

      ${(() => {
        // Monthly 1st place reward (streak freeze) — shown until the student closes it
        const rewards = (store.state.purchases || []).filter(p => p.studentId === student.id && String(p.id).startsWith('frz-top-'));
        let seen = [];
        try { seen = JSON.parse(localStorage.getItem('stepup_seen_rewards') || '[]'); } catch (e) { seen = []; }
        const fresh = rewards.filter(r => !seen.includes(r.id));
        return fresh.map(r => `
          <div class="card reward-banner" data-reward-id="${r.id}" style="margin-bottom: var(--space-4); padding: var(--space-4); background: linear-gradient(135deg, #fef3c7, #fde68a); border: 1.5px solid #f59e0b; display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap;">
            <div style="display:flex; gap:12px; align-items:center;">
              <span style="font-size:2rem;">🏆</span>
              <div>
                <div style="font-weight:800; color:#92400e;">Поздравляем! ${r.reason || '1 место в рейтинге группы'}</div>
                <div style="font-size:0.85rem; color:#78350f;">Награда: ❄️ заморозка серии — она спасёт твою серию, если пропустишь день.</div>
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-primary btn-reward-ok" data-reward-id="${r.id}">Ура! 🎉</button>
          </div>`).join('');
      })()}

      <!-- Points & Grades History (История начисления баллов - Full Width) -->
      <div class="card" style="margin-bottom: var(--space-6);">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-2);">
          <div>
            <h3 class="card-title">📝 История начисления баллов</h3>
            <p class="card-subtitle">Начисления и списания на уроках, за ДЗ, анкету и праздники${gameWeek.weeklyPoints ? ` • 🎮 Мини-игры на этой неделе: +${gameWeek.weeklyPoints} ⭐` : ''}</p>
          </div>
          <div style="font-size: var(--font-size-xs); color: var(--color-text-muted); background: var(--color-bg-app); padding: 4px 12px; border-radius: var(--radius-full); border: 1px solid var(--color-border); font-weight: 600;">
            Всего записей: <strong>${myPoints.length}</strong>
          </div>
        </div>

        <div class="points-timeline" style="max-height: 440px; overflow-y: auto; padding-right: 4px;">
          ${myPoints.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon">⭐</div>
              <div class="empty-state-title">Пока нет начисленных баллов</div>
              <div class="empty-state-desc">Выполняй домашние задания, заполняй анкету и работай на уроках, чтобы зарабатывать баллы!</div>
            </div>
          ` : myPoints.map(p => {
            const teacher = store.getTeacherById(p.teacherId);
            const isPositive = (p.points || 0) >= 0;
            return `
              <div class="point-item">
                <div class="point-score-tag" style="${isPositive ? '' : 'background:#fee2e2; color:#991b1b;'}">
                  ${isPositive ? `+${p.points}` : p.points} ⭐
                </div>
                <div class="point-item-content" style="min-width: 0;">
                  <div class="point-item-header" style="flex-wrap: wrap; gap: 4px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span class="point-category" style="${isPositive ? '' : 'color:#b91c1c;'}">${p.category}</span>
                      ${p.excludeFromRating ? `<span style="font-size: 0.65rem; background: #fef3c7; color: #b45309; padding: 1px 6px; border-radius: 4px; font-weight: 600;">Без рейтинга</span>` : ''}
                    </div>
                    <span class="point-date">${new Date(p.date).toLocaleDateString('ru-RU')}</span>
                  </div>
                  <div class="point-comment" style="word-break: break-word;">
                    ${p.comment || (isPositive ? 'Баллы начислены за работу на занятии.' : 'Вычет баллов.')}
                  </div>
                  <div class="text-xs text-muted" style="margin-top: 4px;">
                    Начислил: ${teacher ? teacher.fullName : 'Администратор'}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Schedule Cards (Responsive 2-column or 1-column on mobile) -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-6); margin-bottom: var(--space-6);">
        <!-- Nearest Lesson -->
        <div class="card" style="border-left: 4px solid var(--color-primary); margin-bottom: 0;">
          <div class="card-header">
            <div>
              <h3 class="card-title">⏰ Ближайший урок</h3>
              <p class="card-subtitle">Не забудь подготовить домашнее задание</p>
            </div>
          </div>

          ${upcomingLesson ? `
            <div style="background: var(--color-bg-app); border-radius: var(--radius-lg); padding: var(--space-4);">
              <div style="font-size: 1.15rem; font-weight: 700; color: var(--color-text-main);">
                ${upcomingLesson.dayOfWeek}, ${upcomingLesson.time}
              </div>
              <div style="margin-top: var(--space-2); font-size: var(--font-size-sm);">
                <div><strong>Тема:</strong> ${upcomingLesson.topic}</div>
                <div style="margin-top: 2px;"><strong>Преподаватель:</strong> ${store.getTeacherById(upcomingLesson.teacherId)?.fullName || '—'}</div>
                <div style="margin-top: 2px;"><strong>Формат:</strong> ${upcomingLesson.format}</div>
              </div>
            </div>
          ` : `
            <div class="text-sm text-muted" style="padding: var(--space-3) 0;">
              На этой неделе нет запланированных уроков.
            </div>
          `}
        </div>

        <!-- 2 Nearest Lessons List -->
        <div class="card" style="margin-bottom: 0;">
          <div class="card-header">
            <div>
              <h3 class="card-title">📅 Ближайшие занятия</h3>
              <p class="card-subtitle">2 ближайших урока в расписании</p>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: var(--space-3);">
            ${(() => {
              const nearest = mySchedule.filter(s => s.status === 'planned').slice(0, 2);
              if (nearest.length === 0) {
                return '<div class="text-sm text-muted">Нет запланированных уроков на ближайшее время</div>';
              }
              return nearest.map(l => {
                const teacher = store.getTeacherById(l.teacherId);
                return `
                  <div style="padding: var(--space-3); background: var(--color-bg-app); border-radius: var(--radius-md); font-size: var(--font-size-xs); display: flex; justify-content: space-between; align-items: center; border-left: 3px solid var(--color-primary);">
                    <div>
                      <div class="font-semibold" style="font-size: var(--font-size-sm);">⏰ ${l.dayOfWeek} ${l.time} ${l.date ? `(${l.date})` : ''}</div>
                      <div class="text-muted" style="margin-top: 2px;">📝 ${l.topic} • 👨‍🏫 ${teacher ? teacher.fullName : '—'}</div>
                    </div>
                    <span class="badge badge-planned">
                      ⏳ Запланирован
                    </span>
                  </div>
                `;
              }).join('');
            })()}
          </div>
        </div>
      </div>
    `;

    this.bindEvents(container, student, group);
  },

  bindEvents(container, student, group) {
    container.querySelectorAll('.btn-reward-ok').forEach(btn => btn.addEventListener('click', () => {
      let seen = [];
      try { seen = JSON.parse(localStorage.getItem('stepup_seen_rewards') || '[]'); } catch (e) { seen = []; }
      seen.push(btn.dataset.rewardId);
      try { localStorage.setItem('stepup_seen_rewards', JSON.stringify(seen.slice(-50))); } catch (e) { /* ignore */ }
      btn.closest('.reward-banner')?.remove();
    }));
    // Logout button
    // (handled by the global logout handler in app.js, which waits for unsaved changes)

    // Leaderboard controls listener (month select + group/school scope toggle)
    const bindLeaderboardEvents = () => {
      const monthSelect = container.querySelector('#select-cabinet-month');
      monthSelect?.addEventListener('change', (e) => {
        this.selectedMonthKey = e.target.value;
        refreshLeaderboard();
      });

      const btnGroup = container.querySelector('#btn-scope-group');
      const btnSchool = container.querySelector('#btn-scope-school');

      btnGroup?.addEventListener('click', () => {
        if (this.leaderboardScope !== 'group') {
          this.leaderboardScope = 'group';
          refreshLeaderboard();
        }
      });

      btnSchool?.addEventListener('click', () => {
        if (this.leaderboardScope !== 'school') {
          this.leaderboardScope = 'school';
          refreshLeaderboard();
        }
      });
    };

    const refreshLeaderboard = () => {
      const mount = container.querySelector('#leaderboard-mount');
      if (mount && student) {
        mount.innerHTML = this.renderLeaderboardHtml(student, group, this.selectedMonthKey);
        bindLeaderboardEvents();
      }
    };

    bindLeaderboardEvents();

    // Bind Avatar & Profile Customization
    const handleOpenCustomization = () => {
      openCustomizationModal(student, () => {
        this.render(container);
        if (window.app?.updateHeaderProfile) {
          window.app.updateHeaderProfile();
        }
      });
    };

    container.querySelector('#btn-hero-avatar-customization')?.addEventListener('click', handleOpenCustomization);
    container.querySelector('#btn-open-customization')?.addEventListener('click', handleOpenCustomization);
    container.querySelector('#btn-choose-first-title')?.addEventListener('click', handleOpenCustomization);

    // Bind Audio Players
    AudioPlayer.bindAll(container);
  }
};
