// "What happened", in sentences: src/insights.js
//
// The input is shaped like the object stats() in src/stats.js assembles before it calls
// insights(): same field names, small made-up numbers for a club website.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { insights } from '../src/insights.js';
import { resolveRange } from '../src/util.js';

const TODAY = '2024-03-15';
const TONES = ['info', 'up', 'down', 'good', 'warn'];

/** Totals as shapeTotals() gives them. bounce and conversion are percentages with one decimal. */
function totals(visitors, extra = {}) {
  const visits = extra.visits ?? Math.round(visitors * 1.2);
  const acted = extra.acted ?? 0;
  return {
    visitors,
    visits,
    pageviews: visits * 2,
    bounce: 45,
    engaged: 50,
    actions: acted,
    acted,
    conversion: visits ? Math.round((acted / visits) * 1000) / 10 : 0,
    ...extra,
  };
}

/** One row of a breakdown as shapeRows() gives it. bounce is a whole percentage. */
const row = (name, visits, extra = {}) => ({ name, visitors: Math.ceil(visits * 0.9), visits, pageviews: visits * 2, bounce: 40, acted: 0, actions: 0, engaged: 40, ...extra });

/** A whole stats answer with nothing in the optional lists, to be filled in per test. */
function answer(over = {}) {
  return {
    site: { id: 'club', name: 'Northwoods Wrestling', domain: 'example.com', timezone: 'America/Chicago' },
    range: resolveRange('30d', TODAY),
    filters: [],
    totals: totals(0),
    prev: totals(0),
    series: [],
    prev_series: [],
    complete: 0,
    channels: [],
    sources: [],
    campaigns: [],
    pages: [],
    entries: [],
    exits: [],
    events: [],
    videos: [],
    countries: [],
    regions: [],
    cities: [],
    devices: [],
    browsers: [],
    os: [],
    heatmap: [],
    filtered_out: 0,
    key_events: [],
    generated: 1710500000,
    ...over,
  };
}

const allText = (items) => items.map((i) => `${i.title} | ${i.text}`).join('\n');
const find = (items, pattern) => items.find((i) => pattern.test(`${i.title} | ${i.text}`));

/** Checks every answer must pass, whatever the numbers. */
function wellFormed(items) {
  assert.ok(Array.isArray(items));
  assert.ok(items.length <= 6, `${items.length} items`);
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), ['text', 'title', 'tone']);
    assert.ok(TONES.includes(item.tone), `tone ${item.tone}`);
    assert.ok(item.title.trim().length > 0);
    assert.ok(item.text.trim().length > 0);
    assert.doesNotMatch(`${item.title} ${item.text}`, /undefined|NaN|null|Infinity|\[object/);
  }
  return items;
}

describe('insights: an empty period', () => {
  test('says, once, that nothing was recorded', () => {
    const items = wellFormed(insights(answer()));
    assert.equal(items.length, 1);
    assert.equal(items[0].tone, 'info');
    assert.match(items[0].text, /no visits/i);
  });

  test('with filters on, it says nothing matches the filters', () => {
    const items = wellFormed(insights(answer({ filters: [['channel', 'Paid Social']] })));
    assert.equal(items.length, 1);
    assert.match(items[0].text, /filter/i);
  });

  test('stays silent about trends even when the period before was busy', () => {
    const items = wellFormed(insights(answer({ prev: totals(200) })));
    assert.equal(items.length, 1);
    assert.ok(!items.some((i) => i.tone === 'up' || i.tone === 'down'));
  });
});

