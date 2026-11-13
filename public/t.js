/*! Matside: the snippet. No cookies, no fingerprinting, nothing stored on the visitor's device. MIT. */
/*
  <script defer src="https://YOUR-DASHBOARD/t.js" data-site="your-site"></script>

  It reports, on its own:
    page views, time actually spent reading, how far down the page people get,
    clicks on links that leave the site, phone / email / text links, file downloads, form submits,
    plays, watch time and finishes of <video> elements and YouTube embeds (with enablejsapi=1).

  Name anything else in the HTML:
    <a href="/signup" data-m="Sign-up click" data-m-plan="Family">Join</a>
  or from script:
    matside('Quiz finished', { result: 'Beginner' })

  Attributes on the script tag:
    data-site       which website this is (required)
    data-api        where to report, if not the place this file was loaded from
    data-honor-dnt  leave out visitors who have "Do Not Track" turned on
    data-count-localhost  count visits to localhost too (left out by default, so your own
                          previews of a site never show up as visitors)
*/
(function () {
  'use strict';
  var w = window, d = document, n = navigator, l = location;
  var me = d.currentScript;
  // Only ever a real <script> tag (a page element merely *named* currentScript must not pass for one).
  if (!me || me.tagName !== 'SCRIPT' || w.__matside || l.protocol === 'file:') return;
  var site = me.getAttribute('data-site');
  if (!site) return;
  var api = me.getAttribute('data-api') || new URL('/e', me.src).href;
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(l.hostname) && !me.hasAttribute('data-count-localhost')) { w.matside = function () {}; return; }
  var queued = (w.matside && w.matside.q) || [];
  w.__matside = 1;

  // The owner can leave their own visits out: open any page once with ?matside=off (=on undoes it).
  try {
    var flag = /[?&]matside=(off|on)\b/.exec(l.search);
    if (flag && flag[1] === 'on' && localStorage.getItem('matside-off')) {
      localStorage.removeItem('matside-off');
      note('Visits from this device are counted again.');
    } else if (flag && flag[1] === 'off' && !localStorage.getItem('matside-off')) {
      // Ask first: a link alone must not be able to hide someone else's visitors.
      note('Leave visits from this device out of the statistics?', 'Yes, leave this device out', function () {
        localStorage.setItem('matside-off', '1');
        note('Done. Visits from this device are no longer counted.');
      });
    }
    if (localStorage.getItem('matside-off')) { w.matside = function () {}; return; }
  } catch (e) { /* storage blocked: carry on counting */ }
  if (me.hasAttribute('data-honor-dnt') && (n.doNotTrack === '1' || w.doNotTrack === '1')) { w.matside = function () {}; return; }

  var pid = null, url = '', path = '', first = true;
  var engaged = 0, sentEngaged = 0, deepest = 0, sentDeepest = 0, visibleAt = 0, lastActive = 0, beats = 0, timer = 0;
  var videos = [];

  function now() { return Date.now(); }
  // Only what the dashboard keeps ever leaves the page: the address without its query string or
  // fragment, plus the campaign tags; for ad click ids, only whether one was there.
  var KEEP = /^(utm_(source|medium|campaign|content|term|id)|gclid|gbraid|wbraid|fbclid|msclkid|ttclid)$/;
  function here() {
    var q = [];
    try {
      new URLSearchParams(l.search).forEach(function (value, key) {
        if (KEEP.test(key)) q.push(key + '=' + encodeURIComponent(key.indexOf('utm_') === 0 ? value : '1'));
      });
    } catch (e) { /* very old browser: no tags */ }
    return l.origin + l.pathname + (q.length ? '?' + q.join('&') : '');
  }
  function bareAddress(address) {
    try {
      var u = new URL(address);
      return (/^https?:$/.test(u.protocol) ? u.origin : u.protocol + '//' + u.host) + u.pathname;
    } catch (e) { return ''; }
  }
  function rid() { return (Math.random().toString(36).slice(2, 10) + now().toString(36).slice(-5)).replace(/[^a-z0-9]/g, '0'); }

  function note(message, button, onYes) {
    var show = function () {
      var old = d.getElementById('matside-note');
      if (old) old.remove();
      var b = d.createElement('div');
      b.id = 'matside-note';
      b.textContent = message;
      b.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);max-width:90vw;background:#111;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3)';
      if (button) {
        var yes = d.createElement('button');
        yes.type = 'button';
        yes.textContent = button;
        yes.style.cssText = 'margin-left:12px;padding:6px 12px;border:0;border-radius:6px;background:#fff;color:#111;font:inherit;font-weight:600;cursor:pointer';
        yes.addEventListener('click', onYes);
        b.appendChild(yes);
      }
      d.body.appendChild(b);
      setTimeout(function () { b.remove(); }, button ? 30000 : 6000);
    };
    if (d.body) show(); else d.addEventListener('DOMContentLoaded', show);
  }

  function send(o) {
    o.s = site;
    if (n.webdriver) o.b = 1;
    var body = JSON.stringify(o);
    try { if (n.sendBeacon && n.sendBeacon(api, body)) return; } catch (e) { /* fall through */ }
    try { fetch(api, { method: 'POST', body: body, keepalive: true, mode: 'no-cors', credentials: 'omit' }); } catch (e) { /* offline */ }
  }

  function track(name, props) {
    if (!name) return;
    var o = { n: String(name), p: pid, u: here() };
    if (props && typeof props === 'object') o.m = props;
    send(o);
  }

  // ---- time on page: only while the tab is in front and the person is doing something
  function tally() {
    var t = now();
    if (visibleAt) {
      var end = Math.min(t, lastActive + 30000);
      if (end > visibleAt) engaged += end - visibleAt;
      visibleAt = t;
    }
  }
  function active() {
    var t = now();
    if (t - lastActive > 30000) { tally(); visibleAt = d.visibilityState === 'visible' ? t : 0; }
    lastActive = t;
  }
  function depth() {
    var e = d.documentElement, b = d.body || e;
    var full = Math.max(e.scrollHeight, b.scrollHeight), view = w.innerHeight || e.clientHeight;
    var p = full <= view ? 100 : Math.min(100, Math.round(((w.pageYOffset || e.scrollTop || 0) + view) / full * 100));
    if (p > deepest) deepest = p;
  }
  function flush() {
    if (!pid) return;
    tally();
    depth();
    if (engaged - sentEngaged >= 1000 || (deepest > sentDeepest && engaged >= 1000)) {
      sentEngaged = engaged;
      sentDeepest = deepest;
      send({ n: 'engage', p: pid, u: url, e: Math.round(engaged), d: deepest });
    }
    videos.forEach(videoFlush);
  }
  // Check in after 5, 15, 30 and 60 seconds, then every minute for a while. The report sent as
  // someone leaves usually arrives, but not always; these mean the time is never lost entirely.
  function schedule() {
    clearTimeout(timer);
    if (beats >= 16) return;
    timer = setTimeout(function () {
      beats++;
      if (d.visibilityState === 'visible') flush();
      schedule();
    }, [5000, 10000, 15000, 30000][beats] || 60000);
  }

  function page() {
    flush();
    var referrer = first ? bareAddress(d.referrer) : url;
    first = false;
    pid = rid();
    url = here();
    path = l.pathname;
    engaged = sentEngaged = deepest = sentDeepest = beats = 0;
    lastActive = now();
    visibleAt = d.visibilityState === 'visible' ? lastActive : 0;
    send({ n: 'pageview', p: pid, u: url, r: referrer, t: n.maxTouchPoints > 1 ? 1 : 0 });
    schedule();
  }

  // ---- clicks and forms
  function props(el) {
    var o = {}, a = el.attributes, i, k;
    for (i = 0; i < a.length; i++) {
      k = a[i].name;
      if (k.indexOf('data-m-') === 0 && k !== 'data-m-ignore') o[k.slice(7).replace(/-/g, '_')] = a[i].value;
    }
    return o;
  }
  function label(el) {
    return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  function bare(host) { return String(host || '').replace(/^www\./, ''); }
  function onClick(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var named = t.closest('[data-m]');
    if (named && named.tagName !== 'FORM') { track(named.getAttribute('data-m'), props(named)); return; }
    var a = t.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^tel:/i.test(href)) track('Phone tap', { number: href.slice(4) });
    else if (/^sms:/i.test(href)) track('Text tap');
    else if (/^mailto:/i.test(href) || href.indexOf('/cdn-cgi/l/email-protection') > -1) track('Email tap');
    else if (/^https?:$/.test(a.protocol) && bare(a.hostname) !== bare(l.hostname)) track('Outbound click', { url: bare(a.hostname) + a.pathname, text: label(a) });
    else if (/\.(pdf|docx?|xlsx?|csv|zip|pptx?|ics|mp3|mp4|mov)$/i.test(a.pathname)) track('File download', { file: a.pathname });
  }
  d.addEventListener('click', onClick, true);
  d.addEventListener('auxclick', function (ev) { if (ev.button === 1) onClick(ev); }, true);
  d.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (!f || !f.getAttribute || f.hasAttribute('data-m-ignore')) return;
    var p = props(f);
    p.form = f.getAttribute('name') || f.id || 'form';
    track(f.getAttribute('data-m') || 'Form submit', p);
  }, true);

  // ---- video: plays, seconds actually watched, and finishes
  function videoFor(el, key, title) {
    for (var i = 0; i < videos.length; i++) if (videos[i].el === el && videos[i].key === key) return videos[i];
    var v = { el: el, key: key, title: String(title || 'Video').slice(0, 120), since: 0, watched: 0, sent: 0, started: 0, done: 0 };
    videos.push(v);
    return v;
  }
  function videoPlay(v) {
    if (!v.started) { v.started = 1; track('Video play', { video: v.title }); }
    if (!v.since) v.since = now();
  }
  function videoStop(v) {
    if (v.since) { v.watched += now() - v.since; v.since = 0; }
  }
  function videoAt(v, current, duration) {
    if (!v.done && duration > 0 && current / duration >= 0.95) { v.done = 1; track('Video complete', { video: v.title }); }
  }
  function videoFlush(v) {
    var playing = v.since && d.contains(v.el);
    videoStop(v);
    if (playing) v.since = now();
    var seconds = Math.round((v.watched - v.sent) / 1000);
    if (seconds >= 1) { v.sent += seconds * 1000; track('Video watch', { video: v.title, seconds: seconds }); }
  }
  ['play', 'pause', 'ended', 'timeupdate'].forEach(function (type) {
    d.addEventListener(type, function (ev) {
      var el = ev.target;
      if (!el || el.tagName !== 'VIDEO' || el.hasAttribute('data-m-ignore') || (el.muted && el.loop)) return;
      var src = el.currentSrc || el.src || '';
      var v = videoFor(el, src, el.getAttribute('data-m-title') || el.getAttribute('title') || el.getAttribute('aria-label') || src.split('/').pop().split('?')[0]);
      if (type === 'play') videoPlay(v);
      else if (type === 'timeupdate') videoAt(v, el.currentTime, el.duration);
      else { videoStop(v); if (type === 'ended') videoAt(v, 1, 1); videoFlush(v); }
    }, true);
  });
  // YouTube embeds report their state to the page when their address includes enablejsapi=1.
  function wire(frame) {
    var src = frame.src || '';
    if (frame.__m === src || !/youtube(-nocookie)?\.com\/embed\//.test(src) || src.indexOf('enablejsapi=1') < 0) return;
    frame.__m = src;
    frame.__heard = 0;
    var tries = 0;
    var knock = function () {
      try { frame.contentWindow.postMessage('{"event":"listening","id":1,"channel":"widget"}', '*'); } catch (e) { /* not ready */ }
      if (++tries < 20 && !frame.__heard && frame.__m === src && d.contains(frame)) setTimeout(knock, 500);
    };
    frame.addEventListener('load', knock);
    knock();
  }
  w.addEventListener('message', function (ev) {
    if (typeof ev.data !== 'string' || !/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(ev.origin)) return;
    var info;
    try { info = JSON.parse(ev.data).info; } catch (e) { return; }
    if (!info) return;
    var frames = d.getElementsByTagName('iframe'), frame = null, i;
    for (i = 0; i < frames.length; i++) if (frames[i].contentWindow === ev.source) frame = frames[i];
    if (!frame) return;
    frame.__heard = 1;
    var v = videoFor(frame, frame.src, frame.getAttribute('data-m-title') || (info.videoData && info.videoData.title) || frame.title || 'YouTube video');
    if (info.duration) v.duration = info.duration;
    if (typeof info.currentTime === 'number') v.current = info.currentTime;
    if (typeof info.playerState === 'number') {
      if (info.playerState === 1) videoPlay(v);
      else if (info.playerState !== 3) { videoStop(v); if (info.playerState === 0) videoAt(v, 1, 1); videoFlush(v); }
    }
    if (v.since) videoAt(v, v.current || 0, v.duration || 0);
  });
  var scanning = 0;
  function scan() {
    scanning = 0;
    var frames = d.getElementsByTagName('iframe'), i;
    for (i = 0; i < frames.length; i++) wire(frames[i]);
    // A player that was closed (removed from the page) has stopped playing.
    videos.forEach(function (v) { if (v.since && !d.contains(v.el)) { videoStop(v); videoFlush(v); } });
  }
  if (w.MutationObserver) {
    new MutationObserver(function () { if (!scanning) scanning = setTimeout(scan, 150); })
      .observe(d.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }

  // ---- lifecycle
  d.addEventListener('visibilitychange', function () {
    if (d.visibilityState === 'hidden') { flush(); visibleAt = 0; }
    else { visibleAt = lastActive = now(); schedule(); }
  });
  w.addEventListener('pagehide', flush);
  w.addEventListener('pageshow', function (ev) { if (ev.persisted) page(); });
  ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'].forEach(function (type) {
    w.addEventListener(type, active, { passive: true, capture: true });
  });
  w.addEventListener('scroll', depth, { passive: true });
  // Single-page apps change the address without loading a page.
  var push = history.pushState;
  function routed() { if (l.pathname !== path) page(); }
  if (push) {
    history.pushState = function () { var r = push.apply(this, arguments); routed(); return r; };
    w.addEventListener('popstate', routed);
  }

  function start() {
    w.matside = track;
    page();
    scan();
    for (var i = 0; i < queued.length; i++) track.apply(null, queued[i]);
  }
  if (d.prerendering) d.addEventListener('prerenderingchange', start, { once: true });
  else start();
})();
