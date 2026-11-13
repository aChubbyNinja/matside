// Where a visit came from: src/channels.js
//
// Every case is written from what an owner would expect to read on the dashboard for that
// visit, not from how classify() happens to be built.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNELS, classify, lookupHost } from '../src/channels.js';

/** A visit the way the collector describes it: referrer hostname, campaign tags, click ids. */
function visit({ ref = null, source = null, medium = null, campaign = null, gclid = false, fbclid = false, msclkid = false, ttclid = false } = {}) {
  return classify({
    refHost: ref,
    utm: { source, medium, campaign },
    click: { google: gclid, meta: fbclid, microsoft: msclkid, tiktok: ttclid },
  });
}

describe('classify: search engines', () => {
  test('a click on a Google result is Organic Search from Google', () => {
    assert.deepEqual(visit({ ref: 'www.google.com' }), { channel: 'Organic Search', source: 'Google' });
    assert.deepEqual(visit({ ref: 'google.com' }), { channel: 'Organic Search', source: 'Google' });
  });

  test('country versions of Google count as Google', () => {
    for (const ref of ['www.google.co.uk', 'google.co.uk', 'www.google.ca', 'www.google.de', 'www.google.com.au', 'www.google.com.mx']) {
      assert.deepEqual(visit({ ref }), { channel: 'Organic Search', source: 'Google' }, ref);
    }
  });

  test('other search engines are Organic Search under their own name', () => {
    assert.deepEqual(visit({ ref: 'www.bing.com' }), { channel: 'Organic Search', source: 'Bing' });
    assert.deepEqual(visit({ ref: 'duckduckgo.com' }), { channel: 'Organic Search', source: 'DuckDuckGo' });
    assert.deepEqual(visit({ ref: 'search.yahoo.com' }), { channel: 'Organic Search', source: 'Yahoo' });
  });

  test('a Google Business Profile link tagged google / organic is Organic Search', () => {
    assert.deepEqual(visit({ source: 'google', medium: 'organic', campaign: 'gbp' }), { channel: 'Organic Search', source: 'Google' });
  });

  test('a link with gclid is a paid Google click, whatever else is known', () => {
    const bare = visit({ gclid: true });
    assert.equal(bare.channel, 'Paid Search');
    assert.match(bare.source, /Google/);

    const withReferrer = visit({ ref: 'www.google.com', gclid: true });
    assert.equal(withReferrer.channel, 'Paid Search');
    assert.match(withReferrer.source, /Google/);
  });

  test('a link with msclkid is a paid Microsoft / Bing click', () => {
    const bare = visit({ msclkid: true });
    assert.equal(bare.channel, 'Paid Search');
    assert.match(bare.source, /Microsoft|Bing/);

    assert.deepEqual(visit({ ref: 'www.bing.com', msclkid: true }), { channel: 'Paid Search', source: 'Bing' });
  });

  test('utm_source=google&utm_medium=cpc is Paid Search even without a click id', () => {
    assert.deepEqual(visit({ source: 'google', medium: 'cpc', campaign: 'spring' }), { channel: 'Paid Search', source: 'Google' });
    assert.deepEqual(visit({ source: 'bing', medium: 'ppc' }), { channel: 'Paid Search', source: 'Bing' });
  });

  test('the Google app on Android (android-app://com.google.android.googlequicksearchbox) is a Google search', () => {
      assert.deepEqual(visit({ ref: 'com.google.android.googlequicksearchbox' }), { channel: 'Organic Search', source: 'Google' });
    });

  test('a link inside a Google Doc, Site or Classroom is not a Google search', () => {
      for (const ref of ['docs.google.com', 'sites.google.com', 'classroom.google.com']) {
        assert.notEqual(visit({ ref }).channel, 'Organic Search', ref);
      }
    });
});

