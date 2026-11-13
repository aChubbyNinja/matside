// Meta (Facebook and Instagram) ads: what was spent, next to what it brought.
//
// The website side needs nothing but tagged links: put the URL parameters from the dashboard's
// Settings into each ad and Matside can tell which campaign every visit came from. This file adds
// the money side. With a read-only token it pulls spend, impressions and clicks per campaign per
// day from the Marketing API, so the Ads card can show cost per visit and cost per key action.

import { addDays, localParts, nowSeconds, text } from '../util.js';

export const id = 'meta';
const VERSION = 'v27.0';
const FIELDS = 'campaign_id,campaign_name,spend,impressions,reach,clicks,inline_link_clicks';

/** Turn Insights rows into ours. Exported for tests. */
export function readInsights(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.campaign_id && r.date_start)
    .map((r) => ({
      day: String(r.date_start).slice(0, 10),
      campaign_id: String(r.campaign_id),
      campaign: text(String(r.campaign_name || r.campaign_id), 160),
      spend: Number(r.spend) || 0,
      impressions: Math.round(Number(r.impressions) || 0),
      reach: Math.round(Number(r.reach) || 0),
      clicks: Math.round(Number(r.clicks) || 0),
      link_clicks: Math.round(Number(r.inline_link_clicks) || 0),
    }));
}

async function token(env, site) {
  if (env.META_ACCESS_TOKEN) return env.META_ACCESS_TOKEN;
  const row = await env.DB.prepare('SELECT value FROM secrets WHERE site = ? AND name = ?').bind(site.id, 'meta_token').first();
  return row?.value || null;
}

export async function sync(env, site, config) {
  const accessToken = await token(env, site);
  if (!accessToken) return 'waiting for an access token';
  const today = localParts(Date.now(), site.timezone).day;
  // Meta keeps adjusting recent days, so re-read the last four weeks each time.
  const range = JSON.stringify({ since: addDays(today, -28), until: today });
  let url = `https://graph.facebook.com/${VERSION}/act_${config.ad_account}/insights?level=campaign&time_increment=1&limit=200&fields=${FIELDS}&time_range=${encodeURIComponent(range)}`;
  const rows = [];
  for (let page = 0; url && page < 10; page++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Meta sometimes repeats the token in its error text. Never keep or show it.
      if (body?.error?.code === 190) throw new Error('Meta did not accept the access token. Paste a fresh one in Settings.');
      const said = text(String(body?.error?.message || `error ${res.status}`).split(accessToken).join('[token]'), 200);
      throw new Error(`Meta said: ${said}`);
    }
    rows.push(...readInsights(body.data));
    // The "next" link Meta returns carries the token in its address; use the cursor instead.
    const after = body.paging?.next ? body.paging?.cursors?.after : null;
    url = after ? url.replace(/&after=[^&]*/, '') + `&after=${encodeURIComponent(after)}` : null;
  }
  const statements = rows.slice(0, 2000).map((r) =>
    env.DB.prepare(
      `INSERT INTO ad_stats (site, platform, day, campaign_id, campaign, spend, impressions, reach, clicks, link_clicks)
       VALUES (?, 'meta', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (site, platform, day, campaign_id) DO UPDATE SET campaign = excluded.campaign, spend = excluded.spend,
         impressions = excluded.impressions, reach = excluded.reach, clicks = excluded.clicks, link_clicks = excluded.link_clicks`,
    ).bind(site.id, r.day, r.campaign_id, r.campaign, r.spend, r.impressions, r.reach, r.clicks, r.link_clicks),
  );
  for (let i = 0; i < statements.length; i += 80) await env.DB.batch(statements.slice(i, i + 80));
  return `${rows.length} campaign-days`;
}

/** Join ad spend to the visits each campaign brought. Exported for tests. */
export function join(spendRows, visitRows) {
  const campaigns = new Map();
  const entry = (key, name) => {
    if (!campaigns.has(key)) campaigns.set(key, { name, spend: 0, impressions: 0, clicks: 0, visits: 0, visitors: 0, actions: 0, acted: 0, tagged: false, connected: false });
    return campaigns.get(key);
  };
  const byName = new Map();
  for (const r of spendRows) {
    const c = entry('id:' + r.campaign_id, r.campaign);
    c.spend += Number(r.spend) || 0;
    c.impressions += Number(r.impressions) || 0;
    c.clicks += Number(r.link_clicks || r.clicks) || 0;
    c.connected = true;
    byName.set(String(r.campaign).toLowerCase(), 'id:' + r.campaign_id);
  }
  for (const v of visitRows) {
    const name = v.campaign || '(no campaign name on the link)';
    const key = (v.utm_id && campaigns.has('id:' + v.utm_id) && 'id:' + v.utm_id) || byName.get(String(name).toLowerCase()) || 'name:' + name;
    const c = entry(key, name);
    c.visits += Number(v.visits) || 0;
    c.visitors += Number(v.visitors) || 0;
    c.actions += Number(v.actions) || 0;
    c.acted += Number(v.acted) || 0;
    c.tagged = true;
  }
  return [...campaigns.values()]
    .map((c) => ({ ...c, spend: Math.round(c.spend * 100) / 100 }))
    .sort((a, b) => b.spend - a.spend || b.visits - a.visits);
}

/** What the dashboard's Ads card shows for a date range. */
export async function panel(env, site, range) {
  const [spend, visits, log, hasToken] = await env.DB.batch([
    env.DB.prepare(
      `SELECT campaign_id, campaign, SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(link_clicks) AS link_clicks
       FROM ad_stats WHERE site = ? AND day BETWEEN ? AND ? GROUP BY campaign_id`,
    ).bind(site.id, range.from, range.to),
    env.DB.prepare(
      `SELECT utm_campaign AS campaign, utm_id, COUNT(*) AS visits, COUNT(DISTINCT visitor) AS visitors, SUM(actions) AS actions,
              SUM(CASE WHEN actions > 0 THEN 1 ELSE 0 END) AS acted
       FROM sessions WHERE site = ? AND day BETWEEN ? AND ? AND channel IN ('Paid Social', 'Paid Search', 'Paid Ads') GROUP BY utm_campaign, utm_id`,
    ).bind(site.id, range.from, range.to),
    env.DB.prepare('SELECT ts, ok, message FROM sync_log WHERE site = ? AND kind = ?').bind(site.id, id),
    env.DB.prepare('SELECT 1 AS yes FROM secrets WHERE site = ? AND name = ?').bind(site.id, 'meta_token'),
  ]);
  const campaigns = join(spend.results, visits.results);
  const sum = (key) => campaigns.reduce((n, c) => n + c[key], 0);
  return {
    campaigns: campaigns.slice(0, 30),
    spend: Math.round(sum('spend') * 100) / 100,
    impressions: sum('impressions'),
    clicks: sum('clicks'),
    visits: sum('visits'),
    actions: sum('actions'),
    acted: sum('acted'),
    connected: !!(env.META_ACCESS_TOKEN || hasToken.results.length),
    account: site.integrationConfig.meta?.ad_account || null,
    synced: log.results[0] || null,
    checked: nowSeconds(),
  };
}
