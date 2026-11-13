# Integrations

Traffic is half the story. An integration puts a piece of business data on the same page: how full the classes are, what the ads cost. Each one is a small file in [`src/integrations/`](../src/integrations/) and is switched on per website, in Settings.

## iClassPro: class sizes

**What you get.** A Classes card: every class with its schedule and open spots, the number of spots filled in the period you are looking at, and a total of open spots right now.

**What it needs.** Only the short account name in your customer portal's address (`portal.iclasspro.com/yourname`). No password, no API key, no change to your iClassPro account.

**How it works.** iClassPro has no API for enrollments. But every customer portal reads its class list from a public feed, and that feed says how many spots are open in each class. Every 15 minutes Matside reads the feed and writes down any change. A spot that disappears is, nearly always, an enrollment.

**Read it as an estimate.** "Spots filled" counts open spots that went away, whoever filled them: a parent online, or your front desk. Raising a class's capacity shows up as spots opened, lowering it as spots filled. For exact enrollment numbers, iClassPro's own New Enrollments report is the source of truth. To see enrollments that came *from the website*, see [Booking portals](portals.md).

## Meta ads (Facebook and Instagram)

There are two steps, and the first is useful on its own.

### Step 1: tag your ads (no account connection)

In Ads Manager, open an ad, find **Tracking**, and paste this into **URL parameters**:

```
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_id={{campaign.id}}
```

Meta fills in the curly-brace parts when someone clicks. From then on every visit from that ad is listed under Paid Social with its campaign name, and the Ads card shows visits and key actions per campaign.

Two things to know:

- The parameters are set per ad. An ad without them shows up as Organic Social, because Facebook adds the same `fbclid` to ads and ordinary posts alike.
- Meta keeps the name the campaign had when the ad was first published. Renaming a campaign later does not change the tag (the `utm_id` still matches).

### Step 2: add what it cost (optional)

With a read-only token, Matside pulls spend, impressions and clicks per campaign per day from Meta's Marketing API (Insights, campaign level), so the Ads card can show cost per visit and cost per key action.

1. In [Meta Business Settings](https://business.facebook.com/settings), under **Users, System users**, add a system user and give it access to your ad account (view performance is enough).
2. **Generate token** for it with the `ads_read` permission. If your business allows it, choose a token that does not expire; otherwise you will need to paste a new one every 60 days.
3. In Matside: Settings, your website, **Facebook and Instagram ads**. Enter the ad account ID (the number in Ads Manager's address, without `act_`) and the token.

The token is stored in your own D1 database (table `secrets`) and is never sent back to the browser. If you would rather keep it out of the database, set it as a Worker secret instead: `npx wrangler secret put META_ACCESS_TOKEN`.

Spend is matched to visits by campaign id (`utm_id`), falling back to campaign name. The last four weeks are re-read each time, because Meta keeps adjusting recent days.

> This connector follows Meta's documentation (Marketing API v27.0) and its data handling is covered by unit tests, but it has not yet been run against a live ad account. If something is off, the Ads card shows Meta's own error message.

## Writing your own

An integration is a module with three exports:

```js
export const id = 'stripe';

// Every 15 minutes. Fetch from the outside service, store what you need in D1,
// return a short status line. Throw to report a problem (the message is shown in the dashboard).
export async function sync(env, site, config) { ... }

// What the dashboard card draws for a date range ({ from, to } are 'YYYY-MM-DD' in the site's time zone).
export async function panel(env, site, range) { ... }
```

To add one:

1. Copy [`iclasspro.js`](../src/integrations/iclasspro.js). It is the smallest complete example: read a feed, compare with what is on file, write the differences.
2. Register it in [`src/integrations/index.js`](../src/integrations/index.js).
3. Add its tables to a new migration in [`src/schema.js`](../src/schema.js) (never edit one that has shipped). Two general-purpose tables already exist and may be all you need: `classes` + `class_changes` (things with a count that moves) and `ad_stats` (money per campaign per day).
4. Accept its settings in `validateSite()` in [`src/sites.js`](../src/sites.js), and add a route for its card next to `classes` and `ads` in [`src/index.js`](../src/index.js).
5. Draw the card in [`public/dashboard.js`](../public/dashboard.js) (see the Classes card: it asks for its data separately, so a slow integration never holds up the page) and add a form in [`public/settings.js`](../public/settings.js).

Keep secrets in the `secrets` table or in Worker secrets, never in a site's settings (those are sent to the browser).

On the free plan a Worker may make 50 outside requests per run of the timer, shared by all websites and integrations. Fetch a page or two, not a thousand.
