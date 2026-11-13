// The charts, drawn by hand in SVG. No library.
//
// House rules (docs/design.md has the reasoning): thin marks, hairline grid, one axis, a tooltip
// that follows the finger or pointer, a table behind every chart, and text is never the colour
// of the data.

import { h, s } from './lib.js';

// ---------------------------------------------------------------- tooltip

let tipEl = null;

export function showTip(x, y, build) {
  if (!tipEl) {
    tipEl = h('div', { class: 'tip', role: 'tooltip' });
    document.body.append(tipEl);
  }
  tipEl.replaceChildren();
  build(tipEl);
  tipEl.hidden = false;
  const box = tipEl.getBoundingClientRect();
  let left = x + 14;
  if (left + box.width > innerWidth - 8) left = x - box.width - 14;
  left = Math.max(8, left);
  let top = y - box.height - 12;
  if (top < 8) top = y + 18;
  tipEl.style.left = left + 'px';
  tipEl.style.top = top + 'px';
}

export function hideTip() {
  if (tipEl) tipEl.hidden = true;
}
addEventListener('scroll', hideTip, { passive: true, capture: true });

/** The top of the scale: a round number whose quarters are round too (0, 8, 16, 24, 32). */
function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.6, 2, 2.4, 3.2, 4, 6, 8, 10, 12]) {
    const top = Math.round(m * pow);
    if (top >= v && top % 4 === 0) return top;
  }
  return 12 * pow;
}

function compact(v) {
  if (v >= 1e6) return v / 1e6 + 'M';
  if (v >= 1e4) return v / 1e3 + 'K';
  return v.toLocaleString('en-US');
}

// ---------------------------------------------------------------- line chart

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {string[]} o.labels           short label per point (x axis)
 * @param {string[]} o.longLabels       label per point for the tooltip
 * @param {number[]} o.values           the series
 * @param {number[]} [o.previous]       the period before, drawn quietly behind
 * @param {string[]} [o.previousLabels]
 * @param {number} [o.complete]         how many points have happened so far
 * @param {boolean} [o.partial]         the last of those is still in progress (today, this hour)
 * @param {string} o.name               what is being counted ("Visitors")
 * @param {(n: number) => string} [o.format]
 */
