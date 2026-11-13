// Demo data: two made-up businesses with three months of believable traffic.
//
//   npm run dev                       (once, in another terminal: it creates the local database)
//   npm run seed                      writes seed.sql and loads it into the LOCAL database
//
// Nothing here touches a deployed dashboard. Use it to try Matside, to work on the dashboard
// without waiting for real visitors, or to take screenshots.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DAYS = 100;
const TZ = 'America/Denver';

// A small seeded generator, so every run draws the same picture.
let seed = 20261113;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (pairs) => {
  let r = rand() * pairs.reduce((n, p) => n + p[1], 0);
  for (const p of pairs) if ((r -= p[1]) <= 0) return p[0];
  return pairs[0][0];
};
const id = (n = 16) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join('');
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const local = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
};
const now = Date.now();
const today = local(now);

const PLACES = [
  ['US', 'Colorado', 'Denver', 30], ['US', 'Colorado', 'Boulder', 14], ['US', 'Colorado', 'Lakewood', 9], ['US', 'Colorado', 'Aurora', 8],
  ['US', 'Colorado', 'Fort Collins', 6], ['US', 'Colorado', 'Golden', 6], ['US', 'Colorado', 'Arvada', 5], ['US', 'Colorado', 'Colorado Springs', 4],
  ['US', 'Wyoming', 'Cheyenne', 2], ['US', 'Utah', 'Salt Lake City', 2], ['US', 'California', 'Los Angeles', 2], ['US', 'Texas', 'Austin', 2],
  ['US', 'New Mexico', 'Albuquerque', 1.5], ['CA', 'Ontario', 'Toronto', 1], ['GB', 'England', 'London', 1],
].map((p) => [p, p[3]]);

// [channel, source, weight, referrer, utm] — weights shift for the ad campaign below
const SOURCES = [
  ['Organic Search', 'Google', 34, 'google.com'], ['Direct', 'Direct', 24, null], ['Organic Social', 'Instagram', 9, 'instagram.com'],
  ['Organic Social', 'Facebook', 6, 'facebook.com'], ['Organic Search', 'Bing', 3, 'bing.com'], ['Referral', 'Yelp', 3, 'yelp.com'],
  ['Referral', 'denverkids.example', 2.5, 'denverkids.example'], ['AI Assistants', 'ChatGPT', 2.2, 'chatgpt.com'], ['AI Assistants', 'Perplexity', 0.8, 'perplexity.ai'],
  ['Email', 'Newsletter', 3, null, { source: 'newsletter', medium: 'email', campaign: 'October news' }],
  ['Campaigns', 'Flyer', 1.5, null, { source: 'flyer', medium: 'print', campaign: 'School flyers' }],
  ['Organic Search', 'DuckDuckGo', 1.2, 'duckduckgo.com'],
];
const ADS = [
  { id: '120210000000001', name: 'Fall Kids Classes', source: 'Instagram', utm: 'ig', weight: 8, start: 24, end: 0, spend: 21, convert: 1.5 },
  { id: '120210000000002', name: 'Free Trial Week', source: 'Facebook', utm: 'fb', weight: 5, start: 16, end: 3, spend: 14, convert: 2.1 },
  { id: '120210000000003', name: 'Birthday Parties', source: 'Instagram', utm: 'ig', weight: 3, start: 40, end: 20, spend: 9, convert: 0.6 },
];

const SITES = [
  {
    id: 'ironwood', name: 'Ironwood Climbing', domain: 'ironwoodclimbing.example', color: 1, base: 95, growth: 0.45,
    key_events: ['Booking click', 'Contact form sent'],
    funnel: [{ label: 'Looked at classes', type: 'page', match: '/classes/*' }, { label: 'Clicked Book', type: 'event', match: 'Booking click' }],
    integrations: { iclasspro: { account: 'demo' }, meta: { ad_account: '1000000001' } },
    portals: 'book.ironwood.example',
    pages: [['/', 30], ['/classes/', 22], ['/classes/kids/', 16], ['/classes/teens/', 7], ['/classes/adults/', 8], ['/coaches/', 9], ['/pricing/', 12], ['/about/', 6], ['/contact/', 6], ['/blog/first-climb-what-to-expect/', 7], ['/birthday-parties/', 5]],
    entry: [['/', 46], ['/classes/kids/', 16], ['/classes/', 10], ['/blog/first-climb-what-to-expect/', 9], ['/pricing/', 7], ['/birthday-parties/', 5], ['/coaches/', 4], ['/contact/', 3]],
    videos: [['Meet the coaches', 5], ['A first class, start to finish', 8], ['Tour the gym', 4]],
    ads: true,
  },
  {
    id: 'summit-open', name: 'Summit Youth Open', domain: 'summityouthopen.example', color: 2, base: 28, growth: 1.6,
    key_events: ['Registration click'], funnel: [], integrations: {}, portals: '',
    pages: [['/', 40], ['/schedule/', 20], ['/divisions/', 14], ['/register/', 16], ['/venue/', 8], ['/results/2026/', 6], ['/faq/', 8]],
    entry: [['/', 60], ['/register/', 14], ['/schedule/', 12], ['/divisions/', 8], ['/faq/', 6]],
    videos: [['Highlights from last year', 6]],
    ads: false,
  },
];

