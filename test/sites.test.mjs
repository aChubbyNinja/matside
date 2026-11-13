// Website settings and "is this address one of ours?": src/sites.js

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHost, hostRole, validateSite } from '../src/sites.js';

describe('cleanHost', () => {
  test('a plain domain is kept, in lower case', () => {
    assert.equal(cleanHost('example.com'), 'example.com');
    assert.equal(cleanHost('Example.COM'), 'example.com');
    assert.equal(cleanHost('  example.com  '), 'example.com');
  });

  test('a pasted web address is reduced to its hostname', () => {
    assert.equal(cleanHost('https://example.com'), 'example.com');
    assert.equal(cleanHost('http://example.com/'), 'example.com');
    assert.equal(cleanHost('https://www.example.com/programs/?utm_source=x#top'), 'example.com');
    assert.equal(cleanHost('HTTPS://WWW.Example.com/Programs'), 'example.com');
    assert.equal(cleanHost('example.com/contact'), 'example.com');
    assert.equal(cleanHost('example.com?ref=1'), 'example.com');
  });

  test('www and a port number are dropped', () => {
    assert.equal(cleanHost('www.example.com'), 'example.com');
    assert.equal(cleanHost('example.com:8080'), 'example.com');
    assert.equal(cleanHost('https://www.example.com:8443/path'), 'example.com');
  });

  test('subdomains, hyphens, digits and long endings are fine', () => {
    assert.equal(cleanHost('shop.example.co.uk'), 'shop.example.co.uk');
    assert.equal(cleanHost('my-club.example.org'), 'my-club.example.org');
    assert.equal(cleanHost('team99.example.org'), 'team99.example.org');
    assert.equal(cleanHost('takedown.academy'), 'takedown.academy');
  });

  test('localhost is allowed, for trying things out', () => {
    assert.equal(cleanHost('localhost'), 'localhost');
    assert.equal(cleanHost('http://localhost:8787/'), 'localhost');
  });

  test('anything that is not a hostname is refused', () => {
    const bad = [
      '', '   ', null, undefined, 'not a domain', 'example', 'exa mple.com', 'example..com', '.example.com', '-example.com',
      'example-.com', 'exam_ple.com', 'example.c', 'http://', 'https:///', 'coach@example.com', 'example.com, other.com',
      '<script>alert(1)</script>', 'javascript:alert(1)', 42, {},
    ];
    for (const value of bad) assert.equal(cleanHost(value), null, JSON.stringify(value));
  });
});

const existing = { id: 'club', name: 'Northwoods Wrestling', domain: 'northwoods-wrestling.example', timezone: 'America/Chicago' };

describe('validateSite: adding a website', () => {
  test('a name and an address are enough', () => {
    const { values, error } = validateSite({ name: '  Northwoods Wrestling ', domain: 'https://www.Northwoods-Wrestling.example/' });
    assert.equal(error, undefined);
    assert.equal(values.name, 'Northwoods Wrestling');
    assert.equal(values.domain, 'northwoods-wrestling.example');
    assert.equal(typeof values.timezone, 'string');
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: values.timezone }));
  });

  test('the time zone that was picked is kept', () => {
    const { values } = validateSite({ name: 'Club', domain: 'example.com', timezone: 'America/Chicago' });
    assert.equal(values.timezone, 'America/Chicago');
  });

  test('a missing or blank name is refused with a message', () => {
    for (const name of [undefined, '', '   ', null, 42]) {
      const r = validateSite({ name, domain: 'example.com' });
      assert.equal(r.values, undefined, JSON.stringify(name));
      assert.equal(typeof r.error, 'string');
      assert.ok(r.error.length > 0);
    }
  });

  test('a missing or malformed address is refused with a message', () => {
    for (const domain of [undefined, '', 'not a domain', 'example', 'http://']) {
      const r = validateSite({ name: 'Club', domain });
      assert.equal(r.values, undefined, JSON.stringify(domain));
      assert.equal(typeof r.error, 'string');
    }
  });

  test('an unknown time zone is refused', () => {
    const r = validateSite({ name: 'Club', domain: 'example.com', timezone: 'Mars/Olympus_Mons' });
    assert.equal(r.values, undefined);
    assert.equal(typeof r.error, 'string');
  });

  test('a very long name is cut to something that fits', () => {
    const { values } = validateSite({ name: 'W'.repeat(300), domain: 'example.com' });
    assert.ok(values.name.length <= 60, `kept ${values.name.length} characters`);
    assert.ok(values.name.length > 0);
  });
});

