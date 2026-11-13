// Every number on the dashboard comes from here.
//
// Each breakdown ("dimension") is defined once, as one SQL SELECT over the raw visits. The same
// SELECT is used three ways:
//   1. to answer today's numbers straight from the raw tables,
//   2. to write the nightly summary rows ("rollup") for finished days,
//   3. to answer a filtered question ("only visits from Google") from the raw tables.
// Unfiltered questions about past days read the summaries, which is why a 12-month view costs
// about as much as a one-day view.

import { forgetSites } from './sites.js';
import { addDays, buckets, localParts, resolveRange } from './util.js';
import { insights } from './insights.js';

const SESSION_MEASURES = `COUNT(DISTINCT s.visitor) AS visitors, COUNT(*) AS visits, SUM(s.pageviews) AS pageviews,
  SUM(CASE WHEN s.pageviews <= 1 AND s.events = 0 THEN 1 ELSE 0 END) AS n1,
  SUM(CASE WHEN s.actions > 0 THEN 1 ELSE 0 END) AS n2,
  SUM(s.actions) AS v1, SUM(s.engaged_ms) AS v2`;

const ROLLUP_KEEP = 250;
const VIDEO_EVENTS = `'Video play', 'Video complete', 'Video watch'`;

// t: 's' reads sessions, 'h' reads hits. k: the thing being counted. For session dimensions the
// columns mean: n1 = visits that bounced, n2 = visits with a key action, v1 = key actions,
// v2 = engaged milliseconds.
export const DIMS = {
  total: { t: 's', k: `''` },
  hour: { t: 's', k: `CAST(s.hour AS TEXT)` },
  channel: { t: 's', k: `s.channel` },
  source: { t: 's', k: `s.source` },
  campaign: { t: 's', k: `s.utm_campaign`, where: `s.utm_campaign IS NOT NULL` },
  country: { t: 's', k: `s.country`, where: `s.country IS NOT NULL` },
  region: { t: 's', k: `s.country || '|' || s.region`, where: `s.country IS NOT NULL AND s.region IS NOT NULL` },
  city: { t: 's', k: `s.country || '|' || COALESCE(s.region, '') || '|' || s.city`, where: `s.country IS NOT NULL AND s.city IS NOT NULL` },
  device: { t: 's', k: `s.device` },
  browser: { t: 's', k: `s.browser` },
  os: { t: 's', k: `s.os` },
  entry: { t: 's', k: `s.entry_path` },
  exit: { t: 's', k: `s.exit_path` },
  // pageviews = views, n1 = views with time recorded, v1 = engaged ms, v2 = summed scroll depth
  page: {
    t: 'h', kind: 'pageview', k: `h.path`,
    m: `COUNT(DISTINCT h.visitor) AS visitors, COUNT(DISTINCT h.session) AS visits, COUNT(*) AS pageviews,
        SUM(CASE WHEN h.engaged_ms > 0 THEN 1 ELSE 0 END) AS n1, 0 AS n2, SUM(h.engaged_ms) AS v1, SUM(h.scroll) AS v2`,
  },
  // n1 = times it happened
  event: {
    t: 'h', kind: 'event', k: `h.name`,
    m: `COUNT(DISTINCT h.visitor) AS visitors, COUNT(DISTINCT h.session) AS visits, 0 AS pageviews, COUNT(*) AS n1, 0 AS n2, 0 AS v1, 0 AS v2`,
  },
  // n1 = plays, n2 = watched to the end, v1 = seconds watched
  video: {
    t: 'h', kind: 'event', k: `json_extract(h.props, '$.video')`,
    where: `h.name IN (${VIDEO_EVENTS}) AND json_extract(h.props, '$.video') IS NOT NULL`,
    m: `COUNT(DISTINCT h.visitor) AS visitors, COUNT(DISTINCT h.session) AS visits, 0 AS pageviews,
        SUM(CASE WHEN h.name = 'Video play' THEN 1 ELSE 0 END) AS n1,
        SUM(CASE WHEN h.name = 'Video complete' THEN 1 ELSE 0 END) AS n2,
        SUM(CASE WHEN h.name = 'Video watch' THEN CAST(json_extract(h.props, '$.seconds') AS REAL) ELSE 0 END) AS v1, 0 AS v2`,
  },
};

