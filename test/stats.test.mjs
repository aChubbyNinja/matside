// The filter string the dashboard sends ("f=channel:Organic Search;page:/about/"): parseFilters in
// src/stats.js. Everything else in that file needs a database.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilters } from '../src/stats.js';

describe('parseFilters', () => {
  test('reads "key:value" pairs separated by semicolons, in order', () => {
    assert.deepEqual(parseFilters('channel:Organic Search;page:/about/'), [['channel', 'Organic Search'], ['page', '/about/']]);
  });

  test('a single filter', () => {
    assert.deepEqual(parseFilters('device:Phone'), [['device', 'Phone']]);
  });

  test('nothing in, nothing out', () => {
    for (const value of ['', undefined, null, ';', ';;;', ' ']) assert.deepEqual(parseFilters(value), [], JSON.stringify(value));
  });

  test('every breakdown the dashboard can filter by is accepted', () => {
    const keys = ['channel', 'source', 'campaign', 'country', 'region', 'city', 'device', 'browser', 'os', 'entry', 'exit', 'page', 'event'];
    for (const key of keys) assert.deepEqual(parseFilters(`${key}:x`), [[key, 'x']], key);
  });

  test('the value keeps its own colons, spaces, bars and slashes', () => {
    assert.deepEqual(parseFilters('page:/blog/a:b'), [['page', '/blog/a:b']]);
    assert.deepEqual(parseFilters('page:portal.example.org/acme/classes'), [['page', 'portal.example.org/acme/classes']]);
    assert.deepEqual(parseFilters('source:X (Twitter)'), [['source', 'X (Twitter)']]);
    assert.deepEqual(parseFilters('city:US|Wisconsin|Green Bay;region:US|Wisconsin'), [['city', 'US|Wisconsin|Green Bay'], ['region', 'US|Wisconsin']]);
    assert.deepEqual(parseFilters('event:Registration click'), [['event', 'Registration click']]);
  });

  test('pieces with no key, no value or no colon are skipped without losing the good ones', () => {
    assert.deepEqual(parseFilters('channel:;:Direct;device;;os:iOS'), [['os', 'iOS']]);
  });

  test('names that are not filters are ignored', () => {
    assert.deepEqual(parseFilters('colour:red;visitor:abc123;site:other'), []);
    assert.deepEqual(parseFilters('colour:red;browser:Safari'), [['browser', 'Safari']]);
  });

  test("names every JavaScript object happens to have (constructor, toString, __proto__) are not filters either", () => {
      for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
        assert.deepEqual(parseFilters(`${key}:x`), [], key);
      }
    });

  test('SQL in a value stays a value', () => {
    assert.deepEqual(parseFilters("source:x' OR '1'='1"), [['source', "x' OR '1'='1"]]);
    assert.deepEqual(parseFilters('s.site = s.site OR 1:1'), []);
  });

  test('at most six filters are kept', () => {
    const many = ['channel:a', 'source:b', 'campaign:c', 'country:d', 'region:e', 'city:f', 'device:g', 'browser:h'].join(';');
    const out = parseFilters(many);
    assert.equal(out.length, 6);
    assert.deepEqual(out[0], ['channel', 'a']);
    assert.deepEqual(out[5], ['city', 'f']);
  });

  test('an enormous value is cut down', () => {
    const [[key, value]] = parseFilters('page:/' + 'a'.repeat(5000));
    assert.equal(key, 'page');
    assert.ok(value.length <= 300, `kept ${value.length} characters`);
    assert.ok(value.startsWith('/aaa'));
  });

  test('always answers with a list of [name, value] pairs of text', () => {
    for (const value of [42, {}, [], true, 'channel:Direct', ['device:Phone']]) {
      const out = parseFilters(value);
      assert.ok(Array.isArray(out));
      for (const pair of out) {
        assert.equal(pair.length, 2);
        assert.equal(typeof pair[0], 'string');
        assert.equal(typeof pair[1], 'string');
      }
    }
  });
});
