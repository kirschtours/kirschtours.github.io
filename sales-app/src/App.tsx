import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApp } from './state';
import type { Role, Seller } from './lib/types';
import { ROLE_LABEL } from './lib/types';
import { DEMO_SELLER_ID } from './lib/demo';
import { SupabaseStore } from './lib/store/supabaseStore';
import { MyDay } from './screens/seller/MyDay';
import { MyStats } from './screens/seller/MyStats';
import { LiveDashboard } from './screens/store/LiveDashboard';
import { Targets } from './screens/store/Targets';
import { Team } from './screens/store/Team';
import { StoresRollup } from './screens/area/StoresRollup';
import { Recommendations } from './screens/area/Recommendations';
import { Admin } from './screens/admin/Admin';

type TabId = 'myday' | 'mystats' | 'store' | 'targets' | 'team' | 'stores' | 'recs' | 'admin';

const TAB_LABEL: Record<TabId, string> = {
  myday: 'היום שלי',
  mystats: 'הביצועים שלי',
  store: 'הסניף',
  targets: 'יעדים',
  team: 'צוות',
  stores: 'סניפים',
  recs: 'שיבוצים',
  admin: 'ניהול',
};
const TAB_ICON: Record<TabId, string> = {
  myday: '◉',
  mystats: '↗',
  store: '▦',
  targets: '◎',
  team: '☰',
  stores: '▤',
  recs: '⇄',
  admin: '⚙',
};

const TABS_BY_ROLE: Record<Role, TabId[]> = {
  seller: ['myday', 'mystats'],
  shift_lead: ['myday', 'store', 'mystats'],
  store_manager: ['store', 'myday', 'targets', 'team', 'recs'],
  area_manager: ['stores', 'store', 'team', 'recs', 'admin'],
  admin: ['stores', 'store', 'team', 'recs', 'admin'],
};

function Screen({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'myday':
      return <MyDay />;
    case 'mystats':
      return <MyStats />;
    case 'store':
      return <LiveDashboard />;
    case 'targets':
      return <Targets />;
    case 'team':
      return <Team />;
    case 'stores':
      return <StoresRollup />;
    case 'recs':
      return <Recommendations />;
    case 'admin':
      return <Admin />;
  }
}

function DemoLogin() {
  const { data, setMeId } = useApp();
  const personas = useMemo(() => {
    const pick = (id: string, note: string) => {
      const s = data!.sellers.find((x) => x.id === id);
      return s ? { s, note } : null;
    };
    return [
      pick(DEMO_SELLER_ID, 'מדווחת עסקאות מהטלפון'),
      pick('u-azrieli-2', 'רואה את הסניף בזמן אמת'),
      pick('u-azrieli-1', 'יעדים, צוות וסידור משמרות'),
      pick('u-area-center', 'כל הסניפים באזור והמלצות שיבוץ'),
      pick('u-admin', 'כל הרשת'),
    ].filter(Boolean) as { s: Seller; note: string }[];
  }, [data]);
  const [other, setOther] = useState('');
  return (
    <div className="login">
      <h1>דיווח מכירות יומי</h1>
      <p className="muted">מצב דמו: 6 סניפים, 72 מוכרות ו-90 ימים של נתונים שנוצרו אוטומטית. בחרי תפקיד כדי להיכנס.</p>
      <ul className="persona-list">
        {personas.map(({ s, note }) => (
          <li key={s.id}>
            <button className="persona" onClick={() => setMeId(s.id)}>
              <b>{s.name}</b>
              <span className="role">{ROLE_LABEL[s.role]}</span>
              <span className="muted small">{note}</span>
            </button>
          </li>
        ))}
      </ul>
      <label className="field">
        <span>או כל משתמשת אחרת</span>
        <select value={other} onChange={(e) => (setOther(e.target.value), e.target.value && setMeId(e.target.value))}>
          <option value="">בחירה…</option>
          {data!.sellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {ROLE_LABEL[s.role]}
              {s.storeId ? ` · ${data!.stores.find((x) => x.id === s.storeId)?.name}` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function EmailLogin({ store }: { store: SupabaseStore }) {
  const { setMeId, reload } = useApp();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="login"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        try {
          if (!sent) {
            await store.sendCode(email.trim());
            setSent(true);
          } else {
            await store.verifyCode(email.trim(), code.trim());
            await reload();
            const id = await store.currentProfileId();
            if (!id) setErr('החשבון עדיין לא שויך לפרופיל. צריך לבקש מהמנהלת להוסיף אותך עם כתובת המייל הזו.');
            setMeId(id);
          }
        } catch (x) {
          setErr(x instanceof Error ? x.message : String(x));
        }
      }}
    >
      <h1>דיווח מכירות יומי</h1>
      <label className="field">
        <span>אימייל</span>
        <input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} />
      </label>
      {sent && (
        <label className="field">
          <span>הקוד שנשלח למייל</span>
          <input inputMode="numeric" dir="ltr" required value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </label>
      )}
      {err && <p className="bad small">{err}</p>}
      <button className="btn primary big" type="submit">
        {sent ? 'כניסה' : 'שליחת קוד'}
      </button>
    </form>
  );
}

function Shell({ children, tabs, tab, setTab }: { children: ReactNode; tabs: TabId[]; tab: TabId; setTab: (t: TabId) => void }) {
  const { me, data, setMeId, store } = useApp();
  const storeName = data!.stores.find((s) => s.id === me!.storeId)?.name;
  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="who">{me!.name}</div>
          <div className="muted tiny">
            {ROLE_LABEL[me!.role]}
            {storeName && ` · ${storeName}`}
            {store.mode === 'demo' && ' · דמו'}
          </div>
        </div>
        <button
          className="btn ghost small"
          onClick={async () => {
            if (store instanceof SupabaseStore) await store.signOut();
            setMeId(null);
          }}
        >
          {store.mode === 'demo' ? 'החלפת משתמשת' : 'יציאה'}
        </button>
      </header>
      <nav className="tabs-top" aria-label="ניווט">
        {tabs.map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)} aria-current={t === tab ? 'page' : undefined}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </nav>
      <main>{children}</main>
      <nav className="tabs-bottom" aria-label="ניווט">
        {tabs.map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)} aria-current={t === tab ? 'page' : undefined}>
            <span className="ico" aria-hidden>
              {TAB_ICON[t]}
            </span>
            {TAB_LABEL[t]}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  const { data, error, me, store, setMeId } = useApp();
  const tabs = me ? TABS_BY_ROLE[me.role] : [];
  const [tab, setTab] = useState<TabId>('myday');
  useEffect(() => {
    if (me && !tabs.includes(tab)) setTab(tabs[0]);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // Supabase: restore session on load
  useEffect(() => {
    if (store instanceof SupabaseStore && data && !me) void store.currentProfileId().then((id) => id && setMeId(id));
  }, [store, data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error)
    return (
      <div className="login">
        <h1>שגיאה בטעינת הנתונים</h1>
        <p className="bad">{error}</p>
      </div>
    );
  if (!data)
    return (
      <div className="loading" role="status">
        טוען נתונים…
      </div>
    );
  if (!me) return store instanceof SupabaseStore ? <EmailLogin store={store} /> : <DemoLogin />;
  return (
    <Shell tabs={tabs} tab={tabs.includes(tab) ? tab : tabs[0]} setTab={setTab}>
      <Screen tab={tabs.includes(tab) ? tab : tabs[0]} />
    </Shell>
  );
}