describe('classify: Facebook, Instagram and other social', () => {
  test('the link shims Instagram and Facebook put in front of every click are Organic Social', () => {
    assert.deepEqual(visit({ ref: 'l.instagram.com' }), { channel: 'Organic Social', source: 'Instagram' });
    assert.deepEqual(visit({ ref: 'lm.facebook.com' }), { channel: 'Organic Social', source: 'Facebook' });
    assert.deepEqual(visit({ ref: 'l.facebook.com' }), { channel: 'Organic Social', source: 'Facebook' });
    assert.deepEqual(visit({ ref: 'm.facebook.com' }), { channel: 'Organic Social', source: 'Facebook' });
    assert.deepEqual(visit({ ref: 'www.instagram.com' }), { channel: 'Organic Social', source: 'Instagram' });
  });

  test('a link with only fbclid and no tags is an unpaid click from Facebook or Instagram', () => {
    const r = visit({ fbclid: true });
    assert.equal(r.channel, 'Organic Social');
    assert.match(r.source, /Facebook|Instagram|Meta/);
  });

  test('fbclid plus the Instagram shim names Instagram', () => {
    assert.deepEqual(visit({ ref: 'l.instagram.com', fbclid: true }), { channel: 'Organic Social', source: 'Instagram' });
  });

  test("Meta's ad macro values (fb, ig, msg, an, th) with paid_social are Paid Social under the placement's name", () => {
    const expected = { fb: 'Facebook', ig: 'Instagram', msg: 'Messenger', an: 'Audience Network', th: 'Threads' };
    for (const [source, name] of Object.entries(expected)) {
      assert.deepEqual(visit({ source, medium: 'paid_social' }), { channel: 'Paid Social', source: name }, source);
    }
  });

  test('a real Meta ad click (tags, fbclid and the shim referrer together) is Paid Social from Instagram', () => {
    assert.deepEqual(
      visit({ ref: 'l.instagram.com', source: 'ig', medium: 'paid_social', campaign: 'Spring', fbclid: true }),
      { channel: 'Paid Social', source: 'Instagram' },
    );
  });

  test('tags are not case sensitive, and common spellings of "paid" all count', () => {
    assert.deepEqual(visit({ source: 'IG', medium: 'Paid_Social' }), { channel: 'Paid Social', source: 'Instagram' });
    for (const medium of ['paid', 'paid-social', 'paidsocial', 'paid social', 'cpc', 'ppc', 'ads']) {
      assert.deepEqual(visit({ source: 'facebook', medium }), { channel: 'Paid Social', source: 'Facebook' }, medium);
    }
  });

  test('an unpaid post tagged facebook / social is Organic Social', () => {
    assert.deepEqual(visit({ source: 'facebook', medium: 'social', campaign: 'open-house' }), { channel: 'Organic Social', source: 'Facebook' });
  });

  test('X, YouTube, TikTok and Nextdoor are Organic Social', () => {
    assert.equal(visit({ ref: 't.co' }).channel, 'Organic Social');
    assert.match(visit({ ref: 't.co' }).source, /X|Twitter/);
    assert.deepEqual(visit({ ref: 'www.youtube.com' }), { channel: 'Organic Social', source: 'YouTube' });
    assert.deepEqual(visit({ ref: 'www.tiktok.com' }), { channel: 'Organic Social', source: 'TikTok' });
    assert.deepEqual(visit({ ref: 'nextdoor.com' }), { channel: 'Organic Social', source: 'Nextdoor' });
  });

  test('a link with only ttclid is a paid TikTok click (TikTok adds ttclid to ad clicks only)', () => {
      assert.deepEqual(visit({ ttclid: true }), { channel: 'Paid Social', source: 'TikTok' });
    });

  test('utm_medium=social with nothing else does not claim the visit for Facebook or Instagram', () => {
      const r = visit({ medium: 'social', campaign: 'open-house' });
      assert.equal(r.channel, 'Organic Social');
      assert.doesNotMatch(r.source, /Facebook|Instagram/);
    });
});

