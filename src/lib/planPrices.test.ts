// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { yearlySavingPercent } from './planPrices.ts';

describe('yearlySavingPercent', () => {
  test('Plus: $29.99 a year against $3.99 a month is 37%', () => {
    assert.equal(yearlySavingPercent(399, 2999), 37);
  });
  test('Pro: $59.99 a year against $6.99 a month is 28%', () => {
    assert.equal(yearlySavingPercent(699, 5999), 28);
  });
  test('never negative, safe on zero', () => {
    assert.equal(yearlySavingPercent(100, 5000), 0);
    assert.equal(yearlySavingPercent(0, 100), 0);
  });
});
