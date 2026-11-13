// Dates, ranges and small helpers: src/util.js
//
// Expected dates are worked out by hand (or with the plain UTC arithmetic below), never with the
// helpers under test.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, buckets, daysBetween, isDay, localParts, resolveRange, safeEqual, text } from '../src/util.js';

const utc = (day) => Date.parse(day + 'T00:00:00Z');
const DAY = 86400000;
/** How many days a from..to span covers, counting both ends. */
const span = (from, to) => (utc(to) - utc(from)) / DAY + 1;
const dayBefore = (day) => new Date(utc(day) - DAY).toISOString().slice(0, 10);
/** A day that exists on the calendar, in YYYY-MM-DD. */
const realDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utc(s)) && new Date(utc(s)).toISOString().slice(0, 10) === s;

const TODAY = '2024-03-15'; // a Friday in a leap year

describe('resolveRange: the built-in ranges', () => {
  test('today is one day, charted by the hour, compared with yesterday', () => {
    const r = resolveRange('today', TODAY);
    assert.deepEqual([r.from, r.to, r.days, r.granularity], ['2024-03-15', '2024-03-15', 1, 'hour']);
    assert.deepEqual([r.prev_from, r.prev_to], ['2024-03-14', '2024-03-14']);
  });

  test('yesterday is one day, charted by the hour, compared with the day before', () => {
    const r = resolveRange('yesterday', TODAY);
    assert.deepEqual([r.from, r.to, r.days, r.granularity], ['2024-03-14', '2024-03-14', 1, 'hour']);
    assert.deepEqual([r.prev_from, r.prev_to], ['2024-03-13', '2024-03-13']);
  });

  test('7d is the seven days ending today, compared with the seven before', () => {
    const r = resolveRange('7d', TODAY);
    assert.deepEqual([r.from, r.to, r.days, r.granularity], ['2024-03-09', '2024-03-15', 7, 'day']);
    assert.deepEqual([r.prev_from, r.prev_to], ['2024-03-02', '2024-03-08']);
  });

  test('30d is the thirty days ending today, compared with the thirty before', () => {
    const r = resolveRange('30d', TODAY);
    assert.deepEqual([r.from, r.to, r.days, r.granularity], ['2024-02-15', '2024-03-15', 30, 'day']);
    assert.deepEqual([r.prev_from, r.prev_to], ['2024-01-16', '2024-02-14']);
  });

  test('90d is the ninety days ending today, still charted by the day', () => {
    const r = resolveRange('90d', TODAY);
    assert.deepEqual([r.from, r.to, r.days, r.granularity], ['2023-12-17', '2024-03-15', 90, 'day']);
    assert.deepEqual([r.prev_from, r.prev_to], ['2023-09-18', '2023-12-16']);
  });

  test('month runs from the 1st to today', () => {
    const r = resolveRange('month', TODAY);
    assert.deepEqual([r.from, r.to, r.days, r.granularity], ['2024-03-01', '2024-03-15', 15, 'day']);
    // compared with the same days of the month before
    assert.deepEqual([r.prev_from, r.prev_to], ['2024-02-01', '2024-02-15']);
  });

  test('month on the 1st is just that day', () => {
    const r = resolveRange('month', '2024-03-01');
    assert.deepEqual([r.from, r.to, r.days], ['2024-03-01', '2024-03-01', 1]);
  });

  test('lastmonth is the whole calendar month before this one', () => {
    const r = resolveRange('lastmonth', TODAY);
    assert.deepEqual([r.from, r.to, r.days, r.granularity], ['2024-02-01', '2024-02-29', 29, 'day']);
    assert.equal(r.prev_to, '2024-01-31');
  });

  test('lastmonth in January is December of the year before', () => {
    const r = resolveRange('lastmonth', '2024-01-10');
    assert.deepEqual([r.from, r.to, r.days], ['2023-12-01', '2023-12-31', 31]);
  });

  test('lastmonth asked on the 31st does not skip the short month', () => {
    assert.deepEqual([resolveRange('lastmonth', '2024-03-31').from, resolveRange('lastmonth', '2024-03-31').to], ['2024-02-01', '2024-02-29']);
    assert.deepEqual([resolveRange('lastmonth', '2023-03-31').from, resolveRange('lastmonth', '2023-03-31').to], ['2023-02-01', '2023-02-28']);
    assert.deepEqual([resolveRange('lastmonth', '2024-05-31').from, resolveRange('lastmonth', '2024-05-31').to], ['2024-04-01', '2024-04-30']);
  });

  test('12mo is this month and the eleven before it, charted by the month', () => {
    const r = resolveRange('12mo', TODAY);
    assert.deepEqual([r.from, r.to, r.days, r.granularity], ['2023-04-01', '2024-03-15', 350, 'month']);
    assert.equal(buckets(r.from, r.to, r.granularity).length, 12);
  });

  test('12mo on the last day of January still starts eleven months back', () => {
    const r = resolveRange('12mo', '2024-01-31');
    assert.deepEqual([r.from, r.to], ['2023-02-01', '2024-01-31']);
  });

  test('each range says which one it is, in words, and repeats today', () => {
    const words = { today: /today/i, yesterday: /yesterday/i, '7d': /7 days/i, '30d': /30 days/i, '90d': /90 days/i, month: /this month/i, lastmonth: /last month/i, '12mo': /12 months/i };
    for (const [key, pattern] of Object.entries(words)) {
      const r = resolveRange(key, TODAY);
      assert.equal(r.key, key);
      assert.match(r.label, pattern);
      assert.equal(r.today, TODAY);
    }
  });

  test('on any date: real days, never past today, days counts both ends, and the period before is entirely earlier', () => {
    const todays = ['2024-01-01', '2024-02-29', '2024-03-01', '2024-03-10', '2024-03-15', '2024-03-31', '2024-12-31', '2025-01-01', '2025-03-01', '2026-11-13'];
    for (const today of todays) {
      for (const key of ['today', 'yesterday', '7d', '30d', '90d', 'month', 'lastmonth', '12mo']) {
        const r = resolveRange(key, today);
        const at = `${key} on ${today}`;
        for (const d of [r.from, r.to, r.prev_from, r.prev_to]) assert.ok(realDay(d), `${at}: ${d} is a real day`);
        assert.ok(r.from <= r.to, `${at}: from <= to`);
        assert.ok(r.to <= today, `${at}: to <= today`);
        assert.equal(r.days, span(r.from, r.to), `${at}: days`);
        assert.ok(r.prev_from <= r.prev_to && r.prev_to < r.from, `${at}: the period before is earlier`);
        assert.ok(['hour', 'day', 'month'].includes(r.granularity), `${at}: granularity`);
        assert.equal(r.granularity === 'hour', r.days === 1, `${at}: by the hour only for a single day`);
      }
    }
  });

  test('charted by the hour or the day, the period before is the same length and ends the day before', () => {
    const todays = ['2024-01-01', '2024-02-29', '2024-03-01', '2024-03-10', '2024-03-15', '2024-03-31', '2024-12-31', '2025-01-01', '2025-03-01', '2026-11-13'];
    for (const today of todays) {
      for (const key of ['today', 'yesterday', '7d', '30d', '90d']) {
        const r = resolveRange(key, today);
        const at = `${key} on ${today}`;
        assert.notEqual(r.granularity, 'month', at);
        assert.equal(r.prev_to, dayBefore(r.from), `${at}: prev_to`);
        assert.equal(span(r.prev_from, r.prev_to), r.days, `${at}: previous period length`);
      }
    }
  });

  test('calendar ranges are compared with the matching calendar stretch', () => {
    // this month so far against the same days of last month
    let r = resolveRange('month', '2024-03-31');
    assert.deepEqual([r.prev_from, r.prev_to], ['2024-02-01', '2024-02-29']); // February has no 30th or 31st
    r = resolveRange('month', '2024-01-10');
    assert.deepEqual([r.prev_from, r.prev_to], ['2023-12-01', '2023-12-10']);
    // last month against the whole month before it
    r = resolveRange('lastmonth', '2024-04-10');
    assert.deepEqual([r.from, r.to, r.prev_from, r.prev_to], ['2024-03-01', '2024-03-31', '2024-02-01', '2024-02-29']);
  });

  test('charted by the month, the period before lines up with the period itself: as many points, and for 12mo starting on the 1st', () => {
      const points = (r) => [buckets(r.from, r.to, r.granularity).length, buckets(r.prev_from, r.prev_to, r.granularity).length];
      for (const today of ['2024-02-29', '2024-12-31', '2026-11-13']) {
        const r = resolveRange('12mo', today);
        const [now, before] = points(r);
        assert.equal(before, now, `12mo on ${today}: points`);
        assert.equal(r.prev_from.slice(8), '01', `12mo on ${today}: the period before starts ${r.prev_from}`);
      }
      const [now, before] = points(resolveRange('custom', '2024-07-01', '2024-01-10', '2024-06-20'));
      assert.equal(before, now, 'custom 2024-01-10..2024-06-20: points');
    });
});

