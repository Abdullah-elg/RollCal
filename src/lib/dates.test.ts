// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { nextTimeStep } from './dates.ts';

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 23, h, m, s);

describe('nextTimeStep', () => {
  test('a time on a step stays put', () => {
    assert.equal(nextTimeStep(at(18, 55)).getTime(), at(18, 55).getTime());
  });

  test('anything past a step moves to the next one', () => {
    assert.equal(nextTimeStep(at(18, 56)).getTime(), at(19, 0).getTime());
    assert.equal(nextTimeStep(at(18, 55, 30)).getTime(), at(19, 0).getTime());
  });

  test('rolls over midnight', () => {
    assert.equal(nextTimeStep(at(23, 58)).getTime(), new Date(2026, 9, 24, 0, 0).getTime());
  });
});
