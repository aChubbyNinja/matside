// Matside dashboard: start-up, signing in, the top bar, the all-websites page, and loading data.

import { hideTip, sparkline } from './charts.js';
import { eventSheet, renderSite } from './dashboard.js';
import { ago, api, change, clear, full, h, icon, logo, num, store, toast, whenSignedOut } from './lib.js';
import { settingsBody, snippet } from './settings.js';

const RANGES = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'],
  ['month', 'This month'], ['lastmonth', 'Last month'], ['12mo', '12 months'], ['custom', 'Custom'],
];
const FILTER_NAMES = { channel: 'Channel', source: 'Source', campaign: 'Campaign', country: 'Country', region: 'Region', city: 'City', device: 'Device', browser: 'Browser', os: 'System', entry: 'First page', exit: 'Last page', page: 'Page', event: 'Action' };

const state = {
  session: null,
  sites: [],
  site: store.get('site', 'all'),
  range: store.get('range', { key: '30d' }),
  filters: [],
  metric: 'visitors',
  tab: store.get('tabs', {}),
  data: null,
  overview: null,
  live: null,
};

const app = document.getElementById('app');
let header = null;
let main = null;
let seq = 0;
let loadedAt = 0;

// ---------------------------------------------------------------- theme

function applyTheme() {
  const theme = store.get('theme', 'auto');
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0d0d' : '#f6f6f3');
}

// ---------------------------------------------------------------- menus and sheets

let closeMenu = () => {};
function menu(anchor, build) {
  closeMenu();
  const el = h('div', { class: 'menu', role: 'menu' });
  build(el, () => closeMenu());
  document.body.append(el);
  const a = anchor.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  el.style.top = Math.min(a.bottom + 6, innerHeight - box.height - 8) + 'px';
  el.style.left = Math.max(8, Math.min(a.left, innerWidth - box.width - 8)) + 'px';
  const outside = (ev) => { if (!el.contains(ev.target) && !anchor.contains(ev.target)) closeMenu(); };
  const key = (ev) => { if (ev.key === 'Escape') { closeMenu(); anchor.focus(); } };
  setTimeout(() => { addEventListener('pointerdown', outside); addEventListener('keydown', key); });
  closeMenu = () => { el.remove(); removeEventListener('pointerdown', outside); removeEventListener('keydown', key); closeMenu = () => {}; };
  el.querySelector('button, a')?.focus();
}

let closeSheet = () => {};
function openSheet(title, body) {
  closeSheet();
  hideTip();
  const back = document.activeElement;
  const scrim = h('div', { class: 'scrim', onclick: () => closeSheet() });
  const closer = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => closeSheet() }, icon('close'));
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', { class: 'grow', text: title }), closer), body);
  const key = (ev) => { if (ev.key === 'Escape') closeSheet(); };
  document.body.append(scrim, sheet);
  document.body.style.overflow = 'hidden';
  addEventListener('keydown', key);
  closer.focus();
  closeSheet = () => {
    scrim.remove();
    sheet.remove();
    document.body.style.overflow = '';
    removeEventListener('keydown', key);
    closeSheet = () => {};
    back?.focus?.();
  };
}

// ---------------------------------------------------------------- signing in

