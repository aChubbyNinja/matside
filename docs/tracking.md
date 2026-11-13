# Tracking

## The line

```html
<script defer src="https://your-dashboard/t.js" data-site="my-site"></script>
```

Put it in the `<head>` of every page. `data-site` is the short name the dashboard shows under Settings. The file is under 5 kB compressed, loads after the page, sets no cookies and stores nothing.

| Attribute | What it does |
|---|---|
| `data-site` | Which website this is. Required. |
| `data-api` | Where to report, if not the place the file was loaded from. |
| `data-honor-dnt` | Leave out visitors whose browser has "Do Not Track" turned on. |
| `data-count-localhost` | Count visits to `localhost` too. They are left out by default, so previewing a site on your own computer never shows up as a visitor. |

## What it records without any help

| In the dashboard | When |
|---|---|
| Page views | Every page load, and every address change in a single-page app |
| Time | While the page is in front and the person is scrolling, tapping, typing or moving the pointer (30 seconds of grace after the last activity) |
| Scroll depth | The deepest point reached, as a percentage |
| **Outbound click** | A link to another website. Records the destination (host and path) and the link's words |
| **Phone tap**, **Text tap**, **Email tap** | `tel:`, `sms:` and `mailto:` links (including Cloudflare's protected email links) |
| **File download** | Links to pdf, doc, xls, csv, zip, ppt, ics, mp3, mp4, mov |
| **Form submit** | Any form. Records the form's `name` or `id`, never what was typed |
| **Video play**, **Video watch**, **Video complete** | `<video>` elements, and YouTube embeds whose address includes `enablejsapi=1` |

Muted, looping `<video>` elements are treated as decoration and ignored.

## Naming your own actions

In the HTML, on anything clickable:

```html
<a href="https://book.example.com" data-m="Booking click" data-m-program="Kids" data-m-place="Top of the page">Book a class</a>
```

`data-m` is the name the dashboard shows. Every `data-m-something` becomes a detail you can break the action down by ("by program", "by place"). A named link is counted under its name instead of as an Outbound click.

From script, for things that are not clicks:

```js
matside('Quiz finished', { result: 'Beginner' });
```

If your code might run before the snippet has loaded, add this once, anywhere before it:

```js
window.matside = window.matside || function () { (matside.q = matside.q || []).push(arguments); };
```

Forms: `data-m="Contact form sent"` on a `<form>` renames its submit; `data-m-ignore` on a form leaves it out (useful when your own script reports success itself).

Details can be text, numbers or true/false. Up to 10 per action; names are lower-cased and limited to letters, digits and underscores; values are cut at 200 characters. **Do not put personal information in them.**

## Videos

- `<video>`: the title comes from `data-m-title`, then `title`, then `aria-label`, then the file name.
- YouTube: add `enablejsapi=1` to the embed address and, ideally, a `data-m-title`:

  ```html
  <iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID?enablejsapi=1" data-m-title="Meet the coaches" ...></iframe>
  ```

"Watched" is seconds of actual playback. "Finished" means it reached 95%.

## Key actions

In the dashboard, star an action under "What people do". It becomes a key action: counted in the headline numbers, shown as "Acted" beside every source and campaign, and available as a journey step. Starring or un-starring recounts history.

## Tagged links

For anything that is not an ad platform (an email, a flyer, a QR code, a link in a bio), Settings has a link builder. It adds `utm_source`, `utm_medium` and `utm_campaign` to an address. People who arrive through it are listed under those names.

For Meta ads, Settings gives you one line to paste into each ad's "URL parameters" box.

## Page not found

Matside cannot see your server's status codes. To learn which missing addresses people hit, add this to your 404 page:

```html
<script>
  window.matside = window.matside || function () { (matside.q = matside.q || []).push(arguments); };
  matside('Page not found', { address: location.pathname });
</script>
```

The dashboard then points it out under "What happened".

## Leaving yourself out

Open any page of your site once with `?matside=off` on the end of the address, on each device you use, and press the button in the small note that appears. `?matside=on` undoes it. (This is the one thing the snippet ever stores, and only on your own device, because you asked.)

## Checking it works

Settings, your website, "Check it is working". It tells you when the last page view arrived, or, if reports are arriving but being left out, why (wrong web address, a robot, a data centre).
