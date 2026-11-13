// "What happened", in sentences.
//
// Takes the same numbers the dashboard draws and picks out what an owner would want pointed out.
// No AI, no guessing: every sentence is a rule over the numbers, so it is always true to them.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const plural = (n, one, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

function hourLabel(h) {
  const suffix = h < 12 ? 'am' : 'pm';
  return `${h % 12 === 0 ? 12 : h % 12} ${suffix}`;
}

export function insights(d) {
  const out = [];
  const t = d.totals;
  const p = d.prev;
  const add = (tone, title, text, weight) => out.push({ tone, title, text, weight });

  if (!t.visits) {
    return [{ tone: 'info', title: 'Nothing yet', text: d.filters.length ? 'No visits match these filters in this period.' : 'No visits were recorded in this period.' }];
  }

  // 1. The trend ("versus" is a phrase such as "in the 30 days before" or "by this time yesterday")
  const versus = d.range.versus || 'in the period before';
  const now = t.visitors.toLocaleString('en-US');
  const then = p.visitors.toLocaleString('en-US');
  if (p.visitors >= 5) {
    const change = Math.round(((t.visitors - p.visitors) / p.visitors) * 100);
    if (Math.abs(change) < 5) add('info', 'Steady', `${plural(t.visitors, 'visitor')}, against ${then} ${versus}.`, 100);
    else if (change > 0) add('up', `Up ${change}%`, `${plural(t.visitors, 'visitor')}${d.range.key === 'today' ? ' so far' : ''}, up from ${then} ${versus}.`, 100);
    else add('down', `Down ${Math.abs(change)}%`, `${plural(t.visitors, 'visitor')}${d.range.key === 'today' ? ' so far' : ''}, down from ${then} ${versus}.`, 100);
  } else if (t.visitors && d.range.key !== 'today') {
    add('info', 'A first look', `${now === '1' ? '1 visitor' : now + ' visitors'} so far. There is not enough from the period before to compare with yet.`, 100);
  }

  // 2. Key actions, and who takes them
  if (d.key_events.length) {
    if (t.acted) {
      add('good', `${t.conversion}% took action`, `${plural(t.acted, 'visit')} included a key action (${d.key_events.slice(0, 2).join(' or ')}${d.key_events.length > 2 ? '…' : ''}).`, 95);
      const best = d.sources.filter((s) => s.visits >= 15 && s.acted >= 2).sort((x, y) => y.acted / y.visits - x.acted / x.visits)[0];
      if (best && d.sources.length > 1 && pct(best.acted, best.visits) > t.conversion * 1.25) {
        add('good', `${best.name} converts best`, `${pct(best.acted, best.visits)}% of visits from ${best.name} took a key action, against ${t.conversion}% overall.`, 80);
      }
    } else if (t.visits >= 20) {
      add('warn', 'No key actions', `${plural(t.visits, 'visit')} and none of them took a key action in this period.`, 90);
    }
  }

  // 3. Where people come from
  const top = d.sources[0];
  if (top && d.sources.length > 1) {
    const share = pct(top.visits, t.visits);
    add('info', share >= 50 ? `Mostly ${top.name === 'Direct' ? 'direct' : 'from ' + top.name}` : `Top source: ${top.name}`,
      top.name === 'Direct'
        ? `${pct(top.visits, t.visits)}% of visits came straight to the site: a typed address, a bookmark, a text message or an app that hides where the click came from.`
        : `${top.name} sent ${plural(top.visits, 'visit')}, ${pct(top.visits, t.visits)}% of the total.`, 70);
  }
  const paid = d.channels.filter((c) => c.name.startsWith('Paid'));
  const paidVisits = paid.reduce((n, c) => n + c.visits, 0);
  if (paidVisits) {
    const paidActed = paid.reduce((n, c) => n + c.acted, 0);
    add('info', 'Ads', `Ads brought ${plural(paidVisits, 'visit')}${d.key_events.length ? `, and ${plural(paidActed, 'of them', 'of them')} took a key action` : ''}.`, 75);
  }
  const ai = d.channels.find((c) => c.name === 'AI Assistants');
  if (ai) add('good', 'Found through AI', `${plural(ai.visits, 'visit')} came from AI assistants such as ChatGPT, Perplexity or Gemini.`, 60);

  // 4. When
  if (t.visits >= 30 && d.heatmap.length) {
    const peak = d.heatmap.reduce((best, cell) => (cell[2] > best[2] ? cell : best));
    if (d.range.days >= 7) add('info', 'Busiest time', `${DAYS[peak[0]]}s around ${hourLabel(peak[1])} bring the most visits.`, 50);
    else if (d.range.days === 1) add('info', 'Busiest hour', `Most visits came around ${hourLabel(peak[1])}.`, 50);
  }

  // 5. Pages that lose people
  const leaky = d.entries.filter((e) => e.visits >= 20 && e.bounce >= 75 && e.bounce >= t.bounce + 15).sort((x, y) => y.visits - x.visits)[0];
  if (leaky) add('warn', 'A leaky front door', `${leaky.bounce}% of people who land on ${leaky.name} leave without doing anything else (${t.bounce}% across the site).`, 65);

  // 6. Devices and places
  const phone = d.devices.find((x) => x.name === 'Phone');
  if (phone && pct(phone.visits, t.visits) >= 60) add('info', 'Mostly phones', `${pct(phone.visits, t.visits)}% of visits are on a phone.`, 40);
  const region = d.regions[0];
  const city = d.cities[0];
  if (region && pct(region.visits, t.visits) >= 30) {
    const [regionCountry, regionName] = region.name.split('|');
    // Only name the city if it is in that region.
    const [cityCountry, cityRegion, cityName] = city ? city.name.split('|') : [];
    const sameRegion = city && cityCountry === regionCountry && cityRegion === regionName;
    add('info', 'Close to home', `${pct(region.visits, t.visits)}% of visits come from ${regionName}${sameRegion && pct(city.visits, t.visits) >= 15 ? `, and ${pct(city.visits, t.visits)}% from ${cityName} alone` : ''}.`, 45);
  }

  // 7. Videos and broken links
  const video = d.videos[0];
  if (video && video.plays >= 3) add('info', 'Most watched', `“${video.name}” was played ${plural(video.plays, 'time')}${video.seconds ? `, for about ${video.seconds < 90 ? video.seconds + ' seconds' : Math.round(video.seconds / 60) + ' minutes'} each` : ''}.`, 35);
  const missing = d.events.find((e) => e.name === 'Page not found');
  if (missing) add('warn', 'Broken links', `People landed on a page that does not exist ${plural(missing.count, 'time')}. Open “Page not found” under “What people do” to see which addresses.`, 55);

  return out.sort((x, y) => y.weight - x.weight).slice(0, 6).map(({ weight, ...rest }) => rest);
}