function gate(mode, code = '') {
  document.title = 'Matside';
  const error = h('p', { class: 'error', hidden: true, role: 'alert' });
  const password = h('input', { type: 'password', name: 'password', required: true, autocomplete: mode === 'setup' ? 'new-password' : 'current-password', minlength: mode === 'setup' ? 10 : null, autofocus: true });
  const again = mode === 'setup' ? h('input', { type: 'password', name: 'again', required: true, autocomplete: 'new-password', minlength: 10 }) : null;
  const button = h('button', { class: 'btn', type: 'submit', text: mode === 'setup' ? 'Create my dashboard' : 'Sign in' });
  const needsLink = mode === 'setup' && state.session.setup_code && !code;
  clear(app, h('div', { class: 'gate' }, h('form', {
    onsubmit: async (ev) => {
      ev.preventDefault();
      error.hidden = true;
      if (again && again.value !== password.value) {
        error.textContent = 'The two passwords do not match.';
        error.hidden = false;
        return;
      }
      button.disabled = true;
      try {
        await api(mode, { method: 'POST', body: { password: password.value, code } });
        history.replaceState(null, '', location.pathname);
        await boot();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        button.disabled = false;
      }
    },
  },
    h('div', { class: 'brand' }, logo(), h('span', { text: 'Matside' })),
    needsLink
      ? h('p', { text: 'This dashboard has not been claimed yet. Open the setup link you were given to choose its password.' })
      : [
          h('p', { text: mode === 'setup' ? 'Welcome. Choose the password for this dashboard. There is no reset by email, so keep it somewhere safe.' : 'Your websites, in plain numbers.' }),
          h('label', { class: 'field' }, mode === 'setup' ? 'Choose a password' : 'Password', password, mode === 'setup' ? h('small', { text: 'At least 10 characters.' }) : null),
          again ? h('label', { class: 'field' }, 'The same password again', again) : null,
          error,
          button,
        ])));
}

async function signOut() {
  closeSheet();
  await api('logout', { method: 'POST' }).catch(() => {});
  state.session = { authed: false };
  gate('login');
}

// ---------------------------------------------------------------- data

const currentSite = () => state.sites.find((s) => s.id === state.site) || null;

function query() {
  const p = new URLSearchParams({ site: state.site, range: state.range.key });
  if (state.range.key === 'custom') {
    p.set('from', state.range.from || '');
    p.set('to', state.range.to || '');
  }
  if (state.filters.length) p.set('f', state.filters.map(([k, v]) => `${k}:${encodeURIComponent(v)}`).join(';'));
  return p.toString();
}

async function load() {
  const my = ++seq;
  hideTip();
  main.classList.add('loading');
  try {
    if (!state.sites.length) return renderWelcome();
    if (state.site === 'all') {
      const r = await api('overview');
      if (my !== seq) return;
      state.overview = r.sites;
      renderOverview();
    } else {
      const d = await api('stats?' + query());
      if (my !== seq) return;
      state.data = d;
      renderSiteView();
      pollLive();
    }
    loadedAt = Date.now();
  } catch (err) {
    if (my === seq && err.status !== 401) clear(main, h('div', { class: 'card' }, h('p', { class: 'error', text: err.message }), h('p', { style: { marginTop: '10px' } }, h('button', { class: 'btn small quiet', type: 'button', text: 'Try again', onclick: load }))));
  } finally {
    if (my === seq) main.classList.remove('loading');
    renderHeader();
  }
}

async function pollLive() {
  if (state.site === 'all' || document.hidden) return;
  const id = state.site;
  try {
    const r = await api('live?site=' + encodeURIComponent(id));
    if (state.site !== id) return;
    state.live = r;
    renderHeader();
  } catch { /* the next tick will try again */ }
}

function pick(siteId) {
  state.site = siteId;
  state.filters = [];
  state.live = null;
  state.data = null;
  store.set('site', siteId);
  scrollTo(0, 0);
  load();
}

function setRange(key, from, to) {
  state.range = key === 'custom' ? { key, from, to } : { key };
  store.set('range', state.range);
  load();
}

// ---------------------------------------------------------------- top bar

