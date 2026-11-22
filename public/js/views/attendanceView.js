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

  /** Months of the school year (a month = 8 lessons of the group, see store.getGroupLessonMonths) */
  monthOptions() {
    return store.getAcademicMonthsList().map(m => m.key);
  },

  monthName(key) {
    const m = store.getAcademicMonthsList().find(x => x.key === key);
    if (m) return m.name;
    const [y, mm] = key.split('-').map(Number);
    return new Date(y, mm - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
  },

  /** Lessons of the group in its month of 8 lessons (moved, cancelled and joined lessons included): Map date → lesson id */
  scheduledDates(groupId, monthKey) {
    const month = store.getGroupLessonMonth(groupId, monthKey);
    if (month) return new Map(month.dates.map((d, i) => [d, month.lessonIds[i]]));
    return this.calendarDates(groupId, monthKey);
  },

  /** Fallback for a group without a weekly schedule: the lessons of the calendar month */
  calendarDates(groupId, monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    const monday = new Date(first);
    monday.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const out = new Map();
    for (const d = new Date(monday); d <= last; d.setDate(d.getDate() + 7)) {
      const week = store.getWeekSchedule(new Date(d), { groupId });
      (week.lessons || []).forEach(l => {
        if (!l.date || !l.date.startsWith(monthKey)) return;
        if (l.status === 'cancelled' || l.actualStatus === 'cancelled' || l.isVacationPaused) return;
        if (l.groupId !== groupId && !(l.linkedGroupIds || []).includes(groupId)) return;
        if (!out.has(l.date)) out.set(l.date, l.baseId || l.id);
      });
    }
    return out;
  },

  /** Marks of the groups in the month: the days of each group's month of 8 lessons (calendar month without a schedule) */
  recordsFor(groupIds, monthKey) {
    const ranges = new Map(groupIds.map(id => {
      const m = store.getGroupLessonMonth(id, monthKey);
      return [id, m ? [m.rangeFrom, m.until] : null];
    }));
    return Object.values(store.state.attendance || {})
      .filter(r => {
        if (!r || !r.groupId || !ranges.has(r.groupId) || !r.date) return false;
        const range = ranges.get(r.groupId);
        return range ? r.date >= range[0] && r.date <= range[1] : r.date.startsWith(monthKey);
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  render(container) {
    const groups = this.myGroups();
    const months = this.monthOptions();
    if (this.groupId !== 'all' && !groups.some(g => g.id === this.groupId)) {
      // Default: the group with the most recent attendance marks
      const ids = new Set(groups.map(g => g.id));
      const latest = Object.values(store.state.attendance || {})
        .filter(r => r && ids.has(r.groupId) && r.date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      this.groupId = latest ? latest.groupId : (groups[0] ? groups[0].id : 'all');
    }
    // Until a month is chosen by hand: the group's current month of 8 lessons (30.11 is already December for Mon/Thu)
    if (!this.monthChosen || !months.includes(this.monthKey)) {
      const current = this.groupId !== 'all' ? store.getGroupCurrentLessonMonth(this.groupId) : null;
      this.monthKey = (current || store.getCurrentAcademicMonth()).key;
    }
    const groupMonths = this.groupId !== 'all' ? store.getGroupLessonMonths(this.groupId) : [];
    const monthLabel = (k) => {
      const gm = groupMonths.find(m => m.key === k);
      return gm ? `${gm.name} · ${ddmm(gm.dates[0])}–${ddmm(gm.dates[gm.dates.length - 1])}` : this.monthName(k);
    };

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
            ${months.map(k => `<option value="${k}" ${k === this.monthKey ? 'selected' : ''}>${monthLabel(k)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="att-body">${this.groupId === 'all' ? this.renderSummary(groups) : this.renderGroup(groups.find(g => g.id === this.groupId))}</div>
    `;

    container.querySelector('#att-group')?.addEventListener('change', (e) => { this.groupId = e.target.value; this.render(container); });
    container.querySelector('#att-month')?.addEventListener('change', (e) => { this.monthKey = e.target.value; this.monthChosen = true; this.render(container); });
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
    // A lesson of the schedule without marks yet: the first click marks the student present
    container.querySelectorAll('.att-cell[data-lesson]').forEach(td => td.addEventListener('click', () => {
      store.setAttendanceMark(td.dataset.lesson, td.dataset.sid, 'present', td.dataset.date);
      toast.info(`${ddmm(td.dataset.date)}: был(а) на уроке`);
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

    // Columns: every lesson of the month by the schedule (future ones too), plus dates that have marks
    const scheduled = this.scheduledDates(group.id, this.monthKey);
    const today = store.todayDateStr();
    const dates = [...new Set([...scheduled.keys(), ...recs.map(r => r.date)])].sort();
    if (!dates.length) {
      return `<div class="card text-muted" style="padding:var(--space-5);">За ${this.monthName(this.monthKey).toLowerCase()} у группы «${esc(group.name)}» нет уроков в расписании и отметок посещаемости.</div>`;
    }
    const cols = dates.map(date => {
      const rec = recs.find(r => r.date === date) || null;
      return { date, rec, key: rec ? keyOf(rec) : null, lessonId: scheduled.get(date) || rec?.lessonId || null, future: date > today };
    });
    const rows = students.map(s => {
      const ms = cols.map(c => c.rec && c.rec.marks ? c.rec.marks[s.id] : undefined);
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
        <div class="att-stat"><div class="att-stat-num">${recs.length} / ${cols.length}</div><div class="att-stat-label">уроков отмечено / всего в месяце</div></div>
        <div class="att-stat"><div class="att-stat-num">${avg}%</div><div class="att-stat-label">средняя посещаемость</div></div>
        <div class="att-stat"><div class="att-stat-num" style="color:#b91c1c;">${totalMiss}</div><div class="att-stat-label">пропусков всего</div></div>
      </div>
      <div class="card" style="padding: var(--space-3); margin-bottom: var(--space-4);">
        <div style="overflow-x:auto;">
          <table class="lm-journal-table att-table">
            <thead><tr><th>Ученик</th>${cols.map(c => `<th class="${c.future ? 'att-future' : ''}">${ddmm(c.date)}<br><span class="att-dow">${dow(c.date)}</span></th>`).join('')}<th>Проп.</th><th>%</th></tr></thead>
            <tbody>
              ${rows.map(({ s, ms, miss, pct }) => `
                <tr>
                  <td class="lm-j-name">${esc(s.fullName)}</td>
                  ${ms.map((m, i) => {
                    const c = cols[i];
                    if (c.future && !m) return '<td class="lm-j att-future" title="Урок ещё не прошёл"></td>';
                    const target = c.key ? `data-key="${c.key}"` : (c.lessonId ? `data-lesson="${c.lessonId}" data-date="${c.date}"` : '');
                    return `<td class="lm-j att-cell ${m === 'present' ? 'ok' : m === 'absent' ? 'no' : ''}" ${target} data-sid="${s.id}" title="Нажмите, чтобы ${m ? 'изменить' : 'отметить'}">${m === 'present' ? '✓' : m === 'absent' ? '✕' : '·'}</td>`;
                  }).join('')}
                  <td class="lm-j-pct" style="color:${miss ? '#b91c1c' : 'inherit'};">${miss}</td>
                  <td class="lm-j-pct">${pct === null ? '—' : pct + '%'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="text-xs text-muted" style="margin-top:8px;">✓ — был, ✕ — пропустил, · — не отмечен, пустая клетка — урок ещё впереди. Нажмите на клетку, чтобы поставить или исправить отметку.</div>
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