describe('resolveRange: custom dates', () => {
  test('a sensible pair of dates is used as given', () => {
    const r = resolveRange('custom', TODAY, '2024-03-01', '2024-03-10');
    assert.deepEqual([r.key, r.from, r.to, r.days, r.granularity], ['custom', '2024-03-01', '2024-03-10', 10, 'day']);
    assert.deepEqual([r.prev_from, r.prev_to], ['2024-02-20', '2024-02-29']);
    assert.match(r.label, /custom/i);
  });

  test('the same date twice is a single day, charted by the hour', () => {
    const r = resolveRange('custom', TODAY, '2024-03-05', '2024-03-05');
    assert.deepEqual([r.from, r.to, r.days, r.granularity], ['2024-03-05', '2024-03-05', 1, 'hour']);
    assert.deepEqual([r.prev_from, r.prev_to], ['2024-03-04', '2024-03-04']);
  });

  test('a long custom range is charted by the month', () => {
    const r = resolveRange('custom', TODAY, '2023-01-01', '2023-12-31');
    assert.deepEqual([r.from, r.to, r.days, r.granularity], ['2023-01-01', '2023-12-31', 365, 'month']);
    assert.equal(buckets(r.from, r.to, r.granularity).length, 12);
  });

  test('an end date in the future stops at today', () => {
    const r = resolveRange('custom', TODAY, '2024-03-10', '2024-04-30');
    assert.deepEqual([r.key, r.from, r.to, r.days], ['custom', '2024-03-10', '2024-03-15', 6]);
  });

  test('a range entirely in the future never reaches past today', () => {
    const r = resolveRange('custom', TODAY, '2025-01-01', '2025-01-31');
    assert.ok(r.to <= TODAY);
    assert.ok(r.from <= r.to);
    assert.equal(r.days, span(r.from, r.to));
  });

  test('reversed dates fall back to the last 30 days, and the answer says so', () => {
    const r = resolveRange('custom', TODAY, '2024-03-10', '2024-03-01');
    assert.deepEqual(r, resolveRange('30d', TODAY));
    assert.equal(r.key, '30d');
    assert.ok(r.from <= r.to);
  });

  test('an absurdly long span is cut down to a little over two years, keeping the end date', () => {
    const r = resolveRange('custom', TODAY, '1990-01-01', '2024-03-10');
    assert.equal(r.to, '2024-03-10');
    assert.ok(r.from > '1990-01-01');
    assert.equal(r.days, span(r.from, r.to));
    assert.ok(r.days >= 730 && r.days <= 801, `days = ${r.days}`);
    assert.equal(r.granularity, 'month');
  });

  test('garbage dates fall back to the last 30 days', () => {
    const fallback = resolveRange('30d', TODAY);
    const garbage = [
      ['banana', 'soon'], [undefined, undefined], [null, null], ['', ''], ['2024-03-01', undefined], [undefined, '2024-03-10'],
      ['2024-3-1', '2024-3-10'], ['03/01/2024', '03/10/2024'], ['2024-13-01', '2024-13-10'], ['2024-03-01', '2024-03-32'],
      [20240301, 20240310], ["2024-03-01'; DROP TABLE hits; --", '2024-03-10'], ['2024-03-01T00:00:00Z', '2024-03-10T00:00:00Z'],
    ];
    for (const [from, to] of garbage) assert.deepEqual(resolveRange('custom', TODAY, from, to), fallback, `${from} .. ${to}`);
  });

  test('an unknown range name falls back to the last 30 days', () => {
    const fallback = resolveRange('30d', TODAY);
    for (const key of ['forever', '', undefined, null, 42, 'constructor', '__proto__']) {
      assert.deepEqual(resolveRange(key, TODAY), fallback, String(key));
    }
  });
});

