// Signing in. One owner, one password, no accounts to manage.
//
// Nothing needs configuring: the secret that signs sessions is generated on first use and kept in
// the database, next to the (salted, stretched) password hash.

import { nowSeconds, randomHex, safeEqual, sha256Hex, toHex } from './util.js';

// The __Host- prefix makes browsers refuse a cookie of this name set by any other subdomain.
const COOKIE = '__Host-matside';
const SESSION_DAYS = 180;
// The Workers free plan allows very little CPU per request, and Cloudflare caps PBKDF2 at 100,000
// rounds. Set PBKDF2_ITERATIONS lower if sign-in ever fails with "exceeded CPU time limit".
const DEFAULT_ITERATIONS = 100_000;
const encoder = new TextEncoder();

const metaCache = new Map();

export async function getMeta(env, key, maxAgeMs = 30_000) {
  const hit = metaCache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  const value = row ? row.value : null;
  metaCache.set(key, { value, until: Date.now() + maxAgeMs });
  return value;
}

export async function setMeta(env, key, value) {
  if (value === null) await env.DB.prepare('DELETE FROM meta WHERE key = ?').bind(key).run();
  else await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2').bind(key, value).run();
  metaCache.set(key, { value, until: Date.now() + 30_000 });
}

async function sessionSecret(env) {
  let secret = await getMeta(env, 'session_secret');
  if (!secret) {
    await env.DB.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('session_secret', ?)`).bind(randomHex(32)).run();
    metaCache.delete('session_secret');
    secret = await getMeta(env, 'session_secret');
  }
  return secret;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

async function pbkdf2(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(env, password) {
  const iterations = Math.min(100_000, Math.max(10_000, Number(env.PBKDF2_ITERATIONS) || DEFAULT_ITERATIONS));
  const salt = randomHex(16);
  return `pbkdf2$${iterations}$${salt}$${await pbkdf2(password, salt, iterations)}`;
}

async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !hash) return false;
  return safeEqual(await pbkdf2(password, salt, Number(iterations)), hash);
}

function cookieHeader(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function issueCookie(env) {
  const expires = nowSeconds() + SESSION_DAYS * 86400;
  return cookieHeader(`${expires}.${await hmac(await sessionSecret(env), String(expires))}`, SESSION_DAYS * 86400);
}

export const clearCookie = () => cookieHeader('', 0);

/** Is this request from the signed-in owner? Returns { ok, refresh } where refresh is a new cookie when the old one is ageing. */
export async function checkSession(request, env) {
  const match = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]{64})`));
  if (!match) return { ok: false };
  const expires = Number(match[1]);
  if (expires < nowSeconds()) return { ok: false };
  if (!safeEqual(await hmac(await sessionSecret(env), match[1]), match[2])) return { ok: false };
  // Keep a phone signed in for as long as it keeps being used.
  const refresh = expires - nowSeconds() < (SESSION_DAYS - 7) * 86400 ? await issueCookie(env) : null;
  return { ok: true, refresh };
}

export async function hasPassword(env) {
  return !!(await getMeta(env, 'password'));
}

/** Does claiming this dashboard need a setup code? (Deploy with --var SETUP_CODE:... to require one.) */
export const needsSetupCode = (env) => typeof env.SETUP_CODE === 'string' && env.SETUP_CODE.length > 0;

/**
 * First-time setup: choose the password. If the dashboard was deployed with a SETUP_CODE, the
 * code must be supplied (as the link .../#setup=CODE); otherwise the first person to open a new
 * dashboard claims it. Either way this works exactly once.
 */
export async function setup(env, { password, code }) {
  if (await getMeta(env, 'password', 0)) return { error: 'This dashboard already has a password.', status: 409 };
  const required = needsSetupCode(env);
  if (required && !safeEqual(await sha256Hex(String(code || '')), await sha256Hex(env.SETUP_CODE))) return { error: 'That setup link is not valid.', status: 403 };
  // A dashboard that already has websites on it is never free for the taking: resetting a lost
  // password always needs a setup code (see the README).
  if (!required && (await env.DB.prepare('SELECT 1 AS used FROM sites LIMIT 1').first())) {
    return { error: 'This dashboard is in use. To reset its password, deploy with a SETUP_CODE and open the setup link.', status: 403 };
  }
  const problem = passwordProblem(password);
  if (problem) return { error: problem, status: 400 };
  await setMeta(env, 'password', await hashPassword(env, password));
  return { cookie: await issueCookie(env) };
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

/** Who is knocking, without keeping their address: a short hash that changes with the session secret. */
async function knocker(request, env) {
  let ip = request.headers.get('cf-connecting-ip') || 'unknown';
  // One home or phone has a whole block of IPv6 addresses; count the block, not each address.
  if (ip.includes(':')) ip = ip.split(':').slice(0, 4).join(':');
  return (await sha256Hex(`${await sessionSecret(env)}|${ip}`)).slice(0, 16);
}

export async function login(request, env, { password }) {
  const who = await knocker(request, env);
  const now = nowSeconds();
  const since = now - 15 * 60;
  // Count the try and check the limit in one step, so a burst of guesses cannot all slip in under
  // it. A try over the limit writes nothing.
  const gate = await env.DB.prepare(
    `INSERT INTO auth_log (ts, who, ok) SELECT ?1, ?2, 0
     WHERE (SELECT COUNT(*) FROM auth_log WHERE who = ?2 AND ts > ?3 AND ok = 0) < 8`,
  ).bind(now, who, since).run();
  if (!gate.meta.changes) return { error: 'Too many tries. Wait 15 minutes and try again.', status: 429 };
  // Wrong guesses arriving from many places at once slow everyone down, but never lock the owner out.
  const everyone = await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_log WHERE ts > ? AND ok = 0').bind(since).first();
  if ((everyone?.n || 0) > 40) await new Promise((done) => setTimeout(done, 2000));

  const stored = await getMeta(env, 'password', 0);
  const ok = !!stored && typeof password === 'string' && password.length <= 200 && (await verifyPassword(password, stored));
  if (!ok) return { error: 'That password is not right.', status: 401 };
  await env.DB.prepare('DELETE FROM auth_log WHERE rowid = ?').bind(gate.meta.last_row_id).run();
  return { cookie: await issueCookie(env) };
}

export async function changePassword(env, { current, password }) {
  const stored = await getMeta(env, 'password', 0);
  if (!(await verifyPassword(String(current || ''), stored))) return { error: 'Your current password is not right.', status: 401 };
  const problem = passwordProblem(password);
  if (problem) return { error: problem, status: 400 };
  await setMeta(env, 'password', await hashPassword(env, password));
  // A new signing secret signs every other device out.
  await setMeta(env, 'session_secret', randomHex(32));
  return { cookie: await issueCookie(env) };
}
