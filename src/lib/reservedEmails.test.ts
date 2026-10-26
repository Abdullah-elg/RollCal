// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isReservedEmail } from './reservedEmails.ts';

describe('isReservedEmail', () => {
  test('RollCal’s own mailboxes, however they are typed', () => {
    assert.equal(isReservedEmail('support@rollcal.app'), true);
    assert.equal(isReservedEmail('  Support@RollCal.APP '), true);
    assert.equal(isReservedEmail('no-reply@rollcal.app'), true);
  });

  test('everyone else, including other rollcal.app addresses', () => {
    assert.equal(isReservedEmail('apple-test@rollcal.app'), false);
    assert.equal(isReservedEmail('support@gmail.com'), false);
  });
});
