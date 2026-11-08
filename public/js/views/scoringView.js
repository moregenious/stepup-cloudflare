/**
 * Scoring & Points Management View - Awarding and Deducting points, tracking tests, and comments
 */

import { store, formatGrade } from '../store.js';
import { auth } from '../auth.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';

export const SCORING_TEMPLATES = {
  add: [
    { label: 'Хорошая работа на уроке', points: 15, category: 'Активность', icon: '⭐' },
    { label: 'Хороший ответ', points: 10, category: 'Активность', icon: '👍' },
    { label: 'Уверенный ответ', points: 15, category: 'Активность', icon: '💪' },
    { label: 'Спикинг', points: 20, category: 'Спикинг / Speaking', icon: '🗣️' },
    { label: 'Домашнее задание', points: 20, category: 'Домашнее задание', icon: '📝' },
    { label: 'Домашнее задание с ошибками', points: 10, category: 'Домашнее задание', icon: '✏️' },
    { label: 'Помощь другим', points: 15, category: 'Работа в команде', icon: '🤝' },
    { label: 'Работа в команде', points: 15, category: 'Работа в команде', icon: '👥' },
    { label: 'Знание слов', points: 15, category: 'Словарный запас', icon: '🔤' },
    { label: 'Чтение', points: 15, category: 'Чтение / Reading', icon: '📖' },
    { label: 'Тестирование сайта (без рейтинга)', points: 1000, category: 'Бонус тестирования', icon: '🎁', excludeFromRating: true }
  ],
  deduct: [
    { label: 'Отвлекался', points: 10, category: 'Нарушение правил', icon: '👀' },
    { label: 'Не выполнил дом задание', points: 20, category: 'Несданное ДЗ', icon: '❌' },
    { label: 'Домашнее задание не выполнено (использовано ИИ)', points: 25, category: 'Несданное ДЗ / Использование ИИ', icon: '🤖' },
    { label: 'Использование телефона', points: 15, category: 'Использование телефона', icon: '📱' },
    { label: 'Жвачка на уроке', points: 10, category: 'Нарушение правил', icon: '🍬' },
    { label: 'Выкрикивание', points: 10, category: 'Нарушение правил', icon: '📢' },
    { label: 'Помеха на уроке', points: 15, category: 'Помеха на уроке', icon: '🚫' }
  ]
};

const PAGE_SIZE = 100;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Teachers type categories by hand: 'опоздание' and 'Опоздание' are one category
const categoryKey = (r) => String(r.category || '').trim().toLowerCase();
const normalize = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