function renderHeader() {
  const site = currentSite();
  const liveCount = state.site === 'all' ? (state.overview || []).reduce((n, s) => n + s.live, 0) : state.live?.now ?? 0;
  const picker = h('button', { class: 'pick', type: 'button', 'aria-haspopup': 'menu', onclick: () => menu(picker, (el, done) => {
    el.append(h('button', { type: 'button', role: 'menuitem', onclick: () => { done(); pick('all'); } }, icon('grid'), 'All websites'));
    for (const s of state.sites) {
      const today = state.overview?.find((x) => x.id === s.id)?.today.visitors;
      el.append(h('button', { type: 'button', role: 'menuitem', onclick: () => { done(); pick(s.id); } }, h('span', { class: `dot c${s.color}` }), h('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: s.name }), today != null ? h('small', { text: full(today) + ' today' }) : null));
    }
    el.append(h('hr'), h('button', { type: 'button', role: 'menuitem', onclick: () => { done(); openSettings('add'); } }, icon('plus'), 'Add a website'));
  }) }, site ? h('span', { class: `dot c${site.color}` }) : icon('grid'), h('b', { text: site ? site.name : 'All websites' }), icon('chevron'));

  const dots = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Menu', 'aria-haspopup': 'menu', onclick: () => menu(dots, (el, done) => {
    const theme = store.get('theme', 'auto');
    const next = { auto: 'dark', dark: 'light', light: 'auto' }[theme];
    el.append(
      h('button', { type: 'button', role: 'menuitem', onclick: () => { done(); openSettings(state.site === 'all' ? undefined : state.site); } }, icon('gear'), 'Settings'),
      h('button', { type: 'button', role: 'menuitem', onclick: () => { done(); load(); } }, icon('refresh'), 'Refresh'),
      h('button', { type: 'button', role: 'menuitem', onclick: () => { store.set('theme', next); applyTheme(); done(); } }, icon('sun'), 'Appearance', h('small', { text: { auto: 'Automatic', dark: 'Dark', light: 'Light' }[theme] })),
      state.session.demo ? null : h('hr'),
      state.session.demo ? null : h('button', { type: 'button', role: 'menuitem', onclick: () => { done(); signOut(); } }, icon('out'), 'Sign out'));
  }) }, icon('dots'));

  const livePill = h('button', { class: 'live' + (liveCount ? ' on' : ''), type: 'button', 'aria-label': `${liveCount} online now`, onclick: () => (state.site === 'all' ? null : openLive()) },
    h('i'), full(liveCount), h('span', { class: 'wide-only', text: ' online' }));

  const rows = [h('div', { class: 'top-row' }, h('a', { class: 'brand', href: '/', 'aria-label': 'Matside', onclick: (ev) => { ev.preventDefault(); pick(state.sites.length === 1 ? state.sites[0].id : 'all'); } }, logo(), h('span', { text: 'Matside' })), picker, h('span', { class: 'grow' }), livePill, dots)];

  if (state.site !== 'all' && state.sites.length) {
    rows.push(h('div', { class: 'chips', role: 'group', 'aria-label': 'Date range' },
      RANGES.map(([key, label]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.range.key === key), text: label, onclick: () => {
        if (key !== 'custom') return setRange(key);
        const today = new Date().toISOString().slice(0, 10);
        const from = state.data?.range.from || today;
        return setRange('custom', state.range.from || from, state.range.to || state.data?.range.to || today);
      } }))));
    if (state.range.key === 'custom') {
      const from = h('input', { type: 'date', value: state.range.from || '', 'aria-label': 'From' });
      const to = h('input', { type: 'date', value: state.range.to || '', 'aria-label': 'To' });
      const go = () => from.value && to.value && from.value <= to.value && setRange('custom', from.value, to.value);
      from.addEventListener('change', go);
      to.addEventListener('change', go);
      rows.push(h('div', { class: 'custom-range' }, 'From', from, 'to', to));
    }
    if (state.filters.length) {
      rows.push(h('div', { class: 'chips', role: 'group', 'aria-label': 'Filters' },
        state.filters.map(([k, v], i) => h('button', { class: 'chip filter', type: 'button', 'aria-label': `Remove filter ${FILTER_NAMES[k]}: ${v}`, onclick: () => { state.filters.splice(i, 1); load(); } }, `${FILTER_NAMES[k]}: ${String(v).split('|').filter(Boolean).pop()}`, icon('close'))),
        h('button', { class: 'chip', type: 'button', text: 'Clear', onclick: () => { state.filters = []; load(); } })));
    }
  }
  clear(header, h('div', { class: 'wrap' }, rows));
  document.title = (site ? site.name : 'All websites') + ' · Matside';
}

// ---------------------------------------------------------------- pages

