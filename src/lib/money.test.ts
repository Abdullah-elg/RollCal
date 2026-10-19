// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { centsToInput, formatCents, parseCents } from './money.ts';

describe('parseCents', () => {
  test('reads the ways people type amounts', () => {
    assert.equal(parseCents('12'), 1200);
    assert.equal(parseCents('12.5'), 1250);
    assert.equal(parseCents('12.50'), 1250);
    assert.equal(parseCents('$12.50'), 1250);
    assert.equal(parseCents(' 1,234.56 '), 123456);
    assert.equal(parseCents('.99'), 99);
    assert.equal(parseCents('0'), 0);
    assert.equal(parseCents('12.'), 1200);
  });

  test('never drifts the way floats do', () => {
    assert.equal(parseCents('0.29'), 29); // 0.29 * 100 = 28.999999999999996 as a float
    assert.equal(parseCents('1.15'), 115);
    assert.equal(parseCents('4.35'), 435);
  });

  test('rejects what is not an amount', () => {
    for (const bad of ['', '.', 'abc', '12.345', '-5', '1.2.3', '$', '12 50']) {
      assert.equal(parseCents(bad), null, bad);
    }
  });
});

describe('formatting', () => {
  test('formatCents shows two decimals in the currency', () => {
    assert.match(formatCents(2340, 'CAD'), /23\.40/);
    assert.match(formatCents(5, 'USD'), /0\.05/);
    // Never "CA$" or "US$", whatever the phone's region.
    assert.equal(formatCents(2340, 'CAD'), '$23.40');
    assert.equal(formatCents(123456, 'USD'), '$1,234.56');
    assert.equal(formatCents(999, 'JPY'), '9.99 JPY');
  });

  test('explicit labels say whose dollar it is', () => {
    assert.equal(formatCents(5230, 'USD', { explicit: true }), 'US$52.30');
    assert.equal(formatCents(7391, 'CAD', { explicit: true }), 'CA$73.91');
    assert.equal(formatCents(500, 'EUR', { explicit: true }), '€5.00');
    assert.equal(formatCents(-250, 'AUD', { explicit: true }), '-A$2.50');
  });

  test('centsToInput round-trips through parseCents', () => {
    for (const c of [0, 5, 99, 100, 2340, 123456]) {
      assert.equal(parseCents(centsToInput(c)), c);
    }
  });
});
