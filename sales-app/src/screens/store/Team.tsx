import { useMemo, useState } from 'react';
import { regionOf, useApp, visibleStores } from '../../state';
import { ROLE_LABEL } from '../../lib/types';
import { money } from '../../lib/util';
import { Empty, IndexBadge, Section, Segmented } from '../../components/ui';
import { ProfileCard } from '../../components/ProfileCard';

/** Store-normalized seller profiles – the input to every recommendation. */
export function Team() {
  const { data, me, getAnalysis } = useApp();
  const stores = me!.role === 'store_manager' ? data!.stores.filter((s) => s.regionId === regionOf(data!, me!)) : visibleStores(data!, me!);
  const [storeId, setStoreId] = useState<string>(me!.storeId ?? 'all');
  const [sort, setSort] = useState<'sales' | 'opening' | 'upsell'>('sales');
  const [open, setOpen] = useState<string | null>(null);
  const A = getAnalysis();

  const rows = useMemo(() => {
    const ids = new Set(stores.map((s) => s.id));
    return data!.sellers
      .filter((s) => s.storeId && ids.has(s.storeId) && (storeId === 'all' || s.storeId === storeId))
      .map((s) => ({ s, p: A.profiles.get(s.id)! }))
      .filter((x) => x.p && x.p.shifts > 0)
      .sort((a, b) =>
        sort === 'sales' ? b.p.salesIndex - a.p.salesIndex : sort === 'opening' ? b.p.openingIndex - a.p.openingIndex : b.p.upsellIndex - a.p.upsellIndex,
      );
  }, [data, stores, storeId, sort, A]);

  return (
    <div className="stack">
      <div className="toolbar">
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="סניף">
          {stores.length > 1 && <option value="all">כל הסניפים</option>}
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: 'sales', label: 'מכירות' },
            { value: 'opening', label: 'סיפתוח' },
            { value: 'upsell', label: 'הגדלה' },
          ]}
        />
      </div>
      <Section title="פרופיל מוכרות (90 יום)">
        <p className="muted small">
          כל מדד מחושב ביחס למה שמוכרת ממוצעת הייתה עושה באותו סניף, באותו יום בשבוע ובאותה שעה. 1.00 הוא הממוצע ו-1.20 הוא 20% מעל. כך משווים בהגינות בין סניף חזק לסניף
          חלש.
        </p>
        {!rows.length ? (
          <Empty>אין עדיין נתונים.</Empty>
        ) : (
          <ul className="people">
            {rows.map(({ s, p }) => (
              <li key={s.id}>
                <button className="person-row" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                  <span className="grow">
                    {s.name}
                    <span className="muted tiny">
                      {' '}
                      · {ROLE_LABEL[s.role]}
                      {storeId === 'all' && ` · ${data!.stores.find((x) => x.id === s.storeId)?.name}`}
                      {s.isBrandPromoter && ` · מקדמת ${s.brand}`}
                    </span>
                  </span>
                  <span className="muted tiny">{money(p.revenue)}</span>
                  <IndexBadge value={sort === 'sales' ? p.salesIndex : sort === 'opening' ? p.openingIndex : p.upsellIndex} />
                </button>
                {open === s.id && <ProfileCard p={p} />}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
