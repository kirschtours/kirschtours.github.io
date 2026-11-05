import { useMemo, useState } from 'react';
import { useApp, visibleStores } from '../../state';
import { computeKpis } from '../../lib/metrics';
import { addDays, dateKey, dateOf, fixed, money, pct, safeDiv } from '../../lib/util';
import { Kpi, Section, Segmented } from '../../components/ui';

export function StoresRollup() {
  const { data, me } = useApp();
  const [range, setRange] = useState<'1' | '7' | '30'>('1');
  const [region, setRegion] = useState<string>('all');
  const today = dateKey(new Date());
  const from = addDays(today, -Number(range) + 1);
  const stores = visibleStores(data!, me!).filter((s) => region === 'all' || s.regionId === region);
  const now = new Date();

  const rows = useMemo(() => {
    return stores
      .map((st) => {
        const sales = data!.sales.filter((s) => s.storeId === st.id && dateOf(s.ts) >= from);
        const shifts = data!.shifts.filter((s) => s.storeId === st.id && s.date >= from);
        const ints = data!.interactions.filter((i) => i.storeId === st.id && dateOf(i.ts) >= from);
        const target = data!.targets.filter((t) => t.storeId === st.id && t.date >= from && t.date <= today).reduce((a, t) => a + t.target, 0);
        return { st, k: computeKpis({ sales, shifts, interactions: ints, target, now }) };
      })
      .sort((a, b) => (b.k.targetPct ?? 0) - (a.k.targetPct ?? 0));
  }, [data, stores, from, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const tot = rows.reduce(
    (a, r) => ({ rev: a.rev + r.k.revenue, tgt: a.tgt + r.k.target, tx: a.tx + r.k.transactions, gross: a.gross + r.k.grossRevenue, units: a.units + r.k.units }),
    { rev: 0, tgt: 0, tx: 0, gross: 0, units: 0 },
  );

  return (
    <div className="stack">
      <div className="toolbar">
        {me!.role === 'admin' && (
          <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="אזור">
            <option value="all">כל האזורים</option>
            {data!.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: '1', label: 'היום' },
            { value: '7', label: '7 ימים' },
            { value: '30', label: '30 ימים' },
          ]}
        />
      </div>
      <Section title="סיכום">
        <div className="kpis">
          <Kpi label="מכירות" value={money(tot.rev)} sub={`יעד ${money(tot.tgt)}`} />
          <Kpi label="עמידה ביעד" value={pct(safeDiv(tot.rev, tot.tgt))} tone={tot.rev >= tot.tgt ? 'good' : 'bad'} />
          <Kpi label="סל ממוצע" value={money(safeDiv(tot.gross, tot.tx))} />
          <Kpi label="פריטים לעסקה" value={fixed(safeDiv(tot.units, tot.tx), 2)} />
        </div>
      </Section>
      <Section title="סניפים">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>סניף</th>
                <th>מכירות</th>
                <th>יעד</th>
                <th>סל</th>
                <th>פריטים</th>
                <th>הגדלה</th>
                <th>המרה</th>
                <th>לסיפתוח</th>
                <th>לשעת עבודה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ st, k }) => (
                <tr key={st.id}>
                  <td>{st.name}</td>
                  <td>{money(k.revenue)}</td>
                  <td className={k.targetPct != null && k.targetPct >= 1 ? 'good' : 'bad'}>{pct(k.targetPct)}</td>
                  <td>{money(k.atv)}</td>
                  <td>{fixed(k.upt, 2)}</td>
                  <td>{pct(k.upsellRate)}</td>
                  <td>{pct(k.conversion)}</td>
                  <td>{k.minutesToFirstSale != null ? `${Math.round(k.minutesToFirstSale)} דק׳` : '—'}</td>
                  <td>{money(k.salesPerHour)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
