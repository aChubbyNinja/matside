// Small building blocks for the dashboard: making elements, talking to the server, formatting.
// Everything that comes from a website (page addresses, link text, campaign names) is placed on
// the page as plain text, never as HTML.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style') {
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith('--')) el.style.setProperty(k, v);
        else el.style[k] = v;
      }
    }
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected' || key === 'open') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  add(el, kids);
  return el;
}

export function s(tag, attrs, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs || {})) if (value != null && value !== false) el.setAttribute(key, value);
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}

export function clear(el, ...kids) {
  el.replaceChildren();
  add(el, kids);
  return el;
}

const ICONS = {
  chevron: 'M6 9l6 6 6-6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 13l4 4L19 7',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  info: 'M12 16v-5M12 8h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  warn: 'M12 9v4M12 17h.01M10.3 3.9L2.4 17.5A2 2 0 004.1 20.5h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  spark: 'M12 3l2.2 5.6L20 9.3l-4.4 3.9 1.3 5.8L12 16l-4.9 3 1.3-5.8L4 9.3l5.8-.7L12 3z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z',
  gear: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  out: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  link: 'M14 5h5v5M19 5l-8 8M10 5H6a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-4',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  table: 'M4 5h16v14H4zM4 10h16M10 5v14',
  refresh: 'M20 11a8 8 0 00-14.9-3M4 4v4h4M4 13a8 8 0 0014.9 3M20 20v-4h-4',
};

export function icon(name, filled = false) {
  return s('svg', { viewBox: '0 0 24 24', fill: filled ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    s('path', { d: ICONS[name] || '' }));
}

/** The mark: a wrestling mat seen from above: a red ring and a blue centre on black. To use your own colours, change them here and in icon.svg. */
export function logo() {
  return s('svg', { viewBox: '0 0 32 32', fill: 'none', 'aria-hidden': 'true' },
    // the faint outline keeps the black tile visible on the dark appearance
    s('rect', { x: 2, y: 2, width: 28, height: 28, rx: 8, fill: '#0e0e0f', stroke: 'rgba(255, 255, 255, 0.18)', 'stroke-width': 1 }),
    s('circle', { cx: 16, cy: 16, r: 7.4, stroke: '#c3232b', 'stroke-width': 2.4 }),
    s('circle', { cx: 16, cy: 16, r: 2.6, fill: '#0282c8' }));
}

// ---------------------------------------------------------------- server

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let onSignedOut = () => {};
export const whenSignedOut = (fn) => { onSignedOut = fn; };

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api/' + path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('No connection. Check your signal and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !['login', 'setup', 'password'].includes(path)) {
    onSignedOut();
    throw new ApiError('Please sign in.', 401);
  }
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong.', res.status);
  return data;
}

// ---------------------------------------------------------------- words and numbers

export function num(n) {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString('en-US');
}

export const full = (n) => (Number(n) || 0).toLocaleString('en-US');

export function duration(seconds) {
  seconds = Math.round(Number(seconds) || 0);
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
  return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
}

export function money(n) {
  return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 100 ? 0 : 2 });
}

/** Change against the period before. upIsGood says which way is welcome. */
export function change(current, previous, upIsGood = true) {
  if (!previous) return current ? { text: 'new', tone: 'flat', arrow: '' } : null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: 'no change', tone: 'flat', arrow: '' };
  const up = pct > 0;
  return { text: Math.abs(pct) + '%', tone: up === upIsGood ? 'good' : 'bad', arrow: up ? '▲' : '▼' };
}

const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export function hourLabel(hh) {
  const x = Number(hh);
  return (x % 12 === 0 ? 12 : x % 12) + (x < 12 ? ' am' : ' pm');
}

/** A chart bucket ("14", "2026-11-13" or "2026-11") in words. */
export function bucketLabel(t, granularity, long = false) {
  if (granularity === 'hour') return hourLabel(t);
  if (granularity === 'month') return monthFmt.format(new Date(t + '-01T00:00:00Z'));
  return (long ? longDayFmt : dayFmt).format(new Date(t + 'T00:00:00Z'));
}

export function ago(seconds) {
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return Math.round(seconds / 60) + ' min ago';
  if (seconds < 86400) return Math.round(seconds / 3600) + ' h ago';
  return Math.round(seconds / 86400) + ' d ago';
}

let regionNames = null;
export function countryName(code) {
  try {
    regionNames ||= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}
export function flag(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status', text: message });
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

export async function copy(value, message = 'Copied') {
  try {
    await navigator.clipboard.writeText(value);
    toast(message);
  } catch {
    toast('Select the text and copy it by hand');
  }
}

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem('matside:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('matside:' + key, JSON.stringify(value));
    } catch { /* private mode */ }
  },
};
