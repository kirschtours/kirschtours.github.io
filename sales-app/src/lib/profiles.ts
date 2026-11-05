/**
 * Store-normalized seller profiles.
 *
 * A raw ₪ number says more about the store than the seller (a flagship mall
 * sells more than a neighbourhood branch). So every seller metric here is the
 * ratio between what she did and what an average seller would have done in the
 * same store, weekday and hour. 1.00 = store average, 1.20 = 20% better.
 * That makes sellers comparable across stores – the basis for every
 * pairing / store / mentoring recommendation.
 */
import type { Category, Dataset, DayPart, Sale, Store } from './types';
import { CATEGORIES, DAY_PARTS } from './types';
import { emptyCategoryRecord, firstSaleInShift, involves, shareOf } from './metrics';
import { clamp, dateOf, dayPartOf, groupBy, hourOf, mean, overlap, safeDiv, std, weekday } from './util';

export const MIN_SHIFTS_FOR_RECOMMENDATION = 15;
/** pseudo-count that pulls pair lifts toward 1: with 12 co-shifts half of the observed lift is kept */
export const PAIR_SHRINK = 12;

export interface StoreBaseline {
  storeId: string;
  /** net revenue per staffed seller-hour, [weekday][hour] */
  rate: number[][];
  /** fallback over all weekdays, [hour] */
  rateByHour: number[];
  revenuePerSellerHour: number;
  atv: number;
  upt: number;
  upsellRate: number;
  conversion: number | null;
  /** minutes from opening-shift start to that seller's first sale */
  minutesToFirstSale: number;
  categoryMix: Record<Category, number>;
  dayPartLoad: Record<DayPart, number>;
  /** share of revenue per clock hour */
  hourLoad: number[];
  avgShiftHours: number;
  weeklyRevenue: number;
  sellerHours: number;
}

export interface SellerProfile {
  sellerId: string;
  shifts: number;
  hours: number;
  eligible: boolean;
  /** 0..1 – grows with number of shifts observed */
  confidence: number;
  /** overall productivity vs store/weekday/hour expectation */
  salesIndex: number;
  /** first two hours of opening shifts + speed to first sale */
  openingIndex: number;
  openingShifts: number;
  atvIndex: number;
  uptIndex: number;
  upsellIndex: number;
  conversionIndex: number | null;
  /** productivity per category (absolute: includes salesIndex) */
  categoryIndex: Record<Category, number>;
  dayPartIndex: Record<DayPart, number>;
  /** 1 = very steady shift to shift, 0 = erratic */
  consistency: number;
  avgMinutesToFirstSale: number | null;
  revenue: number;
  stores: string[];
}

export interface PairStat {
  a: string;
  b: string;
  coShifts: number;
  /** actual / expected (given both sellers' own indices) while working together */
  lift: number;
  /** lift shrunk toward 1 by sample size */
  shrunkLift: number;
}

