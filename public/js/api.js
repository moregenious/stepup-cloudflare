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

export async function apiRequest(path, { method = 'POST', body, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal
    });
  } catch (networkErr) {
    const err = new ApiError(0, { error: 'Нет соединения с сервером' });
    err.network = true;
    throw err;
  }
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