// Filters the dashboard can apply by clicking a row.
const FILTERS = {
  channel: `s.channel`,
  source: `s.source`,
  campaign: `s.utm_campaign`,
  country: `s.country`,
  region: `(s.country || '|' || s.region)`,
  city: `(s.country || '|' || COALESCE(s.region, '') || '|' || s.city)`,
  device: `s.device`,
  browser: `s.browser`,
  os: `s.os`,
  entry: `s.entry_path`,
  exit: `s.exit_path`,
};
const HIT_FILTERS = { page: `h.kind = 'pageview' AND h.path = ?`, event: `h.kind = 'event' AND h.name = ?` };

/** "channel:Organic Search;page:/about/" -> [['channel', 'Organic Search'], ['page', '/about/']] */
export function parseFilters(value) {
  const out = [];
  for (const part of String(value || '').split(';')) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    const key = part.slice(0, i);
    const val = part.slice(i + 1);
    if (!(Object.hasOwn(FILTERS, key) || Object.hasOwn(HIT_FILTERS, key)) || out.length >= 6) continue;
    let value = val;
    try {
      value = decodeURIComponent(val); // the dashboard escapes values so they may contain ; and :
    } catch { /* not escaped: use it as it came */ }
    if (value) out.push([key, value.slice(0, 300)]);
  }
  return out;
}

/** SQL (and its values) that narrows sessions "s" to the active filters. */
function filterSql(siteId, a, b, filters) {
  let sql = '';
  const params = [];
  for (const [key, value] of filters) {
    if (Object.hasOwn(FILTERS, key)) {
      sql += ` AND ${FILTERS[key]} = ?`;
      params.push(value);
    } else {
      sql += ` AND s.id IN (SELECT h.session FROM hits h WHERE h.site = ? AND h.day BETWEEN ? AND ? AND ${HIT_FILTERS[key]})`;
      params.push(siteId, a, addDays(b, 1), value);
    }
  }
  return { sql, params };
}

/** One row per (day, key) for a dimension, straight from the raw tables. */
function rawSelect(dim, siteId, a, b, filters = []) {
  const d = DIMS[dim];
  const f = filterSql(siteId, a, b, filters);
  if (d.t === 's') {
    return {
      sql: `SELECT s.day AS day, ${d.k} AS k, ${SESSION_MEASURES} FROM sessions s
            WHERE s.site = ? AND s.day BETWEEN ? AND ?${d.where ? ` AND ${d.where}` : ''}${f.sql} GROUP BY s.day, k`,
      params: [siteId, a, b, ...f.params],
    };
  }
  const narrowed = filters.length
    ? ` AND h.session IN (SELECT s.id FROM sessions s WHERE s.site = ? AND s.day BETWEEN ? AND ?${f.sql})`
    : '';
  return {
    sql: `SELECT h.day AS day, ${d.k} AS k, ${d.m} FROM hits h
          WHERE h.site = ? AND h.kind = '${d.kind}' AND h.day BETWEEN ? AND ?${d.where ? ` AND ${d.where}` : ''}${narrowed} GROUP BY h.day, k`,
    params: [siteId, a, b, ...(filters.length ? [siteId, addDays(a, -1), b, ...f.params] : [])],
  };
}

const COLUMNS = 'visitors, visits, pageviews, n1, n2, v1, v2';
const SUMS = 'SUM(visitors) AS visitors, SUM(visits) AS visits, SUM(pageviews) AS pageviews, SUM(n1) AS n1, SUM(n2) AS n2, SUM(v1) AS v1, SUM(v2) AS v2';

/** Summaries for the days that have them, raw rows for the rest (normally just today). */
function source(site, dim, a, b, filters) {
  if (filters.length) return rawSelect(dim, site.id, a, b, filters);
  const parts = [];
  const params = [];
  const rolled = site.rolled;
  if (rolled && a <= rolled) {
    parts.push(`SELECT day, k, ${COLUMNS} FROM rollup WHERE site = ? AND dim = '${dim}' AND day BETWEEN ? AND ?`);
    params.push(site.id, a, b < rolled ? b : rolled);
  }
  const rawFrom = rolled && rolled >= a ? addDays(rolled, 1) : a;
  if (rawFrom <= b) {
    const raw = rawSelect(dim, site.id, rawFrom, b);
    parts.push(`SELECT day, k, ${COLUMNS} FROM (${raw.sql})`);
    params.push(...raw.params);
  }
  return { sql: parts.join(' UNION ALL '), params };
}

