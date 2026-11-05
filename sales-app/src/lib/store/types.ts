import type { DailyTarget, Dataset, Interaction, Recommendation, RecommendationStatus, Sale, Seller, Shift, Store } from '../types';

/** Everything the UI needs from a backend. Two implementations: demo (browser) and Supabase. */
export interface DataStore {
  readonly mode: 'demo' | 'supabase';
  load(): Promise<Dataset>;

  addSale(sale: Omit<Sale, 'id'>): Promise<Sale>;
  updateSale(id: string, patch: Partial<Sale>): Promise<void>;
  deleteSale(id: string): Promise<void>;

  addInteraction(i: Omit<Interaction, 'id'>): Promise<Interaction>;
  deleteInteraction(id: string): Promise<void>;

  upsertShift(shift: Shift): Promise<Shift>;
  setDailyTargets(targets: DailyTarget[]): Promise<void>;

  saveRecommendation(rec: Recommendation): Promise<void>;
  setRecommendationStatus(id: string, status: RecommendationStatus): Promise<void>;

  upsertSeller(seller: Seller): Promise<Seller>;
  upsertStore(store: Store): Promise<Store>;

  /** demo only */
  reset?(): Promise<void>;
}

export interface Session {
  userId: string;
}
