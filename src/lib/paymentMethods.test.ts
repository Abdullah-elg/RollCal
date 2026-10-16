// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  copyableHandle,
  formatHandle,
  normalizeHandle,
  type PaymentMethodType,
} from './paymentHandles.ts';

const ok = (type: PaymentMethodType, raw: string, handle: string) =>
  assert.deepEqual(normalizeHandle(type, raw), { handle });
const bad = (type: PaymentMethodType, raw: string, error: string) =>
  assert.deepEqual(normalizeHandle(type, raw), { error });

const INTERAC_ERROR = 'Enter an email or a 10-digit phone number.';

describe('interac', () => {
  test('emails are trimmed and lowercased', () => {
    ok('interac', '  Alex@Example.COM ', 'alex@example.com');
  });

  test('rejects malformed emails', () => {
    bad('interac', 'alex@', INTERAC_ERROR);
    bad('interac', 'alex@example', INTERAC_ERROR);
    bad('interac', 'a lex@example.com', INTERAC_ERROR);
  });

  test('phones with punctuation', () => {
    ok('interac', '604-555-0123', '+16045550123');
    ok('interac', '(604) 555-0123', '+16045550123');
    ok('interac', '604.555.0123', '+16045550123');
    ok('interac', '  6045550123  ', '+16045550123');
  });

  test('11-digit and +1 forms', () => {
    ok('interac', '16045550123', '+16045550123');
    ok('interac', '+1 604 555 0123', '+16045550123');
    ok('interac', '+16045550123', '+16045550123');
    ok('interac', '1 (604) 555-0123', '+16045550123');
  });

  test('rejects bad phones', () => {
    bad('interac', '555-0123', INTERAC_ERROR);
    bad('interac', '26045550123', INTERAC_ERROR);
    bad('interac', '604555012345', INTERAC_ERROR);
    bad('interac', 'call me', INTERAC_ERROR);
    bad('interac', '   ', INTERAC_ERROR);
  });
});

describe('venmo', () => {
  const error = 'Venmo usernames are 5–30 letters, numbers, - or _.';

  test('with and without @', () => {
    ok('venmo', '@alex-j_1', 'alex-j_1');
    ok('venmo', 'alex-j_1', 'alex-j_1');
    ok('venmo', '  @Alex99  ', 'Alex99');
  });

  test('length limits', () => {
    ok('venmo', 'abcde', 'abcde');
    ok('venmo', 'a'.repeat(30), 'a'.repeat(30));
    bad('venmo', 'abcd', error);
    bad('venmo', 'a'.repeat(31), error);
  });

  test('rejects other characters', () => {
    bad('venmo', 'alex.j1', error);
    bad('venmo', 'alex jones', error);
    bad('venmo', '@@alex1', error);
  });
});

describe('paypal', () => {
  const error = 'Enter your PayPal.Me username.';

  test('bare username', () => {
    ok('paypal', ' alex ', 'alex');
  });

  test('pasted links in both forms', () => {
    ok('paypal', 'paypal.me/alex', 'alex');
    ok('paypal', 'https://www.paypal.me/alex/20', 'alex');
    ok('paypal', 'https://www.paypal.com/paypalme/alex', 'alex');
    ok('paypal', 'https://paypal.com/paypalme/alex?country.x=CA', 'alex');
  });

  test('rejects invalid names', () => {
    bad('paypal', '', error);
    bad('paypal', 'a'.repeat(21), error);
    bad('paypal', 'alex_j', error);
    bad('paypal', 'two words', error);
  });
});

describe('cashapp', () => {
  const error = 'Cashtags start with a letter, like $alex.';

  test('stores with a leading $', () => {
    ok('cashapp', '$alex', '$alex');
    ok('cashapp', 'alex', '$alex');
    ok('cashapp', '  $Alex7 ', '$Alex7');
  });

  test('length limits', () => {
    ok('cashapp', 'a'.repeat(20), `$${'a'.repeat(20)}`);
    bad('cashapp', 'a'.repeat(21), error);
    bad('cashapp', '$', error);
  });

  test('must start with a letter', () => {
    bad('cashapp', '$1alex', error);
    bad('cashapp', '9lives', error);
    bad('cashapp', '$al_ex', error);
  });
});

describe('formatHandle', () => {
  test('per type', () => {
    assert.equal(formatHandle('venmo', 'alex'), '@alex');
    assert.equal(formatHandle('cashapp', '$alex'), '$alex');
    assert.equal(formatHandle('paypal', 'alex'), 'paypal.me/alex');
    assert.equal(formatHandle('interac', 'alex@example.com'), 'alex@example.com');
  });

  test('interac phone is shown the local way', () => {
    assert.equal(formatHandle('interac', '+16045550123'), '(604) 555-0123');
  });
});

describe('copyableHandle', () => {
  test('copies what each app expects in its send-to box', () => {
    assert.equal(copyableHandle('interac', 'sara@example.com'), 'sara@example.com');
    assert.equal(copyableHandle('interac', '+16045550123'), '6045550123');
    assert.equal(copyableHandle('venmo', 'sara-k'), '@sara-k');
    assert.equal(copyableHandle('cashapp', '$sara'), '$sara');
    assert.equal(copyableHandle('paypal', 'sarak'), 'sarak');
  });
});
