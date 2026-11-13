// Settings: websites, the snippet, key journeys, integrations, tagged links, password.

import { api, clear, copy, h, icon, toast } from './lib.js';

const META_PARAMS = 'utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_id={{campaign.id}}';

export const snippet = (site) => `<script defer src="${location.origin}/t.js" data-site="${site.id}"></script>`;

/** The tag to paste into Google Tag Manager on a booking portal that will not load outside scripts. */
function portalTag(site) {
  return `<script>
(function () {
  var site = "${site.id}", api = "${location.origin}/e";
  var names = { "family-created": "Account created", "added-to-cart": "Added to cart", "checkout-started": "Checkout started", "checkout-complete": "Enrollment complete" };
  var ev = {{Event}};
  function send(o) { o.s = site; o.u = location.href; try { navigator.sendBeacon(api, JSON.stringify(o)); } catch (e) {} }
  if (ev === "gtm.js" || ev === "gtm.historyChange") {
    if (window.__matsideAt === location.pathname) return;
    window.__matsideAt = location.pathname;
    send({ n: "pageview", p: Math.random().toString(36).slice(2, 12), r: document.referrer, w: innerWidth });
  } else if (Object.prototype.hasOwnProperty.call(names, ev)) send({ n: names[ev] });
})();
</script>`;
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, label, input, hint ? h('small', { text: hint }) : null);
}

function timezones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London'];
  }
}

function form(onSubmit, ...kids) {
  const status = h('p', { class: 'error', hidden: true, role: 'alert' });
  const el = h('form', { style: { display: 'grid', gap: '12px' }, onsubmit: async (ev) => {
    ev.preventDefault();
    const button = el.querySelector('button[type="submit"]');
    status.hidden = true;
    if (button) button.disabled = true;
    try {
      await onSubmit(new FormData(el), el);
    } catch (err) {
      status.textContent = err.message;
      status.className = 'error';
      status.hidden = false;
    } finally {
      if (button) button.disabled = false;
    }
  } }, ...kids, status);
  return el;
}

function fold(title, { open = false, id = '' } = {}, ...kids) {
  return h('details', { class: 'fold card', open, id: id || null }, h('summary', null, title), h('div', { class: 'inner' }, ...kids));
}

/**
 * @param {object} ctx  { sites, session, onSitesChanged(sites, pickId?), signOut, body }
 * @param {string} [focus]  'add' | 'journey' | 'ads' | a site id
 */
