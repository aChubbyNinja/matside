// Class openings from the iClassPro feed: readFeed and diff in src/integrations/iclasspro.js
//
// diff() is what turns "the feed changed" into "a spot was filled", so these tests are about
// what an owner would count as a sign-up and what they would not.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { diff, readFeed } from '../src/integrations/iclasspro.js';

/** One class the way the public feed lists it (trimmed to the fields that matter, plus a few that do not). */
const feedClass = (id, name, openings, extra = {}) => ({
  id,
  name,
  openings,
  allowWaitlist: true,
  minAge: 5,
  maxAge: 12,
  schedule: [
    { day: 2, dayName: 'Monday', startTime: '5:30 PM', endTime: '6:30 PM' },
    { day: 4, dayName: 'Wednesday', startTime: '5:30 PM', endTime: '6:30 PM' },
  ],
  ...extra,
});

/** A class the way it is kept on file (a row of the classes table). */
const onFile = (class_id, name, openings, extra = {}) => ({ class_id, name, schedule: 'Monday 5:30 pm–6:30 pm', openings, gone: 0, ...extra });
/** A class the way readFeed() hands it over. */
const inFeed = (class_id, name, openings, extra = {}) => ({ class_id, name, schedule: 'Monday 5:30 pm–6:30 pm', openings, ...extra });
const ids = (list) => list.map((c) => c.class_id).sort();

describe('readFeed', () => {
  test('keeps the id (as text), the name, the openings and a readable schedule', () => {
    const out = readFeed({ totalRecords: 1, data: [feedClass(345, 'Novice Wrestling (K-5)', 4)] });
    assert.equal(out.length, 1);
    assert.equal(out[0].class_id, '345');
    assert.equal(out[0].name, 'Novice Wrestling (K-5)');
    assert.equal(out[0].openings, 4);
    assert.match(out[0].schedule, /Monday/);
    assert.match(out[0].schedule, /Wednesday/);
    assert.match(out[0].schedule, /5:30/);
    assert.match(out[0].schedule, /6:30/);
    assert.deepEqual(Object.keys(out[0]).sort(), ['class_id', 'name', 'openings', 'schedule']);
  });

  test('keeps the classes in the order the feed lists them', () => {
    const out = readFeed({ data: [feedClass(3, 'C', 1), feedClass(1, 'A', 2), feedClass(2, 'B', 0)] });
    assert.deepEqual(out.map((c) => c.class_id), ['3', '1', '2']);
  });

  test('a numeric id and the same id as text are the same class', () => {
    assert.equal(readFeed({ data: [feedClass(345, 'A', 1)] })[0].class_id, readFeed({ data: [feedClass('345', 'A', 1)] })[0].class_id);
  });

  test('anything that is not a feed reads as no classes', () => {
    for (const payload of [null, undefined, {}, [], 'error', 42, { data: null }, { data: 'nope' }, { data: {} }, { error: 'Not found' }]) {
      assert.deepEqual(readFeed(payload), [], JSON.stringify(payload));
    }
  });

  test('rows with no id or no name are left out', () => {
    const out = readFeed({ data: [null, {}, { name: 'No id' }, { id: 7 }, { id: 8, name: '' }, feedClass(9, 'Real class', 2)] });
    assert.deepEqual(out.map((c) => c.class_id), ['9']);
  });

  test('a full class has 0 openings', () => {
    assert.equal(readFeed({ data: [feedClass(1, 'Full', 0)] })[0].openings, 0);
  });

  test('openings sent as text are read as a number', () => {
    assert.equal(readFeed({ data: [feedClass(1, 'A', '3')] })[0].openings, 3);
  });

  test('an over-enrolled class (negative openings) has 0 openings, not fewer', () => {
    assert.equal(readFeed({ data: [feedClass(1, 'A', -2)] })[0].openings, 0);
  });

  test('openings that are missing or not a number are unknown (null)', () => {
    const { openings: _drop, ...noOpenings } = feedClass(1, 'A', 0);
    assert.equal(readFeed({ data: [noOpenings] })[0].openings, null);
    assert.equal(readFeed({ data: [feedClass(1, 'A', 'TBD')] })[0].openings, null);
    assert.equal(readFeed({ data: [feedClass(1, 'A', undefined)] })[0].openings, null);
  });

  test('openings the feed gives as null are unknown (null), not a full class', () => {
      assert.equal(readFeed({ data: [feedClass(1, 'A', null)] })[0].openings, null);
    });

  test('a class with no schedule has none', () => {
    assert.equal(readFeed({ data: [feedClass(1, 'A', 1, { schedule: [] })] })[0].schedule, null);
    assert.equal(readFeed({ data: [feedClass(1, 'A', 1, { schedule: null })] })[0].schedule, null);
    assert.equal(readFeed({ data: [{ id: 1, name: 'A', openings: 1 }] })[0].schedule, null);
  });

  test('a schedule row without an end time, or without a day, does not break the text', () => {
    const out = readFeed({ data: [feedClass(1, 'A', 1, { schedule: [{ dayName: 'Saturday', startTime: '9:00 AM' }, { startTime: '1:00 PM' }, null] })] });
    assert.match(out[0].schedule, /Saturday/);
    assert.match(out[0].schedule, /9:00/);
    assert.doesNotMatch(out[0].schedule, /undefined|null/);
  });

  test('names are trimmed and kept to a sensible length', () => {
    assert.equal(readFeed({ data: [feedClass(1, '  Advanced  ', 1)] })[0].name, 'Advanced');
    assert.ok(readFeed({ data: [feedClass(1, 'A'.repeat(500), 1)] })[0].name.length <= 120);
  });
});

