/**
 * Deterministic demo data: 2 regions, 6 stores, 12 people per store, ~90 days.
 * Every seller has hidden traits (overall ability, opening skill, upsell,
 * category strengths…). The analytics never see these traits – tests use them
 * to check that profiles and recommendations recover the truth.
 *
 * Planted stories (for the demo and the tests):
 *  - "נועה" sits in Raanana (skincare-heavy) but is a fragrance star,
 *    "מיכל" sits in Azrieli (fragrance-heavy) but is a skincare star → store swap.
 *  - "שירן" + "ליאור" in Ayalon sell ~35% more when they work together → pairing.
 *  - "רותם" in Rishon is a very weak opener → mentoring with a strong opener.
 */
import type { Category, Dataset, DailyTarget, Interaction, Region, Role, Sale, Seller, Shift, Store, UpsellType } from './types';
import { CATEGORIES } from './types';
import { addDays, dateKey, groupBy, overlap, rng, tsAt, weekday } from './util';

export interface Traits {
  ability: number;
  opening: number;
  upsell: number;
  atv: number;
  upt: number;
  category: Record<Category, number>;
  dayPart: { morning: number; noon: number; evening: number };
}

interface StoreSpec {
  id: string;
  name: string;
  regionId: string;
  lat: number;
  lng: number;
  mix: Record<Category, number>;
  atv: number;
  upt: number;
  traffic: number; // approaches per seller-hour at peak
  /** relative footfall by day part */
  curve: { morning: number; noon: number; evening: number };
  conv: number;
}

const REGIONS: Region[] = [
  { id: 'r-center', name: 'מרכז' },
  { id: 'r-north', name: 'צפון' },
];

const STORE_SPECS: StoreSpec[] = [
  { id: 's-azrieli', name: 'תל אביב – עזריאלי', regionId: 'r-center', lat: 32.0745, lng: 34.7918, mix: { skincare: 0.2, makeup: 0.2, fragrance: 0.42, hair: 0.08, body: 0.1 }, atv: 260, upt: 1.7, traffic: 3.2, curve: { morning: 0.7, noon: 1, evening: 1.35 }, conv: 0.34 },
  { id: 's-ayalon', name: 'רמת גן – איילון', regionId: 'r-center', lat: 32.0997, lng: 34.8268, mix: { skincare: 0.18, makeup: 0.42, fragrance: 0.2, hair: 0.1, body: 0.1 }, atv: 175, upt: 2.1, traffic: 3.4, curve: { morning: 0.65, noon: 1, evening: 1.4 }, conv: 0.36 },
  { id: 's-raanana', name: 'רעננה – רננים', regionId: 'r-center', lat: 32.1817, lng: 34.8706, mix: { skincare: 0.45, makeup: 0.15, fragrance: 0.15, hair: 0.12, body: 0.13 }, atv: 230, upt: 1.9, traffic: 2.6, curve: { morning: 1.3, noon: 1.1, evening: 0.75 }, conv: 0.38 },
  { id: 's-rishon', name: 'ראשון לציון – הזהב', regionId: 'r-center', lat: 31.99, lng: 34.7745, mix: { skincare: 0.24, makeup: 0.24, fragrance: 0.22, hair: 0.15, body: 0.15 }, atv: 190, upt: 2.0, traffic: 2.9, curve: { morning: 0.9, noon: 1.15, evening: 1 }, conv: 0.35 },
  { id: 's-grand', name: 'חיפה – גרנד קניון', regionId: 'r-north', lat: 32.7895, lng: 35.0075, mix: { skincare: 0.22, makeup: 0.2, fragrance: 0.3, hair: 0.1, body: 0.18 }, atv: 210, upt: 1.9, traffic: 2.8, curve: { morning: 0.8, noon: 1, evening: 1.25 }, conv: 0.35 },
  { id: 's-krayot', name: 'קריות – ביג', regionId: 'r-north', lat: 32.8355, lng: 35.0867, mix: { skincare: 0.18, makeup: 0.18, fragrance: 0.14, hair: 0.25, body: 0.25 }, atv: 140, upt: 2.5, traffic: 3, curve: { morning: 0.95, noon: 1.1, evening: 1 }, conv: 0.4 },
];

