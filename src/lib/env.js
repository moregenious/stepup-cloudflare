/**
 * Runtime environment holder. In Cloudflare Workers the entry point calls setEnv(env) with
 * vars, secrets and bindings (DB, FILES, ASSETS). In Node (dev server, tools) process.env is used.
 */
let current = (typeof process !== 'undefined' && process.env) ? process.env : {};

export function setEnv(env) {
  current = env || {};
}

export function getEnv() {
  return current;
}