describe('insights: the trend against the period before', () => {
  test('more visitors than before is reported as up, with the percentage and both numbers', () => {
    const items = wellFormed(insights(answer({ totals: totals(150), prev: totals(100) })));
    const up = items.filter((i) => i.tone === 'up');
    assert.equal(up.length, 1);
    assert.match(up[0].title, /50%/);
    assert.match(up[0].text, /\b150\b/);
    assert.match(up[0].text, /\b100\b/);
    assert.ok(!items.some((i) => i.tone === 'down'));
    assert.equal(items[0], up[0], 'the trend comes first');
  });

  test('fewer visitors than before is reported as down, with the percentage and both numbers', () => {
    const items = wellFormed(insights(answer({ totals: totals(60), prev: totals(100) })));
    const down = items.filter((i) => i.tone === 'down');
    assert.equal(down.length, 1);
    assert.match(down[0].title, /40%/);
    assert.match(down[0].text, /\b60\b/);
    assert.match(down[0].text, /\b100\b/);
    assert.ok(!items.some((i) => i.tone === 'up'));
    assert.equal(items[0], down[0], 'the trend comes first');
  });

  test('about the same number of visitors is reported as neither up nor down', () => {
    for (const now of [100, 101, 98]) {
      const items = wellFormed(insights(answer({ totals: totals(now), prev: totals(100) })));
      assert.ok(!items.some((i) => i.tone === 'up' || i.tone === 'down'), `${now} vs 100`);
      assert.match(`${items[0].title} ${items[0].text}`, /same|steady/i);
      assert.match(items[0].text, new RegExp(`\\b${now}\\b`));
    }
  });

  test('the period it compares with is named in words that fit the range', () => {
    const week = insights(answer({ range: resolveRange('7d', TODAY), totals: totals(150), prev: totals(100) }));
    assert.match(week[0].text, /7 days before/);
    const month = insights(answer({ totals: totals(150), prev: totals(100) }));
    assert.match(month[0].text, /30 days before/);
    const steadyToday = insights(answer({ range: resolveRange('today', TODAY), totals: totals(100), prev: totals(100) }));
    assert.match(steadyToday[0].text, /yesterday/);
  });

  test('large numbers are written with thousands separators', () => {
    const items = wellFormed(insights(answer({ totals: totals(12500), prev: totals(10000) })));
    assert.match(items[0].text, /12,500/);
    assert.match(items[0].text, /10,000/);
  });

  test('with nothing before to compare against it claims no rise or fall', () => {
    for (const before of [0, 2]) {
      const items = wellFormed(insights(answer({ totals: totals(80), prev: totals(before) })));
      assert.ok(!items.some((i) => i.tone === 'up' || i.tone === 'down'), `80 vs ${before}`);
      assert.match(allText(items), /\b80 visitors\b/);
      assert.doesNotMatch(items[0].title, /%/);
    }
  });

  test('one visitor is "1 visitor"', () => {
    const items = wellFormed(insights(answer({ totals: totals(1, { visits: 1 }), prev: totals(0) })));
    assert.match(allText(items), /\b1 visitor\b(?!s)/);
  });

  test('a morning that is ahead of yesterday morning is not reported as a fall', () => {
    // stats() hands insights yesterday *up to the same time of day* as "the period before" (25
    // visitors by 9 am, not the 100 the whole day ended on), so a normal morning never reads as a fall.
    const items = wellFormed(insights(answer({
      range: resolveRange('today', TODAY),
      totals: totals(30),
      prev: totals(25),
      complete: 9,
    })));
    assert.ok(!items.some((i) => i.tone === 'down'), allText(items));
    const trend = items.find((i) => i.tone === 'up');
    assert.ok(trend, allText(items));
    assert.match(trend.text, /so far/);
    assert.match(trend.text, /by this time yesterday/);
  });

  test('today against yesterday reads as a sentence', () => {
      const items = insights(answer({ range: resolveRange('today', TODAY), totals: totals(150), prev: totals(100) }));
      assert.doesNotMatch(allText(items), /\bin yesterday\b/);
    });

  test('a single custom day against the day before reads as a sentence', () => {
      const items = insights(answer({ range: resolveRange('custom', TODAY, '2024-03-05', '2024-03-05'), totals: totals(150), prev: totals(100) }));
      assert.doesNotMatch(allText(items), /\b1 days\b/);
    });
});