const PRICE: Record<Category, number> = { skincare: 1.1, makeup: 0.75, fragrance: 1.45, hair: 0.6, body: 0.55 };

const FIRST_NAMES = [
  'דנה', 'יעל', 'מאיה', 'נועה', 'מיכל', 'שירן', 'ליאור', 'רותם', 'הילה', 'אורית', 'קרן', 'עדי',
  'טל', 'שני', 'רוני', 'ענבל', 'גלית', 'סיון', 'אביטל', 'מור', 'הדס', 'לינוי', 'אושרת', 'חן',
  'ספיר', 'אלה', 'נגה', 'רעות', 'שקד', 'ליה', 'אגם', 'עומר', 'בר', 'דורית', 'מירב', 'אפרת',
  'לימור', 'שרון', 'אילנה', 'ורד', 'אסנת', 'פזית', 'זיו', 'תמר', 'נטע', 'רינת', 'שלומית', 'כנרת',
  'מעיין', 'יובל', 'אנה', 'סופיה', 'רחל', 'לאה', 'אורלי', 'גאיה', 'דקלה', 'יסמין', 'נוי', 'שחר',
  'ריטה', 'ויקי', 'עינב', 'אלינור', 'ליבי', 'מאי', 'אור', 'אביגיל', 'הודיה', 'צליל', 'רוית', 'מלכה',
];
const LAST_INITIALS = ['א.', 'ב.', 'ג.', 'ד.', 'ה.', 'ו.', 'ז.', 'ח.', 'כ.', 'ל.', 'מ.', 'נ.', 'ס.', 'ע.', 'פ.', 'צ.', 'ק.', 'ר.', 'ש.', 'ת.'];
const BRANDS = ['Lumière Paris', 'Verde Skin'];

export const DEMO_SELLER_ID = 'u-azrieli-0'; // the seller you log in as in demo mode
export const PERSONA = {
  noa: 'u-raanana-3',
  michal: 'u-azrieli-4',
  shiran: 'u-ayalon-5',
  lior: 'u-ayalon-6',
  rotem: 'u-rishon-7',
};