function statement(env, sql, params) {
  return env.DB.prepare(sql).bind(...params);
}

function list(env, site, dim, a, b, filters, order = 'visitors DESC, visits DESC', limit = 12) {
  const src = source(site, dim, a, b, filters);
  return statement(env, `SELECT k, ${SUMS} FROM (${src.sql}) WHERE k IS NOT NULL GROUP BY k ORDER BY ${order} LIMIT ${limit}`, src.params);
}

function totals(env, site, a, b, filters) {
  const src = source(site, 'total', a, b, filters);
  return statement(env, `SELECT ${SUMS} FROM (${src.sql})`, src.params);
}

/** One day's sessions that had started by a given time of day (for a fair "so far today" comparison). */
function totalsUntil(env, site, day, hour, seconds, filters) {
  const f = filterSql(site.id, day, day, filters);
  return statement(
    env,
    `SELECT ${SESSION_MEASURES} FROM sessions s WHERE s.site = ? AND s.day = ? AND (s.hour < ? OR (s.hour = ? AND s.started % 3600 <= ?))${f.sql}`,
    [site.id, day, hour, hour, seconds, ...f.params],
  );
}

/**
 * The statements that add up to "the period before". When the current period includes today,
 * today is only part of a day, so the last day of the comparison is cut at the same time of day.
 * Otherwise mornings would always look like a fall.
 */
function previous(env, site, range, clock, filters) {
  const { prev_from: pa, prev_to: pb } = range;
  if (!range.partial) return [totals(env, site, pa, pb, filters)];
  const out = [totalsUntil(env, site, pb, clock.hour, clock.seconds, filters)];
  if (pa < pb) out.push(totals(env, site, pa, addDays(pb, -1), filters));
  return out;
}

function sumRows(rows) {
  const out = {};
  for (const row of rows) {
    for (const [k, v] of Object.entries(row || {})) out[k] = (out[k] || 0) + (Number(v) || 0);
  }
  return out;
}

function series(env, site, range, a, b, filters) {
  if (range.granularity === 'hour') {
    const src = source(site, 'hour', a, b, filters);
    return statement(env, `SELECT k AS t, ${SUMS} FROM (${src.sql}) GROUP BY k`, src.params);
  }
  const src = source(site, 'total', a, b, filters);
  const t = range.granularity === 'month' ? 'substr(day, 1, 7)' : 'day';
  return statement(env, `SELECT ${t} AS t, ${SUMS} FROM (${src.sql}) GROUP BY t ORDER BY t`, src.params);
}

// ---------------------------------------------------------------- summaries

/** Write the summary rows for a span of days (replacing any that exist). One round trip. */
export async function rollup(env, site, a, b) {
  const statements = [env.DB.prepare('DELETE FROM rollup WHERE site = ? AND day BETWEEN ? AND ?').bind(site.id, a, b)];
  for (const dim of Object.keys(DIMS)) {
    const raw = rawSelect(dim, site.id, a, b);
    statements.push(
      statement(
        env,
        // Only the busiest ${ROLLUP_KEEP} values of a breakdown are kept per day, so a flood of made-up
        // page addresses or campaign names cannot grow the summaries without limit.
        `INSERT INTO rollup (site, day, dim, k, ${COLUMNS})
         SELECT ?, day, '${dim}', k, visitors, visits, COALESCE(pageviews, 0), COALESCE(n1, 0), COALESCE(n2, 0), COALESCE(v1, 0), COALESCE(v2, 0)
         FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY day ORDER BY visits DESC, visitors DESC) AS place FROM (${raw.sql}) WHERE k IS NOT NULL)
         WHERE place <= ${ROLLUP_KEEP}`,
        [site.id, ...raw.params],
      ),
    );
  }
  if (!site.rolled || site.rolled < b) {
    statements.push(env.DB.prepare('UPDATE sites SET rolled = ? WHERE id = ?').bind(b, site.id));
    site.rolled = b;
  }
  await env.DB.batch(statements);
  forgetSites();
}