function renderWelcome() {
  clear(main, h('div', { class: 'card', style: { textAlign: 'center', padding: '36px 20px', display: 'grid', gap: '12px', justifyItems: 'center' } },
    h('div', { class: 'brand', style: { fontSize: '20px' } }, logo()),
    h('h2', { style: { fontSize: '20px' }, text: 'Add your first website' }),
    h('p', { style: { color: 'var(--text-2)', maxWidth: '420px' }, text: 'Give it a name and its address, paste one line into the site, and visits start showing up here within seconds.' }),
    h('button', { class: 'btn', type: 'button', onclick: () => openSettings('add') }, icon('plus'), 'Add a website')));
}

function renderOverview() {
  const cards = state.overview.map((s) => {
    const delta = change(s.week.visitors, s.prev_week.visitors);
    const waiting = !s.last_hit && !s.week.visits;
    return h('button', { class: `card site-card c${s.color}`, type: 'button', onclick: () => pick(s.id) },
      h('div', { class: 'title' }, h('span', { class: 'dot' }), h('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: s.name }), s.live ? h('span', { class: 'live on', style: { height: '28px' } }, h('i'), full(s.live)) : null),
      h('div', { class: 'domain', text: s.domain }),
      waiting
        ? h('p', { style: { color: 'var(--text-2)', fontSize: '13.5px', padding: '8px 0 4px' }, text: 'Waiting for the first visit. Tap to get the line to add to the site.' })
        : [
            h('div', { class: 'big' }, h('span', { class: 'value', text: num(s.today.visitors) }), h('span', { class: 'cap', text: s.today.visitors === 1 ? 'visitor today' : 'visitors today' })),
            sparkline(s.series.slice(0, -1), { accent: 'currentColor', fill: true }),
            h('div', { class: 'facts' },
              h('div', null, 'Last 7 days', h('b', null, num(s.week.visitors), delta ? h('span', { class: 'delta ' + delta.tone, style: { marginLeft: '6px' }, text: `${delta.arrow} ${delta.text}`.trim() }) : null)),
              h('div', null, 'Top source', h('b', { text: s.top_source || '–' })),
              h('div', null, 'Key actions, 7 days', h('b', { text: num(s.week.actions) })),
              h('div', null, 'Last visit', h('b', { text: s.last_hit ? ago(Math.floor(Date.now() / 1000) - s.last_hit) : '–' }))),
          ]);
  });
  clear(main, h('div', { class: 'sites' }, cards, h('button', { class: 'card add-card', type: 'button', onclick: () => openSettings('add') }, h('span', null, icon('plus'), h('br'), 'Add a website'))));
  cards.forEach((c) => { const sp = c.querySelector('.spark'); if (sp) sp.style.color = `var(--s${state.overview[cards.indexOf(c)].color})`; });
}

function renderSiteView() {
  const site = currentSite();
  const d = state.data;
  if (!site || !d) return;
  const my = seq;
  const q = query();
  const ctx = {
    site,
    state,
    setMetric: (m) => { state.metric = m; renderSiteView(); },
    setTab: (k, v) => { state.tab[k] = v; store.set('tabs', state.tab); renderSiteView(); },
    addFilter: (k, v) => { if (!state.filters.some(([a, b]) => a === k && b === v)) { state.filters = state.filters.filter(([a]) => a !== k).concat([[k, v]]); scrollTo(0, 0); load(); } },
    openEvent: (name) => eventSheet(openSheet, q, name, ctx),
    openSettings,
    toggleKey,
    lazy: (kind, ok, fail) => {
      api(`${kind}?${q}`).then((r) => { if (my === seq) ok(r); }).catch(() => { if (my === seq) fail(); });
    },
  };
  const nothingEver = !d.totals.visits && !d.prev.visits && !state.filters.length && !site.integrations.iclasspro;
  if (nothingEver) {
    clear(main, h('div', { class: 'card', style: { display: 'grid', gap: '12px' } },
      h('h2', { style: { fontSize: '18px' }, text: 'Waiting for the first visit' }),
      h('p', { style: { color: 'var(--text-2)' }, text: `Add this line to the <head> of every page on ${site.domain}. Then open the site in a normal browser and come back here.` }),
      h('pre', { class: 'code', text: snippet(site) }),
      h('div', { class: 'row-flex' }, h('button', { class: 'btn small', type: 'button', onclick: () => navigator.clipboard.writeText(snippet(site)).then(() => toast('Line copied')) }, icon('copy'), 'Copy the line'), h('button', { class: 'btn small quiet', type: 'button', text: 'More options', onclick: () => openSettings(site.id) })),
      h('p', { class: 'card-note', text: 'Nothing recorded in this period or the one before it. If the site is already set up, try a longer date range.' })));
    return;
  }
  clear(main, renderSite(d, ctx));
}

async function toggleKey(name) {
  const site = currentSite();
  if (!site) return;
  const keys = new Set(site.key_events);
  const on = !keys.has(name);
  if (on) keys.add(name);
  else keys.delete(name);
  try {
    const r = await api('sites/' + site.id, { method: 'PUT', body: { key_events: [...keys] } });
    state.sites = state.sites.map((s) => (s.id === site.id ? r.site : s));
    closeSheet();
    toast(on ? `“${name}” is now a key action. Recounting…` : `“${name}” is no longer a key action. Recounting…`);
    setTimeout(load, 1500);
  } catch (err) {
    toast(err.message);
  }
}

function openLive() {
  const r = state.live;
  const body = h('div', { class: 'sheet-body' },
    h('div', { class: 'card' },
      h('div', { style: { fontSize: '30px', fontWeight: 670, lineHeight: 1.1 }, text: full(r?.now || 0) }),
      h('p', { text: 'people on the site in the last 5 minutes' })),
    h('div', { class: 'card' }, h('h3', { text: 'The last half hour' }),
      r?.recent?.length
        ? h('ul', { class: 'feed' }, r.recent.map((x) => h('li', null,
            h('span', { class: 'what', text: x.kind === 'event' ? x.name : x.path }),
            h('span', { class: 'ago', text: ago(x.ago) }),
            h('span', { class: 'meta', text: [x.kind === 'event' ? `on ${x.path}` : 'Page view', x.source, x.place, x.device].filter(Boolean).join(' · ') }))))
        : h('p', { class: 'empty', text: 'Quiet right now.' })));
  openSheet('Right now', body);
}

function openSettings(focus) {
  const ctx = {
    sites: state.sites,
    session: state.session,
    currentId: state.site,
    signOut,
    onSitesChanged: (sites, pickId) => {
      state.sites = sites;
      ctx.sites = sites;
      if (pickId) { state.site = pickId; store.set('site', pickId); state.filters = []; }
      if (state.site !== 'all' && !sites.some((s) => s.id === state.site)) { state.site = 'all'; store.set('site', 'all'); }
      load();
    },
    reopen: (id) => openSettings(id),
  };
  openSheet('Settings', settingsBody(ctx, focus));
}

// ---------------------------------------------------------------- start

async function boot() {
  applyTheme();
  try {
    state.session = await api('session');
  } catch (err) {
    clear(app, h('div', { class: 'gate' }, h('p', { class: 'error', text: err.message })));
    return;
  }
  const code = new URLSearchParams(location.hash.slice(1)).get('setup') || '';
  if (state.session.needs_setup) return gate('setup', code);
  if (!state.session.authed) return gate('login');

  header = h('header', { class: 'top' });
  main = h('main', { class: 'wrap' });
  clear(app, header, main);
  state.sites = (await api('sites')).sites;
  if (state.site !== 'all' && !currentSite()) state.site = 'all';
  if (state.site === 'all' && state.sites.length === 1) state.site = state.sites[0].id;
  renderHeader();
  await load();
}

whenSignedOut(() => { closeSheet(); gate('login'); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
setInterval(pollLive, 20_000);
// Fresh numbers when the phone comes back out of a pocket.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && main && state.session?.authed && Date.now() - loadedAt > 120_000 && !document.querySelector('.sheet')) load();
});
setInterval(() => { if (!document.hidden && main && state.session?.authed && Date.now() - loadedAt > 300_000 && !document.querySelector('.sheet')) load(); }, 60_000);
boot();
