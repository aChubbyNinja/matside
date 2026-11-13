// Devices, browsers and robots: src/ua.js
//
// The user-agent strings are real ones, as the browsers send them.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isBot, isDataCentre, parseUA } from '../src/ua.js';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.0.2592.56 Mobile/15E148 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  galaxyTab: 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  androidEdge: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0',
  samsungInternet: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  // An iPad asking for desktop sites (the default since iPadOS 13) sends exactly what a Mac sends.
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  linuxChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  facebookIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 [FBAN/FBIOS;FBAV/471.0.0.36.103;FBBV/614439079;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/616581223]',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918U Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.134 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/471.0.0.42.80;IABMV/1;]',
  instagramIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 338.0.2.16.76 (iPhone15,2; iOS 17_5_1; en_US; en; scale=3.00; 1179x2556; 613222354) NW/3',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240705.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.134 Mobile Safari/537.36 Instagram 338.0.0.47.91 Android (34/14; 420dpi; 1080x2205; Google/google; Pixel 8; shiba; shiba; en_US; 614024531)',
};

const BOTS = {
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  googlebotPhone: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  headlessChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.6478.126 Safari/537.36',
  lighthouse: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  facebookPreview: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  uptimeRobot: 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
  curl: 'curl/8.5.0',
  pythonRequests: 'python-requests/2.32.3',
  nodeFetch: 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
};

describe('isBot', () => {
  test('search engine and AI crawlers are robots', () => {
    for (const name of ['googlebot', 'googlebotPhone', 'bingbot', 'gptbot']) assert.equal(isBot(BOTS[name]), true, name);
  });

  test('headless browsers, speed testers, link previews and uptime checks are robots', () => {
    for (const name of ['headlessChrome', 'lighthouse', 'facebookPreview', 'uptimeRobot']) assert.equal(isBot(BOTS[name]), true, name);
  });

  test('command-line tools and scripts are robots', () => {
    for (const name of ['curl', 'pythonRequests', 'nodeFetch']) assert.equal(isBot(BOTS[name]), true, name);
  });

  test('no user-agent at all is treated as a robot', () => {
    assert.equal(isBot(''), true);
    assert.equal(isBot(undefined), true);
    assert.equal(isBot(null), true);
  });

  test('a user-agent too short to be a real browser is treated as a robot', () => {
    assert.equal(isBot('Mozilla/5.0'), true);
    assert.equal(isBot('-'), true);
  });

  test('real people on every common browser are not robots', () => {
    for (const [name, ua] of Object.entries(UA)) assert.equal(isBot(ua), false, name);
  });

  test('people in the Facebook and Instagram in-app browsers are not robots', () => {
    for (const name of ['facebookIphone', 'facebookAndroid', 'instagramIphone', 'instagramAndroid']) assert.equal(isBot(UA[name]), false, name);
  });
});

