// POST /e: where the snippet on each website reports page views and actions.
//
// Nothing here can identify a person. The visitor id is a hash of (today's random salt + site +
// IP address + browser), cut short; the IP address itself is never stored, and the salt is thrown
// away after a few days, so ids cannot be linked across days or turned back into an address.

import { classify } from './channels.js';
import { getSite, hostRole } from './sites.js';
import { isBot, isDataCentre, parseUA } from './ua.js';
import { localParts, makeLimiter, randomHex, readLimited, retry, sha256Hex, text } from './util.js';

const SESSION_GAP = 30 * 60; // seconds of silence that end a visit
const MAX_ENGAGED = 30 * 60 * 1000; // per page view
const MAX_HITS_PER_SESSION = 500;
const ACCEPTED = () => new Response(null, { status: 202, headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });

// One address may send this many reports a minute to one site, and start this many visits an
// hour. Real visitors, even a classroom behind one connection, stay far below both; a script
// trying to fill the database or fake a crowd does not. Reports over the limit are dropped before
// anything is written.
const reportsPerMinute = makeLimiter(120, 60_000);
const visitsPerHour = makeLimiter(40, 3_600_000);

const salts = new Map();

async function saltFor(env, day) {
  let salt = salts.get(day);
  if (salt) return salt;
  const fresh = randomHex(16);
  const rows = await retry(() => env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, fresh),
    env.DB.prepare('SELECT salt FROM salts WHERE day = ?').bind(day),
  ]));
  salt = rows[1].results[0].salt;
  salts.set(day, salt);
  if (salts.size > 4) salts.delete(salts.keys().next().value);
  return salt;
}

function drop(env, ctx, site, day, reason) {
  ctx.waitUntil(
    env.DB.prepare('INSERT INTO drops (site, day, reason, n) VALUES (?, ?, ?, 1) ON CONFLICT (site, day, reason) DO UPDATE SET n = n + 1')
      .bind(site.id, day, reason)
      .run()
      .catch(() => {}),
  );
  return ACCEPTED();
}

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function cleanPath(url, role) {
  let path = url.pathname.replace(/\/{2,}/g, '/').replace(/\/index\.html?$/i, '/');
  try {
    path = decodeURI(path);
  } catch {
    /* keep it as it came */
  }
  path = text(path, 300) || '/';
  // Pages on a booking/checkout portal are kept apart from the site's own pages.
  return role === 'portal' ? url.hostname.toLowerCase().replace(/^www\./, '') + path : path;
}

function cleanProps(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = Object.create(null);
  let n = 0;
  for (const [key, value] of Object.entries(input)) {
    const k = String(key).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24);
    if (!k || n >= 10) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[k] = Math.round(value * 100) / 100;
    else if (typeof value === 'boolean') out[k] = value;
    else {
      const v = text(String(value ?? ''), 200);
      if (v === null) continue;
      out[k] = v;
    }
    n++;
  }
  return n ? JSON.stringify(out) : null;
}

function attribution(site, url, referrer) {
  const q = url.searchParams;
  const utm = {
    source: text(q.get('utm_source'), 80),
    medium: text(q.get('utm_medium'), 80),
    campaign: text(q.get('utm_campaign'), 120),
    content: text(q.get('utm_content'), 120),
    term: text(q.get('utm_term'), 120),
    id: text(q.get('utm_id'), 60),
  };
  const click = {
    google: q.has('gclid') || q.has('gbraid') || q.has('wbraid'),
    meta: q.has('fbclid'),
    microsoft: q.has('msclkid'),
    tiktok: q.has('ttclid'),
  };
  // A click from one of the site's own pages (or its portal) is not a new source of traffic.
  let refHost = referrer ? hostOf(referrer) : null;
  if (refHost && hostRole(site, refHost, safePath(referrer))) refHost = null;
  if (refHost) refHost = refHost.replace(/^www\./, '');
  const tagged = !!(utm.source || utm.medium || utm.campaign || click.google || click.meta || click.microsoft || click.tiktok);
  return { utm, refHost, tagged, ...classify({ refHost, utm, click }) };
}

function safePath(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return '/';
  }
}

