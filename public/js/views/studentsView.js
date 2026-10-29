/**
 * Students Management View - Full CRUD, Search, Filter by Group/Level, and Student Details
 */

import { store, formatGrade, gradeSelectHtml } from '../store.js';
import { auth } from '../auth.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { renderStudentAvatarHtml } from '../components/avatarCustomization.js';
import { parseStudentsDocx } from '../utils/docxParser.js';

export const StudentsView = {
  filterGroup: 'all',
  filterLevel: 'all',
  filterShift: 'all',
  searchQuery: '',

  render(container) {
    const activeEl = document.activeElement;
    const activeId = (activeEl && container.contains(activeEl)) ? activeEl.id : null;
    const activeStart = activeEl?.selectionStart;
    const activeEnd = activeEl?.selectionEnd;

    const canManage = auth.isAdmin() || auth.isTeacher();
    const groups = store.getGroups();
    const students = store.getStudents({
      groupId: this.filterGroup,
      level: this.filterLevel,
      shift: this.filterShift,
      search: this.searchQuery
    });

    container.innerHTML = `
      <div class="section-header">
        <div class="section-title-wrap">
          <h1>Ученики</h1>
          <p>База учащихся, распределение по учебным группам, контактные данные и успеваемость</p>
        </div>
        <div class="section-actions">
          ${canManage ? `
            <button class="btn btn-outline-primary" id="btn-import-students-docx" title="Загрузить сразу нескольких учеников из Word">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
              📥 Загрузить из Word (.docx)
            </button>
            <button class="btn btn-primary" id="btn-add-student">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Добавить ученика
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Filters & Search Toolbar -->
      <div class="filter-bar">
        <div class="filter-item">
          <label class="form-label">Группа:</label>
          <select id="filter-student-group" class="form-control">
            <option value="all" ${this.filterGroup === 'all' ? 'selected' : ''}>Все группы</option>
            <option value="none" ${this.filterGroup === 'none' ? 'selected' : ''}>👥 Без группы (новые)</option>
            ${groups.map(g => `<option value="${g.id}" ${this.filterGroup === g.id ? 'selected' : ''}>${g.name} (${g.level})</option>`).join('')}
          </select>
        </div>

        <div class="filter-item">
          <label class="form-label">Уровень:</label>
          <select id="filter-student-level" class="form-control">
            <option value="all" ${this.filterLevel === 'all' ? 'selected' : ''}>Все уровни</option>
            <option value="Beginner" ${this.filterLevel === 'Beginner' ? 'selected' : ''}>Beginner</option>
            <option value="Elementary" ${this.filterLevel === 'Elementary' ? 'selected' : ''}>Elementary</option>
            <option value="Pre-Intermediate" ${this.filterLevel === 'Pre-Intermediate' ? 'selected' : ''}>Pre-Intermediate</option>
            <option value="Intermediate" ${this.filterLevel === 'Intermediate' ? 'selected' : ''}>Intermediate</option>
            <option value="Upper-Intermediate" ${this.filterLevel === 'Upper-Intermediate' ? 'selected' : ''}>Upper-Intermediate</option>
            <option value="Advanced" ${this.filterLevel === 'Advanced' ? 'selected' : ''}>Advanced</option>
          </select>
        </div>

        <div class="filter-item">
          <label class="form-label">Смена:</label>
          <select id="filter-student-shift" class="form-control">
            <option value="all" ${this.filterShift === 'all' ? 'selected' : ''}>Все смены</option>
            <option value="Первая" ${this.filterShift === 'Первая' ? 'selected' : ''}>1 смена</option>
            <option value="Вторая" ${this.filterShift === 'Вторая' ? 'selected' : ''}>2 смена</option>
          </select>
        </div>

        <div class="filter-item" style="margin-left: auto;">
          <input type="search" id="input-student-search" class="form-control" placeholder="Поиск по имени, школе..." value="${this.searchQuery}" style="width: 240px;" autocomplete="off">
        </div>
      </div>

      <!-- Students Cards Grid -->
      <div id="students-grid-container">
        ${students.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">🔍</div>
            <div class="empty-state-title">Ученики не найдены</div>
            <div class="empty-state-desc">Попробуйте изменить параметры поиска или добавьте нового ученика.</div>
            ${canManage ? `<button class="btn btn-primary btn-sm" id="btn-empty-add-student">Добавить ученика</button>` : ''}
          </div>
        ` : `
          <div class="students-grid">
            ${students.map(s => this.renderStudentCard(s, canManage)).join('')}
          </div>
        `}
      </div>
    `;

    this.bindEvents(container);

    if (activeId) {
      const el = container.querySelector('#' + activeId);
      if (el && typeof el.focus === 'function') {
        el.focus();
        if (typeof activeStart === 'number' && typeof activeEnd === 'number') {
          try { el.setSelectionRange(activeStart, activeEnd); } catch (_) {}
        }
      }
    }
  },

  renderStudentCard(student, canManage = false) {
    const levelClass = 'level-' + student.level.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const shiftClass = student.shift === 'Первая' ? 'badge-shift-1' : 'badge-shift-2';
    const group = store.getGroupById(student.groupId);
    const currMonth = store.getCurrentAcademicMonth();
    const payment = store.getPayment(student.id, currMonth.key);
    const isPaid = payment && payment.status === 'paid';
    const attStats = store.getStudentAttendanceStats(student.id);

    return `
      <div class="student-card" data-student-id="${student.id}">
        <div>
          <div class="student-card-header">
            <div style="display:flex; align-items:center; gap:var(--space-3);">
              ${renderStudentAvatarHtml(student, { size: 'md' })}
              <div class="student-meta">
                <div class="student-name">${student.fullName}</div>
                ${student.studentTitle ? `
                  <div style="margin: 2px 0;">
                    <span class="student-title-badge light" style="font-size:0.68rem; padding: 1px 8px;">
                      ${student.studentTitle}
                    </span>
                  </div>
                ` : ''}
                <div class="student-grade-school">${formatGrade(student.grade)} • ${student.school || 'Школа не указана'}</div>
              </div>
            </div>
            <div class="student-points-badge">⭐ ${student.totalPoints || 0}</div>
          </div>

          <div class="student-card-details">
            <div class="detail-row">
              <span class="detail-label">Группа:</span>
              <span class="detail-val truncate" style="max-width: 180px; font-weight:700; color:var(--color-primary);" title="${group ? group.name : 'Индивидуально'}">
                👥 ${group ? group.name : 'Индивидуально'}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Уровень:</span>
              <span class="badge badge-level ${levelClass}">${student.level}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Смена:</span>
              <span class="badge ${shiftClass}">${student.shift} смена</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Посещаемость:</span>
              <span class="detail-val" style="font-weight:700; color:${attStats.percentage >= 80 ? 'var(--color-success)' : 'var(--color-warning-text)'};">
                ${attStats.percentage}% (${attStats.attended}/${attStats.total})
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Оплата (${currMonth.shortName}):</span>
              <span class="badge ${isPaid ? 'badge-completed' : 'badge-cancelled'}" style="font-size:0.7rem; padding:1px 8px;">
                ${isPaid ? '✓ Оплачено' : '⏳ Не оплачено'}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Учебник:</span>
              <span class="detail-val truncate" style="max-width: 170px;" title="${student.textbook}">${student.textbook || '—'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Телефон:</span>
              <span class="detail-val">${student.phone || '—'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">🔑 PIN-код:</span>
              <span class="detail-val font-bold" style="color:var(--color-primary); font-family:monospace; letter-spacing:0.1em;">${store.getStudentPin(student)}</span>
            </div>
          </div>
        </div>

        <div class="student-card-footer">
          <button class="btn btn-secondary btn-sm btn-view-profile" data-id="${student.id}">
            Карточка ученика
          </button>
          
          <div style="display:flex; gap:var(--space-2);">
            ${canManage ? `
              <button class="btn btn-ghost btn-sm btn-edit-student" data-id="${student.id}" title="Редактировать">✏️</button>
              <button class="btn btn-ghost btn-sm btn-delete-student" data-id="${student.id}" title="Удалить" style="color:var(--color-danger)">🗑️</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  updateGridOnly(container) {
    const canManage = auth.isAdmin() || auth.isTeacher();
    const students = store.getStudents({
      groupId: this.filterGroup,
      level: this.filterLevel,
      shift: this.filterShift,
      search: this.searchQuery
    });
    const gridContainer = container.querySelector('#students-grid-container');
    if (gridContainer) {
      gridContainer.innerHTML = students.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <div class="empty-state-title">Ученики не найдены</div>
          <div class="empty-state-desc">Попробуйте изменить параметры поиска или добавьте нового ученика.</div>
          ${canManage ? `<button class="btn btn-primary btn-sm" id="btn-empty-add-student">Добавить ученика</button>` : ''}
        </div>
      ` : `
        <div class="students-grid">
          ${students.map(s => this.renderStudentCard(s, canManage)).join('')}
        </div>
      `;
      this.bindCardEvents(container);
    }
  },

  bindCardEvents(container) {
    container.querySelector('#btn-empty-add-student')?.addEventListener('click', () => this.openAddModal(container));

    container.querySelectorAll('.btn-view-profile').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.openProfileModal(id);
      });
    });

    container.querySelectorAll('.btn-edit-student').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.openEditModal(id, container);
      });
    });

    container.querySelectorAll('.btn-delete-student').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const st = store.getStudentById(id);
        if (confirm(`Удалить ученика "${st ? st.fullName : ''}"?`)) {
          store.deleteStudent(id);
          toast.success('Ученик удален');
          this.render(container);
        }
      });
    });
  },

  bindEvents(container) {
    container.querySelector('#filter-student-group')?.addEventListener('change', (e) => {
      this.filterGroup = e.target.value;
      this.render(container);
    });

    container.querySelector('#filter-student-level')?.addEventListener('change', (e) => {
      this.filterLevel = e.target.value;
      this.render(container);
    });

    container.querySelector('#filter-student-shift')?.addEventListener('change', (e) => {
      this.filterShift = e.target.value;
      this.render(container);
    });

    container.querySelector('#input-student-search')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.updateGridOnly(container);
    });

    container.querySelector('#btn-add-student')?.addEventListener('click', () => this.openAddModal(container));
    container.querySelector('#btn-import-students-docx')?.addEventListener('click', () => this.openImportModal(container));

    this.bindCardEvents(container);
  },

  openAddModal(container) {
    const groups = store.getGroups();

    modal.open({
      title: 'Добавить нового ученика',
      bodyHtml: `
        <form id="form-add-student">
          <div class="form-group">
            <label class="form-label">ФИО ученика <span class="required">*</span></label>
            <input type="text" name="fullName" class="form-control" placeholder="например, Александр Иванов" required>
          </div>

          <div class="form-group">
            <label class="form-label">Учебная группа</label>
            <select name="groupId" id="select-student-group" class="form-control">
              <option value="">-- Без группы (Индивидуально) --</option>
              ${groups.map(g => `<option value="${g.id}">${g.name} (${g.level})</option>`).join('')}
            </select>
          </div>

          ${auth.isAdmin() ? `
            <div class="form-group">
              <label class="form-label">Преподаватель</label>
              <select name="teacherId" class="form-control">
                <option value="">— не закреплён —</option>
                ${(store.state.teachers || []).filter(t => t.status !== 'archived').map(t => `<option value="${t.id}" ${(store.scopeTeacherId() || '') === t.id ? 'selected' : ''}>${t.fullName}</option>`).join('')}
              </select>
              <div class="form-hint">Ученик в группе принадлежит преподавателю группы; это поле нужно для учеников без группы.</div>
            </div>
          ` : ''}

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Телефон ученика</label>
              <input type="tel" name="phone" class="form-control" placeholder="+7 (999) 000-00-00">
            </div>
            <div class="form-group">
              <label class="form-label">Класс / курс</label>
              ${gradeSelectHtml('')}
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Школа (номер / название)</label>
              <input type="text" name="school" class="form-control" placeholder="например, Гимназия №15">
            </div>
            <div class="form-group">
              <label class="form-label">Смена в школе</label>
              <select name="shift" class="form-control">
                <option value="Первая">Первая смена</option>
                <option value="Вторая">Вторая смена</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Уровень английского языка</label>
              <select name="level" id="input-student-level" class="form-control">
                <option value="Beginner">Beginner (Начальный)</option>
                <option value="Elementary">Elementary (Элементарный)</option>
                <option value="Pre-Intermediate" selected>Pre-Intermediate (Ниже среднего)</option>
                <option value="Intermediate">Intermediate (Средний)</option>
                <option value="Upper-Intermediate">Upper-Intermediate (Выше среднего)</option>
                <option value="Advanced">Advanced (Продвинутый)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Текущий учебник</label>
              <input type="text" name="textbook" id="input-student-textbook" list="textbooks-datalist" class="form-control" placeholder="например, English world 1">
              <datalist id="textbooks-datalist">
                ${store.getTextbooks().map(tb => `<option value="${tb}">`).join('')}
              </datalist>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Информация о родителях (ФИО, статус)</label>
              <input type="text" name="parentName" class="form-control" placeholder="например, Иванова Ольга (Мама)">
            </div>
            <div class="form-group">
              <label class="form-label">Телефон родителей</label>
              <input type="tel" name="parentPhone" class="form-control" placeholder="+7 (999) 111-22-33">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Начальные баллы</label>
            <input type="number" name="totalPoints" class="form-control" value="0" min="0">
          </div>

          <div class="form-group">
            <label class="form-label">Педагогические заметки</label>
            <textarea name="notes" class="form-control" rows="2" placeholder="Особенности ученика, цели обучения..."></textarea>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Отмена</button>
        <button type="submit" form="form-add-student" class="btn btn-primary">Сохранить ученика</button>
      `,
      onOpen: () => {
        // Auto-fill level and textbook from group on change
        document.getElementById('select-student-group')?.addEventListener('change', (e) => {
          const grp = store.getGroupById(e.target.value);
          if (grp) {
            const levelSelect = document.getElementById('input-student-level');
            const textbookInput = document.getElementById('input-student-textbook');
            if (levelSelect) levelSelect.value = grp.level;
            if (textbookInput) textbookInput.value = grp.textbook;
          }
        });

        document.getElementById('form-add-student')?.addEventListener('submit', (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const data = Object.fromEntries(formData.entries());
          store.addStudent(data);
          modal.close();
          toast.success(`Ученик ${data.fullName} добавлен!`);
          this.render(container);
        });
      }
    });
  },

  openEditModal(studentId, container) {
    const student = store.getStudentById(studentId);
    if (!student) return;

    const groups = store.getGroups();

    modal.open({
      title: `Редактирование: ${student.fullName}`,
      bodyHtml: `
        <form id="form-edit-student">
          <div class="form-group">
            <label class="form-label">ФИО ученика <span class="required">*</span></label>
            <input type="text" name="fullName" class="form-control" value="${student.fullName}" required>
          </div>

          <div class="form-group">
            <label class="form-label">Учебная группа</label>
            <select name="groupId" class="form-control">
              <option value="">-- Без группы (Индивидуально) --</option>
              ${groups.map(g => `<option value="${g.id}" ${student.groupId === g.id ? 'selected' : ''}>${g.name} (${g.level})</option>`).join('')}
            </select>
          </div>

          ${auth.isAdmin() ? `
            <div class="form-group">
              <label class="form-label">Преподаватель</label>
              <select name="teacherId" class="form-control">
                <option value="">— не закреплён —</option>
                ${(store.state.teachers || []).filter(t => t.status !== 'archived').map(t => `<option value="${t.id}" ${(student.teacherId || '') === t.id ? 'selected' : ''}>${t.fullName}</option>`).join('')}
              </select>
              <div class="form-hint">Ученик в группе принадлежит преподавателю группы; это поле нужно для учеников без группы.</div>
            </div>
          ` : ''}

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Телефон ученика</label>
              <input type="tel" name="phone" class="form-control" value="${student.phone || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Класс / курс</label>
              ${gradeSelectHtml(student.grade)}
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Школа</label>
              <input type="text" name="school" class="form-control" value="${student.school || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Смена</label>
              <select name="shift" class="form-control">
                <option value="Первая" ${student.shift === 'Первая' ? 'selected' : ''}>Первая смена</option>
                <option value="Вторая" ${student.shift === 'Вторая' ? 'selected' : ''}>Вторая смена</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Уровень английского</label>
              <select name="level" class="form-control">
                <option value="Beginner" ${student.level === 'Beginner' ? 'selected' : ''}>Beginner</option>
                <option value="Elementary" ${student.level === 'Elementary' ? 'selected' : ''}>Elementary</option>
                <option value="Pre-Intermediate" ${student.level === 'Pre-Intermediate' ? 'selected' : ''}>Pre-Intermediate</option>
                <option value="Intermediate" ${student.level === 'Intermediate' ? 'selected' : ''}>Intermediate</option>
                <option value="Upper-Intermediate" ${student.level === 'Upper-Intermediate' ? 'selected' : ''}>Upper-Intermediate</option>
                <option value="Advanced" ${student.level === 'Advanced' ? 'selected' : ''}>Advanced</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Текущий учебник</label>
              <input type="text" name="textbook" list="edit-textbooks-datalist" class="form-control" value="${student.textbook || ''}">
              <datalist id="edit-textbooks-datalist">
                ${store.getTextbooks().map(tb => `<option value="${tb}">`).join('')}
              </datalist>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Родитель (ФИО)</label>
              <input type="text" name="parentName" class="form-control" value="${student.parentName || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Телефон родителей</label>
              <input type="tel" name="parentPhone" class="form-control" value="${student.parentPhone || ''}">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Заметки</label>
            <textarea name="notes" class="form-control" rows="2">${student.notes || ''}</textarea>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Отмена</button>
        <button type="submit" form="form-edit-student" class="btn btn-primary">Сохранить изменения</button>
      `,
      onOpen: () => {
        document.getElementById('form-edit-student')?.addEventListener('submit', (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const data = Object.fromEntries(formData.entries());
          if ('teacherId' in data) data.teacherId = data.teacherId || null;
          store.updateStudent(studentId, data);
          modal.close();
          toast.success('Данные ученика обновлены');
          this.render(container);
        });
      }
    });
  },

  openProfileModal(studentId) {
    const student = store.getStudentById(studentId);
    if (!student) return;

    const group = store.getGroupById(student.groupId);
    const pointsHistory = store.getPointRecords(studentId);
    const lessons = store.getSchedule({ studentId });
    const purchases = store.getPurchases ? store.getPurchases({ studentId }) : [];

    const academicMonths = store.getAcademicMonthsList();
    const currentMonth = store.getCurrentAcademicMonth();
    const monthlyLeaderboard = store.getGroupMonthlyLeaderboard(student.groupId, currentMonth.year, currentMonth.monthIndex);
    const myRankObj = monthlyLeaderboard.find(l => l.studentId === student.id);
    const profileAttStats = store.getStudentAttendanceStats(studentId);
    const profilePayment = store.getPayment(studentId, currentMonth.key);
    const profileIsPaid = profilePayment && profilePayment.status === 'paid';

    modal.open({
      title: `Профиль ученика: ${student.fullName}`,
      bodyHtml: `
        <div style="display:flex; flex-direction:column; gap:var(--space-5);">
          <!-- Summary Header -->
          <div style="display:flex; align-items:center; justify-content:space-between; background:var(--color-bg-app); padding:var(--space-4); border-radius:var(--radius-lg); border:1px solid var(--color-border); gap: var(--space-4); flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:var(--space-4);">
              ${renderStudentAvatarHtml(student, { size: 'lg' })}
              <div>
                <div style="font-size:var(--font-size-lg); font-weight:700;">${student.fullName}</div>
                ${student.studentTitle ? `
                  <div style="margin: 2px 0;">
                    <span class="student-title-badge light" style="font-size:0.72rem; padding: 2px 10px;">
                      ${student.studentTitle}
                    </span>
                  </div>
                ` : ''}
                <div class="text-sm text-muted">${formatGrade(student.grade)} • ${student.school} • ${student.shift} смена</div>
                <div class="badge badge-planned" style="margin-top:4px;">👥 ${group ? group.name : 'Индивидуальное обучение'}${group?.scheduleTime ? ` • ⏰ ${group.scheduleTime}` : ''}</div>
              </div>
            </div>
            <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
              <div style="font-size:1.35rem; font-weight:800; color:var(--color-warning-text);" title="Баланс для покупок в магазине">⭐ ${student.totalPoints || 0}</div>
              <div style="font-size:0.75rem; color:var(--color-text-secondary); font-weight:600;">
                Заработанно за всё время: <strong style="color:var(--color-text-main);">${student.lifetimePoints != null ? student.lifetimePoints : (student.totalPoints || 0)} ⭐</strong>
              </div>
              <span class="badge badge-level level-${student.level.toLowerCase()}">${student.level}</span>
            </div>
          </div>

          <!-- Payment & Attendance Summary Card -->
          <div class="card" style="padding:var(--space-4); background:var(--color-bg-app); border:1px solid var(--color-border);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-3); flex-wrap:wrap; gap:8px;">
              <h4 style="margin:0; font-size:var(--font-size-sm); color:var(--color-text-main);">💳 Оплата и Посещаемость</h4>
              <span class="badge ${profileIsPaid ? 'badge-completed' : 'badge-cancelled'}" style="font-size:0.75rem; padding:3px 10px; font-weight:700;">
                ${currentMonth.name}: ${profileIsPaid ? '✓ Оплачено' : '⏳ Не оплачено'}
              </span>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-3); font-size:var(--font-size-sm);">
              <div><strong>Посещаемость:</strong> <span style="font-weight:700; color:${profileAttStats.percentage >= 80 ? '#16a34a' : '#ea580c'};">${profileAttStats.percentage}%</span> (${profileAttStats.attended} из ${profileAttStats.total} уроков)</div>
              <div><strong>Пропусков:</strong> <span style="font-weight:700; color:${profileAttStats.missed > 0 ? '#dc2626' : 'inherit'};">${profileAttStats.missed}</span></div>
            </div>
          </div>

          <!-- Academic & Textbook Info -->
          <div class="card" style="padding:var(--space-4);">
            <h4 style="margin-bottom:var(--space-3); font-size:var(--font-size-sm);">📚 Учебные материалы и контакты</h4>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-3); font-size:var(--font-size-sm);">
              <div><strong>Учебник:</strong> ${student.textbook || 'Не указан'}</div>
              <div><strong>Телефон (логин):</strong> ${student.phone ? `<a href="tel:${student.phone}">${student.phone}</a>` : '—'}</div>
              <div><strong>🔑 Персональный PIN:</strong> <span style="font-family:monospace; font-weight:800; color:#4338ca; background:#e0e7ff; padding:2px 8px; border-radius:4px; font-size:0.95rem; letter-spacing:0.12em;">${store.getStudentPin(student)}</span></div>
              <div><strong>Родители:</strong> ${student.parentName || '—'}</div>
              <div><strong>Тел. родителей:</strong> ${student.parentPhone ? `<a href="tel:${student.parentPhone}">${student.parentPhone}</a>` : '—'}</div>
            </div>
            ${student.notes ? `
              <div style="margin-top:var(--space-3); padding-top:var(--space-3); border-top:1px solid var(--color-border-subtle); font-size:var(--font-size-xs); color:var(--color-text-secondary);">
                <strong>Педагогические заметки:</strong> ${student.notes}
              </div>
            ` : ''}
          </div>

          <!-- Monthly Group Performance -->
          <div class="card" style="padding:var(--space-4); background:linear-gradient(180deg, #f8faff 0%, #ffffff 100%); border:1px solid #e0e7ff;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-2);">
              <h4 style="margin:0; font-size:var(--font-size-sm); color:var(--color-primary); display:flex; align-items:center; gap:6px;">
                🏆 Результат в группе за Сентябрь 2026
              </h4>
              ${myRankObj ? `
                <span class="badge ${myRankObj.rank === 1 ? 'badge-completed' : myRankObj.rank === 2 ? 'badge-planned' : 'badge'}" style="${myRankObj.rank === 1 ? 'background:#ca8a04; color:#fff;' : ''}">
                  ${myRankObj.rank === 1 ? '🥇 1 место в группе' : myRankObj.rank === 2 ? '🥈 2 место в группе' : myRankObj.rank === 3 ? '🥉 3 место в группе' : `${myRankObj.rank}-е место в группе`}
                </span>
              ` : ''}
            </div>
            <div style="font-size:var(--font-size-xs); color:var(--color-text-secondary);">
              ${myRankObj ? `
                Чистый итог месяца: <strong style="color:var(--color-primary); font-size:0.9rem;">${myRankObj.netMonthlyPoints >= 0 ? `+${myRankObj.netMonthlyPoints}` : myRankObj.netMonthlyPoints} ⭐</strong>
                (Начислено: <span style="color:#16a34a; font-weight:600;">+${myRankObj.addedPoints}</span>, Списано: <span style="color:#dc2626; font-weight:600;">-${myRankObj.deductedPoints}</span>, Операций: ${myRankObj.operationsCount})
              ` : 'Нет данных об участии в группе'}
            </div>
          </div>

          <!-- Points History -->
          <div>
            <h4 style="margin-bottom:var(--space-3); font-size:var(--font-size-sm);">⭐ История баллов и тестов (${pointsHistory.length})</h4>
            ${pointsHistory.length === 0 ? `
              <div class="text-sm text-muted">Пока нет начисленных баллов.</div>
            ` : `
              <div class="points-timeline" style="max-height: 240px; overflow-y:auto; padding-right: 4px;">
                ${pointsHistory.map(p => {
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
                        <div class="point-comment">${p.comment || p.category || (isPositive ? 'Поощрение за урок' : 'Вычет баллов')}</div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <!-- Purchases in Shop -->
          <div>
            <h4 style="margin-bottom:var(--space-3); font-size:var(--font-size-sm); display:flex; justify-content:space-between; align-items:center;">
              <span>🛍️ Покупки в магазине</span>
              <span class="text-xs text-muted">${purchases.length} шт.</span>
            </h4>
            ${purchases.length === 0 ? `
              <div class="text-sm text-muted">Ученик пока ничего не покупал в магазине.</div>
            ` : `
              <div style="display:flex; flex-direction:column; gap:var(--space-2); max-height:160px; overflow-y:auto;">
                ${purchases.map(pur => `
                  <div style="padding:var(--space-2) var(--space-3); background:var(--color-bg-app); border-radius:var(--radius-md); font-size:var(--font-size-xs); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                      <span style="font-weight:700;">${pur.itemType === 'avatar' ? '🎭' : pur.itemType === 'frame' ? '🖼️' : pur.itemType === 'title' ? '👑' : '📦'} ${pur.itemName}</span>
                      <span class="text-muted" style="margin-left:6px;">(${new Date(pur.date).toLocaleDateString('ru-RU')})</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span style="font-weight:700; color:#f59e0b;">${pur.price} ⭐</span>
                      <span class="badge badge-${pur.status === 'completed' ? 'completed' : 'cancelled'}" style="font-size:0.7rem;">
                        ${pur.status === 'completed' ? '✓ Куплено' : '✕ Отменено'}
                      </span>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <!-- 2 Nearest Lessons -->
          <div>
            <h4 style="margin-bottom:var(--space-3); font-size:var(--font-size-sm); display:flex; justify-content:space-between; align-items:center;">
              <span>📅 Ближайшие занятия</span>
              <span class="text-xs text-muted">2 ближайших урока</span>
            </h4>
            ${(() => {
              const nearest = lessons.filter(l => l.status === 'planned').slice(0, 2);
              if (nearest.length === 0) {
                return '<div class="text-sm text-muted">Нет запланированных занятий на ближайшее время.</div>';
              }
              return `
                <div style="display:flex; flex-direction:column; gap:var(--space-2);">
                  ${nearest.map(l => {
                    const teacher = store.getTeacherById(l.teacherId);
                    return `
                      <div style="padding:var(--space-3); background:var(--color-bg-app); border-radius:var(--radius-md); font-size:var(--font-size-xs); display:flex; justify-content:space-between; align-items:center; border-left:3px solid var(--color-primary);">
                        <div>
                          <strong>⏰ ${l.dayOfWeek} ${l.time} ${l.date ? `(${l.date})` : ''}</strong> — ${l.topic}
                          <div class="text-muted" style="margin-top:2px;">${l.groupId ? `Групповой урок • ` : `Индивидуальный • `} Преподаватель: ${teacher ? teacher.fullName : '—'} • ${l.format}</div>
                        </div>
                        <span class="badge badge-planned">⏳ Запланирован</span>
                      </div>
                    `;
                  }).join('')}
                </div>
              `;
            })()}
          </div>
        </div>
      `,
      footerHtml: `
        <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
          ${auth.isAdmin() || auth.isTeacher() ? `
            <button type="button" class="btn btn-ghost btn-sm btn-modal-delete-student" data-id="${student.id}" style="color:var(--color-danger); font-weight:600;">
              🗑️ Удалить ученика
            </button>
          ` : '<div></div>'}
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Закрыть</button>
        </div>
      `,
      onOpen: () => {
        document.querySelector('.btn-modal-delete-student')?.addEventListener('click', (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          if (confirm(`Удалить ученика "${student.fullName}" из базы школы?`)) {
            store.deleteStudent(id);
            modal.close();
            toast.success('Ученик удален');
            const page = document.querySelector('.page-container');
            if (page) {
              this.render(page);
            }
          }
        });
      }
    });
  },

  openImportModal(container) {
    modal.open({
      title: '📥 Загрузка списка учеников из Word (.docx)',
      bodyHtml: `
        <div style="display:flex; flex-direction:column; gap:var(--space-4);">
          <!-- Download Template Banner -->
          <div style="background:var(--color-bg-app); border:1px solid var(--color-border); border-radius:var(--radius-lg); padding:var(--space-3) var(--space-4); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:var(--space-3);">
            <div>
              <div style="font-weight:700; font-size:var(--font-size-sm); color:var(--color-text-main);">
                📄 Готовый трафарет таблицы Word (.docx)
              </div>
              <div class="text-xs text-muted" style="margin-top:2px;">
                Колонки в документе: <strong>№ | ФИО ученика | Номер телефона | Школа | Класс | Смена | Родители | номер телефона родителей</strong>
              </div>
            </div>
            <a href="./assets/students_template.docx" download="students_template.docx" class="btn btn-sm btn-outline-primary" style="font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              Скачать образец трафарета
            </a>
          </div>

          <!-- File Upload Zone -->
          <div style="border:2px dashed var(--color-border); border-radius:var(--radius-lg); padding:var(--space-5); text-align:center; background:#fafafa; transition:all 0.2s;" id="docx-drop-zone">
            <input type="file" id="input-docx-upload" accept=".docx" style="display:none;" />
            <div style="font-size:2.2rem; margin-bottom:var(--space-2);">📑</div>
            <div style="font-weight:700; font-size:var(--font-size-base); color:var(--color-text-main); margin-bottom:4px;">
              Выберите или перетащите файл со списком детей (.docx)
            </div>
            <div class="text-xs text-muted" style="margin-bottom:var(--space-3);">
              CRM автоматически считает ФИО, телефон, школу, класс, смену, родителей и их контакты
            </div>
            <button type="button" class="btn btn-primary btn-sm" id="btn-browse-docx" style="font-weight:600;">
              📂 Выбрать файл Word
            </button>
            <div id="docx-file-name" class="text-xs" style="margin-top:10px; font-weight:700; color:var(--color-primary); display:none;"></div>
          </div>

          <!-- Loading state -->
          <div id="import-loading-state" style="display:none; text-align:center; padding:var(--space-5);">
            <div class="spinner" style="width:32px; height:32px; border-width:3px; margin:0 auto 10px auto;"></div>
            <div style="font-weight:600; font-size:var(--font-size-sm); color:var(--color-text-main);">Считываем документ Word...</div>
            <div class="text-xs text-muted" style="margin-top:4px;">Обработка таблицы и нормализация контактов</div>
          </div>

          <!-- Parsed Preview Section -->
          <div id="import-preview-section" style="display:none;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-2); flex-wrap:wrap; gap:8px;">
              <div>
                <span style="font-weight:700; font-size:var(--font-size-sm);">Распознано учеников:</span>
                <span class="badge badge-success" id="badge-parsed-count" style="margin-left:4px; font-weight:700; font-size:0.8rem;">0</span>
              </div>
              <div style="display:flex; align-items:center; gap:12px;">
                <label style="font-size:var(--font-size-xs); display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:600;">
                  <input type="checkbox" id="cb-select-all-preview" checked style="cursor:pointer; width:16px; height:16px;" />
                  <span>Выбрать всех</span>
                </label>
              </div>
            </div>

            <div class="table-responsive" style="max-height:340px; overflow-y:auto; border:1px solid var(--color-border); border-radius:var(--radius-md); box-shadow:inset 0 1px 3px rgba(0,0,0,0.05);">
              <table class="table" style="font-size:var(--font-size-xs); margin-bottom:0; min-width:860px;">
                <thead>
                  <tr style="position:sticky; top:0; background:#f1f5f9; z-index:2;">
                    <th style="width:36px; text-align:center;">✓</th>
                    <th style="min-width:170px;">ФИО ученика</th>
                    <th style="min-width:130px;">Телефон</th>
                    <th style="min-width:120px;">Школа</th>
                    <th style="min-width:75px;">Класс</th>
                    <th style="min-width:95px;">Смена</th>
                    <th style="min-width:150px;">Родители</th>
                    <th style="min-width:130px;">Телефон родителей</th>
                    <th style="width:36px; text-align:center;"></th>
                  </tr>
                </thead>
                <tbody id="preview-students-tbody">
                </tbody>
              </table>
            </div>

            <div style="margin-top:8px; padding:var(--space-2) var(--space-3); background:#eff6ff; border-radius:var(--radius-md); font-size:var(--font-size-xs); color:#1e40af; display:flex; align-items:center; gap:8px;">
              <span>ℹ️</span>
              <span>Все добавленные ученики будут сохранены <strong>без групп</strong>. Преподаватель или администратор сможет распределить их по учебным группам в любое удобное время.</span>
            </div>
          </div>
        </div>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Отмена</button>
        <button type="button" class="btn btn-primary" id="btn-confirm-import-students" style="display:none; font-weight:700;">
          ✅ Добавить выбранных учеников в базу
        </button>
      `,
      onOpen: () => {
        const dialog = document.getElementById('main-modal');
        if (dialog) {
          dialog.style.maxWidth = '980px';
          dialog.addEventListener('close', () => { dialog.style.maxWidth = ''; }, { once: true });
        }

        const fileInput = document.getElementById('input-docx-upload');
        const browseBtn = document.getElementById('btn-browse-docx');
        const dropZone = document.getElementById('docx-drop-zone');
        const fileNameLabel = document.getElementById('docx-file-name');
        const loadingState = document.getElementById('import-loading-state');
        const previewSection = document.getElementById('import-preview-section');
        const confirmBtn = document.getElementById('btn-confirm-import-students');
        const tbody = document.getElementById('preview-students-tbody');
        const countBadge = document.getElementById('badge-parsed-count');
        const selectAllCb = document.getElementById('cb-select-all-preview');

        browseBtn?.addEventListener('click', () => fileInput?.click());

        // Drag & drop handlers
        ['dragenter', 'dragover'].forEach(evName => {
          dropZone?.addEventListener(evName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.borderColor = 'var(--color-primary)';
            dropZone.style.background = '#eef2ff';
          });
        });

        ['dragleave', 'drop'].forEach(evName => {
          dropZone?.addEventListener(evName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.borderColor = 'var(--color-border)';
            dropZone.style.background = '#fafafa';
          });
        });

        dropZone?.addEventListener('drop', (e) => {
          const files = e.dataTransfer?.files;
          if (files && files.length > 0) {
            handleFileSelect(files[0]);
          }
        });

        fileInput?.addEventListener('change', (e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
          }
        });

        async function handleFileSelect(file) {
          if (!file.name.toLowerCase().endsWith('.docx')) {
            toast.error('Пожалуйста, выберите документ формата .docx');
            return;
          }

          if (fileNameLabel) {
            fileNameLabel.textContent = `Выбран файл: ${file.name} (${(file.size / 1024).toFixed(1)} КБ)`;
            fileNameLabel.style.display = 'block';
          }

          loadingState.style.display = 'block';
          previewSection.style.display = 'none';
          confirmBtn.style.display = 'none';

          // 1. Primary: Browser-native Docx Parser (100% client-side, instant, works offline & on Vercel)
          try {
            const clientRes = await parseStudentsDocx(file);
            if (clientRes && clientRes.success && clientRes.students && clientRes.students.length > 0) {
              loadingState.style.display = 'none';
              renderPreviewRows(clientRes.students);
              previewSection.style.display = 'block';
              confirmBtn.style.display = 'inline-flex';
              toast.success(`Успешно распознано учеников (в браузере): ${clientRes.students.length}`);
              return;
            }
          } catch (clientErr) {
            console.warn('Client-side docx parse error, trying server fallback:', clientErr);
          }

          // 2. Server-side fallback (if running with local Python server)
          try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/parse-students-doc', {
              method: 'POST',
              body: formData
            });

            const data = await response.json();
            loadingState.style.display = 'none';

            if (!data.success) {
              toast.error(data.error || 'Не удалось распознать документ');
              return;
            }

            if (!data.students || data.students.length === 0) {
              toast.warning('В документе не обнаружено записей учеников. Проверьте структуру таблицы.');
              return;
            }

            renderPreviewRows(data.students);
            previewSection.style.display = 'block';
            confirmBtn.style.display = 'inline-flex';
            toast.success(`Успешно распознано учеников: ${data.students.length}`);
          } catch (err) {
            loadingState.style.display = 'none';
            toast.error('Не удалось распознать документ. Проверьте формат файла.');
          }
        }

        function renderPreviewRows(students) {
          countBadge.textContent = String(students.length);
          tbody.innerHTML = students.map((st, idx) => `
            <tr class="preview-student-row" data-index="${idx}">
              <td style="text-align:center; vertical-align:middle;">
                <input type="checkbox" class="cb-import-row" checked style="cursor:pointer; width:16px; height:16px;" />
              </td>
              <td>
                <input type="text" class="form-control form-control-sm preview-name" value="${st.fullName || ''}" placeholder="ФИО ученика" required style="font-weight:600;" />
              </td>
              <td>
                <input type="tel" class="form-control form-control-sm preview-phone" value="${st.phone || ''}" placeholder="+7 (999) 000-00-00" />
              </td>
              <td>
                <input type="text" class="form-control form-control-sm preview-school" value="${st.school || ''}" placeholder="Школа / Лицей" />
              </td>
              <td>
                <input type="text" class="form-control form-control-sm preview-grade" value="${formatGrade(st.grade) || ''}" placeholder="Класс" style="width:75px;" />
              </td>
              <td>
                <select class="form-control form-control-sm preview-shift" style="width:95px;">
                  <option value="Первая" ${st.shift === 'Первая' ? 'selected' : ''}>1 смена</option>
                  <option value="Вторая" ${st.shift === 'Вторая' ? 'selected' : ''}>2 смена</option>
                </select>
              </td>
              <td>
                <input type="text" class="form-control form-control-sm preview-parent-name" value="${st.parentName || ''}" placeholder="ФИО родителей (мама/папа)" />
              </td>
              <td>
                <input type="tel" class="form-control form-control-sm preview-parent-phone" value="${st.parentPhone || ''}" placeholder="+7 (999) 000-00-00" />
              </td>
              <td style="text-align:center; vertical-align:middle;">
                <button type="button" class="btn btn-ghost btn-xs btn-remove-preview-row" title="Исключить ученика" style="color:var(--color-danger); padding:2px 6px;">
                  ✕
                </button>
              </td>
            </tr>
          `).join('');

          // Select all toggle
          selectAllCb.checked = true;
          selectAllCb.onchange = (e) => {
            const isChecked = e.target.checked;
            tbody.querySelectorAll('.cb-import-row').forEach(cb => { cb.checked = isChecked; });
            updateCount();
          };

          tbody.querySelectorAll('.cb-import-row').forEach(cb => {
            cb.addEventListener('change', updateCount);
          });

          tbody.querySelectorAll('.btn-remove-preview-row').forEach(btn => {
            btn.addEventListener('click', (e) => {
              const row = e.currentTarget.closest('tr');
              row?.remove();
              updateCount();
            });
          });

          function updateCount() {
            const checkedCount = tbody.querySelectorAll('.cb-import-row:checked').length;
            countBadge.textContent = String(checkedCount);
            confirmBtn.textContent = `✅ Добавить выбранных учеников (${checkedCount}) в базу`;
            confirmBtn.disabled = checkedCount === 0;
          }

          updateCount();
        }

        confirmBtn?.addEventListener('click', () => {
          const rows = tbody.querySelectorAll('.preview-student-row');
          const studentsToAdd = [];

          rows.forEach(r => {
            const cb = r.querySelector('.cb-import-row');
            if (cb && cb.checked) {
              const fullName = r.querySelector('.preview-name')?.value?.trim();
              const phone = r.querySelector('.preview-phone')?.value?.trim();
              const school = r.querySelector('.preview-school')?.value?.trim();
              const grade = r.querySelector('.preview-grade')?.value?.trim();
              const shift = r.querySelector('.preview-shift')?.value || 'Первая';
              const parentName = r.querySelector('.preview-parent-name')?.value?.trim() || '';
              const parentPhone = r.querySelector('.preview-parent-phone')?.value?.trim() || '';

              if (fullName) {
                studentsToAdd.push({
                  fullName,
                  phone,
                  school,
                  grade,
                  shift,
                  parentName,
                  parentPhone,
                  groupId: null,
                  level: 'Beginner',
                  textbook: '',
                  totalPoints: 0
                });
              }
            }
          });

          if (studentsToAdd.length === 0) {
            toast.warning('Выберите хотя бы одного ученика для добавления');
            return;
          }

          const added = store.addStudentsBatch(studentsToAdd);
          modal.close();
          toast.success(`Успешно добавлено ${added.length} учеников! Теперь вы можете распределить их по группам.`);

          // Show newly added students by filtering to 'none'
          StudentsView.filterGroup = 'none';
          const page = document.querySelector('.page-container') || container;
          if (page && typeof StudentsView.render === 'function') {
            StudentsView.render(page);
          }
        });
      }
    });
  }
};
