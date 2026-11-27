// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GUEST_FULL_MESSAGE, guestFacing, isEventFull, isRollFull, peopleMeter } from './planLimitsText.ts';

describe('limits wording', () => {
  test('recognises the database messages', () => {
    assert.ok(isEventFull('This event is full'));
    assert.ok(isRollFull('The photo roll is full'));
    assert.ok(!isEventFull('Something else'));
  });
  test('guests get the guest wording, other errors pass through', () => {
    assert.equal(guestFacing('This event is full'), GUEST_FULL_MESSAGE);
    assert.equal(guestFacing('Network down'), 'Network down');
    assert.equal(guestFacing(null), null);
  });
  test('meter', () => {
    assert.equal(peopleMeter({ peopleLimit: null, photosLimit: null, going: 4, photos: 0 }), null);
    assert.deepEqual(peopleMeter({ peopleLimit: 10, photosLimit: 200, going: 8, photos: 0 }), {
      text: '8 of 10 spots taken',
      nearlyFull: true,
    });
    assert.equal(peopleMeter({ peopleLimit: 10, photosLimit: 200, going: 3, photos: 0 })!.nearlyFull, false);
  });
});