describe('validateSite: changing a website', () => {
  test('only what was sent comes back', () => {
    assert.deepEqual(validateSite({ name: 'New name' }, existing), { values: { name: 'New name' } });
    assert.deepEqual(validateSite({ timezone: 'America/New_York' }, existing), { values: { timezone: 'America/New_York' } });
    assert.deepEqual(validateSite({}, existing), { values: {} });
  });

  test('what was sent is still checked', () => {
    assert.ok(validateSite({ name: '   ' }, existing).error);
    assert.ok(validateSite({ domain: 'not a domain' }, existing).error);
    assert.ok(validateSite({ timezone: 'Nowhere/Land' }, existing).error);
  });

  test('extra addresses: a comma list or an array, cleaned like the main address, without repeats', () => {
    const fromText = validateSite({ hosts: 'shop.example.com, https://WWW.Blog.Example.com/latest , shop.example.com' }, existing);
    assert.deepEqual(fromText.values.hosts.split(','), ['shop.example.com', 'blog.example.com']);
    const fromList = validateSite({ hosts: ['shop.example.com', 'blog.example.com'] }, existing);
    assert.deepEqual(fromList.values.hosts.split(','), ['shop.example.com', 'blog.example.com']);
  });

  test('extra addresses: an empty list clears them', () => {
    assert.equal(validateSite({ hosts: '' }, existing).values.hosts, '');
    assert.equal(validateSite({ hosts: [] }, existing).values.hosts, '');
  });

  test('extra addresses: one bad entry refuses the lot', () => {
    const r = validateSite({ hosts: ['shop.example.com', 'not a domain'] }, existing);
    assert.equal(r.values, undefined);
    assert.equal(typeof r.error, 'string');
  });

  test('portals keep their path prefix; scheme, case, query and trailing slash are cleaned off', () => {
    const r = validateSite({ portals: ['https://Portal.Example.org/ACME/', 'portal.example.org/acme', 'www.book.example.net', 'pay.example.net/club/store?x=1#top'] }, existing);
    assert.deepEqual(r.values.portals.split(','), ['portal.example.org/acme', 'book.example.net', 'pay.example.net/club/store']);
  });

  test('portals: a bad hostname is refused', () => {
    const r = validateSite({ portals: ['portal.example.org/acme', '/acme'] }, existing);
    assert.equal(r.values, undefined);
    assert.equal(typeof r.error, 'string');
  });

  test('the data-centre filter is stored as 1 or 0', () => {
    assert.deepEqual(validateSite({ filter_dc: true }, existing), { values: { filter_dc: 1 } });
    assert.deepEqual(validateSite({ filter_dc: false }, existing), { values: { filter_dc: 0 } });
  });

  test('key actions: trimmed, blanks and repeats removed, stored as a JSON list', () => {
    const r = validateSite({ key_events: [' Registration click ', 'Phone call', '', '   ', 'Phone call', null] }, existing);
    assert.deepEqual(JSON.parse(r.values.key_events), ['Registration click', 'Phone call']);
    assert.deepEqual(JSON.parse(validateSite({ key_events: [] }, existing).values.key_events), []);
  });

  test('key actions must be a list', () => {
    assert.ok(validateSite({ key_events: 'Registration click' }, existing).error);
    assert.ok(validateSite({ key_events: { a: 1 } }, existing).error);
  });

  test('journey steps: a page step and an action step, with a label that defaults to what it matches', () => {
    const r = validateSite({ funnel: [{ label: ' Saw programs ', type: 'page', match: '/programs/*' }, { type: 'event', match: 'Registration click' }] }, existing);
    assert.deepEqual(JSON.parse(r.values.funnel), [
      { label: 'Saw programs', type: 'page', match: '/programs/*' },
      { label: 'Registration click', type: 'event', match: 'Registration click' },
    ]);
  });

  test('journey steps: a step with nothing to match is refused, and so is anything that is not a list', () => {
    assert.ok(validateSite({ funnel: [{ label: 'Empty', type: 'page', match: '   ' }] }, existing).error);
    assert.ok(validateSite({ funnel: [null] }, existing).error);
    assert.ok(validateSite({ funnel: 'programs' }, existing).error);
  });

  test('integrations: an iClassPro account name and a Meta ad account number', () => {
    const r = validateSite({ integrations: { iclasspro: { account: ' northwoodswrestling ' }, meta: { ad_account: 'act_1234567890' } } }, existing);
    assert.deepEqual(JSON.parse(r.values.integrations), { iclasspro: { account: 'northwoodswrestling' }, meta: { ad_account: '1234567890' } });
  });

  test('integrations: sending none turns them off', () => {
    assert.deepEqual(JSON.parse(validateSite({ integrations: {} }, existing).values.integrations), {});
    assert.deepEqual(JSON.parse(validateSite({ integrations: { iclasspro: { account: '' } } }, existing).values.integrations), {});
  });

  test('integrations: an account name that could not be in a portal address, or an ad account that is not a number, is refused', () => {
    assert.ok(validateSite({ integrations: { iclasspro: { account: 'has spaces!' } } }, existing).error);
    assert.ok(validateSite({ integrations: { iclasspro: { account: '../../etc' } } }, existing).error);
    assert.ok(validateSite({ integrations: { meta: { ad_account: 'my ad account' } } }, existing).error);
    assert.ok(validateSite({ integrations: { meta: { ad_account: '12' } } }, existing).error);
  });
});