describe('buckets', () => {
  test('by the hour: the 24 hours of a day, as text', () => {
    const b = buckets('2024-03-15', '2024-03-15', 'hour');
    assert.equal(b.length, 24);
    assert.deepEqual(b.slice(0, 3), ['0', '1', '2']);
    assert.equal(b[23], '23');
  });

  test('by the day: every day from start to end, both included', () => {
    assert.deepEqual(buckets('2024-02-27', '2024-03-02', 'day'), ['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02']);
    assert.deepEqual(buckets('2023-12-30', '2024-01-02', 'day'), ['2023-12-30', '2023-12-31', '2024-01-01', '2024-01-02']);
    assert.deepEqual(buckets('2024-03-15', '2024-03-15', 'day'), ['2024-03-15']);
  });

  test('by the day: no day is lost or doubled when the clocks change', () => {
    assert.deepEqual(buckets('2024-03-09', '2024-03-11', 'day'), ['2024-03-09', '2024-03-10', '2024-03-11']);
    assert.deepEqual(buckets('2024-11-02', '2024-11-04', 'day'), ['2024-11-02', '2024-11-03', '2024-11-04']);
  });

  test('by the month: every month the range touches, as YYYY-MM', () => {
    assert.deepEqual(buckets('2023-11-01', '2024-02-15', 'month'), ['2023-11', '2023-12', '2024-01', '2024-02']);
    assert.deepEqual(buckets('2024-01-10', '2024-03-05', 'month'), ['2024-01', '2024-02', '2024-03']);
    assert.deepEqual(buckets('2024-01-31', '2024-03-01', 'month'), ['2024-01', '2024-02', '2024-03']);
    assert.deepEqual(buckets('2024-03-10', '2024-03-20', 'month'), ['2024-03']);
  });

  test('a range that ends before it starts has no buckets', () => {
    assert.deepEqual(buckets('2024-03-10', '2024-03-01', 'day'), []);
    assert.deepEqual(buckets('2024-03-10', '2024-01-01', 'month'), []);
  });

  test('a range has exactly one bucket per day it covers', () => {
    for (const key of ['7d', '30d', '90d', 'month', 'lastmonth']) {
      const r = resolveRange(key, TODAY);
      const b = buckets(r.from, r.to, 'day');
      assert.equal(b.length, r.days, key);
      assert.equal(b[0], r.from, key);
      assert.equal(b.at(-1), r.to, key);
    }
  });
});

