// One website's dashboard: every card on the page, built from the answer to /api/stats.

import { heatmap, hideTip, lineChart, sparkline } from './charts.js';
import { api, bucketLabel, change, clear, countryName, duration, flag, full, h, icon, money, num, toast } from './lib.js';

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

const CHANNEL_WHY = {
  Direct: 'Typed the address, a bookmark, or a link in a text or an app',
  'Organic Search': 'Found you on Google, Bing or another search engine',
  'Organic Social': 'Clicked a post or profile link on social media',
  'Paid Social': 'Clicked one of your social media ads',
  'Paid Search': 'Clicked one of your search ads',
  'Paid Ads': 'Clicked another kind of ad',
  Email: 'Clicked a link in an email',
  'AI Assistants': 'Sent by ChatGPT, Perplexity, Gemini and the like',
  Referral: 'Clicked a link on another website',
  Campaigns: 'Tagged links: QR codes, flyers, text messages',
};

const METRICS = {
  visitors: 'Visitors',
  visits: 'Visits',
  pageviews: 'Page views',
  actions: 'Key actions',
};

// ---------------------------------------------------------------- pieces

function tabs(names, selected, onSelect) {
  return h('div', { class: 'tabs', role: 'tablist' },
    names.map((name) => h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(name === selected), text: name, onclick: () => onSelect(name) })));
}

function card(title, { wide = false, hint = '', extra = null, id = '' } = {}, ...body) {
  return h('section', { class: 'card' + (wide ? ' wide' : ''), id: id || null },
    h('div', { class: 'card-head stack' }, h('h2', { text: title }), hint ? h('span', { class: 'hint', text: hint }) : null, extra),
    ...body);
}

/**
 * A ranked list: a name, one or two figures and a thin bar per row.
 * @param {object[]} rows
 * @param {object} o
 * @param {string[]} o.cols                     headings of the figure columns
 * @param {(row) => (string|Node)[]} o.figures  the figures, first one strongest
 * @param {(row) => number} o.size              what the bar measures
 * @param {(row) => string|Node[]} o.label
 * @param {(row) => string} [o.why]             a quiet second line
 * @param {(row) => void} [o.pick]              tap to filter or open
 */
function rank(rows, o) {
  if (!rows.length) return h('p', { class: 'empty', text: o.empty || 'Nothing here for this period.' });
  const limit = o.limit || 8;
  const top = Math.max(1, ...rows.map(o.size));
  const cols = o.cols.map((_, i) => (i === 0 ? '62px' : '58px')).join(' ');
  const list = h('ul', { class: 'rank', style: { '--cols': cols } });
  const build = (row) => {
    const kids = [
      h('span', { class: 'name' }, o.lead ? o.lead(row) : null, [o.label(row)].flat().map((part) => (typeof part === 'string' ? h('span', { text: part }) : part))),
      ...o.figures(row).map((f, i) => h('span', { class: 'val' + (i ? ' soft' : '') }, f)),
      o.why && o.why(row) ? h('span', { class: 'why', text: o.why(row) }) : null,
      h('span', { class: 'bar', style: { width: Math.max(1, (o.size(row) / top) * 100) + '%' } }),
    ];
    return h('li', null, o.pick ? h('button', { class: 'row', type: 'button', onclick: () => o.pick(row) }, kids) : h('div', { class: 'row' }, kids));
  };
  rows.slice(0, limit).forEach((row) => list.append(build(row)));
  const out = [h('div', { class: 'rank-head', style: { '--cols': cols } }, h('span', { text: o.heading || '' }), o.cols.map((c) => h('span', { text: c }))), list];
  if (rows.length > limit) {
    const more = h('button', { class: 'more', type: 'button', text: `Show ${rows.length - limit} more`, onclick: () => { rows.slice(limit).forEach((row) => list.append(build(row))); more.remove(); } });
    out.push(more);
  }
  return out;
}

function placeName(key, depth) {
  const [country, region, city] = String(key).split('|');
  if (depth === 'country') return [flag(country) + ' ', countryName(country)].join('');
  if (depth === 'region') return `${flag(country)} ${region}`;
  return `${flag(country)} ${city}${region ? ', ' + region : ''}`;
}

// ---------------------------------------------------------------- the page

/**
 * @param {object} d      the /api/stats answer
 * @param {object} ctx    { site, state, setMetric, setTab, addFilter, refresh, openEvent, openSettings, lazy }
 */
