// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { guestName } from './guests.ts';

describe('guestName', () => {
  test('guests get (guest), members don’t', () => {
    assert.equal(guestName({ display_name: 'Sam', is_guest: true }), 'Sam (guest)');
    assert.equal(guestName({ display_name: 'Sam', is_guest: false }), 'Sam');
    assert.equal(guestName({ display_name: 'Sam' }), 'Sam');
  });
  test('no name falls back', () => {
    assert.equal(guestName(null), 'Someone');
    assert.equal(guestName({ display_name: '  ', is_guest: true }), 'Someone (guest)');
  });
});
