import { store } from '../store.js';
import { auth } from '../auth.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';

export const SurveyView = {
  render(container) {
    const currentUser = auth.getCurrentUser();
    const isStudent = auth.isStudent();

    if (!isStudent) {
      this.renderAdminTeacherView(container);
      return;
    }

    const studentId = currentUser?.id || auth.currentStudentId;
    const student = store.getStudentById(studentId);

    if (!student) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">Ученик не найден</div>
          <div class="empty-state-desc">Пожалуйста, выполните повторный вход в личный кабинет.</div>
          <a href="#student-cabinet" class="btn btn-primary" style="margin-top:16px;">В кабинет</a>
        </div>
      `;
      return;
    }

    const isCompleted = Boolean(student.surveyCompleted);

    container.innerHTML = `
      <style>
        .survey-page-container {
          max-width: 860px;
          margin: 0 auto;
          padding-bottom: var(--space-8);
        }
        .survey-header-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: var(--space-6);
          flex-wrap: wrap;
          gap: var(--space-3);
        }
        .survey-form-card {
          box-shadow: var(--shadow-md);
        }
        .survey-2col-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: var(--space-4);
        }
        .survey-parent-box {
          background: var(--color-bg-app);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: var(--space-4);
          margin-bottom: var(--space-4);
        }
        .survey-parent-grid {
          display: grid;
          grid-template-columns: 140px 1.4fr 1.1fr;
          gap: var(--space-3);
          align-items: start;
        }
        .survey-parent-grid .form-group {
          margin-bottom: 0;
        }
        .survey-parent-grid .form-control {
          width: 100%;
          box-sizing: border-box;
          min-width: 0;
        }
        .survey-actions-bar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--space-3);
          border-top: 1px solid var(--color-border);
          padding-top: var(--space-4);
        }

        /* Responsive Mobile Layout */
        @media (max-width: 720px) {
          .survey-page-container {
            padding: 0 var(--space-2) var(--space-8) var(--space-2);
          }
          .survey-form-card {
            padding: var(--space-4) var(--space-3) !important;
          }
          .survey-2col-grid {
            grid-template-columns: 1fr !important;
            gap: var(--space-3) !important;
          }
          .survey-parent-box {
            padding: var(--space-3) !important;
          }
          .survey-parent-grid {
            grid-template-columns: 1fr !important;
            gap: var(--space-3) !important;
          }
          .survey-parent-grid .form-group {
            width: 100% !important;
          }
          .survey-parent-grid .form-label {
            font-size: 0.85rem;
            margin-bottom: 4px;
          }
          .survey-parent-grid .form-control,
          .survey-2col-grid .form-control {
            font-size: 16px !important; /* Prevents auto-zoom in iOS Safari */
            padding: 10px 12px !important;
          }
          .survey-actions-bar {
            flex-direction: column-reverse;
            gap: var(--space-3);
          }
          .survey-actions-bar .btn {
            width: 100%;
            text-align: center;
            justify-content: center;
            padding: 12px;
            font-size: 1rem;
          }
        }
      </style>

      <div class="survey-page-container">
        <!-- Navigation Header -->
        <div class="survey-header-box">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <a href="#student-cabinet" class="btn btn-sm btn-ghost" style="text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
                ← Назад в кабинет
              </a>
              <span class="badge ${isCompleted ? 'badge-completed' : 'badge-planned'}" style="font-size: 0.75rem;">
                ${isCompleted ? '✓ Анкета заполнена' : '⏳ Ожидает заполнения'}
              </span>
            </div>
            <h1 class="page-title" style="margin-top: var(--space-2); font-size: 1.75rem; font-weight: 800; color: var(--color-text-main);">
              📋 Анкета ученика
            </h1>
            <p class="text-muted" style="margin-top: 2px;">
              Персональные данные и контакты родителей для связи и поздравлений
            </p>
          </div>

          <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 10px 18px; border-radius: var(--radius-xl); box-shadow: 0 4px 14px rgba(245, 158, 11, 0.35); text-align: center;">
            <div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; opacity: 0.95;">
              Награда за анкету
            </div>
            <div style="font-size: 1.4rem; font-weight: 900; line-height: 1.1;">
              +200 ⭐
            </div>
          </div>
        </div>

        <!-- Completion Alert Banner -->
        ${isCompleted ? `
          <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 1.5px solid #10b981; border-radius: var(--radius-lg); padding: var(--space-4) var(--space-5); margin-bottom: var(--space-6); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3);">
            <div style="display: flex; align-items: center; gap: var(--space-3);">
              <span style="font-size: 1.8rem;">🎉</span>
              <div>
                <div style="font-weight: 700; color: #065f46; font-size: 1rem;">
                  Анкета успешно заполнена! Бонус +200 ⭐ начислен
                </div>
                <div style="font-size: var(--font-size-xs); color: #047857; margin-top: 2px;">
                  Спасибо за предоставленные данные. Вы можете в любой момент обновить контакты или дату рождения ниже.
                </div>
              </div>
            </div>
            <span class="badge" style="background: #10b981; color: white; font-weight: 700; padding: 6px 12px; border-radius: var(--radius-full);">
              Бонус получен ✓
            </span>
          </div>
        ` : `
          <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 1.5px solid #3b82f6; border-radius: var(--radius-lg); padding: var(--space-4) var(--space-5); margin-bottom: var(--space-6); display: flex; align-items: center; gap: var(--space-3);">
            <span style="font-size: 1.8rem;">🎁</span>
            <div>
              <div style="font-weight: 700; color: #1e40af; font-size: 1rem;">
                Получи 200 ⭐ бонусов за заполнение анкеты!
              </div>
              <div style="font-size: var(--font-size-xs); color: #1d4ed8; margin-top: 2px;">
                Заполни все обязательные поля с личными контактами и данными родителей, чтобы мгновенно получить баллы на свой баланс!
              </div>
            </div>
          </div>
        `}

        <!-- Survey Form Card -->
        <div class="card survey-form-card">
          <form id="student-survey-form">
            <!-- SECTION 1: Personal Details -->
            <div style="margin-bottom: var(--space-6);">
              <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--color-primary); display: flex; align-items: center; gap: 8px; margin-bottom: var(--space-4); border-bottom: 2px solid var(--color-border); padding-bottom: 8px;">
                <span>👤</span> Личные данные ученика
              </h3>

              <div class="survey-2col-grid">
                <div class="form-group">
                  <label class="form-label">ФИО ученика (полностью) <span class="required" style="color:var(--color-danger);">*</span></label>
                  <input type="text" name="fullName" class="form-control" value="${student.fullName || ''}" placeholder="Иванов Иван Иванович" required>
                  <div class="text-xs text-muted" style="margin-top: 3px;">Фамилия, Имя и Отчество</div>
                </div>

                <div class="form-group">
                  <label class="form-label">Дата рождения <span class="required" style="color:var(--color-danger);">*</span></label>
                  <input type="date" name="birthDate" class="form-control" value="${student.birthDate || ''}" required>
                  <div class="text-xs text-muted" style="margin-top: 3px;">В этот день мы подарим тебе +500 ⭐ на покупки в магазине! 🎂</div>
                </div>
              </div>

              <div class="survey-2col-grid" style="margin-top: var(--space-4);">
                <div class="form-group">
                  <label class="form-label">Номер телефона ученика <span class="required" style="color:var(--color-danger);">*</span></label>
                  <input type="tel" name="phone" class="form-control" value="${student.phone || ''}" placeholder="+7 (999) 000-00-00" required>
                </div>

                <div class="form-group">
                  <label class="form-label">Школа</label>
                  <input type="text" name="school" class="form-control" value="${student.school || ''}" placeholder="например, СОШ №24">
                </div>
              </div>

              <div class="survey-2col-grid" style="margin-top: var(--space-4);">
                <div class="form-group">
                  <label class="form-label">Класс</label>
                  <input type="text" name="grade" class="form-control" value="${student.grade || ''}" placeholder="например, 5 «А»">
                </div>

                <div class="form-group">
                  <label class="form-label">Смена в школе</label>
                  <select name="shift" class="form-control">
                    <option value="1 смена" ${student.shift === '1 смена' ? 'selected' : ''}>1 смена (утро)</option>
                    <option value="2 смена" ${student.shift === '2 смена' ? 'selected' : ''}>2 смена (день)</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- SECTION 2: Parents Contacts -->
            <div style="margin-bottom: var(--space-6);">
              <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--color-primary); display: flex; align-items: center; gap: 8px; margin-bottom: var(--space-4); border-bottom: 2px solid var(--color-border); padding-bottom: 8px;">
                <span>👨‍👩‍👦</span> Данные родителей / законных представителей
              </h3>

              <!-- Parent 1 (Mandatory) -->
              <div class="survey-parent-box">
                <div style="font-weight: 700; font-size: var(--font-size-sm); color: var(--color-text-main); margin-bottom: var(--space-3); display: flex; align-items: center; justify-content: space-between;">
                  <span>Основной контакт (Родитель 1) <span style="color:var(--color-danger);">*</span></span>
                  <span class="badge badge-primary" style="font-size: 0.7rem;">Обязательно</span>
                </div>

                <div class="survey-parent-grid">
                  <div class="form-group">
                    <label class="form-label">Кем приходится</label>
                    <select name="parent1Role" class="form-control">
                      <option value="Мама" ${student.parent1Role === 'Мама' || !student.parent1Role ? 'selected' : ''}>Мама</option>
                      <option value="Папа" ${student.parent1Role === 'Папа' ? 'selected' : ''}>Папа</option>
                      <option value="Бабушка" ${student.parent1Role === 'Бабушка' ? 'selected' : ''}>Бабушка</option>
                      <option value="Дедушка" ${student.parent1Role === 'Дедушка' ? 'selected' : ''}>Дедушка</option>
                      <option value="Опекун" ${student.parent1Role === 'Опекун' ? 'selected' : ''}>Опекун</option>
                    </select>
                  </div>

                  <div class="form-group">
                    <label class="form-label">ФИО родителя <span class="required" style="color:var(--color-danger);">*</span></label>
                    <input type="text" name="parent1Name" class="form-control" value="${student.parent1Name || student.parentName || ''}" placeholder="Иванова Анна Сергеевна" required>
                  </div>

                  <div class="form-group">
                    <label class="form-label">Телефон родителя <span class="required" style="color:var(--color-danger);">*</span></label>
                    <input type="tel" name="parent1Phone" class="form-control" value="${student.parent1Phone || student.parentPhone || ''}" placeholder="+7 (999) 111-22-33" required>
                  </div>
                </div>
              </div>

              <!-- Parent 2 (Optional) -->
              <div class="survey-parent-box">
                <div style="font-weight: 700; font-size: var(--font-size-sm); color: var(--color-text-muted); margin-bottom: var(--space-3); display: flex; align-items: center; justify-content: space-between;">
                  <span>Второй контакт (Родитель 2)</span>
                  <span class="badge" style="font-size: 0.7rem; background: var(--color-border); color: var(--color-text-muted);">По желанию</span>
                </div>

                <div class="survey-parent-grid">
                  <div class="form-group">
                    <label class="form-label">Кем приходится</label>
                    <select name="parent2Role" class="form-control">
                      <option value="Папа" ${student.parent2Role === 'Папа' || !student.parent2Role ? 'selected' : ''}>Папа</option>
                      <option value="Мама" ${student.parent2Role === 'Мама' ? 'selected' : ''}>Мама</option>
                      <option value="Бабушка" ${student.parent2Role === 'Бабушка' ? 'selected' : ''}>Бабушка</option>
                      <option value="Дедушка" ${student.parent2Role === 'Дедушка' ? 'selected' : ''}>Дедушка</option>
                      <option value="Опекун" ${student.parent2Role === 'Опекун' ? 'selected' : ''}>Опекун</option>
                    </select>
                  </div>

                  <div class="form-group">
                    <label class="form-label">ФИО родителя</label>
                    <input type="text" name="parent2Name" class="form-control" value="${student.parent2Name || ''}" placeholder="Иванов Сергей Петрович">
                  </div>

                  <div class="form-group">
                    <label class="form-label">Телефон родителя</label>
                    <input type="tel" name="parent2Phone" class="form-control" value="${student.parent2Phone || ''}" placeholder="+7 (999) 333-44-55">
                  </div>
                </div>
              </div>
            </div>

            <!-- Submit Button & Controls -->
            <div class="survey-actions-bar">
              <a href="#student-cabinet" class="btn btn-secondary" style="text-decoration:none;">
                Отмена
              </a>
              <button type="submit" class="btn btn-primary" id="btn-save-survey" style="font-weight: 700; padding: 12px 28px; font-size: 1rem; border-radius: var(--radius-lg); box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);">
                💾 Сохранить анкету ${isCompleted ? '' : '(+200 ⭐)'}
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    // Form submission handler
    const form = container.querySelector('#student-survey-form');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);

      const surveyData = {
        fullName: fd.get('fullName')?.trim(),
        birthDate: fd.get('birthDate')?.trim(),
        phone: fd.get('phone')?.trim(),
        school: fd.get('school')?.trim(),
        grade: fd.get('grade')?.trim(),
        shift: fd.get('shift')?.trim(),
        parent1Role: fd.get('parent1Role')?.trim() || 'Мама',
        parent1Name: fd.get('parent1Name')?.trim(),
        parent1Phone: fd.get('parent1Phone')?.trim(),
        parent2Role: fd.get('parent2Role')?.trim() || 'Папа',
        parent2Name: fd.get('parent2Name')?.trim(),
        parent2Phone: fd.get('parent2Phone')?.trim()
      };

      if (!surveyData.fullName || !surveyData.birthDate || !surveyData.phone || !surveyData.parent1Name || !surveyData.parent1Phone) {
        toast.warning('Пожалуйста, заполните все обязательные поля');
        return;
      }

      const saveRes = store.saveStudentSurvey(student.id, surveyData);

      if (saveRes.success) {
        if (saveRes.bonusAwarded) {
          modal.open({
            title: '🎉 Анкета успешно заполнена!',
            bodyHtml: `
              <div style="text-align: center; padding: var(--space-4) var(--space-2);">
                <div style="font-size: 3.5rem; margin-bottom: 12px;">🌟⭐🎁</div>
                <h3 style="font-size: 1.35rem; font-weight: 800; color: var(--color-primary); margin-bottom: 8px;">
                  Отлично! Ты получил +200 ⭐ баллов!
                </h3>
                <p style="font-size: 0.95rem; color: var(--color-text-main); line-height: 1.5; margin-bottom: 16px;">
                  Твоя анкета сохранена, а на баланс начислены подарочные баллы. Теперь ты можешь тратить их на классные аватары и титулы в магазине!
                </p>
                <div style="background: #f0fdf4; border: 1.5px solid #22c55e; border-radius: var(--radius-lg); padding: 12px; font-weight: 700; color: #15803d; font-size: 1.1rem;">
                  Твой новый баланс: ${saveRes.student?.totalPoints || 0} ⭐
                </div>
              </div>
            `,
            footerHtml: `
              <button type="button" class="btn btn-primary" id="btn-survey-congrats-close" style="width: 100%; font-weight: 700; padding: 10px;">
                Отлично! Вперед учиться! 🚀
              </button>
            `,
            onOpen: (dialog) => {
              dialog.querySelector('#btn-survey-congrats-close')?.addEventListener('click', () => {
                modal.close();
                this.render(container);
              });
            }
          });
        } else {
          toast.success('Данные анкеты успешно обновлены!');
          this.render(container);
        }
      } else {
        toast.error(saveRes.error || 'Ошибка при сохранении анкеты');
      }
    });
  },

  renderAdminTeacherView(container) {
    const students = store.getStudents();
    const completedCount = students.filter(s => s.surveyCompleted).length;

    container.innerHTML = `
      <div class="survey-teacher-view" style="max-width: 1100px; margin: 0 auto; padding-bottom: var(--space-8);">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-6); flex-wrap: wrap; gap: var(--space-3);">
          <div>
            <h1 class="page-title" style="font-size: 1.75rem; font-weight: 800;">
              📋 Анкеты и контакты учеников
            </h1>
            <p class="text-muted" style="margin-top: 2px;">
              База контактов учеников, дат рождения и номеров телефонов родителей
            </p>
          </div>

          <div style="display: flex; gap: var(--space-3);">
            <div style="background: var(--color-bg-app); border: 1px solid var(--color-border); padding: 8px 16px; border-radius: var(--radius-lg); text-align: center;">
              <div style="font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; font-weight: 700;">Заполнено анкет</div>
              <div style="font-size: 1.3rem; font-weight: 800; color: var(--color-primary);">${completedCount} / ${students.length}</div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom: var(--space-4);">
          <div style="display: flex; gap: var(--space-3); flex-wrap: wrap; align-items: center;">
            <input type="text" id="survey-search-input" class="form-control" placeholder="🔍 Поиск по ФИО, телефону или родителю..." style="flex: 1; min-width: 260px;">
          </div>
        </div>

        <div class="card" style="padding: 0; overflow-x: auto;">
          <table class="table" style="margin: 0; width: 100%;">
            <thead>
              <tr>
                <th>Ученик / Группа</th>
                <th>Дата рождения</th>
                <th>Телефон ученика</th>
                <th>Родитель 1 (Основной)</th>
                <th>Родитель 2 (Доп)</th>
                <th>Статус анкеты</th>
              </tr>
            </thead>
            <tbody id="survey-table-body">
              ${this.renderStudentsTableRows(students)}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Filter functionality
    const searchInput = container.querySelector('#survey-search-input');
    const tableBody = container.querySelector('#survey-table-body');

    searchInput?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = students.filter(s => {
        const full = (s.fullName || '').toLowerCase();
        const p1 = (s.parent1Name || s.parentName || '').toLowerCase();
        const ph1 = (s.parent1Phone || s.parentPhone || '').toLowerCase();
        const sph = (s.phone || '').toLowerCase();
        return full.includes(q) || p1.includes(q) || ph1.includes(q) || sph.includes(q);
      });
      tableBody.innerHTML = this.renderStudentsTableRows(filtered);
    });
  },

  renderStudentsTableRows(students) {
    if (students.length === 0) {
      return `<tr><td colspan="6" style="text-align:center; padding:var(--space-6); color:var(--color-text-muted);">Ничего не найдено</td></tr>`;
    }

    return students.map(s => {
      const grp = store.getGroupById(s.groupId);
      const isComp = Boolean(s.surveyCompleted);
      const bday = s.birthDate ? new Date(s.birthDate).toLocaleDateString('ru-RU') : '—';
      const p1Role = s.parent1Role || 'Родитель';
      const p1Name = s.parent1Name || s.parentName || '—';
      const p1Phone = s.parent1Phone || s.parentPhone || '—';
      const p2Role = s.parent2Role || 'Родитель 2';
      const p2Name = s.parent2Name || '—';
      const p2Phone = s.parent2Phone || '—';

      return `
        <tr>
          <td>
            <div style="font-weight: 700; color: var(--color-text-main);">${s.fullName}</div>
            <div class="text-xs text-muted">${grp ? grp.name : 'Индивидуально'} • ${s.grade || '—'}, ${s.school || '—'}</div>
          </td>
          <td>
            <div style="font-weight: 600;">🎂 ${bday}</div>
          </td>
          <td>
            ${s.phone ? `<a href="tel:${s.phone}" style="color:var(--color-primary); font-weight:600; text-decoration:none;">${s.phone}</a>` : '—'}
          </td>
          <td>
            <div><strong>${p1Role}:</strong> ${p1Name}</div>
            ${p1Phone !== '—' ? `<div style="font-size:0.8rem; margin-top:2px;"><a href="tel:${p1Phone}" style="color:var(--color-text-muted); text-decoration:none;">📞 ${p1Phone}</a></div>` : ''}
          </td>
          <td>
            ${s.parent2Name ? `
              <div><strong>${p2Role}:</strong> ${p2Name}</div>
              ${p2Phone !== '—' ? `<div style="font-size:0.8rem; margin-top:2px;"><a href="tel:${p2Phone}" style="color:var(--color-text-muted); text-decoration:none;">📞 ${p2Phone}</a></div>` : ''}
            ` : '<span class="text-muted">—</span>'}
          </td>
          <td>
            <span class="badge ${isComp ? 'badge-completed' : 'badge-planned'}" style="font-size: 0.7rem;">
              ${isComp ? '✓ Заполнена' : 'Не заполнена'}
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }
};
