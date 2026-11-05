import { useEffect, useRef, useState } from 'react';
import type { Category, Sale, Seller, UpsellType } from '../../lib/types';
import { CATEGORIES, CATEGORY_LABEL, UPSELL_LABEL } from '../../lib/types';
import { Chips, Segmented } from '../../components/ui';

export interface SaleDraft {
  amount: number;
  units: number;
  categories: Category[];
  upsell: UpsellType;
  clubSignup: boolean;
  isReturn: boolean;
  coSellerId: string | null;
}

/** Fast sale entry – target: under 10 seconds per sale. */
export function QuickSale({
  initial,
  coWorkers,
  onSave,
  onDelete,
  saving,
}: {
  initial?: Sale;
  coWorkers: Seller[];
  onSave: (d: SaleDraft) => void;
  onDelete?: () => void;
  saving?: boolean;
}) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [units, setUnits] = useState(initial?.units ?? 1);
  const [cats, setCats] = useState<Category[]>(initial?.categories ?? []);
  const [upsell, setUpsell] = useState<UpsellType>(initial?.upsell ?? 'none');
  const [club, setClub] = useState(initial?.clubSignup ?? false);
  const [isReturn, setIsReturn] = useState(initial?.isReturn ?? false);
  const [co, setCo] = useState<string>(initial?.coSellerId ?? '');
  const [touched, setTouched] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const value = Number(amount.replace(',', '.'));
  const valid = value > 0 && units >= 1 && cats.length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    onSave({ amount: Math.round(value * 100) / 100, units, categories: cats, upsell: isReturn ? 'none' : upsell, clubSignup: !isReturn && club, isReturn, coSellerId: co || null });
  };

  return (
    <form className="quick-sale" onSubmit={submit}>
      <label className="field">
        <span>סכום (₪)</span>
        <input
          ref={ref}
          className="amount"
          inputMode="decimal"
          enterKeyHint="done"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
          aria-invalid={touched && !(value > 0)}
        />
      </label>

      <div className="field">
        <span>פריטים</span>
        <div className="stepper">
          <button type="button" onClick={() => setUnits((u) => Math.max(1, u - 1))} aria-label="פחות">
            −
          </button>
          <output aria-live="polite">{units}</output>
          <button type="button" onClick={() => setUnits((u) => u + 1)} aria-label="יותר">
            +
          </button>
        </div>
      </div>

      <div className="field">
        <span>קטגוריה{touched && !cats.length && <em className="err"> · בחרי לפחות אחת</em>}</span>
        <Chips
          values={cats}
          options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          onToggle={(c) => setCats((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]))}
        />
      </div>

      {!isReturn && (
        <div className="field">
          <span>הגדלה</span>
          <Segmented
            label="הגדלה"
            value={upsell}
            onChange={setUpsell}
            options={(['none', 'upsell', 'cross_sell', 'add_on'] as UpsellType[]).map((u) => ({ value: u, label: UPSELL_LABEL[u] }))}
          />
        </div>
      )}

      <div className="toggles">
        {!isReturn && (
          <label className="toggle">
            <input type="checkbox" checked={club} onChange={(e) => setClub(e.target.checked)} />
            <span>הצטרפות למועדון</span>
          </label>
        )}
        <label className="toggle">
          <input type="checkbox" checked={isReturn} onChange={(e) => setIsReturn(e.target.checked)} />
          <span>החזרה</span>
        </label>
      </div>

      {coWorkers.length > 0 && (
        <label className="field">
          <span>מכירה משותפת (50/50)</span>
          <select value={co} onChange={(e) => setCo(e.target.value)}>
            <option value="">לבד</option>
            {coWorkers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="row gap">
        <button className="btn primary big grow" type="submit" disabled={saving}>
          {initial ? 'שמירה' : isReturn ? 'רישום החזרה' : 'רישום עסקה'}
        </button>
        {onDelete && (
          <button className="btn danger" type="button" onClick={onDelete}>
            מחיקה
          </button>
        )}
      </div>
    </form>
  );
}