describe('diff', () => {
  test('a class that is in the feed but not on file is new', () => {
    const d = diff([], [inFeed('1', 'Novice', 6)]);
    assert.deepEqual(d.added, [inFeed('1', 'Novice', 6)]);
    assert.deepEqual([d.changed, d.updated, d.gone], [[], [], []]);
  });

  test('a new class is not counted as spots opening or filling', () => {
    const d = diff([onFile('1', 'Novice', 6)], [inFeed('1', 'Novice', 6), inFeed('2', 'Advanced', 0)]);
    assert.deepEqual(ids(d.added), ['2']);
    assert.deepEqual(d.changed, []);
  });

  test('openings going down is a change with a negative delta (spots filled)', () => {
    const d = diff([onFile('1', 'Novice', 5)], [inFeed('1', 'Novice', 3)]);
    assert.equal(d.changed.length, 1);
    assert.equal(d.changed[0].class_id, '1');
    assert.equal(d.changed[0].delta, -2);
    assert.equal(d.changed[0].openings, 3);
    assert.deepEqual([d.added, d.gone], [[], []]);
    assert.ok(!ids(d.updated).includes('1'), 'reported once, not twice');
  });

  test('openings going up is a change with a positive delta (spots opened)', () => {
    const d = diff([onFile('1', 'Novice', 3)], [inFeed('1', 'Novice', 5)]);
    assert.equal(d.changed.length, 1);
    assert.equal(d.changed[0].delta, 2);
    assert.equal(d.changed[0].openings, 5);
  });

  test('a class filling its last spot, and a full class getting a spot back', () => {
    assert.equal(diff([onFile('1', 'Novice', 1)], [inFeed('1', 'Novice', 0)]).changed[0].delta, -1);
    assert.equal(diff([onFile('1', 'Novice', 0)], [inFeed('1', 'Novice', 1)]).changed[0].delta, 1);
  });

  test('a class that is on file but no longer in the feed is gone', () => {
    const d = diff([onFile('1', 'Novice', 5), onFile('2', 'Advanced', 2)], [inFeed('1', 'Novice', 5)]);
    assert.deepEqual(ids(d.gone), ['2']);
    assert.deepEqual([d.added, d.changed, d.updated], [[], [], []]);
  });

  test('a class that vanishes is not counted as its spots being filled', () => {
    const d = diff([onFile('2', 'Advanced', 8)], []);
    assert.deepEqual(ids(d.gone), ['2']);
    assert.deepEqual(d.changed, []);
  });

  test('a class already marked gone, and still missing, is not reported again', () => {
    const d = diff([onFile('2', 'Advanced', 2, { gone: 1 })], []);
    assert.deepEqual(d, { added: [], changed: [], updated: [], gone: [] });
  });

  test('a class that comes back is brought back, not added a second time', () => {
    const d = diff([onFile('2', 'Advanced', 2, { gone: 1 })], [inFeed('2', 'Advanced', 2)]);
    assert.deepEqual(d.added, []);
    assert.deepEqual(d.gone, []);
    assert.deepEqual(ids([...d.changed, ...d.updated]), ['2'], 'it has to be saved again so it stops being marked gone');
    assert.deepEqual(d.changed, [], 'same openings as before, so no spots filled or opened');
  });

  test('a class that comes back with different openings is brought back exactly once', () => {
    const d = diff([onFile('2', 'Advanced', 5, { gone: 1 })], [inFeed('2', 'Advanced', 3)]);
    assert.deepEqual(d.added, []);
    assert.deepEqual(d.gone, []);
    assert.deepEqual(ids([...d.changed, ...d.updated]), ['2']);
  });

  test('a class with nothing changed is not reported at all', () => {
    const d = diff([onFile('1', 'Novice', 5)], [inFeed('1', 'Novice', 5)]);
    assert.deepEqual(d, { added: [], changed: [], updated: [], gone: [] });
  });

  test('a renamed or rescheduled class is saved again without counting any spots', () => {
    const renamed = diff([onFile('1', 'Novice', 5)], [inFeed('1', 'Novice (K-5)', 5)]);
    assert.deepEqual(renamed.updated, [inFeed('1', 'Novice (K-5)', 5)]);
    assert.deepEqual(renamed.changed, []);

    const moved = diff([onFile('1', 'Novice', 5)], [inFeed('1', 'Novice', 5, { schedule: 'Tuesday 6:00 pm–7:00 pm' })]);
    assert.deepEqual(ids(moved.updated), ['1']);
    assert.deepEqual(moved.changed, []);
  });

  test('a class renamed while a spot filled still counts the spot, and carries the new name', () => {
    const d = diff([onFile('1', 'Novice', 5)], [inFeed('1', 'Novice (K-5)', 4)]);
    assert.equal(d.changed.length, 1);
    assert.equal(d.changed[0].delta, -1);
    assert.equal(d.changed[0].name, 'Novice (K-5)');
  });

  test('unknown openings (null) that stay unknown are not a change', () => {
    const d = diff([onFile('1', 'Open mat', null)], [inFeed('1', 'Open mat', null)]);
    assert.deepEqual(d, { added: [], changed: [], updated: [], gone: [] });
  });

  test('openings becoming known (null to a number) saves the number without counting spots', () => {
    const d = diff([onFile('1', 'Open mat', null)], [inFeed('1', 'Open mat', 4)]);
    assert.deepEqual(d.changed, []);
    assert.deepEqual(d.updated, [inFeed('1', 'Open mat', 4)]);
  });

  test('openings becoming unknown (a number to null) is not counted as every spot filling', () => {
    const d = diff([onFile('1', 'Open mat', 4)], [inFeed('1', 'Open mat', null)]);
    assert.deepEqual(d.changed, []);
    assert.deepEqual(d.updated, [inFeed('1', 'Open mat', null)]);
  });

  test('a new class with unknown openings is simply new', () => {
    const d = diff([], [inFeed('1', 'Open mat', null)]);
    assert.deepEqual(ids(d.added), ['1']);
    assert.deepEqual(d.changed, []);
  });

  test('a whole evening of changes at once: each class lands in exactly one list', () => {
    const existing = [
      onFile('same', 'Unchanged', 5),
      onFile('down', 'Filling up', 5),
      onFile('up', 'Someone dropped', 0),
      onFile('vanished', 'Cancelled', 3),
      onFile('back', 'Seasonal', 6, { gone: 1 }),
      onFile('still-gone', 'Old camp', 0, { gone: 1 }),
      onFile('unknown', 'Open mat', null),
    ];
    const current = [
      inFeed('same', 'Unchanged', 5),
      inFeed('down', 'Filling up', 2),
      inFeed('up', 'Someone dropped', 1),
      inFeed('back', 'Seasonal', 6),
      inFeed('unknown', 'Open mat', null),
      inFeed('brand-new', 'Summer camp', 20),
    ];
    const d = diff(existing, current);
    assert.deepEqual(ids(d.added), ['brand-new']);
    assert.deepEqual(d.changed.map((c) => [c.class_id, c.delta]).sort(), [['down', -3], ['up', 1]]);
    assert.deepEqual(ids(d.updated), ['back']);
    assert.deepEqual(ids(d.gone), ['vanished']);
    // spots filled this evening: 3 (the owner's running estimate of sign-ups)
    assert.equal(d.changed.filter((c) => c.delta < 0).reduce((n, c) => n - c.delta, 0), 3);
  });

  test('does not change the lists it was given', () => {
    const existing = [onFile('1', 'Novice', 5), onFile('2', 'Advanced', 2)];
    const current = [inFeed('1', 'Novice', 3), inFeed('3', 'Camp', 9)];
    const before = JSON.stringify([existing, current]);
    diff(existing, current);
    assert.equal(JSON.stringify([existing, current]), before);
  });

  test('two readings of the real feed, straight through readFeed and diff', () => {
    const monday = readFeed({ data: [feedClass(345, 'Novice Wrestling (K-5)', 4), feedClass(346, 'Advanced', 1), feedClass(347, 'Open mat', 10)] });
    const tuesday = readFeed({ data: [feedClass(345, 'Novice Wrestling (K-5)', 2), feedClass(346, 'Advanced', 1), feedClass(348, 'Summer camp', 30)] });
    const first = diff([], monday);
    assert.deepEqual(ids(first.added), ['345', '346', '347']);
    // what the database would hold after Monday's reading
    const stored = monday.map((c) => ({ ...c, gone: 0 }));
    const d = diff(stored, tuesday);
    assert.deepEqual(ids(d.added), ['348']);
    assert.deepEqual(d.changed.map((c) => [c.class_id, c.delta]), [['345', -2]]);
    assert.deepEqual(d.updated, []);
    assert.deepEqual(ids(d.gone), ['347']);
  });
});
