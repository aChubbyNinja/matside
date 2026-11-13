// Meta ad spend next to the visits it brought: readInsights and join in src/integrations/meta.js

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, readInsights } from '../src/integrations/meta.js';

/** A row of the Marketing API's campaign insights. Meta sends every number as text. */
const insightRow = (extra = {}) => ({
  campaign_id: '120210000000000001',
  campaign_name: 'Spring Sign-ups',
  spend: '12.34',
  impressions: '1500',
  reach: '1200',
  clicks: '40',
  inline_link_clicks: '31',
  date_start: '2024-03-01',
  date_stop: '2024-03-01',
  ...extra,
});

/** Spend per campaign, as the Ads card reads it from the database. */
const spend = (campaign_id, campaign, amount, extra = {}) => ({ campaign_id, campaign, spend: amount, impressions: 1000, clicks: 50, link_clicks: 30, ...extra });
/** Paid visits grouped by the tags on the link. */
const visits = (campaign, utm_id, n, extra = {}) => ({ campaign, utm_id, visits: n, visitors: n, actions: 0, acted: 0, ...extra });
const byName = (rows, name) => rows.find((r) => r.name === name);
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);

describe('readInsights', () => {
  test('turns a row of text into a day, a campaign and numbers', () => {
    assert.deepEqual(readInsights([insightRow()]), [{
      day: '2024-03-01',
      campaign_id: '120210000000000001',
      campaign: 'Spring Sign-ups',
      spend: 12.34,
      impressions: 1500,
      reach: 1200,
      clicks: 40,
      link_clicks: 31,
    }]);
  });

  test('keeps one row per campaign per day, in order', () => {
    const out = readInsights([
      insightRow({ date_start: '2024-03-01' }),
      insightRow({ date_start: '2024-03-02', spend: '8.00' }),
      insightRow({ campaign_id: '120210000000000002', campaign_name: 'Summer Camp', date_start: '2024-03-02', spend: '5.50' }),
    ]);
    assert.deepEqual(out.map((r) => [r.day, r.campaign, r.spend]), [['2024-03-01', 'Spring Sign-ups', 12.34], ['2024-03-02', 'Spring Sign-ups', 8], ['2024-03-02', 'Summer Camp', 5.5]]);
  });

  test('the long campaign id stays exactly as Meta wrote it', () => {
    const out = readInsights([insightRow({ campaign_id: '120213456789012345678' })]);
    assert.equal(out[0].campaign_id, '120213456789012345678');
    assert.equal(typeof out[0].campaign_id, 'string');
  });

  test('numbers Meta leaves out (a day with no clicks) are zero', () => {
    const { clicks: _c, inline_link_clicks: _l, reach: _r, ...quiet } = insightRow({ spend: '0.42', impressions: '18' });
    const [row] = readInsights([quiet]);
    assert.deepEqual([row.spend, row.impressions, row.reach, row.clicks, row.link_clicks], [0.42, 18, 0, 0, 0]);
  });

  test('a campaign with no name is shown by its id rather than as nothing', () => {
    const { campaign_name: _n, ...unnamed } = insightRow();
    assert.equal(readInsights([unnamed])[0].campaign, '120210000000000001');
  });

  test('rows without a campaign id or a date are left out', () => {
    const { campaign_id: _i, ...noId } = insightRow();
    const { date_start: _d, ...noDate } = insightRow();
    assert.deepEqual(readInsights([null, {}, noId, noDate]), []);
    assert.equal(readInsights([noId, insightRow(), noDate]).length, 1);
  });

  test('anything that is not a list of rows reads as nothing', () => {
    for (const rows of [undefined, null, {}, 'error', 42, { data: [insightRow()] }]) assert.deepEqual(readInsights(rows), [], JSON.stringify(rows));
    assert.deepEqual(readInsights([]), []);
  });

  test('a date that arrives with a time on it is cut to the day', () => {
    assert.equal(readInsights([insightRow({ date_start: '2024-03-01T00:00:00+0000' })])[0].day, '2024-03-01');
  });
});

