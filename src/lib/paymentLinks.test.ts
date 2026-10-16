// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { paymentLink } from './paymentLinks.ts';

describe('paymentLink', () => {
  test('PayPal.Me carries the amount and currency', () => {
    assert.equal(paymentLink('paypal', 'alexj', 2340, 'CAD', 'Dinner'), 'https://paypal.me/alexj/23.40CAD');
    assert.equal(paymentLink('paypal', 'alexj', 5, 'USD', 'Dinner'), 'https://paypal.me/alexj/0.05USD');
  });

  test('Venmo carries the amount and a note', () => {
    assert.equal(
      paymentLink('venmo', 'alex-j_1', 123456, 'USD', ' Pizza & wings '),
      'https://venmo.com/alex-j_1?txn=pay&amount=1234.56&note=SociaLink%3A%20Pizza%20%26%20wings'
    );
    assert.match(paymentLink('venmo', 'alex-j_1', 100, 'USD', '  ')!, /note=SociaLink%3A%20Bill$/);
  });

  test('Cash App carries the amount, with or without the $', () => {
    assert.equal(paymentLink('cashapp', '$alex', 2000, 'USD', 'Dinner'), 'https://cash.app/$alex/20.00');
    assert.equal(paymentLink('cashapp', 'alex', 2000, 'USD', 'Dinner'), 'https://cash.app/$alex/20.00');
  });

  test('Interac has no link', () => {
    assert.equal(paymentLink('interac', '+16045550123', 2340, 'CAD', 'Dinner'), null);
  });
});
