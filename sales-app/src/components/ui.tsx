import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from '../lib/util';

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'neutral' }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub != null && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: ReactNode }) {
  const pct = Math.max(0, Math.min(1.5, value));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-bar ${value >= 1 ? 'done' : ''}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      {label && <div className="progress-label">{label}</div>}
    </div>
  );
}

export function Section({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגירה">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({
  values,
  options,
  onToggle,
}: {
  values: T[];
  options: { value: T; label: string }[];
  onToggle: (v: T) => void;
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={values.includes(o.value)}
          className={values.includes(o.value) ? 'chip on' : 'chip'}
          onClick={() => onToggle(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function IndexBadge({ value, digits = 2 }: { value: number | null | undefined; digits?: number }) {
  if (value == null || !isFinite(value)) return <span className="idx">—</span>;
  const tone = value >= 1.1 ? 'good' : value <= 0.9 ? 'bad' : '';
  return <span className={`idx ${tone}`}>{value.toFixed(digits)}</span>;
}

/** actual revenue by hour (bars) vs. expected (line) */
export function HourChart({ actual, expected, from, to }: { actual: number[]; expected?: number[]; from: number; to: number }) {
  const rows = [];
  for (let h = Math.floor(from); h < Math.ceil(to); h++) rows.push({ h: `${h}:00`, actual: Math.round(actual[h] ?? 0), expected: expected ? Math.round(expected[h] ?? 0) : undefined });
  return (
    <div className="chart" dir="ltr">
      <ResponsiveContainer width="100%" height={200}>
        {expected ? (
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="h" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={1} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} width={44} />
            <Tooltip formatter={(v: number) => money(v)} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', direction: 'rtl' }} />
            <Bar dataKey="actual" name="בפועל" fill="var(--accent)" radius={[4, 4, 0, 0]} />
            <Line dataKey="expected" name="מצופה" stroke="var(--muted)" strokeDasharray="4 3" dot={false} strokeWidth={2} />
          </ComposedChart>
        ) : (
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="h" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={1} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} width={44} />
            <Tooltip formatter={(v: number) => money(v)} />
            <Bar dataKey="actual" name="בפועל" fill="var(--accent)" radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
