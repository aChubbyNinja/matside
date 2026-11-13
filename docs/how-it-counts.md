# How it counts

## The words

| Word | Meaning here |
|---|---|
| **Visitor** | One browser on one day. Counted once per day, however many times it comes back that day. Over a week or a month, the daily counts are added up. |
| **Visit** | A run of page views and actions from one visitor with no gap longer than 30 minutes. Arriving again from a different ad, campaign or website starts a new visit, so each source gets credit for what it sent. |
| **Page view** | A page loaded, or an address change in a single-page app. |
| **Time per visit** | Seconds the site was in front with the person active, averaged over all visits. |
| **Bounce rate** | The share of visits with one page view and no action. A visit that lands, taps Register and leaves is not a bounce. |
| **Key action** | An action you starred. "Acted" is the share of visits that included at least one. |
| **Online** | Visitors seen in the last five minutes. |

## Where a visit came from

Each visit gets a **channel** and a **source**, decided when it starts from three things: the page it came from, the tags on the link (`utm_source`, `utm_medium`, `utm_campaign`) and the click ids ad platforms add.

| Channel | Decided by |
|---|---|
| Paid Search | A Google or Microsoft ad click id, or a paid medium (`cpc`, `ppc`, `paid`…) with a search engine as the source |
| Paid Social | A paid medium with a social network as the source |
| Paid Ads | A paid medium, anything else |
| Email | `utm_medium=email`, a newsletter source, or a webmail page |
| AI Assistants | ChatGPT, Perplexity, Claude, Gemini, Copilot, Meta AI, Grok and others, by referrer or tag |
| Organic Social | A social network, without a paid tag |
| Organic Search | A search engine, without a paid tag |
| Campaigns | Any other tagged link (QR codes, flyers, text messages) |
| Referral | A link on another website |
| Direct | None of the above: a typed address, a bookmark, a text message, or an app that hides where the click came from |

Facebook and Instagram add `fbclid` to ordinary posts as well as ads, so `fbclid` alone counts as Organic Social. Ads are told apart by their tags; Settings gives you the line to paste into each ad.

The lists of search engines, networks and assistants are in [`src/channels.js`](../src/channels.js). Adding one is one line.

## What is stored, and what never is

**Stored for each visit:** a visitor id that expires (below), the day and hour in your time zone, the first and last page, counts, the source, the campaign tags, country, region and city, and device type, browser and operating system. **For each page view or action:** the page address without its query string, time and scroll depth, and the details you named.

**Never stored:** IP addresses, cookies or any other identifier on the device, full user-agent strings, full referring addresses (only the host), query strings (apart from the campaign tags), or anything typed into a form. The snippet does not even send the query string or the part of an address after `#`.

**Cloudflare's own request logs** would include each visitor's IP address, so Matside's configuration turns per-request logging off and keeps error logs only (`"invocation_logs": false` in `wrangler.jsonc`). Leave it that way if you repeat the promises above to your visitors.

**Links to other websites** are recorded with their destination (host and path) and the words of the link. If your pages show personal details inside link text or link addresses, give those links a `data-m` name instead, which records only what you choose.

### The visitor id

```
visitor = first 20 hex characters of SHA-256( today's salt | site | IP address | user-agent )
```

- The **salt** is 16 random bytes made the first time it is needed each day, kept in the database, and deleted as soon as that day is over everywhere in the world (within two days). While it exists, someone holding the database could test guesses of an address against an id; once it is gone, nobody can, including you.
- The IP address and user-agent are used for this one calculation and thrown away.
- Because the id includes the site, the same person on two of your websites is two unrelated ids.
- Because it does not include the hostname, the same person moving from your site to your booking portal (listed under the same website in Settings) keeps the same id for the day. That is how a visit continues across domains with no cookie and no link decoration.

### Where the place comes from

Country, region and city are Cloudflare's estimate for the network the request arrived on. Nothing finer is available to Matside or kept by it. Expect city names to be approximate, especially on mobile networks.

## What is left out

- **Robots**, by user-agent: search crawlers, link previewers, monitors, headless browsers, HTTP libraries.
- **Automated browsers** that announce themselves (`navigator.webdriver`).
- **Data-centre traffic** (optional per site, on by default): requests from large hosting networks, which are servers far more often than people. Apple's iCloud Private Relay and Cloudflare WARP are not on the list, because those are people.
- **Reports from other websites**: the page reporting must be on the site's address, one of its other addresses, or its portal.
- **Your own devices**, if you opened the site with `?matside=off`.
- **Visits to localhost.**

The foot of the dashboard says how many reports were left out in the period. Settings, "Check it is working", says why.

## Accuracy, honestly

No analytics tool sees everyone. Matside will miss visitors whose browser blocks the request (serving the snippet from your own subdomain avoids most of this), and visits with JavaScript off. It will double-count someone whose phone moves between Wi-Fi and mobile data mid-visit. Its counts will usually be a little lower than server logs (which include robots) and close to other privacy-first tools.

## Why long ranges are cheap

Each night, every finished day is summarised: one row per (day, breakdown, value). Because a visitor id lives for exactly one day, a day's unique visitors can be added to another day's without double counting, so a 12-month total is exact and reads a few thousand summary rows rather than every visit. Filtered views ("only visits from Google") cannot use the summaries and read the raw visits instead.

Raw visits are deleted after `RAW_RETENTION_DAYS` (400 by default). Summaries are kept.