describe('join', () => {
  test('spend is matched to visits whose utm_id is the campaign id', () => {
    const rows = join(
      [spend('111', 'Spring Sign-ups', 50, { impressions: 4000, clicks: 90, link_clicks: 60 })],
      [visits('Spring Sign-ups', '111', 40, { visitors: 35, actions: 6, acted: 5 })],
    );
    assert.deepEqual(rows, [{
      name: 'Spring Sign-ups', spend: 50, impressions: 4000, clicks: 60, visits: 40, visitors: 35, actions: 6, acted: 5, tagged: true, connected: true,
    }]);
  });

  test('the utm_id match holds even when the name on the link is out of date', () => {
    const rows = join([spend('111', 'Spring Sign-ups (renamed)', 50)], [visits('spring_v1', '111', 40)]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Spring Sign-ups (renamed)');
    assert.deepEqual([rows[0].spend, rows[0].visits], [50, 40]);
  });

  test('with no utm_id on the link, spend is matched by campaign name', () => {
    const rows = join([spend('111', 'Spring Sign-ups', 50)], [visits('Spring Sign-ups', null, 40)]);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].name, rows[0].spend, rows[0].visits, rows[0].tagged, rows[0].connected], ['Spring Sign-ups', 50, 40, true, true]);
  });

  test('the name match ignores capital letters', () => {
    const rows = join([spend('111', 'Spring Sign-ups', 50)], [visits('spring sign-ups', null, 40)]);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].spend, rows[0].visits], [50, 40]);
  });

  test('a utm_id that matches nothing still falls back to the campaign name', () => {
    const rows = join([spend('111', 'Spring Sign-ups', 50)], [visits('Spring Sign-ups', '999-adset-id', 40)]);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].spend, rows[0].visits], [50, 40]);
  });

  test('visits with no spend behind them are listed, at no cost and not marked as connected', () => {
    const rows = join([], [visits('Flyer QR', null, 12, { actions: 2, acted: 2 })]);
    assert.deepEqual(rows, [{
      name: 'Flyer QR', spend: 0, impressions: 0, clicks: 0, visits: 12, visitors: 12, actions: 2, acted: 2, tagged: true, connected: false,
    }]);
  });

  test('spend with no visits is listed, with zero visits and not marked as tagged', () => {
    const rows = join([spend('222', 'Summer Camp', 25, { impressions: 900, clicks: 12, link_clicks: 8 })], []);
    assert.deepEqual(rows, [{
      name: 'Summer Camp', spend: 25, impressions: 900, clicks: 8, visits: 0, visitors: 0, actions: 0, acted: 0, tagged: false, connected: true,
    }]);
  });

  test('all four cases side by side, each campaign on its own row', () => {
    const rows = join(
      [spend('111', 'Spring Sign-ups', 50), spend('222', 'Summer Camp', 25), spend('333', 'Open House', 10)],
      [visits('whatever the link says', '111', 40), visits('Open House', null, 9), visits('Flyer QR', null, 12)],
    );
    assert.deepEqual(rows.map((r) => r.name).sort(), ['Flyer QR', 'Open House', 'Spring Sign-ups', 'Summer Camp']);
    assert.deepEqual([byName(rows, 'Spring Sign-ups').spend, byName(rows, 'Spring Sign-ups').visits], [50, 40]);
    assert.deepEqual([byName(rows, 'Summer Camp').spend, byName(rows, 'Summer Camp').visits], [25, 0]);
    assert.deepEqual([byName(rows, 'Open House').spend, byName(rows, 'Open House').visits], [10, 9]);
    assert.deepEqual([byName(rows, 'Flyer QR').spend, byName(rows, 'Flyer QR').visits], [0, 12]);
  });

  test('nothing is lost or counted twice: the rows add up to what went in', () => {
    const spendRows = [spend('111', 'Spring Sign-ups', 50.25), spend('222', 'Summer Camp', 25.5), spend('333', 'Open House', 10)];
    const visitRows = [
      visits('Spring Sign-ups', '111', 40, { actions: 5, acted: 4 }),
      visits('Spring Sign-ups', null, 6, { actions: 1, acted: 1 }),
      visits('Open House', null, 9),
      visits('Flyer QR', null, 12, { actions: 2, acted: 2 }),
      visits(null, null, 3),
    ];
    const rows = join(spendRows, visitRows);
    assert.equal(sum(rows, 'spend'), 85.75);
    assert.equal(sum(rows, 'visits'), 70);
    assert.equal(sum(rows, 'actions'), 8);
    assert.equal(sum(rows, 'acted'), 7);
  });

  test('visits that reach one campaign by id and by name are added together', () => {
    const rows = join([spend('111', 'Spring Sign-ups', 50)], [visits('Spring Sign-ups', '111', 40, { acted: 4, actions: 5 }), visits('Spring Sign-ups', null, 6, { acted: 1, actions: 1 })]);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].visits, rows[0].actions, rows[0].acted], [46, 6, 5]);
  });

  test('spend rows for the same campaign (one per day) are added together', () => {
    const rows = join([spend('111', 'Spring Sign-ups', 10.1, { impressions: 100 }), spend('111', 'Spring Sign-ups', 20.2, { impressions: 200 })], []);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].spend, rows[0].impressions], [30.3, 300]);
  });

  test('spend is rounded to cents, not left with floating-point dust', () => {
    const rows = join([spend('111', 'Spring Sign-ups', 0.1), spend('111', 'Spring Sign-ups', 0.2)], []);
    assert.equal(rows[0].spend, 0.3);
  });

  test('paid visits with no campaign name on the link are still listed, under a label', () => {
    const rows = join([], [visits(null, null, 5)]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].visits, 5);
    assert.equal(typeof rows[0].name, 'string');
    assert.ok(rows[0].name.trim().length > 0);
    assert.doesNotMatch(rows[0].name, /^(null|undefined)$/);
  });

  test('numbers that arrive as text or null are still numbers afterwards', () => {
    const rows = join(
      [{ campaign_id: '111', campaign: 'Spring Sign-ups', spend: '50.5', impressions: '4000', clicks: '90', link_clicks: '60' }],
      [{ campaign: 'Spring Sign-ups', utm_id: '111', visits: '40', visitors: '35', actions: null, acted: null }],
    );
    assert.deepEqual(rows, [{
      name: 'Spring Sign-ups', spend: 50.5, impressions: 4000, clicks: 60, visits: 40, visitors: 35, actions: 0, acted: 0, tagged: true, connected: true,
    }]);
  });

  test('the biggest spender comes first; campaigns with no spend follow, busiest first', () => {
    const rows = join(
      [spend('222', 'Summer Camp', 25), spend('111', 'Spring Sign-ups', 50)],
      [visits('Flyer QR', null, 12), visits('Yard signs', null, 30), visits('Spring Sign-ups', '111', 4)],
    );
    assert.deepEqual(rows.map((r) => r.name), ['Spring Sign-ups', 'Summer Camp', 'Yard signs', 'Flyer QR']);
  });

  test('nothing in, nothing out', () => {
    assert.deepEqual(join([], []), []);
  });

  test('does not change the rows it was given', () => {
    const spendRows = [spend('111', 'Spring Sign-ups', 50)];
    const visitRows = [visits('Spring Sign-ups', '111', 40)];
    const before = JSON.stringify([spendRows, visitRows]);
    join(spendRows, visitRows);
    assert.equal(JSON.stringify([spendRows, visitRows]), before);
  });
});