export const ScoringView = {
  searchQuery: '',
  filterGroup: 'all',
  filterCategory: 'all', // categoryKey of a record
  filterType: 'all', // 'all' | 'add' | 'deduct'
  visibleCount: PAGE_SIZE,

  /** Records matching everything except the category (the category list is built from them) */
  getBaseRecords() {
    const words = normalize(this.searchQuery).split(/\s+/).filter(Boolean);
    return store.getPointRecords().filter(r => {
      const points = r.points || 0;
      if (this.filterType === 'add' && points <= 0) return false;
      if (this.filterType === 'deduct' && points >= 0) return false;
      const student = store.getStudentById(r.studentId);
      if (this.filterGroup !== 'all' && student?.groupId !== this.filterGroup) return false;
      if (!words.length) return true;
      const teacher = store.getTeacherById(r.teacherId);
      const text = normalize(`${student?.fullName || ''} ${r.category || ''} ${r.comment || ''} ${teacher?.fullName || 'Администратор'}`);
      return words.every(w => text.includes(w));
    });
  },

  /** Every category that really occurs, with counts: rewards and deductions, the most used first */
  renderCategoryOptions(baseRecords) {
    const found = new Map();
    baseRecords.forEach(r => {
      const key = categoryKey(r);
      const cat = found.get(key) || { key, count: 0, sum: 0, spellings: new Map() };
      cat.count++;
      cat.sum += Number(r.points) || 0;
      const label = String(r.category || '').trim() || 'Без категории';
      cat.spellings.set(label, (cat.spellings.get(label) || 0) + 1);
      found.set(key, cat);
    });
    const label = (c) => [...c.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const list = [...found.values()].sort((a, b) => b.count - a.count);
    const option = (c) => `<option value="${esc(c.key)}" ${this.filterCategory === c.key ? 'selected' : ''}>${esc(label(c))} (${c.count})</option>`;
    const rewards = list.filter(c => c.sum >= 0);
    const deductions = list.filter(c => c.sum < 0);
    // A chosen category with no matches now stays in the list, otherwise the select would silently jump to "all"
    const keepChosen = this.filterCategory !== 'all' && !found.has(this.filterCategory)
      ? `<option value="${esc(this.filterCategory)}" selected>${esc(this.filterCategory || 'Без категории')} (0)</option>` : '';
    return `
      <option value="all" ${this.filterCategory === 'all' ? 'selected' : ''}>Все категории (${baseRecords.length})</option>
      ${keepChosen}
      ${rewards.length ? `<optgroup label="Поощрения (+)">${rewards.map(option).join('')}</optgroup>` : ''}
      ${deductions.length ? `<optgroup label="Вычеты (−)">${deductions.map(option).join('')}</optgroup>` : ''}
    `;
  },

  renderRows(records, isAdmin) {
    if (!records.length) {
      return `
        <tr>
          <td colspan="${isAdmin ? 7 : 6}" style="text-align:center; padding:var(--space-8);">
            Записей о начислении или вычете баллов не найдено
          </td>
        </tr>
      `;
    }
    return records.map(r => {
      const student = store.getStudentById(r.studentId);
      const teacher = store.getTeacherById(r.teacherId);
      const isPositive = (r.points || 0) >= 0;

      return `
        <tr>
          <td>
            <div class="text-xs text-muted">${new Date(r.date).toLocaleDateString('ru-RU')}</div>
          </td>
          <td>
            <div class="font-semibold">${student ? student.fullName : '—'}</div>
            <div class="text-xs text-muted">${student ? formatGrade(student.grade) + ' • Баланс: ' + student.totalPoints + ' ⭐' : ''}</div>
          </td>
          <td>
            <span class="badge ${isPositive ? 'badge-planned' : 'badge-cancelled'}">${esc(r.category) || 'Без категории'}</span>
          </td>
          <td>
            ${isPositive ? `
              <span class="badge badge-completed" style="font-size:0.85rem; font-weight:700;">+${r.points} ⭐</span>
            ` : `
              <span class="badge badge-cancelled" style="background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; font-size:0.85rem; font-weight:700;">${r.points} ⭐</span>
            `}
          </td>
          <td>${teacher ? teacher.fullName : 'Администратор'}</td>
          <td>
            <div style="max-width: 340px; font-size:var(--font-size-xs); color:var(--color-text-secondary);">${esc(r.comment) || '—'}</div>
          </td>
          ${isAdmin ? `
            <td style="text-align:right;">
              <button class="btn btn-ghost btn-sm btn-delete-score" data-id="${r.id}" title="Отменить операцию" style="color:var(--color-danger)">🗑️</button>
            </td>
          ` : ''}
        </tr>
      `;
    }).join('');
  },

  /** Redraws the list only, so typing in the search box keeps its focus */
  updateResults(container) {
    const isAdmin = auth.isAdmin();
    const base = this.getBaseRecords();
    const records = this.filterCategory === 'all' ? base : base.filter(r => categoryKey(r) === this.filterCategory);
    const total = records.reduce((sum, r) => sum + (Number(r.points) || 0), 0);

    container.querySelector('#filter-score-category').innerHTML = this.renderCategoryOptions(base);
    container.querySelector('#score-results-summary').textContent =
      `Найдено записей: ${records.length} • Итого: ${total > 0 ? '+' : ''}${total} ⭐`;
    container.querySelector('#score-rows').innerHTML = this.renderRows(records.slice(0, this.visibleCount), isAdmin);
    const more = container.querySelector('#btn-score-more');
    const left = records.length - this.visibleCount;
    more.style.display = left > 0 ? '' : 'none';
    more.textContent = `Показать ещё (осталось ${left})`;
  },

  render(container) {
    if (!auth.isAuthenticated() || auth.isStudent()) {
      window.location.hash = auth.isStudent() ? '#student-cabinet' : '#login';
      return;
    }

    const isAdmin = auth.isAdmin();
    const groups = store.getGroups();

    container.innerHTML = `
      <div class="section-header">
        <div class="section-title-wrap">
          <h1>Система баллов и оценки</h1>
          <p>Мотивация учеников: быстрое начисление баллов по шаблонам или своим вариантам, и учет дисциплины</p>
        </div>
        <div class="section-actions" style="display: flex; gap: var(--space-2);">
          <button class="btn btn-primary" id="btn-award-points">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Начислить баллы
          </button>
          <button class="btn btn-danger" id="btn-deduct-points">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Вычесть баллы
          </button>
        </div>
      </div>

      <!-- Filters -->
      <div class="filter-bar score-filter-bar">
        <div class="filter-item score-search-item">
          <input type="search" id="score-search" class="form-control" placeholder="🔍 Имя, категория, комментарий" title="Поиск по ученику, категории, комментарию и преподавателю" value="${esc(this.searchQuery)}" autocomplete="off">
        </div>

        <div class="filter-item">
          <label class="form-label" style="margin:0; font-size:var(--font-size-xs);">Группа:</label>
          <select id="filter-score-group" class="form-control">
            <option value="all">Все группы</option>
            ${groups.map(g => `<option value="${g.id}" ${this.filterGroup === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
          </select>
        </div>

        <div class="filter-item">
          <label class="form-label" style="margin:0; font-size:var(--font-size-xs);">Категория:</label>
          <select id="filter-score-category" class="form-control"></select>
        </div>

        <div class="filter-item">
          <label class="form-label" style="margin:0; font-size:var(--font-size-xs);">Тип:</label>
          <select id="filter-score-type" class="form-control">
            <option value="all" ${this.filterType === 'all' ? 'selected' : ''}>Все операции</option>
            <option value="add" ${this.filterType === 'add' ? 'selected' : ''}>➕ Только начисления (+)</option>
            <option value="deduct" ${this.filterType === 'deduct' ? 'selected' : ''}>➖ Только вычеты (-)</option>
          </select>
        </div>

        <button type="button" class="btn btn-ghost btn-sm" id="btn-score-reset">✕ Сбросить</button>
      </div>

      <div class="score-results-summary" id="score-results-summary"></div>

      <!-- Scores Table & Timeline -->
      <div class="card" style="padding: 0; overflow:hidden;">
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Ученик</th>
                <th>Категория</th>
                <th>Баллы</th>
                <th>Преподаватель</th>
                <th>Комментарий и причина</th>
                ${isAdmin ? `<th style="text-align:right;">Действие</th>` : ''}
              </tr>
            </thead>
            <tbody id="score-rows"></tbody>
          </table>
        </div>
      </div>
      <button type="button" class="btn btn-secondary" id="btn-score-more" style="display:none; width:100%; margin-top: var(--space-3);"></button>
    `;

    this.updateResults(container);
    this.bindEvents(container);
  },

  bindEvents(container) {
    const refilter = () => {
      this.visibleCount = PAGE_SIZE;
      this.updateResults(container);
    };

    container.querySelector('#score-search')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      refilter();
    });

    container.querySelector('#filter-score-type')?.addEventListener('change', (e) => {
      this.filterType = e.target.value;
      refilter();
    });

    container.querySelector('#filter-score-group')?.addEventListener('change', (e) => {
      this.filterGroup = e.target.value;
      refilter();
    });

    container.querySelector('#filter-score-category')?.addEventListener('change', (e) => {
      this.filterCategory = e.target.value;
      refilter();
    });

    container.querySelector('#btn-score-reset')?.addEventListener('click', () => {
      this.searchQuery = '';
      this.filterGroup = 'all';
      this.filterCategory = 'all';
      this.filterType = 'all';
      this.visibleCount = PAGE_SIZE;
      this.render(container);
    });

    container.querySelector('#btn-score-more')?.addEventListener('click', () => {
      this.visibleCount += PAGE_SIZE;
      this.updateResults(container);
    });

    container.querySelector('#btn-award-points')?.addEventListener('click', () => this.openPointsModal('add', container));
    container.querySelector('#btn-deduct-points')?.addEventListener('click', () => this.openPointsModal('deduct', container));

    // The rows are redrawn while searching, so the click is handled on the table body
    container.querySelector('#score-rows')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-delete-score');
      if (!btn) return;
      if (!auth.isAuthenticated() || auth.isStudent()) {
        toast.error('Операция запрещена');
        return;
      }
      const id = btn.getAttribute('data-id');
      if (confirm('Отменить эту операцию с баллами? Баланс ученика будет пересчитан.')) {
        store.deletePointRecord(id);
        toast.info('Операция отменена, баланс пересчитан');
        this.render(container);
      }
    });
  },

  openPointsModal(initialType = 'add', container) {
    if (!auth.isAuthenticated() || auth.isStudent()) {
      toast.error('Операции с баллами доступны только преподавателям и администраторам');
      return;
    }
    const students = store.getStudents();
    const groups = store.getGroups();
    const teachers = store.getTeachers();
    const isTeacher = auth.isTeacher();
    const currentUser = auth.getCurrentUser();

    const renderTemplatesHtml = (type) => {
      const list = SCORING_TEMPLATES[type] || [];
      const isDeduct = type === 'deduct';
      return `
        <div class="scoring-templates-wrapper">
          <div class="scoring-templates-header">
            <span>✨ Быстрые шаблоны причин (нажмите для автозаполнения):</span>
            <button type="button" class="btn-clear-template" id="btn-reset-template" title="Очистить комментарий и написать свой вариант">
              ✍️ Свой вариант / Очистить
            </button>
          </div>
          <div class="scoring-templates-grid" id="templates-grid">
            ${list.map((tpl, idx) => `
              <button type="button" 
                class="template-chip-btn ${isDeduct ? 'deduct' : 'add'}" 
                data-index="${idx}"
                data-label="${tpl.label}"
                data-points="${tpl.points}"
                data-category="${tpl.category}"
                data-exclude="${tpl.excludeFromRating ? '1' : '0'}">
                <span class="template-chip-icon">${tpl.icon}</span>
                <span class="template-chip-label">${tpl.label}</span>
                <span class="template-chip-points">${isDeduct ? `-${tpl.points}` : `+${tpl.points}`} ⭐</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    };

    const renderStudentCheckboxes = (selectedGroupId = 'all') => {
      let filteredStudents = students;
      if (selectedGroupId !== 'all') {
        filteredStudents = students.filter(s => s.groupId === selectedGroupId);
      }

      if (filteredStudents.length === 0) {
        return `
          <div class="text-xs text-muted" style="padding:var(--space-3); text-align:center;">
            В этой группе пока нет закрепленных учеников
          </div>
        `;
      }

      return filteredStudents.map((s, idx) => {
        const grp = store.getGroupById(s.groupId);
        // By default check all students in filtered group (or first student if all)
        const isChecked = selectedGroupId !== 'all' || idx === 0;
        return `
          <label class="student-checkbox-item ${isChecked ? 'checked' : ''}" data-student-id="${s.id}">
            <div class="student-check-left">
              <input type="checkbox" name="studentIds" value="${s.id}" ${isChecked ? 'checked' : ''}>
              <div>
                <span class="font-semibold" style="font-size:var(--font-size-xs); color:var(--color-text-main);">${s.fullName}</span>
                <span class="text-muted text-xs" style="font-size:0.7rem; margin-left:4px;">(${formatGrade(s.grade) || 'Ученик'}${grp ? ` • 👥 ${grp.name}` : ' • Индивидуально'})</span>
              </div>
            </div>
            <span class="student-points-badge" style="font-size:0.7rem; padding:1px 6px;">⭐ ${s.totalPoints || 0}</span>
          </label>
        `;
      }).join('');
    };

    modal.open({
      title: initialType === 'add' ? '⭐ Начислить баллы ученикам' : '⚠️ Вычесть / Списать баллы учеников',
      bodyHtml: `
        <form id="form-points-action">
          <!-- Type Segmented Switcher -->
          <div class="form-group">
            <label class="form-label">Тип операции <span class="required">*</span></label>
            <div style="display: flex; gap: var(--space-4); background: var(--color-bg-app); padding: var(--space-2); border-radius: var(--radius-md); border: 1px solid var(--color-border);">
              <label style="display: flex; align-items: center; gap: var(--space-2); cursor: pointer; flex: 1;">
                <input type="radio" name="type" value="add" ${initialType === 'add' ? 'checked' : ''} id="radio-action-add">
                <span class="font-semibold" style="color: var(--color-success-text);">➕ Начисление (Поощрение)</span>
              </label>
              <label style="display: flex; align-items: center; gap: var(--space-2); cursor: pointer; flex: 1;">
                <input type="radio" name="type" value="deduct" ${initialType === 'deduct' ? 'checked' : ''} id="radio-action-deduct">
                <span class="font-semibold" style="color: var(--color-danger-text);">➖ Вычет (Штраф / Списание)</span>
              </label>
            </div>
          </div>

          <!-- Group Filter & Multi-Student Selector -->
          <div class="form-row">
            <div class="form-group" style="flex:1;">
              <label class="form-label">Фильтр по учебной группе</label>
              <select id="select-modal-group" class="form-control">
                <option value="all">👥 Все группы и индивидуальные ученики</option>
                ${groups.map(g => `<option value="${g.id}">👥 ${g.name} (${g.level})</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <label class="form-label" style="margin-bottom:0;">Выберите учеников <span class="required">*</span></label>
              <span class="multiselect-count-badge" id="selected-students-count">Выбрано: 1</span>
            </div>
            <div class="student-multiselect-box">
              <div class="multiselect-toolbar">
                <div class="multiselect-quick-btns">
                  <button type="button" class="btn-quick-select" id="btn-select-all-students">✓ Выбрать всех</button>
                  <button type="button" class="btn-quick-select" id="btn-deselect-all-students">✗ Снять выбор</button>
                </div>
                <span class="text-xs text-muted" style="font-size:0.75rem;">Можно выбрать одного, нескольких или всю группу</span>
              </div>
              <div class="student-checkbox-list" id="student-checkbox-mount">
                ${renderStudentCheckboxes('all')}
              </div>
            </div>
          </div>

          <!-- Dynamic Quick Templates Selector -->
          <div id="scoring-templates-mount">
            ${renderTemplatesHtml(initialType)}
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Категория <span class="required">*</span></label>
              <select name="category" id="select-point-category" class="form-control" required>
                <!-- Populated dynamically based on add / deduct -->
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" id="label-points-amount">Количество баллов <span class="required">*</span></label>
              <input type="number" name="points" id="input-points-val" class="form-control" value="15" min="1" max="2000" required>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Преподаватель</label>
            <select name="teacherId" class="form-control">
              ${teachers.map(t => `<option value="${t.id}" ${isTeacher && currentUser?.id === t.id ? 'selected' : ''}>${t.fullName}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <label class="form-label" style="margin-bottom:0;">Комментарий / Детали <span class="text-muted font-normal">(необязательно)</span></label>
              <span class="text-xs text-muted" style="font-size:0.75rem;">Если оставить пустым, ученики увидят выбранную причину</span>
            </div>
            <textarea name="comment" id="textarea-comment" class="form-control" rows="2" placeholder="Необязательно. Можно дополнить причину деталями или оставить поле пустым..."></textarea>
          </div>

          <!-- Non-rating bonus checkbox -->
          <div class="form-group" style="background: #fefce8; border: 1.5px solid #fde047; padding: 10px 14px; border-radius: var(--radius-md); margin-top: var(--space-3);">
            <label style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer; margin: 0; font-size: var(--font-size-sm); color: #854d0e; font-weight: 700;">
              <input type="checkbox" name="excludeFromRating" id="check-exclude-rating" style="margin-top: 2px; width: 16px; height: 16px;">
              <span>
                🎁 Без учёта в рейтинге месяца (только на баланс магазина)
                <span style="display: block; font-size: 0.75rem; color: #a16207; font-weight: normal; margin-top: 2px;">
                  Баллы поступят на баланс учеников для покупок в магазине бонусов, но НЕ будут учитываться в рейтинге месяца и лидерборде групп (для бонусов тестировщикам).
                </span>
              </span>
            </label>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Отмена</button>
        <button type="button" class="btn btn-primary" id="btn-submit-points">Подтвердить</button>
      `,
      onOpen: () => {
        const groupSelect = document.getElementById('select-modal-group');
        const checkboxMount = document.getElementById('student-checkbox-mount');
        const countBadge = document.getElementById('selected-students-count');
        const categorySelect = document.getElementById('select-point-category');
        const submitBtn = document.getElementById('btn-submit-points');
        const textareaComment = document.getElementById('textarea-comment');
        const pointsInput = document.getElementById('input-points-val');
        const labelPointsAmount = document.getElementById('label-points-amount');
        const radioAdd = document.getElementById('radio-action-add');
        const radioDeduct = document.getElementById('radio-action-deduct');

        const updateCountBadge = () => {
          const checked = checkboxMount?.querySelectorAll('input[name="studentIds"]:checked') || [];
          if (countBadge) {
            const count = checked.length;
            const word = count === 1 ? 'ученик' : (count >= 2 && count <= 4) ? 'ученика' : 'учеников';
            countBadge.textContent = `Выбрано: ${count} ${word}`;
            countBadge.style.background = count > 0 ? 'var(--color-primary-subtle)' : '#fee2e2';
            countBadge.style.color = count > 0 ? 'var(--color-primary)' : '#991b1b';
          }
        };

        const bindCheckboxEvents = () => {
          const items = checkboxMount.querySelectorAll('.student-checkbox-item');
          items.forEach(item => {
            const cb = item.querySelector('input[type="checkbox"]');
            cb?.addEventListener('change', () => {
              if (cb.checked) {
                item.classList.add('checked');
              } else {
                item.classList.remove('checked');
              }
              updateCountBadge();
            });
          });
          updateCountBadge();
        };

        bindCheckboxEvents();

        groupSelect?.addEventListener('change', (e) => {
          const grpId = e.target.value;
          checkboxMount.innerHTML = renderStudentCheckboxes(grpId);
          bindCheckboxEvents();
        });

        document.getElementById('btn-select-all-students')?.addEventListener('click', () => {
          const cbs = checkboxMount.querySelectorAll('input[name="studentIds"]');
          cbs.forEach(cb => {
            cb.checked = true;
            cb.closest('.student-checkbox-item')?.classList.add('checked');
          });
          updateCountBadge();
        });

        document.getElementById('btn-deselect-all-students')?.addEventListener('click', () => {
          const cbs = checkboxMount.querySelectorAll('input[name="studentIds"]');
          cbs.forEach(cb => {
            cb.checked = false;
            cb.closest('.student-checkbox-item')?.classList.remove('checked');
          });
          updateCountBadge();
        });

        const bindTemplateClicks = () => {
          const chips = document.querySelectorAll('.template-chip-btn');
          chips.forEach(chip => {
            chip.addEventListener('click', (e) => {
              const btn = e.currentTarget;
              const label = btn.getAttribute('data-label');
              const points = btn.getAttribute('data-points');
              const category = btn.getAttribute('data-category');

              // Set comment text
              if (textareaComment) {
                textareaComment.value = label;
                textareaComment.focus();
              }

              // Set suggested points
              if (pointsInput && points) {
                pointsInput.value = points;
              }

              // Check or uncheck excludeFromRating based on template
              const isExclude = btn.getAttribute('data-exclude') === '1';
              const checkExclude = document.getElementById('check-exclude-rating');
              if (checkExclude) {
                checkExclude.checked = isExclude;
              }

              // Set category if match exists
              if (categorySelect && category) {
                let matched = false;
                for (let i = 0; i < categorySelect.options.length; i++) {
                  if (categorySelect.options[i].value === category || categorySelect.options[i].value.includes(category)) {
                    categorySelect.selectedIndex = i;
                    matched = true;
                    break;
                  }
                }
                if (!matched) {
                  const opt = document.createElement('option');
                  opt.value = category;
                  opt.textContent = `${category} (${radioDeduct.checked ? '-' : '+'})`;
                  categorySelect.appendChild(opt);
                  categorySelect.value = category;
                }
              }

              // Toggle active styling
              chips.forEach(c => c.classList.remove('active'));
              btn.classList.add('active');
            });
          });

          document.getElementById('btn-reset-template')?.addEventListener('click', () => {
            if (textareaComment) {
              textareaComment.value = '';
              textareaComment.focus();
            }
            chips.forEach(c => c.classList.remove('active'));
            if (pointsInput) {
              pointsInput.value = radioDeduct.checked ? '10' : '15';
            }
          });
        };

        const updateCategoryOptions = (isDeduct) => {
          const currentType = isDeduct ? 'deduct' : 'add';
          if (isDeduct) {
            categorySelect.innerHTML = `
              <option value="Несданное ДЗ" selected>Несданное ДЗ (-)</option>
              <option value="Несданное ДЗ / Использование ИИ">Несданное ДЗ (Использование ИИ) (-)</option>
              <option value="Нарушение правил">Нарушение правил / Дисциплина (-)</option>
              <option value="Использование телефона">Использование телефона на уроке (-)</option>
              <option value="Помеха на уроке">Помеха проведению урока (-)</option>
              <option value="Опоздание">Опоздание на урок (-)</option>
              <option value="Пропуск занятия">Пропуск занятия без уважительной причины (-)</option>
              <option value="Списание / Приз">Списание баллов (Обмен на подарок/приз) (-)</option>
              <option value="Корректировка">Корректировка баланса (-)</option>
              <option value="Другое">Свой вариант / Другое (-)</option>
            `;
            submitBtn.className = 'btn btn-danger';
            submitBtn.textContent = 'Вычесть баллы';
            if (textareaComment && !textareaComment.value) {
              textareaComment.placeholder = 'Необязательно. Например, Отвлекался на уроке...';
            }
            if (labelPointsAmount) {
              labelPointsAmount.innerHTML = 'Количество баллов для вычета <span class="required">*</span>';
            }
          } else {
            categorySelect.innerHTML = `
              <option value="Активность" selected>Активность на уроке (+)</option>
              <option value="Домашнее задание">Домашнее задание (+)</option>
              <option value="Спикинг / Speaking">Спикинг / Speaking (+)</option>
              <option value="Словарный запас">Словарный запас / Vocabulary (+)</option>
              <option value="Работа в команде">Работа в команде / Помощь (+)</option>
              <option value="Тест">Тест / Проверочная работа (+)</option>
              <option value="Разговорный клуб">Разговорный клуб (+)</option>
              <option value="Экзамен">Экзамен / Mock Exam (+)</option>
              <option value="Другое">Свой вариант / Другое (+)</option>
            `;
            submitBtn.className = 'btn btn-primary';
            submitBtn.textContent = 'Начислить баллы';
            if (textareaComment && !textareaComment.value) {
              textareaComment.placeholder = 'Необязательно. Например, Активная работа над диалогом...';
            }
            if (labelPointsAmount) {
              labelPointsAmount.innerHTML = 'Количество баллов для начисления <span class="required">*</span>';
            }
          }

          // Re-render template chips
          const templatesContainer = document.getElementById('scoring-templates-mount');
          if (templatesContainer) {
            templatesContainer.innerHTML = renderTemplatesHtml(currentType);
            bindTemplateClicks();
          }
        };

        updateCategoryOptions(initialType === 'deduct');

        radioAdd?.addEventListener('change', () => updateCategoryOptions(false));
        radioDeduct?.addEventListener('change', () => updateCategoryOptions(true));

        const submitFormAction = () => {
          const form = document.getElementById('form-points-action');
          if (!form) return;
          const formData = new FormData(form);
          const data = Object.fromEntries(formData.entries());
          const isDeduct = data.type === 'deduct';

          const checkedCbs = Array.from(checkboxMount.querySelectorAll('input[name="studentIds"]:checked'));
          const selectedStudentIds = checkedCbs.map(cb => cb.value);

          if (selectedStudentIds.length === 0) {
            toast.error('Пожалуйста, отметьте галочками хотя бы одного ученика');
            return;
          }

          const parsedPoints = Math.abs(Number(data.points || 15));
          if (!parsedPoints || parsedPoints <= 0) {
            toast.error('Пожалуйста, укажите корректное количество баллов');
            return;
          }

          // If comment is empty, automatically use category/type as reason so the students always see why points were awarded or deducted
          const finalReason = data.comment?.trim() || data.category || (isDeduct ? 'Вычет баллов' : 'Поощрение за урок');
          const excludeFromRating = Boolean(formData.get('excludeFromRating'));

          const awardsList = selectedStudentIds.map(stId => ({
            studentId: stId,
            teacherId: data.teacherId,
            points: parsedPoints,
            type: data.type,
            category: data.category,
            comment: finalReason,
            excludeFromRating
          }));

          const studentNames = selectedStudentIds.map(stId => store.getStudentById(stId)?.fullName).filter(Boolean);
          const res = store.awardPointsBatch(awardsList, { excludeFromRating });
          if (res.skippedAbsent && res.skippedAbsent.length) toast.info(`Отсутствующим на уроке баллы не начислены: ${res.skippedAbsent.join(', ')}`);

          modal.close();

          if (isDeduct) {
            if (selectedStudentIds.length === 1) {
              toast.warning(`Списано -${parsedPoints} баллов у ${studentNames[0]} («${finalReason}»)`);
            } else {
              toast.warning(`Списано -${parsedPoints} баллов у ${selectedStudentIds.length} учеников («${finalReason}»)`);
            }
          } else {
            if (selectedStudentIds.length === 1) {
              toast.success(`Начислено +${parsedPoints} баллов для ${studentNames[0]}! («${finalReason}»)`);
            } else {
              toast.success(`Начислено +${parsedPoints} баллов для ${selectedStudentIds.length} учеников! («${finalReason}»)`);
            }
          }
          this.render(container);
        };

        document.getElementById('form-points-action')?.addEventListener('submit', (e) => {
          e.preventDefault();
          submitFormAction();
        });

        submitBtn?.addEventListener('click', (e) => {
          e.preventDefault();
          submitFormAction();
        });
      }
    });
  }
};
