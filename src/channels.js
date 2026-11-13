// Where a visit came from, in words an owner would use.
//
// classify() looks at the page the visit came from (the referrer), the campaign tags on the link
// (utm_source and friends) and the click ids ad platforms add, and answers with a channel
// ("Organic Search") and a source ("Google").

export const CHANNELS = [
  'Direct', 'Organic Search', 'Organic Social', 'Paid Social', 'Paid Search', 'Paid Ads',
  'Email', 'AI Assistants', 'Referral', 'Campaigns',
];

// [hostname ending, friendly name, kind]. First match wins, so specific hosts come before broad ones.
const HOSTS = [
  ['gemini.google.com', 'Gemini', 'ai'], ['bard.google.com', 'Gemini', 'ai'],
  ['chatgpt.com', 'ChatGPT', 'ai'], ['chat.openai.com', 'ChatGPT', 'ai'], ['openai.com', 'ChatGPT', 'ai'],
  ['perplexity.ai', 'Perplexity', 'ai'], ['claude.ai', 'Claude', 'ai'],
  ['copilot.microsoft.com', 'Copilot', 'ai'], ['copilot.com', 'Copilot', 'ai'], ['meta.ai', 'Meta AI', 'ai'],
  ['grok.com', 'Grok', 'ai'], ['x.ai', 'Grok', 'ai'], ['you.com', 'You.com', 'ai'], ['phind.com', 'Phind', 'ai'],
  ['deepseek.com', 'DeepSeek', 'ai'], ['poe.com', 'Poe', 'ai'], ['mistral.ai', 'Le Chat', 'ai'], ['duck.ai', 'Duck.ai', 'ai'],

  ['mail.google.com', 'Gmail', 'email'], ['com.google.android.gm', 'Gmail', 'email'],
  ['outlook.live.com', 'Outlook', 'email'], ['outlook.office.com', 'Outlook', 'email'], ['outlook.office365.com', 'Outlook', 'email'],
  ['mail.yahoo.com', 'Yahoo Mail', 'email'], ['mail.proton.me', 'Proton Mail', 'email'], ['mail.aol.com', 'AOL Mail', 'email'],

  ['facebook.com', 'Facebook', 'social'], ['fb.com', 'Facebook', 'social'], ['fb.me', 'Facebook', 'social'], ['messenger.com', 'Messenger', 'social'],
  ['instagram.com', 'Instagram', 'social'], ['threads.net', 'Threads', 'social'], ['threads.com', 'Threads', 'social'],
  ['t.co', 'X (Twitter)', 'social'], ['twitter.com', 'X (Twitter)', 'social'], ['x.com', 'X (Twitter)', 'social'],
  ['linkedin.com', 'LinkedIn', 'social'], ['lnkd.in', 'LinkedIn', 'social'],
  ['youtube.com', 'YouTube', 'social'], ['youtu.be', 'YouTube', 'social'],
  ['tiktok.com', 'TikTok', 'social'], ['reddit.com', 'Reddit', 'social'], ['snapchat.com', 'Snapchat', 'social'],
  ['nextdoor.com', 'Nextdoor', 'social'], ['bsky.app', 'Bluesky', 'social'], ['t.me', 'Telegram', 'social'],
  ['whatsapp.com', 'WhatsApp', 'social'], ['wa.me', 'WhatsApp', 'social'], ['pinterest.com', 'Pinterest', 'social'], ['pin.it', 'Pinterest', 'social'],

  ['news.google.com', 'Google News', 'ref'], ['docs.google.com', 'Google Docs', 'ref'], ['sites.google.com', 'Google Sites', 'ref'], ['classroom.google.com', 'Google Classroom', 'ref'],
  ['com.google.android.googlequicksearchbox', 'Google', 'search'],
  ['bing.com', 'Bing', 'search'], ['duckduckgo.com', 'DuckDuckGo', 'search'], ['search.yahoo.com', 'Yahoo', 'search'],
  ['ecosia.org', 'Ecosia', 'search'], ['search.brave.com', 'Brave Search', 'search'], ['kagi.com', 'Kagi', 'search'],
  ['startpage.com', 'Startpage', 'search'], ['qwant.com', 'Qwant', 'search'], ['search.aol.com', 'AOL', 'search'],

  ['yelp.com', 'Yelp', 'ref'], ['maps.apple.com', 'Apple Maps', 'ref'], ['tripadvisor.com', 'Tripadvisor', 'ref'],
  ['linktr.ee', 'Linktree', 'ref'],
];