export async function collect(request, env, ctx) {
  let body;
  try {
    const raw = await readLimited(request, 4096);
    if (raw === null) return ACCEPTED();
    body = JSON.parse(raw);
  } catch {
    return ACCEPTED();
  }
  if (!body || typeof body !== 'object') return ACCEPTED();

  const site = await getSite(env, body.s);
  if (!site) return ACCEPTED();

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '';
  const sender = `${site.id}|${ip}`;
  if (!reportsPerMinute(sender)) return ACCEPTED();
  // The same limit kept by Cloudflare across all instances, if the binding is set up (wrangler.jsonc).
  if (env.LIMITER && !(await env.LIMITER.limit({ key: sender }).catch(() => ({ success: true }))).success) return ACCEPTED();

  const now = Date.now();
  const { day, hour } = localParts(now, site.timezone);
  const ua = request.headers.get('user-agent') || '';
  if (isBot(ua)) return drop(env, ctx, site, day, 'bot');
  if (body.b && env.ALLOW_AUTOMATION !== '1') return drop(env, ctx, site, day, 'automation');

  let url;
  try {
    url = new URL(body.u);
  } catch {
    return ACCEPTED();
  }
  const role = hostRole(site, url.hostname, url.pathname);
  if (!role) return drop(env, ctx, site, day, 'other-website');
  // Browsers say which page sent the report; if that is some other website, ignore it.
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') {
    const originHost = hostOf(origin);
    if (!originHost || !(hostRole(site, originHost, url.pathname) || hostRole(site, originHost))) return drop(env, ctx, site, day, 'other-website');
  }
  const cf = request.cf || {};
  if (site.filter_dc && isDataCentre(cf.asn)) return drop(env, ctx, site, day, 'data-centre');

  let visitor = (await sha256Hex(`${await saltFor(env, day)}|${site.id}|${ip}|${ua}`)).slice(0, 20);
  const ts = Math.floor(now / 1000);
  const path = cleanPath(url, role);
  const kind = body.n === 'pageview' ? 'pageview' : body.n === 'engage' ? 'engage' : 'event';
  const pid = typeof body.p === 'string' && /^[a-z0-9]{6,24}$/.test(body.p) ? body.p : null;

  // ---- time on page and scroll depth for a page view already recorded
  if (kind === 'engage') {
    if (!pid) return ACCEPTED();
    const hit = await retry(() => env.DB.prepare('SELECT session, engaged_ms FROM hits WHERE id = ? AND site = ?').bind(pid, site.id).first());
    if (!hit) return ACCEPTED();
    const engaged = Math.max(0, Math.min(MAX_ENGAGED, Number(body.e) || 0));
    const scroll = Math.max(0, Math.min(100, Math.round(Number(body.d) || 0)));
    // Reports carry running totals, so a late or repeated one can never lower or double anything.
    await retry(() => env.DB.batch([
      env.DB.prepare('UPDATE sessions SET engaged_ms = engaged_ms + MAX(0, ?1 - (SELECT engaged_ms FROM hits WHERE id = ?2)), last_seen = MAX(last_seen, ?3) WHERE id = ?4').bind(engaged, pid, ts, hit.session),
      env.DB.prepare('UPDATE hits SET engaged_ms = MAX(engaged_ms, ?), scroll = MAX(scroll, ?) WHERE id = ?').bind(engaged, scroll, pid),
    ]));
    return ACCEPTED();
  }

  let name = null;
  let props = null;
  if (kind === 'event') {
    name = text(body.n, 80);
    if (!name) return ACCEPTED();
    props = cleanProps(body.m);
  }

  // ---- which visit does this belong to?
  const attr = attribution(site, url, typeof body.r === 'string' ? body.r : '');
  let session = null;
  if (kind === 'event' && pid) {
    // An action names the page view it happened on, which pins it to that visit exactly.
    session = await retry(() => env.DB.prepare(
      'SELECT s.id, s.visitor, s.pageviews, s.events, s.source, s.utm_campaign FROM hits h JOIN sessions s ON s.id = h.session WHERE h.id = ? AND h.site = ?',
    ).bind(pid, site.id).first());
    // File the action under the visit's own visitor id. (Just after midnight today's id differs
    // from the visit's; storing both side by side would link the two days.)
    if (session) visitor = session.visitor;
  }
  if (!session) {
    session = await retry(() => env.DB.prepare(
      'SELECT id, pageviews, events, source, utm_campaign FROM sessions WHERE site = ? AND visitor = ? AND last_seen > ? ORDER BY last_seen DESC LIMIT 1',
    ).bind(site.id, visitor, ts - SESSION_GAP).first());
  }
  // Arriving again from a different ad or website starts a new visit, so each source gets its due.
  if (session && kind === 'pageview' && (attr.tagged || attr.refHost) && (attr.source !== session.source || (attr.utm.campaign || null) !== (session.utm_campaign || null))) {
    session = null;
  }
  if (session && session.pageviews + session.events >= MAX_HITS_PER_SESSION) return drop(env, ctx, site, day, 'flood');

  const isKey = kind === 'event' && site.keySet.has(name) ? 1 : 0;
  const hitId = kind === 'pageview' && pid ? pid : randomHex(8);
  // The hit is written first and the visit counts it only if it was new (changes() is 1 then, 0
  // for a repeat), so a report that arrives twice, or a write that is retried, is counted once.
  const hit = (sessionId) =>
    env.DB.prepare('INSERT OR IGNORE INTO hits (id, site, session, visitor, ts, day, kind, name, path, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(hitId, site.id, sessionId, visitor, ts, day, kind, name, path, props);
  const statements = [];

  if (!session) {
    if (!visitsPerHour(sender)) return drop(env, ctx, site, day, 'flood');
    const { os, browser, device } = parseUA(ua, { touch: !!body.t });
    const id = randomHex(8);
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO sessions (id, site, visitor, day, hour, started, last_seen, entry_path, exit_path, pageviews, events, actions,
           referrer, channel, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, country, region, city, device, browser, os)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id, site.id, visitor, day, hour, ts, ts, path, path, kind === 'pageview' ? 1 : 0, kind === 'event' ? 1 : 0, isKey,
        attr.refHost, attr.channel, text(attr.source, 80) || 'Direct', attr.utm.source, attr.utm.medium, attr.utm.campaign, attr.utm.content, attr.utm.term, attr.utm.id,
        cf.country && !/^(XX|T1)$/.test(cf.country) ? cf.country : null, text(cf.region, 80), text(cf.city, 80), device, browser, os,
      ),
      hit(id),
    );
  } else if (kind === 'pageview') {
    statements.push(hit(session.id), env.DB.prepare('UPDATE sessions SET pageviews = pageviews + changes(), exit_path = ?, last_seen = MAX(last_seen, ?) WHERE id = ?').bind(path, ts, session.id));
  } else {
    statements.push(hit(session.id), env.DB.prepare('UPDATE sessions SET events = events + changes(), actions = actions + ? * changes(), last_seen = MAX(last_seen, ?) WHERE id = ?').bind(isKey, ts, session.id));
  }
  await retry(() => env.DB.batch(statements));
  return ACCEPTED();
}
