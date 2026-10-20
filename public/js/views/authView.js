/**
 * Dedicated Authentication View - Student Login/PIN & Staff Login
 */

import { auth } from '../auth.js';
import { store, formatPhoneForDisplay } from '../store.js';
import { toast } from '../components/toast.js';

export const AuthView = {
  activeTab: 'student', // 'student' | 'staff'
  enteredPhone: '',

  render(container) {
    container.innerHTML = `
      <div class="auth-page-wrapper">
        <div class="auth-card">
          <!-- Logo & Header -->
          <div class="auth-card-header">
            <div class="brand-logo" style="justify-content:center; margin-bottom:var(--space-2);">
              <div class="brand-icon" style="width:40px; height:40px; font-size:1.25rem;">S</div>
              <span style="font-size:1.35rem; font-weight:800; color:var(--color-text-main);">Step Up English</span>
            </div>
            <h2 class="auth-title">Курсы английского языка</h2>
            <p class="auth-subtitle">Личный кабинет учеников и преподавателей</p>
          </div>

          <!-- Auth Tabs Switcher -->
          <div class="auth-tabs">
            <button type="button" class="auth-tab-btn ${this.activeTab === 'student' ? 'active' : ''}" id="tab-student-btn">
              🎒 Ученикам
            </button>
            <button type="button" class="auth-tab-btn ${this.activeTab === 'staff' ? 'active' : ''}" id="tab-staff-btn">
              👨‍🏫 Преподавателям и Администрации
            </button>
          </div>

          <!-- Tab 1: Student Phone/PIN Login | Tab 2: Staff Auth -->
          ${this.activeTab === 'student' ? this.renderStudentAuth() : this.renderStaffAuth()}
        </div>
      </div>
    `;

    this.bindEvents(container);
  },

  renderStudentAuth() {
    return `
      <!-- QR Auto-Login Guidance Banner -->
      <div style="background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%); border: 1.5px solid #c7d2fe; border-radius: var(--radius-lg); padding: var(--space-4); margin-bottom: var(--space-4); text-align: center;">
        <div style="font-size: 2rem; margin-bottom: 6px;">📸 ➔ ⚡</div>
        <div style="font-weight: 800; font-size: 1.05rem; color: #3730a3; margin-bottom: 4px;">
          Вход по персональному QR-коду
        </div>
        <div style="font-size: 0.85rem; color: #4338ca; line-height: 1.45;">
          Наведите камеру вашего смартфона на персональный <strong>QR-код из памятки ученика</strong> — вход в личный кабинет произойдет мгновенно!
        </div>
      </div>

      <div style="position:relative; text-align:center; margin: var(--space-3) 0;">
        <div style="position:absolute; top:50%; left:0; right:0; height:1px; background:var(--color-border);"></div>
        <span style="position:relative; background:#ffffff; padding:0 12px; font-size:0.75rem; color:var(--color-text-muted); font-weight:600; text-transform:uppercase;">или введите данные вручную</span>
      </div>

      <form id="form-student-login" class="auth-form">
        <div class="form-group">
          <label class="form-label">Номер телефона или логин ученика <span class="required">*</span></label>
          <input type="text" id="student-login-input" name="login" class="form-control" placeholder="" value="${this.enteredPhone || ''}" required autofocus style="font-size:1.05rem; padding-left:1rem;">
        </div>

        <div class="form-group">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <label class="form-label" style="margin-bottom:0;">Персональный 4-значный PIN-код <span class="required">*</span></label>
            <span class="text-xs text-muted" style="font-size:0.75rem;">Из памятки</span>
          </div>
          <input type="password" id="student-pin-input" name="pin" class="form-control" placeholder="" maxlength="4" pattern="[0-9]{4}" inputmode="numeric" required style="font-size:1.4rem; letter-spacing:0.35em; text-align:center; font-weight:700;">
        </div>

        <div id="auth-student-error" class="auth-error-alert" style="display:none; margin-top:var(--space-2);"></div>

        <button type="submit" class="btn btn-primary btn-lg" style="width:100%; margin-top:var(--space-3);">
          Войти в личный кабинет ➔
        </button>
      </form>
    `;
  },

  renderStaffAuth() {
    return `
      <!-- Staff Credentials Form (Clean, no placeholders or hints) -->
      <form id="form-staff-login" class="auth-form">
        <div class="form-group">
          <label class="form-label">Email или логин <span class="required">*</span></label>
          <input type="text" id="input-staff-login" name="login" class="form-control" placeholder="" required autofocus autocomplete="username">
        </div>

        <div class="form-group">
          <label class="form-label">Пароль <span class="required">*</span></label>
          <input type="password" id="input-staff-pass" name="password" class="form-control" placeholder="" required autocomplete="current-password">
        </div>

        <div id="auth-staff-error" class="auth-error-alert" style="display:none; margin-top:var(--space-3);"></div>

        <button type="submit" class="btn btn-primary btn-lg" style="width:100%; margin-top:var(--space-3);">
          Войти как сотрудник ➔
        </button>
      </form>
    `;
  },

  bindEvents(container) {
    // Tab switching
    container.querySelector('#tab-student-btn')?.addEventListener('click', () => {
      this.activeTab = 'student';
      this.render(container);
    });

    container.querySelector('#tab-staff-btn')?.addEventListener('click', () => {
      this.activeTab = 'staff';
      this.render(container);
    });

    // Student Login via Phone/Login + 4-digit PIN
    const formStudent = container.querySelector('#form-student-login');
    formStudent?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = formStudent.querySelector('button[type="submit"]');
      const login = formStudent.querySelector('input[name="login"]').value.trim();
      const pin = formStudent.querySelector('input[name="pin"]').value.trim();
      const errorEl = formStudent.querySelector('#auth-student-error');

      if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset.label = submitBtn.innerHTML; submitBtn.innerHTML = '⏳ Вход...'; }
      const res = await auth.loginStudentWithPin(login, pin);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitBtn.dataset.label || submitBtn.innerHTML; }
      if (!res.success) {
        if (errorEl) {
          if (res.isTeacherPhone) {
            errorEl.innerHTML = `
              <div>${res.message}</div>
              <button type="button" class="btn btn-sm btn-secondary" id="btn-switch-staff-tab" style="margin-top:8px;">
                Перейти к входу для преподавателей ➔
              </button>
            `;
            errorEl.style.display = 'block';

            errorEl.querySelector('#btn-switch-staff-tab')?.addEventListener('click', () => {
              this.activeTab = 'staff';
              this.render(container);
            });
          } else {
            errorEl.textContent = res.message;
            errorEl.style.display = 'block';
          }
        }
        return;
      }

      toast.success(res.message);
      window.location.hash = '#student-cabinet';
    });


    // Staff form login
    const formStaff = container.querySelector('#form-staff-login');
    formStaff?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = formStaff.querySelector('button[type="submit"]');
      const login = formStaff.querySelector('input[name="login"]').value.trim();
      const password = formStaff.querySelector('input[name="password"]').value.trim();
      const errorEl = formStaff.querySelector('#auth-staff-error');

      if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset.label = submitBtn.innerHTML; submitBtn.innerHTML = '⏳ Вход...'; }
      const res = await auth.loginStaff(login, password);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = submitBtn.dataset.label || submitBtn.innerHTML; }
      if (!res.success) {
        if (errorEl) {
          errorEl.textContent = res.message;
          errorEl.style.display = 'block';
        }
        return;
      }

      toast.success(res.message);
      if (res.role === auth.ROLE_ADMIN) {
        window.location.hash = '#dashboard';
      } else {
        window.location.hash = '#teacher-cabinet';
      }
    });
  }
};
