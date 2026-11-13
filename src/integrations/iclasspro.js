// iClassPro: class sizes next to website traffic.
//
// iClassPro has no API for enrollments, but every customer portal reads its class list from a
// public feed that includes how many spots are open in each class. Matside reads that feed every
// 15 minutes and writes down each change. A spot that disappears is, almost always, an enrollment,
// so "spots filled" is a good running estimate of sign-ups without touching anyone's account.

import { localParts, nowSeconds, text } from '../util.js';

export const id = 'iclasspro';

function scheduleText(schedule) {
  if (!Array.isArray(schedule)) return null;
  const parts = schedule
    .filter((s) => s && s.dayName)
    .map((s) => `${s.dayName} ${String(s.startTime || '').toLowerCase()}${s.endTime ? '–' + String(s.endTime).toLowerCase() : ''}`.trim());
  return parts.length ? parts.join(', ').slice(0, 200) : null;
}

/** Turn the feed's rows into the few facts Matside keeps. Exported for tests. */
export function readFeed(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .filter((c) => c && c.id != null && c.name)
    .map((c) => ({
      class_id: String(c.id),
      name: text(String(c.name), 120),
      schedule: scheduleText(c.schedule),
      // No number is not the same as zero spots.
      openings: c.openings === null || c.openings === undefined || c.openings === '' || !Number.isFinite(Number(c.openings)) ? null : Math.max(0, Math.round(Number(c.openings))),
    }));
}

/** Compare the feed with what is on file. Exported for tests. */
export function diff(existing, current) {
  const known = new Map(existing.map((c) => [c.class_id, c]));
  const added = [];
  const changed = [];
  const updated = [];
  for (const c of current) {
    const old = known.get(c.class_id);
    known.delete(c.class_id);
    if (!old) added.push(c);
    else if (old.openings !== null && c.openings !== null && old.openings !== c.openings) changed.push({ ...c, delta: c.openings - old.openings });
    else if (old.name !== c.name || old.schedule !== c.schedule || old.gone || old.openings !== c.openings) updated.push(c);
  }
  const gone = [...known.values()].filter((c) => !c.gone);
  return { added, changed, updated, gone };
}

export async function sync(env, site, config) {
  const res = await fetch(`https://app.iclasspro.com/api/open/v1/${encodeURIComponent(config.account)}/classes?limit=200`, {
    headers: { accept: 'application/json', 'user-agent': 'Matside (class openings reader)' },
  });
  if (!res.ok) throw new Error(`The iClassPro class list answered ${res.status}. Check the account name.`);
  const current = readFeed(await res.json());
  const { results: existing } = await env.DB.prepare('SELECT class_id, name, schedule, openings, gone FROM classes WHERE site = ?').bind(site.id).all();
  const d = diff(existing, current);
  const ts = nowSeconds();
  const day = localParts(Date.now(), site.timezone).day;
  const statements = [];
  for (const c of d.added) {
    statements.push(env.DB.prepare('INSERT INTO classes (site, class_id, name, schedule, openings, first_seen, updated) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(site.id, c.class_id, c.name, c.schedule, c.openings, ts, ts));
  }
  for (const c of [...d.changed, ...d.updated]) {
    statements.push(env.DB.prepare('UPDATE classes SET name = ?, schedule = ?, openings = ?, updated = ?, gone = 0 WHERE site = ? AND class_id = ?').bind(c.name, c.schedule, c.openings, ts, site.id, c.class_id));
  }
  for (const c of d.changed) {
    statements.push(env.DB.prepare('INSERT INTO class_changes (site, class_id, ts, day, delta, openings) VALUES (?, ?, ?, ?, ?, ?)').bind(site.id, c.class_id, ts, day, c.delta, c.openings));
  }
  for (const c of d.gone) {
    statements.push(env.DB.prepare('UPDATE classes SET gone = 1, updated = ? WHERE site = ? AND class_id = ?').bind(ts, site.id, c.class_id));
  }
  for (let i = 0; i < statements.length; i += 80) await env.DB.batch(statements.slice(i, i + 80));
  return `${current.length} classes, ${d.changed.length} changed`;
}

/** What the dashboard's Classes card shows for a date range. */
export async function panel(env, site, range) {
  const [classes, changes, days, log] = await env.DB.batch([
    env.DB.prepare('SELECT class_id, name, schedule, openings, updated FROM classes WHERE site = ? AND gone = 0 ORDER BY name').bind(site.id),
    env.DB.prepare(
      `SELECT class_id, SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS filled, SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS opened
       FROM class_changes WHERE site = ? AND day BETWEEN ? AND ? GROUP BY class_id`,
    ).bind(site.id, range.from, range.to),
    env.DB.prepare(
      `SELECT day AS t, SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS filled FROM class_changes WHERE site = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day`,
    ).bind(site.id, range.from, range.to),
    env.DB.prepare('SELECT ts, ok, message FROM sync_log WHERE site = ? AND kind = ?').bind(site.id, id),
  ]);
  const byClass = new Map(changes.results.map((c) => [c.class_id, c]));
  const list = classes.results.map((c) => ({
    id: c.class_id,
    name: c.name,
    schedule: c.schedule,
    openings: c.openings,
    filled: Number(byClass.get(c.class_id)?.filled) || 0,
    opened: Number(byClass.get(c.class_id)?.opened) || 0,
  }));
  return {
    classes: list,
    filled: list.reduce((n, c) => n + c.filled, 0),
    opened: list.reduce((n, c) => n + c.opened, 0),
    series: days.results.map((x) => ({ t: x.t, filled: Number(x.filled) || 0 })),
    synced: log.results[0] || null,
  };
}
