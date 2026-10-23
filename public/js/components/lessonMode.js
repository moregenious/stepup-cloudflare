/**
 * "Lesson mode" for the teacher cabinet: the whole group on one screen, one row per student.
 *  - attendance: ✓ / ✕ per student, saved immediately for today's lesson date
 *  - points: quick buttons in the row, group buttons for everyone except absent students
 *  - payments: switch the rows to payment buttons
 *  - undo of the last award, attendance journal of the group
 */
import { store } from '../store.js';
import { toast } from './toast.js';
import { modal } from './modal.js';
import { SCORING_TEMPLATES } from '../views/scoringView.js';

const QUICK = [
  { short: '+10', label: 'Хороший ответ', points: 10, category: 'Активность', icon: '👍' },
  { short: '+15', label: 'Хорошая работа на уроке', points: 15, category: 'Активность', icon: '⭐' },
  { short: '+20 ДЗ', label: 'Домашнее задание', points: 20, category: 'Домашнее задание', icon: '📝' }
];

const ui = { mode: 'points', lastAction: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function todayPointsBy(studentId) {
  const today = store.todayDateStr();
  return store.getPointRecords(studentId)
    .filter(r => r.category !== 'Мини-игры' && r.date && store.todayDateStr(new Date(r.date)) === today)
    .reduce((sum, r) => sum + (Number(r.points) || 0), 0);
}

export function renderLessonModeHtml(ctx) {
  const { group, lesson, students, currMonth } = ctx;
  if (!group) return '';
  const marks = lesson ? store.getLessonAttendance(lesson.id, store.todayDateStr()) : {};
  const present = students.filter(s => marks[s.id] === 'present').length;
  const absent = students.filter(s => marks[s.id] === 'absent').length;
  const unmarked = students.length - present - absent;
  const dateLabel = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  const rows = students.map(st => {
    const mark = marks[st.id];
    const isAbsent = mark === 'absent';
    const today = todayPointsBy(st.id);
    const payment = store.getPayment(st.id, currMonth.key);
    const isPaid = payment && payment.status === 'paid';
    let actions;
    if (ui.mode === 'payments') {
      actions = isPaid
        ? `<button type="button" class="lm-pay paid" data-sid="${st.id}" data-action="unpaid" title="Нажмите, чтобы отменить отметку">✓ Оплачено</button>`
        : `<button type="button" class="lm-pay" data-sid="${st.id}" data-action="paid" title="Отметить оплату за ${esc(currMonth.name)}">💳 Принять оплату</button>`;
    } else if (isAbsent) {
      actions = `<span class="lm-absent-note">отсутствует</span><button type="button" class="lm-pt lm-more" data-sid="${st.id}" title="Все категории и свои баллы">…</button>`;
    } else {
      actions = QUICK.map((q, i) => `<button type="button" class="lm-pt" data-sid="${st.id}" data-q="${i}" title="${esc(q.label)}">${q.short}</button>`).join('')
        + `<button type="button" class="lm-pt lm-more" data-sid="${st.id}" title="Все категории, списание, свои баллы">…</button>`;
    }
    return `
      <div class="lm-row ${isAbsent ? 'is-absent' : ''}" data-sid="${st.id}">
        <div class="lm-att" role="group" aria-label="Посещаемость">
          <button type="button" class="lm-att-btn present ${mark === 'present' ? 'on' : ''}" data-sid="${st.id}" data-st="present" ${lesson ? '' : 'disabled'} title="Присутствует">✓</button>
          <button type="button" class="lm-att-btn absent ${isAbsent ? 'on' : ''}" data-sid="${st.id}" data-st="absent" ${lesson ? '' : 'disabled'} title="Отсутствует">✕</button>
        </div>
        <div class="lm-name">
          <div class="lm-fullname">${esc(st.fullName)}</div>
          <div class="lm-sub">${st.totalPoints || 0} ⭐${today ? ` · <span class="${today > 0 ? 'lm-plus' : 'lm-minus'}">сегодня ${today > 0 ? '+' : ''}${today}</span>` : ''}${ui.mode !== 'payments' && !isPaid ? ' · <span class="lm-unpaid" title="Не оплачено за текущий месяц">💳</span>' : ''}</div>
        </div>
        <div class="lm-actions">${actions}</div>
      </div>`;
  }).join('');

  const groupPills = SCORING_TEMPLATES.add.filter(t => !t.excludeFromRating).slice(0, 5)
    .map((t, i) => `<button type="button" class="lm-group-pill" data-gi="${i}" title="${esc(t.label)}: всем, кроме отсутствующих">${t.icon} ${esc(t.label)} <b>+${t.points}</b></button>`).join('');

  return `
    <div class="lesson-mode">
      <div class="lm-head">
        <div>
          <div class="lm-title">👥 Урок: ${esc(group.name)} · ${dateLabel}${lesson && lesson.time ? ` · ${esc(lesson.time)}` : ''}</div>
          <div class="lm-counters">
            ${lesson ? `<span class="lm-c ok">✓ ${present}</span><span class="lm-c no">✕ ${absent}</span>${unmarked ? `<span class="lm-c wait">не отмечены: ${unmarked}</span>` : '<span class="lm-c ok">все отмечены</span>'}`
              : '<span class="lm-c wait">У группы нет урока в расписании — посещаемость недоступна</span>'}
          </div>
        </div>
        <div class="lm-head-actions">
          ${lesson && unmarked ? '<button type="button" class="btn btn-xs btn-outline-success lm-mark-rest">✓ Остальные присутствуют</button>' : ''}
          <button type="button" class="btn btn-xs btn-ghost lm-journal">📋 Журнал посещаемости</button>
        </div>
      </div>

      <div class="lm-tabs">
        <button type="button" class="lm-tab ${ui.mode === 'points' ? 'on' : ''}" data-mode="points">⭐ Баллы</button>
        <button type="button" class="lm-tab ${ui.mode === 'payments' ? 'on' : ''}" data-mode="payments">💳 Оплата (${esc(currMonth.name)})</button>
      </div>

      ${ui.mode === 'points' ? `
        <div class="lm-group">
          <span class="lm-group-label">Всем, кроме отсутствующих:</span>
          ${groupPills}
          <button type="button" class="lm-group-pill lm-group-more">Ещё / свои…</button>
        </div>
      ` : ''}

      ${ui.lastAction ? `
        <div class="lm-undo">
          <span>Начислено: ${esc(ui.lastAction.text)}</span>
          <button type="button" class="btn btn-xs btn-ghost lm-undo-btn">↩ Отменить</button>
        </div>
      ` : ''}

      <div class="lm-list">${rows || '<div class="text-muted text-xs">В группе нет учеников</div>'}</div>
    </div>`;
}

export function bindLessonMode(root, ctx, { rerender, openStudentModal }) {
  if (!root) return;
  const { group, lesson, students, teacher, currMonth } = ctx;
  const teacherId = teacher ? teacher.id : 'admin';
  const studentName = (sid) => (store.getStudentById(sid) || {}).fullName || '';

  const award = (items, text) => {
    const res = store.awardPointsBatch(items, { includeAbsent: items.length === 1 });
    if (!res.length) {
      toast.warning(res.skippedAbsent && res.skippedAbsent.length ? 'Все выбранные ученики отмечены отсутствующими' : 'Баллы не начислены');
      return;
    }
    ui.lastAction = { ids: res.map(r => r.id), text };
    if (res.skippedAbsent && res.skippedAbsent.length) toast.info(`Отсутствующим не начислено: ${res.skippedAbsent.join(', ')}`);
    rerender();
  };

  root.querySelectorAll('.lm-att-btn').forEach(btn => btn.addEventListener('click', () => {
    if (!lesson) return;
    store.setAttendanceMark(lesson.id, btn.dataset.sid, btn.dataset.st, store.todayDateStr());
    rerender();
  }));

  root.querySelector('.lm-mark-rest')?.addEventListener('click', () => {
    const marks = store.getLessonAttendance(lesson.id, store.todayDateStr());
    const rest = {};
    students.forEach(s => { if (!marks[s.id]) rest[s.id] = 'present'; });
    store.saveLessonAttendance(lesson.id, rest, store.todayDateStr());
    rerender();
  });

  root.querySelectorAll('.lm-tab').forEach(btn => btn.addEventListener('click', () => {
    ui.mode = btn.dataset.mode;
    rerender();
  }));

  root.querySelectorAll('.lm-pt[data-q]').forEach(btn => btn.addEventListener('click', () => {
    const q = QUICK[Number(btn.dataset.q)];
    const sid = btn.dataset.sid;
    award([{ studentId: sid, teacherId, points: q.points, type: 'add', category: q.category, comment: q.label }], `${q.short} «${q.label}» — ${studentName(sid)}`);
  }));

  root.querySelectorAll('.lm-more').forEach(btn => btn.addEventListener('click', () => openStudentModal(btn.dataset.sid)));

  root.querySelectorAll('.lm-group-pill[data-gi]').forEach(btn => btn.addEventListener('click', () => {
    const t = SCORING_TEMPLATES.add.filter(x => !x.excludeFromRating)[Number(btn.dataset.gi)];
    const items = students.map(s => ({ studentId: s.id, teacherId, points: t.points, type: 'add', category: t.category, comment: `${t.label} (группа ${group.name})` }));
    award(items, `+${t.points} «${t.label}» — всей группе`);
  }));

  root.querySelector('.lm-group-more')?.addEventListener('click', () => openGroupAwardModal(ctx, award));

  root.querySelector('.lm-undo-btn')?.addEventListener('click', () => {
    if (!ui.lastAction) return;
    ui.lastAction.ids.forEach(id => store.deletePointRecord(id));
    toast.info('Начисление отменено');
    ui.lastAction = null;
    rerender();
  });

  root.querySelectorAll('.lm-pay').forEach(btn => btn.addEventListener('click', () => {
    const sid = btn.dataset.sid;
    const action = btn.dataset.action;
    if (action === 'unpaid' && !window.confirm(`Отменить отметку оплаты для ${studentName(sid)}?`)) return;
    store.setPaymentStatus(sid, currMonth.key, action, { notes: 'Отметка на уроке (режим урока)' });
    toast.success(action === 'paid' ? `Оплата за ${currMonth.name}: ${studentName(sid)} ✓` : 'Отметка оплаты отменена');
    rerender();
  }));

  root.querySelector('.lm-journal')?.addEventListener('click', () => openAttendanceJournal(group, students));
}

function openGroupAwardModal(ctx, award) {
  const { group, students, teacher } = ctx;
  const teacherId = teacher ? teacher.id : 'admin';
  const pill = (t, type, i) => `<button type="button" class="lm-group-pill ${type === 'deduct' ? 'deduct' : ''}" data-type="${type}" data-i="${i}">${t.icon} ${esc(t.label)} <b>${type === 'deduct' ? '−' : '+'}${t.points}</b></button>`;
  modal.open({
    title: `Баллы группе «${group.name}» (кроме отсутствующих)`,
    bodyHtml: `
      <div class="lm-modal-section">Начислить</div>
      <div class="lm-modal-pills">${SCORING_TEMPLATES.add.map((t, i) => pill(t, 'add', i)).join('')}</div>
      <div class="lm-modal-section">Списать</div>
      <div class="lm-modal-pills">${SCORING_TEMPLATES.deduct.map((t, i) => pill(t, 'deduct', i)).join('')}</div>
      <div class="lm-modal-section">Свои баллы</div>
      <form id="lm-custom-form" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <input type="number" name="points" class="form-control" placeholder="±баллы" style="width:110px;" required>
        <input type="text" name="comment" class="form-control" placeholder="За что (видят родители)" style="flex:1; min-width:160px;" required>
        <button type="submit" class="btn btn-primary btn-sm">Применить</button>
      </form>`,
    footerHtml: `<button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Закрыть</button>`,
    onOpen: () => {
      const run = (items, text) => { modal.close(); award(items, text); };
      document.querySelectorAll('.lm-modal-pills .lm-group-pill').forEach(btn => btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const t = SCORING_TEMPLATES[type][Number(btn.dataset.i)];
        const items = students.map(s => ({ studentId: s.id, teacherId, points: t.points, type, category: t.category, comment: `${t.label} (группа ${group.name})`, excludeFromRating: Boolean(t.excludeFromRating) }));
        run(items, `${type === 'deduct' ? '−' : '+'}${t.points} «${t.label}» — всей группе`);
      }));
      document.getElementById('lm-custom-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const pts = parseInt(fd.get('points'), 10);
        const comment = String(fd.get('comment') || '').trim();
        if (!pts || !comment) return;
        const type = pts < 0 ? 'deduct' : 'add';
        const items = students.map(s => ({ studentId: s.id, teacherId, points: Math.abs(pts), type, category: type === 'deduct' ? 'Другое' : 'Активность', comment }));
        run(items, `${pts > 0 ? '+' : ''}${pts} «${comment}» — всей группе`);
      });
    }
  });
}

