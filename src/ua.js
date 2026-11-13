// What kind of device and browser a visit came from, and whether it is a robot.
// Deliberately small: a handful of patterns cover what a small-business owner needs to know.

const BOT = new RegExp(
  [
    'bot', 'crawl', 'spider', 'slurp', 'scrape', 'headless', 'phantom', 'puppeteer', 'playwright', 'selenium',
    'lighthouse', 'pagespeed', 'gtmetrix', 'pingdom', 'uptime', 'monitor', 'curl/', 'wget', 'python', 'httpclient',
    'okhttp', 'java/', 'go-http', 'axios', 'node-fetch', 'undici', 'facebookexternalhit', 'whatsapp', 'telegram',
    'discord', 'embedly', 'prerender', 'inspectiontool', 'bingpreview', 'linkpreview', 'semrush', 'ahrefs', 'mj12',
    'petal', 'bytespider', 'oai-search', 'chatgpt-user', 'claude-web', 'claude-user', 'perplexity-user',
    'feedfetcher', 'mediapartners', 'google-read-aloud', 'yandex', 'baidu',
  ]
    .map((s) => s.replace(/[/-]/g, '\\$&'))
    .join('|'),
  'i',
);

export function isBot(ua) {
  return !ua || ua.length < 20 || BOT.test(ua);
}

/**
 * @param {string} ua  the User-Agent header
 * @param {{touch?: boolean}} hints  what the page itself reported
 */
export function parseUA(ua, hints = {}) {
  let os = 'Other';
  if (/iPhone|iPod/.test(ua)) os = 'iOS';
  else if (/iPad/.test(ua)) os = 'iPadOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux|X11/.test(ua)) os = 'Linux';
  // An iPad asks for desktop sites, so it says it is a Mac. Macs have no touch screen.
  if (os === 'macOS' && hints.touch) os = 'iPadOS';

  let browser = 'Other';
  if (/FBAN|FBAV|FB_IAB/.test(ua)) browser = 'Facebook app';
  else if (/Instagram/.test(ua)) browser = 'Instagram app';
  else if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) browser = 'TikTok app';
  else if (/Snapchat/.test(ua)) browser = 'Snapchat app';
  else if (/GSA\//.test(ua)) browser = 'Google app';
  else if (/EdgA?\/|EdgiOS/.test(ua)) browser = 'Edge';
  else if (/OPR\/|OPT\//.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/DuckDuckGo/.test(ua)) browser = 'DuckDuckGo';
  else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS|Chromium/.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  let device = 'Desktop';
  if (os === 'iPadOS' || /Tablet|SM-T\d|Kindle|Silk\//.test(ua) || (os === 'Android' && !/Mobile/.test(ua))) device = 'Tablet';
  else if (os === 'iOS' || os === 'Android' || /Mobi/.test(ua)) device = 'Phone';

  return { os, browser, device };
}

// Networks that host servers, not people. Traffic from them is automated far more often than not.
// (Apple's iCloud Private Relay and Cloudflare WARP are left out on purpose: those are real people.)
const DATA_CENTRES = new Set([
  16509, 14618, 8987, // Amazon
  15169, 396982, 19527, // Google Cloud
  8075, 8068, // Microsoft Azure
  14061, // DigitalOcean
  16276, // OVH
  24940, 213230, // Hetzner
  63949, // Linode
  20473, // Vultr
  51167, // Contabo
  45102, 37963, // Alibaba
  132203, 45090, // Tencent
  31898, // Oracle
  12876, // Scaleway
  9009, // M247
  53667, // FranTech
  36352, // ColoCrossing
]);

export const isDataCentre = (asn) => DATA_CENTRES.has(Number(asn));
