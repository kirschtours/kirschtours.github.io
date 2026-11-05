import { useMemo, useState } from 'react';
import { useApp } from '../../state';
import { splitMonthlyTarget } from '../../lib/metrics';
import type { DailyTarget } from '../../lib/types';
import { WEEKDAY_LABEL } from '../../lib/types';
import { dateKey, money, parseDateKey } from '../../lib/util';
import { Section } from '../../components/ui';
import { StorePicker, useDefaultStore } from './LiveDashboard';

export function Targets() {
  const { data, setTargets } = useApp();
  const [storeId, setStoreId] = useDefaultStore();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [y, m] = month.split('-').map(Number);
  const store = data!.stores.find((s) => s.id === storeId)!;

  const existing = useMemo(() => {
    const out = new Map<string, number>();
    for (const t of data!.targets) if (t.storeId === storeId && t.date.startsWith(month)) out.set(t.date, t.target);
    return out;
  }, [data, storeId, month]);

  const days = useMemo(() => {
    const out: string[] = [];
    const d = new Date(y, m - 1, 1);
    while (d.getMonth() === m - 1) {
      out.push(dateKey(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, [y, m]);

  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const values = draft ?? Object.fromEntries(days.map((d) => [d, existing.get(d) ?? 0]));
  const total = days.reduce((a, d) => a + (values[d] ?? 0), 0);
  const [monthly, setMonthly] = useState('');
  const [saved, setSaved] = useState(false);

  const autoSplit = () => {
    const t = Number(monthly) || total;
    const split = splitMonthlyTarget(t, y, m - 1, store, data!.sales);
    setDraft(Object.fromEntries(split.map((s) => [s.date, s.target])));
    setSaved(false);
  };

  const save = async () => {
    const list: DailyTarget[] = days.map((d) => ({ storeId, date: d, target: values[d] ?? 0 }));
    await setTargets(list);
    setDraft(null);
    setSaved(true);
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <StorePicker value={storeId} onChange={(id) => (setStoreId(id), setDraft(null))} />
        <input type="month" value={month} onChange={(e) => e.target.value && (setMonth(e.target.value), setDraft(null))} aria-label="חודש" />
      </div>
      <Section title={`יעדים · ${store.name}`}>
        <p className="muted small">
          מזינים יעד חודשי, והמערכת מחלקת אותו לימים לפי משקל כל יום בשבוע בהיסטוריה של הסניף (חמישי חזק, ראשון חלש). את המספרים אפשר לשנות ידנית, למשל לחגים או
          למבצעים. היעד היומי מתחלק בין העובדות לפי השעות שלהן ולפי העומס הצפוי בכל שעה.
        </p>
        <div className="row gap wrap">
          <label className="field grow">
            <span>יעד חודשי (₪)</span>
            <input inputMode="numeric" value={monthly} placeholder={String(Math.round(total))} onChange={(e) => setMonthly(e.target.value.replace(/\D/g, ''))} />
          </label>
          <button className="btn secondary" onClick={autoSplit}>
            חלוקה לימים
          </button>
          <button className="btn primary" onClick={save} disabled={!draft}>
            שמירה
          </button>
        </div>
        {saved && <p className="good small">היעדים נשמרו.</p>}
        <div className="muted small">סה״כ לחודש: {money(total)}</div>
        <div className="target-grid">
          {days.map((d) => {
            const dow = parseDateKey(d).getDay();
            const closed = !store.hours[dow];
            return (
              <label key={d} className={`target-cell ${closed ? 'closed' : ''} ${dow === 5 ? 'fri' : ''}`}>
                <span>
                  {WEEKDAY_LABEL[dow]} {Number(d.slice(8))}
                </span>
                <input
                  inputMode="numeric"
                  value={values[d] ?? 0}
                  disabled={closed}
                  onChange={(e) => {
                    setDraft({ ...values, [d]: Number(e.target.value.replace(/\D/g, '')) || 0 });
                    setSaved(false);
                  }}
                />
              </label>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
