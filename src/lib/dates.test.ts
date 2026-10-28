// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatChatDivider, nextTimeStep, startsChatTimeBlock, tidyDayPeriod } from './dates.ts';

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

describe('tidyDayPeriod', () => {
  test('dotted lower case becomes AM/PM', () => {
    assert.equal(tidyDayPeriod('7:30 p.m.'), '7:30 PM');
    assert.equal(tidyDayPeriod('7 a.m.'), '7 AM');
    assert.equal(tidyDayPeriod('7:30 p.m.'), '7:30 PM');
  });

  test('leaves AM/PM and 24-hour times alone', () => {
    assert.equal(tidyDayPeriod('7:30 PM'), '7:30 PM');
    assert.equal(tidyDayPeriod('19:30'), '19:30');
  });
});

describe('startsChatTimeBlock', () => {
  test('the first message, a new day and an hour-long pause start a block', () => {
    assert.equal(startsChatTimeBlock(undefined, at(10, 0).toISOString()), true);
    assert.equal(
      startsChatTimeBlock(new Date(2026, 9, 22, 23, 50).toISOString(), at(0, 5).toISOString()),
      true
    );
    assert.equal(startsChatTimeBlock(at(10, 0).toISOString(), at(11, 0).toISOString()), true);
  });

  test('a quick back-and-forth stays in one block', () => {
    assert.equal(startsChatTimeBlock(at(10, 0).toISOString(), at(10, 59).toISOString()), false);
  });
});

describe('formatChatDivider', () => {
  const now = at(15, 0);
  const label = (d: Date) => formatChatDivider(d.toISOString(), now);

  test('today and yesterday by name', () => {
    assert.match(label(at(9, 5)), /^Today 9:05\sAM$/);
    assert.match(label(new Date(2026, 9, 22, 21, 0)), /^Yesterday 9:00\sPM$/);
  });

  test('the weekday within a week, then the date', () => {
    assert.match(label(new Date(2026, 9, 19, 9, 0)), /^Mon 9:00\sAM$/);
    assert.match(label(new Date(2026, 9, 2, 9, 0)), /^Oct 2, 9:00\sAM$/);
    assert.match(label(new Date(2025, 9, 2, 9, 0)), /^Oct 2, 2025, 9:00\sAM$/);
  });
});