describe('addDays', () => {
  test('moves forward and back across month and year ends', () => {
    assert.equal(addDays('2024-03-15', 1), '2024-03-16');
    assert.equal(addDays('2024-03-15', -1), '2024-03-14');
    assert.equal(addDays('2024-01-31', 1), '2024-02-01');
    assert.equal(addDays('2024-03-01', -1), '2024-02-29');
    assert.equal(addDays('2023-12-31', 1), '2024-01-01');
    assert.equal(addDays('2024-01-01', -1), '2023-12-31');
  });

  test('knows leap years', () => {
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
    assert.equal(addDays('2023-02-28', 1), '2023-03-01');
    assert.equal(addDays('2024-02-28', 366), '2025-02-28');
    assert.equal(addDays('2023-02-28', 365), '2024-02-28');
  });

  test('adding nothing changes nothing', () => {
    assert.equal(addDays('2024-03-15', 0), '2024-03-15');
  });

  test('is not thrown off by the days the clocks change', () => {
    assert.equal(addDays('2024-03-09', 1), '2024-03-10');
    assert.equal(addDays('2024-03-10', 1), '2024-03-11');
    assert.equal(addDays('2024-11-03', 1), '2024-11-04');
    assert.equal(addDays('2024-11-04', -1), '2024-11-03');
  });
});

