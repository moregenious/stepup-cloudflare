/**
 * Light / dark theme. index.html sets <html data-theme> before the first paint;
 * this module wires the header button and follows the device setting until the user picks a theme.
 */

const KEY = 'stepup_theme';

function savedTheme() {
  try { return localStorage.getItem(KEY); } catch (e) { return null; }
}

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function apply(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.title = theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
  }
}

export function initTheme() {
  apply(currentTheme());
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    apply(next);
  });
  // Until a theme is chosen by hand, follow the phone / computer setting
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
    if (!savedTheme()) apply(e.matches ? 'dark' : 'light');
  });
}
