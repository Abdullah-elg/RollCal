import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { earliestOf, latestOf } from './marks.ts';

const early = '2026-10-27T10:00:00Z';
const late = '2026-10-27T12:00:00Z';

describe('latestOf', () => {
  test('keeps the later mark and everything from both sides', () => {
    assert.deepEqual(latestOf({ a: early, b: late }, { a: late, c: early }), {
      a: late,
      b: late,
      c: early,
    });
  });
});

describe('earliestOf', () => {
  test('keeps the earlier mark and everything from both sides', () => {
    assert.deepEqual(earliestOf({ a: late }, { a: early, c: late }), { a: early, c: late });
  });
});
