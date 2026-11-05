/**
 * Cross-store mentoring.
 * For every skill, sellers in the region's top quartile can mentor sellers in the bottom quartile.
 * Each mentee gets one mentor for her weakest skill, from a different store, at most 2 mentees per mentor.
 * Suggested format: two joint shifts at the mentor's store, in the day-part where the skill matters.
 */
import type { Category, Dataset, DayPart, Seller, Store } from '../types';
import { CATEGORIES, CATEGORY_LABEL } from '../types';
import type { SellerProfile } from '../profiles';
import { analyze } from '../profiles';
import { addDays, distanceKm, safeDiv } from '../util';

export type Skill = 'opening' | 'upsell' | 'upt' | 'atv' | 'conversion' | `cat:${Category}`;

export const SKILL_LABEL: Record<string, string> = {
  opening: 'סיפתוח',
  upsell: 'הגדלה',
  upt: 'פריטים לעסקה',
  atv: 'סל ממוצע',
  conversion: 'המרה',
  ...Object.fromEntries(CATEGORIES.map((c) => [`cat:${c}`, `מכירת ${CATEGORY_LABEL[c]}`])),
};

export const ALL_SKILLS: Skill[] = ['opening', 'upsell', 'upt', 'atv', 'conversion', ...CATEGORIES.map((c) => `cat:${c}` as Skill)];

/** skill value relative to the seller's own overall level, so we coach the specific gap */
export function skillValue(p: SellerProfile, skill: Skill): number | null {
  switch (skill) {
    case 'opening':
      return p.openingShifts >= 3 ? p.openingIndex / p.salesIndex : null;
    case 'upsell':
      return p.upsellIndex;
    case 'upt':
      return p.uptIndex;
    case 'atv':
      return p.atvIndex;
    case 'conversion':
      return p.conversionIndex;
    default:
      return p.categoryIndex[skill.slice(4) as Category] / (p.salesIndex || 1);
  }
}

export function skillDayPart(skill: Skill): DayPart | null {
  return skill === 'opening' ? 'morning' : null;
}

