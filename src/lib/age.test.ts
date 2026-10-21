// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkAge } from './age.ts';

const now = new Date(2026, 9, 20); // 20 October 2026

describe('checkAge', () => {
  test('clearly old enough or too young', () => {
    assert.equal(checkAge(1990, null, now), 'ok');
    assert.equal(checkAge(2012, null, now), 'ok');
    assert.equal(checkAge(2014, null, now), 'too_young');
    assert.equal(checkAge(2026, null, now), 'too_young');
  });
  test('the year they turn 13 asks for the month', () => {
    assert.equal(checkAge(2013, null, now), 'need_month');
    assert.equal(checkAge(2013, 9, now), 'ok');
    assert.equal(checkAge(2013, 10, now), 'too_young');
    assert.equal(checkAge(2013, 12, now), 'too_young');
  });
  test('rejects nonsense', () => {
    assert.equal(checkAge(1800, null, now), 'invalid');
    assert.equal(checkAge(2030, null, now), 'invalid');
    assert.equal(checkAge(2013, 13, now), 'invalid');
    assert.equal(checkAge(NaN, null, now), 'invalid');
  });
});