describe('insights: key actions', () => {
  const sources = [row('Google', 200, { acted: 6 }), row('Direct', 100, { acted: 6 })];

  test('when visits took a key action it says how many, what share, and which actions', () => {
    const items = wellFormed(insights(answer({
      totals: totals(250, { visits: 300, acted: 12 }),
      prev: totals(240),
      key_events: ['Registration click'],
      sources,
    })));
    const item = find(items, /key action/i);
    assert.ok(item, allText(items));
    assert.equal(item.tone, 'good');
    assert.match(item.title, /\b4%/);
    assert.match(item.text, /\b12 visits\b/);
    assert.match(item.text, /Registration click/);
    assert.ok(!items.some((i) => i.tone === 'warn'));
  });

  test('one visit that took action is "1 visit"', () => {
    const items = wellFormed(insights(answer({ totals: totals(40, { visits: 50, acted: 1 }), prev: totals(40), key_events: ['Phone call'] })));
    assert.match(find(items, /key action/i).text, /\b1 visit\b(?!s)/);
  });

  test('with key actions set up and none taken over a busy period, it warns', () => {
    const items = wellFormed(insights(answer({ totals: totals(250, { visits: 300, acted: 0 }), prev: totals(240), key_events: ['Registration click'], sources })));
    const item = find(items, /key action/i);
    assert.ok(item, allText(items));
    assert.equal(item.tone, 'warn');
    assert.match(item.text, /\b300 visits\b/);
    assert.ok(!items.some((i) => i.tone === 'good'));
  });

  test('a handful of visits with no key action is not worth a warning', () => {
    const items = wellFormed(insights(answer({ totals: totals(5, { visits: 6, acted: 0 }), prev: totals(5), key_events: ['Registration click'] })));
    assert.ok(!items.some((i) => i.tone === 'warn'), allText(items));
  });

  test('with no key actions set up it does not mention them at all', () => {
    const items = wellFormed(insights(answer({
      totals: totals(250, { visits: 300 }),
      prev: totals(240),
      key_events: [],
      sources,
      channels: [row('Organic Search', 200), row('Paid Social', 60), row('Direct', 40)],
    })));
    assert.doesNotMatch(allText(items), /key action|took action/i);
    assert.ok(items.length > 0);
  });

  test('a source that converts clearly better than the rest is pointed out by name', () => {
    const items = wellFormed(insights(answer({
      totals: totals(250, { visits: 300, acted: 15 }), // 5% overall
      prev: totals(240),
      key_events: ['Registration click'],
      sources: [row('Google', 200, { acted: 3 }), row('Instagram', 60, { acted: 12 }), row('Direct', 40, { acted: 0 })],
    })));
    const item = find(items, /Instagram converts|converts best/i);
    assert.ok(item, allText(items));
    assert.match(item.title, /Instagram/);
    assert.match(item.text, /\b20%/); // 12 of 60
    assert.match(item.text, /\b5%/);
  });

  test('ad visits are counted, with how many of them took a key action', () => {
    const items = wellFormed(insights(answer({
      totals: totals(250, { visits: 300, acted: 15 }),
      prev: totals(240),
      key_events: ['Registration click'],
      channels: [row('Organic Search', 200, { acted: 8 }), row('Paid Social', 45, { acted: 5 }), row('Paid Search', 15, { acted: 2 }), row('Direct', 40)],
    })));
    const item = find(items, /\bads\b/i);
    assert.ok(item, allText(items));
    assert.match(item.text, /\b60 visits\b/);
    assert.match(item.text, /\b7 of them\b/);
  });
});

