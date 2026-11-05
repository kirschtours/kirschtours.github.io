/**
 * Shift pairing – who should work with whom.
 *
 * Value of a team in a slot =
 *   Σ members Σ hours  storeRate[weekday][hour] × member index for that hour
 *     (opening index for the first two hours of an opening shift, day-part index otherwise)
 *   × complementarity  (the team covers the store's category mix and has an upseller)
 *   × chemistry        (historical pair lift, shrunk by sample size)
 *   − travel cost for sellers borrowed from another store.
 *
 * Solved greedily (busiest slots first) and then improved by local search
 * (replace a member with someone from the bench while the total improves).
 */
import type { Category, Seller, Store } from '../types';
import { CATEGORIES, CATEGORY_LABEL } from '../types';
import type { Analysis, SellerProfile, StoreBaseline } from '../profiles';
import { pairKey } from '../profiles';
import { dayPartOf, distanceKm, mean, overlap, rng, weekday } from '../util';

export interface Slot {
  id: string;
  date: string;
  startHour: number;
  endHour: number;
  needed: number;
  requireLead: boolean;
}

export interface PairingOptions {
  store: Store;
  slots: Slot[];
  candidates: Seller[];
  analysis: Analysis;
  stores: Store[];
  /** ₪ per km, one way. Applies to sellers whose home store is another store. */
  travelCostPerKm?: number;
  maxIterations?: number;
}

export interface PlannedSlot {
  slot: Slot;
  members: string[];
  expected: number;
  /** same slot staffed by store-average sellers */
  averageTeam: number;
  notes: string[];
}

export interface PairingPlan {
  slots: PlannedSlot[];
  expected: number;
  /** same slots staffed by store-average sellers */
  averageTeam: number;
  /** same team and constraints, assigned at random – the gain over this is what smart pairing adds */
  randomTeam: number;
  unfilled: number;
}

export const isLead = (s: Seller) => s.role === 'shift_lead' || s.role === 'store_manager';

/** pull indices of thin profiles toward 1 (store average) */
function shrink(x: number, p: SellerProfile): number {
  return 1 + (x - 1) * Math.max(p.confidence, 0.15);
}

function hourBuckets(start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  for (let h = Math.floor(start); h < Math.ceil(end); h++) {
    const f = overlap(h, h + 1, start, end);
    if (f > 0) out.push([h, f]);
  }
  return out;
}

export function isOpeningSlot(store: Store, slot: Slot): boolean {
  const open = store.hours[weekday(slot.date)]?.open;
  return open != null && slot.startHour <= open + 0.01;
}

export interface TeamContext {
  store: Store;
  baseline: StoreBaseline;
  analysis: Analysis;
  sellers: Map<string, Seller>;
  storesById: Map<string, Store>;
  travelCostPerKm: number;
}

export function memberValue(ctx: TeamContext, sellerId: string, slot: Slot): number {
  const p = ctx.analysis.profiles.get(sellerId);
  const dow = weekday(slot.date);
  const opening = isOpeningSlot(ctx.store, slot);
  let v = 0;
  for (const [h, f] of hourBuckets(slot.startHour, slot.endHour)) {
    const rate = ctx.baseline.rate[dow][h];
    let idx = 1;
    if (p) idx = opening && h < slot.startHour + 2 ? shrink(p.openingIndex, p) : shrink(p.dayPartIndex[dayPartOf(h + 0.5)], p);
    v += rate * f * idx;
  }
  return v;
}

export function travelCost(ctx: TeamContext, sellerId: string): number {
  const s = ctx.sellers.get(sellerId);
  if (!s || !s.storeId || s.storeId === ctx.store.id) return 0;
  const home = ctx.storesById.get(s.storeId);
  const fromLat = s.homeLat ?? home?.lat;
  const fromLng = s.homeLng ?? home?.lng;
  if (fromLat == null || fromLng == null) return 0;
  return distanceKm(fromLat, fromLng, ctx.store.lat, ctx.store.lng) * 2 * ctx.travelCostPerKm;
}

