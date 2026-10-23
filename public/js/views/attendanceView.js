/**
 * Attendance section (teachers and admin): who missed which lessons, by group and month.
 * Data: store.state.attendance — one record per lesson date (see store.saveLessonAttendance).
 */
import { store } from '../store.js';
import { auth } from '../auth.js';
import { toast } from '../components/toast.js';

const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ddmm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const dow = (d) => DOW[new Date(d + 'T12:00:00').getDay()];

export const AttendanceView = {
  groupId: null,
  monthKey: null,

  myGroups() {
    const groups = (store.getGroups() || []).filter(g => g.status !== 'archived');
    if (auth.isTeacher && auth.isTeacher()) {
      const tid = auth.currentTeacherId;
      const mine = groups.filter(g => g.teacherId === tid);
      return mine.length ? mine : groups;
    }
    return groups;
  },

  monthOptions() {
    const keys = new Set(Object.values(store.state.attendance || {}).map(r => r && r.date ? r.date.slice(0, 7) : null).filter(Boolean));
    keys.add(store.todayDateStr().slice(0, 7));
    return [...keys].sort().reverse();
  },

  monthName(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
  },

  recordsFor(groupIds, monthKey) {
    const set = new Set(groupIds);
    return Object.values(store.state.attendance || {})
      .filter(r => r && r.groupId && set.has(r.groupId) && r.date && r.date.startsWith(monthKey))
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  render(container) {
    const groups = this.myGroups();
    const months = this.monthOptions();
    if (!this.monthKey || !months.includes(this.monthKey)) this.monthKey = months[0];
    if (this.groupId !== 'all' && !groups.some(g => g.id === this.groupId)) {
      // Default: the group with the most recent attendance marks
      const ids = new Set(groups.map(g => g.id));
      const latest = Object.values(store.state.attendance || {})
        .filter(r => r && ids.has(r.groupId) && r.date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      this.groupId = latest ? latest.groupId : (groups[0] ? groups[0].id : 'all');
    }

    container.innerHTML = `
      <div class="section-header">
        <div class="section-title-wrap">
          <h1>📅 Посещаемость</h1>
          <p class="text-muted text-sm">Кто и в какие дни пропустил уроки. Отметки ставятся в кабинете учителя кнопками ✓ / ✕; здесь их можно поправить нажатием на ячейку.</p>
        </div>
      </div>
      <div class="card" style="padding: var(--space-4); margin-bottom: var(--space-4); display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">
        <div class="form-group" style="margin:0; min-width:200px; flex:1;">
          <label class="form-label">Группа</label>
          <select id="att-group" class="form-control">
            <option value="all" ${this.groupId === 'all' ? 'selected' : ''}>Все группы (сводка)</option>
            ${groups.map(g => `<option value="${g.id}" ${this.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0; min-width:180px;">
          <label class="form-label">Месяц</label>
          <select id="att-month" class="form-control">
            ${months.map(k => `<option value="${k}" ${k === this.monthKey ? 'selected' : ''}>${this.monthName(k)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="att-body">${this.groupId === 'all' ? this.renderSummary(groups) : this.renderGroup(groups.find(g => g.id === this.groupId))}</div>
    `;

    container.querySelector('#att-group')?.addEventListener('change', (e) => { this.groupId = e.target.value; this.render(container); });
    container.querySelector('#att-month')?.addEventListener('change', (e) => { this.monthKey = e.target.value; this.render(container); });
    container.querySelectorAll('.att-cell[data-key]').forEach(td => td.addEventListener('click', () => {
      const rec = (store.state.attendance || {})[td.dataset.key];
      if (!rec) return;
      const sid = td.dataset.sid;
      const next = rec.marks && rec.marks[sid] === 'present' ? 'absent' : 'present';
      rec.marks = { ...(rec.marks || {}), [sid]: next };
      rec.updatedAt = new Date().toISOString();
      store.saveState(true);
      toast.info(`${ddmm(rec.date)}: ${next === 'present' ? 'был(а) на уроке' : 'отсутствовал(а)'}`);
      this.render(container);
    }));
    container.querySelectorAll('.att-open-group').forEach(btn => btn.addEventListener('click', () => {
      this.groupId = btn.dataset.gid;
      this.render(container);
    }));
  },

  renderGroup(group) {
    if (!group) return '<div class="card" style="padding:var(--space-5);">Нет групп.</div>';
    const recs = this.recordsFor([group.id], this.monthKey);
    const keyOf = (r) => Object.keys(store.state.attendance).find(k => store.state.attendance[k] === r);
    const current = store.getStudentsByGroupId(group.id);
    const ids = new Set(current.map(s => s.id));
    recs.forEach(r => Object.keys(r.marks || {}).forEach(id => ids.add(id)));
    const students = [...ids].map(id => store.getStudentById(id) || { id, fullName: '(удалённый ученик)' })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));

    if (!recs.length) {
      return `<div class="card text-muted" style="padding:var(--space-5);">За ${this.monthName(this.monthKey).toLowerCase()} отметок посещаемости в группе «${esc(group.name)}» нет.</div>`;
    }
    const keys = recs.map(keyOf);
    const rows = students.map(s => {
      const ms = recs.map(r => r.marks ? r.marks[s.id] : undefined);
      const miss = ms.filter(m => m === 'absent').length;
      const was = ms.filter(m => m === 'present').length;
      const pct = (miss + was) ? Math.round(was / (miss + was) * 100) : null;
      return { s, ms, miss, was, pct };
    });
    const totalMiss = rows.reduce((a, r) => a + r.miss, 0);
    const marked = rows.reduce((a, r) => a + r.miss + r.was, 0);
    const avg = marked ? Math.round((marked - totalMiss) / marked * 100) : 0;

    const absences = [];
    [...recs].reverse().forEach(r => {
      const names = Object.entries(r.marks || {}).filter(([, m]) => m === 'absent').map(([id]) => (store.getStudentById(id) || {}).fullName || id);
      if (names.length) absences.push(`<li><strong>${ddmm(r.date)} (${dow(r.date)})</strong> — ${names.map(esc).join(', ')}</li>`);
    });

    return `
      <div class="att-stats">
        <div class="att-stat"><div class="att-stat-num">${recs.length}</div><div class="att-stat-label">уроков с отметками</div></div>
        <div class="att-stat"><div class="att-stat-num">${avg}%</div><div class="att-stat-label">средняя посещаемость</div></div>
        <div class="att-stat"><div class="att-stat-num" style="color:#b91c1c;">${totalMiss}</div><div class="att-stat-label">пропусков всего</div></div>
      </div>
      <div class="card" style="padding: var(--space-3); margin-bottom: var(--space-4);">
        <div style="overflow-x:auto;">
          <table class="lm-journal-table att-table">
            <thead><tr><th>Ученик</th>${recs.map(r => `<th>${ddmm(r.date)}<br><span class="att-dow">${dow(r.date)}</span></th>`).join('')}<th>Проп.</th><th>%</th></tr></thead>
            <tbody>
              ${rows.map(({ s, ms, miss, pct }) => `
                <tr>
                  <td class="lm-j-name">${esc(s.fullName)}</td>
                  ${ms.map((m, i) => `<td class="lm-j att-cell ${m === 'present' ? 'ok' : m === 'absent' ? 'no' : ''}" data-key="${keys[i]}" data-sid="${s.id}" title="Нажмите, чтобы изменить">${m === 'present' ? '✓' : m === 'absent' ? '✕' : '·'}</td>`).join('')}
                  <td class="lm-j-pct" style="color:${miss ? '#b91c1c' : 'inherit'};">${miss}</td>
                  <td class="lm-j-pct">${pct === null ? '—' : pct + '%'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="text-xs text-muted" style="margin-top:8px;">✓ — был, ✕ — пропустил, · — не отмечен. Нажмите на ✓ / ✕, чтобы исправить отметку.</div>
      </div>
      <div class="card" style="padding: var(--space-4);">
        <h3 class="card-title" style="margin-bottom:8px;">Пропуски</h3>
        ${absences.length ? `<ul class="att-absences">${absences.join('')}</ul>` : '<div class="text-muted text-sm">В этом месяце пропусков нет 🎉</div>'}
      </div>`;
  },

  renderSummary(groups) {
    const recsAll = this.recordsFor(groups.map(g => g.id), this.monthKey);
    const byGroup = groups.map(g => {
      const recs = recsAll.filter(r => r.groupId === g.id);
      let miss = 0, was = 0;
      recs.forEach(r => Object.values(r.marks || {}).forEach(m => { if (m === 'absent') miss++; else if (m === 'present') was++; }));
      return { g, lessons: recs.length, miss, pct: (miss + was) ? Math.round(was / (miss + was) * 100) : null };
    });
    const missByStudent = new Map();
    recsAll.forEach(r => Object.entries(r.marks || {}).forEach(([id, m]) => {
      if (m !== 'absent') return;
      if (!missByStudent.has(id)) missByStudent.set(id, []);
      missByStudent.get(id).push(r.date);
    }));
    const top = [...missByStudent.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15);
    return `
      <div class="card" style="padding: var(--space-3); margin-bottom: var(--space-4); overflow-x:auto;">
        <table class="lm-journal-table att-table">
          <thead><tr><th>Группа</th><th>Уроков</th><th>Пропусков</th><th>Посещаемость</th><th></th></tr></thead>
          <tbody>
            ${byGroup.map(x => `
              <tr>
                <td class="lm-j-name">${esc(x.g.name)}</td>
                <td>${x.lessons}</td>
                <td style="color:${x.miss ? '#b91c1c' : 'inherit'}; font-weight:700;">${x.miss}</td>
                <td>${x.pct === null ? '—' : x.pct + '%'}</td>
                <td><button type="button" class="btn btn-xs btn-ghost att-open-group" data-gid="${x.g.id}">Открыть →</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="card" style="padding: var(--space-4);">
        <h3 class="card-title" style="margin-bottom:8px;">Больше всего пропусков за ${this.monthName(this.monthKey).toLowerCase()}</h3>
        ${top.length ? `<ul class="att-absences">${top.map(([id, dates]) => {
          const st = store.getStudentById(id);
          const grp = st ? store.getGroupById(st.groupId) : null;
          return `<li><strong>${esc(st ? st.fullName : id)}</strong>${grp ? ` (${esc(grp.name)})` : ''} — ${dates.length}: ${dates.sort().map(d => `${ddmm(d)} ${dow(d)}`).join(', ')}</li>`;
        }).join('')}</ul>` : '<div class="text-muted text-sm">Пропусков нет 🎉</div>'}
      </div>`;
  }
};