/** Table: students × last lesson dates of the group */
export function openAttendanceJournal(group, students) {
  const recs = Object.values(store.state.attendance || {})
    .filter(r => r && r.groupId === group.id && r.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12);
  const dates = recs.map(r => r.date);
  const cell = (m) => m === 'present' ? '<td class="lm-j ok">✓</td>' : m === 'absent' ? '<td class="lm-j no">✕</td>' : '<td class="lm-j">·</td>';
  const body = recs.length ? `
    <div style="overflow-x:auto;">
      <table class="lm-journal-table">
        <thead><tr><th>Ученик</th>${dates.map(d => `<th>${d.slice(8, 10)}.${d.slice(5, 7)}</th>`).join('')}<th>%</th></tr></thead>
        <tbody>
          ${students.map(s => {
            const ms = recs.map(r => r.marks ? r.marks[s.id] : undefined);
            const known = ms.filter(Boolean);
            const pct = known.length ? Math.round(known.filter(m => m === 'present').length / known.length * 100) + '%' : '—';
            return `<tr><td class="lm-j-name">${esc(s.fullName)}</td>${ms.map(cell).join('')}<td class="lm-j-pct">${pct}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="text-xs text-muted" style="margin-top:8px;">Последние ${recs.length} уроков с отметками. ✓ — был, ✕ — не был, · — не отмечен.</div>`
    : '<div class="text-muted">Пока нет отметок посещаемости для этой группы. Отмечайте учеников кнопками ✓ / ✕ в режиме урока.</div>';
  modal.open({
    title: `📋 Журнал посещаемости — ${group.name}`,
    bodyHtml: body,
    footerHtml: `<button type="button" class="btn btn-secondary" onclick="document.getElementById('main-modal').close()">Закрыть</button>`
  });
}
