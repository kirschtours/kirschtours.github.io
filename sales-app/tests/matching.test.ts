import { beforeAll, describe, expect, it } from 'vitest';
import { generateDemoData, PERSONA } from '../src/lib/demo';
import { analyze, pairKey, type Analysis } from '../src/lib/profiles';
import { hungarian } from '../src/lib/matching/hungarian';
import { assignStores } from '../src/lib/matching/storeAssign';
import { matchMentors } from '../src/lib/matching/mentoring';
import { fairShare, planShifts, weekSlots } from '../src/lib/matching/pairing';
import type { Dataset } from '../src/lib/types';
import { addDays, dateKey } from '../src/lib/util';

let data: Dataset;
let traits: ReturnType<typeof generateDemoData>['traits'];
let A: Analysis;
const NOW = new Date(2026, 10, 5, 12, 0); // fixed clock → deterministic

function corr(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b) / n;
  const my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

beforeAll(() => {
  const out = generateDemoData({ now: NOW });
  data = out.data;
  traits = out.traits;
  A = analyze(data);
});

describe('hungarian', () => {
  it('finds the minimum-cost assignment', () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const a = hungarian(cost);
    const total = a.reduce((s, j, i) => s + cost[i][j], 0);
    expect(total).toBe(5);
    expect(new Set(a).size).toBe(3);
  });
  it('handles rectangular matrices', () => {
    const a = hungarian([
      [10, 1, 10, 10],
      [10, 10, 10, 2],
    ]);
    expect(a).toEqual([1, 3]);
  });
});

describe('profiles recover hidden traits', () => {
  it('has enough shifts for most floor staff', () => {
    const floor = data.sellers.filter((s) => s.storeId);
    const eligible = floor.filter((s) => A.profiles.get(s.id)!.eligible);
    expect(eligible.length / floor.length).toBeGreaterThan(0.9);
  });

  it('salesIndex correlates with true ability', () => {
    const ids = data.sellers.filter((s) => s.storeId).map((s) => s.id);
    const c = corr(
      ids.map((id) => A.profiles.get(id)!.salesIndex),
      ids.map((id) => {
        const t = traits.get(id)!;
        return Math.sqrt(t.ability) * t.atv * Math.sqrt(t.ability);
      }),
    );
    expect(c).toBeGreaterThan(0.5);
  });

  it('upsell index correlates with true upsell skill', () => {
    const ids = data.sellers.filter((s) => s.storeId).map((s) => s.id);
    const c = corr(
      ids.map((id) => A.profiles.get(id)!.upsellIndex),
      ids.map((id) => traits.get(id)!.upsell),
    );
    expect(c).toBeGreaterThan(0.7);
  });

  it('spots the fragrance and skincare stars', () => {
    const noa = A.profiles.get(PERSONA.noa)!;
    const michal = A.profiles.get(PERSONA.michal)!;
    expect(noa.categoryIndex.fragrance).toBeGreaterThan(noa.categoryIndex.skincare * 1.4);
    expect(michal.categoryIndex.skincare).toBeGreaterThan(michal.categoryIndex.fragrance * 1.4);
  });

  it('spots the weak opener', () => {
    const rotem = A.profiles.get(PERSONA.rotem)!;
    expect(rotem.openingIndex / rotem.salesIndex).toBeLessThan(0.85);
  });

  it('detects pair chemistry', () => {
    const st = A.pairs.get(pairKey(PERSONA.shiran, PERSONA.lior))!;
    expect(st.coShifts).toBeGreaterThanOrEqual(10);
    expect(st.shrunkLift).toBeGreaterThan(1.08);
    const others = [...A.pairs.values()].filter((p) => p.coShifts >= 10).map((p) => p.shrunkLift);
    const median = others.sort((a, b) => a - b)[Math.floor(others.length / 2)];
    expect(Math.abs(median - 1)).toBeLessThan(0.05);
  });
});

describe('store assignment', () => {
  it('swaps the fragrance star to the fragrance store and the skincare star to the skincare store', () => {
    const region = data.stores.filter((s) => s.regionId === 'r-center');
    const res = assignStores({
      sellers: data.sellers.filter((s) => s.regionId === 'r-center'),
      stores: region,
      analysis: A,
    });
    expect(res.assignment.get(PERSONA.noa)).toBe('s-azrieli');
    expect(res.assignment.get(PERSONA.michal)).toBe('s-raanana');
    expect(res.newTotal).toBeGreaterThan(res.currentTotal);
    // head-count per store is preserved
    const before = new Map<string, number>();
    const after = new Map<string, number>();
    for (const [sid, to] of res.assignment) {
      const from = data.sellers.find((s) => s.id === sid)!.storeId!;
      before.set(from, (before.get(from) ?? 0) + 1);
      after.set(to, (after.get(to) ?? 0) + 1);
    }
    expect(after).toEqual(before);
    const noaMove = res.moves.find((m) => m.sellerId === PERSONA.noa)!;
    expect(noaMove.reasons.join(' ')).toContain('בישום');
  });
});

