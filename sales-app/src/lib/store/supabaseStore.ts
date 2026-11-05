/**
 * Supabase backend. Row-level security (supabase/migrations/001_schema.sql)
 * decides what each role can read and write; this class only maps rows.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  DailyTarget,
  Dataset,
  Interaction,
  Recommendation,
  RecommendationStatus,
  Region,
  Sale,
  Seller,
  Shift,
  Store,
} from '../types';
import { addDays, dateKey } from '../util';
import type { DataStore } from './types';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown) => (v == null ? 0 : Number(v));

const toStore = (r: Row): Store => ({
  id: r.id,
  name: r.name,
  regionId: r.region_id,
  hours: r.hours,
  lat: r.lat,
  lng: r.lng,
  headcount: r.headcount,
});
const fromStore = (s: Store): Row => ({
  id: s.id,
  name: s.name,
  region_id: s.regionId,
  hours: s.hours,
  lat: s.lat,
  lng: s.lng,
  headcount: s.headcount,
});
const toSeller = (r: Row): Seller => ({
  id: r.id,
  name: r.name,
  role: r.role,
  storeId: r.store_id,
  regionId: r.region_id,
  isBrandPromoter: r.is_brand_promoter,
  brand: r.brand,
  availability: r.availability ?? [],
  shiftsPerWeek: r.shifts_per_week,
  homeLat: r.home_lat,
  homeLng: r.home_lng,
  active: r.active,
  email: r.email,
});
const fromSeller = (s: Seller): Row => ({
  id: s.id,
  name: s.name,
  role: s.role,
  store_id: s.storeId,
  region_id: s.regionId,
  is_brand_promoter: s.isBrandPromoter,
  brand: s.brand,
  availability: s.availability,
  shifts_per_week: s.shiftsPerWeek,
  home_lat: s.homeLat,
  home_lng: s.homeLng,
  active: s.active,
  email: s.email ?? null,
});
const toShift = (r: Row): Shift => ({
  id: r.id,
  sellerId: r.seller_id,
  storeId: r.store_id,
  date: r.date,
  startHour: num(r.start_hour),
  endHour: num(r.end_hour),
  target: num(r.target),
  closed: r.closed,
});
const fromShift = (s: Shift): Row => ({
  id: s.id,
  seller_id: s.sellerId,
  store_id: s.storeId,
  date: s.date,
  start_hour: s.startHour,
  end_hour: s.endHour,
  target: s.target,
  closed: s.closed,
});
const toSale = (r: Row): Sale => ({
  id: r.id,
  sellerId: r.seller_id,
  coSellerId: r.co_seller_id,
  storeId: r.store_id,
  shiftId: r.shift_id,
  ts: r.ts,
  amount: num(r.amount),
  units: r.units,
  categories: r.categories ?? [],
  upsell: r.upsell,
  clubSignup: r.club_signup,
  isReturn: r.is_return,
});
const fromSale = (s: Partial<Sale>): Row => {
  const out: Row = {};
  if (s.sellerId !== undefined) out.seller_id = s.sellerId;
  if (s.coSellerId !== undefined) out.co_seller_id = s.coSellerId;
  if (s.storeId !== undefined) out.store_id = s.storeId;
  if (s.shiftId !== undefined) out.shift_id = s.shiftId;
  if (s.ts !== undefined) out.ts = s.ts;
  if (s.amount !== undefined) out.amount = s.amount;
  if (s.units !== undefined) out.units = s.units;
  if (s.categories !== undefined) out.categories = s.categories;
  if (s.upsell !== undefined) out.upsell = s.upsell;
  if (s.clubSignup !== undefined) out.club_signup = s.clubSignup;
  if (s.isReturn !== undefined) out.is_return = s.isReturn;
  return out;
};
const toRec = (r: Row): Recommendation => ({
  id: r.id,
  kind: r.kind,
  createdAt: r.created_at,
  createdBy: r.created_by,
  title: r.title,
  explanation: r.explanation,
  score: num(r.score),
  status: r.status,
  payload: r.payload ?? {},
});

export class SupabaseStore implements DataStore {
  readonly mode = 'supabase' as const;
  readonly client: SupabaseClient;

  constructor(url: string, anonKey: string, private historyDays = 120) {
    this.client = createClient(url, anonKey);
  }

  /** Supabase returns max 1000 rows per request – page through. */
  private async all(table: string, filter?: (q: any) => any): Promise<Row[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: Row[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      let q = this.client.from(table).select('*');
      if (filter) q = filter(q);
      const { data, error } = await q.range(from, from + page - 1);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < page) break;
    }
    return out;
  }

  async load(): Promise<Dataset> {
    const since = addDays(dateKey(new Date()), -this.historyDays);
    const sinceTs = new Date(since + 'T00:00:00').toISOString();
    const [regions, stores, profiles, shifts, sales, interactions, targets, recs] = await Promise.all([
      this.all('regions'),
      this.all('stores'),
      this.all('profiles'),
      this.all('shifts', (q) => q.gte('date', since)),
      this.all('sales', (q) => q.gte('ts', sinceTs)),
      this.all('interactions', (q) => q.gte('ts', sinceTs)),
      this.all('daily_targets', (q) => q.gte('date', since)),
      this.all('recommendations'),
    ]);
    return {
      regions: regions.map((r) => ({ id: r.id, name: r.name }) as Region),
      stores: stores.map(toStore),
      sellers: profiles.map(toSeller),
      shifts: shifts.map(toShift),
      sales: sales.map(toSale),
      interactions: interactions.map((r) => ({ id: r.id, sellerId: r.seller_id, storeId: r.store_id, ts: r.ts })),
      targets: targets.map((r) => ({ storeId: r.store_id, date: r.date, target: num(r.target) })),
      recommendations: recs.map(toRec),
    };
  }

  private async one(table: string, row: Row, upsert = false): Promise<Row> {
    const q = upsert ? this.client.from(table).upsert(row) : this.client.from(table).insert(row);
    const { data, error } = await q.select().single();
    if (error) throw error;
    return data as Row;
  }

  async addSale(sale: Omit<Sale, 'id'>): Promise<Sale> {
    return toSale(await this.one('sales', fromSale(sale)));
  }
  async updateSale(id: string, patch: Partial<Sale>): Promise<void> {
    const { error } = await this.client.from('sales').update(fromSale(patch)).eq('id', id);
    if (error) throw error;
  }
  async deleteSale(id: string): Promise<void> {
    const { error } = await this.client.from('sales').delete().eq('id', id);
    if (error) throw error;
  }
  async addInteraction(i: Omit<Interaction, 'id'>): Promise<Interaction> {
    const r = await this.one('interactions', { seller_id: i.sellerId, store_id: i.storeId, ts: i.ts });
    return { id: r.id, sellerId: r.seller_id, storeId: r.store_id, ts: r.ts };
  }
  async deleteInteraction(id: string): Promise<void> {
    const { error } = await this.client.from('interactions').delete().eq('id', id);
    if (error) throw error;
  }
  async upsertShift(shift: Shift): Promise<Shift> {
    return toShift(await this.one('shifts', fromShift(shift), true));
  }
  async setDailyTargets(targets: DailyTarget[]): Promise<void> {
    if (!targets.length) return;
    const { error } = await this.client
      .from('daily_targets')
      .upsert(targets.map((t) => ({ store_id: t.storeId, date: t.date, target: t.target })));
    if (error) throw error;
  }
  async saveRecommendation(rec: Recommendation): Promise<void> {
    const regionId = (rec.payload.regionId as string | undefined) ?? null;
    const { error } = await this.client.from('recommendations').upsert({
      id: rec.id,
      kind: rec.kind,
      region_id: regionId,
      created_by: rec.createdBy,
      title: rec.title,
      explanation: rec.explanation,
      score: rec.score,
      status: rec.status,
      payload: rec.payload,
    });
    if (error) throw error;
  }
  async setRecommendationStatus(id: string, status: RecommendationStatus): Promise<void> {
    const { error } = await this.client.from('recommendations').update({ status }).eq('id', id);
    if (error) throw error;
  }
  async upsertSeller(seller: Seller): Promise<Seller> {
    return toSeller(await this.one('profiles', fromSeller(seller), true));
  }
  async upsertStore(store: Store): Promise<Store> {
    return toStore(await this.one('stores', fromStore(store), true));
  }

  // ── auth: e-mail one-time code ──
  async sendCode(email: string) {
    const { error } = await this.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw error;
  }
  async verifyCode(email: string, token: string) {
    const { error } = await this.client.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw error;
  }
  async currentProfileId(): Promise<string | null> {
    const { data } = await this.client.auth.getUser();
    if (!data.user) return null;
    const { data: p } = await this.client.from('profiles').select('id').eq('auth_user_id', data.user.id).maybeSingle();
    return (p?.id as string) ?? null;
  }
  async signOut() {
    await this.client.auth.signOut();
  }
}
