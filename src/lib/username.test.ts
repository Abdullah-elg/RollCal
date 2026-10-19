// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  cleanUsername,
  usernameFallbacks,
  usernameFromName,
  usernameProblem,
} from './username.ts';

describe('cleanUsername', () => {
  test('trims, drops a leading @ and lowercases', () => {
    assert.equal(cleanUsername('  @Sam.Rivera '), 'sam.rivera');
  });
});

describe('usernameProblem', () => {
  test('accepts normal usernames', () => {
    for (const ok of ['sam', 'sam.rivera', 'sam_r', 'sam-r', '9lives', 'a'.repeat(30)]) {
      assert.equal(usernameProblem(ok), null, ok);
    }
  });

  test('rejects bad lengths, characters and starts', () => {
    assert.match(usernameProblem('ab')!, /At least/);
    assert.match(usernameProblem('a'.repeat(31))!, /At most/);
    assert.match(usernameProblem('.sam')!, /Start/);
    assert.match(usernameProblem('sam+test')!, /letters, numbers/);
    assert.match(usernameProblem('sam rivera')!, /letters, numbers/);
    assert.match(usernameProblem('Sam')!, /Start|letters/);
  });

  test('rejects reserved names', () => {
    assert.ok(usernameProblem('rollcal'));
    assert.ok(usernameProblem('support'));
  });
});

describe('usernameFromName', () => {
  test('joins the name and strips accents and symbols', () => {
    assert.equal(usernameFromName('José', "O'Brien"), 'joseobrien');
  });

  test('falls back when the name gives too little', () => {
    assert.equal(usernameFromName(null, null), 'member');
    assert.equal(usernameFromName('李', null), 'member');
    assert.equal(usernameFromName('Al', null), 'member');
  });

  test('every result passes the rule', () => {
    for (const [f, l] of [['Sam', 'Rivera'], ['', ''], ['A'.repeat(40), 'B']]) {
      assert.equal(usernameProblem(usernameFromName(f, l)), null);
    }
  });
});

describe('usernameFallbacks', () => {
  test('adds digits and stays within the length limit', () => {
    const long = 'a'.repeat(30);
    for (const name of usernameFallbacks(long, () => 0.99)) {
      assert.equal(usernameProblem(name), null, name);
    }
    assert.deepEqual(usernameFallbacks('sam', () => 0), ['sam100', 'sam1000']);
  });
});
