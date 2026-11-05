import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DailyTarget, Dataset, Interaction, Recommendation, RecommendationStatus, Sale, Seller, Shift, Store } from './lib/types';
import type { DataStore } from './lib/store/types';
import { LocalStore } from './lib/store/localStore';
import { SupabaseStore } from './lib/store/supabaseStore';
import { analyze, type Analysis } from './lib/profiles';
import { addDays, dateKey } from './lib/util';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY_ = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function createDataStore(): DataStore {
  if (URL_ && KEY_) return new SupabaseStore(URL_, KEY_);
  return new LocalStore();
}

const ME_KEY = 'beauty-sales-me';

interface Ctx {
  store: DataStore;
  data: Dataset | null;
  error: string | null;
  me: Seller | null;
  setMeId: (id: string | null) => void;
  reload: () => Promise<void>;
  /** store-normalized profiles over the last 90 days (computed lazily, cached per data version) */
  getAnalysis: () => Analysis;
  addSale: (s: Omit<Sale, 'id'>) => Promise<Sale>;
  updateSale: (id: string, patch: Partial<Sale>) => Promise<void>;
  deleteSale: (id: string) => Promise<void>;
  addInteraction: (i: Omit<Interaction, 'id'>) => Promise<Interaction>;
  deleteInteraction: (id: string) => Promise<void>;
  upsertShift: (s: Shift) => Promise<Shift>;
  setTargets: (t: DailyTarget[]) => Promise<void>;
  saveRecommendation: (r: Recommendation) => Promise<void>;
  setRecommendationStatus: (id: string, status: RecommendationStatus) => Promise<void>;
  upsertSeller: (s: Seller) => Promise<Seller>;
  upsertStore: (s: Store) => Promise<Store>;
}

const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

/** convenience: today's key, refreshed every minute so live screens roll over at midnight */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function replaceById<T extends { id: string }>(xs: T[], x: T): T[] {
  const i = xs.findIndex((y) => y.id === x.id);
  if (i < 0) return [...xs, x];
  const out = xs.slice();
  out[i] = x;
  return out;
}

export function AppProvider({ children, dataStore }: { children: ReactNode; dataStore?: DataStore }) {
  const store = useMemo(() => dataStore ?? createDataStore(), [dataStore]);
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meId, setMeIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ME_KEY);
    } catch {
      return null;
    }
  });

  const reload = useCallback(async () => {
    try {
      setError(null);
      const d = await store.load();
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [store]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setMeId = useCallback((id: string | null) => {
    setMeIdState(id);
    try {
      if (id) localStorage.setItem(ME_KEY, id);
      else localStorage.removeItem(ME_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const me = useMemo(() => data?.sellers.find((s) => s.id === meId) ?? null, [data, meId]);

  // analysis cache keyed by data object identity
  const cache = useRef<{ data: Dataset | null; a: Analysis | null }>({ data: null, a: null });
  const getAnalysis = useCallback(() => {
    if (!data) throw new Error('no data');
    if (cache.current.data !== data || !cache.current.a) {
      const today = dateKey(new Date());
      cache.current = { data, a: analyze(data, addDays(today, -90), addDays(today, -1)) };
    }
    return cache.current.a!;
  }, [data]);

  const mutate = useCallback((f: (d: Dataset) => Dataset) => setData((d) => (d ? f(d) : d)), []);

  const value: Ctx = {
    store,
    data,
    error,
    me,
    setMeId,
    reload,
    getAnalysis,
    addSale: async (s) => {
      const saved = await store.addSale(s);
      mutate((d) => ({ ...d, sales: [...d.sales, saved] }));
      return saved;
    },
    updateSale: async (id, patch) => {
      await store.updateSale(id, patch);
      mutate((d) => ({ ...d, sales: d.sales.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    },
    deleteSale: async (id) => {
      await store.deleteSale(id);
      mutate((d) => ({ ...d, sales: d.sales.filter((s) => s.id !== id) }));
    },
    addInteraction: async (i) => {
      const saved = await store.addInteraction(i);
      mutate((d) => ({ ...d, interactions: [...d.interactions, saved] }));
      return saved;
    },
    deleteInteraction: async (id) => {
      await store.deleteInteraction(id);
      mutate((d) => ({ ...d, interactions: d.interactions.filter((i) => i.id !== id) }));
    },
    upsertShift: async (s) => {
      const saved = await store.upsertShift(s);
      mutate((d) => ({ ...d, shifts: replaceById(d.shifts, saved) }));
      return saved;
    },
    setTargets: async (t) => {
      await store.setDailyTargets(t);
      mutate((d) => {
        const m = new Map(d.targets.map((x) => [x.storeId + '|' + x.date, x]));
        for (const x of t) m.set(x.storeId + '|' + x.date, x);
        return { ...d, targets: [...m.values()] };
      });
    },
    saveRecommendation: async (r) => {
      await store.saveRecommendation(r);
      mutate((d) => ({ ...d, recommendations: replaceById(d.recommendations, r) }));
    },
    setRecommendationStatus: async (id, status) => {
      await store.setRecommendationStatus(id, status);
      mutate((d) => ({ ...d, recommendations: d.recommendations.map((r) => (r.id === id ? { ...r, status } : r)) }));
    },
    upsertSeller: async (s) => {
      const saved = await store.upsertSeller(s);
      mutate((d) => ({ ...d, sellers: replaceById(d.sellers, saved) }));
      return saved;
    },
    upsertStore: async (s) => {
      const saved = await store.upsertStore(s);
      mutate((d) => ({ ...d, stores: replaceById(d.stores, saved) }));
      return saved;
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** stores the signed-in person may look at */
export function visibleStores(data: Dataset, me: Seller): Store[] {
  if (me.role === 'admin') return data.stores;
  const region = me.regionId ?? data.stores.find((s) => s.id === me.storeId)?.regionId;
  if (me.role === 'area_manager') return data.stores.filter((s) => s.regionId === region);
  return data.stores.filter((s) => s.id === me.storeId);
}

export function regionOf(data: Dataset, me: Seller): string | null {
  return me.regionId ?? data.stores.find((s) => s.id === me.storeId)?.regionId ?? null;
}