export function teamValue(ctx: TeamContext, members: string[], slot: Slot): number {
  if (!members.length) return 0;
  // chemistry: each member's output is multiplied by her lift with every partner on the floor
  let base = 0;
  for (const m of members) {
    let chem = 1;
    for (const o of members) {
      if (o === m) continue;
      const st = ctx.analysis.pairs.get(pairKey(m, o));
      if (st && st.coShifts >= 3) chem *= st.shrunkLift;
    }
    base += memberValue(ctx, m, slot) * chem;
  }
  let mult = 1;
  if (members.length >= 2) {
    const ps = members.map((m) => ctx.analysis.profiles.get(m)).filter(Boolean) as SellerProfile[];
    if (ps.length >= 2) {
      // category complementarity: the customer who wants fragrance is served by the fragrance expert
      let comp = 0;
      for (const c of CATEGORIES) {
        const xs = ps.map((p) => 1 + (p.categoryIndex[c] / p.salesIndex - 1) * p.confidence * 0.7);
        comp += ctx.baseline.categoryMix[c] * (Math.max(...xs) - mean(xs));
      }
      const ups = ps.map((p) => shrink(p.upsellIndex, p));
      // modest weights: a hand-off helps, but each seller still serves her own customers
      mult *= 1 + 0.15 * comp + 0.03 * (Math.max(...ups) - mean(ups));
    }
  }
  let travel = 0;
  for (const m of members) travel += travelCost(ctx, m);
  return base * mult - travel;
}

export function averageTeamValue(baseline: StoreBaseline, slot: Slot): number {
  const dow = weekday(slot.date);
  let v = 0;
  for (const [h, f] of hourBuckets(slot.startHour, slot.endHour)) v += baseline.rate[dow][h] * f;
  return v * slot.needed;
}

export function explainTeam(ctx: TeamContext, members: string[], slot: Slot): string[] {
  const notes: string[] = [];
  const name = (id: string) => ctx.sellers.get(id)?.name ?? id;
  const ps = members.map((m) => ctx.analysis.profiles.get(m)).filter(Boolean) as SellerProfile[];
  if (!ps.length) return notes;
  if (isOpeningSlot(ctx.store, slot)) {
    const best = ps.reduce((a, b) => (b.openingIndex / b.salesIndex > a.openingIndex / a.salesIndex ? b : a));
    const r = best.openingIndex / best.salesIndex;
    if (r >= 1.05) notes.push(`${name(best.sellerId)} פותחת את הבוקר: סיפתוח חזק (${r.toFixed(2)} מהרגיל שלה)`);
  }
  const topCats = [...CATEGORIES].sort((a, b) => ctx.baseline.categoryMix[b] - ctx.baseline.categoryMix[a]).slice(0, 2) as Category[];
  for (const c of topCats) {
    const best = ps.reduce((a, b) => (b.categoryIndex[c] > a.categoryIndex[c] ? b : a));
    if (best.categoryIndex[c] >= 1.1)
      notes.push(
        `${name(best.sellerId)} מכסה ${CATEGORY_LABEL[c]} (${Math.round(ctx.baseline.categoryMix[c] * 100)}% מהמכירות בסניף, מדד ${best.categoryIndex[c].toFixed(2)})`,
      );
  }
  const ups = ps.reduce((a, b) => (b.upsellIndex > a.upsellIndex ? b : a));
  if (ups.upsellIndex >= 1.15) notes.push(`${name(ups.sellerId)} מובילה הגדלות (${ups.upsellIndex.toFixed(2)})`);
  for (let i = 0; i < members.length; i++)
    for (let j = i + 1; j < members.length; j++) {
      const st = ctx.analysis.pairs.get(pairKey(members[i], members[j]));
      if (st && st.coShifts >= 3 && Math.abs(st.shrunkLift - 1) >= 0.04)
        notes.push(
          `${name(members[i])} + ${name(members[j])}: ביחד ${st.shrunkLift > 1 ? '+' : ''}${Math.round((st.shrunkLift - 1) * 100)}% (${st.coShifts} משמרות משותפות)`,
        );
    }
  for (const m of members) {
    const s = ctx.sellers.get(m);
    if (s?.storeId && s.storeId !== ctx.store.id) {
      const home = ctx.storesById.get(s.storeId);
      notes.push(`${s.name} מגיעה כתגבור מ${home?.name ?? 'סניף אחר'}`);
    }
  }
  return notes;
}

