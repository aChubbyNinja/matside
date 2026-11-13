// Matside: the Worker.
//
//   /t.js        the snippet websites load (a static file in public/, served without running this)
//   /e           where the snippet reports page views and actions      -> collect.js
//   /api/*       what the dashboard asks                               -> this file
//   everything else is the dashboard itself (static files in public/)
//
// A timer runs every 15 minutes to summarise finished days and refresh integrations.

import { changePassword, checkSession, clearCookie, hasPassword, login, needsSetupCode, setup } from './auth.js';
import { collect } from './collect.js';
import { INTEGRATIONS, syncSite } from './integrations/index.js';
import { ensureSchema } from './schema.js';
import { createSite, deleteSite, getSite, listSites, publicSite, updateSite } from './sites.js';
import { ensureRolled, eventDetail, funnel, live, overview, recountActions, rollup, stats } from './stats.js';
import { addDays, json, localParts, nowSeconds, readLimited, resolveRange, text } from './util.js';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/e') {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        if (request.method !== 'POST') return new Response(null, { status: 405 });
        await ensureSchema(env);
        return await collect(request, env, ctx);
      }
      if (url.pathname.startsWith('/api/')) {
        await ensureSchema(env);
        return await api(request, env, ctx, url);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err?.stack || err);
      if (url.pathname === '/e') return new Response(null, { status: 202 });
      return json({ error: 'Something went wrong on the server. Try again in a moment.' }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(tick(env, controller.scheduledTime));
  },
};