export interface Analysis {
  baselines: Map<string, StoreBaseline>;
  profiles: Map<string, SellerProfile>;
  pairs: Map<string, PairStat>;
  chainAtv: number;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function inRange(date: string, from?: string, to?: string) {
  return (!from || date >= from) && (!to || date <= to);
}

/** iterate whole-hour buckets of a shift with the fraction worked in each */
function* hourBuckets(start: number, end: number): Generator<[number, number]> {
  for (let h = Math.floor(start); h < Math.ceil(end); h++) {
    const f = overlap(h, h + 1, start, end);
    if (f > 0) yield [h, f];
  }
}

export function computeBaselines(data: Dataset, from?: string, to?: string): Map<string, StoreBaseline> {
  const out = new Map<string, StoreBaseline>();
  const shiftsByStore = groupBy(
    data.shifts.filter((s) => inRange(s.date, from, to)),
    (s) => s.storeId,
  );
  const salesByStore = groupBy(
    data.sales.filter((s) => inRange(dateOf(s.ts), from, to)),
    (s) => s.storeId,
  );
  const intsByStore = groupBy(
    data.interactions.filter((i) => inRange(dateOf(i.ts), from, to)),
    (i) => i.storeId,
  );

  for (const store of data.stores) {
    const shifts = shiftsByStore.get(store.id) ?? [];
    const sales = salesByStore.get(store.id) ?? [];
    const staffed = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const rev = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let sellerHours = 0;
    for (const sh of shifts) {
      const dow = weekday(sh.date);
      for (const [h, f] of hourBuckets(sh.startHour, sh.endHour)) {
        staffed[dow][h] += f;
        sellerHours += f;
      }
    }
    let net = 0,
      gross = 0,
      tx = 0,
      units = 0,
      ups = 0;
    const cat = emptyCategoryRecord();
    const hourRev = new Array(24).fill(0);
    const days = new Set<string>();
    for (const s of sales) {
      const d = dateOf(s.ts);
      days.add(d);
      const h = Math.floor(hourOf(s.ts));
      const signed = s.isReturn ? -s.amount : s.amount;
      net += signed;
      if (s.isReturn) continue;
      rev[weekday(d)][h] += s.amount;
      hourRev[h] += s.amount;
      gross += s.amount;
      tx++;
      units += s.units;
      if (s.upsell !== 'none') ups++;
      for (const c of s.categories) cat[c] += s.amount / s.categories.length;
    }
    const totalStaffedByHour = new Array(24).fill(0);
    const totalRevByHour = new Array(24).fill(0);
    for (let d = 0; d < 7; d++)
      for (let h = 0; h < 24; h++) {
        totalStaffedByHour[h] += staffed[d][h];
        totalRevByHour[h] += rev[d][h];
      }
    const overall = safeDiv(gross, sellerHours);
    // smooth multiplicative model: hourly curve (all weekdays) × weekday factor.
    // Raw weekday×hour cells hold ~13 observations each and are too noisy to judge people by.
    const hourPrior = 8; // seller-hours of pseudo-data at the overall rate
    const rateByHour = totalRevByHour.map((r, h) => (r + overall * hourPrior) / (totalStaffedByHour[h] + hourPrior));
    const dowFactor = staffed.map((row, d) => {
      let act = 0,
        exp = 0;
      for (let h = 0; h < 24; h++) {
        act += rev[d][h];
        exp += row[h] * rateByHour[h];
      }
      return (act + 20 * overall) / (exp + 20 * overall);
    });
    const rate = staffed.map((_, d) => rateByHour.map((r) => r * dowFactor[d]));

    // time to first sale on opening shifts
    const salesBySeller = groupBy(sales, (s) => s.sellerId);
    const waits: number[] = [];
    for (const sh of shifts) {
      const open = store.hours[weekday(sh.date)]?.open;
      if (open == null || sh.startHour > open + 0.01) continue;
      const f = firstSaleInShift(sh, salesBySeller.get(sh.sellerId) ?? []);
      if (f !== null) waits.push((f - sh.startHour) * 60);
    }

    const ints = intsByStore.get(store.id)?.length ?? 0;
    const dayPartLoad: Record<DayPart, number> = { morning: 0, noon: 0, evening: 0 };
    hourRev.forEach((r, h) => (dayPartLoad[dayPartOf(h + 0.5)] += safeDiv(r, gross)));
    const categoryMix = emptyCategoryRecord();
    for (const c of CATEGORIES) categoryMix[c] = safeDiv(cat[c], gross, 1 / CATEGORIES.length);
    const weeks = Math.max(1, days.size / 6);

    out.set(store.id, {
      storeId: store.id,
      rate,
      rateByHour,
      revenuePerSellerHour: overall,
      atv: safeDiv(gross, tx),
      upt: safeDiv(units, tx, 1),
      upsellRate: safeDiv(ups, tx),
      conversion: ints ? tx / ints : null,
      minutesToFirstSale: waits.length ? mean(waits) : 30,
      categoryMix,
      dayPartLoad,
      hourLoad: hourRev.map((r) => safeDiv(r, gross)),
      avgShiftHours: shifts.length ? safeDiv(sellerHours, shifts.length) : 7,
      weeklyRevenue: net / weeks,
      sellerHours,
    });
  }
  return out;
}

/** expected revenue for an average seller over [start,end) in a store on a date */
export function expectedRevenue(b: StoreBaseline, date: string, start: number, end: number): number {
  const dow = weekday(date);
  let e = 0;
  for (const [h, f] of hourBuckets(start, end)) e += b.rate[dow][h] * f;
  return e;
}

function neutralProfile(sellerId: string): SellerProfile {
  const one = { skincare: 1, makeup: 1, fragrance: 1, hair: 1, body: 1 };
  return {
    sellerId,
    shifts: 0,
    hours: 0,
    eligible: false,
    confidence: 0,
    salesIndex: 1,
    openingIndex: 1,
    openingShifts: 0,
    atvIndex: 1,
    uptIndex: 1,
    upsellIndex: 1,
    conversionIndex: null,
    categoryIndex: one,
    dayPartIndex: { morning: 1, noon: 1, evening: 1 },
    consistency: 0,
    avgMinutesToFirstSale: null,
    revenue: 0,
    stores: [],
  };
}

export function computeProfiles(
  data: Dataset,
  baselines: Map<string, StoreBaseline>,
  from?: string,
  to?: string,
): Map<string, SellerProfile> {
  const storeById = new Map(data.stores.map((s) => [s.id, s] as [string, Store]));
  const shiftsBySeller = groupBy(
    data.shifts.filter((s) => inRange(s.date, from, to)),
    (s) => s.sellerId,
  );
  const sales = data.sales.filter((s) => inRange(dateOf(s.ts), from, to));
  const salesBySeller = new Map<string, Sale[]>();
  for (const s of sales) {
    for (const id of s.coSellerId ? [s.sellerId, s.coSellerId] : [s.sellerId]) {
      const arr = salesBySeller.get(id);
      if (arr) arr.push(s);
      else salesBySeller.set(id, [s]);
    }
  }
  const intsBySellerStore = new Map<string, number>();
  for (const i of data.interactions) {
    if (!inRange(dateOf(i.ts), from, to)) continue;
    const k = i.sellerId + '|' + i.storeId;
    intsBySellerStore.set(k, (intsBySellerStore.get(k) ?? 0) + 1);
  }

  const out = new Map<string, SellerProfile>();
  for (const seller of data.sellers) {
    const shifts = shiftsBySeller.get(seller.id) ?? [];
    const mySales = salesBySeller.get(seller.id) ?? [];
    if (!shifts.length) {
      out.set(seller.id, neutralProfile(seller.id));
      continue;
    }
    const salesByDayStore = groupBy(mySales, (s) => s.storeId + '|' + dateOf(s.ts));

    let actual = 0,
      expected = 0,
      hours = 0;
    const perShift: number[] = [];
    const partAct: Record<DayPart, number> = { morning: 0, noon: 0, evening: 0 };
    const partExp: Record<DayPart, number> = { morning: 0, noon: 0, evening: 0 };
    let openAct = 0,
      openExp = 0,
      openShifts = 0;
    const waits: number[] = [];
    const storeWaits: number[] = [];

    for (const sh of shifts) {
      const b = baselines.get(sh.storeId);
      const store = storeById.get(sh.storeId);
      if (!b || !store) continue;
      const dow = weekday(sh.date);
      const daySales = (salesByDayStore.get(sh.storeId + '|' + sh.date) ?? []).filter((s) => {
        const h = hourOf(s.ts);
        return h >= sh.startHour - 0.25 && h <= sh.endHour + 0.25;
      });
      let shAct = 0;
      for (const s of daySales) {
        const v = (s.isReturn ? 0 : s.amount) * shareOf(s, seller.id);
        shAct += v;
        partAct[dayPartOf(hourOf(s.ts))] += v;
      }
      let shExp = 0;
      for (const [h, f] of hourBuckets(sh.startHour, sh.endHour)) {
        const e = b.rate[dow][h] * f;
        shExp += e;
        partExp[dayPartOf(h + 0.5)] += e;
      }
      actual += shAct;
      expected += shExp;
      hours += sh.endHour - sh.startHour;
      if (shExp > 0) perShift.push(shAct / shExp);

      const open = store.hours[dow]?.open;
      if (open != null && sh.startHour <= open + 0.01) {
        openShifts++;
        const winEnd = sh.startHour + 2;
        for (const s of daySales) if (hourOf(s.ts) < winEnd && !s.isReturn) openAct += s.amount * shareOf(s, seller.id);
        openExp += expectedRevenue(b, sh.date, sh.startHour, winEnd);
        const f = firstSaleInShift(sh, daySales);
        // no sale at all in the shift counts as a full-length wait
        waits.push(f === null ? (sh.endHour - sh.startHour) * 60 : (f - sh.startHour) * 60);
        storeWaits.push(b.minutesToFirstSale);
      }
    }

    // basket metrics vs the store the sale happened in
    let amt = 0,
      expAmt = 0,
      unitsW = 0,
      expUnits = 0,
      upsW = 0,
      expUps = 0,
      txW = 0;
    const catAct = emptyCategoryRecord();
    const txByStore = new Map<string, number>();
    for (const s of mySales) {
      if (s.isReturn) continue;
      const w = shareOf(s, seller.id);
      const b = baselines.get(s.storeId);
      if (!b || !w) continue;
      amt += s.amount * w;
      expAmt += b.atv * w;
      unitsW += s.units * w;
      expUnits += b.upt * w;
      upsW += (s.upsell !== 'none' ? 1 : 0) * w;
      expUps += b.upsellRate * w;
      txW += w;
      txByStore.set(s.storeId, (txByStore.get(s.storeId) ?? 0) + w);
      for (const c of s.categories) catAct[c] += (s.amount * w) / s.categories.length;
    }

    // conversion vs store conversion, only where approaches were tracked
    let convAct = 0,
      convExp = 0,
      ints = 0;
    for (const [sid, t] of txByStore) {
      const n = intsBySellerStore.get(seller.id + '|' + sid) ?? 0;
      const b = baselines.get(sid);
      if (!n || !b?.conversion) continue;
      convAct += t;
      convExp += n * b.conversion;
      ints += n;
    }

    // expected per category = expected revenue × that store's category share
    const catExp = emptyCategoryRecord();
    for (const sh of shifts) {
      const b = baselines.get(sh.storeId);
      if (!b) continue;
      const e = expectedRevenue(b, sh.date, sh.startHour, sh.endHour);
      for (const c of CATEGORIES) catExp[c] += e * b.categoryMix[c];
    }

    const salesIndex = safeDiv(actual, expected, 1);
    const categoryIndex = emptyCategoryRecord();
    for (const c of CATEGORIES) {
      // shrink thin categories toward the seller's overall index
      const prior = expected * 0.02;
      categoryIndex[c] = (catAct[c] + prior * salesIndex) / (catExp[c] + prior || 1);
    }
    const dayPartIndex: Record<DayPart, number> = { morning: salesIndex, noon: salesIndex, evening: salesIndex };
    for (const p of DAY_PARTS) {
      const prior = expected * 0.03;
      dayPartIndex[p] = (partAct[p] + prior * salesIndex) / (partExp[p] + prior || 1);
    }
    const speed = waits.length ? clamp(safeDiv(mean(storeWaits), Math.max(5, mean(waits)), 1), 0.3, 3) : 1;
    const firstTwoHours = safeDiv(openAct, openExp, salesIndex);
    const openingIndex = openShifts ? 0.5 * firstTwoHours + 0.5 * salesIndex * speed : salesIndex;
    const m = mean(perShift);
    const n = shifts.length;

    out.set(seller.id, {
      sellerId: seller.id,
      shifts: n,
      hours,
      eligible: n >= MIN_SHIFTS_FOR_RECOMMENDATION,
      confidence: clamp(n / 30, 0, 1),
      salesIndex,
      openingIndex,
      openingShifts: openShifts,
      atvIndex: safeDiv(amt, expAmt, 1),
      uptIndex: safeDiv(unitsW, expUnits, 1),
      upsellIndex: safeDiv(upsW, expUps, 1),
      conversionIndex: ints >= 20 ? safeDiv(convAct, convExp, 1) : null,
      categoryIndex,
      dayPartIndex,
      consistency: m ? clamp(1 - std(perShift) / m, 0, 1) : 0,
      avgMinutesToFirstSale: waits.length ? mean(waits) : null,
      revenue: actual,
      stores: [...new Set(shifts.map((s) => s.storeId))],
    });
  }
  return out;
}

/**
 * Pair chemistry – "with / without" estimate.
 * lift(A,B) = what A and B sold on shifts together ÷ what each sells on shifts without the other.
 * A seller who often works with a strong partner would look inflated "without B",
 * so her solo level also leaves out shifts with her strong partners (found in the previous pass),
 * and the joint shifts are corrected for any other strong partner on the floor.
 * Raw lifts are shrunk toward 1 by sample size (PAIR_SHRINK).
 */
export function computePairs(
  data: Dataset,
  baselines: Map<string, StoreBaseline>,
  _profiles: Map<string, SellerProfile>,
  from?: string,
  to?: string,
): Map<string, PairStat> {
  const shifts = data.shifts.filter((s) => inRange(s.date, from, to));
  const byDayStore = groupBy(shifts, (s) => s.storeId + '|' + s.date);
  const salesByDayStore = groupBy(
    data.sales.filter((s) => !s.isReturn && inRange(dateOf(s.ts), from, to)),
    (s) => s.storeId + '|' + dateOf(s.ts),
  );

  interface Rec {
    seller: string;
    act: number;
    exp: number;
    partners: string[];
  }
  const recsBySeller = new Map<string, Rec[]>();
  const together = new Map<string, { a: Rec; b: Rec }[]>();
  for (const [k, list] of byDayStore) {
    const b = baselines.get(list[0].storeId);
    if (!b) continue;
    const daySales = salesByDayStore.get(k) ?? [];
    const dayRecs: Rec[] = list.map((sh) => {
      let act = 0;
      for (const s of daySales) {
        const h = hourOf(s.ts);
        if (h >= sh.startHour - 0.25 && h <= sh.endHour + 0.25 && involves(s, sh.sellerId)) act += s.amount * shareOf(s, sh.sellerId);
      }
      const partners = list
        .filter((o) => o.sellerId !== sh.sellerId && Math.min(o.endHour, sh.endHour) - Math.max(o.startHour, sh.startHour) >= 3)
        .map((o) => o.sellerId);
      return { seller: sh.sellerId, act, exp: expectedRevenue(b, sh.date, sh.startHour, sh.endHour), partners };
    });
    for (const r of dayRecs) {
      const arr = recsBySeller.get(r.seller);
      if (arr) arr.push(r);
      else recsBySeller.set(r.seller, [r]);
    }
    for (let i = 0; i < dayRecs.length; i++)
      for (let j = i + 1; j < dayRecs.length; j++) {
        if (!dayRecs[i].partners.includes(dayRecs[j].seller)) continue;
        const key = pairKey(dayRecs[i].seller, dayRecs[j].seller);
        const arr = together.get(key);
        const item = { a: dayRecs[i], b: dayRecs[j] };
        if (arr) arr.push(item);
        else together.set(key, [item]);
      }
  }

  let shrunk = new Map<string, number>();
  let raw = new Map<string, number>();
  const strong = (a: string, b: string) => {
    const v = shrunk.get(pairKey(a, b));
    return v != null && Math.abs(v - 1) >= 0.06;
  };
  const otherChem = (r: Rec, except: string) =>
    r.partners.reduce((m, p) => (p !== except && strong(r.seller, p) ? m * shrunk.get(pairKey(r.seller, p))! : m), 1);
  const solo = (seller: string, except: string) => {
    const all = recsBySeller.get(seller) ?? [];
    let act = 0,
      exp = 0,
      n = 0;
    for (const r of all) {
      if (r.partners.includes(except) || r.partners.some((p) => strong(seller, p))) continue;
      act += r.act;
      exp += r.exp;
      n++;
    }
    if (n < 5) {
      act = 0;
      exp = 0;
      for (const r of all) {
        if (r.partners.includes(except)) continue;
        act += r.act / otherChem(r, except);
        exp += r.exp;
      }
    }
    return safeDiv(act, exp, 1);
  };

  for (let pass = 0; pass < 3; pass++) {
    const nextRaw = new Map<string, number>();
    const nextShrunk = new Map<string, number>();
    for (const [key, items] of together) {
      const [a, b] = key.split('|');
      const la = solo(a, b);
      const lb = solo(b, a);
      let act = 0,
        exp = 0;
      for (const { a: ra, b: rb } of items) {
        const [x, y] = ra.seller === a ? [ra, rb] : [rb, ra];
        act += x.act / otherChem(x, b) + y.act / otherChem(y, a);
        exp += la * x.exp + lb * y.exp;
      }
      const l = safeDiv(act, exp, 1);
      nextRaw.set(key, l);
      nextShrunk.set(key, 1 + (l - 1) * (items.length / (items.length + PAIR_SHRINK)));
    }
    raw = nextRaw;
    shrunk = nextShrunk;
  }

  const out = new Map<string, PairStat>();
  for (const [key, items] of together) {
    const [a, b] = key.split('|');
    out.set(key, { a, b, coShifts: items.length, lift: raw.get(key) ?? 1, shrunkLift: shrunk.get(key) ?? 1 });
  }
  return out;
}

export function analyze(data: Dataset, from?: string, to?: string): Analysis {
  const baselines = computeBaselines(data, from, to);
  const profiles = computeProfiles(data, baselines, from, to);
  const pairs = computePairs(data, baselines, profiles, from, to);
  const atvs = [...baselines.values()].filter((b) => b.atv > 0);
  const chainAtv = atvs.length
    ? safeDiv(
        atvs.reduce((a, b) => a + b.atv * b.sellerHours, 0),
        atvs.reduce((a, b) => a + b.sellerHours, 0),
      )
    : 0;
  return { baselines, profiles, pairs, chainAtv };
}

/** strongest / weakest traits of a profile for display, e.g. ["חזקה בבישום", ...] */
export function topTraits(p: SellerProfile): { label: string; value: number }[] {
  const items: { label: string; value: number }[] = [
    { label: 'סיפתוח', value: p.openingIndex / p.salesIndex },
    { label: 'הגדלה', value: p.upsellIndex },
    { label: 'פריטים לעסקה', value: p.uptIndex },
    { label: 'סל ממוצע', value: p.atvIndex },
  ];
  if (p.conversionIndex != null) items.push({ label: 'המרה', value: p.conversionIndex });
  const labels: Record<Category, string> = { skincare: 'טיפוח', makeup: 'איפור', fragrance: 'בישום', hair: 'שיער', body: 'גוף' };
  for (const c of CATEGORIES) items.push({ label: labels[c], value: p.categoryIndex[c] / p.salesIndex });
  return items.sort((a, b) => b.value - a.value);
}