/** Make sure every finished day has its summary. Called before answering and by the hourly job. */
export async function ensureRolled(env, site, today) {
  const yesterday = addDays(today, -1);
  if (site.rolled && site.rolled >= yesterday) return;
  let from = site.rolled ? addDays(site.rolled, 1) : null;
  if (!from) {
    const first = await env.DB.prepare('SELECT MIN(day) AS d FROM sessions WHERE site = ?').bind(site.id).first();
    from = first?.d || null;
  }
  if (from && from <= yesterday) {
    // Long histories are summarised a few months at a time to stay inside one request.
    while (from <= yesterday) {
      const to = addDays(from, 120) < yesterday ? addDays(from, 120) : yesterday;
      await rollup(env, site, from, to);
      from = addDays(to, 1);
    }
  } else {
    await env.DB.prepare('UPDATE sites SET rolled = ? WHERE id = ?').bind(yesterday, site.id).run();
    site.rolled = yesterday;
    forgetSites();
  }
}

/** Recount key actions on every visit after the owner changes which actions are "key". */
export async function recountActions(env, site) {
  const keys = site.keyEvents;
  const inList = keys.map(() => '?').join(', ');
  const sql = keys.length
    ? `UPDATE sessions SET actions = (SELECT COUNT(*) FROM hits h WHERE h.session = sessions.id AND h.kind = 'event' AND h.name IN (${inList})) WHERE site = ?`
    : `UPDATE sessions SET actions = 0 WHERE site = ? AND actions > 0`;
  await env.DB.batch([
    env.DB.prepare(sql).bind(...keys, site.id),
    env.DB.prepare('DELETE FROM rollup WHERE site = ?').bind(site.id),
    env.DB.prepare('UPDATE sites SET rolled = NULL WHERE id = ?').bind(site.id),
  ]);
  site.rolled = null;
  forgetSites();
}

// ---------------------------------------------------------------- shaping results

const num = (v) => Number(v) || 0;

function shapeTotals(row = {}) {
  const visits = num(row.visits);
  return {
    visitors: num(row.visitors),
    visits,
    pageviews: num(row.pageviews),
    bounce: visits ? Math.round((num(row.n1) / visits) * 1000) / 10 : 0,
    engaged: visits ? Math.round(num(row.v2) / visits / 1000) : 0, // seconds per visit
    actions: num(row.v1),
    acted: num(row.n2),
    conversion: visits ? Math.round((num(row.n2) / visits) * 1000) / 10 : 0,
  };
}

function shapeRows(rows) {
  return rows.map((r) => {
    const visits = num(r.visits);
    return {
      name: r.k,
      visitors: num(r.visitors),
      visits,
      pageviews: num(r.pageviews),
      bounce: visits ? Math.round((num(r.n1) / visits) * 100) : 0,
      acted: num(r.n2),
      actions: num(r.v1),
      engaged: visits ? Math.round(num(r.v2) / visits / 1000) : 0,
    };
  });
}

function fillSeries(rows, keys) {
  const byKey = new Map(rows.map((r) => [String(r.t), r]));
  return keys.map((t) => {
    const r = byKey.get(t) || {};
    return { t, visitors: num(r.visitors), visits: num(r.visits), pageviews: num(r.pageviews), actions: num(r.v1) };
  });
}

// ---------------------------------------------------------------- the main answer