async function readBody(request) {
  try {
    const raw = await readLimited(request, 20_000);
    if (raw === null) return {};
    const body = JSON.parse(raw || '{}');
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

async function api(request, env, ctx, url) {
  const path = url.pathname.slice(5).replace(/\/+$/, '');
  const method = request.method;
  const query = Object.fromEntries(url.searchParams);
  const demo = env.DEMO === '1';
  const write = method !== 'GET' && method !== 'HEAD';

  // Changes must come from the dashboard itself, not from a form on some other website.
  if (write) {
    const origin = request.headers.get('origin');
    if (!origin || origin !== url.origin) return json({ error: 'Request refused.' }, 403);
  }

  // ---- open routes
  if (path === 'session' && method === 'GET') {
    const session = demo ? { ok: true } : await checkSession(request, env);
    const claimed = demo || (await hasPassword(env));
    return json(
      { authed: session.ok, needs_setup: !claimed, setup_code: !claimed && needsSetupCode(env), demo },
      200,
      session.refresh ? { 'set-cookie': session.refresh } : {},
    );
  }
  if (demo && write) return json({ error: 'This is a read-only demo.' }, 403);
  if (path === 'setup' && method === 'POST') {
    const result = await setup(env, await readBody(request));
    return result.error ? json({ error: result.error }, result.status) : json({ ok: true }, 200, { 'set-cookie': result.cookie });
  }
  if (path === 'login' && method === 'POST') {
    const result = await login(request, env, await readBody(request));
    return result.error ? json({ error: result.error }, result.status) : json({ ok: true }, 200, { 'set-cookie': result.cookie });
  }
  if (path === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': clearCookie() });

  // ---- everything below needs the owner
  if (!demo) {
    const session = await checkSession(request, env);
    if (!session.ok) return json({ error: 'Please sign in.' }, 401);
  }

  if (path === 'password' && method === 'POST') {
    const result = await changePassword(env, await readBody(request));
    return result.error ? json({ error: result.error }, result.status) : json({ ok: true }, 200, { 'set-cookie': result.cookie });
  }

  if (path === 'sites' && method === 'GET') return json({ sites: (await listSites(env, true)).map(publicSite) });
  if (path === 'sites' && method === 'POST') {
    const result = await createSite(env, await readBody(request));
    return result.error ? json({ error: result.error }, 400) : json({ site: publicSite(result.site) }, 201);
  }
  if (path === 'overview' && method === 'GET') return json({ sites: await overview(env, await listSites(env, true)) });

  const siteRoute = path.match(/^sites\/([a-z0-9-]{1,40})(?:\/(secret|sync|status))?$/);
  if (siteRoute) {
    const site = await getSite(env, siteRoute[1], true);
    if (!site) return json({ error: 'No such website.' }, 404);
    const sub = siteRoute[2];
    if (!sub && method === 'PUT') {
      const result = await updateSite(env, site, await readBody(request));
      if (result.error) return json({ error: result.error }, 400);
      // Changing what counts as a key action rewrites history, in the background.
      if (result.changed.includes('key_events')) ctx.waitUntil(recountActions(env, result.site).catch((e) => console.error(e)));
      if (result.changed.includes('integrations')) ctx.waitUntil(syncSite(env, result.site).catch((e) => console.error(e)));
      return json({ site: publicSite(result.site) });
    }
    if (!sub && method === 'DELETE') {
      await deleteSite(env, site);
      return json({ ok: true });
    }
    if (sub === 'secret' && method === 'POST') {
      const body = await readBody(request);
      if (body.name !== 'meta_token') return json({ error: 'Unknown secret.' }, 400);
      const value = text(body.value, 600);
      if (value) await env.DB.prepare('INSERT INTO secrets (site, name, value) VALUES (?1, ?2, ?3) ON CONFLICT (site, name) DO UPDATE SET value = ?3').bind(site.id, body.name, value).run();
      else await env.DB.prepare('DELETE FROM secrets WHERE site = ? AND name = ?').bind(site.id, body.name).run();
      return json({ ok: true, report: value ? await syncSite(env, site, 'meta') : {} });
    }
    if (sub === 'sync' && method === 'POST') return json({ report: await syncSite(env, site) });
    if (sub === 'status' && method === 'GET') {
      // Used right after adding a site: has the snippet reported in yet?
      const today = localParts(Date.now(), site.timezone).day;
      const [hit, dropped] = await env.DB.batch([
        env.DB.prepare('SELECT MAX(ts) AS ts, COUNT(*) AS n FROM hits WHERE site = ? AND kind = ? AND day >= ?').bind(site.id, 'pageview', addDays(today, -1)),
        env.DB.prepare('SELECT reason, SUM(n) AS n FROM drops WHERE site = ? AND day >= ? GROUP BY reason').bind(site.id, addDays(today, -1)),
      ]);
      return json({ last_hit: hit.results[0]?.ts || null, hits: hit.results[0]?.n || 0, filtered: dropped.results, now: nowSeconds() });
    }
    return json({ error: 'Not found.' }, 404);
  }

  // ---- questions about one site
  if (method === 'GET' && ['stats', 'event', 'funnel', 'live', 'classes', 'ads'].includes(path)) {
    const site = await getSite(env, query.site);
    if (!site) return json({ error: 'No such website.' }, 404);
    if (path === 'stats') return json(await stats(env, site, query));
    if (path === 'event') return json(await eventDetail(env, site, query));
    if (path === 'funnel') return json(await funnel(env, site, query));
    if (path === 'live') return json(await live(env, site));
    const range = resolveRange(query.range, localParts(Date.now(), site.timezone).day, query.from, query.to);
    const key = path === 'classes' ? 'iclasspro' : 'meta';
    if (path === 'classes' && !site.integrationConfig.iclasspro) return json({ off: true });
    return json({ range, ...(await INTEGRATIONS[key].panel(env, site, range)) });
  }

  return json({ error: 'Not found.' }, 404);
}

/** The 15-minute timer. */
async function tick(env, scheduledTime) {
  await ensureSchema(env);
  const topOfHour = new Date(scheduledTime || Date.now()).getUTCMinutes() < 15;
  for (const site of await listSites(env, true)) {
    try {
      if (topOfHour) {
        const { day: today, hour } = localParts(Date.now(), site.timezone);
        await ensureRolled(env, site, today);
        // Yesterday keeps settling for a little while after midnight (people still reading), so
        // its summary is written again, once, in the small hours.
        if (hour === 3) await rollup(env, site, addDays(today, -1), addDays(today, -1));
      }
      await syncSite(env, site);
    } catch (err) {
      console.error('tick', site.id, err?.stack || err);
    }
  }
  if (topOfHour) {
    const keepRaw = env.RAW_RETENTION_DAYS === undefined ? 400 : Number(env.RAW_RETENTION_DAYS) || 0;
    const today = new Date().toISOString().slice(0, 10);
    const jobs = [
      // A salt is needed only while its day is still "today" somewhere in the world. Once it is
      // gone, that day's visitor ids can no longer be recomputed from an address, by anyone.
      env.DB.prepare('DELETE FROM salts WHERE day < ?').bind(addDays(today, -1)),
      env.DB.prepare('DELETE FROM auth_log WHERE ts < ?').bind(nowSeconds() - 2 * 86400),
    ];
    if (keepRaw > 0) {
      // Old raw visits go; their daily summaries stay, so long-range charts keep working.
      const cutoff = addDays(today, -keepRaw);
      jobs.push(env.DB.prepare('DELETE FROM hits WHERE day < ?').bind(cutoff), env.DB.prepare('DELETE FROM sessions WHERE day < ?').bind(cutoff));
    }
    await env.DB.batch(jobs);
  }
}