export function settingsBody(ctx, focus) {
  const body = h('div', { class: 'sheet-body' });
  const render = () => {
    clear(body,
      ctx.sites.map((site) => siteFold(site, ctx, render, focus)),
      addSite(ctx, render, focus === 'add' || !ctx.sites.length),
      linkBuilder(ctx),
      ctx.session.demo ? null : passwordFold(ctx),
      h('p', { class: 'foot' }, 'Matside is open source. No cookies, no visitor profiles, your data in your own Cloudflare account.'));
    const target = focus && body.querySelector(`[data-focus="${focus}"]`);
    if (target) setTimeout(() => target.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  };
  render();
  return body;
}

function siteFold(site, ctx, render, focus) {
  const open = focus === site.id || ((focus === 'journey' || focus === 'ads') && ctx.currentId === site.id) || ctx.sites.length === 1;
  const save = async (changes, message = 'Saved') => {
    const r = await api('sites/' + site.id, { method: 'PUT', body: changes });
    ctx.onSitesChanged(ctx.sites.map((s) => (s.id === site.id ? r.site : s)));
    toast(message);
    render();
  };

  // ---- basics
  const basics = form(async (data) => {
    await save({
      name: data.get('name'), domain: data.get('domain'), timezone: data.get('timezone'),
      hosts: String(data.get('hosts') || '').split(',').map((x) => x.trim()).filter(Boolean),
      portals: String(data.get('portals') || '').split(',').map((x) => x.trim()).filter(Boolean),
      filter_dc: data.get('filter_dc') === 'on',
    });
  },
    field('Name', h('input', { name: 'name', value: site.name, required: true, maxlength: 60 })),
    field('Web address', h('input', { name: 'domain', value: site.domain, required: true, inputmode: 'url', autocapitalize: 'none', autocorrect: 'off' })),
    field('Time zone', h('input', { name: 'timezone', value: site.timezone, list: 'timezones', autocapitalize: 'none' }), 'Decides when a day starts and ends.'),
    field('Other addresses for the same site', h('input', { name: 'hosts', value: site.hosts.join(', '), autocapitalize: 'none', autocorrect: 'off', placeholder: 'shop.example.com' }), 'Separate with commas. “www.” is included already.'),
    field('Booking or checkout portal', h('input', { name: 'portals', value: site.portals.join(', '), autocapitalize: 'none', autocorrect: 'off', placeholder: 'portal.example.com/yourname' }), 'A separate app this site sends people to. Its pages are listed apart, in the same visit.'),
    h('label', { class: 'row-flex', style: { fontSize: '13.5px' } }, h('input', { type: 'checkbox', name: 'filter_dc', checked: site.filter_dc }), 'Leave out traffic from data centres (almost always automated)'),
    h('div', null, h('button', { class: 'btn small', type: 'submit', text: 'Save' })));

  // ---- the snippet
  const statusLine = h('p', { hidden: true });
  const check = async () => {
    statusLine.hidden = false;
    statusLine.className = '';
    statusLine.textContent = 'Checking…';
    try {
      const r = await api(`sites/${site.id}/status`);
      if (r.last_hit) {
        statusLine.className = 'okay';
        statusLine.textContent = `Working. Last page view ${Math.max(0, Math.round((r.now - r.last_hit) / 60))} minutes ago (${r.hits} since yesterday).`;
      } else {
        const filtered = r.filtered.reduce((n, x) => n + x.n, 0);
        statusLine.className = 'error';
        statusLine.textContent = filtered
          ? `Reports are arriving but being left out (${r.filtered.map((x) => `${x.n} ${x.reason.replace(/-/g, ' ')}`).join(', ')}). Check the web address above matches the site.`
          : 'Nothing yet. Add the line to the site, open one of its pages in a normal browser, then check again.';
      }
    } catch (err) {
      statusLine.className = 'error';
      statusLine.textContent = err.message;
    }
  };
  const install = h('div', { style: { display: 'grid', gap: '10px' } },
    h('h3', { text: 'The line to add to the website' }),
    h('p', { text: 'Paste it once into the <head> of every page (most site builders have a “custom code” box for this).' }),
    h('pre', { class: 'code', text: snippet(site) }),
    h('div', { class: 'row-flex' },
      h('button', { class: 'btn small quiet', type: 'button', onclick: () => copy(snippet(site), 'Line copied') }, icon('copy'), 'Copy'),
      h('button', { class: 'btn small quiet', type: 'button', onclick: check }, icon('check'), 'Check it is working'),
      h('a', { class: 'btn small quiet', href: `https://${site.domain}/?matside=off`, target: '_blank', rel: 'noopener' }, 'Leave this device out')),
    statusLine);

  // ---- journey
  let steps = site.funnel.map((x) => ({ ...x }));
  const stepHost = h('div', { style: { display: 'grid', gap: '8px' } });
  const drawSteps = () => clear(stepHost,
    steps.length ? null : h('p', { text: 'No steps yet, so the dashboard shows a simple one: visited, looked around, took a key action.' }),
    steps.map((step, i) => h('div', { class: 'row-flex' },
      h('select', { style: { height: '40px', borderRadius: '10px', border: '1px solid var(--axis)', background: 'var(--surface)', padding: '0 8px' }, onchange: (ev) => { step.type = ev.target.value; }, 'aria-label': 'Kind of step' },
        h('option', { value: 'page', selected: step.type !== 'event', text: 'Saw page' }), h('option', { value: 'event', selected: step.type === 'event', text: 'Did action' })),
      h('input', { class: 'grow', style: { height: '40px', borderRadius: '10px', border: '1px solid var(--axis)', background: 'var(--surface)', padding: '0 10px', minWidth: '120px', fontSize: '16px' }, value: step.match, placeholder: step.type === 'event' ? 'Registration click' : '/programs/*', 'aria-label': 'Page address or action name', autocapitalize: 'none', oninput: (ev) => { step.match = ev.target.value; step.label = ev.target.value; } }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove this step', onclick: () => { steps.splice(i, 1); drawSteps(); } }, icon('close')))));
  drawSteps();
  const journey = h('div', { 'data-focus': 'journey', style: { display: 'grid', gap: '10px' } },
    h('h3', { text: 'The journey' }),
    h('p', { text: 'The steps you hope a visit takes, in order. Use * for “anything”: /programs/* means any program page.' }),
    stepHost,
    h('div', { class: 'row-flex' },
      steps.length < 6 ? h('button', { class: 'btn small quiet', type: 'button', onclick: () => { if (steps.length < 6) { steps.push({ type: 'page', match: '', label: '' }); drawSteps(); } } }, icon('plus'), 'Add a step') : null,
      h('button', { class: 'btn small', type: 'button', text: 'Save the journey', onclick: () => save({ funnel: steps.filter((x) => x.match.trim()) }, 'Journey saved').catch((e) => toast(e.message)) })));

  // ---- integrations
  const ic = site.integrations.iclasspro;
  const classes = form(async (data) => {
    const account = String(data.get('account') || '').trim();
    await save({ integrations: { ...site.integrations, iclasspro: account ? { account } : undefined } }, account ? 'Connected. The first reading takes a moment.' : 'Disconnected');
  },
    h('h3', { text: 'Class sizes from iClassPro' }),
    h('p', { text: 'Shows open spots per class and counts spots as they fill. Needs only the short name in your portal address (portal.iclasspro.com/yourname). No password.' }),
    field('iClassPro account name', h('input', { name: 'account', value: ic?.account || '', autocapitalize: 'none', autocorrect: 'off', placeholder: 'yourname' })),
    h('div', null, h('button', { class: 'btn small', type: 'submit', text: ic ? 'Update' : 'Connect' })));

  const meta = site.integrations.meta;
  const ads = h('div', { 'data-focus': 'ads', style: { display: 'grid', gap: '12px' } },
    h('h3', { text: 'Facebook and Instagram ads' }),
    h('p', { text: 'Step 1 works on its own: paste this into the “URL parameters” box of each ad (Ads Manager, at the ad level, under Tracking). Every visit from that ad is then matched to its campaign.' }),
    h('pre', { class: 'code', text: META_PARAMS }),
    h('div', null, h('button', { class: 'btn small quiet', type: 'button', onclick: () => copy(META_PARAMS, 'URL parameters copied') }, icon('copy'), 'Copy')),
    h('p', { text: 'Step 2 is optional and adds what each campaign cost: your ad account ID and a read-only access token (ads_read). The token is stored in your own database and never shown again.' }),
    form(async (data) => {
      const account = String(data.get('ad_account') || '').trim();
      await save({ integrations: { ...site.integrations, meta: account ? { ad_account: account } : undefined } }, account ? 'Saved' : 'Disconnected');
      const token = String(data.get('token') || '').trim();
      if (account && token) {
        const r = await api(`sites/${site.id}/secret`, { method: 'POST', body: { name: 'meta_token', value: token } });
        toast(r.report?.meta?.ok ? 'Connected to Meta' : `Meta said no: ${r.report?.meta?.message || 'check the token'}`);
      }
    },
      field('Ad account ID', h('input', { name: 'ad_account', value: meta?.ad_account || '', inputmode: 'numeric', placeholder: '1234567890' })),
      field('Access token', h('input', { name: 'token', type: 'password', autocomplete: 'off', placeholder: meta ? 'Leave empty to keep the one on file' : '' })),
      h('div', null, h('button', { class: 'btn small', type: 'submit', text: meta ? 'Update' : 'Connect' }))));

  const portal = site.portals.length
    ? h('div', { style: { display: 'grid', gap: '10px' } },
        h('h3', { text: 'Following visitors onto the portal' }),
        h('p', { text: 'A portal that only allows Google Tag Manager cannot load the usual line. Add this as a Custom HTML tag in your container instead, firing on All Pages, History Change, and the portal’s own events. See docs/portals.md for the steps.' }),
        h('pre', { class: 'code', text: portalTag(site) }),
        h('div', null, h('button', { class: 'btn small quiet', type: 'button', onclick: () => copy(portalTag(site), 'Tag copied') }, icon('copy'), 'Copy')))
    : null;

  // ---- removing
  const remove = h('div', { style: { display: 'grid', gap: '8px' } },
    h('button', { class: 'btn small danger', type: 'button', style: { justifySelf: 'start' }, text: 'Delete this website and its data', onclick: async () => {
      if (prompt(`This erases every number for ${site.name} and cannot be undone.\nType the website's name to confirm:`) !== site.name) return;
      try {
        await api('sites/' + site.id, { method: 'DELETE' });
        ctx.onSitesChanged(ctx.sites.filter((s) => s.id !== site.id));
        toast('Deleted');
        render();
      } catch (err) {
        toast(err.message);
      }
    } }));

  const hr = () => h('hr', { style: { border: 0, borderTop: '1px solid var(--border)', width: '100%', margin: 0 } });
  return fold([h('span', { class: `dot c${site.color}` }), h('span', { class: 'grow', text: site.name })], { open, id: 'site-' + site.id },
    install, hr(), basics, hr(), journey, hr(), classes, hr(), ads, portal ? hr() : null, portal, hr(), remove);
}

function addSite(ctx, render, open) {
  const zone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  })();
  return fold([icon('plus'), 'Add a website'], { open, id: 'add-site' },
    h('datalist', { id: 'timezones' }, timezones().map((z) => h('option', { value: z }))),
    form(async (data) => {
      const r = await api('sites', { method: 'POST', body: { name: data.get('name'), domain: data.get('domain'), timezone: data.get('timezone') } });
      ctx.onSitesChanged([...ctx.sites, r.site], r.site.id);
      toast('Added. Now add the line below to the site.');
      ctx.reopen(r.site.id);
    },
      field('Name', h('input', { name: 'name', required: true, maxlength: 60, placeholder: 'My Business' })),
      field('Web address', h('input', { name: 'domain', required: true, inputmode: 'url', autocapitalize: 'none', autocorrect: 'off', placeholder: 'example.com' })),
      field('Time zone', h('input', { name: 'timezone', value: zone, list: 'timezones', autocapitalize: 'none' })),
      h('div', null, h('button', { class: 'btn', type: 'submit', text: 'Add website' }))));
}

function linkBuilder(ctx) {
  const out = h('pre', { class: 'code', text: 'Fill in the boxes above.' });
  const build = (el) => {
    const data = new FormData(el);
    let base = String(data.get('url') || '').trim();
    if (!base) return (out.textContent = 'Fill in the boxes above.');
    if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
    try {
      const url = new URL(base);
      for (const key of ['source', 'medium', 'campaign']) {
        const v = String(data.get(key) || '').trim();
        if (v) url.searchParams.set('utm_' + key, v);
      }
      out.textContent = url.href;
    } catch {
      out.textContent = 'That address does not look right.';
    }
    return null;
  };
  const el = h('form', { style: { display: 'grid', gap: '12px' }, oninput: () => build(el), onsubmit: (ev) => ev.preventDefault() },
    h('p', { text: 'For anything that is not an ad platform: an email, a flyer, a QR code, a link in a bio. People who arrive through the link are counted under the names you choose.' }),
    field('Page to send people to', h('input', { name: 'url', inputmode: 'url', autocapitalize: 'none', autocorrect: 'off', placeholder: ctx.sites[0] ? `${ctx.sites[0].domain}/` : 'example.com/' })),
    field('Where the link will be', h('input', { name: 'source', autocapitalize: 'none', placeholder: 'flyer, newsletter, qr, instagram' })),
    field('Kind', h('input', { name: 'medium', autocapitalize: 'none', placeholder: 'print, email, social' }), 'Optional. “email” and “social” are sorted into those channels.'),
    field('Campaign name', h('input', { name: 'campaign', placeholder: 'Spring sign-up' })),
    out,
    h('div', null, h('button', { class: 'btn small quiet', type: 'button', onclick: () => /^https?:/.test(out.textContent) && copy(out.textContent, 'Link copied') }, icon('copy'), 'Copy the link')));
  return fold([icon('link'), 'Make a tagged link'], { id: 'links' }, el);
}

function passwordFold(ctx) {
  return fold([icon('gear'), 'Password and sign-out'], { id: 'account' },
    form(async (data, el) => {
      if (data.get('password') !== data.get('again')) throw new Error('The two new passwords do not match.');
      await api('password', { method: 'POST', body: { current: data.get('current'), password: data.get('password') } });
      el.reset();
      toast('Password changed. Other devices are signed out.');
    },
      field('Current password', h('input', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' })),
      field('New password', h('input', { name: 'password', type: 'password', required: true, minlength: 10, autocomplete: 'new-password' }), 'At least 10 characters.'),
      field('New password again', h('input', { name: 'again', type: 'password', required: true, minlength: 10, autocomplete: 'new-password' })),
      h('div', null, h('button', { class: 'btn small', type: 'submit', text: 'Change password' }))),
    h('div', null, h('button', { class: 'btn small quiet', type: 'button', onclick: ctx.signOut }, icon('out'), 'Sign out of this device')));
}
