import type { DayPart } from './types';

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** local YYYY-MM-DD */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export function weekday(key: string): number {
  return parseDateKey(key).getDay();
}

/** decimal local hour of an ISO timestamp, e.g. 13.5 */
export function hourOf(ts: string): number {
  const d = new Date(ts);
  return d.getHours() + d.getMinutes() / 60;
}

export function dateOf(ts: string): string {
  return dateKey(new Date(ts));
}

export function tsAt(key: string, hour: number): string {
  const d = parseDateKey(key);
  d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return d.toISOString();
}

export function dayPartOf(hour: number): DayPart {
  if (hour < 13) return 'morning';
  if (hour < 17) return 'noon';
  return 'evening';
}

export function formatHour(h: number | null | undefined): string {
  if (h == null || !isFinite(h)) return '—';
  const m = Math.round((h % 1) * 60);
  return `${pad(Math.floor(h) + (m === 60 ? 1 : 0))}:${pad(m === 60 ? 0 : m)}`;
}

export function money(n: number): string {
  return '₪' + Math.round(n).toLocaleString('he-IL');
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n == null || !isFinite(n)) return '—';
  return (n * 100).toFixed(digits) + '%';
}

export function fixed(n: number | null | undefined, digits = 2): string {
  if (n == null || !isFinite(n)) return '—';
  return n.toFixed(digits);
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: number[]): number {
  return xs.length ? sum(xs) / xs.length : 0;
}

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function safeDiv(a: number, b: number, fallback = 0): number {
  return b ? a / b : fallback;
}

/** great-circle distance in km */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** hours of overlap between two [start,end) intervals */
export function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** deterministic PRNG (mulberry32) for demo data and tests */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
