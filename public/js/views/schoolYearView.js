/**
 * School year: the admin sets the start, the winter break and the end; the site builds each group's months
 * (8 lessons in a row = 1 month of the textbook) from its weekly schedule — the table «Месяц 2026-2027».
 * Teachers see the tables; only the admin changes the dates.
 */
import { store } from '../store.js';
import { auth } from '../auth.js';
import { toast } from '../components/toast.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const ruDate = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '—');

export const SchoolYearView = {
  groupId: null,

  groups() {
    return (store.getGroups() || []).filter(g => g.status !== 'archived')
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  },

  /** The months of a group as table rows (empty cells when a month has fewer than 8 lessons) */
  tableHtml(group, { forPrint = false } = {}) {
    const months = store.getGroupLessonMonths(group.id);
    const today = store.todayDateStr();
    const days = store.getGroupScheduleSummary ? (store.getGroupScheduleSummary(group.id).days || '') : '';
    if (!months.length) {
      return `<div class="text-muted" style="padding: var(--space-4);">У группы «${esc(group.name)}» нет уроков в расписании. Назначьте дни и время в разделе «Расписание» — таблица построится сама.</div>`;
    }
    const current = store.getGroupCurrentLessonMonth(group.id);
    return `
      <table class="sy-table">
        <thead>
          <tr><th>Месяц</th><th colspan="8">Даты занятий${days ? ` · ${esc(days.toLowerCase())}` : ''}</th><th>сумма</th><th>подпись</th></tr>
        </thead>
        <tbody>
          ${months.map(m => `
            <tr class="${!forPrint && current && m.key === current.key ? 'sy-current' : ''}">
              <td class="sy-month">${esc(m.shortName)}</td>
              ${Array.from({ length: 8 }, (_, i) => {
                const d = m.dates[i];
                return `<td class="${!forPrint && d && d < today ? 'sy-past' : ''}">${d ? ddmm(d) : ''}</td>`;
              }).join('')}
              <td></td><td></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  },

  render(container) {
    const isAdmin = auth.isAdmin();
    const year = store.getSchoolYear();
    const groups = this.groups();
    if (!this.groupId || !groups.some(g => g.id === this.groupId)) this.groupId = groups[0]?.id || null;
    const group = groups.find(g => g.id === this.groupId) || null;
    const months = group ? store.getGroupLessonMonths(group.id) : [];
    const last = months[months.length - 1];
    const shortLast = last && last.dates.length < 8 ? last : null;
    const late = group && group.startDate && group.startDate > year.start;

    container.innerHTML = `
      <div class="section-header">
        <div class="section-title-wrap">
          <h1>📆 Учебный год</h1>
          <p class="text-muted text-sm">1 месяц учебника = 8 занятий группы подряд. Месяцы считаются от начала учебного года, зимние каникулы пропускаются — так все группы выходят в январе ровно и совпадают с учебниками.</p>
        </div>
      </div>

      <div class="card sy-dates">
        <h3 class="card-title" style="margin-bottom: var(--space-3);">Даты учебного года</h3>
        <div class="sy-dates-grid">
          <label class="form-group"><span class="form-label">Начало учебного года</span>
            <input type="date" id="sy-start" class="form-control" value="${year.start}" ${isAdmin ? '' : 'disabled'}></label>
          <label class="form-group"><span class="form-label">Зимние каникулы: с</span>
            <input type="date" id="sy-break-from" class="form-control" value="${year.breakFrom || ''}" ${isAdmin ? '' : 'disabled'}></label>
          <label class="form-group"><span class="form-label">Зимние каникулы: по</span>
            <input type="date" id="sy-break-to" class="form-control" value="${year.breakTo || ''}" ${isAdmin ? '' : 'disabled'}></label>
          <label class="form-group"><span class="form-label">Конец учебного года</span>
            <input type="date" id="sy-end" class="form-control" value="${year.end}" ${isAdmin ? '' : 'disabled'}></label>
        </div>
        ${isAdmin ? `
          <div style="display:flex; gap: var(--space-2); align-items:center; flex-wrap:wrap; margin-top: var(--space-3);">
            <button type="button" class="btn btn-primary" id="sy-save">💾 Сохранить даты</button>
            <span class="text-xs text-muted">После сохранения таблицы всех групп, журнал посещаемости и расписание сразу пересчитаются. В дни каникул уроки в расписании помечаются каникулами и не засчитываются.</span>
          </div>` : `
          <div class="text-xs text-muted" style="margin-top: var(--space-2);">Даты учебного года меняет администратор.</div>`}
      </div>

      <div class="card sy-table-card">
        <div style="display:flex; gap: var(--space-3); align-items:flex-end; flex-wrap:wrap; margin-bottom: var(--space-3);">
          <label class="form-group" style="margin:0; flex:1; min-width: 220px;"><span class="form-label">Группа</span>
            <select id="sy-group" class="form-control">
              ${groups.map(g => `<option value="${g.id}" ${g.id === this.groupId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="btn btn-secondary" id="sy-print" ${group && months.length ? '' : 'disabled'}>🖨️ Печать таблицы</button>
        </div>
        ${group ? `
          <div class="text-xs text-muted" style="margin-bottom: var(--space-2);">
            ${late ? `Группа начала занятия ${ruDate(group.startDate)}: её месяцы считаются от первого урока.` : `С ${ruDate(year.start)}${year.breakFrom ? `, каникулы ${ruDate(year.breakFrom)} – ${ruDate(year.breakTo)}` : ''}, до ${ruDate(year.end)}.`}
            Перенесённые и отменённые в «Расписании» уроки учтены.
          </div>
          <div class="sy-table-wrap">${this.tableHtml(group)}</div>
          ${shortLast ? `<div class="sy-warning">⚠️ В последнем месяце (${esc(shortLast.shortName.toLowerCase())}) получается ${shortLast.dates.length} из 8 занятий: учебный год заканчивается раньше. Проверьте конец года или расписание группы.</div>` : ''}
        ` : '<div class="text-muted">Групп пока нет.</div>'}
      </div>
    `;

    container.querySelector('#sy-group')?.addEventListener('change', (e) => { this.groupId = e.target.value; this.render(container); });
    container.querySelector('#sy-save')?.addEventListener('click', () => {
      const res = store.setSchoolYear({
        start: container.querySelector('#sy-start').value,
        breakFrom: container.querySelector('#sy-break-from').value,
        breakTo: container.querySelector('#sy-break-to').value,
        end: container.querySelector('#sy-end').value
      });
      if (res.success) { toast.success(res.message); this.render(container); } else toast.error(res.message);
    });
    container.querySelector('#sy-print')?.addEventListener('click', () => this.print(group));
  },

  /** A clean page with the table, for printing or saving as PDF */
  print(group) {
    if (!group) return;
    const year = store.getSchoolYear();
    const win = window.open('', '_blank');
    if (!win) { toast.error('Браузер заблокировал окно печати — разрешите всплывающие окна'); return; }
    win.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(group.name)} — учебный год</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
        h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 14px; font-size: 12px; color: #444; }
        table { border-collapse: collapse; width: 100%; font-size: 13px; }
        th, td { border: 1px solid #333; padding: 6px 4px; text-align: center; }
        td.sy-month { text-align: left; font-weight: bold; }
        th:last-child, td:last-child { width: 90px; } th:nth-last-child(2), td:nth-last-child(2) { width: 60px; }
      </style></head><body>
      <h1>${esc(group.name)}</h1>
      <p>Учебный год ${ruDate(year.start)} – ${ruDate(year.end)}${year.breakFrom ? `, зимние каникулы ${ruDate(year.breakFrom)} – ${ruDate(year.breakTo)}` : ''}. 1 месяц = 8 занятий.</p>
      ${this.tableHtml(group, { forPrint: true })}
      <script>window.onload = () => { window.print(); };<\/script>
      </body></html>`);
    win.document.close();
  }
};
