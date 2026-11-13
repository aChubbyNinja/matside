// The database, and how it gets there.
//
// Matside migrates itself: the first request after a deploy creates (or upgrades) the tables, so
// "deploy" is the only step. To change the schema, add an array of statements to MIGRATIONS;
// never edit one that has shipped.

const V1 = [
  // Small key/value store: schema version, the secret that signs sessions, the password hash.
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID`,

  `CREATE TABLE IF NOT EXISTS sites (
     id TEXT PRIMARY KEY,                    -- the value of data-site in the snippet
     name TEXT NOT NULL,
     domain TEXT NOT NULL,                   -- main hostname, without www
     hosts TEXT NOT NULL DEFAULT '',         -- other hostnames that are the same site (comma separated)
     portals TEXT NOT NULL DEFAULT '',       -- other apps the site sends people to (booking, checkout)
     timezone TEXT NOT NULL DEFAULT 'UTC',
     color INTEGER NOT NULL DEFAULT 1,       -- colour slot 1-8; follows the site for good
     filter_dc INTEGER NOT NULL DEFAULT 1,   -- drop traffic from cloud data centres
     key_events TEXT NOT NULL DEFAULT '[]',  -- names of the actions that matter (JSON array)
     funnel TEXT NOT NULL DEFAULT '[]',      -- journey steps (JSON array)
     integrations TEXT NOT NULL DEFAULT '{}',
     rolled TEXT,                            -- last local day summarised into "rollup"
     position INTEGER NOT NULL DEFAULT 0,
     created INTEGER NOT NULL
   ) WITHOUT ROWID`,

  // One random salt per calendar day. Visitor ids are hashes that include it, and old salts are
  // deleted, so nobody (including you) can link a visitor across days or back to an IP address.
  `CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL) WITHOUT ROWID`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     site TEXT NOT NULL,
     visitor TEXT NOT NULL,
     day TEXT NOT NULL,                      -- YYYY-MM-DD in the site's timezone
     hour INTEGER NOT NULL,                  -- 0-23 in the site's timezone
     started INTEGER NOT NULL,               -- unix seconds
     last_seen INTEGER NOT NULL,
     entry_path TEXT NOT NULL,
     exit_path TEXT NOT NULL,
     pageviews INTEGER NOT NULL DEFAULT 0,
     events INTEGER NOT NULL DEFAULT 0,
     actions INTEGER NOT NULL DEFAULT 0,     -- events that are key actions
     engaged_ms INTEGER NOT NULL DEFAULT 0,
     referrer TEXT,
     channel TEXT NOT NULL,
     source TEXT NOT NULL,
     utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT, utm_id TEXT,
     country TEXT, region TEXT, city TEXT,
     device TEXT NOT NULL, browser TEXT NOT NULL, os TEXT NOT NULL
   ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS sessions_site_day ON sessions (site, day)`,
  `CREATE INDEX IF NOT EXISTS sessions_site_visitor ON sessions (site, visitor)`,

  // Page views and events.
  `CREATE TABLE IF NOT EXISTS hits (
     id TEXT PRIMARY KEY,
     site TEXT NOT NULL,
     session TEXT NOT NULL,
     visitor TEXT NOT NULL,
     ts INTEGER NOT NULL,
     day TEXT NOT NULL,
     kind TEXT NOT NULL,                     -- 'pageview' or 'event'
     name TEXT,                              -- event name
     path TEXT NOT NULL,
     engaged_ms INTEGER NOT NULL DEFAULT 0,
     scroll INTEGER NOT NULL DEFAULT 0,      -- deepest scroll, 0-100
     props TEXT                              -- event properties (JSON object)
   ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS hits_site_kind_day ON hits (site, kind, day)`,
  `CREATE INDEX IF NOT EXISTS hits_session ON hits (session)`,

  // Daily summaries. Because visitor ids change every day, per-day unique counts add up exactly,
  // so long date ranges read a few thousand summary rows instead of every raw visit.
  `CREATE TABLE IF NOT EXISTS rollup (
     site TEXT NOT NULL, day TEXT NOT NULL, dim TEXT NOT NULL, k TEXT NOT NULL,
     visitors INTEGER NOT NULL DEFAULT 0, visits INTEGER NOT NULL DEFAULT 0, pageviews INTEGER NOT NULL DEFAULT 0,
     n1 INTEGER NOT NULL DEFAULT 0, n2 INTEGER NOT NULL DEFAULT 0, v1 REAL NOT NULL DEFAULT 0, v2 REAL NOT NULL DEFAULT 0,
     PRIMARY KEY (site, day, dim, k)
   ) WITHOUT ROWID`,

  // What was filtered out (bots, wrong host...), so the numbers can be trusted.
  `CREATE TABLE IF NOT EXISTS drops (
     site TEXT NOT NULL, day TEXT NOT NULL, reason TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (site, day, reason)
   ) WITHOUT ROWID`,

  `CREATE TABLE IF NOT EXISTS auth_log (ts INTEGER NOT NULL, who TEXT NOT NULL, ok INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS auth_log_ts ON auth_log (ts)`,

  // ---- integrations ----
  // Secrets typed into Settings (API tokens). Never sent back to the browser.
  `CREATE TABLE IF NOT EXISTS secrets (site TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (site, name)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS sync_log (
     site TEXT NOT NULL, kind TEXT NOT NULL, ts INTEGER NOT NULL, ok INTEGER NOT NULL, message TEXT,
     PRIMARY KEY (site, kind)
   ) WITHOUT ROWID`,
  // Classes and open spots (iClassPro and anything shaped like it).
  `CREATE TABLE IF NOT EXISTS classes (
     site TEXT NOT NULL, class_id TEXT NOT NULL, name TEXT NOT NULL, schedule TEXT, openings INTEGER,
     first_seen INTEGER NOT NULL, updated INTEGER NOT NULL, gone INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (site, class_id)
   ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS class_changes (
     site TEXT NOT NULL, class_id TEXT NOT NULL, ts INTEGER NOT NULL, day TEXT NOT NULL,
     delta INTEGER NOT NULL, openings INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS class_changes_site_day ON class_changes (site, day)`,
  // Ad spend per campaign per day (Meta and anything shaped like it).
  `CREATE TABLE IF NOT EXISTS ad_stats (
     site TEXT NOT NULL, platform TEXT NOT NULL, day TEXT NOT NULL, campaign_id TEXT NOT NULL, campaign TEXT NOT NULL,
     spend REAL NOT NULL DEFAULT 0, impressions INTEGER NOT NULL DEFAULT 0, reach INTEGER NOT NULL DEFAULT 0,
     clicks INTEGER NOT NULL DEFAULT 0, link_clicks INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (site, platform, day, campaign_id)
   ) WITHOUT ROWID`,
];

const MIGRATIONS = [V1];

let ready = null;

/** Create or upgrade the tables. Runs once per Worker instance; costs one small read after that. */
export function ensureSchema(env) {
  if (!ready) {
    ready = migrate(env).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

async function migrate(env) {
  let version = 0;
  try {
    const row = await env.DB.prepare(`SELECT value FROM meta WHERE key = 'schema'`).first();
    version = row ? Number(row.value) : 0;
  } catch {
    version = 0; // no tables yet
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
    const statements = MIGRATIONS[v].map((sql) => env.DB.prepare(sql));
    statements.push(env.DB.prepare(`INSERT INTO meta (key, value) VALUES ('schema', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1`).bind(String(v + 1)));
    await env.DB.batch(statements);
  }
}
