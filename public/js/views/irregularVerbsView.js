/**
 * Irregular Verbs View - Step Up English
 * Displays the 200 most frequent English irregular verbs in a styled 4-column table
 * matching the educational reference chart:
 * [Infinitive (blue) | Past simple (green) | Past participle (rose) | Перевод (white)]
 * Includes instant live search and alphabetical filter.
 */

import { IRREGULAR_VERBS } from '../data/irregularVerbsData.js';

export const IrregularVerbsView = {
  searchQuery: '',
  activeLetter: 'ALL',

  getFilteredVerbs() {
    let list = IRREGULAR_VERBS;

    if (this.activeLetter && this.activeLetter !== 'ALL') {
      const l = this.activeLetter.toLowerCase();
      list = list.filter(v => v.v1.toLowerCase().startsWith(l));
    }

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase().trim();
      list = list.filter(v =>
        v.v1.toLowerCase().includes(q) ||
        v.v2.toLowerCase().includes(q) ||
        v.v3.toLowerCase().includes(q) ||
        v.translation.toLowerCase().includes(q)
      );
    }

    return list;
  },

  getAvailableLetters() {
    const letters = new Set();
    IRREGULAR_VERBS.forEach(v => {
      letters.add(v.v1.charAt(0).toUpperCase());
    });
    return Array.from(letters).sort();
  },

  render(container) {
    const letters = this.getAvailableLetters();
    const filtered = this.getFilteredVerbs();

    container.innerHTML = `
      <div class="irregular-verbs-view-wrapper">
        <!-- Top Header Card -->
        <div class="iv-header-card">
          <div class="iv-header-main">
            <div class="iv-header-icon-box">📝</div>
            <div>
              <h1 class="iv-header-title">Неправильные глаголы (Irregular Verbs)</h1>
              <p class="iv-header-subtitle">200 самых часто используемых глаголов с формами Past Simple, Past Participle и переводом</p>
            </div>
          </div>
          <div class="iv-header-actions">
            <a href="#games" class="btn btn-sm btn-secondary font-semibold" style="display:inline-flex; align-items:center; gap:6px;">
              <span>🎮</span>
              <span>Тренировать в мини-играх</span>
            </a>
          </div>
        </div>

        <!-- Search & Control Bar -->
        <div class="iv-control-card">
          <div class="iv-search-row">
            <div class="iv-search-input-wrapper">
              <span class="iv-search-icon">🔍</span>
              <input
                type="text"
                id="iv-search-input"
                class="form-control iv-search-input"
                placeholder="Поиск по слову, форме или переводу (например: see, saw, видеть, be, break)..."
                value="${this.searchQuery}"
                autocomplete="off"
              />
              ${this.searchQuery ? `<button type="button" class="iv-search-clear" id="btn-iv-clear-search" title="Очистить поиск">✕</button>` : ''}
            </div>
            <div class="iv-count-badge" id="iv-count-badge">
              Найдено: <b>${filtered.length}</b> из 200
            </div>
          </div>

          <!-- Alphabet Filter Bar -->
          <div class="iv-letters-bar" id="iv-letters-bar">
            <button type="button" class="iv-letter-btn ${this.activeLetter === 'ALL' ? 'active' : ''}" data-letter="ALL">
              Все (200)
            </button>
            ${letters.map(l => `
              <button type="button" class="iv-letter-btn ${this.activeLetter === l ? 'active' : ''}" data-letter="${l}">
                ${l}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Main Table Container -->
        <div class="iv-table-card">
          <div class="iv-table-responsive-wrapper">
            <table class="iv-verbs-table">
              <thead>
                <tr>
                  <th class="iv-th-infinitive">Infinitive</th>
                  <th class="iv-th-past-simple">Past simple</th>
                  <th class="iv-th-past-participle">Past participle</th>
                  <th class="iv-th-translation">Перевод</th>
                </tr>
              </thead>
              <tbody id="iv-tbody">
                ${this.renderTableRows(filtered)}
              </tbody>
            </table>
          </div>
          ${filtered.length === 0 ? `
            <div class="iv-empty-state" id="iv-empty-state">
              <div style="font-size:2.5rem; margin-bottom:8px;">🔍</div>
              <div style="font-weight:700; font-size:1.1rem; color:var(--color-text-main); margin-bottom:4px;">
                Глаголы не найдены
              </div>
              <div class="text-sm text-muted" style="margin-bottom:12px;">
                По запросу «${this.searchQuery}» ничего не найдено. Проверьте правильность написания.
              </div>
              <button type="button" class="btn btn-sm btn-primary" id="btn-iv-reset-all">
                Сбросить поиск и фильтры
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this.bindEvents(container);
  },

  renderTableRows(verbs) {
    if (!verbs || verbs.length === 0) return '';
    return verbs.map((v) => `
      <tr class="iv-row" data-v1="${v.v1}">
        <td class="iv-td-infinitive">
          <span class="iv-verb-word">${v.v1}</span>
        </td>
        <td class="iv-td-past-simple">
          <span>${v.v2}</span>
        </td>
        <td class="iv-td-past-participle">
          <span>${v.v3}</span>
        </td>
        <td class="iv-td-translation">
          <span>${v.translation}</span>
        </td>
      </tr>
    `).join('');
  },

  bindEvents(container) {
    const searchInput = container.querySelector('#iv-search-input');
    const lettersBar = container.querySelector('#iv-letters-bar');
    const clearBtn = container.querySelector('#btn-iv-clear-search');
    const resetBtn = container.querySelector('#btn-iv-reset-all');

    // Live search with real-time DOM update
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      const filtered = this.getFilteredVerbs();
      
      const tbody = container.querySelector('#iv-tbody');
      const countBadge = container.querySelector('#iv-count-badge');
      
      if (tbody) tbody.innerHTML = this.renderTableRows(filtered);
      if (countBadge) countBadge.innerHTML = `Найдено: <b>${filtered.length}</b> из 200`;

      // Toggle clear button
      let existingClear = container.querySelector('#btn-iv-clear-search');
      if (this.searchQuery && !existingClear) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'iv-search-clear';
        btn.id = 'btn-iv-clear-search';
        btn.title = 'Очистить поиск';
        btn.textContent = '✕';
        btn.addEventListener('click', () => {
          this.searchQuery = '';
          searchInput.value = '';
          searchInput.dispatchEvent(new Event('input'));
          searchInput.focus();
        });
        searchInput.parentNode.appendChild(btn);
      } else if (!this.searchQuery && existingClear) {
        existingClear.remove();
      }

      // Handle empty state visibility
      let emptyState = container.querySelector('#iv-empty-state');
      if (filtered.length === 0) {
        if (!emptyState) {
          const tableCard = container.querySelector('.iv-table-card');
          const div = document.createElement('div');
          div.className = 'iv-empty-state';
          div.id = 'iv-empty-state';
          div.innerHTML = `
            <div style="font-size:2.5rem; margin-bottom:8px;">🔍</div>
            <div style="font-weight:700; font-size:1.1rem; color:var(--color-text-main); margin-bottom:4px;">
              Глаголы не найдены
            </div>
            <div class="text-sm text-muted" style="margin-bottom:12px;">
              По данному запросу ничего не найдено.
            </div>
            <button type="button" class="btn btn-sm btn-primary" id="btn-iv-reset-empty">
              Сбросить поиск и фильтры
            </button>
          `;
          tableCard?.appendChild(div);
          div.querySelector('#btn-iv-reset-empty')?.addEventListener('click', () => {
            this.searchQuery = '';
            this.activeLetter = 'ALL';
            this.render(container);
          });
        }
      } else if (emptyState) {
        emptyState.remove();
      }
    });

    clearBtn?.addEventListener('click', () => {
      this.searchQuery = '';
      if (searchInput) searchInput.value = '';
      searchInput?.dispatchEvent(new Event('input'));
      searchInput?.focus();
    });

    resetBtn?.addEventListener('click', () => {
      this.searchQuery = '';
      this.activeLetter = 'ALL';
      if (searchInput) searchInput.value = '';
      lettersBar?.querySelectorAll('.iv-letter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.letter === 'ALL');
      });
      const filtered = this.getFilteredVerbs();
      const tbody = container.querySelector('#iv-tbody');
      const countBadge = container.querySelector('#iv-count-badge');
      if (tbody) tbody.innerHTML = this.renderTableRows(filtered);
      if (countBadge) countBadge.innerHTML = `Найдено: <b>${filtered.length}</b> из 200`;
    });

    // Alphabet letter click with in-place DOM update (preserves scroll & input state)
    lettersBar?.addEventListener('click', (e) => {
      const btn = e.target.closest('.iv-letter-btn');
      if (!btn) return;
      const letter = btn.dataset.letter;
      if (letter === this.activeLetter) return;
      this.activeLetter = letter;

      lettersBar.querySelectorAll('.iv-letter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.letter === letter);
      });

      const filtered = this.getFilteredVerbs();
      const tbody = container.querySelector('#iv-tbody');
      const countBadge = container.querySelector('#iv-count-badge');
      if (tbody) tbody.innerHTML = this.renderTableRows(filtered);
      if (countBadge) countBadge.innerHTML = `Найдено: <b>${filtered.length}</b> из 200`;
    });
  }
};