export function lineChart(host, o) {
  const format = o.format || ((n) => n.toLocaleString('en-US'));
  const n = o.values.length;
  const complete = Math.min(n, o.complete ?? n);
  const hasPrev = Array.isArray(o.previous) && o.previous.some((v) => v > 0);
  let active = -1;
  let svg = null;

  function draw() {
    const W = Math.max(280, host.clientWidth);
    const H = W < 520 ? 200 : 250;
    const m = { l: 38, r: 12, t: 12, b: 24 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const top = niceMax(Math.max(1, ...o.values.slice(0, complete), ...(hasPrev ? o.previous : [])));
    const x = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => m.t + ih - (v / top) * ih;
    const path = (vals, count) => vals.slice(0, count).map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

    svg = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', tabindex: 0, 'aria-label': `${o.name} over time. Use the left and right arrow keys to read each point.` });
    // grid and y axis
    for (let i = 0; i <= 4; i++) {
      const v = (top / 4) * i;
      svg.append(s('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: i ? 'var(--grid)' : 'var(--axis)', 'stroke-width': 1 }));
      svg.append(s('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, compact(v)));
    }
    // x labels: as many as fit without touching
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
    for (let i = 0; i < n; i += every) {
      if (n - 1 - i < every && i !== n - 1 && n > every) continue; // leave room for the last one
      svg.append(s('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : 'middle' }, o.labels[i]));
    }
    if (n > 1 && (n - 1) % every !== 0) svg.append(s('text', { x: x(n - 1), y: H - 6, 'text-anchor': 'end' }, o.labels[n - 1]));

    if (hasPrev) svg.append(s('path', { d: path(o.previous, Math.min(n, o.previous.length)), fill: 'none', stroke: 'var(--prev)', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    if (complete > 0) {
      // A day or hour that is still going is not a drop: draw the way to it dashed, and leave the
      // shading off it.
      const solid = o.partial && complete > 1 ? complete - 1 : complete;
      const line = path(o.values, solid);
      if (solid > 1) svg.append(s('path', { d: `${line}L${x(solid - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`, fill: 'var(--s1)', 'fill-opacity': 0.1 }));
      svg.append(s('path', { d: line, fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (solid < complete) {
        svg.append(s('line', { x1: x(solid - 1), y1: y(o.values[solid - 1]), x2: x(complete - 1), y2: y(o.values[complete - 1]), stroke: 'var(--s1)', 'stroke-width': 2, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }));
        svg.append(s('circle', { cx: x(complete - 1), cy: y(o.values[complete - 1]), r: 4, fill: 'var(--surface)', stroke: 'var(--s1)', 'stroke-width': 2 }));
      } else {
        svg.append(s('circle', { cx: x(complete - 1), cy: y(o.values[complete - 1]), r: 4.5, fill: 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2 }));
      }
    }
    // the reading line
    const cross = s('line', { y1: m.t, y2: m.t + ih, stroke: 'var(--axis)', 'stroke-width': 1, visibility: 'hidden' });
    const dotPrev = s('circle', { r: 4, fill: 'var(--prev)', stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' });
    const dot = s('circle', { r: 5, fill: 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' });
    svg.append(cross, dotPrev, dot);

    function point(i, clientX, clientY) {
      active = Math.max(0, Math.min(n - 1, i));
      const cx = x(active);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.setAttribute('visibility', 'visible');
      const happened = active < complete;
      dot.setAttribute('visibility', happened ? 'visible' : 'hidden');
      if (happened) {
        dot.setAttribute('cx', cx);
        dot.setAttribute('cy', y(o.values[active]));
      }
      const prevValue = hasPrev ? o.previous[active] : undefined;
      dotPrev.setAttribute('visibility', prevValue !== undefined ? 'visible' : 'hidden');
      if (prevValue !== undefined) {
        dotPrev.setAttribute('cx', cx);
        dotPrev.setAttribute('cy', y(prevValue));
      }
      const box = svg.getBoundingClientRect();
      const px = clientX ?? box.left + (cx / W) * box.width;
      const py = clientY ?? box.top + (y(happened ? o.values[active] : 0) / H) * box.height;
      showTip(px, py, (tip) => {
        tip.append(
          h('b', { text: happened ? format(o.values[active]) : 'Not yet' }),
          h('div', { class: 'row' }, h('i', { style: { '--c': 'var(--s1)' } }), `${o.name}, ${o.longLabels[active]}${o.partial && active === complete - 1 ? ' (so far)' : ''}`),
        );
        if (prevValue !== undefined) {
          tip.append(h('div', { class: 'row' }, h('i', { style: { '--c': 'var(--prev)' } }), `${format(prevValue)} on ${o.previousLabels?.[active] || 'the period before'}`));
        }
      });
    }
    function leave() {
      active = -1;
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      dotPrev.setAttribute('visibility', 'hidden');
      hideTip();
    }
    function fromPointer(ev) {
      const box = svg.getBoundingClientRect();
      const rel = ((ev.clientX - box.left) / box.width) * W;
      point(n === 1 ? 0 : Math.round(((rel - m.l) / iw) * (n - 1)), ev.clientX, ev.clientY);
    }
    svg.addEventListener('pointermove', fromPointer);
    svg.addEventListener('pointerdown', fromPointer);
    svg.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') leave(); });
    svg.addEventListener('blur', leave);
    svg.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        point(active < 0 ? complete - 1 : active + (ev.key === 'ArrowRight' ? 1 : -1));
      } else if (ev.key === 'Escape') leave();
    });
    host.replaceChildren(svg);
  }

  draw();
  let frame = 0;
  let lastWidth = host.clientWidth;
  const watcher = new ResizeObserver(() => {
    if (host.clientWidth === lastWidth) return;
    lastWidth = host.clientWidth;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  watcher.observe(host);
  return () => watcher.disconnect();
}

// ---------------------------------------------------------------- sparkline

/** A small line with no axes: the shape of a number over time. The last point is marked. */
export function sparkline(values, { accent = 'var(--s1)', fill = false } = {}) {
  const W = 100;
  const H = 30;
  const n = values.length;
  const top = Math.max(1, ...values);
  const x = (i) => (n === 1 ? W / 2 : 2 + (i / (n - 1)) * (W - 4));
  const y = (v) => H - 3 - (v / top) * (H - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', class: 'spark' });
  if (fill && n > 1) svg.append(s('path', { d: `${d}L${x(n - 1)},${H}L${x(0)},${H}Z`, fill: 'currentColor', 'fill-opacity': 0.120 }));
  svg.append(s('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  // The end mark is a zero-length round stroke, so it stays a dot when the picture is stretched.
  if (n) svg.append(s('path', { d: `M${x(n - 1).toFixed(1)},${y(values[n - 1]).toFixed(1)}h0`, stroke: accent, 'stroke-width': 5, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

// ---------------------------------------------------------------- heatmap

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hour12 = (x) => (x % 12 === 0 ? 12 : x % 12) + (x < 12 ? ' am' : ' pm');

/** When people visit: 7 days by 24 hours, darker for busier. cells = [[dow, hour, visits], ...] */
export function heatmap(cells) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let top = 0;
  for (const [dow, hour, visits] of cells) {
    if (grid[dow] && hour >= 0 && hour < 24) {
      grid[dow][hour] = visits;
      top = Math.max(top, visits);
    }
  }
  const level = (v) => (v <= 0 || !top ? 0 : Math.max(1, Math.ceil((v / top) * 6)));
  const el = h('div', { class: 'heat', role: 'img', 'aria-label': 'Visits by day of the week and hour of the day. The table view lists every value.' });
  // Monday first: that is how a week is planned.
  for (const dow of [1, 2, 3, 4, 5, 6, 0]) {
    el.append(h('span', { class: 'd', text: DAY_NAMES[dow] }));
    for (let hour = 0; hour < 24; hour++) {
      const v = grid[dow][hour];
      const cell = h('span', { class: `c v${level(v)}`, tabindex: -1 });
      const tell = () => {
        const box = cell.getBoundingClientRect();
        showTip(box.left + box.width / 2, box.top, (tip) => tip.append(h('b', { text: v.toLocaleString('en-US') + (v === 1 ? ' visit' : ' visits') }), h('div', { class: 'when', text: `${DAY_LONG[dow]}, ${hour12(hour)}` })));
      };
      cell.addEventListener('pointerenter', tell);
      cell.addEventListener('pointerdown', tell);
      cell.addEventListener('pointerleave', hideTip);
      el.append(cell);
    }
  }
  el.append(h('span'), ...['12 am', '6 am', '12 pm', '6 pm'].map((t) => h('span', { class: 'hl', text: t })));
  const scale = h('div', { class: 'scale' }, 'Quieter', ...[0, 1, 2, 3, 4, 5, 6].map((i) => h('i', { style: { background: `var(--h${i})` } })), 'Busier');
  const table = () => {
    const rows = [];
    for (const dow of [1, 2, 3, 4, 5, 6, 0]) for (let hour = 0; hour < 24; hour++) if (grid[dow][hour]) rows.push([dow, hour, grid[dow][hour]]);
    rows.sort((a, b) => b[2] - a[2]);
    return h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', { text: 'Day and hour' }), h('th', { text: 'Visits' }))),
        h('tbody', null, rows.map(([dow, hour, v]) => h('tr', null, h('td', { text: `${DAY_LONG[dow]}, ${hour12(hour)}` }), h('td', { text: v.toLocaleString('en-US') }))))));
  };
  return { el: h('div', null, el, scale), table };
}