const DEVICES = { default: [['Phone', 62], ['Desktop', 32], ['Tablet', 6]], social: [['Phone', 88], ['Desktop', 8], ['Tablet', 4]], search: [['Phone', 55], ['Desktop', 40], ['Tablet', 5]] };
const BROWSERS = { Phone: [['Safari', 55], ['Chrome', 30], ['Samsung Internet', 6], ['Instagram app', 5], ['Facebook app', 4]], Desktop: [['Chrome', 60], ['Safari', 20], ['Edge', 12], ['Firefox', 8]], Tablet: [['Safari', 80], ['Chrome', 20]] };
const OS = { Safari: { Phone: 'iOS', Desktop: 'macOS', Tablet: 'iPadOS' }, Chrome: { Phone: 'Android', Desktop: 'Windows', Tablet: 'Android' }, Edge: { Desktop: 'Windows' }, Firefox: { Desktop: 'Windows' }, 'Samsung Internet': { Phone: 'Android' }, 'Instagram app': { Phone: 'iOS' }, 'Facebook app': { Phone: 'Android' } };
// When people browse: evenings and lunch, a little more on weekends.
const HOURS = [0.3, 0.15, 0.1, 0.08, 0.1, 0.3, 0.9, 1.8, 2.4, 2.6, 2.8, 3.2, 3.9, 3.3, 2.8, 2.9, 3.4, 4.2, 5.2, 6.4, 6.8, 5.2, 3, 1.2].map((w, h) => [h, w]);
const WEEKDAY = [1.15, 1.0, 1.02, 1.0, 0.96, 0.9, 1.2];

const out = [];
const sessions = [];
const hits = [];
const flush = (table, cols, rows) => {
  for (let i = 0; i < rows.length; i += 150) out.push(`INSERT INTO ${table} (${cols}) VALUES\n${rows.slice(i, i + 150).map((r) => `(${r.map(q).join(',')})`).join(',\n')};`);
};

