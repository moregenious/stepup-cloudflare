/**
 * Payment reminder for students (and the parents who look at their account): a slim strip at the top of the
 * student's pages, a dot on "Кабинет" in the menu and a line in the result window of a mini-game.
 * The more often the child sees it, the sooner it reaches the parents. It never covers a game:
 * the strip is not shown inside a running game, and ✕ hides it until the next visit.
 *
 * Levels: 'debt' — the previous month is not paid (red); 'late' — the current month is not paid after the 10th
 * (orange); 'soft' — the current month is not paid yet, 1st–10th (calm yellow).
 */
import { store } from '../store.js';
import { auth } from '../auth.js';

const SOFT_UNTIL_DAY = 10;
const lower = (m) => String(m?.shortName || m?.name || '').toLowerCase();

function studentId() {
  return auth.isStudent() ? (auth.currentStudentId || auth.getCurrentUser()?.id || null) : null;
}

/** null when nothing is due; otherwise { level, current, debt } */
export function paymentReminderState(now = new Date()) {
  const sid = studentId();
  if (!sid || !store.getStudentById(sid)) return null;
  const due = store.getStudentPaymentDue(sid);
  if (!due.debtMonth && !due.currentUnpaid) return null;
  const level = due.debtMonth ? 'debt' : now.getDate() > SOFT_UNTIL_DAY ? 'late' : 'soft';
  return { level, current: due.currentUnpaid ? due.currentMonth : null, debt: due.debtMonth };
}

function message(state) {
  if (state.level === 'debt') {
    return {
      icon: '⚠️',
      title: `Не оплачено обучение за ${lower(state.debt)}${state.current ? ` и ${lower(state.current)}` : ''}`,
      text: 'Пожалуйста, передай родителям: нужно оплатить как можно скорее.'
    };
  }
  if (state.level === 'late') {
    return { icon: '💳', title: `Пора оплатить обучение за ${lower(state.current)}`, text: 'Напомни, пожалуйста, родителям сегодня 🙏' };
  }
  return { icon: '💳', title: `Оплата за ${lower(state.current)} ещё не отмечена`, text: 'Напомни, пожалуйста, родителям 🙂' };
}

const hideKey = (state) => `stepup_pay_hide_${(state.debt || state.current)?.key}_${state.level}`;

/** The strip for the top of a page ('' when nothing is due or it was closed during this visit) */
export function paymentReminderHtml() {
  const state = paymentReminderState();
  if (!state) return '';
  try { if (sessionStorage.getItem(hideKey(state))) return ''; } catch (e) { /* ignore */ }
  const m = message(state);
  return `
    <div class="pay-reminder pay-reminder-${state.level}" role="status">
      <span class="pay-reminder-icon">${m.icon}</span>
      <a href="#student-cabinet" class="pay-reminder-text"><strong>${m.title}</strong><span>${m.text}</span></a>
      <button type="button" class="pay-reminder-close" aria-label="Скрыть до следующего входа" title="Скрыть до следующего входа">✕</button>
    </div>`;
}

/** Put the strip at the top of a page (once) and wire its ✕ */
export function mountPaymentReminder(container) {
  if (!container || container.querySelector('.pay-reminder')) return;
  const html = paymentReminderHtml();
  if (!html) return;
  container.insertAdjacentHTML('afterbegin', html);
  const el = container.querySelector('.pay-reminder');
  el.querySelector('.pay-reminder-close')?.addEventListener('click', () => {
    const state = paymentReminderState();
    try { if (state) sessionStorage.setItem(hideKey(state), '1'); } catch (e) { /* ignore */ }
    el.remove();
  });
}

/** One short line for the result window of a mini-game ('' when nothing is due) */
export function paymentReminderLine() {
  const state = paymentReminderState();
  if (!state) return '';
  const month = state.level === 'debt' ? lower(state.debt) : lower(state.current);
  return `<div class="pay-reminder-line pay-reminder-line-${state.level}">💳 Не забудь напомнить родителям про оплату за ${month}</div>`;
}

/** Red dot for the "Кабинет" item of the menu */
export const paymentDotHtml = () => (paymentReminderState() ? '<span class="pay-dot" title="Не отмечена оплата"></span>' : '');
