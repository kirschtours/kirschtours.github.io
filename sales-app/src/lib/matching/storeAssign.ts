/**
 * Store assignment – which home store fits each seller best.
 *
 * predicted index of seller i in store s =
 *     0.5 × Σ_c  categoryMix_s[c] × categoryIndex_i[c]      (does she sell what this store sells?)
 *   + 0.3 × Σ_p  dayPartLoad_s[p] × dayPartIndex_i[p]       (is she strong when this store is busy?)
 *   + 0.2 × basket fit × salesIndex_i                       (premium stores reward ATV, volume stores reward UPT)
 *
 * weekly value = chain-average revenue per seller-hour × her weekly hours × predicted index − commute cost.
 * (A chain-average rate, not each store's own rate: otherwise the model just "sorts" the strongest
 * sellers into the busiest stores. We want moves that are justified by fit.)
 * Head-count per store stays as it is today; the Hungarian algorithm finds the
 * value-maximizing assignment. A small "stay" bonus avoids moving people for marginal gains.
 */
import type { Seller, Store } from '../types';
import { CATEGORIES, CATEGORY_LABEL, DAY_PARTS, DAY_PART_LABEL } from '../types';
import type { Analysis, SellerProfile, StoreBaseline } from '../profiles';
import { clamp, distanceKm } from '../util';
import { hungarian } from './hungarian';

export interface StoreAssignOptions {
  sellers: Seller[];
  stores: Store[];
  analysis: Analysis;
  /** ₪ per km one way, per shift */
  travelCostPerKm?: number;
  /** keep current store unless gain exceeds this share (default 8%) – moving people has a real cost */
  stayBonus?: number;
}

export interface StoreMove {
  sellerId: string;
  fromStoreId: string;
  toStoreId: string;
  currentValue: number;
  newValue: number;
  gain: number;
  reasons: string[];
}

export interface StoreAssignResult {
  assignment: Map<string, string>;
  moves: StoreMove[];
  currentTotal: number;
  newTotal: number;
}

export function predictedIndex(p: SellerProfile, b: StoreBaseline, chainAtv: number): number {
  let cat = 0;
  for (const c of CATEGORIES) cat += b.categoryMix[c] * p.categoryIndex[c];
  let part = 0;
  for (const d of DAY_PARTS) part += b.dayPartLoad[d] * p.dayPartIndex[d];
  const atvWeight = clamp(chainAtv ? b.atv / chainAtv - 0.5 : 0.5, 0, 1);
  const basket = (atvWeight * p.atvIndex + (1 - atvWeight) * p.uptIndex) * p.salesIndex;
  const raw = 0.5 * cat + 0.3 * part + 0.2 * basket;
  // thin profiles: stay close to the store average
  return 1 + (raw - 1) * Math.max(p.confidence, 0.15);
}

export function weeklyValue(
  seller: Seller,
  p: SellerProfile,
  store: Store,
  b: StoreBaseline,
  chainAtv: number,
  travelCostPerKm: number,
  homeStore: Store | undefined,
  rate: number,
): number {
  const hours = seller.shiftsPerWeek * b.avgShiftHours;
  const lat = seller.homeLat ?? homeStore?.lat;
  const lng = seller.homeLng ?? homeStore?.lng;
  const km = lat != null && lng != null ? distanceKm(lat, lng, store.lat, store.lng) : 0;
  return rate * hours * predictedIndex(p, b, chainAtv) - km * 2 * travelCostPerKm * seller.shiftsPerWeek;
}

export function explainMove(p: SellerProfile, from: StoreBaseline, to: StoreBaseline, toName: string): string[] {
  const reasons: string[] = [];
  const cats = [...CATEGORIES]
    .map((c) => ({ c, d: (to.categoryMix[c] - from.categoryMix[c]) * (p.categoryIndex[c] - p.salesIndex) }))
    .sort((a, b) => b.d - a.d);
  const best = cats[0];
  if (best && best.d > 0.002)
    reasons.push(
      `${CATEGORY_LABEL[best.c]} הוא ${Math.round(to.categoryMix[best.c] * 100)}% מהמכירות ב${toName} (לעומת ${Math.round(from.categoryMix[best.c] * 100)}%), ובקטגוריה הזו היא חזקה (${p.categoryIndex[best.c].toFixed(2)})`,
    );
  const parts = [...DAY_PARTS]
    .map((d) => ({ d, v: (to.dayPartLoad[d] - from.dayPartLoad[d]) * (p.dayPartIndex[d] - p.salesIndex) }))
    .sort((a, b) => b.v - a.v);
  if (parts[0] && parts[0].v > 0.002)
    reasons.push(`העומס ב${toName} נופל על ה${DAY_PART_LABEL[parts[0].d]}, השעות החזקות שלה`);
  return reasons;
}

export function assignStores(opts: StoreAssignOptions): StoreAssignResult {
  const travel = opts.travelCostPerKm ?? 1.5;
  const stay = opts.stayBonus ?? 0.08;
  const storesById = new Map(opts.stores.map((s) => [s.id, s]));
  // brand promoters are placed by the brand, managers stay with their store
  const movable = opts.sellers.filter(
    (s) =>
      s.active &&
      !s.isBrandPromoter &&
      s.storeId &&
      storesById.has(s.storeId) &&
      (s.role === 'seller' || s.role === 'shift_lead') &&
      opts.analysis.profiles.get(s.id)?.eligible,
  );
  // capacity = today's head-count of movable sellers in each store
  const columns: Store[] = [];
  for (const st of opts.stores) for (const s of movable) if (s.storeId === st.id) columns.push(st);

  let rn = 0,
    rd = 0;
  for (const st of opts.stores) {
    const b = opts.analysis.baselines.get(st.id);
    if (!b) continue;
    rn += b.revenuePerSellerHour * b.sellerHours;
    rd += b.sellerHours;
  }
  const rate = rd ? rn / rd : 0;
  const value = (s: Seller, st: Store) => {
    const p = opts.analysis.profiles.get(s.id)!;
    const b = opts.analysis.baselines.get(st.id)!;
    const v = weeklyValue(s, p, st, b, opts.analysis.chainAtv, travel, storesById.get(s.storeId!), rate);
    return s.storeId === st.id ? v * (1 + stay) : v;
  };
  const cost = movable.map((s) => columns.map((st) => -value(s, st)));
  const cols = hungarian(cost);

  const assignment = new Map<string, string>();
  const moves: StoreMove[] = [];
  let currentTotal = 0;
  let newTotal = 0;
  movable.forEach((s, i) => {
    const to = columns[cols[i]];
    const p = opts.analysis.profiles.get(s.id)!;
    const from = storesById.get(s.storeId!)!;
    const fb = opts.analysis.baselines.get(from.id)!;
    const tb = opts.analysis.baselines.get(to.id)!;
    const cur = weeklyValue(s, p, from, fb, opts.analysis.chainAtv, travel, from, rate);
    const nv = weeklyValue(s, p, to, tb, opts.analysis.chainAtv, travel, from, rate);
    currentTotal += cur;
    newTotal += nv;
    assignment.set(s.id, to.id);
    if (to.id !== from.id)
      moves.push({
        sellerId: s.id,
        fromStoreId: from.id,
        toStoreId: to.id,
        currentValue: cur,
        newValue: nv,
        gain: nv - cur,
        reasons: explainMove(p, fb, tb, to.name),
      });
  });
  moves.sort((a, b) => b.gain - a.gain);
  return { assignment, moves, currentTotal, newTotal };
}