describe('mentoring', () => {
  it('pairs the weak opener with a strong opener from another store', () => {
    const matches = matchMentors({
      sellers: data.sellers.filter((s) => s.regionId === 'r-center'),
      stores: data.stores,
      profiles: A.profiles,
    });
    const m = matches.find((x) => x.menteeId === PERSONA.rotem)!;
    expect(m).toBeTruthy();
    expect(m.skill).toBe('opening');
    const mentor = data.sellers.find((s) => s.id === m.mentorId)!;
    expect(mentor.storeId).not.toBe('s-rishon');
    expect(m.mentorValue).toBeGreaterThan(m.regionMedian);
    // no mentor has more than 2 mentees, nobody mentors within her own store
    const load = new Map<string, number>();
    for (const x of matches) {
      load.set(x.mentorId, (load.get(x.mentorId) ?? 0) + 1);
      const a = data.sellers.find((s) => s.id === x.mentorId)!;
      const b = data.sellers.find((s) => s.id === x.menteeId)!;
      expect(a.storeId).not.toBe(b.storeId);
    }
    expect(Math.max(...load.values())).toBeLessThanOrEqual(2);
  });
});

describe('shift pairing', () => {
  const sunday = (d: Date) => {
    const x = new Date(d);
    x.setDate(x.getDate() - x.getDay() + 7);
    return dateKey(x);
  };

  it('respects availability, weekly quotas, one shift a day and a lead per slot', () => {
    const store = data.stores.find((s) => s.id === 's-ayalon')!;
    const slots = weekSlots(store, sunday(NOW), { morning: 2, evening: 3 });
    const cands = data.sellers.filter((s) => s.storeId === store.id);
    const plan = planShifts({ store, slots, candidates: cands, analysis: A, stores: data.stores });
    expect(plan.unfilled).toBe(0);
    const count = new Map<string, number>();
    for (const ps of plan.slots) {
      expect(ps.members.length).toBe(ps.slot.needed);
      expect(ps.members.some((m) => ['shift_lead', 'store_manager'].includes(cands.find((c) => c.id === m)!.role))).toBe(true);
      for (const m of ps.members) {
        const s = cands.find((c) => c.id === m)!;
        expect(s.availability).toContain(new Date(ps.slot.date + 'T00:00:00').getDay());
        count.set(m, (count.get(m) ?? 0) + 1);
      }
    }
    for (const [m, c] of count) expect(c).toBeLessThanOrEqual(cands.find((x) => x.id === m)!.shiftsPerWeek);
    const byDay = new Map<string, Set<string>>();
    for (const ps of plan.slots)
      for (const m of ps.members) {
        const k = m + ps.slot.date;
        expect(byDay.has(k)).toBe(false);
        byDay.set(k, new Set());
      }
    expect(plan.expected).toBeGreaterThan(plan.randomTeam);
    // fair share: nobody is left without shifts while others work extra
    const home = cands.filter((c) => c.role === "seller" && c.availability.length >= 5);
    for (const s of home) expect(count.get(s.id) ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('splits the week by contract and lets leads cover every slot', () => {
    const store = data.stores.find((s) => s.id === 's-ayalon')!;
    const slots = weekSlots(store, sunday(NOW), { morning: 2, evening: 3 });
    const cands = data.sellers.filter((s) => s.storeId === store.id);
    const cap = fairShare(cands, store.id, slots);
    const need = slots.reduce((a, s) => a + s.needed, 0);
    expect([...cap.values()].reduce((a, b) => a + b, 0)).toBe(need);
    const leadCap = cands.filter((c) => ['shift_lead', 'store_manager'].includes(c.role)).reduce((a, c) => a + cap.get(c.id)!, 0);
    expect(leadCap).toBeGreaterThanOrEqual(slots.length);
    for (const c of cands) expect(cap.get(c.id)!).toBeLessThanOrEqual(c.shiftsPerWeek);
  });

  it('puts the pair with chemistry together', () => {
    const store = data.stores.find((s) => s.id === 's-ayalon')!;
    const slots = weekSlots(store, sunday(NOW), { morning: 2, evening: 3 });
    const plan = planShifts({ store, slots, candidates: data.sellers.filter((s) => s.storeId === store.id), analysis: A, stores: data.stores });
    const together = plan.slots.filter((p) => p.members.includes(PERSONA.shiran) && p.members.includes(PERSONA.lior)).length;
    expect(together).toBeGreaterThanOrEqual(2);
  });

  it('puts a strong opener on the morning slot', () => {
    const store = data.stores.find((s) => s.id === 's-rishon')!;
    const date = addDays(sunday(NOW), 1);
    const slots = weekSlots(store, sunday(NOW), { morning: 2, evening: 3 }).filter((s) => s.date === date);
    const cands = data.sellers.filter((s) => s.storeId === store.id);
    const plan = planShifts({ store, slots, candidates: cands, analysis: A, stores: data.stores });
    const morning = plan.slots.find((p) => p.slot.id.endsWith('-m'))!;
    expect(morning.members).not.toContain(PERSONA.rotem);
  });
});
