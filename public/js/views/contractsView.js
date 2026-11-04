/**
 * Contracts View - which students have a signed contract with the school (teachers and admin mark it)
 */

import { store } from '../store.js';
import { auth } from '../auth.js';
import { toast } from '../components/toast.js';
import { renderStudentAvatarHtml } from '../components/avatarCustomization.js';

export const ContractsView = {
  filterGroup: 'all',
  filterStatus: 'all', // 'all' | 'signed' | 'missing'
  searchQuery: '',

  getStudents() {
    let students = [...store.getStudents()].filter(s => s.status !== 'archived');
    if (this.filterGroup !== 'all') students = students.filter(s => s.groupId === this.filterGroup);
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase().trim();
      students = students.filter(s => (s.fullName || '').toLowerCase().includes(q) || (s.phone || '').includes(q));
    }
    return students.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'ru'));
  },

  renderRows(students) {
    if (!students.length) {
      return `<div class="empty-state" style="padding: var(--space-6) 0;"><div class="empty-state-title">Ученики по заданным фильтрам не найдены</div></div>`;
    }
    return students.map(s => {
      const group = store.getGroupById(s.groupId);
      const signed = Boolean(s.contract?.signed);
      return `
        <div class="contract-row ${signed ? 'is-signed' : 'is-missing'}">
          <div class="contract-student">
            ${renderStudentAvatarHtml(s, { size: 'sm' })}
            <div style="min-width: 0;">
              <div class="contract-name">${s.fullName}</div>
              <div class="contract-meta">👥 ${group ? group.name : 'Индивидуально'}${s.parentName ? ` • ${s.parentName}` : ''}${s.phone ? ` • ${s.phone}` : ''}</div>
              ${signed && s.contract.at ? `<div class="contract-meta">Отмечено ${new Date(s.contract.at).toLocaleDateString('ru-RU')}${s.contract.by ? ` • ${s.contract.by}` : ''}</div>` : ''}
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-toggle-contract ${signed ? 'is-signed' : ''}" data-student-id="${s.id}" title="Нажмите, чтобы изменить отметку">
            ${signed ? '📄 Есть договор' : '✕ Нет договора'}
          </button>
        </div>
      `;
    }).join('');
  },

  render(container) {
    const groups = store.getGroups();
    const all = this.getStudents();
    const signedCount = all.filter(s => s.contract?.signed).length;
    const shown = all.filter(s => this.filterStatus === 'all' || (this.filterStatus === 'signed') === Boolean(s.contract?.signed));

    container.innerHTML = `
      <div class="section-header">
        <div class="section-title-wrap">
          <h1>📄 Договоры</h1>
          <p>Отметьте учеников, с родителями которых подписан договор. Нажатие на кнопку меняет отметку.</p>
        </div>
      </div>

      <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); margin-bottom: var(--space-5);">
        <div class="stat-card">
          <div class="stat-icon" style="background:#e0e7ff; color:#4338ca;">👥</div>
          <div><div class="stat-value">${all.length}</div><div class="stat-label">Учеников в выборке</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#dcfce7; color:#16a34a;">📄</div>
          <div><div class="stat-value" style="color:#16a34a;">${signedCount}</div><div class="stat-label">Договор есть</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fee2e2; color:#dc2626;">✕</div>
          <div><div class="stat-value" style="color:#dc2626;">${all.length - signedCount}</div><div class="stat-label">Договора нет</div></div>
        </div>
      </div>

      <div class="filter-bar" style="margin-bottom: var(--space-4); display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center;">
        <select id="contracts-group" class="form-control" style="width:auto; min-width: 160px;">
          <option value="all">Все группы</option>
          ${groups.map(g => `<option value="${g.id}" ${this.filterGroup === g.id ? 'selected' : ''}>${g.name}</option>`).join('')}
        </select>
        <select id="contracts-status" class="form-control" style="width:auto; min-width: 150px;">
          <option value="all" ${this.filterStatus === 'all' ? 'selected' : ''}>Все</option>
          <option value="missing" ${this.filterStatus === 'missing' ? 'selected' : ''}>Без договора</option>
          <option value="signed" ${this.filterStatus === 'signed' ? 'selected' : ''}>С договором</option>
        </select>
        <input type="search" id="contracts-search" class="form-control" placeholder="Поиск по имени..." value="${this.searchQuery}" style="width: 200px; max-width: 100%;" autocomplete="off">
      </div>

      <div class="contract-list" id="contracts-list">${this.renderRows(shown)}</div>
    `;

    container.querySelector('#contracts-group').addEventListener('change', (e) => { this.filterGroup = e.target.value; this.render(container); });
    container.querySelector('#contracts-status').addEventListener('change', (e) => { this.filterStatus = e.target.value; this.render(container); });
    const search = container.querySelector('#contracts-search');
    search.addEventListener('input', () => {
      this.searchQuery = search.value;
      const list = this.getStudents().filter(s => this.filterStatus === 'all' || (this.filterStatus === 'signed') === Boolean(s.contract?.signed));
      container.querySelector('#contracts-list').innerHTML = this.renderRows(list);
    });
    container.querySelector('#contracts-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-toggle-contract');
      if (!btn) return;
      const student = store.getStudentById(btn.dataset.studentId);
      if (!student) return;
      const signed = !student.contract?.signed;
      store.setStudentContract(student.id, signed, auth.getCurrentUser()?.name || '');
      toast.success(signed ? `📄 ${student.fullName}: договор отмечен` : `${student.fullName}: отметка о договоре снята`);
      this.render(container);
    });
  }
};