for (const site of SITES) {
  for (const t of ['hits', 'sessions', 'rollup', 'drops', 'classes', 'class_changes', 'ad_stats', 'secrets', 'sync_log']) out.push(`DELETE FROM ${t} WHERE site = ${q(site.id)};`);
  out.push(`DELETE FROM sites WHERE id = ${q(site.id)};`);
  out.push(`INSERT INTO sites (id, name, domain, hosts, portals, timezone, color, filter_dc, key_events, funnel, integrations, rolled, position, created) VALUES (${[
    site.id, site.name, site.domain, '', site.portals, TZ, site.color, 1, JSON.stringify(site.key_events), JSON.stringify(site.funnel), JSON.stringify(site.integrations), null, site.color, Math.floor(now / 1000) - DAYS * 86400,
  ].map(q).join(',')});`);

  for (let back = DAYS; back >= 0; back--) {
    const noon = now - back * 86400000;
    const { day } = local(noon);
    const dow = new Date(day + 'T12:00:00Z').getUTCDay();
    const progress = 1 - back / DAYS;
    const ads = site.ads ? ADS.filter((a) => back <= a.start && back >= a.end) : [];
    const adWeight = ads.reduce((n, a) => n + a.weight, 0);
    let count = Math.round(site.base * (1 + site.growth * progress) * WEEKDAY[dow] * (0.82 + rand() * 0.36) * (1 + adWeight / 100));
    if (back === 0) count = Math.round(count * HOURS.filter(([h]) => h <= today.hour).reduce((n, x) => n + x[1], 0) / HOURS.reduce((n, x) => n + x[1], 0));

    const todays = [];
    for (let i = 0; i < count; i++) {
      let hour = pick(HOURS);
      if (back === 0 && hour > today.hour) hour = Math.floor(rand() * (today.hour + 1));
      const started = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 7 * 3600 + hour * 3600 + Math.floor(rand() * 3600);
      if (started * 1000 > now) continue;

      const ad = ads.length && rand() < adWeight / (adWeight + 100) ? pick(ads.map((a) => [a, a.weight])) : null;
      const src = ad ? ['Paid Social', ad.source, 0, null, { source: ad.utm, medium: 'paid_social', campaign: ad.name, id: ad.id }] : pick(SOURCES.map((x) => [x, x[2]]));
      const [channel, source, , referrer, utm] = src;
      const device = pick(DEVICES[channel.includes('Social') ? 'social' : channel.includes('Search') ? 'search' : 'default']);
      const browser = pick(BROWSERS[device]);
      const os = OS[browser]?.[device] || (device === 'Desktop' ? 'Windows' : 'Android');
      const place = channel === 'Organic Search' && rand() < 0.2 ? pick(PLACES.slice(8)) : pick(PLACES);
      const visitor = todays.length && rand() < 0.14 ? todays[Math.floor(rand() * todays.length)] : id(20);
      todays.push(visitor);
      const sid = id(16);

      // pages
      const deep = channel === 'Direct' || channel === 'Email' ? 0.62 : channel === 'Paid Social' ? 0.42 : channel === 'AI Assistants' ? 0.7 : 0.52;
      const paths = [ad ? pick([['/classes/kids/', 6], ['/', 2], ['/pricing/', 2]]) : pick(site.entry)];
      while (paths.length < 7 && rand() < deep) {
        const next = pick(site.pages);
        if (next !== paths[paths.length - 1]) paths.push(next);
      }
      let ts = started;
      let engagedTotal = 0;
      let events = 0;
      let actions = 0;
      const event = (name, path, props) => {
        hits.push([id(16), site.id, sid, visitor, ts + 5, day, 'event', name, path, 0, 0, props ? JSON.stringify(props) : null]);
        events++;
        if (site.key_events.includes(name)) actions++;
      };
      paths.forEach((path, n) => {
        const engaged = Math.round((8 + rand() * rand() * 140) * (path.includes('blog') ? 1.8 : 1) * 1000);
        const scroll = Math.min(100, Math.round(35 + rand() * 75));
        hits.push([id(12), site.id, sid, visitor, ts, day, 'pageview', null, path, engaged, scroll, null]);
        engagedTotal += engaged;
        const wants = (ad ? ad.convert : channel === 'Organic Search' ? 1.4 : channel === 'AI Assistants' ? 2.2 : channel === 'Direct' ? 1.3 : channel === 'Email' ? 1.8 : 0.7);
        if (site.id === 'ironwood') {
          if ((path.startsWith('/classes/') || path === '/pricing/') && rand() < 0.085 * wants) event('Booking click', path, { program: path.includes('kids') ? 'Kids' : path.includes('teens') ? 'Teens' : path.includes('adults') ? 'Adults' : 'Any class', button: pick([['Book a class', 5], ['Try a free class', 3]]) });
          if (path === '/contact/' && rand() < 0.22) event('Contact form sent', path, { topic: pick([['Classes', 5], ['Birthday party', 3], ['Something else', 2]]) });
          if (path === '/coaches/' && rand() < 0.3) event('Coach link', path, { coach: pick([['Maya Ortiz', 5], ['Dev Patel', 4], ['Sam Whitaker', 3], ['Lena Fischer', 2]]), kind: pick([['Interview', 3], ['Profile', 2], ['Video', 2]]) });
          if (rand() < 0.03) event('Phone tap', path, { number: '+13035550142' });
          if (rand() < 0.02) event('Outbound click', path, { url: 'instagram.com/ironwoodclimbing', text: 'Instagram' });
        } else if ((path === '/register/' || path === '/') && rand() < 0.16 * wants) {
          event('Registration click', path, { division: pick([['Novice', 5], ['Intermediate', 4], ['Open', 2]]) });
        }
        if ((path === '/' || path === '/about/' || path === '/coaches/') && rand() < 0.13) {
          const video = pick(site.videos);
          const seconds = Math.round(15 + rand() * 150);
          event('Video play', path, { video });
          event('Video watch', path, { video, seconds });
          if (seconds > 120) event('Video complete', path, { video });
        }
        if (n === paths.length - 1 && site.portals && actions && rand() < 0.75) {
          ts += 20;
          hits.push([id(12), site.id, sid, visitor, ts, day, 'pageview', null, `${site.portals}/classes`, Math.round(20000 + rand() * 90000), 60, null]);
          if (rand() < 0.42) event('Enrollment complete', `${site.portals}/checkout`, null);
        }
        ts += Math.round(engaged / 1000) + 3 + Math.floor(rand() * 20);
      });
      if (rand() < 0.004) event('Page not found', pick([['/schedule', 3], ['/class', 2], ['/summer-camp/', 2]]), { from: 'google.com' });

      const views = hits.filter((x) => x[2] === sid && x[6] === 'pageview');
      sessions.push([
        sid, site.id, visitor, day, hour, started, ts, paths[0], views[views.length - 1][8], views.length, events, actions, engagedTotal,
        referrer, channel, source, utm?.source || null, utm?.medium || null, utm?.campaign || null, null, null, utm?.id || null,
        place[0], place[1], place[2], device, browser, os,
      ]);
    }
    out.push(`INSERT OR IGNORE INTO drops (site, day, reason, n) VALUES (${q(site.id)}, ${q(day)}, 'bot', ${Math.round(4 + rand() * 14)});`);

    if (site.ads) {
      for (const a of ads) {
        const spend = Math.round(a.spend * (0.8 + rand() * 0.4) * 100) / 100;
        const clicks = Math.round(spend * (2.2 + rand()));
        out.push(`INSERT OR REPLACE INTO ad_stats (site, platform, day, campaign_id, campaign, spend, impressions, reach, clicks, link_clicks) VALUES (${[site.id, 'meta', day, a.id, a.name, spend, clicks * 62, clicks * 48, clicks + 4, clicks].map(q).join(',')});`);
      }
    }
  }
}

