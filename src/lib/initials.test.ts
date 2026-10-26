// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { avatarInitials } from './initials.ts';

describe('avatarInitials', () => {
  test('first and last initials', () => {
    assert.equal(avatarInitials('Abdullah Elganainy'), 'AE');
    assert.equal(avatarInitials('haadi ladha'), 'HL');
  });

  test('one word gives its first two letters', () => {
    assert.equal(avatarInitials('Abdullah'), 'AB');
  });

  test('an emoji last name leaves just the first initial, never a ?', () => {
    assert.equal(avatarInitials('Human 😭😂⭐'), 'H');
  });

  test('an emoji first name leaves just the last initial', () => {
    assert.equal(avatarInitials('🔥 Sam'), 'S');
  });

  test('letters from any alphabet count', () => {
    assert.equal(avatarInitials('عبد الله'), 'عا');
  });

  test('no letters in the name falls back to the username, as a capital', () => {
    assert.equal(avatarInitials('😭 😂', 'human_99'), 'H');
    assert.equal(avatarInitials('123', '_abc'), 'A');
  });

  test('nothing usable gives an empty string', () => {
    assert.equal(avatarInitials('😭', '__'), '');
    assert.equal(avatarInitials(null), '');
  });
});