describe('addMonths', () => {
  test('moves the first of a month forward and back', () => {
    assert.equal(addMonths('2024-03-01', 1), '2024-04-01');
    assert.equal(addMonths('2024-03-01', -1), '2024-02-01');
    assert.equal(addMonths('2024-03-01', 0), '2024-03-01');
  });

  test('crosses year ends', () => {
    assert.equal(addMonths('2024-12-01', 1), '2025-01-01');
    assert.equal(addMonths('2024-01-01', -1), '2023-12-01');
    assert.equal(addMonths('2024-03-01', -11), '2023-04-01');
    assert.equal(addMonths('2024-03-01', 12), '2025-03-01');
    assert.equal(addMonths('2024-03-01', -24), '2022-03-01');
  });

  test('from the 31st it lands in the very next month, never the one after', () => {
    assert.equal(addMonths('2024-01-31', 1).slice(0, 7), '2024-02');
    assert.equal(addMonths('2024-03-31', -1).slice(0, 7), '2024-02');
    assert.equal(addMonths('2024-10-31', 1).slice(0, 7), '2024-11');
  });
});

describe('daysBetween', () => {
  test('counts the days from the first date to the second', () => {
    assert.equal(daysBetween('2024-03-15', '2024-03-15'), 0);
    assert.equal(daysBetween('2024-03-15', '2024-03-16'), 1);
    assert.equal(daysBetween('2024-03-01', '2024-03-31'), 30);
    assert.equal(daysBetween('2023-12-25', '2024-01-01'), 7);
  });

  test('is negative when the second date is earlier', () => {
    assert.equal(daysBetween('2024-03-16', '2024-03-15'), -1);
    assert.equal(daysBetween('2024-03-31', '2024-03-01'), -30);
  });

  test('knows leap years', () => {
    assert.equal(daysBetween('2024-02-01', '2024-03-01'), 29);
    assert.equal(daysBetween('2023-02-01', '2023-03-01'), 28);
    assert.equal(daysBetween('2024-01-01', '2025-01-01'), 366);
    assert.equal(daysBetween('2023-01-01', '2024-01-01'), 365);
  });

  test('is a whole number across the days the clocks change', () => {
    assert.equal(daysBetween('2024-03-09', '2024-03-11'), 2);
    assert.equal(daysBetween('2024-11-02', '2024-11-04'), 2);
  });
});

describe('isDay', () => {
  test('accepts YYYY-MM-DD days', () => {
    for (const s of ['2024-01-05', '2024-02-29', '1999-12-31', '2026-11-13']) assert.equal(isDay(s), true, s);
  });

  test('rejects anything not written as YYYY-MM-DD', () => {
    for (const s of ['2024-1-5', '2024/01/05', '01-05-2024', '20240105', '', ' 2024-01-05', '2024-01-05 ', '2024-01-05T00:00:00Z', 'today', '2024-01-05\n']) {
      assert.equal(isDay(s), false, JSON.stringify(s));
    }
  });

  test('rejects months and days that are out of range', () => {
    for (const s of ['2024-13-01', '2024-00-10', '2024-01-32', '2024-01-00', '2024-99-99']) assert.equal(isDay(s), false, s);
  });

  test('rejects things that are not text', () => {
    for (const v of [null, undefined, 20240105, new Date('2024-01-05'), ['2024-01-05'], {}, true]) assert.equal(isDay(v), false, String(v));
  });

  test('rejects days that are not on the calendar (30 February, 31 April, 29 February in an ordinary year)', () => {
      for (const s of ['2024-02-30', '2024-02-31', '2023-02-29', '2024-04-31', '2024-06-31']) assert.equal(isDay(s), false, s);
    });
});

