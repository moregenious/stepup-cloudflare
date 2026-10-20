/**
 * System Diagnostics & Application Event Logger for Step Up English
 * Tracks technical events, cloud sync health, auth attempts and runtime errors
 */

const MAX_LOG_ENTRIES = 120;
const STORAGE_LOG_KEY = 'step_up_tech_logs_v1';

class Logger {
  constructor() {
    this.buffer = this.loadPersistedLogs();
    this.setupGlobalErrorHandlers();
  }

  loadPersistedLogs() {
    try {
      const stored = localStorage.getItem(STORAGE_LOG_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed.slice(-MAX_LOG_ENTRIES);
      }
    } catch (e) {}
    return [];
  }

  persistLogs() {
    try {
      localStorage.setItem(STORAGE_LOG_KEY, JSON.stringify(this.buffer.slice(-MAX_LOG_ENTRIES)));
    } catch (e) {}
  }

  _addEntry(level, message, details = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      timeFormatted: new Date().toLocaleTimeString('ru-RU'),
      level, // 'INFO' | 'WARN' | 'ERROR'
      message: String(message || ''),
      details: details ? (typeof details === 'object' ? JSON.stringify(details) : String(details)) : null
    };

    this.buffer.push(entry);
    if (this.buffer.length > MAX_LOG_ENTRIES) {
      this.buffer.shift();
    }
    this.persistLogs();

    // Mirror to standard browser console
    const prefix = `[StepUp:${level}]`;
    if (level === 'ERROR') {
      console.error(prefix, message, details || '');
    } else if (level === 'WARN') {
      console.warn(prefix, message, details || '');
    } else {
      console.log(prefix, message, details || '');
    }

    return entry;
  }

  info(message, details = null) {
    return this._addEntry('INFO', message, details);
  }

  warn(message, details = null) {
    return this._addEntry('WARN', message, details);
  }

  error(message, details = null) {
    return this._addEntry('ERROR', message, details);
  }

  getEntries() {
    return [...this.buffer];
  }

  clear() {
    this.buffer = [];
    try { localStorage.removeItem(STORAGE_LOG_KEY); } catch (e) {}
  }

  setupGlobalErrorHandlers() {
    if (typeof window === 'undefined') return;

    window.addEventListener('error', (event) => {
      this.error('Uncaught JS Error: ' + (event.message || 'Unknown'), {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      this.error('Unhandled Promise Rejection: ' + (reason?.message || String(reason)), reason?.stack || null);
    });
  }

  generateDiagnosticsReport() {
    const now = new Date().toISOString();
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const url = typeof window !== 'undefined' ? window.location.href : '';

    const lines = [
      `=== STEP UP ENGLISH DIAGNOSTICS REPORT ===`,
      `Date: ${now}`,
      `URL: ${url}`,
      `Online: ${isOnline}`,
      `User Agent: ${ua}`,
      `Recent Tech Logs (${this.buffer.length} entries):`,
      '---------------------------------------------------'
    ];

    this.buffer.forEach((e) => {
      lines.push(`[${e.timeFormatted}] [${e.level}] ${e.message}${e.details ? ' | ' + e.details : ''}`);
    });

    lines.push('---------------------------------------------------');
    lines.push('=== END OF REPORT ===');
    return lines.join('\n');
  }

  async copyDiagnosticsToClipboard() {
    const report = this.generateDiagnosticsReport();
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(report);
      return true;
    }
    return false;
  }
}

export const logger = new Logger();
