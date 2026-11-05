import type { SellerProfile } from '../lib/profiles';
import { MIN_SHIFTS_FOR_RECOMMENDATION, topTraits } from '../lib/profiles';
import { CATEGORIES, CATEGORY_LABEL, DAY_PARTS, DAY_PART_LABEL } from '../lib/types';
import { IndexBadge } from './ui';

export function ProfileCard({ p, compact }: { p: SellerProfile; compact?: boolean }) {
  const traits = topTraits(p);
  const strengths = traits.filter((t) => t.value >= 1.08).slice(0, 3);
  const weaknesses = traits.filter((t) => t.value <= 0.92).slice(-3).reverse();
  return (
    <div className="profile">
      {!p.eligible && (
        <p className="muted small">
          {p.shifts} משמרות בלבד. המלצות מתחילות אחרי {MIN_SHIFTS_FOR_RECOMMENDATION} משמרות, ועד אז המדדים מוצגים לעיון בלבד.
        </p>
      )}
      <div className="profile-head">
        <div>
          <div className="muted small">מדד מכירות (1.00 = ממוצע הסניף באותן שעות)</div>
          <div className="big-number">
            <IndexBadge value={p.salesIndex} />
          </div>
        </div>
        <div className="muted small text-end">
          {p.shifts} משמרות · ביטחון {Math.round(p.confidence * 100)}%
          <br />
          יציבות {Math.round(p.consistency * 100)}%
        </div>
      </div>
      {(strengths.length > 0 || weaknesses.length > 0) && (
        <div className="traits">
          {strengths.map((t) => (
            <span key={t.label} className="trait good">
              ▲ {t.label} {t.value.toFixed(2)}
            </span>
          ))}
          {weaknesses.map((t) => (
            <span key={t.label} className="trait bad">
              ▼ {t.label} {t.value.toFixed(2)}
            </span>
          ))}
        </div>
      )}
      {!compact && (
        <table className="mini">
          <tbody>
            <tr>
              <th>סיפתוח</th>
              <td>
                <IndexBadge value={p.openingIndex} />
              </td>
              <th>הגדלה</th>
              <td>
                <IndexBadge value={p.upsellIndex} />
              </td>
            </tr>
            <tr>
              <th>סל ממוצע</th>
              <td>
                <IndexBadge value={p.atvIndex} />
              </td>
              <th>פריטים</th>
              <td>
                <IndexBadge value={p.uptIndex} />
              </td>
            </tr>
            <tr>
              <th>המרה</th>
              <td>
                <IndexBadge value={p.conversionIndex} />
              </td>
              <th>זמן לסיפתוח</th>
              <td>{p.avgMinutesToFirstSale != null ? `${Math.round(p.avgMinutesToFirstSale)} דק׳` : '—'}</td>
            </tr>
            <tr>
              {DAY_PARTS.map((d) => (
                <td key={d} colSpan={d === 'evening' ? 2 : 1}>
                  {DAY_PART_LABEL[d]} <IndexBadge value={p.dayPartIndex[d]} />
                </td>
              ))}
            </tr>
            <tr>
              <td colSpan={4} className="cats">
                {CATEGORIES.map((c) => (
                  <span key={c}>
                    {CATEGORY_LABEL[c]} <IndexBadge value={p.categoryIndex[c]} />
                  </span>
                ))}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
