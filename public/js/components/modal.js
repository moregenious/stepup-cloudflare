/**
 * Modal Dialog Controller for English Practice CRM & LMS
 * Utilizes native HTML5 <dialog> element for accessibility and clean backdrop.
 */

export const modal = {
  dialogEl: null,

  init() {
    this.dialogEl = document.getElementById('main-modal');
    if (!this.dialogEl) {
      this.dialogEl = document.createElement('dialog');
      this.dialogEl.id = 'main-modal';
      this.dialogEl.className = 'app-modal';
      document.body.appendChild(this.dialogEl);
    }

    // Track whether mousedown happened genuinely on the backdrop outside the dialog
    let isMouseDownOnBackdrop = false;

    this.dialogEl.addEventListener('mousedown', (e) => {
      // If mousedown was on any child element inside dialog, it's NOT on backdrop
      if (e.target !== this.dialogEl) {
        isMouseDownOnBackdrop = false;
        return;
      }
      const rect = this.dialogEl.getBoundingClientRect();
      const isInDialog =
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width;
      isMouseDownOnBackdrop = !isInDialog;
    });

    // Close ONLY if BOTH mousedown and click (mouseup) started and completed on the backdrop,
    // and the user was NOT selecting text with the mouse.
    this.dialogEl.addEventListener('click', (e) => {
      // If text is currently selected anywhere (e.g. user dragged mouse across inputs), DO NOT close
      const selection = window.getSelection ? window.getSelection().toString() : '';
      if (selection && selection.trim().length > 0) {
        isMouseDownOnBackdrop = false;
        return;
      }

      if (!isMouseDownOnBackdrop) {
        return;
      }
      if (e.target !== this.dialogEl) {
        isMouseDownOnBackdrop = false;
        return;
      }
      const rect = this.dialogEl.getBoundingClientRect();
      const isInDialog =
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width;
      if (!isInDialog) {
        this.close();
      }
      isMouseDownOnBackdrop = false;
    });

    // Reset backdrop tracking flag on global mouseup so aborted drags never leave it true
    window.addEventListener('mouseup', () => {
      setTimeout(() => {
        isMouseDownOnBackdrop = false;
      }, 50);
    });

    // Ensure body scroll is restored on close (including ESC key)
    this.dialogEl.addEventListener('close', () => {
      document.body.style.overflow = '';
      const pv = document.getElementById('vocab-preview-dialog');
      if (pv) {
        if (pv.open) pv.close();
        pv.remove();
      }
      document.getElementById('vocab-preview-modal-overlay')?.remove();
    });
  },

  open({ title = '', bodyHtml = '', footerHtml = '', content = null, onOpen = null, width = null }) {
    if (!this.dialogEl) this.init();

    if (width) {
      this.dialogEl.style.maxWidth = width;
    } else {
      this.dialogEl.style.maxWidth = '';
    }

    if (content) {
      this.dialogEl.innerHTML = content;
    } else {
      this.dialogEl.innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${title}</h3>
          <button type="button" class="btn btn-ghost btn-icon" id="modal-close-btn" aria-label="Закрыть">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="modal-body">
          ${bodyHtml}
        </div>
        ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
      `;
    }

    document.getElementById('modal-close-btn')?.addEventListener('click', () => this.close());

    if (!this.dialogEl.open) {
      document.body.style.overflow = 'hidden';
      this.dialogEl.showModal();
    }

    if (onOpen) {
      setTimeout(onOpen, 20);
    }
  },

  confirm({
    title = 'Подтверждение',
    message = 'Вы уверены?',
    confirmText = 'Подтвердить',
    cancelText = 'Отмена',
    isDanger = true,
    onConfirm = null,
    onCancel = null
  } = {}) {
    if (!this.dialogEl) this.init();

    const confirmContent = `
      <div class="modal-confirm-dialog" style="padding: 28px 24px 20px; text-align: center; max-width: 420px; margin: 0 auto; box-sizing: border-box; position: relative;">
        <button type="button" class="btn btn-ghost btn-icon" id="modal-confirm-btn-close" style="position: absolute; top: 14px; right: 14px; width: 32px; height: 32px; border-radius: 8px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #94a3b8;" aria-label="Закрыть">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <div style="width: 56px; height: 56px; border-radius: 50%; background: ${isDanger ? '#fee2e2' : '#e0f2fe'}; color: ${isDanger ? '#ef4444' : '#0284c7'}; display: inline-flex; align-items: center; justify-content: center; font-size: 26px; margin: 0 auto 14px;">
          ${isDanger ? '🗑️' : 'ℹ️'}
        </div>
        <h3 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin-bottom: 8px;">${title}</h3>
        <p style="font-size: 0.95rem; color: #64748b; margin-bottom: 22px; line-height: 1.5; white-space: pre-line;">${message}</p>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button type="button" id="modal-confirm-btn-cancel" class="btn btn-ghost" style="flex: 1; padding: 11px 16px; border-radius: 12px; font-weight: 600; border: 1px solid #cbd5e1; color: #475569; cursor: pointer;">
            ${cancelText}
          </button>
          <button type="button" id="modal-confirm-btn-ok" class="btn" style="flex: 1; background: ${isDanger ? '#ef4444' : '#0284c7'}; color: #ffffff; padding: 11px 16px; border-radius: 12px; font-weight: 700; border: none; cursor: pointer;">
            ${confirmText}
          </button>
        </div>
      </div>
    `;

    this.open({
      content: confirmContent,
      width: '420px'
    });

    const closeBtn = this.dialogEl.querySelector('#modal-confirm-btn-close');
    const cancelBtn = this.dialogEl.querySelector('#modal-confirm-btn-cancel');
    const okBtn = this.dialogEl.querySelector('#modal-confirm-btn-ok');

    closeBtn?.addEventListener('click', () => {
      this.close();
      if (typeof onCancel === 'function') onCancel();
    });

    cancelBtn?.addEventListener('click', () => {
      this.close();
      if (typeof onCancel === 'function') onCancel();
    });

    okBtn?.addEventListener('click', () => {
      this.close();
      if (typeof onConfirm === 'function') onConfirm();
    });
  },

  close() {
    const pv = document.getElementById('vocab-preview-dialog');
    if (pv) {
      if (pv.open) pv.close();
      pv.remove();
    }
    if (this.dialogEl && this.dialogEl.open) {
      this.dialogEl.close();
      document.body.style.overflow = '';
    }
  }
};