export function renderSite(d, ctx) {
  const { state } = ctx;
  const t = d.totals;
  const p = d.prev;
  const hasKeys = d.key_events.length > 0;
  const out = [];

  // ---- what happened
  if (d.insights.length) {
    const toneIcon = { up: 'up', down: 'down', good: 'spark', warn: 'warn', info: 'info' };
    out.push(h('div', { class: 'insights', role: 'list', 'aria-label': 'What happened' },
      d.insights.map((i) => h('div', { class: 'insight ' + i.tone, role: 'listitem' }, h('span', { class: 'ico' }, icon(toneIcon[i.tone] || 'info')), h('b', { text: i.title }), h('p', { text: i.text })))));
  }

  // ---- headline numbers
  const versus = d.range.key === 'today' ? 'vs this time yesterday' : 'vs before';
  const tile = (key, label, value, delta, sub, spark) =>
    h(key ? 'button' : 'div', { class: 'kpi', type: key ? 'button' : null, 'aria-pressed': key ? String(state.metric === key) : null, onclick: key ? () => ctx.setMetric(key) : null },
      h('span', { class: 'label', text: label }),
      h('span', { class: 'value', text: value }),
      h('span', { class: 'sub' }, delta ? h('span', { class: 'delta ' + delta.tone, text: `${delta.arrow} ${delta.text}`.trim() }) : null, delta && sub ? ' · ' : '', sub || (delta ? ' ' + versus : '')),
      spark && spark.length > 1 ? sparkline(spark) : null);
  // The little lines stop at the last finished day or hour, so an unfinished one does not look like a fall.
  const partial = d.range.partial;
  const shown = d.series.slice(0, partial && d.complete > 2 ? d.complete - 1 : d.complete);
  out.push(h('div', { class: 'kpis' },
    tile('visitors', 'Visitors', num(t.visitors), change(t.visitors, p.visitors), '', shown.map((x) => x.visitors)),
    tile('visits', 'Visits', num(t.visits), change(t.visits, p.visits), '', shown.map((x) => x.visits)),
    tile('pageviews', 'Page views', num(t.pageviews), change(t.pageviews, p.pageviews), '', shown.map((x) => x.pageviews)),
    tile(null, 'Time per visit', duration(t.engaged), change(t.engaged, p.engaged)),
    tile(null, 'Bounce rate', t.bounce + '%', change(t.bounce, p.bounce, false)),
    hasKeys
      ? tile('actions', 'Key actions', num(t.actions), change(t.actions, p.actions), `${t.conversion}% of visits`, shown.map((x) => x.actions))
      : tile(null, 'Key actions', '–', null, 'Star an action below')));

  const grid = h('div', { class: 'grid' });
  out.push(grid);

  // ---- the trend
  {
    const metric = METRICS[state.metric] ? state.metric : 'visitors';
    const g = d.range.granularity;
    const host = h('div', { class: 'chart' });
    const tableHost = h('div', { hidden: true });
    const hasPrev = d.prev_series.some((x) => x[metric] > 0);
    let showTable = false;
    const toggle = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Show as a table', title: 'Show as a table', onclick: () => {
      showTable = !showTable;
      host.hidden = showTable;
      tableHost.hidden = !showTable;
      hideTip();
      if (showTable && !tableHost.firstChild) {
        tableHost.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', { text: g === 'hour' ? 'Hour' : g === 'month' ? 'Month' : 'Day' }), Object.values(METRICS).map((m) => h('th', { text: m })))),
          h('tbody', null, d.series.slice(0, d.complete).map((x) => h('tr', null, h('td', { text: bucketLabel(x.t, g, true) }), Object.keys(METRICS).map((k) => h('td', { text: full(x[k]) }))))))));
      }
    } }, icon('table'));
    const legend = h('div', { class: 'legend' },
      h('span', null, h('i', { style: { '--c': 'var(--s1)' } }), d.range.label),
      hasPrev ? h('span', null, h('i', { style: { '--c': 'var(--prev)' } }), d.range.key === 'today' ? 'Yesterday' : 'The period before') : null);
    toggle.style.marginLeft = 'auto';
    grid.append(card(METRICS[metric], { wide: true, extra: toggle }, legend, host, tableHost));
    queueMicrotask(() => lineChart(host, {
      name: METRICS[metric],
      values: d.series.map((x) => x[metric]),
      previous: d.prev_series.map((x) => x[metric]),
      labels: d.series.map((x) => bucketLabel(x.t, g)),
      longLabels: d.series.map((x) => bucketLabel(x.t, g, true)),
      previousLabels: d.prev_series.map((x) => bucketLabel(x.t, g, true)),
      complete: d.complete,
      partial,
      format: full,
    }));
  }

  // ---- where people come from
  {
    const which = state.tab.sources || 'Channels';
    const rows = which === 'Channels' ? d.channels : which === 'Sources' ? d.sources : d.campaigns;
    const key = which === 'Channels' ? 'channel' : which === 'Sources' ? 'source' : 'campaign';
    grid.append(card('Where visitors come from', { extra: tabs(['Channels', 'Sources', 'Campaigns'], which, (v) => ctx.setTab('sources', v)) },
      rank(rows, {
        heading: which.slice(0, -1),
        cols: hasKeys ? ['Visitors', 'Acted'] : ['Visitors'],
        figures: (r) => (hasKeys ? [num(r.visitors), pct(r.acted, r.visits) + '%'] : [num(r.visitors)]),
        size: (r) => r.visitors,
        label: (r) => r.name,
        why: which === 'Channels' ? (r) => CHANNEL_WHY[r.name] : null,
        pick: (r) => ctx.addFilter(key, r.name),
        empty: which === 'Campaigns' ? 'No tagged links yet. Settings has a link builder for ads, emails, flyers and QR codes.' : undefined,
      }),
      hasKeys ? h('p', { class: 'card-note', text: '“Acted” is the share of visits that included a key action.' }) : null));
  }

  // ---- pages
  {
    const which = state.tab.pages || 'Most viewed';
    const opts = which === 'Most viewed'
      ? { rows: d.pages, key: 'page', cols: ['Visitors', 'Time'], figures: (r) => [num(r.visitors), r.seconds ? duration(r.seconds) : '–'], size: (r) => r.visitors }
      : which === 'First page'
        ? { rows: d.entries, key: 'entry', cols: ['Visits', 'Bounced'], figures: (r) => [num(r.visits), r.bounce + '%'], size: (r) => r.visits }
        : { rows: d.exits, key: 'exit', cols: ['Visits'], figures: (r) => [num(r.visits)], size: (r) => r.visits };
    grid.append(card('Pages', { extra: tabs(['Most viewed', 'First page', 'Last page'], which, (v) => ctx.setTab('pages', v)) },
      rank(opts.rows, {
        heading: 'Page',
        cols: opts.cols,
        figures: opts.figures,
        size: opts.size,
        label: (r) => (r.name.startsWith('/') ? r.name : [r.name, h('span', { class: 'badge', text: 'portal' })]),
        pick: (r) => ctx.addFilter(opts.key, r.name),
      }),
      which === 'Most viewed' ? h('p', { class: 'card-note', text: 'Time is how long the page was actually being read: in front, with the person scrolling, tapping or typing.' }) : null));
  }

  // ---- actions
  {
    const body = d.events.length
      ? (() => {
          const top = Math.max(1, ...d.events.map((e) => e.count));
          const list = h('ul', { class: 'rank', style: { '--cols': '62px 58px' } });
          const build = (e) => h('li', null, h('div', { class: 'row' },
            h('span', { class: 'name' },
              h('button', { class: 'star' + (e.key ? ' on' : ''), type: 'button', 'aria-pressed': String(e.key), 'aria-label': e.key ? `Stop counting ${e.name} as a key action` : `Count ${e.name} as a key action`, title: e.key ? 'A key action' : 'Make this a key action', onclick: () => ctx.toggleKey(e.name) }, icon('star', e.key)),
              h('button', { type: 'button', class: 'linkish', style: { color: 'inherit', fontWeight: 520, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis' }, text: e.name, onclick: () => ctx.openEvent(e.name) })),
            h('span', { class: 'val', text: num(e.count) }),
            h('span', { class: 'val soft', text: num(e.visitors) }),
            h('span', { class: 'bar', style: { width: Math.max(1, (e.count / top) * 100) + '%' } })));
          d.events.slice(0, 10).forEach((e) => list.append(build(e)));
          const parts = [h('div', { class: 'rank-head', style: { '--cols': '62px 58px' } }, h('span', { text: 'Action' }), h('span', { text: 'Times' }), h('span', { text: 'People' })), list];
          if (d.events.length > 10) {
            const more = h('button', { class: 'more', type: 'button', text: `Show ${d.events.length - 10} more`, onclick: () => { d.events.slice(10).forEach((e) => list.append(build(e))); more.remove(); } });
            parts.push(more);
          }
          return parts;
        })()
      : h('p', { class: 'empty', text: 'No actions yet. Clicks on outside links, phone numbers, email links and forms show up here on their own.' });
    grid.append(card('What people do', { id: 'actions' }, body,
      h('p', { class: 'card-note', text: 'Tap a name for the details. Star the ones that matter and they become your key actions.' })));
  }

  // ---- the journey (asked for separately, so the page shows first)
  {
    const host = h('div', { class: 'steps' }, h('p', { class: 'empty', text: 'Working it out…' }));
    grid.append(card('The journey', { hint: 'How far visits get' }, host,
      h('p', { class: 'card-note' }, 'Each bar is the number of visits that reached that step. ', h('button', { class: 'linkish', type: 'button', text: 'Change the steps', onclick: () => ctx.openSettings('journey') }))));
    ctx.lazy('funnel', (f) => {
      const first = Math.max(1, f.steps[0]?.visits || 0);
      clear(host, f.steps.map((step, i) => {
        const prev = i ? f.steps[i - 1].visits : step.visits;
        return h('div', { class: 'step' },
          h('div', { class: 'top-line' }, h('b', { text: step.label }), h('span', { class: 'val', text: `${num(step.visits)} · ${pct(step.visits, first)}%` })),
          h('div', { class: 'track', style: { width: Math.max(0.5, (step.visits / first) * 100) + '%' } }),
          i && prev ? h('div', { class: 'lost', text: `${pct(prev - step.visits, prev)}% of the step before did not get here` }) : null);
      }));
    }, () => clear(host, h('p', { class: 'empty', text: 'Could not work out the journey just now.' })));
  }

  // ---- videos
  if (d.videos.length) {
    grid.append(card('Videos', { hint: 'Plays and time watched' },
      rank(d.videos, {
        heading: 'Video',
        cols: ['Plays', 'Watched', 'Finished'],
        figures: (v) => [num(v.plays), v.seconds ? duration(v.seconds) : '–', v.plays ? pct(v.completes, v.plays) + '%' : '–'],
        size: (v) => v.plays,
        label: (v) => v.name,
      }),
      h('p', { class: 'card-note', text: '“Watched” is the average per play. “Finished” means it was watched to the end.' })));
  }

  // ---- places
  {
    const which = state.tab.places || 'Cities';
    const rows = which === 'Cities' ? d.cities : which === 'Regions' ? d.regions : d.countries;
    const depth = which === 'Cities' ? 'city' : which === 'Regions' ? 'region' : 'country';
    grid.append(card('Where visitors are', { extra: tabs(['Cities', 'Regions', 'Countries'], which, (v) => ctx.setTab('places', v)) },
      rank(rows, { heading: which === 'Cities' ? 'City' : which === 'Regions' ? 'Region' : 'Country', cols: ['Visitors'], figures: (r) => [num(r.visitors)], size: (r) => r.visitors, label: (r) => placeName(r.name, depth), pick: (r) => ctx.addFilter(depth, r.name) }),
      h('p', { class: 'card-note', text: 'Places are approximate: they come from the network a visit arrived on, and nothing more precise is kept.' })));
  }

  // ---- devices
  {
    const which = state.tab.devices || 'Browsers';
    const order = ['Phone', 'Desktop', 'Tablet'];
    const parts = order.map((name, i) => ({ name, visits: d.devices.find((x) => x.name === name)?.visits || 0, slot: i + 1 })).filter((x) => x.visits);
    const all = parts.reduce((n, x) => n + x.visits, 0);
    const bar = h('div', { class: 'split', role: 'img', 'aria-label': parts.map((x) => `${x.name} ${pct(x.visits, all)}%`).join(', ') },
      parts.map((x) => h('div', { class: 'c' + x.slot, style: { flex: `${x.visits} 1 0` }, title: `${x.name}: ${full(x.visits)} visits`, text: pct(x.visits, all) >= 9 ? pct(x.visits, all) + '%' : '' })));
    const legend = h('div', { class: 'split-legend' }, parts.map((x) => h('span', { class: 'c' + x.slot }, h('i'), x.name, h('b', { text: full(x.visits) }))));
    const rows = which === 'Browsers' ? d.browsers : d.os;
    grid.append(card('Devices', { extra: tabs(['Browsers', 'Systems'], which, (v) => ctx.setTab('devices', v)) },
      all ? [bar, legend] : null,
      rank(rows, { heading: which === 'Browsers' ? 'Browser' : 'System', cols: ['Visitors'], figures: (r) => [num(r.visitors)], size: (r) => r.visitors, label: (r) => r.name, pick: (r) => ctx.addFilter(which === 'Browsers' ? 'browser' : 'os', r.name), limit: 6 })));
  }

  // ---- when
  if (d.range.days > 1 || d.heatmap.length) {
    const map = heatmap(d.heatmap);
    const tableHost = h('div', { hidden: true });
    let showTable = false;
    const toggle = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Show as a table', title: 'Show as a table', style: { marginLeft: 'auto' }, onclick: () => {
      showTable = !showTable;
      map.el.hidden = showTable;
      tableHost.hidden = !showTable;
      if (showTable && !tableHost.firstChild) tableHost.append(map.table());
    } }, icon('table'));
    grid.append(card('When people visit', { extra: toggle }, map.el, tableHost));
  }

  // ---- classes and ads (asked for separately)
  if (ctx.site.integrations.iclasspro) {
    const host = h('div', null, h('p', { class: 'empty', text: 'Reading the class list…' }));
    grid.append(card('Classes', { hint: 'From iClassPro', id: 'classes' }, host));
    ctx.lazy('classes', (c) => {
      if (c.off) return clear(host, h('p', { class: 'empty', text: 'Not connected.' }));
      clear(host,
        h('div', { class: 'kpis', style: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: '12px' } },
          h('div', { class: 'kpi', style: { minHeight: '0' } }, h('span', { class: 'label', text: 'Spots filled' }), h('span', { class: 'value', text: num(c.filled) }), h('span', { class: 'sub', text: 'estimated, this period' })),
          h('div', { class: 'kpi', style: { minHeight: '0' } }, h('span', { class: 'label', text: 'Open spots now' }), h('span', { class: 'value', text: num(c.classes.reduce((n, x) => n + (x.openings || 0), 0)) }), h('span', { class: 'sub', text: `across ${c.classes.length} classes` }))),
        rank(c.classes, {
          heading: 'Class', cols: ['Open', 'Filled'], figures: (x) => [x.openings == null ? '–' : num(x.openings), x.filled ? '+' + num(x.filled) : '–'],
          size: (x) => x.filled, label: (x) => x.name, why: (x) => x.schedule || '', limit: 12,
          empty: 'No classes on the list yet. The first reading can take up to 15 minutes.',
        }),
        h('p', { class: 'card-note', text: c.synced
          ? (c.synced.ok ? `“Filled” counts open spots that disappeared from your class list. Checked every 15 minutes.` : `Could not read the class list: ${c.synced.message}`)
          : 'Waiting for the first reading (within 15 minutes).' }));
    }, () => clear(host, h('p', { class: 'empty', text: 'Could not load classes just now.' })));
  }
  if (d.channels.some((c) => c.name.startsWith('Paid')) || ctx.site.integrations.meta) {
    const host = h('div', null, h('p', { class: 'empty', text: 'Adding it up…' }));
    grid.append(card('Ads', { hint: 'What they cost, what they brought', wide: true, id: 'ads' }, host));
    ctx.lazy('ads', (a) => {
      const table = rank(a.campaigns, {
        heading: 'Campaign',
        cols: ['Spent', 'Visits', 'Acted'],
        figures: (c) => [c.connected ? money(c.spend) : '–', c.tagged ? num(c.visits) : '–', c.tagged ? num(c.actions) : '–'],
        size: (c) => c.spend || c.visits,
        label: (c) => c.name,
        why: (c) => (c.connected && c.actions ? `${money(c.spend / c.actions)} per key action` : c.connected && c.visits ? `${money(c.spend / c.visits)} per visit, no key actions yet` : ''),
        limit: 10,
      });
      const notes = [];
      if (!a.connected) notes.push(h('p', { class: 'card-note' }, 'Visits come from the tags on your ad links. To add what each campaign cost, ', h('button', { class: 'linkish', type: 'button', text: 'connect Meta in Settings', onclick: () => ctx.openSettings('ads') }), '.'));
      else if (a.synced && !a.synced.ok) notes.push(h('p', { class: 'card-note error', text: `Could not read Meta: ${a.synced.message}` }));
      if (a.campaigns.some((c) => c.connected && !c.tagged && c.spend > 0)) notes.push(h('p', { class: 'card-note', text: 'A campaign with spend but no visits has no tags on its links yet. Settings has the line to paste into each ad.' }));
      clear(host,
        a.connected ? h('div', { class: 'kpis', style: { marginBottom: '12px' } },
          h('div', { class: 'kpi', style: { minHeight: '0' } }, h('span', { class: 'label', text: 'Spent' }), h('span', { class: 'value', text: money(a.spend) })),
          h('div', { class: 'kpi', style: { minHeight: '0' } }, h('span', { class: 'label', text: 'Visits from ads' }), h('span', { class: 'value', text: num(a.visits) }), h('span', { class: 'sub', text: a.visits ? money(a.spend / a.visits) + ' each' : '' })),
          h('div', { class: 'kpi', style: { minHeight: '0' } }, h('span', { class: 'label', text: 'Key actions from ads' }), h('span', { class: 'value', text: num(a.actions) }), h('span', { class: 'sub', text: a.actions ? money(a.spend / a.actions) + ' each' : '' }))) : null,
        a.campaigns.length ? table : h('p', { class: 'empty', text: 'No ad visits in this period.' }),
        notes);
    }, () => clear(host, h('p', { class: 'empty', text: 'Could not load ads just now.' })));
  }

  out.push(h('p', { class: 'foot' },
    d.filtered_out ? `${full(d.filtered_out)} automated or stray hits were left out of these numbers. ` : 'No cookies. Nothing stored on your visitors’ devices. ',
    h('br'), `Days and hours are in ${d.site.timezone.replace(/_/g, ' ')} time.`));
  return out;
}