export async function stats(env, site, query) {
  const nowMs = Date.now();
  const { day: today, hour: hourNow } = localParts(nowMs, site.timezone);
  await ensureRolled(env, site, today);
  const range = resolveRange(query.range, today, query.from, query.to);
  const filters = parseFilters(query.f);
  const { from: a, to: b, prev_from: pa, prev_to: pb } = range;
  const before = previous(env, site, range, { hour: hourNow, seconds: Math.floor(nowMs / 1000) % 3600 }, filters);

  const q = [
    totals(env, site, a, b, filters), // 0
    before[0], // 1
    series(env, site, range, a, b, filters), // 2
    series(env, site, range, pa, pb, filters), // 3
    list(env, site, 'channel', a, b, filters), // 4
    list(env, site, 'source', a, b, filters), // 5
    list(env, site, 'campaign', a, b, filters), // 6
    list(env, site, 'page', a, b, filters, 'visitors DESC, pageviews DESC', 15), // 7
    list(env, site, 'entry', a, b, filters, 'visits DESC'), // 8
    list(env, site, 'exit', a, b, filters, 'visits DESC'), // 9
    list(env, site, 'event', a, b, filters, 'n1 DESC', 40), // 10
    list(env, site, 'video', a, b, filters, 'n1 DESC, v1 DESC', 15), // 11
    list(env, site, 'country', a, b, filters), // 12
    list(env, site, 'region', a, b, filters), // 13
    list(env, site, 'city', a, b, filters), // 14
    list(env, site, 'device', a, b, filters), // 15
    list(env, site, 'browser', a, b, filters, 'visitors DESC', 8), // 16
    list(env, site, 'os', a, b, filters, 'visitors DESC', 8), // 17
    (() => {
      const src = source(site, 'hour', a, b, filters);
      return statement(env, `SELECT CAST(strftime('%w', day) AS INTEGER) AS dow, CAST(k AS INTEGER) AS hour, SUM(visits) AS visits FROM (${src.sql}) GROUP BY dow, hour`, src.params);
    })(), // 18
    env.DB.prepare('SELECT SUM(n) AS n FROM drops WHERE site = ? AND day BETWEEN ? AND ?').bind(site.id, a, b), // 19
    ...before.slice(1), // 20, when the period before comes in two parts
  ];
  const r = (await env.DB.batch(q)).map((x) => x.results || []);

  const keys = buckets(a, b, range.granularity);
  const prevKeys = buckets(pa, pb, range.granularity);
  const current = fillSeries(r[2], keys);
  // Compared point by point, so the two lines must be the same length.
  const earlier = fillSeries(r[3], prevKeys).slice(0, keys.length);
  // The chart should not draw hours or days that have not happened yet as zero.
  let complete = keys.length;
  if (range.granularity === 'hour' && b === today) complete = hourNow + 1;

  const pages = r[7].map((p) => ({
    name: p.k,
    visitors: num(p.visitors),
    visits: num(p.visits),
    views: num(p.pageviews),
    seconds: num(p.n1) ? Math.round(num(p.v1) / num(p.n1) / 1000) : 0,
    scroll: num(p.n1) ? Math.min(100, Math.round(num(p.v2) / num(p.n1))) : 0,
  }));
  const hidden = new Set(['Video play', 'Video progress', 'Video complete', 'Video watch']);
  const events = r[10]
    .filter((e) => !hidden.has(e.k))
    .map((e) => ({ name: e.k, count: num(e.n1), visitors: num(e.visitors), visits: num(e.visits), key: site.keySet.has(e.k) }));
  const videos = r[11]
    .filter((v) => num(v.n1) > 0 || num(v.v1) > 0)
    .map((v) => ({
      name: v.k,
      plays: num(v.n1),
      viewers: num(v.visitors),
      completes: num(v.n2),
      seconds: num(v.n1) ? Math.round(num(v.v1) / num(v.n1)) : 0,
      total_seconds: Math.round(num(v.v1)),
    }));

  const out = {
    site: { id: site.id, name: site.name, domain: site.domain, timezone: site.timezone },
    range,
    filters,
    totals: shapeTotals(r[0][0]),
    prev: shapeTotals(sumRows([r[1][0], ...(before.length > 1 ? [r[20][0]] : [])])),
    series: current,
    prev_series: earlier,
    complete,
    channels: shapeRows(r[4]),
    sources: shapeRows(r[5]),
    campaigns: shapeRows(r[6]),
    pages,
    entries: shapeRows(r[8]),
    exits: shapeRows(r[9]),
    events,
    videos,
    countries: shapeRows(r[12]),
    regions: shapeRows(r[13]),
    cities: shapeRows(r[14]),
    devices: shapeRows(r[15]),
    browsers: shapeRows(r[16]),
    os: shapeRows(r[17]),
    heatmap: r[18].map((x) => [num(x.dow), num(x.hour), num(x.visits)]),
    filtered_out: num(r[19][0]?.n),
    key_events: site.keyEvents,
    generated: Math.floor(nowMs / 1000),
  };
  out.insights = insights(out);
  return out;
}

// ---------------------------------------------------------------- details on demand (raw tables)

