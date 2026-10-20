/**
 * Admin Dashboard View - Overview, KPIs with Groups, Schedule and Quick Actions
 */

import { store } from '../store.js';
import { auth } from '../auth.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { logger } from '../utils/logger.js';

export const AdminDashboard = {
  render(container) {
    const analytics = store.getAnalytics();
    const schedule = store.getSchedule();
    const students = store.getStudents();
    const groups = store.getGroups();
    const recentPoints = store.getPointRecords().slice(0, 5);

    // Top students by points
    const topStudents = [...students].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0)).slice(0, 4);

    container.innerHTML = `
      <div class="section-header">
        <div class="section-title-wrap">
          <h1>Дашборд Администратора</h1>
          <p>Общий обзор учебного процесса, групп, статистики практики и быстрые действия</p>
        </div>
        <div class="section-actions" style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-outline-primary btn-sm" id="btn-view-activity-logs" title="Журнал действий в системе">
            📜 Журнал действий
          </button>
          <button class="btn btn-outline-secondary btn-sm" id="btn-copy-tech-logs" title="Скопировать технический лог для диагностики">
            📋 Лог диагностики
          </button>
          <button class="btn btn-outline-primary btn-sm" id="btn-export-data">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Экспорт данных
          </button>
          <button class="btn btn-outline-secondary btn-sm" id="btn-admin-password" title="Сменить пароль входа администратора">🔑 Пароль</button>
          <button class="btn btn-secondary btn-sm" id="btn-reset-data" title="Загрузить файл резервной копии (.json) и заменить им все данные">Восстановить из копии</button>
          <input type="file" id="input-restore-backup" accept=".json,application/json" style="display:none;">
        </div>
      </div>

      <!-- Quick Actions Bar -->
      <div class="quick-actions-bar">
        <div class="quick-action-btn" id="action-quick-add-group">
          <div class="action-icon" style="background:#f3e8ff; color:#7e22ce;">👥</div>
          <div>
            <div class="font-semibold text-sm">Создать группу</div>
            <div class="text-xs text-muted">Формирование состава</div>
          </div>
        </div>

        <div class="quick-action-btn" id="action-quick-add-student">
          <div class="action-icon">👤</div>
          <div>
            <div class="font-semibold text-sm">Добавить ученика</div>
            <div class="text-xs text-muted">Анкета и назначение в группу</div>
          </div>
        </div>

        <div class="quick-action-btn" id="action-quick-add-lesson">
          <div class="action-icon">📅</div>
          <div>
            <div class="font-semibold text-sm">Назначить урок</div>
            <div class="text-xs text-muted">Для группы или ученика</div>
          </div>
        </div>

        <div class="quick-action-btn" id="action-quick-award-points">
          <div class="action-icon">⭐</div>
          <div>
            <div class="font-semibold text-sm">Начислить баллы</div>
            <div class="text-xs text-muted">За тесты, ДЗ и активность</div>
          </div>
        </div>
      </div>

      <!-- KPI Metrics Grid -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon primary">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          </div>
          <div class="stat-info">
            <span class="stat-label">Всего учеников</span>
            <span class="stat-value">${analytics.totalStudents}</span>
            <span class="stat-subtext">В ${analytics.totalGroups} учебных группах</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon" style="background:#f3e8ff; color:#7e22ce;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          </div>
          <div class="stat-info">
            <span class="stat-label">Учебных групп</span>
            <span class="stat-value">${analytics.totalGroups}</span>
            <span class="stat-subtext">Активные потоки</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon info">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          </div>
          <div class="stat-info">
            <span class="stat-label">Занятий в графике</span>
            <span class="stat-value">${analytics.totalLessons}</span>
            <span class="stat-subtext">${analytics.plannedLessons} запланировано</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon warning">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          </div>
          <div class="stat-info">
            <span class="stat-label">Средний балл</span>
            <span class="stat-value">${analytics.avgPoints} ⭐</span>
            <span class="stat-subtext">На одного ученика</span>
          </div>
        </div>
      </div>

      <!-- Dashboard Main Columns -->
      <div style="display: grid; grid-template-columns: 1.5fr 1fr; gap: var(--space-6);" class="dashboard-columns">
        <!-- Upcoming Lessons Section -->
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                Ближайшие уроки
              </h3>
              <p class="card-subtitle">Расписание на текущую неделю</p>
            </div>
            <a href="#schedule" class="text-sm font-semibold">Все расписание →</a>
          </div>

          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Время / День</th>
                  <th>Группа / Ученик</th>
                  <th>Преподаватель</th>
                  <th>Тема / Формат</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                ${schedule.slice(0, 5).map(item => {
                  const isGroup = !!item.groupId;
                  const group = isGroup ? store.getGroupById(item.groupId) : null;
                  const student = !isGroup ? store.getStudentById(item.studentId) : null;
                  const teacher = store.getTeacherById(item.teacherId);
                  const statusMap = {
                    planned: '<span class="badge badge-planned">Запланирован</span>',
                    completed: '<span class="badge badge-completed">Проведен</span>',
                    cancelled: '<span class="badge badge-cancelled">Отменен</span>'
                  };
                  return `
                    <tr>
                      <td>
                        <div class="font-semibold">${item.time}</div>
                        <div class="text-xs text-muted">${item.dayOfWeek}</div>
                      </td>
                      <td>
                        <div class="font-semibold">${isGroup ? `👥 ${group ? group.name : '—'}` : `👤 ${student ? student.fullName : '—'}`}</div>
                        <div class="text-xs text-muted">${isGroup ? `${group?.level} • ${store.getStudentsByGroupId(item.groupId).length} уч.` : student?.level}</div>
                      </td>
                      <td>${teacher ? teacher.fullName : '—'}</td>
                      <td>
                        <div>${item.topic}</div>
                        <div class="text-xs text-muted">${item.format}</div>
                      </td>
                      <td>${statusMap[item.status] || item.status}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Right Column: Recent Points & Top Students -->
        <div style="display: flex; flex-direction: column; gap: var(--space-6);">
          <!-- Top Students Card -->
          <div class="card">
            <div class="card-header">
              <div>
                <h3 class="card-title">🏆 Лидеры по баллам</h3>
                <p class="card-subtitle">Топ учеников практики</p>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: var(--space-3);">
              ${topStudents.map((s, idx) => {
                const grp = store.getGroupById(s.groupId);
                return `
                  <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border-subtle);">
                    <div style="display: flex; align-items: center; gap: var(--space-3);">
                      <span style="font-weight: 700; color: var(--color-text-muted); width: 16px;">#${idx + 1}</span>
                      <div>
                        <div class="font-semibold text-sm">${s.fullName}</div>
                        <div class="text-xs text-muted">${s.grade} • ${grp ? grp.name : 'Индивидуально'}</div>
                      </div>
                    </div>
                    <span class="badge badge-level level-${s.level.toLowerCase()}">${s.totalPoints} ⭐</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Recent Points Given -->
          <div class="card">
            <div class="card-header">
              <div>
                <h3 class="card-title">📝 Последние оценки</h3>
                <p class="card-subtitle">История начислений баллов</p>
              </div>
              <a href="#scoring" class="text-sm font-semibold">Журнал →</a>
            </div>
            <div class="points-timeline">
              ${recentPoints.map(p => {
                const st = store.getStudentById(p.studentId);
                const isPositive = (p.points || 0) >= 0;
                return `
                  <div class="point-item">
                    <div class="point-score-tag" style="${isPositive ? '' : 'background:#fee2e2; color:#991b1b;'}">
                      ${isPositive ? `+${p.points}` : p.points}
                    </div>
                    <div class="point-item-content">
                      <div class="point-item-header">
                        <span class="point-category" style="${isPositive ? '' : 'color:#b91c1c;'}">${p.category}</span>
                        <span class="point-date">${new Date(p.date).toLocaleDateString('ru-RU')}</span>
                      </div>
                      <div class="font-semibold text-sm">${st ? st.fullName : 'Ученик'}</div>
                      <div class="point-comment">${p.comment}</div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind Quick Action buttons
    document.getElementById('action-quick-add-group')?.addEventListener('click', () => {
      window.location.hash = '#groups';
      setTimeout(() => document.getElementById('btn-add-group')?.click(), 100);
    });

    document.getElementById('action-quick-add-student')?.addEventListener('click', () => {
      window.location.hash = '#students';
      setTimeout(() => document.getElementById('btn-add-student')?.click(), 100);
    });

    document.getElementById('action-quick-add-lesson')?.addEventListener('click', () => {
      window.location.hash = '#schedule';
      setTimeout(() => document.getElementById('btn-add-lesson')?.click(), 100);
    });

    document.getElementById('action-quick-award-points')?.addEventListener('click', () => {
      window.location.hash = '#scoring';
      setTimeout(() => document.getElementById('btn-award-points')?.click(), 100);
    });

    // Activity Logs & Diagnostics
    document.getElementById('btn-view-activity-logs')?.addEventListener('click', () => {
      this.openActivityLogsModal();
    });

    document.getElementById('btn-copy-tech-logs')?.addEventListener('click', async () => {
      const ok = await logger.copyDiagnosticsToClipboard();
      if (ok) {
        toast.success('Технический лог диагностики скопирован в буфер обмена!');
      } else {
        toast.info('Лог сформирован в консоли браузера');
      }
    });

    // Bind Data export & reset
    document.getElementById('btn-export-data')?.addEventListener('click', () => {
      // Full server-side backup (all collections, lessons and files metadata)
      const a = document.createElement('a');
      a.href = '/api/admin?action=export';
      a.setAttribute('download', '');
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    document.getElementById('btn-admin-password')?.addEventListener('click', () => {
      modal.open({
        title: 'Смена пароля администратора',
        bodyHtml: `
          <form id="form-admin-password">
            <div class="form-group">
              <label class="form-label">Новый пароль</label>
              <input type="password" name="p1" class="form-control" minlength="6" required autocomplete="new-password">
            </div>
            <div class="form-group">
              <label class="form-label">Повторите пароль</label>
              <input type="password" name="p2" class="form-control" minlength="6" required autocomplete="new-password">
            </div>
            <div class="form-hint">Не менее 6 символов. Пароль хранится на сервере в зашифрованном виде.</div>
          </form>`,
        footerHtml: `
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Отмена</button>
          <button type="submit" form="form-admin-password" class="btn btn-primary">Сохранить</button>`,
        onOpen: () => {
          document.getElementById('form-admin-password')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const f = new FormData(e.target);
            const p1 = String(f.get('p1') || '');
            if (p1.length < 6) { toast.error('Пароль должен быть не короче 6 символов'); return; }
            if (p1 !== String(f.get('p2') || '')) { toast.error('Пароли не совпадают'); return; }
            store.state.admin = { ...(store.state.admin || {}), password: p1 };
            store.saveState(true);
            modal.close();
            toast.success('Пароль администратора изменён');
          });
        }
      });
    });

    const restoreInput = document.getElementById('input-restore-backup');
    document.getElementById('btn-reset-data')?.addEventListener('click', () => restoreInput?.click());
    restoreInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (!confirm(`Заменить ВСЕ данные школы содержимым файла «${file.name}»?\n\nТекущие данные будут перезаписаны для всех пользователей. Перед восстановлением рекомендуется сделать «Экспорт данных».`)) return;
      try {
        const state = JSON.parse(await file.text());
        const res = await store.restoreBackup(state);
        toast.success(`Данные восстановлены из резервной копии (ревизия ${res.rev})`);
        setTimeout(() => window.location.reload(), 800);
      } catch (err) {
        toast.error('Не удалось восстановить через сайт: ' + (err.message || err) + '. Для больших копий используйте tools/prepare-migration.mjs (см. README).');
      }
    });
  },

  openActivityLogsModal() {
    let activeFilter = 'all';

    const renderLogsBody = (filterType) => {
      const logs = store.getActivityLogs({ type: filterType });
      const counts = {
        all: store.getActivityLogs({ type: 'all' }).length,
        points: store.getActivityLogs({ type: 'points' }).length,
        lesson: store.getActivityLogs({ type: 'lesson' }).length,
        auth: store.getActivityLogs({ type: 'auth' }).length
      };

      const getIcon = (type) => {
        if (type === 'points') return '⭐';
        if (type === 'lesson') return '📚';
        if (type === 'auth') return '🔑';
        if (type === 'student') return '👤';
        return '⚙️';
      };

      return `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <!-- Filter Tabs -->
          <div style="display:flex; gap:6px; flex-wrap:wrap; border-bottom:1px solid var(--color-border); padding-bottom:10px;">
            <button type="button" class="btn btn-xs ${filterType === 'all' ? 'btn-primary' : 'btn-secondary'} btn-log-tab" data-type="all">
              Все (${counts.all})
            </button>
            <button type="button" class="btn btn-xs ${filterType === 'points' ? 'btn-primary' : 'btn-secondary'} btn-log-tab" data-type="points">
              ⭐ Баллы (${counts.points})
            </button>
            <button type="button" class="btn btn-xs ${filterType === 'lesson' ? 'btn-primary' : 'btn-secondary'} btn-log-tab" data-type="lesson">
              📚 Уроки (${counts.lesson})
            </button>
            <button type="button" class="btn btn-xs ${filterType === 'auth' ? 'btn-primary' : 'btn-secondary'} btn-log-tab" data-type="auth">
              🔑 Входы (${counts.auth})
            </button>
          </div>

          <!-- Timeline Container -->
          <div style="max-height:480px; overflow-y:auto; padding-right:4px; display:flex; flex-direction:column; gap:8px;">
            ${logs.length === 0 ? `
              <div style="text-align:center; padding:32px 16px; color:var(--color-text-muted);">
                <div style="font-size:2rem; margin-bottom:8px;">📜</div>
                <div>Записей в журнале пока нет</div>
                <div class="text-xs" style="margin-top:4px;">События (входы, начисления, проведение уроков) будут отображаться здесь автоматически</div>
              </div>
            ` : logs.map(log => {
              const dt = new Date(log.timestamp);
              const dateStr = !isNaN(dt.getTime()) ? dt.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '';
              return `
                <div style="display:flex; gap:12px; align-items:flex-start; padding:10px 12px; background:var(--color-bg-app); border:1px solid var(--color-border); border-radius:var(--radius-md);">
                  <div style="font-size:1.3rem; line-height:1; padding-top:2px;">${getIcon(log.type)}</div>
                  <div style="flex:1; min-width:0;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                      <strong style="font-size:0.9rem; color:var(--color-text-main);">${log.title}</strong>
                      <span style="font-size:0.75rem; color:var(--color-text-muted); font-family:monospace; white-space:nowrap;">${dateStr}</span>
                    </div>
                    <div style="font-size:0.85rem; color:var(--color-text-secondary); margin-top:3px; word-break:break-word;">
                      ${log.details}
                    </div>
                    <div style="font-size:0.75rem; color:var(--color-text-muted); margin-top:4px; display:flex; gap:8px;">
                      <span>Инициатор: <strong>${log.authorName || 'Система'}</strong></span>
                      <span>•</span>
                      <span>Роль: ${log.authorRole || 'system'}</span>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    };

    modal.open({
      title: '📜 Журнал действий Step Up English',
      bodyHtml: `<div id="activity-logs-modal-container">${renderLogsBody('all')}</div>`,
      footerHtml: `
        <button type="button" class="btn btn-outline-secondary btn-sm" id="btn-modal-copy-diag">📋 Скопировать лог диагностики</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('main-modal').close()">Закрыть</button>
      `,
      onOpen: () => {
        const bindTabEvents = () => {
          document.querySelectorAll('.btn-log-tab').forEach(b => {
            b.addEventListener('click', (e) => {
              activeFilter = e.currentTarget.getAttribute('data-type') || 'all';
              const mount = document.getElementById('activity-logs-modal-container');
              if (mount) {
                mount.innerHTML = renderLogsBody(activeFilter);
                bindTabEvents();
              }
            });
          });
        };
        bindTabEvents();

        document.getElementById('btn-modal-copy-diag')?.addEventListener('click', async () => {
          const ok = await logger.copyDiagnosticsToClipboard();
          if (ok) toast.success('Технический лог диагностики скопирован в буфер обмена!');
        });
      }
    });
  }
};
