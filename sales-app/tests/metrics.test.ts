import { describe, expect, it } from 'vitest';
import { computeKpis, personalTarget, shareOf, splitMonthlyTarget, firstSaleInShift } from '../src/lib/metrics';
import type { Sale, Shift, Store } from '../src/lib/types';
import { tsAt } from '../src/lib/util';

const D = '2026-11-01'; // a Sunday

function sale(p: Partial<Sale>): Sale {
  return {
    id: Math.random().toString(36),
    sellerId: 'a',
    coSellerId: null,
    storeId: 's1',
    shiftId: null,
    ts: tsAt(D, 11),
    amount: 100,
    units: 1,
    categories: ['skincare'],
    upsell: 'none',
    clubSignup: false,
    isReturn: false,
    ...p,
  };
}

const shift: Shift = { id: 'sh1', sellerId: 'a', storeId: 's1', date: D, startHour: 10, endHour: 16, target: 1000, closed: true };

describe('metrics', () => {
  it('computes ATV, UPT, upsell rate and target %', () => {
    const sales = [
      sale({ amount: 200, units: 2, upsell: 'cross_sell', ts: tsAt(D, 10.5) }),
      sale({ amount: 100, units: 1 }),
      sale({ amount: 300, units: 3, upsell: 'upsell', clubSignup: true }),
    ];
    const k = computeKpis({ sales, shifts: [shift], sellerId: 'a' });
    expect(k.revenue).toBe(600);
    expect(k.transactions).toBe(3);
    expect(k.atv).toBe(200);
    expect(k.upt).toBe(2);
    expect(k.upsellRate).toBeCloseTo(2 / 3);
    expect(k.clubSignups).toBe(1);
    expect(k.targetPct).toBeCloseTo(0.6);
    expect(k.firstSaleHour).toBeCloseTo(10.5);
    expect(k.minutesToFirstSale).toBeCloseTo(30);
    expect(k.salesPerHour).toBeCloseTo(100);
  });

  it('splits shared sales 50/50 and keeps ATV/UPT unchanged', () => {
    const s = sale({ amount: 400, units: 4, coSellerId: 'b' });
    expect(shareOf(s, 'a')).toBe(0.5);
    expect(shareOf(s, 'b')).toBe(0.5);
    expect(shareOf(s, 'c')).toBe(0);
    const a = computeKpis({ sales: [s], sellerId: 'a' });
    const b = computeKpis({ sales: [s], sellerId: 'b' });
    expect(a.revenue + b.revenue).toBe(400);
    expect(a.atv).toBe(400);
    expect(a.upt).toBe(4);
  });

  it('deducts returns from the seller who sold', () => {
    const k = computeKpis({ sales: [sale({ amount: 300 }), sale({ amount: 100, isReturn: true })], sellerId: 'a' });
    expect(k.revenue).toBe(200);
    expect(k.transactions).toBe(1);
    expect(k.returnsAmount).toBe(100);
  });

  it('conversion = transactions / approaches', () => {
    const ints = Array.from({ length: 4 }, (_, i) => ({ id: 'i' + i, sellerId: 'a', storeId: 's1', ts: tsAt(D, 11) }));
    const k = computeKpis({ sales: [sale({})], interactions: ints, sellerId: 'a' });
    expect(k.conversion).toBeCloseTo(0.25);
  });

  it('first sale ignores returns', () => {
    const sales = [sale({ ts: tsAt(D, 10.1), isReturn: true }), sale({ ts: tsAt(D, 12) })];
    expect(firstSaleInShift(shift, sales)).toBeCloseTo(12);
  });

  it('personal target splits by hours', () => {
    const others = [{ startHour: 10, endHour: 16 }];
    expect(personalTarget(9000, others, { startHour: 16, endHour: 22 })).toBe(4500);
    // with a demand curve that is busier in the evening, the evening share is bigger
    const w = new Array(24).fill(0).map((_, h) => (h >= 16 ? 2 : 1));
    expect(personalTarget(9000, others, { startHour: 16, endHour: 22 }, w)).toBe(6000);
  });

  it('monthly target is split by weekday weights and sums to the total', () => {
    const store: Store = {
      id: 's1',
      name: 'x',
      regionId: 'r',
      lat: 0,
      lng: 0,
      headcount: 3,
      hours: [{ open: 10, close: 22 }, { open: 10, close: 22 }, { open: 10, close: 22 }, { open: 10, close: 22 }, { open: 10, close: 22 }, { open: 9, close: 15 }, null],
    };
    const days = splitMonthlyTarget(300000, 2026, 10, store, []);
    expect(days.length).toBe(30);
    const total = days.reduce((a, d) => a + d.target, 0);
    expect(Math.abs(total - 300000)).toBeLessThan(40);
    expect(days.find((d) => d.date === '2026-11-07')!.target).toBe(0); // Saturday closed
  });
});