flush('sessions', 'id, site, visitor, day, hour, started, last_seen, entry_path, exit_path, pageviews, events, actions, engaged_ms, referrer, channel, source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, country, region, city, device, browser, os', sessions);
flush('hits', 'id, site, session, visitor, ts, day, kind, name, path, engaged_ms, scroll, props', hits);

// Classes: open spots drifting down as the session fills.
const CLASSES = [['Kids Climb (ages 5-8)', 'Mon 4:30pm–5:30pm, Wed 4:30pm–5:30pm', 2], ['Kids Climb (ages 9-12)', 'Tue 4:30pm–5:45pm, Thu 4:30pm–5:45pm', 0], ['Teen Team', 'Mon 6:00pm–7:30pm, Wed 6:00pm–7:30pm', 5], ['Intro to Bouldering', 'Sat 10:00am–11:30am', 3], ['Adult Technique', 'Tue 7:00pm–8:30pm', 7], ['Family Climb', 'Sun 1:00pm–2:30pm', 1], ['Lead Climbing Clinic', 'Thu 7:00pm–9:00pm', 4]];
const nowS = Math.floor(now / 1000);
CLASSES.forEach(([name, schedule, open], i) => {
  out.push(`INSERT INTO classes (site, class_id, name, schedule, openings, first_seen, updated, gone) VALUES (${['ironwood', String(40 + i), name, schedule, open, nowS - 60 * 86400, nowS - 300, 0].map(q).join(',')});`);
  let left = open;
  for (let back = 0; back < 45; back++) {
    if (rand() < 0.2) {
      const delta = rand() < 0.86 ? -1 : 1;
      const at = now - back * 86400000 - Math.floor(rand() * 40000000);
      out.push(`INSERT INTO class_changes (site, class_id, ts, day, delta, openings) VALUES (${['ironwood', String(40 + i), Math.floor(at / 1000), local(at).day, delta, left].map(q).join(',')});`);
      left -= delta;
    }
  }
});
out.push(`INSERT OR REPLACE INTO sync_log (site, kind, ts, ok, message) VALUES ('ironwood', 'iclasspro', ${nowS - 300}, 1, '7 classes, 0 changed');`);
out.push(`INSERT OR REPLACE INTO sync_log (site, kind, ts, ok, message) VALUES ('ironwood', 'meta', ${nowS - 300}, 1, 'demo');`);
out.push(`INSERT OR REPLACE INTO secrets (site, name, value) VALUES ('ironwood', 'meta_token', 'demo-not-a-real-token');`);

writeFileSync('seed.sql', out.join('\n') + '\n');
console.log(`seed.sql: ${sessions.length.toLocaleString()} visits, ${hits.length.toLocaleString()} page views and actions`);
if (!process.argv.includes('--sql-only')) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', 'seed.sql'], { stdio: 'inherit' });
  console.log('Loaded into the local database. Open http://localhost:8787');
}