// What people (and ad platforms) type into utm_source.
const ALIASES = {
  fb: ['Facebook', 'social'], facebook: ['Facebook', 'social'], ig: ['Instagram', 'social'], instagram: ['Instagram', 'social'],
  meta: ['Meta', 'social'], an: ['Audience Network', 'social'], msg: ['Messenger', 'social'], th: ['Threads', 'social'],
  tiktok: ['TikTok', 'social'], twitter: ['X (Twitter)', 'social'], x: ['X (Twitter)', 'social'], linkedin: ['LinkedIn', 'social'],
  youtube: ['YouTube', 'social'], nextdoor: ['Nextdoor', 'social'], snapchat: ['Snapchat', 'social'], pinterest: ['Pinterest', 'social'],
  google: ['Google', 'search'], bing: ['Bing', 'search'], adwords: ['Google', 'search'],
  chatgpt: ['ChatGPT', 'ai'], perplexity: ['Perplexity', 'ai'],
  newsletter: ['Newsletter', 'email'], email: ['Email', 'email'], mailchimp: ['Mailchimp', 'email'], constantcontact: ['Constant Contact', 'email'],
  qr: ['QR code', 'tag'], flyer: ['Flyer', 'tag'], poster: ['Poster', 'tag'], text: ['Text message', 'tag'], sms: ['Text message', 'tag'],
  yelp: ['Yelp', 'ref'],
};

// google.com, google.co.uk, google.de... but not other Google products (docs, sites), which are ordinary referrals.
const GOOGLE = /^google\.[a-z]{2,3}(\.[a-z]{2})?$/;

/** Friendly name and kind of a hostname, or null. */
export function lookupHost(host) {
  if (!host) return null;
  const h = host.toLowerCase().replace(/^www\./, '');
  for (const [end, name, kind] of HOSTS) {
    if (h === end || h.endsWith('.' + end)) return { name, kind };
  }
  if (GOOGLE.test(h)) return { name: 'Google', kind: 'search' };
  return null;
}

const PAID = /^(cpc|ppc|cpm|cpv|cpa|paid|paid[-_ ]?(social|search|media|ads?)?|ads?|display|banner|sponsored|retargeting|remarketing)$/;

/**
 * @param {{refHost?: string|null, utm?: {source?: string|null, medium?: string|null, campaign?: string|null}, click?: {google?: boolean, meta?: boolean, microsoft?: boolean, tiktok?: boolean}}} hit
 * @returns {{channel: string, source: string}}
 */
export function classify({ refHost = null, utm = {}, click = {} }) {
  const src = (utm.source || '').trim().toLowerCase();
  const med = (utm.medium || '').trim().toLowerCase();
  const ref = lookupHost(refHost);
  const alias = src && Object.hasOwn(ALIASES, src) ? ALIASES[src] : null;
  const tagged = src ? (alias ? { name: alias[0], kind: alias[1] } : lookupHost(src) || { name: utm.source.trim(), kind: 'tag' }) : null;
  const kind = tagged?.kind && tagged.kind !== 'tag' ? tagged.kind : ref?.kind;
  const name = tagged?.name || ref?.name || (refHost ? refHost.replace(/^www\./, '') : null);
  const paid = PAID.test(med);

  if (click.google || click.microsoft || (paid && kind === 'search')) {
    return { channel: 'Paid Search', source: name || (click.microsoft ? 'Microsoft Ads' : 'Google Ads') };
  }
  // TikTok adds its click id to ad clicks only. Facebook adds fbclid to ordinary posts too, so
  // on its own it does not prove an ad.
  if (click.tiktok || (paid && (kind === 'social' || click.meta))) {
    return { channel: 'Paid Social', source: name || (click.tiktok ? 'TikTok' : 'Meta') };
  }
  if (paid) return { channel: 'Paid Ads', source: name || 'Ads' };
  if (med === 'email' || med === 'e-mail' || med === 'newsletter' || kind === 'email') return { channel: 'Email', source: name || 'Email' };
  if (kind === 'ai') return { channel: 'AI Assistants', source: name };
  if (med === 'social' || kind === 'social' || click.meta) {
    return { channel: 'Organic Social', source: name || (click.meta ? 'Facebook or Instagram' : 'Social media') };
  }
  if (med === 'organic' || kind === 'search') return { channel: 'Organic Search', source: name || 'Search' };
  if (src || med || utm.campaign) return { channel: 'Campaigns', source: name || utm.campaign || 'Campaign' };
  if (refHost) return { channel: 'Referral', source: name };
  return { channel: 'Direct', source: 'Direct' };
}
