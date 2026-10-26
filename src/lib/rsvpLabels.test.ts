// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { eventEnded, rsvpLabel } from './rsvpLabels.ts';

describe('rsvpLabel', () => {
  test('present tense before the event is over', () => {
    assert.equal(rsvpLabel('going', false), 'Going');
    assert.equal(rsvpLabel('maybe', false), 'Maybe');
    assert.equal(rsvpLabel('not_going', false), "Can't go");
    assert.equal(rsvpLabel('host', false), 'Host');
  });

  test('past tense once it is over', () => {
    assert.equal(rsvpLabel('going', true), 'Went');
    assert.equal(rsvpLabel('maybe', true), 'Maybe');
    assert.equal(rsvpLabel('not_going', true), "Didn't go");
    assert.equal(rsvpLabel('host', true), 'Host');
  });
});

describe('eventEnded', () => {
  const end = '2026-10-25T22:00:00Z';
  const at = (iso: string) => new Date(iso).getTime();

  test('false before the end, true from the end on', () => {
    assert.equal(eventEnded(end, at('2026-10-25T21:59:59Z')), false);
    assert.equal(eventEnded(end, at('2026-10-25T22:00:00Z')), true);
    assert.equal(eventEnded(end, at('2026-10-26T09:00:00Z')), true);
  });
});
