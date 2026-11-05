/**
 * Demo backend. History is generated deterministically on every load
 * (≈ 15k sales – too big for localStorage), and only what the user changes
 * is kept in localStorage as an overlay.
 */
import { generateDemoData } from '../demo';
import type { DailyTarget, Dataset, Interaction, Recommendation, RecommendationStatus, Sale, Seller, Shift, Store } from '../types';
import { uid } from '../util';
import type { DataStore } from './types';

const KEY = 'beauty-sales-demo-v1';

interface Overlay<T> {
  upserts: Record<string, T>;
  deletes: string[];
}
interface OverlayState {
  sales: Overlay<Sale>;
  interactions: Overlay<Interaction>;
  shifts: Overlay<Shift>;
  sellers: Overlay<Seller>;
  stores: Overlay<Store>;
  recommendations: Overlay<Recommendation>;
  targets: Record<string, DailyTarget>;
}

const empty = (): OverlayState => ({
  sales: { upserts: {}, deletes: [] },
  interactions: { upserts: {}, deletes: [] },
  shifts: { upserts: {}, deletes: [] },
  sellers: { upserts: {}, deletes: [] },
  stores: { upserts: {}, deletes: [] },
  recommendations: { upserts: {}, deletes: [] },
  targets: {},
});

function apply<T extends { id: string }>(base: T[], o: Overlay<T>): T[] {
  const del = new Set(o.deletes);
  const out = base.filter((x) => !del.has(x.id) && !o.upserts[x.id]);
  for (const v of Object.values(o.upserts)) if (!del.has(v.id)) out.push(v);
  return out;
}

export class LocalStore implements DataStore {
  readonly mode = 'demo' as const;
  private state: OverlayState = empty();
  private baseSales = new Map<string, Sale>();

  constructor(private now: () => Date = () => new Date()) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.state = { ...empty(), ...JSON.parse(raw) };
    } catch {
      this.state = empty();
    }
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* private mode / quota – the demo still works for this session */
    }
  }

  async load(): Promise<Dataset> {
    const { data } = generateDemoData({ now: this.now() });
    this.baseSales = new Map(data.sales.map((s) => [s.id, s]));
    const tmap = new Map(data.targets.map((t) => [t.storeId + '|' + t.date, t]));
    for (const [k, t] of Object.entries(this.state.targets)) tmap.set(k, t);
    return {
      regions: data.regions,
      stores: apply(data.stores, this.state.stores),
      sellers: apply(data.sellers, this.state.sellers),
      shifts: apply(data.shifts, this.state.shifts),
      sales: apply(data.sales, this.state.sales),
      interactions: apply(data.interactions, this.state.interactions),
      targets: [...tmap.values()],
      recommendations: apply(data.recommendations, this.state.recommendations),
    };
  }

  async addSale(sale: Omit<Sale, 'id'>): Promise<Sale> {
    const s = { ...sale, id: uid() };
    this.state.sales.upserts[s.id] = s;
    this.save();
    return s;
  }
  async updateSale(id: string, patch: Partial<Sale>): Promise<void> {
    const cur = this.state.sales.upserts[id] ?? this.baseSales.get(id);
    if (!cur) return;
    this.state.sales.upserts[id] = { ...cur, ...patch, id };
    this.save();
  }
  async deleteSale(id: string): Promise<void> {
    delete this.state.sales.upserts[id];
    this.state.sales.deletes.push(id);
    this.save();
  }
  async addInteraction(i: Omit<Interaction, 'id'>): Promise<Interaction> {
    const x = { ...i, id: uid() };
    this.state.interactions.upserts[x.id] = x;
    this.save();
    return x;
  }
  async deleteInteraction(id: string): Promise<void> {
    delete this.state.interactions.upserts[id];
    this.state.interactions.deletes.push(id);
    this.save();
  }
  async upsertShift(shift: Shift): Promise<Shift> {
    this.state.shifts.upserts[shift.id] = shift;
    this.save();
    return shift;
  }
  async setDailyTargets(targets: DailyTarget[]): Promise<void> {
    for (const t of targets) this.state.targets[t.storeId + '|' + t.date] = t;
    this.save();
  }
  async saveRecommendation(rec: Recommendation): Promise<void> {
    this.state.recommendations.upserts[rec.id] = rec;
    this.save();
  }
  async setRecommendationStatus(id: string, status: RecommendationStatus): Promise<void> {
    const cur = this.state.recommendations.upserts[id];
    if (cur) this.state.recommendations.upserts[id] = { ...cur, status };
    this.save();
  }
  async upsertSeller(seller: Seller): Promise<Seller> {
    this.state.sellers.upserts[seller.id] = seller;
    this.save();
    return seller;
  }
  async upsertStore(store: Store): Promise<Store> {
    this.state.stores.upserts[store.id] = store;
    this.save();
    return store;
  }
  async reset(): Promise<void> {
    this.state = empty();
    this.save();
  }
}
