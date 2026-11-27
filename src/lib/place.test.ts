// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { placeLabel } from './place.ts';

describe('placeLabel', () => {
  test('raw pin coordinates read as a pin', () => {
    assert.equal(placeLabel('Pinned location (0.0000, 0.0000)'), 'Pinned on the map');
    assert.equal(placeLabel('Pinned location (49.2827, -123.1207)'), 'Pinned on the map');
  });
  test('real places stay as they are', () => {
    assert.equal(placeLabel('Toro toro miss'), 'Toro toro miss');
    assert.equal(placeLabel('  Rooftop  '), 'Rooftop');
    assert.equal(placeLabel(null), '');
  });
});