describe('localParts', () => {
  const at = (y, m, d, h, min = 0) => Date.UTC(y, m - 1, d, h, min);

  test('gives the day and hour on the clock in America/Chicago', () => {
    assert.deepEqual(localParts(at(2024, 1, 15, 18, 30), 'America/Chicago'), { day: '2024-01-15', hour: 12 }); // CST, UTC-6
    assert.deepEqual(localParts(at(2024, 7, 15, 18, 30), 'America/Chicago'), { day: '2024-07-15', hour: 13 }); // CDT, UTC-5
  });

  test('an evening in Chicago is still that day, though it is already tomorrow in UTC', () => {
    assert.deepEqual(localParts(at(2024, 1, 16, 3, 0), 'America/Chicago'), { day: '2024-01-15', hour: 21 });
    assert.deepEqual(localParts(at(2025, 1, 1, 5, 59), 'America/Chicago'), { day: '2024-12-31', hour: 23 });
  });

  test('midnight is hour 0 of the new day, not hour 24 of the old one', () => {
    assert.deepEqual(localParts(at(2024, 1, 15, 6, 0), 'America/Chicago'), { day: '2024-01-15', hour: 0 });
    assert.deepEqual(localParts(at(2024, 1, 15, 0, 0), 'UTC'), { day: '2024-01-15', hour: 0 });
    assert.deepEqual(localParts(at(2024, 1, 14, 23, 59), 'UTC'), { day: '2024-01-14', hour: 23 });
  });

  test('the day clocks spring forward in Chicago (10 March 2024) goes 1 am then 3 am and lasts 23 hours', () => {
    assert.deepEqual(localParts(at(2024, 3, 10, 7, 59), 'America/Chicago'), { day: '2024-03-10', hour: 1 });
    assert.deepEqual(localParts(at(2024, 3, 10, 8, 0), 'America/Chicago'), { day: '2024-03-10', hour: 3 });

    const start = at(2024, 3, 10, 6); // local midnight, still CST
    const hours = [];
    for (let i = 0; i < 23; i++) {
      const p = localParts(start + i * 3600000, 'America/Chicago');
      assert.equal(p.day, '2024-03-10', `hour ${i} of the day`);
      hours.push(p.hour);
    }
    assert.deepEqual(hours, [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    assert.deepEqual(localParts(start - 1, 'America/Chicago'), { day: '2024-03-09', hour: 23 });
    assert.deepEqual(localParts(start + 23 * 3600000, 'America/Chicago'), { day: '2024-03-11', hour: 0 });
  });

  test('the day clocks fall back in Chicago (3 November 2024) has 1 am twice and lasts 25 hours', () => {
    const start = at(2024, 11, 3, 5); // local midnight, still CDT
    const hours = [];
    for (let i = 0; i < 25; i++) {
      const p = localParts(start + i * 3600000, 'America/Chicago');
      assert.equal(p.day, '2024-11-03', `hour ${i} of the day`);
      hours.push(p.hour);
    }
    assert.deepEqual(hours, [0, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    assert.deepEqual(localParts(start - 1, 'America/Chicago'), { day: '2024-11-02', hour: 23 });
    assert.deepEqual(localParts(start + 25 * 3600000, 'America/Chicago'), { day: '2024-11-04', hour: 0 });
  });

  test('east of UTC the local day starts before the UTC day does', () => {
    assert.deepEqual(localParts(at(2024, 1, 1, 15, 0), 'Asia/Tokyo'), { day: '2024-01-02', hour: 0 }); // UTC+9
    assert.deepEqual(localParts(at(2024, 1, 1, 14, 59), 'Asia/Tokyo'), { day: '2024-01-01', hour: 23 });
    assert.deepEqual(localParts(at(2024, 1, 1, 13, 0), 'Australia/Sydney'), { day: '2024-01-02', hour: 0 }); // UTC+11 in January
    assert.deepEqual(localParts(at(2023, 12, 31, 23, 30), 'Europe/Berlin'), { day: '2024-01-01', hour: 0 }); // UTC+1
  });

  test('half-hour time zones land on the right side of midnight', () => {
    assert.deepEqual(localParts(at(2024, 1, 1, 18, 29), 'Asia/Kolkata'), { day: '2024-01-01', hour: 23 }); // UTC+5:30
    assert.deepEqual(localParts(at(2024, 1, 1, 18, 30), 'Asia/Kolkata'), { day: '2024-01-02', hour: 0 });
  });

  test('the same moment is a different day in different places', () => {
    const moment = at(2024, 6, 1, 3, 0);
    assert.deepEqual(localParts(moment, 'America/Chicago'), { day: '2024-05-31', hour: 22 });
    assert.deepEqual(localParts(moment, 'UTC'), { day: '2024-06-01', hour: 3 });
    assert.deepEqual(localParts(moment, 'Asia/Tokyo'), { day: '2024-06-01', hour: 12 });
  });
});

describe('text', () => {
  test('trims the ends', () => {
    assert.equal(text('  hello  ', 20), 'hello');
    assert.equal(text('\thello world\n', 20), 'hello world');
  });

  test('cuts to at most n characters', () => {
    assert.equal(text('abcdef', 3), 'abc');
    assert.equal(text('abc', 3), 'abc');
    assert.equal(text('a'.repeat(500), 80).length, 80);
  });

  test('answers null for nothing, for blanks and for things that are not text', () => {
    for (const v of ['', '   ', '\n\t ', null, undefined, 42, 0, true, {}, ['a']]) assert.equal(text(v, 20), null, JSON.stringify(v));
  });

  test('leaves no control characters in, and keeps the words apart', () => {
    const out = text('one\u0000two\nthree\tfour\u007ffive\r\nsix', 80);
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(out, /[\u0000-\u001f\u007f]/);
    assert.deepEqual(out.split(/\s+/), ['one', 'two', 'three', 'four', 'five', 'six']);
  });

  test('keeps ordinary punctuation, accents and emoji', () => {
    assert.equal(text("Coach O'Brien — café ☕ 🤼", 80), "Coach O'Brien — café ☕ 🤼");
  });

  test('a cut that lands just after a space does not leave the space on the end', () => {
      assert.equal(text('hello world', 6), 'hello');
      assert.equal(text('  ab   cd', 4), 'ab');
    });

  test('a cut never leaves half an emoji behind', () => {
      assert.ok(text('ab😀', 3).isWellFormed());
      assert.ok(text('🤼🤼🤼', 3).isWellFormed());
    });
});

describe('safeEqual', () => {
  test('the same text is equal', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'), true);
    assert.equal(safeEqual('pässwörd 🤼', 'pässwörd 🤼'), true);
  });

  test('different text of the same length is not equal, wherever it differs', () => {
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'xbc'), false);
    assert.equal(safeEqual('abc', 'aXc'), false);
    assert.equal(safeEqual('abc', 'ABC'), false);
    assert.equal(safeEqual('9f86d081884c7d659a2feaa0c55ad015', '9f86d081884c7d659a2feaa0c55ad016'), false);
  });

  test('text of different lengths is not equal, even when one starts with the other', () => {
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('abcd', 'abc'), false);
    assert.equal(safeEqual('abc', ''), false);
    assert.equal(safeEqual('', 'abc'), false);
    assert.equal(safeEqual('abc', 'abc '), false);
  });

  test('anything that is not text is never equal, not even to itself', () => {
    assert.equal(safeEqual(undefined, undefined), false);
    assert.equal(safeEqual(null, null), false);
    assert.equal(safeEqual(123, 123), false);
    assert.equal(safeEqual('123', 123), false);
    assert.equal(safeEqual(123, '123'), false);
    assert.equal(safeEqual(['a'], ['a']), false);
    assert.equal(safeEqual('abc', undefined), false);
    assert.equal(safeEqual(null, 'abc'), false);
  });
});