/** Everything about one action: what it carried, where it happened, how it trended. */
export async function eventDetail(env, site, query) {
  const today = localParts(Date.now(), site.timezone).day;
  const range = resolveRange(query.range, today, query.from, query.to);
  const filters = parseFilters(query.f);
  const name = String(query.name || '').slice(0, 80);
  const f = filterSql(site.id, range.from, range.to, filters);
  const narrowed = filters.length ? ` AND h.session IN (SELECT s.id FROM sessions s WHERE s.site = ? AND s.day BETWEEN ? AND ?${f.sql})` : '';
  const narrowParams = filters.length ? [site.id, addDays(range.from, -1), range.to, ...f.params] : [];
  const where = `h.site = ? AND h.kind = 'event' AND h.day BETWEEN ? AND ? AND h.name = ?${narrowed}`;
  const params = [site.id, range.from, range.to, name, ...narrowParams];
  const [props, pages, days, sources] = (
    await env.DB.batch([
      statement(env, `SELECT j.key AS k, CAST(j.value AS TEXT) AS v, COUNT(*) AS n, COUNT(DISTINCT h.visitor) AS visitors
                      FROM hits h, json_each(h.props) j WHERE ${where} AND h.props IS NOT NULL GROUP BY j.key, v ORDER BY n DESC LIMIT 400`, params),
      statement(env, `SELECT h.path AS k, COUNT(*) AS n, COUNT(DISTINCT h.visitor) AS visitors FROM hits h WHERE ${where} GROUP BY h.path ORDER BY n DESC LIMIT 15`, params),
      statement(env, `SELECT h.day AS t, COUNT(*) AS n FROM hits h WHERE ${where} GROUP BY h.day ORDER BY h.day`, params),
      statement(env, `SELECT s.source AS k, COUNT(*) AS n, COUNT(DISTINCT h.visitor) AS visitors FROM hits h JOIN sessions s ON s.id = h.session WHERE ${where} GROUP BY s.source ORDER BY n DESC LIMIT 10`, params),
    ])
  ).map((x) => x.results || []);
  const byProp = Object.create(null); // a detail may be named anything, including "constructor"
  for (const row of props) {
    (byProp[row.k] ||= []).push({ name: row.v, count: num(row.n), visitors: num(row.visitors) });
  }
  for (const k of Object.keys(byProp)) byProp[k] = byProp[k].slice(0, 25);
  const byDay = new Map(days.map((d) => [d.t, num(d.n)]));
  const stepKeys = range.days === 1 ? [range.from] : buckets(range.from, range.to, 'day');
  return {
    name,
    range,
    total: days.reduce((sum, d) => sum + num(d.n), 0),
    props: byProp,
    pages: pages.map((p) => ({ name: p.k, count: num(p.n), visitors: num(p.visitors) })),
    sources: sources.map((p) => ({ name: p.k, count: num(p.n), visitors: num(p.visitors) })),
    series: stepKeys.map((t) => ({ t, count: byDay.get(t) || 0 })),
  };
}

const likePattern = (match) => String(match).replace(/[\\%_]/g, '\\$&').replace(/\*/g, '%');

/** The journey: how many visits made it through each step. */
export async function funnel(env, site, query) {
  const today = localParts(Date.now(), site.timezone).day;
  const range = resolveRange(query.range, today, query.from, query.to);
  const filters = parseFilters(query.f);
  const f = filterSql(site.id, range.from, range.to, filters);
  const base = `SELECT s.id FROM sessions s WHERE s.site = ? AND s.day BETWEEN ? AND ?${f.sql}`;
  const baseParams = [site.id, range.from, range.to, ...f.params];

  let steps = site.funnelSteps;
  if (!Array.isArray(steps) || !steps.length) {
    // No journey set up yet: show the simplest honest one.
    const row = await statement(
      env,
      `SELECT COUNT(*) AS a, SUM(CASE WHEN pageviews >= 2 OR events > 0 THEN 1 ELSE 0 END) AS b, SUM(CASE WHEN actions > 0 THEN 1 ELSE 0 END) AS c
       FROM sessions s WHERE s.site = ? AND s.day BETWEEN ? AND ?${f.sql}`,
      baseParams,
    ).first();
    const out = [
      { label: 'Visited the site', visits: num(row?.a) },
      { label: 'Looked around (a second page or an action)', visits: num(row?.b) },
    ];
    if (site.keyEvents.length) out.push({ label: 'Took a key action', visits: num(row?.c) });
    return { range, steps: out, custom: false };
  }

  let sql = `WITH s0 AS (${base})`;
  const params = [...baseParams];
  steps.forEach((step, i) => {
    const cond = step.type === 'event' ? `h.kind = 'event' AND h.name = ?` : `h.kind = 'pageview' AND h.path LIKE ? ESCAPE '\\'`;
    sql += `, s${i + 1} AS (SELECT id FROM s${i} WHERE id IN (SELECT h.session FROM hits h WHERE h.site = ? AND h.day BETWEEN ? AND ? AND ${cond}))`;
    params.push(site.id, range.from, addDays(range.to, 1), step.type === 'event' ? step.match : likePattern(step.match));
  });
  sql += ` SELECT ${['(SELECT COUNT(*) FROM s0) AS c0', ...steps.map((_, i) => `(SELECT COUNT(*) FROM s${i + 1}) AS c${i + 1}`)].join(', ')}`;
  const row = (await statement(env, sql, params).first()) || {};
  return {
    range,
    custom: true,
    steps: [{ label: 'Visited the site', visits: num(row.c0) }, ...steps.map((s, i) => ({ label: s.label, visits: num(row[`c${i + 1}`]) }))],
  };
}

