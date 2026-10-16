// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  type ItemPick,
  type Line,
  itemCoverage,
  percentOf,
  quotePicks,
  resolvePick,
  subtotalMismatch,
} from './billSplit.ts';

const all: ItemPick = { mode: 'fraction', numerator: 1, denominator: 1 };
const part = (numerator: number, denominator: number): ItemPick => ({
  mode: 'fraction',
  numerator,
  denominator,
});
const amount = (amountCents: number): ItemPick => ({ mode: 'amount', amountCents });
const even: ItemPick = { mode: 'even' };
const noExtras = { taxCents: 0, tipCents: 0, feesCents: 0 };

const pizza: Line = { id: 'pizza', priceCents: 2000, quantity: 1 };
const withTax = { taxCents: 260, tipCents: 0, feesCents: 0 };

describe('quotePicks', () => {
  test('nothing picked costs nothing', () => {
    assert.deepEqual(quotePicks([pizza], withTax, {}, 2), {
      subtotalCents: 0,
      extrasCents: 0,
      totalCents: 0,
    });
  });

  test('the whole item carries all the tax', () => {
    assert.deepEqual(quotePicks([pizza], withTax, { pizza: all }, 2), {
      subtotalCents: 2000,
      extrasCents: 260,
      totalCents: 2260,
    });
  });

  test('an exact amount carries its share of the tax', () => {
    // $2 of a $20 pizza is a tenth of the items, so a tenth of the $2.60 tax.
    assert.deepEqual(quotePicks([pizza], withTax, { pizza: amount(200) }, 2), {
      subtotalCents: 200,
      extrasCents: 26,
      totalCents: 226,
    });
  });

  test('an amount over the line is capped at the line', () => {
    assert.equal(quotePicks([pizza], noExtras, { pizza: amount(5000) }, 2).totalCents, 2000);
  });

  test('tax, tip and fees follow the share of the items', () => {
    const items: Line[] = [
      { id: 'a', priceCents: 1500, quantity: 2 }, // 3000
      { id: 'b', priceCents: 1000, quantity: 1 }, // 1000
    ];
    const extras = { taxCents: 400, tipCents: 600, feesCents: 200 }; // 1200 on 4000
    // Half of a: 1500 of 4000 items -> 3/8 of the extras = 450.
    assert.deepEqual(quotePicks(items, extras, { a: part(1, 2) }, 3), {
      subtotalCents: 1500,
      extrasCents: 450,
      totalCents: 1950,
    });
  });

  test('quantity counts toward the line', () => {
    const wings: Line = { id: 'w', priceCents: 350, quantity: 4 };
    assert.equal(quotePicks([wings], noExtras, { w: part(1, 4) }, 2).totalCents, 350);
  });

  test('totals round up, so a third of $10 is $3.34', () => {
    const q = quotePicks([{ id: 'x', priceCents: 1000, quantity: 1 }], noExtras, { x: part(1, 3) }, 3);
    assert.deepEqual(q, { subtotalCents: 333, extrasCents: 1, totalCents: 334 });
  });

  test('"Split evenly" divides by the people going', () => {
    const items: Line[] = [{ id: 'x', priceCents: 1200, quantity: 1 }];
    assert.equal(quotePicks(items, noExtras, { x: even }, 4).totalCents, 300);
    assert.equal(quotePicks(items, noExtras, { x: even }, 1).totalCents, 1200);
  });

  test('picks on items not on the bill are ignored', () => {
    assert.equal(quotePicks([pizza], noExtras, { gone: all }, 2).totalCents, 0);
  });

  test('a bill of free items charges no extras through them', () => {
    const free: Line = { id: 'f', priceCents: 0, quantity: 1 };
    assert.equal(quotePicks([free], withTax, { f: all }, 2).totalCents, 0);
  });

  test('bad input is refused', () => {
    assert.throws(() => quotePicks([pizza], noExtras, { pizza: part(2, 1) }, 2), RangeError);
    assert.throws(() => quotePicks([pizza], noExtras, { pizza: part(0, 2) }, 2), RangeError);
    assert.throws(() => quotePicks([pizza], noExtras, { pizza: amount(1.5) }, 2), RangeError);
    assert.throws(() => quotePicks([{ ...pizza, quantity: 0 }], noExtras, {}, 2), RangeError);
    assert.throws(() => quotePicks([pizza], { ...noExtras, taxCents: -1 }, {}, 2), RangeError);
  });
});

