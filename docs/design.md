# Design

The dashboard is meant to be read by someone who does not look at dashboards for a living, on a phone, in a spare minute. These are the rules it follows, so changes can follow them too.

## Reading order

1. **Sentences first.** "What happened" sits above every number. If an owner reads only that row, they have the news.
2. **Six numbers.** Each with its change against the period before. Tapping one puts it on the chart.
3. **One chart.** One line, one axis, the period before drawn quietly behind it.
4. **Lists.** Everything else is a ranked list with one or two figures per row. Tapping a row filters the whole page.

Words are chosen for an owner, not an analyst: "Where visitors come from", "What people do", "The journey", "Acted". Jargon that survives ("bounce rate", "organic search") gets a one-line explanation where it appears.

## Charts

- **The form follows the question.** A single figure is a tile, not a chart. A split of three is one bar in three parts. Anything ranked is a list with thin bars. Change over time is a line. There are no pies, no gauges and no second y-axis anywhere.
- **Thin marks, quiet furniture.** 2px lines, a 10% wash under the line, hairline grid one step off the background, no dashes on grid lines.
- **An unfinished day is not a drop.** Today's point is joined with a dotted line and a hollow dot, the shading stops before it, and the tooltip says "so far".
- **Text is never the colour of the data.** Labels and values use the text colours; a coloured mark beside them carries identity.
- **A tooltip helps but never hides anything.** Every chart has a table view (the small grid button), and every list is already a table.
- **Colour is not the only signal.** Changes carry an arrow as well as green or red. The devices bar prints its percentages and has a legend with names and numbers.

## Colour

All colours are CSS variables at the top of [`public/app.css`](../public/app.css), each with a light and a dark value chosen for that background (dark mode is not an inversion).

| Variable | Used for |
|---|---|
| `--s1` … `--s8` | Things that need telling apart: the main series, the devices bar, one colour per website. The order is fixed and was checked for colour-blind separation between neighbours. |
| `--h0` … `--h6` | One hue, light to dark, for "more": the day-by-hour map. |
| `--good`, `--bad`, `--warn` | Direction and warnings only. Never used as a series colour. |
| `--prev` | The period before, and anything that should recede. |

A website's colour is given to it when it is added and never changes, so "the academy is blue" stays true whatever order the sites are in.

To re-skin: change the variables. If you change `--s1`…`--s3`, check the three against each other for red-green colour blindness (they appear side by side in the devices bar); the palette shipped here passes with a simulated-vision difference above 9 in both modes.

## Phone first

- Everything is reachable with a thumb: date ranges are a row of chips, not a calendar; rows are at least 44px tall.
- Drill-downs and settings open as a sheet from the bottom; on a desktop the same sheet is a centred dialog.
- No sideways scrolling anywhere. Lists cut long names with an ellipsis; the numbers never wrap.
- "Add to Home Screen" gives it an icon and opens it without browser chrome.
- While new numbers load, the old ones stay on screen, dimmed. Nothing jumps.

## Code

Plain DOM, no framework. Elements are made with a small `h()` helper, and everything that comes from a website (addresses, link text, campaign names) is inserted as text, never as HTML. Charts are hand-written SVG in [`public/charts.js`](../public/charts.js), about 250 lines.
