// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  convertBill,
  convertCents,
  CURRENCIES,
  describeRate,
  isSupportedCurrency,
  rateBetween,
  type Rates,
} from './currency.ts';

const rates: Rates = { USD: 1, CAD: 1.41317, EUR: 0.890861, INR: 95.184915 };

describe('rateBetween', () => {
  test('same currency is 1', () => {
    assert.equal(rateBetween('CAD', 'CAD', {}), 1);
  });
  test('through US dollars', () => {
    assert.equal(rateBetween('USD', 'CAD', rates), 1.41317);
    assert.ok(Math.abs(rateBetween('CAD', 'EUR', rates)! - 0.890861 / 1.41317) < 1e-12);
  });
  test('missing or bad rate', () => {
    assert.equal(rateBetween('USD', 'GBP', rates), null);
    assert.equal(rateBetween('USD', 'CAD', { USD: 1, CAD: 0 }), null);
  });
});

describe('convertCents', () => {
  test('converts and rounds to the cent', () => {
    // 6.99 USD = 9.8780583 CAD
    assert.equal(convertCents(699, 'USD', 'CAD', rates), 988);
    assert.equal(convertCents(4999, 'USD', 'CAD', rates), 7064);
    assert.equal(convertCents(1000, 'CAD', 'USD', rates), 708);
  });
  test('halves round up', () => {
    assert.equal(convertCents(1, 'USD', 'X', { USD: 1, X: 2.5 }), 3);
  });
  test('zero and same currency', () => {
    assert.equal(convertCents(0, 'USD', 'CAD', rates), 0);
    assert.equal(convertCents(1234, 'EUR', 'EUR', {}), 1234);
  });
  test('missing rate', () => {
    assert.equal(convertCents(100, 'USD', 'GBP', rates), null);
  });
});

describe('describeRate', () => {
  test('digits suit the size of the rate', () => {
    assert.equal(describeRate('USD', 'CAD', 1.41317), '1 USD = 1.4132 CAD');
    assert.equal(describeRate('USD', 'INR', 95.184915), '1 USD = 95.1849 INR');
    assert.equal(describeRate('INR', 'USD', 1 / 95.184915), '1 INR = 0.010506 USD');
  });
});

describe('list', () => {
  test('codes are unique, valid and supported', () => {
    const codes = CURRENCIES.map((c) => c.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const c of codes) {
      assert.match(c, /^[A-Z]{3}$/);
      assert.ok(isSupportedCurrency(c));
    }
    assert.ok(!isSupportedCurrency('JPY'));
    assert.ok(!isSupportedCurrency(null));
  });
});

describe('convertBill', () => {
  test('converts unit prices and extras, keeping other fields', () => {
    const out = convertBill(
      {
        items: [
          { id: 'a', name: 'Pizza', priceCents: 1850, quantity: 2 },
          { name: 'Soda', priceCents: 299, quantity: 1 },
        ],
        taxCents: 520,
        tipCents: 0,
        feesCents: 150,
      },
      1.41317
    );
    assert.deepEqual(out.items, [
      { id: 'a', name: 'Pizza', priceCents: 2614, quantity: 2 },
      { name: 'Soda', priceCents: 423, quantity: 1 },
    ]);
    assert.equal(out.taxCents, 735);
    assert.equal(out.tipCents, 0);
    assert.equal(out.feesCents, 212);
  });
});