/**
 * Max shifts per person for the week: total slots split by contract (largest remainder),
 * capped by the contract; leads topped up so every lead-required slot can be covered.
 */
export function fairShare(cands: Seller[], storeId: string, slots: Slot[]): Map<string, number> {
  const cap = new Map<string, number>();
  const home = cands.filter((s) => s.active && s.storeId === storeId && s.shiftsPerWeek > 0);
  for (const s of cands) if (s.storeId !== storeId) cap.set(s.id, Math.min(2, s.shiftsPerWeek));
  const need = slots.reduce((a, s) => a + s.needed, 0);
  const contract = home.reduce((a, s) => a + s.shiftsPerWeek, 0);
  if (!contract) return cap;
  const quota = home.map((s) => ({ s, q: Math.min(s.shiftsPerWeek, (need * s.shiftsPerWeek) / contract) }));
  for (const { s, q } of quota) cap.set(s.id, Math.floor(q));
  let left = need - quota.reduce((a, x) => a + Math.floor(x.q), 0);
  for (const { s } of [...quota].sort((a, b) => (b.q % 1) - (a.q % 1))) {
    if (left <= 0) break;
    if (cap.get(s.id)! < s.shiftsPerWeek) {
      cap.set(s.id, cap.get(s.id)! + 1);
      left--;
    }
  }
  const leads = home.filter(isLead);
  const leadSlots = slots.filter((s) => s.requireLead).length;
  let leadCap = leads.reduce((a, s) => a + cap.get(s.id)!, 0);
  for (let guard = 0; leadCap < leadSlots && guard < 100; guard++) {
    const l = leads.filter((s) => cap.get(s.id)! < s.shiftsPerWeek).sort((a, b) => cap.get(a.id)! - cap.get(b.id)!)[0];
    if (!l) break;
    cap.set(l.id, cap.get(l.id)! + 1);
    leadCap++;
    // take the shift back from the non-lead with the most
    const donor = home.filter((s) => !isLead(s) && cap.get(s.id)! > 0).sort((a, b) => cap.get(b.id)! - cap.get(a.id)!)[0];
    if (donor) cap.set(donor.id, cap.get(donor.id)! - 1);
  }
  return cap;
}

