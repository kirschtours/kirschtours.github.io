// Core domain model for a cosmetics retail chain.
// Hierarchy: admin (HQ) → area_manager (region) → store_manager (store) → shift_lead → seller.

export type Role = 'seller' | 'shift_lead' | 'store_manager' | 'area_manager' | 'admin';

export const CATEGORIES = ['skincare', 'makeup', 'fragrance', 'hair', 'body'] as const;
export type Category = (typeof CATEGORIES)[number];

/** upsell = pricier item / bigger size, cross_sell = complementary product, add_on = small item at the till */
export type UpsellType = 'none' | 'upsell' | 'cross_sell' | 'add_on';

export type DayPart = 'morning' | 'noon' | 'evening';
export const DAY_PARTS: DayPart[] = ['morning', 'noon', 'evening'];

export interface Region {
  id: string;
  name: string;
}

export interface Store {
  id: string;
  name: string;
  regionId: string;
  /** opening hours per weekday (0 = Sunday). null = closed */
  hours: ({ open: number; close: number } | null)[];
  lat: number;
  lng: number;
  /** recommended head-count on the floor at once */
  headcount: number;
}

export interface Seller {
  id: string;
  name: string;
  role: Role;
  /** home store; area managers / admins may have none */
  storeId: string | null;
  /** region for area managers (derived from store for others) */
  regionId: string | null;
  isBrandPromoter: boolean;
  brand: string | null;
  /** weekdays the person can work (0 = Sunday) */
  availability: number[];
  /** contracted shifts per week */
  shiftsPerWeek: number;
  homeLat: number | null;
  homeLng: number | null;
  active: boolean;
  email?: string | null;
}

/** One person's shift in one store on one day. Co-workers are derived by overlap. */
export interface Shift {
  id: string;
  sellerId: string;
  storeId: string;
  date: string; // YYYY-MM-DD (local)
  startHour: number; // decimal hours, e.g. 9.5
  endHour: number;
  /** personal target for this shift, ₪ */
  target: number;
  closed: boolean;
}

export interface Sale {
  id: string;
  sellerId: string;
  /** optional second seller – attribution is split 50/50 */
  coSellerId: string | null;
  storeId: string;
  shiftId: string | null;
  ts: string; // ISO timestamp
  amount: number; // ₪, positive. Returns are flagged with isReturn.
  units: number;
  categories: Category[];
  upsell: UpsellType;
  clubSignup: boolean;
  isReturn: boolean;
}

/** a customer approach – one tap, used for conversion */
export interface Interaction {
  id: string;
  sellerId: string;
  storeId: string;
  ts: string;
}

export interface DailyTarget {
  storeId: string;
  date: string;
  target: number;
}

export type RecommendationKind = 'pairing' | 'store' | 'mentoring';
export type RecommendationStatus = 'proposed' | 'approved' | 'rejected';

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  createdAt: string;
  createdBy: string | null;
  title: string;
  explanation: string;
  score: number;
  status: RecommendationStatus;
  payload: Record<string, unknown>;
}

export interface Dataset {
  regions: Region[];
  stores: Store[];
  sellers: Seller[];
  shifts: Shift[];
  sales: Sale[];
  interactions: Interaction[];
  targets: DailyTarget[];
  recommendations: Recommendation[];
}

export const CATEGORY_LABEL: Record<Category, string> = {
  skincare: 'טיפוח',
  makeup: 'איפור',
  fragrance: 'בישום',
  hair: 'שיער',
  body: 'גוף',
};

export const UPSELL_LABEL: Record<UpsellType, string> = {
  none: 'ללא',
  upsell: 'שדרוג',
  cross_sell: 'מוצר משלים',
  add_on: 'תוספת בקופה',
};

export const ROLE_LABEL: Record<Role, string> = {
  seller: 'יועצת יופי',
  shift_lead: 'אחראית משמרת',
  store_manager: 'מנהלת סניף',
  area_manager: 'מנהלת אזור',
  admin: 'הנהלה',
};

export const DAY_PART_LABEL: Record<DayPart, string> = {
  morning: 'בוקר',
  noon: 'צהריים',
  evening: 'ערב',
};

export const WEEKDAY_LABEL = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
