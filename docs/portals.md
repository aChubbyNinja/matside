# Booking portals

Many small businesses send people from their website to a portal on someone else's domain to book, register or pay: iClassPro, Mindbody, a ticketing page. That is where the visit you care about ends, and where most analytics lose sight of it.

Matside can keep following, in the same visit, with no cookie and nothing added to your links. The visitor id is a hash of the day's salt, your site, the IP address and the browser; it does not include the hostname. So a report from the portal, minutes after a report from your website, from the same phone, lands in the same visit. The journey card can then show **saw a program, clicked Register, finished enrolling**, and every source and campaign gets a true conversion count.

Two things are needed.

## 1. Tell Matside the portal belongs to the site

Settings, your website, **Booking or checkout portal**. Enter the portal's address, with the part of the path that is yours:

```
portal.iclasspro.com/yourname
```

Pages on the portal are then listed with their host in front (`portal.iclasspro.com/yourname/classes`) and marked "portal", apart from your own pages.

## 2. Get the portal to report

**If the portal lets you add your own script**, add the usual line. Done.

**If it only allows Google Tag Manager** (iClassPro does: Settings, Customer Portal, Other Settings, Marketing and Branding, "Google Tag Manager"), use a tag. After you have entered a portal in step 1, Settings shows the tag with your details filled in, with a Copy button. It looks like this:

```html
<script>
(function () {
  var site = "my-site", api = "https://your-dashboard/e";
  var names = { "family-created": "Account created", "added-to-cart": "Added to cart", "checkout-started": "Checkout started", "checkout-complete": "Enrollment complete" };
  var ev = {{Event}};
  function send(o) { o.s = site; o.u = location.href; try { navigator.sendBeacon(api, JSON.stringify(o)); } catch (e) {} }
  if (ev === "gtm.js" || ev === "gtm.historyChange") {
    if (window.__matsideAt === location.pathname) return;
    window.__matsideAt = location.pathname;
    send({ n: "pageview", p: Math.random().toString(36).slice(2, 12), r: document.referrer, w: innerWidth });
  } else if (Object.prototype.hasOwnProperty.call(names, ev)) send({ n: names[ev] });
})();
</script>
```

In [Google Tag Manager](https://tagmanager.google.com):

1. Create a container for the portal (type **Web**) and put its ID (`GTM-…`) into the portal's settings.
2. **Variables**: under Built-In Variables, tick **Event**.
3. **Triggers**: create three.
   - *All Pages* (it exists already).
   - *History Change* (trigger type "History Change"), because the portal is a single-page app.
   - *Custom Event* with the event name `family-created|added-to-cart|checkout-started|checkout-complete` and "Use regex matching" ticked.
4. **Tags**: new tag, type **Custom HTML**, paste the tag, and attach all three triggers.
5. **Submit** to publish the container.

The names on the left of `names` are the events iClassPro's portal announces; the names on the right are what you will see in Matside. Change them to suit, then star **Enrollment complete** as a key action and add it as the last step of your journey.

The tag sends the page address and the event's name. It does not read the page, the cart, or anything the customer typed.

> The cross-domain visit is covered by Matside's own tests. The tag above is written from iClassPro's and Google's documentation and has not yet been tried on a live portal: portals limit which outside code may run, and iClassPro says so. If it does not report, Settings, "Check it is working" will say whether anything is arriving.

## Ads that point straight at the portal

With the tag in place, an ad can link directly to the portal with the usual URL parameters and the visit is still attributed to its campaign, because the portal's first page view carries the tags.

Avoid sending ads through a redirect that only counts the click and forwards to another domain. Meta's rules on deceptive links describe exactly that pattern. Land people on your own page with a clear button, or on the portal itself.