describe('hostRole', () => {
  const site = {
    domain: 'example.com',
    hostList: ['shop.example.com'],
    portalList: ['portal.example.org/acme', 'book.example.net'],
  };

  test('the main domain is the site, with or without www, in any case', () => {
    assert.equal(hostRole(site, 'example.com'), 'site');
    assert.equal(hostRole(site, 'www.example.com'), 'site');
    assert.equal(hostRole(site, 'WWW.Example.COM'), 'site');
    assert.equal(hostRole(site, 'example.com', '/programs/'), 'site');
  });

  test('an extra host is the site too', () => {
    assert.equal(hostRole(site, 'shop.example.com'), 'site');
    assert.equal(hostRole(site, 'www.shop.example.com', '/cart'), 'site');
  });

  test("a portal with a path prefix matches the account's own pages", () => {
    assert.equal(hostRole(site, 'portal.example.org', '/acme'), 'portal');
    assert.equal(hostRole(site, 'portal.example.org', '/acme/'), 'portal');
    assert.equal(hostRole(site, 'portal.example.org', '/acme/classes'), 'portal');
    assert.equal(hostRole(site, 'portal.example.org', '/acme/classes/123/enroll'), 'portal');
    assert.equal(hostRole(site, 'www.portal.example.org', '/acme/classes'), 'portal');
    assert.equal(hostRole(site, 'portal.example.org', '/ACME/Classes'), 'portal');
  });

  test("a portal with a path prefix does not match other accounts on the same portal", () => {
    assert.equal(hostRole(site, 'portal.example.org', '/acmeother'), null);
    assert.equal(hostRole(site, 'portal.example.org', '/acmeother/classes'), null);
    assert.equal(hostRole(site, 'portal.example.org', '/acme-two/classes'), null);
    assert.equal(hostRole(site, 'portal.example.org', '/rivalclub/classes'), null);
    assert.equal(hostRole(site, 'portal.example.org', '/rivalclub/acme'), null);
    assert.equal(hostRole(site, 'portal.example.org', '/'), null);
    assert.equal(hostRole(site, 'portal.example.org'), null);
  });

  test('a portal listed without a path matches every page on that host', () => {
    assert.equal(hostRole(site, 'book.example.net'), 'portal');
    assert.equal(hostRole(site, 'book.example.net', '/'), 'portal');
    assert.equal(hostRole(site, 'book.example.net', '/anything/at/all'), 'portal');
  });

  test('an unrelated host is neither', () => {
    assert.equal(hostRole(site, 'evil.example'), null);
    assert.equal(hostRole(site, 'other.example.org', '/acme'), null);
    assert.equal(hostRole(site, 'google.com'), null);
  });

  test('hosts that merely contain one of ours are neither', () => {
    assert.equal(hostRole(site, 'notexample.com'), null);
    assert.equal(hostRole(site, 'example.com.evil.example'), null);
    assert.equal(hostRole(site, 'example.com.evil.example', '/acme'), null);
    assert.equal(hostRole(site, 'evil-portal.example.org', '/acme'), null);
    assert.equal(hostRole(site, 'fakeshop.example.com'), null);
  });

  test('a subdomain that was not added is not the site', () => {
    assert.equal(hostRole(site, 'blog.example.com'), null);
  });

  test('no host at all is neither', () => {
    assert.equal(hostRole(site, ''), null);
    assert.equal(hostRole(site, null), null);
    assert.equal(hostRole(site, undefined), null);
  });

  test('a site with no extra hosts or portals only answers for its own domain', () => {
    const plain = { domain: 'example.com', hostList: [], portalList: [] };
    assert.equal(hostRole(plain, 'www.example.com'), 'site');
    assert.equal(hostRole(plain, 'portal.example.org', '/acme'), null);
  });

  test('a portal saved through Settings is recognised afterwards, whatever case it was typed in', () => {
    const { values } = validateSite({ portals: ['https://Portal.Example.org/ACME/'] }, existing);
    const saved = { domain: 'example.com', hostList: [], portalList: values.portals.split(',') };
    assert.equal(hostRole(saved, 'portal.example.org', '/acme/classes'), 'portal');
    assert.equal(hostRole(saved, 'portal.example.org', '/ACME/classes'), 'portal');
    assert.equal(hostRole(saved, 'portal.example.org', '/acmeother'), null);
  });
});