describe('everyone paying their part covers the bill', () => {
  // Random bills, each item cut into random whole-number parts between
  // random people. Each person's total is their exact share rounded up, so
  // together they cover the bill and overshoot by less than a cent each.
  test('2000 random bills', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let run = 0; run < 2000; run++) {
      const people = 1 + rand(6);
      const items: Line[] = Array.from({ length: 1 + rand(5) }, (_, i) => ({
        id: `i${i}`,
        priceCents: rand(5000),
        quantity: 1 + rand(3),
      }));
      const extras = { taxCents: rand(800), tipCents: rand(1500), feesCents: rand(300) };
      const picks: Record<string, ItemPick>[] = Array.from({ length: people }, () => ({}));
      for (const item of items) {
        // Cut the item into `people` parts of random whole-number weights.
        const weights = Array.from({ length: people }, () => rand(4));
        if (weights.every((w) => w === 0)) weights[0] = 1;
        const sum = weights.reduce((a, b) => a + b, 0);
        weights.forEach((w, p) => {
          if (w > 0) picks[p][item.id] = part(w, sum);
        });
      }

      const lines = items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
      const billTotal = lines + extras.taxCents + extras.tipCents + extras.feesCents;
      const quotes = picks.map((p) => quotePicks(items, extras, p, people));
      const paid = quotes.reduce((s, q) => s + q.totalCents, 0);
      for (const q of quotes) assert.equal(q.subtotalCents + q.extrasCents, q.totalCents);

      if (lines === 0) {
        assert.equal(paid, 0);
      } else {
        assert.ok(paid >= billTotal, `run ${run}: paid ${paid} < total ${billTotal}`);
        assert.ok(paid < billTotal + people, `run ${run}: paid ${paid} overshoots ${billTotal}`);
      }
    }
  });
});

describe('resolvePick', () => {
  test('"Split evenly" is stored as 1/(people going)', () => {
    assert.deepEqual(resolvePick(even, 3), part(1, 3));
    assert.deepEqual(resolvePick(even, 0), part(1, 1));
    assert.deepEqual(resolvePick(even, 250), part(1, 100));
  });

  test('other picks are stored as they are', () => {
    assert.deepEqual(resolvePick(amount(500), 3), amount(500));
    assert.deepEqual(resolvePick(part(1, 4), 3), part(1, 4));
  });
});

describe('itemCoverage', () => {
  const items: Line[] = [pizza, { id: 'salad', priceCents: 1000, quantity: 1 }];

  test('adds up what payments covered', () => {
    const [p, s] = itemCoverage(items, [
      { itemId: 'pizza', pick: part(1, 2) },
      { itemId: 'pizza', pick: { mode: 'amount', amountCents: 1000 } },
      { itemId: 'salad', pick: part(1, 3) },
    ]);
    assert.equal(p.state, 'full');
    assert.equal(p.covered, 1);
    assert.equal(p.lineCents, 2000);
    assert.equal(s.state, 'partial');
  });

  test('marks unpaid and over-paid items', () => {
    const [p, s] = itemCoverage(items, [
      { itemId: 'pizza', pick: part(2, 3) },
      { itemId: 'pizza', pick: part(2, 3) },
    ]);
    assert.equal(p.state, 'over');
    assert.equal(s.state, 'unpaid');
    assert.equal(s.covered, 0);
  });
});

describe('helpers', () => {
  test('percentOf works in whole cents', () => {
    assert.equal(percentOf(4650, 18), 837);
    assert.equal(percentOf(1000, 17.5), 175);
    assert.equal(percentOf(333, 15), 50); // 49.95 rounds up
    assert.equal(percentOf(0, 20), 0);
  });

  test('subtotalMismatch compares the lines with the printed subtotal', () => {
    const lines = [
      { priceCents: 700, quantity: 2 },
      { priceCents: 1250, quantity: 1 },
    ];
    assert.equal(subtotalMismatch(lines, 2650), 0);
    assert.equal(subtotalMismatch(lines, 2600), 50);
  });
});