/** Who is on the site right now, and what just happened. */
export async function live(env, site) {
  const now = Math.floor(Date.now() / 1000);
  const today = localParts(Date.now(), site.timezone).day;
  const since = addDays(today, -1);
  const [count, recent] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(DISTINCT visitor) AS n FROM sessions WHERE site = ? AND day >= ? AND last_seen > ?').bind(site.id, since, now - 300),
    env.DB.prepare(
      `SELECT h.ts, h.kind, h.name, h.path, s.source, s.city, s.region, s.country, s.device
       FROM hits h JOIN sessions s ON s.id = h.session
       WHERE h.site = ? AND h.kind IN ('pageview', 'event') AND h.day >= ? AND h.ts > ? AND (h.name IS NULL OR h.name NOT IN ('Video progress', 'Video watch'))
       ORDER BY h.ts DESC LIMIT 15`,
    ).bind(site.id, since, now - 1800),
  ]);
  return {
    now: num(count.results[0]?.n),
    recent: recent.results.map((x) => ({
      ago: Math.max(0, now - x.ts),
      kind: x.kind,
      name: x.name,
      path: x.path,
      source: x.source,
      place: [x.city, x.region].filter(Boolean).join(', ') || x.country || '',
      device: x.device,
    })),
  };
}

/** The "all websites" page: one card per site. */
export async function overview(env, sites) {
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const plans = [];
  for (const site of sites) {
    const today = localParts(nowMs, site.timezone).day;
    await ensureRolled(env, site, today);
    plans.push({ site, today });
  }
  const q = [];
  const clock = { hour: 0, seconds: now % 3600 };
  for (const { site, today } of plans) {
    const week = addDays(today, -6);
    q.push(
      totals(env, site, today, today, []),
      totals(env, site, week, today, []),
      totals(env, site, addDays(week, -7), addDays(week, -2), []),
      totalsUntil(env, site, addDays(week, -1), localParts(nowMs, site.timezone).hour, clock.seconds, []),
      series(env, site, { granularity: 'day' }, addDays(today, -29), today, []),
      list(env, site, 'source', week, today, [], 'visitors DESC', 1),
      env.DB.prepare('SELECT COUNT(DISTINCT visitor) AS n FROM sessions WHERE site = ? AND day >= ? AND last_seen > ?').bind(site.id, addDays(today, -1), now - 300),
      env.DB.prepare('SELECT MAX(ts) AS ts FROM hits WHERE site = ? AND kind = ? AND day >= ?').bind(site.id, 'pageview', addDays(today, -3)),
    );
  }
  const r = q.length ? (await env.DB.batch(q)).map((x) => x.results || []) : [];
  return plans.map(({ site, today }, i) => {
    const o = i * 8;
    return {
      id: site.id,
      name: site.name,
      domain: site.domain,
      color: site.color,
      today: shapeTotals(r[o][0]),
      week: shapeTotals(r[o + 1][0]),
      prev_week: shapeTotals(sumRows([r[o + 2][0], r[o + 3][0]])),
      series: fillSeries(r[o + 4], buckets(addDays(today, -29), today, 'day')).map((p) => p.visitors),
      top_source: r[o + 5][0]?.k || null,
      live: num(r[o + 6][0]?.n),
      last_hit: num(r[o + 7][0]?.ts) || null,
    };
  });
}