// ---------------------------------------------------------------- one action, in detail

export async function eventSheet(openSheet, query, name, ctx) {
  const body = h('div', { class: 'sheet-body' }, h('p', { class: 'empty', text: 'Loading…' }));
  openSheet(name, body);
  let d;
  try {
    d = await api(`event?${query}&name=${encodeURIComponent(name)}`);
  } catch (err) {
    return clear(body, h('p', { class: 'error', text: err.message }));
  }
  const keys = Object.keys(d.props);
  const views = [...keys.map((k) => ({ title: k.replace(/_/g, ' '), rows: d.props[k] })), { title: 'page', rows: d.pages }, { title: 'source', rows: d.sources }];
  let current = views[0];
  const listHost = h('div');
  const tabHost = h('div');
  const draw = () => {
    clear(tabHost, h('div', { class: 'tabs', style: { marginLeft: 0 } }, views.map((v) => h('button', { class: 'tab', type: 'button', 'aria-selected': String(v === current), text: 'By ' + v.title, onclick: () => { current = v; draw(); } }))));
    clear(listHost, rank(current.rows, { heading: current.title, cols: ['Times', 'People'], figures: (r) => [num(r.count), num(r.visitors)], size: (r) => r.count, label: (r) => r.name, limit: 12 }));
  };
  const chartHost = h('div', { class: 'chart' });
  const isKey = ctx.site.key_events.includes(name);
  clear(body,
    h('div', { class: 'card' },
      h('div', { class: 'row-flex' },
        h('div', { class: 'grow' }, h('div', { style: { fontSize: '30px', fontWeight: 670, letterSpacing: '-0.02em', lineHeight: 1.1 }, text: full(d.total) }), h('p', { text: `times, ${d.range.label.toLowerCase()}` })),
        h('button', { class: 'btn small ' + (isKey ? 'quiet' : ''), type: 'button', onclick: () => ctx.toggleKey(name) }, icon('star', isKey), isKey ? 'Key action' : 'Make it a key action')),
      d.series.length > 1 ? chartHost : null),
    h('div', { class: 'card' }, tabHost, listHost));
  draw();
  if (d.series.length > 1) {
    lineChart(chartHost, { name, values: d.series.map((x) => x.count), labels: d.series.map((x) => bucketLabel(x.t, 'day')), longLabels: d.series.map((x) => bucketLabel(x.t, 'day', true)), partial: d.range.partial, format: full });
  }
  return null;
}

export { toast };
