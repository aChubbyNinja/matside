// The list of websites being measured.

import { nowSeconds, text, validTimezone } from './util.js';

const TTL = 30_000; // how long a Worker instance trusts its copy of the list
let cache = null;

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseJson(value, fallback) {
  try {
    const v = JSON.parse(value);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function shape(row) {
  const keyEvents = parseJson(row.key_events, []);
  return {
    ...row,
    hostList: parseList(row.hosts),
    portalList: parseList(row.portals),
    keyEvents: Array.isArray(keyEvents) ? keyEvents : [],
    keySet: new Set(Array.isArray(keyEvents) ? keyEvents : []),
    funnelSteps: parseJson(row.funnel, []),
    integrationConfig: parseJson(row.integrations, {}),
  };
}

export async function listSites(env, fresh = false) {
  if (!fresh && cache && cache.until > Date.now()) return cache.sites;
  const { results } = await env.DB.prepare('SELECT * FROM sites ORDER BY position, created').all();
  cache = { sites: results.map(shape), until: Date.now() + TTL };
  return cache.sites;
}

export async function getSite(env, id, fresh = false) {
  if (typeof id !== 'string' || !id) return null;
  return (await listSites(env, fresh)).find((s) => s.id === id) || null;
}

export const forgetSites = () => {
  cache = null;
};

/** What the dashboard is allowed to see of a site. */
export function publicSite(site) {
  return {
    id: site.id,
    name: site.name,
    domain: site.domain,
    hosts: site.hostList,
    portals: site.portalList,
    timezone: site.timezone,
    color: site.color,
    filter_dc: !!site.filter_dc,
    key_events: site.keyEvents,
    funnel: site.funnelSteps,
    integrations: site.integrationConfig,
    created: site.created,
  };
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/;

export function cleanHost(value) {
  let h = String(value || '').trim().toLowerCase();
  h = h.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  return HOSTNAME.test(h) ? h : null;
}

/** A portal is a hostname with an optional path prefix: "portal.example.com/acme". */
function cleanPortal(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '');
  const [hostPart, ...rest] = raw.split('/');
  const host = cleanHost(hostPart);
  if (!host) return null;
  const path = rest.join('/').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return path ? `${host}/${path}` : host;
}

function slug(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'site';
}

/** Check what Settings sent. Returns { values } or { error }. */
export function validateSite(input, existing = null) {
  const out = {};
  if (input.name !== undefined || !existing) {
    out.name = text(input.name, 60);
    if (!out.name) return { error: 'Give the website a name.' };
  }
  if (input.domain !== undefined || !existing) {
    out.domain = cleanHost(input.domain);
    if (!out.domain) return { error: 'That web address does not look right. Use something like example.com.' };
  }
  if (input.timezone !== undefined || !existing) {
    out.timezone = input.timezone || 'UTC';
    if (!validTimezone(out.timezone)) return { error: 'Unknown time zone.' };
  }
  if (input.hosts !== undefined) {
    const list = (Array.isArray(input.hosts) ? input.hosts : parseList(input.hosts)).map(cleanHost);
    if (list.includes(null)) return { error: 'One of the extra addresses does not look right.' };
    out.hosts = [...new Set(list)].slice(0, 12).join(',');
  }
  if (input.portals !== undefined) {
    const list = (Array.isArray(input.portals) ? input.portals : parseList(input.portals)).map(cleanPortal);
    if (list.includes(null)) return { error: 'One of the portal addresses does not look right.' };
    out.portals = [...new Set(list)].slice(0, 6).join(',');
  }
  if (input.filter_dc !== undefined) out.filter_dc = input.filter_dc ? 1 : 0;
  if (input.key_events !== undefined) {
    if (!Array.isArray(input.key_events)) return { error: 'Key actions must be a list.' };
    out.key_events = JSON.stringify([...new Set(input.key_events.map((s) => text(s, 80)).filter(Boolean))].slice(0, 20));
  }
  if (input.funnel !== undefined) {
    if (!Array.isArray(input.funnel)) return { error: 'Journey steps must be a list.' };
    const steps = [];
    for (const step of input.funnel.slice(0, 6)) {
      const type = step?.type === 'event' ? 'event' : 'page';
      const match = text(step?.match, 200);
      const label = text(step?.label, 60) || match;
      if (!match) return { error: 'Every journey step needs a page or an action.' };
      steps.push({ label, type, match });
    }
    out.funnel = JSON.stringify(steps);
  }
  if (input.integrations !== undefined) {
    const cfg = {};
    const i = input.integrations || {};
    if (i.iclasspro?.account) {
      const account = String(i.iclasspro.account).trim();
      if (!/^[A-Za-z0-9_-]{2,40}$/.test(account)) return { error: 'The iClassPro account name is the short name in your portal address.' };
      cfg.iclasspro = { account };
    }
    if (i.meta?.ad_account) {
      const adAccount = String(i.meta.ad_account).trim().replace(/^act_/, '');
      if (!/^\d{5,20}$/.test(adAccount)) return { error: 'The Meta ad account ID is a number (you can find it in Ads Manager).' };
      cfg.meta = { ad_account: adAccount };
    }
    out.integrations = JSON.stringify(cfg);
  }
  return { values: out };
}

export async function createSite(env, input) {
  const { values, error } = validateSite(input);
  if (error) return { error };
  const sites = await listSites(env, true);
  if (sites.length >= 50) return { error: 'This dashboard is limited to 50 websites.' };
  if (sites.some((s) => s.domain === values.domain)) return { error: 'That website is already on your dashboard.' };
  let id = slug(input.id || values.name);
  for (let n = 2; sites.some((s) => s.id === id); n++) id = `${slug(input.id || values.name).slice(0, 28)}-${n}`;
  // Colours follow the site, never its position: take the first slot nobody is using.
  const used = new Set(sites.map((s) => s.color));
  let color = 1;
  while (used.has(color) && color < 8) color++;
  await env.DB.prepare(
    `INSERT INTO sites (id, name, domain, hosts, portals, timezone, color, filter_dc, key_events, funnel, integrations, position, created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, values.name, values.domain, values.hosts || '', values.portals || '', values.timezone, color, values.filter_dc ?? 1,
      values.key_events || '[]', values.funnel || '[]', values.integrations || '{}', sites.length, nowSeconds())
    .run();
  forgetSites();
  return { site: await getSite(env, id, true) };
}

export async function updateSite(env, site, input) {
  const { values, error } = validateSite(input, site);
  if (error) return { error };
  const keys = Object.keys(values);
  if (keys.length) {
    await env.DB.prepare(`UPDATE sites SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .bind(...keys.map((k) => values[k]), site.id)
      .run();
    forgetSites();
  }
  return { site: await getSite(env, site.id, true), changed: keys };
}

export async function deleteSite(env, site) {
  const tables = ['hits', 'sessions', 'rollup', 'drops', 'classes', 'class_changes', 'ad_stats', 'secrets', 'sync_log'];
  await env.DB.batch([
    ...tables.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE site = ?`).bind(site.id)),
    env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(site.id),
  ]);
  forgetSites();
}

/**
 * Which of a site's addresses a hostname + path belongs to.
 * @returns {'site' | 'portal' | null}
 */
export function hostRole(site, host, path = '/') {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (h === site.domain || site.hostList.includes(h)) return 'site';
  for (const p of site.portalList) {
    const i = p.indexOf('/');
    const pHost = i === -1 ? p : p.slice(0, i);
    const pPath = i === -1 ? '' : p.slice(i);
    if (h === pHost && (!pPath || path.toLowerCase() === pPath || path.toLowerCase().startsWith(pPath + '/'))) return 'portal';
  }
  return null;
}