export interface MentorMatch {
  mentorId: string;
  menteeId: string;
  skill: Skill;
  mentorValue: number;
  menteeValue: number;
  regionMedian: number;
  /** realistic goal: close 40% of the gap to the median */
  goal: number;
  km: number;
  jointDays: number[];
  explanation: string;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface MentoringOptions {
  sellers: Seller[];
  stores: Store[];
  profiles: Map<string, SellerProfile>;
  maxMenteesPerMentor?: number;
  skills?: Skill[];
  /** only coach gaps of at least this share below the region median (default 15%) */
  minGap?: number;
  /** cap the list so a manager can act on it (default 12, most severe first) */
  maxMatches?: number;
}

export function matchMentors(opts: MentoringOptions): MentorMatch[] {
  const cap = opts.maxMenteesPerMentor ?? 2;
  const minGap = opts.minGap ?? 0.15;
  const maxMatches = opts.maxMatches ?? 12;
  const skills = opts.skills ?? ALL_SKILLS;
  const storesById = new Map(opts.stores.map((s) => [s.id, s]));
  const pool = opts.sellers.filter((s) => s.active && s.storeId && opts.profiles.get(s.id)?.eligible);
  const byId = new Map(pool.map((s) => [s.id, s]));

  // percentile thresholds per skill
  const stats = new Map<Skill, { q1: number; q3: number; median: number }>();
  for (const sk of skills) {
    const vals = pool
      .map((s) => skillValue(opts.profiles.get(s.id)!, sk))
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    if (vals.length >= 8) stats.set(sk, { q1: quantile(vals, 0.25), q3: quantile(vals, 0.75), median: quantile(vals, 0.5) });
  }

  // each mentee: the weakest skill, measured as distance below the quartile threshold
  const needs: { menteeId: string; skill: Skill; value: number; severity: number }[] = [];
  for (const s of pool) {
    const p = opts.profiles.get(s.id)!;
    let worst: { skill: Skill; value: number; severity: number } | null = null;
    for (const [sk, st] of stats) {
      const v = skillValue(p, sk);
      if (v == null || v > st.q1) continue;
      const severity = safeDiv(st.median - v, st.median);
      if (severity < minGap) continue;
      if (!worst || severity > worst.severity) worst = { skill: sk, value: v, severity };
    }
    if (worst) needs.push({ menteeId: s.id, ...worst });
  }
  needs.sort((a, b) => b.severity - a.severity);

  const load = new Map<string, number>();
  const out: MentorMatch[] = [];
  for (const need of needs) {
    if (out.length >= maxMatches) break;
    const st = stats.get(need.skill)!;
    const mentee = byId.get(need.menteeId)!;
    const menteeStore = storesById.get(mentee.storeId!);
    let best: { s: Seller; v: number; km: number; score: number } | null = null;
    for (const m of pool) {
      if (m.id === mentee.id || m.storeId === mentee.storeId) continue;
      if ((load.get(m.id) ?? 0) >= cap) continue;
      const v = skillValue(opts.profiles.get(m.id)!, need.skill);
      if (v == null || v < st.q3) continue;
      const ms = storesById.get(m.storeId!);
      const km =
        ms && (mentee.homeLat ?? menteeStore?.lat) != null
          ? distanceKm(mentee.homeLat ?? menteeStore!.lat, mentee.homeLng ?? menteeStore!.lng, ms.lat, ms.lng)
          : 0;
      const sharedDays = m.availability.filter((d) => mentee.availability.includes(d)).length;
      if (!sharedDays) continue;
      // strongest mentor wins; every 10 km costs about 0.02 index points
      const score = v - km * 0.002;
      if (!best || score > best.score) best = { s: m, v, km, score };
    }
    if (!best) continue;
    load.set(best.s.id, (load.get(best.s.id) ?? 0) + 1);
    const goal = need.value + (st.median - need.value) * 0.4;
    const mentorStore = storesById.get(best.s.storeId!);
    out.push({
      mentorId: best.s.id,
      menteeId: mentee.id,
      skill: need.skill,
      mentorValue: best.v,
      menteeValue: need.value,
      regionMedian: st.median,
      goal,
      km: best.km,
      jointDays: best.s.availability.filter((d) => mentee.availability.includes(d)),
      explanation:
        `${mentee.name} נמצאת ברבעון התחתון ב${SKILL_LABEL[need.skill]} (${need.value.toFixed(2)}, החציון באזור ${st.median.toFixed(2)}). ` +
        `${best.s.name} מ${mentorStore?.name ?? 'סניף אחר'} ברבעון העליון (${best.v.toFixed(2)}). ` +
        `מומלצות 2 משמרות משותפות בסניף של החונכת${skillDayPart(need.skill) ? ' בבוקר' : ''}, ויעד ל-4 שבועות: ${goal.toFixed(2)}.`,
    });
  }
  return out;
}

export interface MentorshipResult {
  before: number | null;
  after: number | null;
  change: number | null;
  daysAfter: number;
}

/** compare the mentee's skill in the 4 weeks before vs after the mentorship started */
export function evaluateMentorship(data: Dataset, menteeId: string, skill: Skill, startDate: string, today: string): MentorshipResult {
  const beforeA = analyze(data, addDays(startDate, -28), addDays(startDate, -1));
  const end = addDays(startDate, 27) < today ? addDays(startDate, 27) : today;
  const afterA = analyze(data, startDate, end);
  const pb = beforeA.profiles.get(menteeId);
  const pa = afterA.profiles.get(menteeId);
  const before = pb && pb.shifts ? skillValue(pb, skill) : null;
  const after = pa && pa.shifts ? skillValue(pa, skill) : null;
  const daysAfter = Math.max(0, Math.round((new Date(end).getTime() - new Date(startDate).getTime()) / 86400000) + 1);
  return { before, after, change: before != null && after != null ? after - before : null, daysAfter };
}