export function planShifts(opts: PairingOptions): PairingPlan {
  const baseline = opts.analysis.baselines.get(opts.store.id);
  if (!baseline) throw new Error('no baseline for store');
  const ctx: TeamContext = {
    store: opts.store,
    baseline,
    analysis: opts.analysis,
    sellers: new Map(opts.candidates.map((s) => [s.id, s])),
    storesById: new Map(opts.stores.map((s) => [s.id, s])),
    travelCostPerKm: opts.travelCostPerKm ?? 1.5,
  };
  const cands = opts.candidates.filter((s) => s.active);

  // Fair share: the week's slots are split over the home team in proportion to contracts
  // (largest-remainder apportionment), so the optimizer decides WHO WORKS WITH WHOM and WHEN –
  // not who gets to work. Leads get enough to cover every slot; borrowed sellers at most 2 shifts.
  const cap = fairShare(cands, opts.store.id, opts.slots);
  const hasLead = (members: string[]) => members.some((m) => ctx.sellers.get(m) && isLead(ctx.sellers.get(m)!));

  type State = { assigned: Map<string, string[]>; count: Map<string, number>; days: Map<string, Set<string>> };
  const newState = (): State => ({ assigned: new Map(opts.slots.map((s) => [s.id, []])), count: new Map(), days: new Map() });
  const canTake = (st: State, s: Seller, slot: Slot) =>
    s.availability.includes(weekday(slot.date)) && !st.days.get(s.id)?.has(slot.date) && (st.count.get(s.id) ?? 0) < (cap.get(s.id) ?? 0);
  const take = (st: State, id: string, slot: Slot) => {
    st.count.set(id, (st.count.get(id) ?? 0) + 1);
    if (!st.days.has(id)) st.days.set(id, new Set());
    st.days.get(id)!.add(slot.date);
  };
  const release = (st: State, id: string, slot: Slot) => {
    st.count.set(id, (st.count.get(id) ?? 1) - 1);
    st.days.get(id)?.delete(slot.date);
  };
  const fill = (order: Slot[], choose: (team: string[], slot: Slot, options: Seller[]) => Seller | null): State => {
    const st = newState();
    // phase A: one lead per slot, most constrained slots first (fewest available leads)
    const leadSlots = order
      .filter((sl) => sl.requireLead)
      .sort(
        (a, b) =>
          cands.filter((s) => isLead(s) && s.availability.includes(weekday(a.date))).length -
          cands.filter((s) => isLead(s) && s.availability.includes(weekday(b.date))).length,
      );
    for (const slot of leadSlots) {
      const team = st.assigned.get(slot.id)!;
      const pick = choose(team, slot, cands.filter((s) => isLead(s) && canTake(st, s, slot)));
      if (pick) {
        team.push(pick.id);
        take(st, pick.id, slot);
      }
    }
    // phase B: everyone else, in the given order
    for (const slot of order) {
      const team = st.assigned.get(slot.id)!;
      while (team.length < slot.needed) {
        const pick = choose(team, slot, cands.filter((s) => !team.includes(s.id) && canTake(st, s, slot)));
        if (!pick) break;
        team.push(pick.id);
        take(st, pick.id, slot);
      }
    }
    return st;
  };
  const total = (st: State) => opts.slots.reduce((a, slot) => a + teamValue(ctx, st.assigned.get(slot.id)!, slot), 0);

  // 1. greedy: busiest slots first, best marginal gain
  const order = [...opts.slots].sort((a, b) => averageTeamValue(baseline, b) - averageTeamValue(baseline, a));
  const greedyPick = (team: string[], slot: Slot, options: Seller[]) => {
    let pick: Seller | null = null;
    let bestGain = -Infinity;
    const cur = teamValue(ctx, team, slot);
    for (const s of options) {
      const g = teamValue(ctx, [...team, s.id], slot) - cur;
      if (g > bestGain) {
        bestGain = g;
        pick = s;
      }
    }
    return pick;
  };
  const best = fill(order, greedyPick);

  // availability can make the exact split infeasible – then allow one extra shift and retry
  const unfilledOf = (st: State) => opts.slots.reduce((a, sl) => a + Math.max(0, sl.needed - st.assigned.get(sl.id)!.length), 0);
  if (unfilledOf(best) > 0) {
    const original = new Map(cap);
    const openDays = opts.slots.filter((sl) => best.assigned.get(sl.id)!.length < sl.needed).map((sl) => sl);
    for (const [id, c] of cap) {
      const s = ctx.sellers.get(id)!;
      const canHelp = openDays.some((sl) => s.availability.includes(weekday(sl.date)) && !best.days.get(id)?.has(sl.date));
      if (s.storeId === opts.store.id && canHelp) cap.set(id, Math.min(s.shiftsPerWeek, c + 1));
    }
    // fill only the holes; everyone else keeps their fair share
    for (const slot of order) {
      const team = best.assigned.get(slot.id)!;
      while (team.length < slot.needed) {
        const needLead = slot.requireLead && !hasLead(team);
        const pick = greedyPick(team, slot, cands.filter((c) => !team.includes(c.id) && canTake(best, c, slot) && (!needLead || isLead(c))));
        if (!pick) break;
        team.push(pick.id);
        take(best, pick.id, slot);
      }
    }
    // lock the slack again so local search can't use it to hand out extra shifts
    for (const [id, c] of original) cap.set(id, Math.max(c, best.count.get(id) ?? 0));
  }

  // 2. local search: swap a member with a bench seller, or two members between slots
  const maxIter = opts.maxIterations ?? 50;
  for (let iter = 0; iter < maxIter; iter++) {
    let improved = false;
    for (const slot of opts.slots) {
      const team = best.assigned.get(slot.id)!;
      for (let k = 0; k < team.length; k++) {
        const cur = teamValue(ctx, team, slot);
        let bestId: string | null = null;
        let bestVal = cur + 1e-6;
        for (const s of cands) {
          if (team.includes(s.id) || !canTake(best, s, slot)) continue;
          const trial = team.slice();
          trial[k] = s.id;
          if (slot.requireLead && hasLead(team) && !hasLead(trial)) continue;
          const v = teamValue(ctx, trial, slot);
          if (v > bestVal) {
            bestVal = v;
            bestId = s.id;
          }
        }
        if (bestId) {
          release(best, team[k], slot);
          team[k] = bestId;
          take(best, bestId, slot);
          improved = true;
        }
      }
    }
    // pairwise swaps between two slots (keeps everyone's shift count – this is what moves pairs together)
    for (let i = 0; i < opts.slots.length; i++)
      for (let j = i + 1; j < opts.slots.length; j++) {
        const A = opts.slots[i];
        const B = opts.slots[j];
        const ta = best.assigned.get(A.id)!;
        const tb = best.assigned.get(B.id)!;
        for (let x = 0; x < ta.length; x++)
          for (let y = 0; y < tb.length; y++) {
            const a = ta[x];
            const b = tb[y];
            if (a === b || ta.includes(b) || tb.includes(a)) continue;
            const sa = ctx.sellers.get(a)!;
            const sb = ctx.sellers.get(b)!;
            if (!sa.availability.includes(weekday(B.date)) || !sb.availability.includes(weekday(A.date))) continue;
            if (A.date !== B.date && (best.days.get(a)?.has(B.date) || best.days.get(b)?.has(A.date))) continue;
            const na = ta.slice();
            const nb = tb.slice();
            na[x] = b;
            nb[y] = a;
            if ((A.requireLead && !hasLead(na)) || (B.requireLead && !hasLead(nb))) continue;
            const before = teamValue(ctx, ta, A) + teamValue(ctx, tb, B);
            const after = teamValue(ctx, na, A) + teamValue(ctx, nb, B);
            if (after > before + 1e-6) {
              best.days.get(a)?.delete(A.date);
              best.days.get(b)?.delete(B.date);
              best.days.get(a)?.add(B.date);
              best.days.get(b)?.add(A.date);
              ta[x] = b;
              tb[y] = a;
              improved = true;
            }
          }
      }
    if (!improved) break;
  }

  // 3. honest baseline: the same team, same constraints, assigned at random (mean of 30 draws)
  const r = rng(opts.slots.length * 7919 + cands.length);
  let randomSum = 0;
  const draws = 30;
  for (let d = 0; d < draws; d++) {
    const shuffled = [...opts.slots].sort(() => r() - 0.5);
    randomSum += total(fill(shuffled, (_t, _s, options) => (options.length ? options[Math.floor(r() * options.length)] : null)));
  }

  const planned: PlannedSlot[] = opts.slots.map((slot) => {
    const members = best.assigned.get(slot.id)!;
    return {
      slot,
      members,
      expected: teamValue(ctx, members, slot),
      averageTeam: averageTeamValue(baseline, slot) * (members.length / Math.max(1, slot.needed)),
      notes: explainTeam(ctx, members, slot),
    };
  });
  return {
    slots: planned,
    expected: planned.reduce((a, p) => a + p.expected, 0),
    averageTeam: planned.reduce((a, p) => a + p.averageTeam, 0),
    randomTeam: randomSum / draws,
    unfilled: planned.reduce((a, p) => a + Math.max(0, p.slot.needed - p.members.length), 0),
  };
}

/** default week template: morning (open→mid) and evening (mid→close) per open day */
export function weekSlots(store: Store, weekStart: string, needed: { morning: number; evening: number }): Slot[] {
  const out: Slot[] = [];
  const start = new Date(weekStart + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const h = store.hours[d.getDay()];
    if (!h) continue;
    const len = h.close - h.open;
    if (len <= 7) {
      out.push({ id: `${key}-m`, date: key, startHour: h.open, endHour: h.close, needed: needed.morning, requireLead: true });
      continue;
    }
    const mid = Math.round((h.open + len / 2) * 2) / 2;
    out.push({ id: `${key}-m`, date: key, startHour: h.open, endHour: mid, needed: needed.morning, requireLead: true });
    out.push({ id: `${key}-e`, date: key, startHour: mid, endHour: h.close, needed: needed.evening, requireLead: true });
  }
  return out;
}
