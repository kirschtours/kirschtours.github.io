import { useState } from 'react';
import { regionOf, useApp } from '../../state';
import type { Role, Seller, Store } from '../../lib/types';
import { ROLE_LABEL, WEEKDAY_LABEL } from '../../lib/types';
import { uid } from '../../lib/util';
import { Section } from '../../components/ui';

const ROLES: Role[] = ['seller', 'shift_lead', 'store_manager', 'area_manager', 'admin'];

function blankSeller(storeId: string | null, regionId: string | null): Seller {
  return {
    id: uid(),
    name: '',
    role: 'seller',
    storeId,
    regionId,
    isBrandPromoter: false,
    brand: null,
    availability: [0, 1, 2, 3, 4, 5],
    shiftsPerWeek: 5,
    homeLat: null,
    homeLng: null,
    active: true,
    email: '',
  };
}

function SellerForm({ initial, stores, onSave, onCancel, allowedRoles }: { initial: Seller; stores: Store[]; onSave: (s: Seller) => void; onCancel: () => void; allowedRoles: Role[] }) {
  const [s, setS] = useState(initial);
  const set = <K extends keyof Seller>(k: K, v: Seller[K]) => setS((x) => ({ ...x, [k]: v }));
  return (
    <form
      className="edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!s.name.trim()) return;
        const store = stores.find((x) => x.id === s.storeId);
        onSave({ ...s, regionId: store?.regionId ?? s.regionId, email: s.email?.trim() || null });
      }}
    >
      <div className="grid2">
        <label className="field">
          <span>שם</span>
          <input value={s.name} onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label className="field">
          <span>אימייל (לכניסה)</span>
          <input type="email" dir="ltr" value={s.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label className="field">
          <span>תפקיד</span>
          <select value={s.role} onChange={(e) => set('role', e.target.value as Role)}>
            {allowedRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>סניף בית</span>
          <select value={s.storeId ?? ''} onChange={(e) => set('storeId', e.target.value || null)}>
            <option value="">ללא (מנהלת אזור / הנהלה)</option>
            {stores.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>משמרות בשבוע</span>
          <input type="number" min={0} max={7} value={s.shiftsPerWeek} onChange={(e) => set('shiftsPerWeek', Number(e.target.value) || 0)} />
        </label>
        <label className="field">
          <span>מותג (למקדמות)</span>
          <input value={s.brand ?? ''} onChange={(e) => (set('brand', e.target.value || null), set('isBrandPromoter', !!e.target.value))} />
        </label>
      </div>
      <div className="field">
        <span>זמינות</span>
        <div className="chips">
          {WEEKDAY_LABEL.map((l, d) => (
            <button
              type="button"
              key={d}
              className={s.availability.includes(d) ? 'chip on' : 'chip'}
              aria-pressed={s.availability.includes(d)}
              onClick={() => set('availability', s.availability.includes(d) ? s.availability.filter((x) => x !== d) : [...s.availability, d].sort())}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={s.active} onChange={(e) => set('active', e.target.checked)} />
        <span>פעילה</span>
      </label>
      <div className="row gap">
        <button className="btn primary" type="submit">
          שמירה
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </form>
  );
}

export function Admin() {
  const { data, me, store, upsertSeller, upsertStore, reload } = useApp();
  const isAdmin = me!.role === 'admin';
  const region = regionOf(data!, me!);
  const stores = isAdmin ? data!.stores : data!.stores.filter((s) => s.regionId === region);
  const [storeFilter, setStoreFilter] = useState(stores[0]?.id ?? '');
  const [editing, setEditing] = useState<Seller | null>(null);
  const [editStore, setEditStore] = useState<Store | null>(null);
  const people = data!.sellers.filter((s) => (storeFilter ? s.storeId === storeFilter : !s.storeId));
  const allowedRoles = isAdmin ? ROLES : ROLES.filter((r) => r !== 'admin' && r !== 'area_manager');

  return (
    <div className="stack">
      <Section
        title="אנשים"
        actions={
          <button className="btn primary small" onClick={() => setEditing(blankSeller(storeFilter || null, region))}>
            + הוספה
          </button>
        }
      >
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} aria-label="סניף">
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {isAdmin && <option value="">הנהלה ומנהלות אזור</option>}
        </select>
        {store.mode === 'supabase' && <p className="muted small">אחרי שמוסיפים אדם עם אימייל, היא נכנסת עם קוד שנשלח למייל, והחשבון מתחבר לפרופיל אוטומטית.</p>}
        {editing && (
          <SellerForm
            initial={editing}
            stores={stores}
            allowedRoles={allowedRoles}
            onCancel={() => setEditing(null)}
            onSave={async (s) => {
              await upsertSeller(s);
              setEditing(null);
            }}
          />
        )}
        <ul className="people">
          {people.map((s) => (
            <li key={s.id}>
              <button className="person-row" onClick={() => setEditing(s)}>
                <span className="grow">
                  {s.name} {!s.active && <span className="muted tiny">(לא פעילה)</span>}
                </span>
                <span className="muted tiny">
                  {ROLE_LABEL[s.role]}
                  {s.isBrandPromoter && ` · ${s.brand}`} · {s.shiftsPerWeek} משמרות
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {isAdmin && (
        <Section
          title="סניפים"
          actions={
            <button
              className="btn primary small"
              onClick={() =>
                setEditStore({
                  id: uid(),
                  name: '',
                  regionId: data!.regions[0]?.id ?? '',
                  lat: 32.08,
                  lng: 34.78,
                  headcount: 3,
                  hours: [{ open: 10, close: 22 }, { open: 10, close: 22 }, { open: 10, close: 22 }, { open: 10, close: 22 }, { open: 10, close: 22 }, { open: 9, close: 15 }, null],
                })
              }
            >
              + סניף
            </button>
          }
        >
          {editStore && (
            <form
              className="edit-form"
              onSubmit={async (e) => {
                e.preventDefault();
                await upsertStore(editStore);
                setEditStore(null);
              }}
            >
              <div className="grid2">
                <label className="field">
                  <span>שם</span>
                  <input value={editStore.name} required onChange={(e) => setEditStore({ ...editStore, name: e.target.value })} />
                </label>
                <label className="field">
                  <span>אזור</span>
                  <select value={editStore.regionId} onChange={(e) => setEditStore({ ...editStore, regionId: e.target.value })}>
                    {data!.regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>קו רוחב</span>
                  <input dir="ltr" value={editStore.lat} onChange={(e) => setEditStore({ ...editStore, lat: Number(e.target.value) || 0 })} />
                </label>
                <label className="field">
                  <span>קו אורך</span>
                  <input dir="ltr" value={editStore.lng} onChange={(e) => setEditStore({ ...editStore, lng: Number(e.target.value) || 0 })} />
                </label>
              </div>
              <div className="hours-grid">
                {WEEKDAY_LABEL.map((l, d) => {
                  const h = editStore.hours[d];
                  const setH = (v: { open: number; close: number } | null) => setEditStore({ ...editStore, hours: editStore.hours.map((x, i) => (i === d ? v : x)) });
                  return (
                    <div key={d} className="hours-row">
                      <label className="toggle">
                        <input type="checkbox" checked={!!h} onChange={(e) => setH(e.target.checked ? { open: 10, close: 22 } : null)} />
                        <span>{l}</span>
                      </label>
                      {h && (
                        <>
                          <input type="number" step={0.5} min={0} max={24} value={h.open} onChange={(e) => setH({ ...h, open: Number(e.target.value) })} aria-label={`פתיחה ${l}`} />
                          <span>–</span>
                          <input type="number" step={0.5} min={0} max={24} value={h.close} onChange={(e) => setH({ ...h, close: Number(e.target.value) })} aria-label={`סגירה ${l}`} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="row gap">
                <button className="btn primary" type="submit">
                  שמירה
                </button>
                <button className="btn ghost" type="button" onClick={() => setEditStore(null)}>
                  ביטול
                </button>
              </div>
            </form>
          )}
          <ul className="people">
            {data!.stores.map((s) => (
              <li key={s.id}>
                <button className="person-row" onClick={() => setEditStore(s)}>
                  <span className="grow">{s.name}</span>
                  <span className="muted tiny">{data!.regions.find((r) => r.id === s.regionId)?.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {store.reset && (
        <Section title="מצב דמו">
          <p className="muted small">הנתונים נוצרו אוטומטית לצורך הדגמה. השינויים שלך נשמרים רק בדפדפן הזה.</p>
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm('לאפס את כל השינויים בדמו?')) return;
              await store.reset!();
              await reload();
            }}
          >
            איפוס הדמו
          </button>
        </Section>
      )}
    </div>
  );
}
