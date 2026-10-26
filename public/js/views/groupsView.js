/**
 * Groups Management View - Study Groups, Rosters, Group Scheduling, and Group Details
 */

import { store, formatPhoneForDisplay, formatGrade } from '../store.js';
import { auth } from '../auth.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { generateQRCodeSvg } from '../utils/qrcode.js';
import { openClassroomModal } from '../components/classroomModal.js';

export const GroupsView = {
  filterLevel: 'all',
  filterShift: 'all',
  filterTeacher: 'all',
  searchQuery: '',

  render(container) {
    const activeEl = document.activeElement;
    const activeId = (activeEl && container.contains(activeEl)) ? activeEl.id : null;
    const activeStart = activeEl?.selectionStart;
    const activeEnd = activeEl?.selectionEnd;

    const isAdmin = auth.isAdmin();
    const isTeacher = auth.isTeacher();
    const currentTeacherId = isTeacher ? auth.getCurrentUser()?.id : null;

    const teachers = store.getTeachers();
    const groups = store.getGroups({
      level: this.filterLevel,
      shift: this.filterShift,
      teacherId: isTeacher ? currentTeacherId : (this.filterTeacher !== 'all' ? this.filterTeacher : null),
      search: this.searchQuery
    });

    container.innerHTML = `
      <div class="section-header">
        <div class="section-title-wrap">
          <h1>Учебные группы</h1>
          <p>Формирование групп, расписание, учебники, закрепленные учителя и прогресс уроков</p>
        </div>
        <div class="section-actions">
          ${(isAdmin || isTeacher) ? `
            <button class="btn btn-primary" id="btn-add-group">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="12" y2="12"></line></svg>
              Создать группу
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Filters Toolbar -->
      <div class="filter-bar">
        <div class="filter-item">
          <label class="form-label">Уровень:</label>
          <select id="filter-group-level" class="form-control">
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
          <select id="filter-group-shift" class="form-control">
            <option value="all" ${this.filterShift === 'all' ? 'selected' : ''}>Все смены</option>
            <option value="Первая" ${this.filterShift === 'Первая' ? 'selected' : ''}>1 смена</option>
            <option value="Вторая" ${this.filterShift === 'Вторая' ? 'selected' : ''}>2 смена</option>
          </select>
        </div>

        ${!isTeacher ? `
          <div class="filter-item">
            <label class="form-label">Преподаватель:</label>
            <select id="filter-group-teacher" class="form-control">
              <option value="all" ${this.filterTeacher === 'all' ? 'selected' : ''}>Все преподаватели</option>
              ${teachers.map(t => `<option value="${t.id}" ${this.filterTeacher === t.id ? 'selected' : ''}>${t.fullName}</option>`).join('')}
            </select>
          </div>
        ` : ''}

        <div class="filter-item" style="flex-grow: 1;">
          <label class="form-label">Поиск группы:</label>
          <input type="text" id="input-group-search" class="form-control" placeholder="Поиск по названию, кабинету или описанию..." value="${this.searchQuery}">
        </div>
      </div>

      <!-- Groups Grid Container -->
      <div id="groups-grid-container">
        ${groups.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">👥</div>
            <div class="empty-state-title">Группы не найдены</div>
            <div class="empty-state-desc">Попробуйте изменить параметры поиска или создайте новую учебную группу.</div>
            ${(isAdmin || isTeacher) ? `<button class="btn btn-primary btn-sm" id="btn-empty-add-group">Создать группу</button>` : ''}
          </div>
        ` : `
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 350px), 1fr)); gap: var(--space-5);">
            ${groups.map(g => this.renderGroupCard(g, isAdmin || isTeacher)).join('')}
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

  renderGroupCard(group, isAdmin) {
    const teacher = store.getTeacherById(group.teacherId);
    const students = store.getStudentsByGroupId(group.id);
    const lessons = store.getSchedule({ groupId: group.id });
    const levelClass = 'level-' + group.level.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const shiftClass = group.shift === 'Первая' ? 'badge-shift-1' : 'badge-shift-2';

    return `
      <div class="card" style="display: flex; flex-direction: column; justify-content: space-between;" data-group-id="${group.id}">
        <div>
          <!-- Header -->
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3);">
            <div>
              <h3 class="btn-open-classroom" data-id="${group.id}" style="font-size: var(--font-size-md); font-weight: 700; color: var(--color-primary); cursor: pointer; display: flex; align-items: center; gap: 4px;" title="Открыть кабинет класса: турнирная таблица и игры">
                <span>${group.name}</span>
                <span style="font-size: 0.8rem; opacity: 0.7;">➔</span>
              </h3>
              <div class="text-xs text-muted" style="margin-top: 2px;">${group.description || 'Учебная группа'}</div>
            </div>
            <span class="badge badge-level ${levelClass}">${group.level}</span>
          </div>

          <!-- Group Meta Specs -->
          <div class="student-card-details" style="margin-bottom: var(--space-4);">
            <div class="detail-row">
              <span class="detail-label">Преподаватель:</span>
              <span class="detail-val">${teacher ? teacher.fullName : '—'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Учебник:</span>
              <span class="detail-val truncate" style="max-width: 190px;" title="${group.textbook}">${group.textbook || '—'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Смена / Локация:</span>
              <span class="detail-val">
                <span class="badge ${shiftClass}" style="font-size:0.7rem;">${group.shift}</span>
                <span class="text-xs text-muted">• ${group.classroom}</span>
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Уроков в неделю:</span>
              <span class="detail-val font-bold">${lessons.length}</span>
            </div>
          </div>

          <!-- Enrolled Students Roster -->
          <div style="margin-bottom: var(--space-4);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2);">
              <span style="font-size: var(--font-size-xs); font-weight: 700; color: var(--color-text-muted); text-transform: uppercase;">
                Состав группы (${students.length} чел.):
              </span>
            </div>

            <div style="display: flex; flex-wrap: wrap; gap: var(--space-2);">
              ${students.length === 0 ? `
                <span class="text-xs text-muted">В группе пока нет учеников</span>
              ` : students.map(st => `
                <div class="badge" style="background: var(--color-bg-app); border: 1px solid var(--color-border); font-size: 0.75rem; color: var(--color-text-main); font-weight: 500;" title="${formatGrade(st.grade)} • ${st.school}">
                  👤 ${st.fullName} (${formatGrade(st.grade)})
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Footer actions -->
        <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--color-border-subtle); padding-top: var(--space-3); margin-top: auto; flex-wrap: wrap; gap: var(--space-2);">
          <div style="display: flex; gap: var(--space-2); flex-wrap: wrap;">
            <button class="btn btn-primary btn-sm btn-open-classroom" data-id="${group.id}" title="Перейти в кабинет класса: турнирная таблица и статус мини-игр">
              🏫 Кабинет класса
            </button>
            <button class="btn btn-secondary btn-sm btn-group-details" data-id="${group.id}">
              Профиль
            </button>
            ${(isAdmin || isTeacher) ? `
              <button class="btn btn-outline-primary btn-sm btn-print-group-cards" data-id="${group.id}" title="Распечатать памятки с PIN-кодами для учеников группы">
                🖨️ Памятки (${students.length})
              </button>
            ` : ''}
          </div>

          <div style="display: flex; gap: var(--space-2);">
            ${(isAdmin || isTeacher) ? `
              <button class="btn btn-ghost btn-sm btn-edit-group" data-id="${group.id}" title="Редактировать">✏️</button>
              <button class="btn btn-ghost btn-sm btn-delete-group" data-id="${group.id}" style="color: var(--color-danger)" title="Удалить">🗑️</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  updateGridOnly(container) {
    const isAdmin = auth.isAdmin();
    const isTeacher = auth.isTeacher();
    const currentTeacherId = isTeacher ? auth.getCurrentUser()?.id : null;
    const groups = store.getGroups({
      level: this.filterLevel,
      shift: this.filterShift,
      teacherId: isTeacher ? currentTeacherId : (this.filterTeacher !== 'all' ? this.filterTeacher : null),
      search: this.searchQuery
    });
    const gridContainer = container.querySelector('#groups-grid-container');
    if (gridContainer) {
      gridContainer.innerHTML = groups.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">👥</div>
          <div class="empty-state-title">Группы не найдены</div>
          <div class="empty-state-desc">Попробуйте изменить параметры поиска или создайте новую учебную группу.</div>
          ${(isAdmin || isTeacher) ? `<button class="btn btn-primary btn-sm" id="btn-empty-add-group">Создать группу</button>` : ''}
        </div>
      ` : `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 350px), 1fr)); gap: var(--space-5);">
          ${groups.map(g => this.renderGroupCard(g, isAdmin || isTeacher)).join('')}
        </div>
      `;
      this.bindCardEvents(container);
    }
  },

  bindCardEvents(container) {
    container.querySelector('#btn-empty-add-group')?.addEventListener('click', () => this.openAddModal(container));

    container.querySelectorAll('.btn-open-classroom').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (id) {
          openClassroomModal(id, () => this.render(container));
        }
      });
    });

    container.querySelectorAll('.btn-group-details').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.openDetailsModal(id);
      });
    });

    container.querySelectorAll('.btn-print-group-cards').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.printGroupCards(id);
      });
    });

    container.querySelectorAll('.btn-edit-group').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.openEditModal(id, container);
      });
    });

    container.querySelectorAll('.btn-delete-group').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const grp = store.getGroupById(id);
        if (confirm(`Удалить группу "${grp ? grp.name : ''}"? Ученики группы будут откреплены.`)) {
          store.deleteGroup(id);
          toast.success('Группа удалена');
          this.render(container);
        }
      });
    });
  },

  bindEvents(container) {
    container.querySelector('#filter-group-level')?.addEventListener('change', (e) => {
      this.filterLevel = e.target.value;
      this.render(container);
    });

    container.querySelector('#filter-group-shift')?.addEventListener('change', (e) => {
      this.filterShift = e.target.value;
      this.render(container);
    });

    container.querySelector('#filter-group-teacher')?.addEventListener('change', (e) => {
      this.filterTeacher = e.target.value;
      this.render(container);
    });

    container.querySelector('#input-group-search')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.updateGridOnly(container);
    });

    container.querySelector('#btn-add-group')?.addEventListener('click', () => this.openAddModal(container));

    this.bindCardEvents(container);
  },

  openAddModal(container) {
    const teachers = store.getTeachers();
    const students = store.getStudents();
    const textbooks = store.getTextbooks();
    const isTeacher = auth.isTeacher();
    const currentTeacherId = isTeacher ? auth.getCurrentUser()?.id : null;
    const sortedStudents = [...students].sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'ru'));

    modal.open({
      title: 'Создать новую учебную группу',
      bodyHtml: `
        <form id="form-add-group">
          <div class="form-group">
            <label class="form-label">Название группы <span class="required">*</span></label>
            <input type="text" name="name" class="form-control" placeholder="например, Teens Pre-Intermediate (Группа A)" required>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Уровень английского</label>
              <select name="level" id="select-group-level" class="form-control">
                <option value="Beginner">Beginner (Начальный)</option>
                <option value="Elementary">Elementary (Элементарный)</option>
                <option value="Pre-Intermediate" selected>Pre-Intermediate (Ниже среднего)</option>
                <option value="Intermediate">Intermediate (Средний)</option>
                <option value="Upper-Intermediate">Upper-Intermediate (Выше среднего)</option>
                <option value="Advanced">Advanced (Продвинутый)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Преподаватель группы <span class="required">*</span></label>
              <select name="teacherId" class="form-control" required>
                ${teachers.map(t => `<option value="${t.id}" ${isTeacher && currentTeacherId === t.id ? 'selected' : ''}>${t.fullName}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Основной учебник группы <span class="required">*</span></label>
              <select name="textbookSelect" id="select-group-textbook" class="form-control" required>
                <option value="">-- Выберите учебник платформы --</option>
                ${textbooks.map(tb => `<option value="${tb}">📚 ${tb}</option>`).join('')}
                <option value="__custom__">➕ Добавить новый учебник на платформу...</option>
              </select>
              <div id="custom-textbook-wrap" style="margin-top: 6px; display: none;">
                <input type="text" name="customTextbook" id="input-custom-textbook" class="form-control" placeholder="Введите название учебника (например, English World 3)">
              </div>
              <span class="text-xs text-muted" style="margin-top: 4px; display: block;">
                Годовой план уроков (80 занятий), темы и ДЗ группы будут распределены по этому учебнику
              </span>
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
              <label class="form-label">Кабинет / Формат</label>
              <input type="text" name="classroom" class="form-control" placeholder="Кабинет 2 или Онлайн (Zoom)">
            </div>
            <div class="form-group">
              <label class="form-label">Описание группы</label>
              <input type="text" name="description" class="form-control" placeholder="Возраст, цели, особенности">
            </div>
          </div>

          <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
              <label class="form-label" style="margin-bottom:0;">
                Добавить учеников в группу (можно также назначить позже):
              </label>
              <span id="add-group-selected-count-badge" class="badge badge-planned" style="font-size:0.75rem; font-weight:700;">
                Выбрано: 0 из ${sortedStudents.length}
              </span>
            </div>

            <!-- Quick Student Search Input -->
            <div style="position:relative; margin-bottom:8px;">
              <input 
                type="text" 
                id="input-add-group-student-search" 
                class="form-control form-control-sm" 
                placeholder="🔍 Поиск ученика по имени, классу или школе..."
                autocomplete="off"
                style="padding-left:32px; padding-right:28px; font-size:var(--font-size-xs);"
              >
              <span style="position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:0.85rem; pointer-events:none; opacity:0.6;">🔍</span>
              <button 
                type="button" 
                id="btn-clear-add-student-search" 
                title="Очистить поиск"
                style="position:absolute; right:8px; top:50%; transform:translateY(-50%); border:none; background:none; cursor:pointer; color:var(--color-text-muted); font-size:0.9rem; padding:2px 6px; display:none;"
              >✕</button>
            </div>

            <div id="add-group-students-list" style="max-height: 190px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 4px; background: var(--color-bg-app);">
              ${sortedStudents.map(s => {
                const currentGroup = store.getGroupById(s.groupId);
                const searchText = (s.fullName + ' ' + (s.grade || '') + ' ' + (s.school || '') + ' ' + (s.phone || '')).toLowerCase();
                return `
                  <label class="group-modal-student-item" data-search-text="${searchText}" style="display: flex; align-items: center; gap: var(--space-2); padding: 6px 8px; font-size: var(--font-size-xs); cursor: pointer; border-radius: var(--radius-sm); transition: background 0.15s ease; user-select: none;">
                    <input type="checkbox" name="selectedStudents" value="${s.id}" class="cb-group-student-select" style="cursor:pointer; width:15px; height:15px;">
                    <span style="font-weight:600; color:var(--color-text-main);">${s.fullName}</span>
                    <span class="text-muted" style="font-size:0.72rem;">(${formatGrade(s.grade) || '—'}${s.school ? ` • ${s.school}` : ''})</span>
                    ${currentGroup ? `<span class="badge" style="margin-left:auto; font-size:0.68rem; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">[в: ${currentGroup.name}]</span>` : '<span style="margin-left:auto; font-size:0.68rem; color:#16a34a; font-weight:600;">(без группы)</span>'}
                  </label>
                `;
              }).join('')}
              <div id="add-group-students-empty" style="display:none; padding:16px 8px; text-align:center; color:var(--color-text-muted); font-size:var(--font-size-xs);">
                Ученики не найдены
              </div>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Отмена</button>
        <button type="submit" form="form-add-group" class="btn btn-primary">Создать группу</button>
      `,
      onOpen: () => {
        const textbookSelect = document.getElementById('select-group-textbook');
        const customWrap = document.getElementById('custom-textbook-wrap');
        const customInput = document.getElementById('input-custom-textbook');

        textbookSelect?.addEventListener('change', (e) => {
          if (e.target.value === '__custom__') {
            customWrap.style.display = 'block';
            customInput?.focus();
          } else {
            customWrap.style.display = 'none';
          }
        });

        // Student live search & counter
        const searchInput = document.getElementById('input-add-group-student-search');
        const clearBtn = document.getElementById('btn-clear-add-student-search');
        const listContainer = document.getElementById('add-group-students-list');
        const countBadge = document.getElementById('add-group-selected-count-badge');
        const emptyMsg = document.getElementById('add-group-students-empty');
        const studentItems = listContainer ? listContainer.querySelectorAll('.group-modal-student-item') : [];

        const updateSelectedCount = () => {
          const count = listContainer ? listContainer.querySelectorAll('.cb-group-student-select:checked').length : 0;
          if (countBadge) {
            countBadge.textContent = `Выбрано: ${count} из ${sortedStudents.length}`;
            countBadge.className = count > 0 ? 'badge badge-success' : 'badge badge-planned';
          }
        };

        const filterStudents = () => {
          const q = (searchInput?.value || '').toLowerCase().trim();
          if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
          let visible = 0;
          studentItems.forEach(item => {
            const txt = item.getAttribute('data-search-text') || '';
            const match = !q || txt.includes(q);
            item.style.display = match ? 'flex' : 'none';
            if (match) visible++;
          });
          if (emptyMsg) {
            emptyMsg.style.display = visible === 0 ? 'block' : 'none';
            if (visible === 0 && q) {
              emptyMsg.textContent = `Ученики по запросу «${q}» не найдены`;
            }
          }
        };

        searchInput?.addEventListener('input', filterStudents);
        clearBtn?.addEventListener('click', () => {
          if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
            filterStudents();
          }
        });

        listContainer?.querySelectorAll('.cb-group-student-select').forEach(cb => {
          cb.addEventListener('change', (e) => {
            const label = e.target.closest('label');
            if (label) {
              label.style.background = e.target.checked ? '#eef2ff' : 'transparent';
            }
            updateSelectedCount();
          });
        });

        document.getElementById('form-add-group')?.addEventListener('submit', (e) => {
          e.preventDefault();
          const form = e.target;
          const formData = new FormData(form);

          let chosenTextbook = formData.get('textbookSelect');
          if (chosenTextbook === '__custom__') {
            chosenTextbook = formData.get('customTextbook')?.trim();
            if (!chosenTextbook) {
              toast.error('Пожалуйста, введите название нового учебника');
              return;
            }
          }

          if (!chosenTextbook) {
            toast.error('Пожалуйста, выберите основной учебник для группы');
            return;
          }

          const groupData = {
            name: formData.get('name'),
            level: formData.get('level'),
            teacherId: formData.get('teacherId'),
            textbook: chosenTextbook,
            shift: formData.get('shift'),
            classroom: formData.get('classroom'),
            description: formData.get('description')
          };

          const newGroup = store.addGroup(groupData);

          // Assign selected students
          const selectedStudentIds = formData.getAll('selectedStudents');
          selectedStudentIds.forEach(stId => {
            store.updateStudent(stId, {
              groupId: newGroup.id,
              level: newGroup.level,
              textbook: newGroup.textbook
            });
          });

          modal.close();
          toast.success(`Группа "${newGroup.name}" создана с программой учебника "${newGroup.textbook}"!`);
          this.render(container);
        });
      }
    });
  },

  openEditModal(groupId, container) {
    const group = store.getGroupById(groupId);
    if (!group) return;

    const teachers = store.getTeachers();
    const students = store.getStudents();
    const textbooks = store.getTextbooks();
    const currentTb = group.textbook || '';
    const isKnownTb = textbooks.includes(currentTb);
    const sortedStudents = [...students].sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'ru'));
    const initialSelectedCount = sortedStudents.filter(s => s.groupId === group.id).length;

    modal.open({
      title: `Редактирование: ${group.name}`,
      bodyHtml: `
        <form id="form-edit-group">
          <div class="form-group">
            <label class="form-label">Название группы <span class="required">*</span></label>
            <input type="text" name="name" class="form-control" value="${group.name}" required>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Уровень английского</label>
              <select name="level" class="form-control">
                <option value="Beginner" ${group.level === 'Beginner' ? 'selected' : ''}>Beginner</option>
                <option value="Elementary" ${group.level === 'Elementary' ? 'selected' : ''}>Elementary</option>
                <option value="Pre-Intermediate" ${group.level === 'Pre-Intermediate' ? 'selected' : ''}>Pre-Intermediate</option>
                <option value="Intermediate" ${group.level === 'Intermediate' ? 'selected' : ''}>Intermediate</option>
                <option value="Upper-Intermediate" ${group.level === 'Upper-Intermediate' ? 'selected' : ''}>Upper-Intermediate</option>
                <option value="Advanced" ${group.level === 'Advanced' ? 'selected' : ''}>Advanced</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Преподаватель группы</label>
              <select name="teacherId" class="form-control">
                ${teachers.map(t => `<option value="${t.id}" ${group.teacherId === t.id ? 'selected' : ''}>${t.fullName}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Основной учебник группы <span class="required">*</span></label>
              <select name="textbookSelect" id="select-edit-group-textbook" class="form-control" required>
                <option value="">-- Выберите учебник платформы --</option>
                ${textbooks.map(tb => `<option value="${tb}" ${currentTb === tb ? 'selected' : ''}>📚 ${tb}</option>`).join('')}
                <option value="__custom__" ${!isKnownTb && currentTb ? 'selected' : ''}>➕ Добавить новый учебник на платформу...</option>
              </select>
              <div id="edit-custom-textbook-wrap" style="margin-top: 6px; display: ${!isKnownTb && currentTb ? 'block' : 'none'};">
                <input type="text" name="customTextbook" id="input-edit-custom-textbook" class="form-control" placeholder="Введите название учебника" value="${!isKnownTb ? currentTb : ''}">
              </div>
              <span class="text-xs text-muted" style="margin-top: 4px; display: block;">
                При смене учебника темы уроков группы и домашние задания учеников обновятся
              </span>
            </div>
            <div class="form-group">
              <label class="form-label">Смена</label>
              <select name="shift" class="form-control">
                <option value="Первая" ${group.shift === 'Первая' ? 'selected' : ''}>Первая смена</option>
                <option value="Вторая" ${group.shift === 'Вторая' ? 'selected' : ''}>Вторая смена</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Кабинет</label>
              <input type="text" name="classroom" class="form-control" value="${group.classroom || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">Описание</label>
              <input type="text" name="description" class="form-control" value="${group.description || ''}">
            </div>
          </div>

          <div class="form-group">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
              <label class="form-label" style="margin-bottom:0;">
                Состав учеников в группе:
              </label>
              <span id="edit-group-selected-count-badge" class="badge ${initialSelectedCount > 0 ? 'badge-success' : 'badge-planned'}" style="font-size:0.75rem; font-weight:700;">
                Выбрано: ${initialSelectedCount} из ${sortedStudents.length}
              </span>
            </div>

            <!-- Quick Student Search Input -->
            <div style="position:relative; margin-bottom:8px;">
              <input 
                type="text" 
                id="input-edit-group-student-search" 
                class="form-control form-control-sm" 
                placeholder="🔍 Поиск ученика по имени, классу или школе..."
                autocomplete="off"
                style="padding-left:32px; padding-right:28px; font-size:var(--font-size-xs);"
              >
              <span style="position:absolute; left:10px; top:50%; transform:translateY(-50%); font-size:0.85rem; pointer-events:none; opacity:0.6;">🔍</span>
              <button 
                type="button" 
                id="btn-clear-edit-student-search" 
                title="Очистить поиск"
                style="position:absolute; right:8px; top:50%; transform:translateY(-50%); border:none; background:none; cursor:pointer; color:var(--color-text-muted); font-size:0.9rem; padding:2px 6px; display:none;"
              >✕</button>
            </div>

            <div id="edit-group-students-list" style="max-height: 190px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 4px; background: var(--color-bg-app);">
              ${sortedStudents.map(s => {
                const isMember = s.groupId === group.id;
                const searchText = (s.fullName + ' ' + (s.grade || '') + ' ' + (s.school || '') + ' ' + (s.phone || '')).toLowerCase();
                return `
                  <label class="group-modal-student-item" data-search-text="${searchText}" style="display: flex; align-items: center; gap: var(--space-2); padding: 6px 8px; font-size: var(--font-size-xs); cursor: pointer; border-radius: var(--radius-sm); transition: background 0.15s ease; user-select: none; ${isMember ? 'background:#eef2ff;' : ''}">
                    <input type="checkbox" name="selectedStudents" value="${s.id}" ${isMember ? 'checked' : ''} class="cb-edit-group-student-select" style="cursor:pointer; width:15px; height:15px;">
                    <span style="font-weight:600; color:var(--color-text-main);">${s.fullName}</span>
                    <span class="text-muted" style="font-size:0.72rem;">(${formatGrade(s.grade) || '—'}${s.school ? ` • ${s.school}` : ''})</span>
                    ${s.groupId && !isMember ? `<span class="badge" style="margin-left:auto; font-size:0.68rem; background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">[в другой группе]</span>` : isMember ? '<span class="badge badge-success" style="margin-left:auto; font-size:0.68rem;">✓ в этой группе</span>' : '<span style="margin-left:auto; font-size:0.68rem; color:#16a34a; font-weight:600;">(без группы)</span>'}
                  </label>
                `;
              }).join('')}
              <div id="edit-group-students-empty" style="display:none; padding:16px 8px; text-align:center; color:var(--color-text-muted); font-size:var(--font-size-xs);">
                Ученики не найдены
              </div>
            </div>
          </div>
        </form>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Отмена</button>
        <button type="submit" form="form-edit-group" class="btn btn-primary">Сохранить</button>
      `,
      onOpen: () => {
        const textbookSelect = document.getElementById('select-edit-group-textbook');
        const customWrap = document.getElementById('edit-custom-textbook-wrap');
        const customInput = document.getElementById('input-edit-custom-textbook');

        textbookSelect?.addEventListener('change', (e) => {
          if (e.target.value === '__custom__') {
            customWrap.style.display = 'block';
            customInput?.focus();
          } else {
            customWrap.style.display = 'none';
          }
        });

        // Student live search & counter
        const searchInput = document.getElementById('input-edit-group-student-search');
        const clearBtn = document.getElementById('btn-clear-edit-student-search');
        const listContainer = document.getElementById('edit-group-students-list');
        const countBadge = document.getElementById('edit-group-selected-count-badge');
        const emptyMsg = document.getElementById('edit-group-students-empty');
        const studentItems = listContainer ? listContainer.querySelectorAll('.group-modal-student-item') : [];

        const updateSelectedCount = () => {
          const count = listContainer ? listContainer.querySelectorAll('.cb-edit-group-student-select:checked').length : 0;
          if (countBadge) {
            countBadge.textContent = `Выбрано: ${count} из ${sortedStudents.length}`;
            countBadge.className = count > 0 ? 'badge badge-success' : 'badge badge-planned';
          }
        };

        const filterStudents = () => {
          const q = (searchInput?.value || '').toLowerCase().trim();
          if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
          let visible = 0;
          studentItems.forEach(item => {
            const txt = item.getAttribute('data-search-text') || '';
            const match = !q || txt.includes(q);
            item.style.display = match ? 'flex' : 'none';
            if (match) visible++;
          });
          if (emptyMsg) {
            emptyMsg.style.display = visible === 0 ? 'block' : 'none';
            if (visible === 0 && q) {
              emptyMsg.textContent = `Ученики по запросу «${q}» не найдены`;
            }
          }
        };

        searchInput?.addEventListener('input', filterStudents);
        clearBtn?.addEventListener('click', () => {
          if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
            filterStudents();
          }
        });

        listContainer?.querySelectorAll('.cb-edit-group-student-select').forEach(cb => {
          cb.addEventListener('change', (e) => {
            const label = e.target.closest('label');
            if (label) {
              label.style.background = e.target.checked ? '#eef2ff' : 'transparent';
            }
            updateSelectedCount();
          });
        });

        document.getElementById('form-edit-group')?.addEventListener('submit', (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);

          let chosenTextbook = formData.get('textbookSelect');
          if (chosenTextbook === '__custom__') {
            chosenTextbook = formData.get('customTextbook')?.trim();
            if (!chosenTextbook) {
              toast.error('Пожалуйста, укажите название учебника');
              return;
            }
          }

          store.updateGroup(groupId, {
            name: formData.get('name'),
            level: formData.get('level'),
            teacherId: formData.get('teacherId'),
            textbook: chosenTextbook,
            shift: formData.get('shift'),
            classroom: formData.get('classroom'),
            description: formData.get('description')
          });

          // Sync student group assignments
          const selectedStudentIds = formData.getAll('selectedStudents');
          students.forEach(st => {
            if (selectedStudentIds.includes(st.id)) {
              if (st.groupId !== groupId) {
                store.updateStudent(st.id, {
                  groupId,
                  level: formData.get('level'),
                  textbook: chosenTextbook
                });
              }
            } else if (st.groupId === groupId) {
              store.updateStudent(st.id, { groupId: null });
            }
          });

          modal.close();
          toast.success(`Группа "${group.name}" обновлена!`);
          this.render(container);
        });
      }
    });
  },

  openDetailsModal(groupId) {
    const group = store.getGroupById(groupId);
    if (!group) return;

    const teacher = store.getTeacherById(group.teacherId);
    const students = store.getStudentsByGroupId(groupId);
    const lessons = store.getSchedule({ groupId });

    modal.open({
      title: `Группа: ${group.name}`,
      bodyHtml: `
        <div style="display: flex; flex-direction: column; gap: var(--space-5);">
          <!-- Overview Card -->
          <div style="background: var(--color-bg-app); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h3 style="font-size: var(--font-size-md); font-weight: 700;">${group.name}</h3>
                <div class="text-xs text-muted">${group.description || 'Учебная группа'} • ${group.shift} смена • ${group.classroom}</div>
              </div>
              <span class="badge badge-level level-${group.level.toLowerCase()}">${group.level}</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-top: var(--space-3); font-size: var(--font-size-xs);">
              <div><strong>Преподаватель:</strong> ${teacher ? teacher.fullName : '—'}</div>
              <div><strong>Учебник:</strong> ${group.textbook || '—'}</div>
            </div>
          </div>

          <!-- Students List -->
          <div>
            <h4 style="margin-bottom: var(--space-3); font-size: var(--font-size-sm);">🎒 Ученики в группе (${students.length})</h4>
            <div style="display: flex; flex-direction: column; gap: var(--space-2); max-height: 180px; overflow-y: auto;">
              ${students.length === 0 ? '<div class="text-xs text-muted">В группе пока нет учеников</div>' : students.map(st => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) var(--space-3); background: var(--color-bg-app); border-radius: var(--radius-md); font-size: var(--font-size-xs);">
                  <div>
                    <span class="font-semibold">${st.fullName}</span> (${formatGrade(st.grade)}, ${st.school})
                    <div class="text-muted">${st.parentName || ''} • ${st.phone || ''}</div>
                  </div>
                  <span class="student-points-badge">⭐ ${st.totalPoints || 0}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Group Lessons -->
          <div>
            <h4 style="margin-bottom: var(--space-3); font-size: var(--font-size-sm);">📅 Расписание занятий группы</h4>
            <div style="display: flex; flex-direction: column; gap: var(--space-2);">
              ${lessons.length === 0 ? '<div class="text-xs text-muted">Занятия еще не назначены</div>' : lessons.map(l => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) var(--space-3); background: var(--color-bg-app); border-radius: var(--radius-md); font-size: var(--font-size-xs);">
                  <div>
                    <strong>${l.dayOfWeek} ${l.time}</strong> — ${l.topic}
                    <div class="text-muted">${l.format}</div>
                  </div>
                  <span class="badge badge-${l.status}">${l.status === 'planned' ? 'Запланирован' : l.status === 'completed' ? 'Проведен' : 'Отменен'}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `,
      footerHtml: `
        <button type="button" class="btn btn-outline-primary btn-sm" id="btn-modal-print-cards">🖨️ Распечатать памятки (${students.length})</button>
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Закрыть</button>
      `,
      onOpen: () => {
        document.getElementById('btn-modal-print-cards')?.addEventListener('click', () => {
          this.printGroupCards(groupId);
        });
      }
    });
  },

  printGroupCards(groupId) {
    const group = store.getGroupById(groupId);
    if (!group) return;

    const teacher = store.getTeacherById(group.teacherId);
    const students = store.getStudentsByGroupId(groupId);

    if (students.length === 0) {
      toast.info(`В группе "${group.name}" пока нет учеников для печати памяток.`);
      return;
    }

    const baseUrl = window.location.origin;

    const cardsHtml = students.map((st) => {
      const pin = store.getStudentPin(st);
      const qrUrl = `${baseUrl}/#qr=${encodeURIComponent(st.id + ':' + pin)}`;
      const qrSvg = generateQRCodeSvg(qrUrl, { size: 76, margin: 1, level: 'M' });

      return `
        <div class="memo-card">
          <div class="memo-card-inner">
            <div class="memo-card-left">
              <div class="memo-school-title">🎓 Step Up English</div>
              <div class="memo-student-name" title="${st.fullName}">👤 ${st.fullName}</div>
              <div class="memo-group-info">Группа: <strong>${group.name}</strong> (${group.level})</div>
              <div class="memo-qr-hint">📱 Наведите камеру для входа</div>
              <div class="memo-footer-id">ID: <span>${st.id}</span> • Резервный PIN: <strong>${pin}</strong></div>
            </div>
            <div class="memo-card-right">
              <div class="memo-qr-box">
                ${qrSvg}
              </div>
              <div class="memo-qr-sub">QR-вход</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    modal.open({
      title: `🖨️ Памятки с QR-кодами: ${group.name} (${students.length} учеников)`,
      bodyHtml: `
        <div class="print-preview-wrapper">
          <div class="print-actions-bar print-hide" style="display:flex; justify-content:space-between; align-items:center; background:var(--color-bg-app); border:1px solid var(--color-border); border-radius:var(--radius-md); padding:var(--space-3) var(--space-4); margin-bottom:var(--space-4); flex-wrap:wrap; gap:var(--space-2);">
            <div>
              <div style="font-weight:700; font-size:var(--font-size-sm); color:var(--color-text-main);">
                Лист наклеек/карточек с QR-кодами (${students.length} шт.)
              </div>
              <div class="text-xs text-muted" style="margin-top:2px;">
                Оптимизировано для печати на А4: до 12 учеников умещаются на 1 листе, 13 учеников — на 2 листах.
              </div>
            </div>
            <button type="button" class="btn btn-primary" id="btn-do-print" style="white-space:nowrap;">
              🖨️ Отправить на печать
            </button>
          </div>

          <style id="memo-print-styles">
            .print-cards-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12px;
            }
            .memo-card {
              border: 1.5px dashed #94a3b8;
              border-radius: 8px;
              padding: 10px 12px;
              background: #ffffff;
              color: #1e293b;
              box-sizing: border-box;
              font-family: inherit;
            }
            .memo-card-inner {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 10px;
              height: 100%;
            }
            .memo-card-left {
              flex: 1;
              min-width: 0;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
            }
            .memo-school-title {
              font-size: 0.72rem;
              font-weight: 800;
              color: #4338ca;
              text-transform: uppercase;
              letter-spacing: 0.03em;
              margin-bottom: 2px;
            }
            .memo-student-name {
              font-size: 0.98rem;
              font-weight: 800;
              color: #0f172a;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              margin-bottom: 2px;
            }
            .memo-group-info {
              font-size: 0.75rem;
              color: #475569;
              margin-bottom: 4px;
            }
            .memo-qr-hint {
              font-size: 0.7rem;
              color: #2563eb;
              font-weight: 600;
              line-height: 1.25;
              margin-bottom: 4px;
            }
            .memo-footer-id {
              font-size: 0.65rem;
              color: #64748b;
              border-top: 1px dashed #e2e8f0;
              padding-top: 3px;
            }
            .memo-card-right {
              display: flex;
              flex-direction: column;
              align-items: center;
              flex-shrink: 0;
            }
            .memo-qr-box {
              background: #ffffff;
              padding: 2px;
              border: 1px solid #cbd5e1;
              border-radius: 4px;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .memo-qr-sub {
              font-size: 0.6rem;
              font-weight: 700;
              color: #64748b;
              text-transform: uppercase;
              margin-top: 2px;
              letter-spacing: 0.05em;
            }

            @media print {
              @page {
                size: A4 portrait;
                margin: 8mm 6mm;
              }
              html, body {
                height: auto !important;
                overflow: visible !important;
                background: #ffffff !important;
              }
              body * {
                visibility: hidden !important;
              }
              dialog#main-modal, .modal-backdrop, .modal-container, .modal-content, .print-preview-wrapper {
                position: static !important;
                max-height: none !important;
                height: auto !important;
                overflow: visible !important;
                border: none !important;
                box-shadow: none !important;
                padding: 0 !important;
                margin: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
                background: transparent !important;
              }
              dialog::backdrop {
                display: none !important;
              }
              #printable-memos-area, #printable-memos-area * {
                visibility: visible !important;
              }
              #printable-memos-area {
                position: static !important;
                width: 100% !important;
                padding: 0 !important;
                margin: 0 !important;
                background: #ffffff !important;
              }
              .print-hide {
                display: none !important;
              }
              .print-cards-grid {
                display: grid !important;
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 4mm !important;
                width: 100% !important;
              }
              .memo-card {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                border: 1.5px dashed #000000 !important;
                background: #ffffff !important;
                color: #000000 !important;
                box-shadow: none !important;
                height: 48mm !important;
                max-height: 48mm !important;
                padding: 3mm 4mm !important;
                box-sizing: border-box !important;
                overflow: hidden !important;
              }
              .memo-qr-box {
                border-color: #000000 !important;
              }
            }
          </style>

          <div id="printable-memos-area">
            <div class="print-cards-grid">
              ${cardsHtml}
            </div>
          </div>
        </div>
      `,
      footerHtml: `
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Закрыть</button>
        <button type="button" class="btn btn-primary" id="btn-footer-print">🖨️ Печать</button>
      `,
      onOpen: () => {
        const triggerPrint = () => {
          let printFrame = document.getElementById('qr-cards-print-frame');
          if (printFrame) {
            try { printFrame.remove(); } catch (e) {}
          }

          printFrame = document.createElement('iframe');
          printFrame.id = 'qr-cards-print-frame';
          printFrame.style.position = 'fixed';
          printFrame.style.right = '0';
          printFrame.style.bottom = '0';
          printFrame.style.width = '0';
          printFrame.style.height = '0';
          printFrame.style.border = '0';
          printFrame.style.opacity = '0';
          printFrame.style.pointerEvents = 'none';
          document.body.appendChild(printFrame);

          const frameDoc = printFrame.contentWindow.document;
          frameDoc.open();
          frameDoc.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>QR-коды: ${group.name}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 6mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #ffffff;
      color: #000000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      margin: 0;
      padding: 0;
    }
    .print-cards-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 4mm;
      width: 100%;
    }
    .memo-card {
      border: 1.5px dashed #000000;
      border-radius: 6px;
      padding: 3mm 4mm;
      background: #ffffff;
      color: #000000;
      page-break-inside: avoid;
      break-inside: avoid;
      height: 48mm;
      max-height: 48mm;
      box-sizing: border-box;
      overflow: hidden;
    }
    .memo-card-inner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 3mm;
      height: 100%;
      width: 100%;
    }
    .memo-card-left {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100%;
    }
    .memo-school-title {
      font-size: 11px;
      font-weight: 800;
      color: #000000;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      line-height: 1.2;
    }
    .memo-student-name {
      font-size: 13.5px;
      font-weight: 800;
      color: #000000;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.2;
      margin: 1mm 0;
    }
    .memo-group-info {
      font-size: 10px;
      color: #222222;
      line-height: 1.2;
    }
    .memo-qr-hint {
      font-size: 9.5px;
      color: #444444;
      line-height: 1.2;
    }
    .memo-footer-id {
      font-size: 8.5px;
      color: #333333;
      border-top: 1px dotted #888888;
      padding-top: 1.5mm;
      line-height: 1.2;
    }
    .memo-card-right {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .memo-qr-box {
      width: 72px;
      height: 72px;
      border: 1px solid #000000;
      border-radius: 4px;
      padding: 1px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
    }
    .memo-qr-box svg {
      width: 70px;
      height: 70px;
      display: block;
    }
    .memo-qr-sub {
      font-size: 8px;
      font-weight: 700;
      color: #000000;
      text-transform: uppercase;
      margin-top: 1mm;
      letter-spacing: 0.05em;
    }
  </style>
</head>
<body>
  <div class="print-cards-grid">
    ${cardsHtml}
  </div>
</body>
</html>`);
          frameDoc.close();

          setTimeout(() => {
            try {
              printFrame.contentWindow.focus();
              printFrame.contentWindow.print();
            } catch (err) {
              console.warn('Iframe print error, falling back to window.print():', err);
              window.print();
            }
            setTimeout(() => {
              try { printFrame.remove(); } catch (e) {}
            }, 3000);
          }, 250);
        };

        document.getElementById('btn-do-print')?.addEventListener('click', triggerPrint);
        document.getElementById('btn-footer-print')?.addEventListener('click', triggerPrint);
      }
    });
  }
};
