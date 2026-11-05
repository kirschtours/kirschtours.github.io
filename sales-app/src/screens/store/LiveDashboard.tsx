import { useMemo, useState } from 'react';
import { useApp, useNow, visibleStores } from '../../state';
import { computeKpis, firstSaleInShift, involves, revenueByHour } from '../../lib/metrics';
import type { Sale } from '../../lib/types';
import { CATEGORY_LABEL, ROLE_LABEL, UPSELL_LABEL } from '../../lib/types';
import { dateKey, dateOf, fixed, formatHour, hourOf, money, pct, weekday } from '../../lib/util';
import { Empty, HourChart, Kpi, Progress, Section, Sheet } from '../../components/ui';
import { QuickSale, type SaleDraft } from '../seller/QuickSale';

export function StorePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data, me } = useApp();
  const stores = visibleStores(data!, me!);
  if (stores.length <= 1) return null;
  return (
    <select className="store-picker" value={value} onChange={(e) => onChange(e.target.value)} aria-label="סניף">
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

export function useDefaultStore(): [string, (id: string) => void] {
  const { data, me } = useApp();
  const [id, setId] = useState(() => me!.storeId ?? visibleStores(data!, me!)[0]?.id ?? '');
  return [id, setId];
}

export function LiveDashboard() {
  const { data, me, updateSale, deleteSale, getAnalysis } = useApp();
  const now = useNow(30_000);
  const [storeId, setStoreId] = useDefaultStore();
  const [date, setDate] = useState(dateKey(now));
  const [edit, setEdit] = useState<Sale | null>(null);
  const store = data!.stores.find((s) => s.id === storeId);
  const isToday = date === dateKey(now);
  const canEdit = me!.role !== 'seller';

  const view = useMemo(() => {
    const sales = data!.sales.filter((s) => s.storeId === storeId && dateOf(s.ts) === date);
    const shifts = data!.shifts.filter((s) => s.storeId === storeId && s.date === date);
    const ints = data!.interactions.filter((i) => i.storeId === storeId && dateOf(i.ts) === date);
    const target = data!.targets.find((t) => t.storeId === storeId && t.date === date)?.target ?? 0;
    const k = computeKpis({ sales, interactions: ints, shifts, target, now: isToday ? now : undefined });
    const hourly = revenueByHour(sales);
    let load: number[] | undefined;
    try {
      load = getAnalysis().baselines.get(storeId)?.hourLoad;
    } catch {
      load = undefined;
    }
    const expected = load ? load.map((w) => w * target) : undefined;
    const nowH = now.getHours() + now.getMinutes() / 60;
    let expectedByNow = target;
    if (isToday && load) {
      expectedByNow = 0;
      for (let h = 0; h < 24; h++) expectedByNow += target * load[h] * Math.max(0, Math.min(1, nowH - h));
    }
    const people = [...new Set(shifts.map((s) => s.sellerId))].map((id) => {
      const seller = data!.sellers.find((s) => s.id === id)!;
      const myShifts = shifts.filter((s) => s.sellerId === id);
      const pk = computeKpis({
        sales: sales.filter((s) => involves(s, id)),
        interactions: ints,
        shifts: myShifts,
        sellerId: id,
        now: isToday ? now : undefined,
      });
      const first = myShifts.map((s) => firstSaleInShift(s, sales)).filter((x): x is number => x != null);
      const onFloor = isToday && myShifts.some((s) => !s.closed && s.startHour <= nowH && s.endHour > nowH);
      return { seller, shifts: myShifts, k: pk, first: first.length ? Math.min(...first) : null, onFloor };
    });
    people.sort((a, b) => b.k.revenue - a.k.revenue);
    return { sales: sales.sort((a, b) => b.ts.localeCompare(a.ts)), k, hourly, expected, expectedByNow, people, target };
  }, [data, storeId, date, isToday, now, getAnalysis]);

  if (!store) return <Empty>אין סניף משויך.</Empty>;
  const hours = store.hours[weekday(date)];
  const pace = view.expectedByNow ? view.k.revenue / view.expectedByNow : null;

  const save = async (d: SaleDraft) => {
    if (!edit) return;
    await updateSale(edit.id, d);
    setEdit(null);
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <StorePicker value={storeId} onChange={setStoreId} />
        <input type="date" value={date} max={dateKey(now)} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="תאריך" />
      </div>

      <Section title={`${store.name}${isToday ? ' · היום' : ''}`}>
        <div className="target-row">
          <div>
            <div className="big-number">{money(view.k.revenue)}</div>
            <div className="muted small">מתוך יעד {money(view.target)}</div>
          </div>
          {isToday && pace != null && (
            <div className="text-end">
              <div className={pace >= 1 ? 'good' : 'bad'}>קצב {pct(pace)} מהצפוי לשעה זו</div>
              <div className="muted small">צפוי עד עכשיו {money(view.expectedByNow)}</div>
            </div>
          )}
        </div>
        <Progress value={view.k.targetPct ?? 0} label={pct(view.k.targetPct)} />
        <div className="kpis">
          <Kpi label="סיפתוח הסניף" value={formatHour(view.k.firstSaleHour)} sub={view.k.minutesToFirstSale != null ? `${Math.round(view.k.minutesToFirstSale)} דק׳ מהפתיחה` : undefined} />
          <Kpi label="עסקאות" value={Math.round(view.k.transactions)} />
          <Kpi label="סל ממוצע" value={money(view.k.atv)} />
          <Kpi label="פריטים לעסקה" value={fixed(view.k.upt, 2)} />
          <Kpi label="הגדלות" value={pct(view.k.upsellRate)} />
          <Kpi label="המרה" value={pct(view.k.conversion)} sub={`${view.k.interactions} פניות`} />
          <Kpi label="מועדון" value={Math.round(view.k.clubSignups)} />
          <Kpi label="החזרות" value={money(view.k.returnsAmount)} tone={view.k.returnsAmount ? 'bad' : undefined} />
        </div>
        {hours && <HourChart actual={view.hourly} expected={view.expected} from={hours.open} to={hours.close} />}
      </Section>

      <Section title="הצוות במשמרת">
        {!view.people.length ? (
          <Empty>אין משמרות רשומות ביום הזה.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>שעות</th>
                  <th>סיפתוח</th>
                  <th>מכירות</th>
                  <th>יעד</th>
                  <th>סל</th>
                  <th>פריטים</th>
                  <th>הגדלה</th>
                  <th>המרה</th>
                </tr>
              </thead>
              <tbody>
                {view.people.map(({ seller, shifts, k, first, onFloor }) => (
                  <tr key={seller.id}>
                    <td>
                      {onFloor && <span className="dot" title="במשמרת עכשיו" />}
                      {seller.name}
                      <div className="muted tiny">
                        {ROLE_LABEL[seller.role]}
                        {seller.isBrandPromoter && ` · מקדמת ${seller.brand ?? ''}`}
                      </div>
                    </td>
                    <td>{shifts.map((s) => `${formatHour(s.startHour)}–${formatHour(s.endHour)}`).join(', ')}</td>
                    <td>{formatHour(first)}</td>
                    <td>{money(k.revenue)}</td>
                    <td className={k.targetPct != null && k.targetPct >= 1 ? 'good' : 'bad'}>{pct(k.targetPct)}</td>
                    <td>{money(k.atv)}</td>
                    <td>{fixed(k.upt, 1)}</td>
                    <td>{pct(k.upsellRate)}</td>
                    <td>{pct(k.conversion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`עסקאות (${view.sales.length})`}>
        {!view.sales.length ? (
          <Empty>אין עסקאות.</Empty>
        ) : (
          <ul className="sale-list">
            {view.sales.slice(0, 200).map((s) => (
              <li key={s.id}>
                <button className="sale-item" onClick={() => canEdit && setEdit(s)} disabled={!canEdit}>
                  <span className="time">{formatHour(hourOf(s.ts))}</span>
                  <span className="what">
                    {data!.sellers.find((x) => x.id === s.sellerId)?.name}
                    {s.coSellerId && ` + ${data!.sellers.find((x) => x.id === s.coSellerId)?.name}`} · {s.categories.map((c) => CATEGORY_LABEL[c]).join(' + ')} · {s.units}
                    {s.upsell !== 'none' && <span className="tag">{UPSELL_LABEL[s.upsell]}</span>}
                  </span>
                  <span className={`amt ${s.isReturn ? 'bad' : ''}`}>
                    {s.isReturn ? '−' : ''}
                    {money(s.amount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title="תיקון עסקה">
        {edit && (
          <QuickSale
            key={edit.id}
            initial={edit}
            coWorkers={view.people.map((p) => p.seller).filter((s) => s.id !== edit.sellerId)}
            onSave={save}
            onDelete={async () => {
              if (!confirm('למחוק את העסקה?')) return;
              await deleteSale(edit.id);
              setEdit(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