describe('insights: what else it points out', () => {
  const busy = { totals: totals(250, { visits: 300 }), prev: totals(245) };

  test('the top source, with its share of visits', () => {
    const items = wellFormed(insights(answer({ ...busy, sources: [row('Google', 180), row('Direct', 80), row('Instagram', 40)] })));
    const item = find(items, /Google/);
    assert.ok(item, allText(items));
    assert.match(item.text, /\b180 visits\b/);
    assert.match(item.text, /\b60%/);
  });

  test('"Mostly from" is only said of a source that sent most of the visits', () => {
      const items = insights(answer({ ...busy, sources: [row('Google', 60), row('Direct', 55), row('Instagram', 50), row('Facebook', 50), row('Bing', 45), row('Yelp', 40)] }));
      assert.doesNotMatch(allText(items), /Mostly from Google/);
    });

  test('visits from AI assistants', () => {
    const items = wellFormed(insights(answer({ ...busy, channels: [row('Organic Search', 280), row('AI Assistants', 20)] })));
    const item = find(items, /\bAI\b/);
    assert.ok(item, allText(items));
    assert.match(item.text, /\b20 visits\b/);
  });

  test('the busiest day and hour over a longer range', () => {
    const heatmap = [[1, 9, 12], [6, 10, 41], [3, 18, 20], [0, 0, 5]]; // [day of week (0 = Sunday), hour, visits]
    const items = wellFormed(insights(answer({ ...busy, heatmap })));
    const item = find(items, /Saturday/);
    assert.ok(item, allText(items));
    assert.match(item.text, /10 ?am/i);
  });

  test('midnight and noon are written the way people say them', () => {
    const at = (hour) => allText(insights(answer({ ...busy, heatmap: [[2, hour, 50]] })));
    assert.match(at(0), /Tuesdays? around 12 ?am/i);
    assert.match(at(12), /Tuesdays? around 12 ?pm/i);
    assert.match(at(13), /Tuesdays? around 1 ?pm/i);
    assert.match(at(23), /Tuesdays? around 11 ?pm/i);
  });

  test('a landing page that loses far more people than the site as a whole', () => {
    const items = wellFormed(insights(answer({ ...busy, entries: [row('/', 180, { bounce: 35 }), row('/schedule/', 60, { bounce: 90 })] })));
    const item = find(items, /\/schedule\//);
    assert.ok(item, allText(items));
    assert.equal(item.tone, 'warn');
    assert.match(item.text, /\b90%/);
  });

  test('a site that is mostly read on phones', () => {
    const items = wellFormed(insights(answer({ ...busy, devices: [row('Phone', 210), row('Desktop', 75), row('Tablet', 15)] })));
    const item = find(items, /phone/i);
    assert.ok(item, allText(items));
    assert.match(item.text, /\b70%/);
  });

  test('where visitors are, by region and city', () => {
    const items = wellFormed(insights(answer({
      ...busy,
      regions: [row('US|Wisconsin', 180), row('US|Illinois', 60)],
      cities: [row('US|Wisconsin|Green Bay', 90), row('US|Illinois|Chicago', 45)],
    })));
    const item = find(items, /Wisconsin/);
    assert.ok(item, allText(items));
    assert.match(item.text, /\b60%/);
    assert.match(item.text, /Green Bay/);
    assert.match(item.text, /\b30%/);
    assert.doesNotMatch(item.text, /US\||\|/);
  });

  test('the top city is only credited to the top region when it is in that region', () => {
      const items = insights(answer({
        ...busy,
        regions: [row('US|Wisconsin', 120), row('US|Illinois', 70)],
        cities: [row('US|Illinois|Chicago', 60), row('US|Wisconsin|Green Bay', 30), row('US|Wisconsin|Appleton', 30)],
      }));
      const item = find(items, /Wisconsin/);
      assert.ok(item, allText(items));
      assert.doesNotMatch(item.text, /Chicago/);
    });

  test('the most played video', () => {
    const items = wellFormed(insights(answer({ ...busy, videos: [{ name: 'Welcome to the club', plays: 14, viewers: 12, completes: 5, seconds: 48, total_seconds: 672 }] })));
    const item = find(items, /Welcome to the club/);
    assert.ok(item, allText(items));
    assert.match(item.text, /\b14 times\b/);
  });

  test('visits that hit a missing page', () => {
    const items = wellFormed(insights(answer({ ...busy, events: [{ name: 'Registration click', count: 9, visitors: 8, visits: 9, key: false }, { name: 'Page not found', count: 4, visitors: 4, visits: 4, key: false }] })));
    const item = find(items, /does not exist|broken/i);
    assert.ok(item, allText(items));
    assert.equal(item.tone, 'warn');
    assert.match(item.text, /\b4 times\b/);
  });

  test('missing pages are counted in visits, not in how many times one visit hit them', () => {
      const items = insights(answer({ ...busy, events: [{ name: 'Page not found', count: 5, visitors: 1, visits: 1, key: false }] }));
      const item = find(items, /does not exist|broken/i);
      assert.ok(item, allText(items));
      assert.doesNotMatch(item.text, /\b5 visits\b/);
    });
});

describe('insights: always safe to show', () => {
  /** A period in which every kind of insight has something to say. */
  const everything = () => answer({
    totals: totals(250, { visits: 300, acted: 15, bounce: 45 }),
    prev: totals(180),
    key_events: ['Registration click', 'Phone call', 'Email click'],
    channels: [row('Organic Search', 150, { acted: 4 }), row('Paid Social', 60, { acted: 9 }), row('Direct', 60, { acted: 1 }), row('AI Assistants', 30, { acted: 1 })],
    sources: [row('Google', 150, { acted: 4 }), row('Instagram', 60, { acted: 9 }), row('Direct', 60, { acted: 1 }), row('ChatGPT', 30, { acted: 1 })],
    campaigns: [row('Spring', 60, { acted: 9 })],
    pages: [{ name: '/', visitors: 200, visits: 220, views: 260, seconds: 35, scroll: 60 }],
    entries: [row('/', 200, { bounce: 35 }), row('/schedule/', 60, { bounce: 92 })],
    exits: [row('/', 150), row('/schedule/', 80)],
    events: [{ name: 'Registration click', count: 16, visitors: 14, visits: 15, key: true }, { name: 'Page not found', count: 6, visitors: 5, visits: 5, key: false }],
    videos: [{ name: 'Welcome', plays: 20, viewers: 18, completes: 6, seconds: 120, total_seconds: 2400 }],
    countries: [row('US', 290)],
    regions: [row('US|Wisconsin', 200)],
    cities: [row('US|Wisconsin|Green Bay', 110)],
    devices: [row('Phone', 220), row('Desktop', 80)],
    browsers: [row('Safari', 180), row('Chrome', 120)],
    os: [row('iOS', 190), row('Android', 30), row('Windows', 80)],
    heatmap: [[6, 10, 50], [2, 18, 30]],
    filtered_out: 12,
  });

  test('never more than six, however much there is to say', () => {
    const items = wellFormed(insights(everything()));
    assert.equal(items.length, 6);
  });

  test('the headline trend and the key actions make the cut', () => {
    const items = insights(everything());
    assert.equal(items[0].tone, 'up');
    assert.ok(find(items, /key action/i), allText(items));
  });

  test('titles are not repeated', () => {
    const items = insights(everything());
    assert.equal(new Set(items.map((i) => i.title)).size, items.length);
  });

  test('visits with every optional list empty do not throw', () => {
    for (const key of ['today', 'yesterday', '7d', '30d', '90d', 'month', 'lastmonth', '12mo']) {
      const items = wellFormed(insights(answer({ range: resolveRange(key, TODAY), totals: totals(120), prev: totals(100) })));
      assert.ok(items.length >= 1, key);
    }
  });

  test('key actions set up, but every list empty, does not throw', () => {
    wellFormed(insights(answer({ totals: totals(120, { acted: 6 }), prev: totals(100), key_events: ['Registration click'] })));
    wellFormed(insights(answer({ totals: totals(120, { acted: 0 }), prev: totals(100), key_events: ['Registration click'] })));
  });

  test('a single visit, a single source, a single everything does not throw', () => {
    wellFormed(insights(answer({
      range: resolveRange('today', TODAY),
      totals: totals(1, { visits: 1 }),
      prev: totals(0),
      channels: [row('Direct', 1)],
      sources: [row('Direct', 1)],
      entries: [row('/', 1, { bounce: 100 })],
      devices: [row('Phone', 1)],
      regions: [row('US|Wisconsin', 1)],
      cities: [row('US|Wisconsin|Green Bay', 1)],
      heatmap: [[5, 9, 1]],
    })));
  });

  test('does not change the numbers it was given', () => {
    const d = everything();
    const before = JSON.stringify(d);
    insights(d);
    assert.equal(JSON.stringify(d), before);
  });
});