describe('classify: AI assistants', () => {
  test('a click out of ChatGPT is AI Assistants, by referrer or by the tag ChatGPT adds', () => {
    assert.deepEqual(visit({ ref: 'chatgpt.com' }), { channel: 'AI Assistants', source: 'ChatGPT' });
    assert.deepEqual(visit({ source: 'chatgpt.com' }), { channel: 'AI Assistants', source: 'ChatGPT' });
    assert.deepEqual(visit({ ref: 'chatgpt.com', source: 'chatgpt.com' }), { channel: 'AI Assistants', source: 'ChatGPT' });
  });

  test('Perplexity, Gemini, Claude and Copilot are AI Assistants', () => {
    assert.deepEqual(visit({ ref: 'perplexity.ai' }), { channel: 'AI Assistants', source: 'Perplexity' });
    assert.deepEqual(visit({ ref: 'www.perplexity.ai' }), { channel: 'AI Assistants', source: 'Perplexity' });
    assert.deepEqual(visit({ ref: 'gemini.google.com' }), { channel: 'AI Assistants', source: 'Gemini' });
    assert.deepEqual(visit({ ref: 'claude.ai' }), { channel: 'AI Assistants', source: 'Claude' });
    assert.deepEqual(visit({ ref: 'copilot.microsoft.com' }), { channel: 'AI Assistants', source: 'Copilot' });
  });
});

describe('classify: email', () => {
  test('a newsletter link tagged utm_medium=email is Email', () => {
    assert.deepEqual(visit({ source: 'newsletter', medium: 'email', campaign: 'march' }), { channel: 'Email', source: 'Newsletter' });
    assert.deepEqual(visit({ source: 'mailchimp', medium: 'email' }), { channel: 'Email', source: 'Mailchimp' });
  });

  test('an email tag the list does not know keeps the name the owner typed', () => {
    assert.deepEqual(visit({ source: 'March-Update', medium: 'email' }), { channel: 'Email', source: 'March-Update' });
  });

  test('utm_medium=email on its own is still Email', () => {
    const r = visit({ medium: 'email' });
    assert.equal(r.channel, 'Email');
    assert.ok(r.source);
  });

  test('a click from Gmail in the browser is Email, not a Google search', () => {
    assert.deepEqual(visit({ ref: 'mail.google.com' }), { channel: 'Email', source: 'Gmail' });
  });

  test('the Gmail Android app and Outlook on the web are Email', () => {
    assert.deepEqual(visit({ ref: 'com.google.android.gm' }), { channel: 'Email', source: 'Gmail' });
    assert.deepEqual(visit({ ref: 'outlook.live.com' }), { channel: 'Email', source: 'Outlook' });
  });
});

describe('classify: printed and other tagged links', () => {
  test('a flyer QR code tagged flyer / print is a Campaign called Flyer', () => {
    assert.deepEqual(visit({ source: 'flyer', medium: 'print', campaign: 'fall-signup' }), { channel: 'Campaigns', source: 'Flyer' });
  });

  test('utm_source=qr is a Campaign', () => {
    const r = visit({ source: 'qr' });
    assert.equal(r.channel, 'Campaigns');
    assert.match(r.source, /QR/i);
  });

  test('a tag nobody has heard of is a Campaign under the name on the link', () => {
    assert.deepEqual(visit({ source: 'gym-banner', medium: 'offline' }), { channel: 'Campaigns', source: 'gym-banner' });
  });

  test('a link with only utm_campaign is a Campaign named after it', () => {
    assert.deepEqual(visit({ campaign: 'summer-camp' }), { channel: 'Campaigns', source: 'summer-camp' });
  });

  test('a paid tag on a source that is neither search nor social is Paid Ads', () => {
    assert.deepEqual(visit({ source: 'localpaper', medium: 'banner' }), { channel: 'Paid Ads', source: 'localpaper' });
  });
});

