// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compareVersions, mustUpdate } from './appVersion.ts';

describe('compareVersions', () => {
  test('compares number by number, not as text', () => {
    assert.equal(compareVersions('1.10.0', '1.9.2'), 1);
    assert.equal(compareVersions('1.9.2', '1.10.0'), -1);
    assert.equal(compareVersions('2.0.0', '10.0.0'), -1);
  });

  test('missing parts count as 0', () => {
    assert.equal(compareVersions('1.2', '1.2.0'), 0);
    assert.equal(compareVersions('1', '1.0.1'), -1);
  });

  test('ignores pre-release and build tags', () => {
    assert.equal(compareVersions('1.2.0-beta.1', '1.2.0'), 0);
    assert.equal(compareVersions('1.2.0+45', '1.2.0'), 0);
  });
});

describe('mustUpdate', () => {
  const min = { ios: '1.2.0', android: '1.3.0' };

  test('an older build on that platform must update', () => {
    assert.equal(mustUpdate('1.1.9', 'ios', min), true);
    assert.equal(mustUpdate('1.2.9', 'android', min), true);
  });

  test('the same or a newer build carries on', () => {
    assert.equal(mustUpdate('1.2.0', 'ios', min), false);
    assert.equal(mustUpdate('2.0.0', 'android', min), false);
  });

  test('the seeded 0.0.0 blocks nobody', () => {
    assert.equal(mustUpdate('1.0.0', 'ios', { ios: '0.0.0', android: '0.0.0' }), false);
  });

  test('fails open on anything unexpected', () => {
    assert.equal(mustUpdate(null, 'ios', min), false);
    assert.equal(mustUpdate(undefined, 'ios', min), false);
    assert.equal(mustUpdate('unknown', 'ios', min), false);
    assert.equal(mustUpdate('1.0.0', 'web', min), false);
    assert.equal(mustUpdate('1.0.0', 'ios', null), false);
    assert.equal(mustUpdate('1.0.0', 'ios', 'nonsense'), false);
    assert.equal(mustUpdate('1.0.0', 'ios', { ios: 5 }), false);
    assert.equal(mustUpdate('1.0.0', 'ios', { ios: 'latest' }), false);
  });
});
