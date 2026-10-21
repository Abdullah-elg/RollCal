// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cacheKey, placeLabel, validCoords } from './placeLabel.ts';

describe('placeLabel', () => {
  test('road and city', () => {
    assert.equal(placeLabel({ address: { road: 'King Street West', city: 'Toronto' } }), 'King Street West, Toronto');
  });
  test('falls back through the parts', () => {
    assert.equal(placeLabel({ address: { suburb: 'Leslieville', town: 'X' } }), 'Leslieville, X');
    assert.equal(placeLabel({ address: { village: 'Elora' } }), 'Elora');
    assert.equal(placeLabel({ display_name: 'A, B, C, D' }), 'A, B');
    assert.equal(placeLabel({}), null);
    assert.equal(placeLabel(null), null);
  });
  test('no "Toronto, Toronto"', () => {
    assert.equal(placeLabel({ address: { suburb: 'Toronto', city: 'Toronto' } }), 'Toronto');
  });
});

describe('cacheKey and validCoords', () => {
  test('rounds to 4 places', () => {
    assert.equal(cacheKey(43.653226, -79.3831843), '43.6532,-79.3832');
  });
  test('rejects junk', () => {
    assert.ok(validCoords(43.6, -79.3));
    assert.ok(!validCoords(91, 0));
    assert.ok(!validCoords('43', 0));
    assert.ok(!validCoords(NaN, 0));
  });
});