describe('classify: referrals and direct', () => {
  test('a link on some other website is a Referral from that site, without the www', () => {
    assert.deepEqual(visit({ ref: 'www.valleyyouthsports.org' }), { channel: 'Referral', source: 'valleyyouthsports.org' });
    assert.deepEqual(visit({ ref: 'news.example.net' }), { channel: 'Referral', source: 'news.example.net' });
  });

  test('directories keep their friendly name', () => {
    assert.deepEqual(visit({ ref: 'www.yelp.com' }), { channel: 'Referral', source: 'Yelp' });
    assert.deepEqual(visit({ ref: 'linktr.ee' }), { channel: 'Referral', source: 'Linktree' });
  });

  test('no referrer, no tags and no click id is Direct', () => {
    assert.deepEqual(visit(), { channel: 'Direct', source: 'Direct' });
    assert.deepEqual(classify({}), { channel: 'Direct', source: 'Direct' });
    assert.deepEqual(classify({ refHost: '', utm: { source: '', medium: '  ', campaign: null }, click: {} }), { channel: 'Direct', source: 'Direct' });
  });

  test('a host that only ends with the letters of a known one is an ordinary Referral', () => {
    const lookalikes = [
      'fedex.com', 'netflix.com', 'dropbox.com', // end in "x.com"
      'notgoogle.com', 'mygoogle.co.uk', // contain "google."
      'budget.co', // ends in "t.co"
      'sfb.com', // ends in "fb.com"
      'scout.me', // ends in "t.me"
      'notinstagram.com', 'myfacebook.com', 'unbing.com', 'fakechatgpt.com',
      'google.com.evil.example', 'instagram.com.evil.example', 'chatgpt.com.evil.example',
    ];
    for (const ref of lookalikes) {
      assert.deepEqual(visit({ ref }), { channel: 'Referral', source: ref }, ref);
    }
  });

  test('every answer names one of the published channels and a source', () => {
    const samples = [
      {}, { ref: 'www.google.com' }, { ref: 'example.org' }, { fbclid: true }, { gclid: true }, { msclkid: true }, { ttclid: true },
      { source: 'ig', medium: 'paid_social' }, { source: 'flyer', medium: 'print' }, { medium: 'email' }, { medium: 'cpc' },
      { medium: 'social' }, { medium: 'organic' }, { campaign: 'x' }, { ref: 'chatgpt.com' }, { source: 'chatgpt.com' },
    ];
    for (const s of samples) {
      const r = visit(s);
      assert.ok(CHANNELS.includes(r.channel), `${JSON.stringify(s)} -> ${r.channel}`);
      assert.equal(typeof r.source, 'string', JSON.stringify(s));
      assert.ok(r.source.length > 0, JSON.stringify(s));
    }
  });
});

describe('lookupHost', () => {
  test('names the well-known hosts and says what kind they are', () => {
    assert.deepEqual(lookupHost('google.com'), { name: 'Google', kind: 'search' });
    assert.deepEqual(lookupHost('www.google.co.uk'), { name: 'Google', kind: 'search' });
    assert.deepEqual(lookupHost('l.instagram.com'), { name: 'Instagram', kind: 'social' });
    assert.deepEqual(lookupHost('lm.facebook.com'), { name: 'Facebook', kind: 'social' });
    assert.deepEqual(lookupHost('chatgpt.com'), { name: 'ChatGPT', kind: 'ai' });
    assert.deepEqual(lookupHost('www.perplexity.ai'), { name: 'Perplexity', kind: 'ai' });
    assert.deepEqual(lookupHost('mail.google.com'), { name: 'Gmail', kind: 'email' });
    assert.deepEqual(lookupHost('gemini.google.com'), { name: 'Gemini', kind: 'ai' });
  });

  test('ignores case and a leading www', () => {
    assert.deepEqual(lookupHost('WWW.Google.COM'), { name: 'Google', kind: 'search' });
    assert.deepEqual(lookupHost('www.x.com'), lookupHost('x.com'));
    assert.match(lookupHost('x.com').name, /X|Twitter/);
  });

  test('answers null for hosts it does not know', () => {
    assert.equal(lookupHost('valleyyouthsports.org'), null);
    assert.equal(lookupHost('localhost'), null);
  });

  test('answers null when there is no host at all', () => {
    assert.equal(lookupHost(null), null);
    assert.equal(lookupHost(undefined), null);
    assert.equal(lookupHost(''), null);
  });

  test('does not mistake look-alike hosts for known ones', () => {
    for (const host of ['fedex.com', 'netflix.com', 'notgoogle.com', 'budget.co', 'sfb.com', 'google.com.evil.example', 'x.com.evil.example']) {
      assert.equal(lookupHost(host), null, host);
    }
  });
});