function normal(r: () => number, mean: number, sd: number): number {
  const u = Math.max(1e-9, r());
  const v = r();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poisson(r: () => number, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}

function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

function pickWeighted<T extends string>(r: () => number, w: Record<T, number>): T {
  const keys = Object.keys(w) as T[];
  const total = keys.reduce((a, k) => a + w[k], 0);
  let x = r() * total;
  for (const k of keys) {
    x -= w[k];
    if (x <= 0) return k;
  }
  return keys[keys.length - 1];
}

function storeHours(spec: StoreSpec): Store['hours'] {
  const weekdayHours = spec.id === 's-raanana' ? { open: 9, close: 21 } : { open: 10, close: 22 };
  return [weekdayHours, weekdayHours, weekdayHours, weekdayHours, weekdayHours, { open: 9, close: 15 }, null];
}

export interface DemoOutput {
  data: Dataset;
  traits: Map<string, Traits>;
  synergy: Map<string, number>;
}

export function generateDemoData(opts: { seed?: number; days?: number; now?: Date } = {}): DemoOutput {
  const seed = opts.seed ?? 42;
  const days = opts.days ?? 90;
  const now = opts.now ?? new Date();
  const today = dateKey(now);
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const r = rng(seed);

  const stores: Store[] = STORE_SPECS.map((s) => ({
    id: s.id,
    name: s.name,
    regionId: s.regionId,
    lat: s.lat,
    lng: s.lng,
    hours: storeHours(s),
    headcount: 3,
  }));
  const specById = new Map(STORE_SPECS.map((s) => [s.id, s]));

  // ---- people ----
  const sellers: Seller[] = [];
  const traits = new Map<string, Traits>();
  let nameIdx = 0;
  for (const st of STORE_SPECS) {
    const key = st.id.slice(2);
    for (let i = 0; i < 12; i++) {
      const id = `u-${key}-${i}`;
      const role: Role = i === 1 ? 'store_manager' : i === 2 || i === 8 ? 'shift_lead' : 'seller';
      const promoter = i === 10 || (i === 11 && r() < 0.5);
      const name = `${FIRST_NAMES[nameIdx++ % FIRST_NAMES.length]} ${pick(r, LAST_INITIALS)}`;
      const allDays = [0, 1, 2, 3, 4, 5];
      const off = Math.floor(r() * 6);
      const availability = i < 3 ? allDays : allDays.filter((d) => d !== off);
      sellers.push({
        id,
        name,
        role,
        storeId: st.id,
        regionId: st.regionId,
        isBrandPromoter: promoter,
        brand: promoter ? BRANDS[i % 2] : null,
        availability,
        shiftsPerWeek: i < 3 ? 5 : 3 + Math.floor(r() * 3),
        homeLat: st.lat + normal(r, 0, 0.03),
        homeLng: st.lng + normal(r, 0, 0.03),
        active: true,
        email: null,
      });
      const cat = {} as Record<Category, number>;
      for (const c of CATEGORIES) cat[c] = Math.max(0.5, normal(r, 1, 0.12));
      const spec = pick(r, [...CATEGORIES]);
      cat[spec] *= 1.25;
      traits.set(id, {
        ability: Math.max(0.6, normal(r, 1, 0.12)),
        opening: Math.max(0.4, normal(r, 1, 0.22)),
        upsell: Math.max(0.3, normal(r, 1, 0.3)),
        atv: Math.max(0.7, normal(r, 1, 0.1)),
        upt: Math.max(0.7, normal(r, 1, 0.1)),
        category: cat,
        dayPart: { morning: normal(r, 1, 0.06), noon: normal(r, 1, 0.06), evening: normal(r, 1, 0.06) },
      });
    }
  }
  const named = (id: string, name: string) => {
    const s = sellers.find((x) => x.id === id)!;
    s.name = name;
    s.isBrandPromoter = false;
    s.brand = null;
    s.role = 'seller';
    s.availability = [0, 1, 2, 3, 4, 5];
    s.shiftsPerWeek = 4;
    return traits.get(id)!;
  };
  const flat = (): Record<Category, number> => ({ skincare: 1, makeup: 1, fragrance: 1, hair: 1, body: 1 });
  const even = { morning: 1, noon: 1, evening: 1 };
  Object.assign(named(PERSONA.noa, 'נועה כ.'), { ability: 1.1, opening: 1, dayPart: even, category: { ...flat(), fragrance: 2.2, skincare: 0.8 } });
  Object.assign(named(PERSONA.michal, 'מיכל ש.'), { ability: 1.1, opening: 1.3, dayPart: even, category: { ...flat(), skincare: 2.2, fragrance: 0.8 } });
  for (const id of [PERSONA.noa, PERSONA.michal]) sellers.find((s) => s.id === id)!.shiftsPerWeek = 5;
  Object.assign(named(PERSONA.shiran, 'שירן ל.'), { ability: 1 });
  Object.assign(named(PERSONA.lior, 'ליאור מ.'), { ability: 1 });
  Object.assign(named(PERSONA.rotem, 'רותם ב.'), { ability: 1, opening: 0.35 });
  const demo = sellers.find((s) => s.id === DEMO_SELLER_ID)!;
  demo.name = 'דנה ק.';
  demo.isBrandPromoter = false;
  demo.brand = null;

  // HQ + area managers (not on the floor)
  sellers.push(
    { id: 'u-admin', name: 'אורנה (הנהלה)', role: 'admin', storeId: null, regionId: null, isBrandPromoter: false, brand: null, availability: [], shiftsPerWeek: 0, homeLat: null, homeLng: null, active: true },
    { id: 'u-area-center', name: 'גלי (אזור מרכז)', role: 'area_manager', storeId: null, regionId: 'r-center', isBrandPromoter: false, brand: null, availability: [], shiftsPerWeek: 0, homeLat: null, homeLng: null, active: true },
    { id: 'u-area-north', name: 'שושי (אזור צפון)', role: 'area_manager', storeId: null, regionId: 'r-north', isBrandPromoter: false, brand: null, availability: [], shiftsPerWeek: 0, homeLat: null, homeLng: null, active: true },
  );

  const synergy = new Map<string, number>([[[PERSONA.lior, PERSONA.shiran].sort().join('|'), 1.35]]);
  const pairBoost = (a: string, others: string[]) => {
    let m = 1;
    for (const o of others) m *= synergy.get([a, o].sort().join('|')) ?? 1;
    return m;
  };

  // ---- simulate ----
  const shifts: Shift[] = [];
  const sales: Sale[] = [];
  const interactions: Interaction[] = [];
  const startDay = addDays(today, -days);
  let n = 0;
  const id = (p: string) => `${p}-${(n++).toString(36)}`;

  for (const st of stores) {
    const spec = specById.get(st.id)!;
    const staff = sellers.filter((s) => s.storeId === st.id);
    // make the pairing story observable: Shiran & Lior often share the evening
    const weekCount = new Map<string, number>();
    for (let d = 0; d <= days; d++) {
      const date = addDays(startDay, d);
      const dow = weekday(date);
      if (dow === 0) weekCount.clear();
      const h = st.hours[dow];
      if (!h) continue;
      const len = h.close - h.open;
      const slots = len <= 7 ? [{ s: h.open, e: h.close, n: 3 }] : [
        { s: h.open, e: h.open + len / 2, n: 2 + (dow === 4 ? 1 : 0) },
        { s: h.open + len / 2, e: h.close, n: 3 + (dow === 4 ? 1 : 0) },
      ];
      // independent random stream per store-day: changing one persona doesn't reshuffle the whole history
      const r = rng(seed * 1000003 + d * 7919 + stores.indexOf(st) * 104729);
      const usedToday = new Set<string>();
      const dayShifts: Shift[] = [];
      for (const [si, slot] of slots.entries()) {
        const avail = staff.filter(
          (s) => s.availability.includes(dow) && !usedToday.has(s.id) && (weekCount.get(s.id) ?? 0) < s.shiftsPerWeek,
        );
        // shuffle, leads first so each slot has one
        const shuffled = avail.map((s) => ({ s, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.s);
        const leads = shuffled.filter((s) => s.role !== 'seller');
        const team: Seller[] = [];
        if (leads.length) team.push(leads[0]);
        if (st.id === 's-ayalon' && si === 1 && r() < 0.45) {
          for (const pid of [PERSONA.shiran, PERSONA.lior]) {
            const p = shuffled.find((s) => s.id === pid);
            if (p && !team.includes(p)) team.push(p);
          }
        }
        for (const s of shuffled) {
          if (team.length >= slot.n) break;
          if (!team.includes(s)) team.push(s);
        }
        // the demo persona has no shift today, so the demo starts with "open shift"
        const finalTeam = date === today ? team.filter((s) => s.id !== DEMO_SELLER_ID) : team;
        for (const s of finalTeam) {
          usedToday.add(s.id);
          weekCount.set(s.id, (weekCount.get(s.id) ?? 0) + 1);
          dayShifts.push({
            id: id('sh'),
            sellerId: s.id,
            storeId: st.id,
            date,
            startHour: slot.s,
            endHour: slot.e,
            target: 0,
            closed: date < today,
          });
        }
      }
      shifts.push(...dayShifts);

      // hour by hour
      for (let hour = Math.floor(h.open); hour < Math.ceil(h.close); hour++) {
        if (date === today && hour >= nowHour) break;
        const onFloor = dayShifts.filter((s) => overlap(hour, hour + 1, s.startHour, s.endHour) > 0);
        if (!onFloor.length) continue;
        const part = hour < 13 ? 'morning' : hour < 17 ? 'noon' : 'evening';
        const dowMult = dow === 4 ? 1.3 : dow === 5 ? 1.15 : dow === 0 ? 0.9 : 1;
        for (const sh of onFloor) {
          const t = traits.get(sh.sellerId)!;
          const others = onFloor.filter((o) => o.sellerId !== sh.sellerId).map((o) => o.sellerId);
          const boost = pairBoost(sh.sellerId, others);
          const isOpeningWindow = sh.startHour <= h.open + 0.01 && hour < sh.startHour + 2;
          const lambda = (spec.traffic * spec.curve[part] * dowMult) / Math.pow(onFloor.length, 0.25);
          const approaches = poisson(r, lambda);
          for (let a = 0; a < approaches; a++) {
            const minute = hour + r();
            if (date === today && minute > nowHour) continue;
            interactions.push({ id: id('i'), sellerId: sh.sellerId, storeId: st.id, ts: tsAt(date, minute) });
            const cat = pickWeighted(r, spec.mix);
            let p =
              spec.conv *
              Math.sqrt(t.ability) *
              t.dayPart[part] *
              Math.sqrt(t.category[cat]) *
              Math.sqrt(boost) *
              (isOpeningWindow ? Math.pow(t.opening, 1.5) : 1);
            p = Math.min(0.92, p);
            if (r() > p) continue;
            const upsellP = Math.min(0.85, 0.28 * t.upsell);
            const upsell: UpsellType = r() < upsellP ? pickWeighted(r, { upsell: 0.45, cross_sell: 0.35, add_on: 0.2 }) : 'none';
            const cats: Category[] = [cat];
            if (upsell === 'cross_sell') {
              const second = pickWeighted(r, spec.mix);
              if (second !== cat) cats.push(second);
            }
            let amount =
              spec.atv * PRICE[cat] * t.atv * Math.sqrt(t.ability * t.category[cat]) * Math.sqrt(boost) * Math.exp(normal(r, 0, 0.35));
            let units = 1 + poisson(r, Math.max(0, (spec.upt - 1) * t.upt));
            if (upsell === 'upsell') amount *= 1.3;
            if (upsell === 'cross_sell') {
              amount *= 1.45;
              units += 1;
            }
            if (upsell === 'add_on') {
              amount += 25 + r() * 30;
              units += 1;
            }
            const co = others.length && r() < 0.05 ? pick(r, others) : null;
            sales.push({
              id: id('s'),
              sellerId: sh.sellerId,
              coSellerId: co,
              storeId: st.id,
              shiftId: sh.id,
              ts: tsAt(date, minute),
              amount: Math.round(amount),
              units,
              categories: cats,
              upsell,
              clubSignup: r() < 0.15,
              isReturn: false,
            });
            if (r() < 0.02) {
              sales.push({
                id: id('s'),
                sellerId: sh.sellerId,
                coSellerId: null,
                storeId: st.id,
                shiftId: sh.id,
                ts: tsAt(date, Math.min(h.close - 0.05, minute + r())),
                amount: Math.round(amount * 0.6),
                units: 1,
                categories: [cat],
                upsell: 'none',
                clubSignup: false,
                isReturn: true,
              });
            }
          }
        }
      }
    }
  }

  // ---- targets: same-weekday average × 1.05, rounded to ₪100, for history + 35 days ahead ----
  const targets: DailyTarget[] = [];
  const salesByStore = groupBy(sales, (s) => s.storeId);
  for (const st of stores) {
    const perDow = new Array(7).fill(0);
    const dayCount = new Array(7).fill(0);
    const byDay = groupBy(salesByStore.get(st.id) ?? [], (s) => dateKey(new Date(s.ts)));
    for (const [d, list] of byDay) {
      if (d === today) continue;
      perDow[weekday(d)] += list.reduce((a, s) => a + (s.isReturn ? -s.amount : s.amount), 0);
      dayCount[weekday(d)]++;
    }
    for (let d = 0; d <= days + 35; d++) {
      const date = addDays(startDay, d);
      const dow = weekday(date);
      if (!st.hours[dow] || !dayCount[dow]) continue;
      targets.push({ storeId: st.id, date, target: Math.round((perDow[dow] / dayCount[dow]) * 1.05 / 100) * 100 });
    }
  }
  // personal shift targets = store target split by hours
  const tByKey = new Map(targets.map((t) => [t.storeId + '|' + t.date, t.target]));
  for (const [k, list] of groupBy(shifts, (s) => s.storeId + '|' + s.date)) {
    const total = list.reduce((a, s) => a + (s.endHour - s.startHour), 0);
    const t = tByKey.get(k) ?? 0;
    for (const s of list) s.target = Math.round(((s.endHour - s.startHour) / total) * t);
  }

  return {
    data: { regions: REGIONS, stores, sellers, shifts, sales, interactions, targets, recommendations: [] },
    traits,
    synergy,
  };
}
