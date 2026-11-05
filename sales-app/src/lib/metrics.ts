import type { Category, DailyTarget, Interaction, Sale, Shift, Store, UpsellType } from './types';
import { dateOf, hourOf, overlap, parseDateKey, dateKey, safeDiv, weekday } from './util';

/**
 * Share of a sale credited to a seller.
 * Shared sales (coSellerId) are split 50/50. Without sellerId → whole sale (store level).
 */
export function shareOf(sale: Sale, sellerId?: string): number {
  if (!sellerId) return 1;
  if (sale.sellerId === sellerId) return sale.coSellerId && sale.coSellerId !== sellerId ? 0.5 : 1;
  if (sale.coSellerId === sellerId) return 0.5;
  return 0;
}

export function involves(sale: Sale, sellerId: string): boolean {
  return sale.sellerId === sellerId || sale.coSellerId === sellerId;
}

export interface Kpis {
  /** net revenue: sales minus returns */
  revenue: number;
  grossRevenue: number;
  transactions: number;
  units: number;
  /** average transaction value */
  atv: number;
  /** units per transaction */
  upt: number;
  upsellRate: number;
  upsellCounts: Record<UpsellType, number>;
  clubSignups: number;
  returnsAmount: number;
  returnsCount: number;
  interactions: number;
  /** transactions / approaches, null when approaches are not tracked */
  conversion: number | null;
  /** hour of the first sale – only meaningful for a single day */
  firstSaleHour: number | null;
  /** average minutes from shift start to first sale, over shifts given */
  minutesToFirstSale: number | null;
  hours: number;
  salesPerHour: number;
  target: number;
  targetPct: number | null;
  categoryRevenue: Record<Category, number>;
}

export interface KpiInput {
  sales: Sale[];
  interactions?: Interaction[];
  shifts?: Shift[];
  sellerId?: string;
  /** override target (e.g. store daily target). Otherwise sum of shift targets. */
  target?: number;
  /** "now" for live shifts: hours are counted only up to now */
  now?: Date;
}

export function emptyCategoryRecord(): Record<Category, number> {
  return { skincare: 0, makeup: 0, fragrance: 0, hair: 0, body: 0 };
}

export function shiftHours(shift: Shift, now?: Date): number {
  if (now && shift.date === dateKey(now) && !shift.closed) {
    const h = now.getHours() + now.getMinutes() / 60;
    return Math.max(0, Math.min(shift.endHour, h) - shift.startHour);
  }
  return Math.max(0, shift.endHour - shift.startHour);
}

/** sales by a seller that fall inside a shift (same store, same day, within hours ± 15 min) */
export function salesInShift(shift: Shift, sales: Sale[]): Sale[] {
  return sales.filter(
    (s) =>
      involves(s, shift.sellerId) &&
      s.storeId === shift.storeId &&
      (s.shiftId === shift.id ||
        (dateOf(s.ts) === shift.date && hourOf(s.ts) >= shift.startHour - 0.25 && hourOf(s.ts) <= shift.endHour + 0.25)),
  );
}

/** hour of the first (non-return) sale of a seller in a shift */
export function firstSaleInShift(shift: Shift, sales: Sale[]): number | null {
  let first: number | null = null;
  for (const s of salesInShift(shift, sales)) {
    if (s.isReturn) continue;
    const h = hourOf(s.ts);
    if (first === null || h < first) first = h;
  }
  return first;
}

