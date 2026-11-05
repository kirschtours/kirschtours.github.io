import { useMemo, useState } from 'react';
import { useApp, useNow } from '../../state';
import { computeKpis, involves, personalTarget } from '../../lib/metrics';
import type { Sale, Seller, Shift } from '../../lib/types';
import { CATEGORY_LABEL, UPSELL_LABEL } from '../../lib/types';
import { dateKey, formatHour, hourOf, money, pct, fixed, uid, weekday, dateOf } from '../../lib/util';
import { Empty, Kpi, Progress, Section, Sheet } from '../../components/ui';
import { QuickSale, type SaleDraft } from './QuickSale';

function roundHalf(h: number) {
  return Math.floor(h * 2) / 2;
}

function ShiftOpen({ me, onOpened }: { me: Seller; onOpened: () => void }) {
  const { data, upsertShift, getAnalysis } = useApp();
  const now = useNow();
  const today = dateKey(now);
  const region = data!.stores.find((s) => s.id === me.storeId)?.regionId;
  const stores = data!.stores.filter((s) => s.regionId === region);
  const [storeId, setStoreId] = useState(me.storeId ?? stores[0]?.id ?? '');
  const store = data!.stores.find((s) => s.id === storeId);
  const hours = store?.hours[weekday(today)] ?? null;
  const nowH = now.getHours() + now.getMinutes() / 60;
  const defStart = hours ? Math.max(hours.open, Math.min(roundHalf(nowH), hours.close - 1)) : roundHalf(nowH);
  const mid = hours ? Math.round((hours.open + (hours.close - hours.open) / 2) * 2) / 2 : defStart + 6;
  // morning shift ends at the changeover; anyone starting later (or < 3h before it) closes the store
  const defEnd = hours ? (defStart <= mid - 3 ? mid : hours.close) : defStart + 6;
  const [start, setStart] = useState(defStart);
  const [end, setEnd] = useState(defEnd);
  const [busy, setBusy] = useState(false);

  const daily = data!.targets.find((t) => t.storeId === storeId && t.date === today)?.target ?? 0;
  const others = data!.shifts.filter((s) => s.storeId === storeId && s.date === today && s.sellerId !== me.id);
  const hourLoad = useMemo(() => {
    try {
      return getAnalysis().baselines.get(storeId)?.hourLoad;
    } catch {
      return undefined;
    }
  }, [getAnalysis, storeId]);
  const target = personalTarget(daily, others, { startHour: start, endHour: end }, hourLoad);

  const hourOptions: number[] = [];
  for (let h = 6; h <= 24; h += 0.5) hourOptions.push(h);

  const open = async () => {
    setBusy(true);
    try {
      await upsertShift({ id: uid(), sellerId: me.id, storeId, date: today, startHour: start, endHour: end, target, closed: false });
      onOpened();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="פתיחת משמרת">
      {!hours && <p className="warn">הסניף סגור היום לפי שעות הפעילות.</p>}
      <div className="grid2">
        <label className="field">
          <span>סניף</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid2">
          <label className="field">
            <span>משעה</span>
            <select value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {hourOptions.map((h) => (
                <option key={h} value={h}>
                  {formatHour(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>עד שעה</span>
            <select value={end} onChange={(e) => setEnd(Number(e.target.value))}>
              {hourOptions
                .filter((h) => h > start)
                .map((h) => (
                  <option key={h} value={h}>
                    {formatHour(h)}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>
      <div className="target-preview">
        <div>
          <div className="muted">היעד האישי שלך היום</div>
          <div className="big-number">{money(target)}</div>
        </div>
        <div className="muted small">
          יעד הסניף {money(daily)}, מחולק לפי השעות שלך ולפי העומס הצפוי בכל שעה ({others.length} עובדות נוספות רשומות היום)
        </div>
      </div>
      <button className="btn primary big" onClick={open} disabled={busy || end <= start}>
        פתיחת משמרת
      </button>
    </Section>
  );
}

export function MyDay() {
  const { data, me, addSale, updateSale, deleteSale, addInteraction, deleteInteraction, upsertShift } = useApp();
  const now = useNow(30_000);
  const today = dateKey(now);
  const [sheet, setSheet] = useState<'new' | Sale | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastInteraction, setLastInteraction] = useState<string | null>(null);

  const shift: Shift | undefined = useMemo(() => {
    const mine = data!.shifts.filter((s) => s.sellerId === me!.id && s.date === today);
    return mine.find((s) => !s.closed) ?? mine[mine.length - 1];
  }, [data, me, today]);

  const mySales = useMemo(
    () => data!.sales.filter((s) => involves(s, me!.id) && dateOf(s.ts) === today).sort((a, b) => b.ts.localeCompare(a.ts)),
    [data, me, today],
  );
  const myInts = useMemo(() => data!.interactions.filter((i) => i.sellerId === me!.id && dateOf(i.ts) === today), [data, me, today]);

  if (!me) return null;
  if (!shift) return <ShiftOpen me={me} onOpened={() => setToast('המשמרת נפתחה – בהצלחה!')} />;

  const k = computeKpis({ sales: mySales, interactions: myInts, shifts: [shift], sellerId: me.id, now });
  const nowH = now.getHours() + now.getMinutes() / 60;
  const elapsed = Math.max(0.25, Math.min(shift.endHour, nowH) - shift.startHour);
  const total = shift.endHour - shift.startHour;
  const projected = shift.closed ? k.revenue : (k.revenue / elapsed) * total;
  const coWorkers = data!.sellers.filter(
    (s) => s.id !== me.id && data!.shifts.some((sh) => sh.sellerId === s.id && sh.date === today && sh.storeId === shift.storeId),
  );
  const storeName = data!.stores.find((s) => s.id === shift.storeId)?.name;

  const save = async (d: SaleDraft) => {
    setSaving(true);
    try {
      if (sheet && sheet !== 'new') {
        await updateSale(sheet.id, d);
        setToast('העסקה עודכנה');
      } else {
        const first = !mySales.some((s) => !s.isReturn);
        await addSale({ ...d, sellerId: me.id, storeId: shift.storeId, shiftId: shift.id, ts: new Date().toISOString() });
        setToast(first && !d.isReturn ? `סיפתוח! ${formatHour(nowH)} 🎉` : d.isReturn ? 'ההחזרה נרשמה' : `נרשם ${money(d.amount)}`);
      }
      setSheet(null);
    } finally {
      setSaving(false);
    }
  };

  const tapInteraction = async () => {
    const i = await addInteraction({ sellerId: me.id, storeId: shift.storeId, ts: new Date().toISOString() });
    setLastInteraction(i.id);
  };

  return (
    <div className="stack">
      {toast && (
        <div className="toast" role="status" onAnimationEnd={() => setToast(null)}>
          {toast}
        </div>
      )}
      <Section
        title={
          <>
            המשמרת שלי <span className="muted small">· {storeName} · {formatHour(shift.startHour)}–{formatHour(shift.endHour)}</span>
          </>
        }
        actions={
          shift.closed ? (
            <button className="btn ghost small" onClick={() => upsertShift({ ...shift, closed: false })}>
              פתיחה מחדש
            </button>
          ) : (
            <button className="btn ghost small" onClick={() => confirm('לסגור את המשמרת?') && upsertShift({ ...shift, closed: true })}>
              סגירת משמרת
            </button>
          )
        }
      >
        <div className="target-row">
          <div>
            <div className="big-number">{money(k.revenue)}</div>
            <div className="muted small">מתוך יעד {money(shift.target)}</div>
          </div>
          <div className="text-end">
            <div className={projected >= shift.target ? 'good' : 'bad'}>{shift.closed ? 'סיכום' : `צפי לסוף המשמרת ${money(projected)}`}</div>
            <div className="muted small">{shift.target > k.revenue ? `חסר ${money(shift.target - k.revenue)}` : 'עברת את היעד 💪'}</div>
          </div>
        </div>
        <Progress value={k.targetPct ?? 0} label={pct(k.targetPct)} />

        {!shift.closed && (
          <div className="action-row">
            <button className="btn primary huge" onClick={() => setSheet('new')}>
              + עסקה
            </button>
            <button className="btn secondary huge" onClick={tapInteraction} aria-label="רישום פנייה ללקוחה">
              + פנייה
              <span className="badge">{myInts.length}</span>
            </button>
          </div>
        )}
        {lastInteraction && !shift.closed && (
          <button
            className="link small"
            onClick={async () => {
              await deleteInteraction(lastInteraction);
              setLastInteraction(null);
            }}
          >
            ביטול הפנייה האחרונה
          </button>
        )}

        <div className="kpis">
          <Kpi label="סיפתוח" value={k.firstSaleHour != null ? formatHour(k.firstSaleHour) : 'עוד לא'} sub={k.minutesToFirstSale != null ? `${Math.round(k.minutesToFirstSale)} דק׳ מהפתיחה` : undefined} />
          <Kpi label="עסקאות" value={fixed(k.transactions, k.transactions % 1 ? 1 : 0)} />
          <Kpi label="סל ממוצע" value={money(k.atv)} />
          <Kpi label="פריטים לעסקה" value={fixed(k.upt, 1)} />
          <Kpi label="הגדלות" value={pct(k.upsellRate)} sub={`${Math.round(k.upsellCounts.upsell + k.upsellCounts.cross_sell + k.upsellCounts.add_on)} עסקאות`} />
          <Kpi label="המרה" value={pct(k.conversion)} sub={`${k.interactions} פניות`} />
          <Kpi label="מועדון" value={Math.round(k.clubSignups)} />
          <Kpi label="לשעה" value={k.hours >= 0.25 ? money(k.salesPerHour) : '—'} />
        </div>
      </Section>

      <Section title={`העסקאות של היום (${mySales.length})`}>
        {!mySales.length ? (
          <Empty>עדיין אין עסקאות. הראשונה היא הסיפתוח!</Empty>
        ) : (
          <ul className="sale-list">
            {mySales.map((s) => (
              <li key={s.id}>
                <button className="sale-item" onClick={() => setSheet(s)} disabled={shift.closed}>
                  <span className="time">{formatHour(hourOf(s.ts))}</span>
                  <span className="what">
                    {s.categories.map((c) => CATEGORY_LABEL[c]).join(' + ')} · {s.units} פריטים
                    {s.upsell !== 'none' && <span className="tag">{UPSELL_LABEL[s.upsell]}</span>}
                    {s.clubSignup && <span className="tag">מועדון</span>}
                    {s.coSellerId && <span className="tag">משותפת</span>}
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

      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet && sheet !== 'new' ? 'עריכת עסקה' : 'עסקה חדשה'}>
        <QuickSale
          key={sheet && sheet !== 'new' ? sheet.id : 'new'}
          initial={sheet && sheet !== 'new' ? sheet : undefined}
          coWorkers={coWorkers}
          saving={saving}
          onSave={save}
          onDelete={
            sheet && sheet !== 'new'
              ? async () => {
                  if (!confirm('למחוק את העסקה?')) return;
                  await deleteSale(sheet.id);
                  setSheet(null);
                }
              : undefined
          }
        />
      </Sheet>
    </div>
  );
}
