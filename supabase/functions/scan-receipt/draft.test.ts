// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cents, type Scan, signedCents, toDraft } from './draft.ts';

const scan = (items: Scan['items'], extra: Partial<Scan> = {}): Scan => ({
  is_receipt: true,
  items,
  ...extra,
});
const line = (name: string, line_total: string, quantity = 1) => ({ name, quantity, line_total });

describe('signedCents', () => {
  test('reads amounts the way receipts print them', () => {
    assert.equal(signedCents('12'), 1200);
    assert.equal(signedCents('$12.5'), 1250);
    assert.equal(signedCents('1,234.56'), 123456);
    assert.equal(signedCents(' 7.00 '), 700);
    assert.equal(signedCents('.99'), 99);
  });

  test('reads every way a credit is printed', () => {
    for (const credit of ['-2.00', '(2.00)', '2.00-', '$-2.00', '-$2.00', '- 2.00']) {
      assert.equal(signedCents(credit), -200, credit);
    }
  });

  test('rejects what is not an amount', () => {
    for (const bad of ['', 'abc', '12.345', '1.2.3', '$', null, undefined]) {
      assert.equal(signedCents(bad), null, String(bad));
    }
  });

  test('cents never reads a credit as a charge', () => {
    assert.equal(cents('8.39'), 839);
    assert.equal(cents('-8.39'), null);
  });
});

describe('toDraft', () => {
  test('splits quantity lines into a per-unit price', () => {
    const d = toDraft(scan([line('Margherita', '36.00', 2), line('Caesar Salad', '14.50')]));
    assert.deepEqual(d.items, [
      { name: 'Margherita', priceCents: 1800, quantity: 2 },
      { name: 'Caesar Salad', priceCents: 1450, quantity: 1 },
    ]);
  });

  test('a discount comes off the line above it', () => {
    const d = toDraft(
      scan([line('Garlic Bread', '7.00'), line('Sparkling Water', '9.00', 3), line('Happy hour', '-2.00')])
    );
    // $7.00 doesn't split three ways, so it stays one line.
    assert.deepEqual(d.items, [
      { name: 'Garlic Bread', priceCents: 700, quantity: 1 },
      { name: '3 × Sparkling Water', priceCents: 700, quantity: 1 },
    ]);
  });

  test('a discount that splits evenly keeps the quantity', () => {
    const d = toDraft(scan([line('Beer', '24.00', 4), line('Happy hour', '(4.00)')]));
    assert.deepEqual(d.items, [{ name: 'Beer', priceCents: 500, quantity: 4 }]);
  });

  test('a discount bigger than the line above spills onto the one before', () => {
    const d = toDraft(scan([line('Pasta', '20.00'), line('Soda', '3.00'), line('Coupon', '-5.00')]));
    assert.deepEqual(d.items, [{ name: 'Pasta', priceCents: 1800, quantity: 1 }]);
  });

  test('a discount with nothing above it is dropped', () => {
    const d = toDraft(scan([line('Coupon', '-5.00'), line('Pasta', '20.00')]));
    assert.deepEqual(d.items, [{ name: 'Pasta', priceCents: 2000, quantity: 1 }]);
  });

  test('free lines, blank names and unreadable amounts are dropped', () => {
    const d = toDraft(
      scan([line('Water', '0.00'), line(' ', '5.00'), line('Mystery', 'abc'), line('Fries', '6.00')])
    );
    assert.deepEqual(d.items, [{ name: 'Fries', priceCents: 600, quantity: 1 }]);
  });

  test('a bad quantity counts as one', () => {
    const d = toDraft(scan([{ name: 'Wings', quantity: 0, line_total: '12.00' }]));
    assert.deepEqual(d.items, [{ name: 'Wings', priceCents: 1200, quantity: 1 }]);
  });

  test('tax, tip, fees and the printed subtotal come through as cents', () => {
    const d = toDraft(
      scan([line('Pasta', '20.00')], {
        merchant: '  Pizzeria Libretto ',
        subtotal: '20.00',
        tax: '2.60',
        tip: '4.00',
        fees: '1.50',
      })
    );
    assert.equal(d.title, 'Pizzeria Libretto');
    assert.deepEqual(
      [d.subtotalCents, d.taxCents, d.tipCents, d.feesCents],
      [2000, 260, 400, 150]
    );
  });

  test('without a printed subtotal, the lines stand in for it', () => {
    const d = toDraft(scan([line('Pasta', '20.00'), line('Soda', '3.00')], { tax: null }));
    assert.equal(d.subtotalCents, 2300);
    assert.equal(d.taxCents, 0);
  });

  test('only real currency codes come through', () => {
    assert.equal(toDraft(scan([line('A', '1.00')], { currency: 'EUR' })).currency, 'EUR');
    assert.equal(toDraft(scan([line('A', '1.00')], { currency: '€' })).currency, null);
    assert.equal(toDraft(scan([line('A', '1.00')], { currency: null })).currency, null);
  });

  test('stops at 100 items', () => {
    const many = Array.from({ length: 150 }, (_, i) => line(`Item ${i}`, '1.00'));
    assert.equal(toDraft(scan(many)).items.length, 100);
  });
});