describe('parseUA', () => {
  const expected = {
    iphoneSafari: { os: 'iOS', browser: 'Safari', device: 'Phone' },
    iphoneChrome: { os: 'iOS', browser: 'Chrome', device: 'Phone' },
    iphoneFirefox: { os: 'iOS', browser: 'Firefox', device: 'Phone' },
    iphoneEdge: { os: 'iOS', browser: 'Edge', device: 'Phone' },
    androidChrome: { os: 'Android', browser: 'Chrome', device: 'Phone' },
    androidTablet: { os: 'Android', browser: 'Chrome', device: 'Tablet' },
    galaxyTab: { os: 'Android', browser: 'Chrome', device: 'Tablet' },
    androidFirefox: { os: 'Android', browser: 'Firefox', device: 'Phone' },
    androidEdge: { os: 'Android', browser: 'Edge', device: 'Phone' },
    samsungInternet: { os: 'Android', browser: 'Samsung Internet', device: 'Phone' },
    ipad: { os: 'iPadOS', browser: 'Safari', device: 'Tablet' },
    macSafari: { os: 'macOS', browser: 'Safari', device: 'Desktop' },
    macChrome: { os: 'macOS', browser: 'Chrome', device: 'Desktop' },
    macFirefox: { os: 'macOS', browser: 'Firefox', device: 'Desktop' },
    windowsChrome: { os: 'Windows', browser: 'Chrome', device: 'Desktop' },
    windowsEdge: { os: 'Windows', browser: 'Edge', device: 'Desktop' },
    windowsFirefox: { os: 'Windows', browser: 'Firefox', device: 'Desktop' },
    linuxFirefox: { os: 'Linux', browser: 'Firefox', device: 'Desktop' },
    linuxChrome: { os: 'Linux', browser: 'Chrome', device: 'Desktop' },
    chromebook: { os: 'ChromeOS', browser: 'Chrome', device: 'Desktop' },
    facebookIphone: { os: 'iOS', browser: 'Facebook app', device: 'Phone' },
    facebookAndroid: { os: 'Android', browser: 'Facebook app', device: 'Phone' },
    instagramIphone: { os: 'iOS', browser: 'Instagram app', device: 'Phone' },
    instagramAndroid: { os: 'Android', browser: 'Instagram app', device: 'Phone' },
  };

  for (const [name, want] of Object.entries(expected)) {
    test(`${name}: ${want.browser} on ${want.os}, ${want.device}`, () => {
      assert.deepEqual(parseUA(UA[name]), want);
    });
  }

  test('every sample user-agent has an expectation', () => {
    assert.deepEqual(Object.keys(expected).sort(), Object.keys(UA).sort());
  });

  test('an iPad in desktop mode (a Macintosh user-agent plus a touch screen) is an iPad, not a Mac', () => {
    assert.deepEqual(parseUA(UA.macSafari, { touch: true }), { os: 'iPadOS', browser: 'Safari', device: 'Tablet' });
  });

  test('the same Macintosh user-agent without touch stays a Mac', () => {
    assert.deepEqual(parseUA(UA.macSafari, { touch: false }), { os: 'macOS', browser: 'Safari', device: 'Desktop' });
    assert.deepEqual(parseUA(UA.macSafari, {}), { os: 'macOS', browser: 'Safari', device: 'Desktop' });
  });

  test('a touch screen does not turn a Windows laptop or a Chromebook into a tablet', () => {
    assert.deepEqual(parseUA(UA.windowsChrome, { touch: true }), { os: 'Windows', browser: 'Chrome', device: 'Desktop' });
    assert.deepEqual(parseUA(UA.chromebook, { touch: true }), { os: 'ChromeOS', browser: 'Chrome', device: 'Desktop' });
  });

  test('a touch screen changes nothing for phones', () => {
    assert.deepEqual(parseUA(UA.iphoneSafari, { touch: true }), parseUA(UA.iphoneSafari));
    assert.deepEqual(parseUA(UA.androidChrome, { touch: true }), parseUA(UA.androidChrome));
  });

  test('an empty user-agent does not throw and claims no particular system or browser', () => {
    const r = parseUA('');
    assert.equal(r.os, 'Other');
    assert.equal(r.browser, 'Other');
    assert.equal(typeof r.device, 'string');
  });

  test('something unrecognisable does not throw', () => {
    const r = parseUA('SomethingNew/1.0 (Unknown Device)');
    assert.equal(r.os, 'Other');
    assert.equal(r.browser, 'Other');
  });
});

describe('isDataCentre', () => {
  test('cloud hosting networks are data centres', () => {
    assert.equal(isDataCentre(16509), true); // Amazon AWS
    assert.equal(isDataCentre(14618), true); // Amazon AWS
    assert.equal(isDataCentre(8075), true); // Microsoft Azure
    assert.equal(isDataCentre(14061), true); // DigitalOcean
    assert.equal(isDataCentre(24940), true); // Hetzner
    assert.equal(isDataCentre(16276), true); // OVH
  });

  test('the network number may arrive as text', () => {
    assert.equal(isDataCentre('16509'), true);
    assert.equal(isDataCentre('7922'), false);
  });

  test('home and mobile internet providers are not data centres', () => {
    assert.equal(isDataCentre(7922), false); // Comcast
    assert.equal(isDataCentre(7018), false); // AT&T
    assert.equal(isDataCentre(701), false); // Verizon
    assert.equal(isDataCentre(21928), false); // T-Mobile
    assert.equal(isDataCentre(20115), false); // Charter / Spectrum
  });

  test('privacy relays that real people browse through are not data centres', () => {
    assert.equal(isDataCentre(13335), false); // Cloudflare (WARP, iCloud Private Relay)
    assert.equal(isDataCentre(36183), false); // Akamai (iCloud Private Relay)
  });

  test('an unknown network is not a data centre', () => {
    assert.equal(isDataCentre(undefined), false);
    assert.equal(isDataCentre(null), false);
    assert.equal(isDataCentre(''), false);
    assert.equal(isDataCentre('not a number'), false);
  });
});