export function computeKpis({ sales, interactions = [], shifts = [], sellerId, target, now }: KpiInput): Kpis {
  const upsellCounts: Record<UpsellType, number> = { none: 0, upsell: 0, cross_sell: 0, add_on: 0 };
  const categoryRevenue = emptyCategoryRecord();
  let revenue = 0,
    gross = 0,
    tx = 0,
    units = 0,
    upsellW = 0,
    club = 0,
    retAmt = 0,
    retCnt = 0;
  let firstSaleHour: number | null = null;
  const days = new Set<string>();

  for (const s of sales) {
    const w = shareOf(s, sellerId);
    if (!w) continue;
    if (s.isReturn) {
      revenue -= s.amount * w;
      retAmt += s.amount * w;
      retCnt += w;
      continue;
    }
    revenue += s.amount * w;
    gross += s.amount * w;
    tx += w;
    units += s.units * w;
    upsellCounts[s.upsell] += w;
    if (s.upsell !== 'none') upsellW += w;
    if (s.clubSignup) club += w;
    const cats = s.categories.length ? s.categories : [];
    for (const c of cats) categoryRevenue[c] += (s.amount * w) / cats.length;
    days.add(dateOf(s.ts));
    const h = hourOf(s.ts);
    if (firstSaleHour === null || h < firstSaleHour) firstSaleHour = h;
  }

  const ints = sellerId ? interactions.filter((i) => i.sellerId === sellerId) : interactions;
  const myShifts = sellerId ? shifts.filter((sh) => sh.sellerId === sellerId) : shifts;
  const hours = myShifts.reduce((a, sh) => a + shiftHours(sh, now), 0);

  // time to first sale – per shift for sellers, per store-day for store level
  const waits: number[] = [];
  if (sellerId) {
    for (const sh of myShifts) {
      const f = firstSaleInShift(sh, sales);
      if (f !== null) waits.push(Math.max(0, (f - sh.startHour) * 60));
    }
  } else {
    const byDay = new Map<string, number>();
    for (const sh of myShifts) {
      const k = sh.storeId + '|' + sh.date;
      byDay.set(k, Math.min(byDay.get(k) ?? 99, sh.startHour));
    }
    const firstByDay = new Map<string, number>();
    for (const s of sales) {
      if (s.isReturn) continue;
      const k = s.storeId + '|' + dateOf(s.ts);
      const h = hourOf(s.ts);
      if (!firstByDay.has(k) || h < firstByDay.get(k)!) firstByDay.set(k, h);
    }
    for (const [k, start] of byDay) {
      const f = firstByDay.get(k);
      if (f !== undefined) waits.push(Math.max(0, (f - start) * 60));
    }
  }

  const tgt = target ?? myShifts.reduce((a, sh) => a + sh.target, 0);
  return {
    revenue,
    grossRevenue: gross,
    transactions: tx,
    units,
    atv: safeDiv(gross, tx),
    upt: safeDiv(units, tx),
    upsellRate: safeDiv(upsellW, tx),
    upsellCounts,
    clubSignups: club,
    returnsAmount: retAmt,
    returnsCount: retCnt,
    interactions: ints.length,
    conversion: ints.length ? Math.min(1, tx / ints.length) : null,
    firstSaleHour: days.size <= 1 ? firstSaleHour : null,
    minutesToFirstSale: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null,
    hours,
    salesPerHour: safeDiv(revenue, hours),
    target: tgt,
    targetPct: tgt ? revenue / tgt : null,
    categoryRevenue,
  };
}

/** net revenue per clock hour (index 0-23) */
export function revenueByHour(sales: Sale[], sellerId?: string): number[] {
  const out = new Array(24).fill(0);
  for (const s of sales) {
    const w = shareOf(s, sellerId);
    if (!w) continue;
    const h = Math.floor(hourOf(s.ts));
    out[h] += (s.isReturn ? -1 : 1) * s.amount * w;
  }
  return out;
}

/**
 * Personal target for a shift: the store's daily target split by the
 * share of staffed hours (optionally weighted by the store's hourly demand curve).
 */
export function personalTarget(
  dailyTarget: number,
  dayShifts: { startHour: number; endHour: number }[],
  mine: { startHour: number; endHour: number },
  hourWeights?: number[],
): number {
  const weightOf = (a: number, b: number) => {
    if (!hourWeights) return b - a;
    let w = 0;
    for (let h = Math.floor(a); h < Math.ceil(b); h++) w += overlap(h, h + 1, a, b) * (hourWeights[h] ?? 0);
    return w;
  };
  // each hour's demand is shared by the people on the floor in that hour
  if (hourWeights) {
    let my = 0;
    let total = 0;
    const all = [...dayShifts, mine];
    for (let h = 0; h < 24; h++) {
      const staff = all.reduce((a, s) => a + overlap(h, h + 1, s.startHour, s.endHour), 0);
      if (!staff) continue;
      const w = hourWeights[h] ?? 0;
      total += w;
      my += (w * overlap(h, h + 1, mine.startHour, mine.endHour)) / staff;
    }
    return Math.round(safeDiv(my, total) * dailyTarget);
  }
  const total = dayShifts.reduce((a, s) => a + weightOf(s.startHour, s.endHour), 0) + weightOf(mine.startHour, mine.endHour);
  return Math.round(safeDiv(weightOf(mine.startHour, mine.endHour), total) * dailyTarget);
}

/**
 * Break a monthly target into daily targets by weekday weight.
 * Weights = average historical revenue per weekday (closed days get 0).
 */
export function splitMonthlyTarget(
  monthTarget: number,
  year: number,
  month: number, // 0-based
  store: Store,
  history: Sale[],
): DailyTarget[] {
  const byDow = new Array(7).fill(0);
  const daysPerDow = new Array(7).fill(0);
  const seenDays = new Set<string>();
  for (const s of history) {
    if (s.storeId !== store.id) continue;
    const d = dateOf(s.ts);
    byDow[weekday(d)] += (s.isReturn ? -1 : 1) * s.amount;
    if (!seenDays.has(d)) {
      seenDays.add(d);
      daysPerDow[weekday(d)]++;
    }
  }
  const weights = byDow.map((r, i) => {
    if (!store.hours[i]) return 0;
    if (daysPerDow[i]) return r / daysPerDow[i];
    const h = store.hours[i]!;
    return h.close - h.open; // no history: hours open
  });
  const days: string[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    days.push(dateKey(d));
    d.setDate(d.getDate() + 1);
  }
  const total = days.reduce((a, k) => a + weights[parseDateKey(k).getDay()], 0);
  return days.map((k) => ({
    storeId: store.id,
    date: k,
    target: Math.round(safeDiv(weights[parseDateKey(k).getDay()], total) * monthTarget),
  }));
}

