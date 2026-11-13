// Small helpers shared by the whole Worker.

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A request's body as text, or null if it is bigger than max bytes (it stops reading at that point). */
export async function readLimited(request, max) {
  if (Number(request.headers.get('content-length')) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * A small in-memory counter: at most `max` per `windowMs` for each key. It lives in one Worker
 * instance, so it is a first line of defence, not an exact limit (see the LIMITER binding).
 */
export function makeLimiter(max, windowMs) {
  const seen = new Map();
  return (key) => {
    const now = Date.now();
    let entry = seen.get(key);
    if (!entry || entry.until < now) {
      if (seen.size > 5000) seen.clear();
      entry = { n: 0, until: now + windowMs };
      seen.set(key, entry);
    }
    entry.n++;
    return entry.n <= max;
  };
}

/** Run a database call again if it fails: D1 has brief hiccups (a restart, a busy moment) that pass in milliseconds. */
export async function retry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((done) => setTimeout(done, 50 * i));
    }
  }
}

export function randomHex(bytes = 8) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  let s = '';
  for (const b of a) s += b.toString(16).padStart(2, '0');
  return s;
}

const encoder = new TextEncoder();

export function toHex(buffer) {
  let s = '';
  for (const b of new Uint8Array(buffer)) s += b.toString(16).padStart(2, '0');
  return s;
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/** Compare two strings without leaking where they differ. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A trimmed string of at most n characters, or null. Control characters are removed. */
export function text(value, n) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  // Cut by whole characters (an emoji is two code units), then tidy the cut end.
  const s = (clean.length > n ? Array.from(clean).slice(0, n).join('') : clean).trim();
  return s || null;
}

// ---------------------------------------------------------------- dates
// Days are 'YYYY-MM-DD' strings in the site's own timezone, so "today" means the owner's today.

const formatters = new Map();

export function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The local day and hour of a moment (milliseconds) in a timezone. */
export function localParts(ms, tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
    formatters.set(tz, f);
  }
  const p = {};
  for (const part of f.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

/** A real calendar day written YYYY-MM-DD (so not 2024-02-30). */
export function isDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function addMonths(day, n) {
  const d = new Date(day.slice(0, 7) + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** The same day of the month n months away (the 31st becomes the last day of a shorter month). */
export function shiftMonths(day, n) {
  const first = addMonths(day, n);
  const last = addDays(addMonths(first, 1), -1);
  const wanted = first.slice(0, 8) + day.slice(8);
  return wanted > last ? last : wanted;
}

const RANGES = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  month: 'This month',
  lastmonth: 'Last month',
  '12mo': 'Last 12 months',
  custom: 'Custom',
};

function monthCount(a, b) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1;
}

/** Turn a range name into real dates, the period before it (for comparison) and a chart step. */
export function resolveRange(key, today, from, to) {
  const firstOfMonth = today.slice(0, 8) + '01';
  let a;
  let b = today;
  switch (key) {
    case 'today': a = today; break;
    case 'yesterday': a = b = addDays(today, -1); break;
    case '7d': a = addDays(today, -6); break;
    case '90d': a = addDays(today, -89); break;
    case 'month': a = firstOfMonth; break;
    case 'lastmonth': b = addDays(firstOfMonth, -1); a = b.slice(0, 8) + '01'; break;
    case '12mo': a = addMonths(firstOfMonth, -11); break;
    case 'custom':
      if (isDay(from) && isDay(to) && from <= to) {
        b = to > today ? today : to;
        a = from > b ? b : from;
        if (daysBetween(a, b) > 800) a = addDays(b, -800);
        break;
      }
    // an unusable custom range falls through to the default
    default: key = '30d'; a = addDays(today, -29);
  }
  const days = daysBetween(a, b) + 1;
  // The period to compare with. Usually the same number of days straight before; for calendar
  // ranges, the matching calendar stretch, which is what "this month against last month" means.
  let prevTo = addDays(a, -1);
  let prevFrom = addDays(prevTo, -(days - 1));
  let versus = days === 1 ? 'the day before' : `in the ${days} days before`;
  if (key === 'today') versus = 'by this time yesterday';
  if (key === 'month') {
    prevFrom = addMonths(a, -1);
    prevTo = addDays(prevFrom, days - 1);
    if (prevTo >= a) prevTo = addDays(a, -1);
    versus = 'in the same days last month';
  } else if (key === 'lastmonth') {
    prevFrom = addMonths(a, -1);
    versus = 'the month before';
  }
  const granularity = days === 1 ? 'hour' : days <= 92 ? 'day' : 'month';
  if (granularity === 'month') {
    // Charted month by month, so compare with the same dates that many months earlier:
    // the two lines then have the same number of points, month for month.
    const months = monthCount(a, b);
    prevFrom = shiftMonths(a, -months);
    prevTo = shiftMonths(b, -months);
    versus = `in the ${months} months before`;
  }
  return {
    key,
    label: RANGES[key],
    from: a,
    to: b,
    prev_from: prevFrom,
    prev_to: prevTo,
    versus,
    days,
    today,
    partial: b === today, // the last day is still going
    granularity,
  };
}

/** Every bucket of a range, so charts show quiet days as zero rather than skipping them. */
export function buckets(from, to, granularity) {
  const out = [];
  if (granularity === 'hour') {
    for (let h = 0; h < 24; h++) out.push(String(h));
  } else if (granularity === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  } else {
    for (let m = from.slice(0, 7) + '-01'; m <= to; m = addMonths(m, 1)) out.push(m.slice(0, 7));
  }
  return out;
}
