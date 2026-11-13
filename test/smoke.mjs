// End-to-end check against a running dashboard (start one with `npm run dev`).
//   node test/smoke.mjs [http://127.0.0.1:8787]
// It claims a fresh dashboard, adds a website, sends it a visit the way a browser would, and
// checks that every number comes back right. Use a throwaway local database, not production.

import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
let cookie = '';

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { origin: BASE, cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function hit(payload, { ua = UA, origin = 'https://smoke.example', ip = '203.0.113.9' } = {}) {
  const res = await fetch(BASE + '/e', { method: 'POST', headers: { 'user-agent': ua, origin, 'x-real-ip': ip, 'content-type': 'text/plain' }, body: JSON.stringify(payload) });
  assert.equal(res.status, 202);
}

const step = (name) => console.log('  ok  ' + name);

// ---- sign-in
let r = await api('GET', '/api/session');
assert.equal(r.status, 200);
const password = 'correct horse battery staple';
if (r.data.needs_setup) {
  r = await api('POST', '/api/setup', { password: 'short' });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/setup', { password });
  assert.equal(r.status, 200);
  step('claimed a new dashboard');
} else {
  r = await api('POST', '/api/login', { password });
  assert.equal(r.status, 200, 'this database already has a different password; use a fresh one');
}
assert.equal((await api('GET', '/api/session')).data.authed, true);
const saved = cookie;
cookie = '';
assert.equal((await api('GET', '/api/sites')).status, 401);
assert.equal((await api('POST', '/api/login', { password: 'wrong password!' })).status, 401);
cookie = saved;
step('wrong password and missing session are refused');

// ---- a website
const id = 'smoke-' + Date.now().toString(36);
r = await api('POST', '/api/sites', { id, name: 'Smoke test', domain: 'smoke.example', timezone: 'America/Chicago' });
assert.equal(r.status, 201, JSON.stringify(r.data));
assert.equal((await api('POST', '/api/sites', { name: 'Bad', domain: 'not a domain' })).status, 400);
r = await api('PUT', `/api/sites/${id}`, { key_events: ['Registration click'], portals: ['portal.example.org/acme'], filter_dc: false });
assert.equal(r.status, 200, JSON.stringify(r.data));
step('added a website');

// ---- a visit: lands from Google on an ad link, reads, clicks Register, continues on the portal
const p1 = 'aaaa1111bbbb';
await hit({ s: id, n: 'pageview', p: p1, u: 'https://smoke.example/programs/?utm_source=ig&utm_medium=paid_social&utm_campaign=Spring&fbclid=x', r: 'https://l.instagram.com/', w: 390, t: 1 });
await hit({ s: id, n: 'pageview', p: p1, u: 'https://smoke.example/programs/?utm_source=ig&utm_medium=paid_social&utm_campaign=Spring&fbclid=x', r: 'https://l.instagram.com/', w: 390, t: 1 }); // the same report again must not count twice
await hit({ s: id, n: 'engage', p: p1, u: 'https://smoke.example/programs/', e: 42000, d: 80 });
await hit({ s: id, n: 'engage', p: p1, u: 'https://smoke.example/programs/', e: 42000, d: 80 });
await hit({ s: id, n: 'engage', p: p1, u: 'https://smoke.example/programs/', e: 30000, d: 60 }); // an older, late report must not lower anything
await hit({ s: id, n: 'Registration click', p: p1, u: 'https://smoke.example/programs/', m: { program: 'Novice', 'Bad Key!': 'x' } });
await hit({ s: id, n: 'Video play', p: p1, u: 'https://smoke.example/programs/', m: { video: 'Welcome' } });
await hit({ s: id, n: 'Video watch', p: p1, u: 'https://smoke.example/programs/', m: { video: 'Welcome', seconds: 31 } });
await hit({ s: id, n: 'pageview', p: 'cccc2222dddd', u: 'https://portal.example.org/acme/classes', r: 'https://smoke.example/programs/', w: 390, t: 1 }, { origin: 'https://portal.example.org' });
// a second person, direct, one page
await hit({ s: id, n: 'pageview', p: 'eeee3333ffff', u: 'https://www.smoke.example/', r: '', w: 1400 }, { ip: '203.0.113.77', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', origin: 'https://www.smoke.example' });
// things that must be ignored
await hit({ s: id, n: 'pageview', p: 'gggg4444hhhh', u: 'https://smoke.example/', r: '' }, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
await hit({ s: id, n: 'pageview', p: 'iiii5555jjjj', u: 'https://evil.example/', r: '' }, { origin: 'https://evil.example' });
await hit({ s: id, n: 'pageview', p: 'kkkk6666llll', u: 'https://smoke.example/', r: '' }, { origin: 'https://evil.example' });
await hit({ s: 'no-such-site', n: 'pageview', u: 'https://smoke.example/' });
step('sent a visit, a second visitor and four hits that should be ignored');

r = await api('GET', `/api/stats?site=${id}&range=today`);
assert.equal(r.status, 200, JSON.stringify(r.data));
const s = r.data;
assert.deepEqual([s.totals.visitors, s.totals.visits, s.totals.pageviews], [2, 2, 3]);
assert.equal(s.totals.actions, 1);
assert.equal(s.totals.acted, 1);
assert.equal(s.totals.bounce, 50);
assert.equal(s.totals.engaged, 21); // 42 seconds over two visits
assert.equal(s.filtered_out, 3);
const names = (rows) => rows.map((x) => x.name);
assert.deepEqual(names(s.channels).sort(), ['Direct', 'Paid Social']);
assert.ok(names(s.sources).includes('Instagram'));
assert.deepEqual(names(s.campaigns), ['Spring']);
assert.deepEqual(names(s.pages).sort(), ['/', '/programs/', 'portal.example.org/acme/classes']);
const programs = s.pages.find((x) => x.name === '/programs/');
assert.deepEqual([programs.seconds, programs.scroll], [42, 80]);
assert.deepEqual(names(s.devices).sort(), ['Desktop', 'Phone']);
assert.deepEqual(s.events.map((e) => [e.name, e.count, e.key]), [['Registration click', 1, true]]);
assert.deepEqual(s.videos.map((v) => [v.name, v.plays, v.seconds]), [['Welcome', 1, 31]]);
assert.equal(s.series.length, 24);
assert.ok(s.insights.length > 0);
step('totals, sources, pages, actions and videos are right');

r = await api('GET', `/api/stats?site=${id}&range=today&f=${encodeURIComponent('channel:Paid Social')}`);
assert.deepEqual([r.data.totals.visits, r.data.totals.pageviews], [1, 2]);
r = await api('GET', `/api/stats?site=${id}&range=today&f=${encodeURIComponent('page:/')}`);
assert.equal(r.data.totals.visits, 1);
step('filters narrow the numbers');

r = await api('GET', `/api/event?site=${id}&range=today&name=${encodeURIComponent('Registration click')}`);
assert.equal(r.data.total, 1);
assert.deepEqual(r.data.props.program, [{ name: 'Novice', count: 1, visitors: 1 }]);
assert.ok(r.data.props.bad_key_);
r = await api('GET', `/api/funnel?site=${id}&range=today`);
assert.deepEqual(r.data.steps.map((x) => x.visits), [2, 1, 1]);
await api('PUT', `/api/sites/${id}`, { funnel: [{ label: 'Saw programs', type: 'page', match: '/programs/*' }, { label: 'Clicked Register', type: 'event', match: 'Registration click' }] });
r = await api('GET', `/api/funnel?site=${id}&range=today`);
assert.deepEqual(r.data.steps.map((x) => x.visits), [2, 1, 1]);
r = await api('GET', `/api/live?site=${id}`);
assert.equal(r.data.now, 2);
assert.ok(r.data.recent.length >= 4);
r = await api('GET', '/api/overview');
assert.equal(r.data.sites.find((x) => x.id === id).today.visitors, 2);
r = await api('GET', `/api/sites/${id}/status`);
assert.ok(r.data.last_hit);
step('action details, journey, live view and overview answer');

// ---- starring a different action rewrites history
r = await api('PUT', `/api/sites/${id}`, { key_events: [] });
assert.equal(r.status, 200);
await new Promise((done) => setTimeout(done, 800));
r = await api('GET', `/api/stats?site=${id}&range=today`);
assert.equal(r.data.totals.actions, 0);
step('changing key actions recounts');

assert.equal((await api('DELETE', `/api/sites/${id}`)).status, 200);
assert.equal((await api('GET', `/api/stats?site=${id}`)).status, 404);
step('deleted the website and its data');
console.log('\nAll good.');
