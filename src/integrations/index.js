// Business data next to traffic data.
//
// An integration is a module with:
//   id                       its key in a site's "integrations" setting
//   sync(env, site, config)  called every 15 minutes; fetch from the outside service and store
//                            what you need in D1; return a short status line (or throw)
//   panel(env, site, range)  return the JSON the dashboard card draws for a date range
//
// To add your own (Stripe, Shopify, a booking system...), copy iclasspro.js, register it here,
// give it a card in public/app.js and a form in Settings. See docs/integrations.md.

import * as iclasspro from './iclasspro.js';
import * as meta from './meta.js';
import { nowSeconds } from '../util.js';

export const INTEGRATIONS = { [iclasspro.id]: iclasspro, [meta.id]: meta };

export async function syncSite(env, site, only = null) {
  const report = {};
  for (const [key, integration] of Object.entries(INTEGRATIONS)) {
    const config = site.integrationConfig[key];
    if (!config || (only && only !== key)) continue;
    let ok = 1;
    let message;
    try {
      message = await integration.sync(env, site, config);
    } catch (err) {
      ok = 0;
      message = String(err?.message || err).slice(0, 300);
    }
    report[key] = { ok: !!ok, message };
    await env.DB.prepare(
      `INSERT INTO sync_log (site, kind, ts, ok, message) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (site, kind) DO UPDATE SET ts = ?3, ok = ?4, message = ?5`,
    ).bind(site.id, key, nowSeconds(), ok, message).run();
  }
  return report;
}
