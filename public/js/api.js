/**
 * HTTP client for the Step Up English backend (/api/*) and the connection status indicator.
 */

let status = 'connecting'; // 'connecting' | 'connected' | 'saving' | 'error' | 'offline'
let statusError = null;
const statusListeners = [];
const unauthorizedListeners = [];

export function onCloudStatusChange(listener) {
  statusListeners.push(listener);
  try { listener(status, statusError); } catch (e) { /* ignore */ }
  return () => {
    const i = statusListeners.indexOf(listener);
    if (i !== -1) statusListeners.splice(i, 1);
  };
}

export function setStatus(next, err = null) {
  status = next;
  statusError = err ? (typeof err === 'string' ? err : (err.message || String(err))) : (next === 'connected' ? null : statusError);
  statusListeners.forEach(fn => { try { fn(status, statusError); } catch (e) { /* ignore */ } });
}

export function getCloudStatus() {
  return status;
}

export function onUnauthorized(listener) {
  unauthorizedListeners.push(listener);
}

export class ApiError extends Error {
  constructor(status, data) {
    super((data && data.error) || `Ошибка сервера (${status})`);
    this.status = status;
    this.data = data || {};
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * JSON request to the backend.
 * timeoutMs: a request that hangs (weak Wi-Fi) is cut off and reported as a network error so it can be retried.
 * keepalive: the browser finishes sending the request even if the page is being closed (body must be < 64 KB).
 */
export async function apiRequest(path, { method = 'POST', body, signal, timeoutMs = DEFAULT_TIMEOUT_MS, keepalive = false } = {}) {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller && timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  if (signal && controller) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: payload !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: payload,
      cache: 'no-store',
      keepalive: Boolean(keepalive && payload && payload.length < 60000),
      signal: controller ? controller.signal : signal
    });
  } catch (networkErr) {
    clearTimeout(timer);
    const timedOut = controller && controller.signal.aborted && !(signal && signal.aborted);
    const err = new ApiError(0, { error: timedOut ? 'Сервер долго не отвечает' : 'Нет соединения с сервером' });
    err.network = true;
    err.timeout = Boolean(timedOut);
    throw err;
  }
  clearTimeout(timer);
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'session_invalid') {
      unauthorizedListeners.forEach(fn => { try { fn(data); } catch (e) { /* ignore */ } });
    }
    throw new ApiError(res.status, data);
  }
  return data;
}

let configPromise = null;
export function getServerConfig() {
  if (!configPromise) {
    configPromise = apiRequest('/api/config', { method: 'GET' }).catch(err => {
      configPromise = null;
      throw err;
    });
  }
  return configPromise;
}
