import { useMemo, useState } from 'react';
import { useApp } from '../../state';
import { computeKpis, involves } from '../../lib/metrics';
import { addDays, dateKey, dateOf, fixed, formatHour, money, parseDateKey, pct } from '../../lib/util';
import { WEEKDAY_LABEL } from '../../lib/types';
import { Empty, Kpi, Section, Segmented } from '../../components/ui';
import { ProfileCard } from '../../components/ProfileCard';

export function MyStats() {
  const { data, me, getAnalysis } = useApp();
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const today = dateKey(new Date());
  const from = addDays(today, -Number(range) + 1);

  const { k, days } = useMemo(() => {
    const sales = data!.sales.filter((s) => involves(s, me!.id) && dateOf(s.ts) >= from);
    const shifts = data!.shifts.filter((s) => s.sellerId === me!.id && s.date >= from);
    const ints = data!.interactions.filter((i) => i.sellerId === me!.id && dateOf(i.ts) >= from);
    const k = computeKpis({ sales, shifts, interactions: ints, sellerId: me!.id });
    const days = [...new Set(shifts.map((s) => s.date))]
      .sort()
      .reverse()
      .map((d) => {
        const ds = sales.filter((s) => dateOf(s.ts) === d);
        return {
          date: d,
          k: computeKpis({
            sales: ds,
            shifts: shifts.filter((s) => s.date === d),
            interactions: ints.filter((i) => dateOf(i.ts) === d),
            sellerId: me!.id,
          }),
        };
      });
    return { k, days };
  }, [data, me, from]);

  const profile = useMemo(() => getAnalysis().profiles.get(me!.id), [getAnalysis, me]);

  return (
    <div className="stack">
      <Section title="הביצועים שלי" actions={<Segmented value={range} onChange={setRange} options={[{ value: '7', label: '7 ימים' }, { value: '30', label: '30' }, { value: '90', label: '90' }]} />}>
        <div className="kpis">
          <Kpi label="מכירות" value={money(k.revenue)} sub={`יעד ${money(k.target)}`} />
          <Kpi label="עמידה ביעד" value={pct(k.targetPct)} tone={k.targetPct != null && k.targetPct >= 1 ? 'good' : 'bad'} />
          <Kpi label="סל ממוצע" value={money(k.atv)} />
          <Kpi label="פריטים לעסקה" value={fixed(k.upt, 2)} />
          <Kpi label="הגדלות" value={pct(k.upsellRate)} />
          <Kpi label="המרה" value={pct(k.conversion)} />
          <Kpi label="זמן לסיפתוח" value={k.minutesToFirstSale != null ? `${Math.round(k.minutesToFirstSale)} דק׳` : '—'} />
          <Kpi label="לשעה" value={money(k.salesPerHour)} />
        </div>
      </Section>

      {profile && profile.shifts > 0 && (
        <Section title="החוזקות שלי">
          <ProfileCard p={profile} />
        </Section>
      )}

      <Section title="יום אחרי יום">
        {!days.length ? (
          <Empty>אין משמרות בטווח הזה.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>יום</th>
                  <th>מכירות</th>
                  <th>יעד</th>
                  <th>סיפתוח</th>
                  <th>סל</th>
                  <th>פריטים</th>
                  <th>הגדלה</th>
                </tr>
              </thead>
              <tbody>
                {days.map(({ date, k }) => (
                  <tr key={date}>
                    <td>
                      {WEEKDAY_LABEL[parseDateKey(date).getDay()]} {date.slice(8)}/{date.slice(5, 7)}
                    </td>
                    <td>{money(k.revenue)}</td>
                    <td className={k.targetPct != null && k.targetPct >= 1 ? 'good' : 'bad'}>{pct(k.targetPct)}</td>
                    <td>{formatHour(k.firstSaleHour)}</td>
                    <td>{money(k.atv)}</td>
                    <td>{fixed(k.upt, 1)}</td>
                    <td>{pct(k.upsellRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
