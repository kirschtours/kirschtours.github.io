import { useMemo, useState } from 'react';
import { regionOf, useApp, visibleStores } from '../../state';
import { planShifts, weekSlots, type PairingPlan } from '../../lib/matching/pairing';
import { assignStores, type StoreAssignResult } from '../../lib/matching/storeAssign';
import { evaluateMentorship, matchMentors, SKILL_LABEL, type MentorMatch, type Skill } from '../../lib/matching/mentoring';
import { personalTarget } from '../../lib/metrics';
import type { Recommendation, Seller } from '../../lib/types';
import { WEEKDAY_LABEL } from '../../lib/types';
import { dateKey, formatHour, money, parseDateKey, pct, safeDiv, uid } from '../../lib/util';
import { Empty, Section, Segmented } from '../../components/ui';

type Tab = 'pairing' | 'store' | 'mentoring' | 'history';

function nextSunday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return dateKey(d);
}

function useNames() {
  const { data } = useApp();
  return useMemo(() => {
    const m = new Map(data!.sellers.map((s) => [s.id, s]));
    const st = new Map(data!.stores.map((s) => [s.id, s]));
    return {
      seller: (id: string) => m.get(id)?.name ?? id,
      store: (id: string) => st.get(id)?.name ?? id,
      sellerObj: (id: string) => m.get(id),
    };
  }, [data]);
}

function PairingTab({ regionId }: { regionId: string | null }) {
  const { data, me, getAnalysis, saveRecommendation, upsertShift } = useApp();
  const names = useNames();
  const stores = me!.role === 'store_manager' ? data!.stores.filter((s) => s.id === me!.storeId) : visibleStores(data!, me!);
  const [storeId, setStoreId] = useState(me!.storeId ?? stores[0]?.id ?? '');
  const [week, setWeek] = useState(nextSunday());
  const [morning, setMorning] = useState(2);
  const [evening, setEvening] = useState(3);
  const [borrow, setBorrow] = useState(false);
  const [plan, setPlan] = useState<PairingPlan | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const store = data!.stores.find((s) => s.id === storeId)!;

  const run = () => {
    const A = getAnalysis();
    const cands = data!.sellers.filter(
      (s) =>
        s.active &&
        (s.storeId === storeId || (borrow && s.storeId && data!.stores.find((x) => x.id === s.storeId)?.regionId === store.regionId && !s.isBrandPromoter)) &&
        ['seller', 'shift_lead', 'store_manager'].includes(s.role),
    );
    setPlan(planShifts({ store, slots: weekSlots(store, week, { morning, evening }), candidates: cands, analysis: A, stores: data!.stores }));
    setStatus(null);
  };

  const publish = async () => {
    if (!plan) return;
    const rec: Recommendation = {
      id: uid(),
      kind: 'pairing',
      createdAt: new Date().toISOString(),
      createdBy: me!.id,
      title: `סידור משמרות ${store.name} · שבוע ${week.slice(8)}/${week.slice(5, 7)}`,
      explanation: `צפי ${money(plan.expected)} לעומת ${money(plan.randomTeam)} בשיבוץ אקראי של אותו צוות`,
      score: plan.expected - plan.randomTeam,
      status: 'approved',
      payload: {
        regionId: store.regionId,
        storeId,
        weekStart: week,
        slots: plan.slots.map((p) => ({ date: p.slot.date, start: p.slot.startHour, end: p.slot.endHour, members: p.members, expected: p.expected })),
      },
    };
    await saveRecommendation(rec);
    // publish as shifts with personal targets (skip people who already have a shift that day)
    const hourLoad = getAnalysis().baselines.get(storeId)?.hourLoad;
    for (const p of plan.slots) {
      const daily = data!.targets.find((t) => t.storeId === storeId && t.date === p.slot.date)?.target ?? 0;
      const dayShifts = plan.slots
        .filter((x) => x.slot.date === p.slot.date)
        .flatMap((x) => x.members.map(() => ({ startHour: x.slot.startHour, endHour: x.slot.endHour })));
      for (const m of p.members) {
        if (data!.shifts.some((s) => s.sellerId === m && s.date === p.slot.date)) continue;
        const others = dayShifts.slice();
        others.splice(
          others.findIndex((o) => o.startHour === p.slot.startHour && o.endHour === p.slot.endHour),
          1,
        );
        const target = personalTarget(daily, others, { startHour: p.slot.startHour, endHour: p.slot.endHour }, hourLoad);
        await upsertShift({ id: uid(), sellerId: m, storeId, date: p.slot.date, startHour: p.slot.startHour, endHour: p.slot.endHour, target, closed: false });
      }
    }
    setStatus('הסידור אושר ופורסם כמשמרות.');
  };

  const byDay = useMemo(() => {
    if (!plan) return [];
    const m = new Map<string, typeof plan.slots>();
    for (const p of plan.slots) m.set(p.slot.date, [...(m.get(p.slot.date) ?? []), p]);
    return [...m.entries()];
  }, [plan]);

  return (
    <div className="stack">
      <Section title="זיווג למשמרות">
        <p className="muted small">
          המערכת בונה סידור שבועי שמחלק את המשמרות בין כל הצוות לפי היקף המשרה, ומזווגת מוכרות שמשלימות זו את זו. בכל משמרת בוקר יש מישהי חזקה בסיפתוח, הצוות מכסה את הקטגוריות החזקות של הסניף, ויש עדיפות לצמדים
          שמוכרים יותר כשהם עובדים ביחד. הסידור מכבד זמינות, מכסת משמרות ואחראית בכל משמרת.
        </p>
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
          <label className="field">
            <span>שבוע שמתחיל ב־</span>
            <input type="date" value={week} onChange={(e) => e.target.value && setWeek(e.target.value)} />
          </label>
          <label className="field">
            <span>מוכרות בבוקר</span>
            <input type="number" min={1} max={6} value={morning} onChange={(e) => setMorning(Number(e.target.value) || 1)} />
          </label>
          <label className="field">
            <span>מוכרות בערב</span>
            <input type="number" min={1} max={6} value={evening} onChange={(e) => setEvening(Number(e.target.value) || 1)} />
          </label>
        </div>
        {regionId && (
          <label className="toggle">
            <input type="checkbox" checked={borrow} onChange={(e) => setBorrow(e.target.checked)} />
            <span>לאפשר תגבור ממוכרות של סניפים אחרים באזור (כולל עלות נסיעה)</span>
          </label>
        )}
        <button className="btn primary" onClick={run}>
          בניית סידור
        </button>
      </Section>

      {plan && (
        <Section
          title="הסידור המוצע"
          actions={
            <button className="btn primary small" onClick={publish} disabled={!!status}>
              אישור ופרסום
            </button>
          }
        >
          <div className="summary-line">
            צפי שבועי <b>{money(plan.expected)}</b>, לעומת {money(plan.randomTeam)} כשאותו צוות משובץ באקראי (
            <span className={plan.expected >= plan.randomTeam ? 'good' : 'bad'}>
              {plan.expected >= plan.randomTeam ? '+' : ''}
              {pct(safeDiv(plan.expected - plan.randomTeam, plan.randomTeam), 1)}
            </span>
            )
            {plan.unfilled > 0 && <span className="bad"> · {plan.unfilled} מקומות לא אוישו (אין מספיק זמינות)</span>}
          </div>
          {status && <p className="good">{status}</p>}
          <div className="plan">
            {byDay.map(([date, slots]) => (
              <div key={date} className="plan-day">
                <h3>
                  יום {WEEKDAY_LABEL[parseDateKey(date).getDay()]} {date.slice(8)}/{date.slice(5, 7)}
                </h3>
                {slots.map((p) => (
                  <div key={p.slot.id} className="plan-slot">
                    <div className="row between">
                      <b>
                        {formatHour(p.slot.startHour)}–{formatHour(p.slot.endHour)}
                      </b>
                      <span className="muted small">
                        צפי {money(p.expected)}
                      </span>
                    </div>
                    <div className="members">
                      {p.members.map((m) => {
                        const s = names.sellerObj(m) as Seller | undefined;
                        const borrowed = s?.storeId && s.storeId !== storeId;
                        return (
                          <span key={m} className={`member ${borrowed ? 'borrowed' : ''}`}>
                            {names.seller(m)}
                            {s && s.role !== 'seller' && <small> ★</small>}
                          </span>
                        );
                      })}
                    </div>
                    {p.notes.length > 0 && (
                      <ul className="notes">
                        {p.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function StoreTab({ regionId }: { regionId: string | null }) {
  const { data, me, getAnalysis, saveRecommendation, upsertSeller } = useApp();
  const names = useNames();
  const regions = me!.role === 'admin' ? data!.regions : data!.regions.filter((r) => r.id === regionId);
  const [rid, setRid] = useState(regionId ?? regions[0]?.id ?? '');
  const [res, setRes] = useState<StoreAssignResult | null>(null);
  const [done, setDone] = useState<Record<string, 'approved' | 'rejected'>>({});

  const run = () => {
    setRes(
      assignStores({
        sellers: data!.sellers.filter((s) => data!.stores.find((x) => x.id === s.storeId)?.regionId === rid),
        stores: data!.stores.filter((s) => s.regionId === rid),
        analysis: getAnalysis(),
      }),
    );
    setDone({});
  };

  const decide = async (sellerId: string, approve: boolean) => {
    const mv = res!.moves.find((m) => m.sellerId === sellerId)!;
    await saveRecommendation({
      id: uid(),
      kind: 'store',
      createdAt: new Date().toISOString(),
      createdBy: me!.id,
      title: `${names.seller(sellerId)}: ${names.store(mv.fromStoreId)} ← ${names.store(mv.toStoreId)}`,
      explanation: mv.reasons.join(' · '),
      score: mv.gain,
      status: approve ? 'approved' : 'rejected',
      payload: { regionId: rid, ...mv },
    });
    if (approve) {
      const s = names.sellerObj(sellerId)!;
      await upsertSeller({ ...s, storeId: mv.toStoreId });
    }
    setDone((d) => ({ ...d, [sellerId]: approve ? 'approved' : 'rejected' }));
  };

  return (
    <div className="stack">
      <Section title="שיבוץ לחנות">
        <p className="muted small">
          לכל מוכרת נבדקת ההתאמה לכל סניף באזור: האם היא חזקה בקטגוריות שהסניף מוכר, בשעות שבהן הסניף עמוס, ובסוג הסל שלו (פרימיום או כמות). המערכת מוצאת את השיבוץ הטוב
          ביותר לכל האזור, בלי לשנות את מספר המוכרות בכל סניף, ומציעה מעבר רק כשהשיפור הצפוי גבוה מ-8% (מעבר עולה משהו). מקדמות מותג ומנהלות לא נכללות.
        </p>
        <div className="row gap">
          {regions.length > 1 && (
            <select value={rid} onChange={(e) => setRid(e.target.value)} aria-label="אזור">
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn primary" onClick={run}>
            חישוב שיבוץ
          </button>
        </div>
      </Section>
      {res && (
        <Section title={`מעברים מומלצים (${res.moves.length})`}>
          {!res.moves.length ? (
            <Empty>השיבוץ הנוכחי כבר מתאים. אין מעבר שמצדיק את השינוי.</Empty>
          ) : (
            <>
              <div className="summary-line">
                שיפור צפוי לאזור: <b className="good">+{money(res.newTotal - res.currentTotal)}</b> בשבוע ({pct(safeDiv(res.newTotal - res.currentTotal, res.currentTotal), 1)})
              </div>
              <ul className="rec-list">
                {res.moves.map((m) => (
                  <li key={m.sellerId} className="rec">
                    <div className="row between">
                      <b>{names.seller(m.sellerId)}</b>
                      <span className={m.gain >= 0 ? 'good' : 'bad'}>
                        {m.gain >= 0 ? '+' : ''}
                        {money(m.gain)}/שבוע
                      </span>
                    </div>
                    <div>
                      {names.store(m.fromStoreId)} ← <b>{names.store(m.toStoreId)}</b>
                    </div>
                    {m.reasons.length > 0 && (
                      <ul className="notes">
                        {m.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                    {m.gain < 0 && <p className="muted tiny">המעבר הזה הוא חלק מהחלפה: הוא מפנה מקום למוכרת שמתאימה יותר.</p>}
                    {done[m.sellerId] ? (
                      <div className={done[m.sellerId] === 'approved' ? 'good small' : 'muted small'}>{done[m.sellerId] === 'approved' ? 'אושר, וסניף הבית עודכן' : 'נדחה'}</div>
                    ) : (
                      <div className="row gap">
                        <button className="btn primary small" onClick={() => decide(m.sellerId, true)}>
                          אישור
                        </button>
                        <button className="btn ghost small" onClick={() => decide(m.sellerId, false)}>
                          דחייה
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}
    </div>
  );
}

function MentoringTab({ regionId }: { regionId: string | null }) {
  const { data, me, getAnalysis, saveRecommendation } = useApp();
  const names = useNames();
  const regions = me!.role === 'admin' ? data!.regions : data!.regions.filter((r) => r.id === regionId);
  const [rid, setRid] = useState(regionId ?? regions[0]?.id ?? '');
  const [matches, setMatches] = useState<MentorMatch[] | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  const run = () => {
    setMatches(
      matchMentors({
        sellers: data!.sellers.filter((s) => data!.stores.find((x) => x.id === s.storeId)?.regionId === rid),
        stores: data!.stores,
        profiles: getAnalysis().profiles,
      }),
    );
    setDone({});
  };

  const decide = async (m: MentorMatch, approve: boolean) => {
    await saveRecommendation({
      id: uid(),
      kind: 'mentoring',
      createdAt: new Date().toISOString(),
      createdBy: me!.id,
      title: `${names.seller(m.mentorId)} חונכת את ${names.seller(m.menteeId)} ב${SKILL_LABEL[m.skill]}`,
      explanation: m.explanation,
      score: m.mentorValue - m.menteeValue,
      status: approve ? 'approved' : 'rejected',
      payload: { regionId: rid, ...m, startDate: dateKey(new Date()) },
    });
    setDone((d) => ({ ...d, [m.menteeId]: approve ? 'approved' : 'rejected' }));
  };

  const active = data!.recommendations.filter((r) => r.kind === 'mentoring' && r.status === 'approved' && (r.payload.regionId === rid || me!.role === 'admin'));

  return (
    <div className="stack">
      <Section title="חונכות בין סניפים">
        <p className="muted small">
          לכל מיומנות (סיפתוח, הגדלה, פריטים לעסקה, סל ממוצע, המרה, וכל קטגוריה) המערכת מזהה מוכרות ברבעון התחתון של האזור, ומצמידה לכל אחת חונכת מהרבעון העליון מסניף
          אחר. כל חונכת מקבלת עד 2 חניכות. אחרי האישור המערכת מודדת את המיומנות לפני החונכות ואחריה.
        </p>
        <div className="row gap">
          {regions.length > 1 && (
            <select value={rid} onChange={(e) => setRid(e.target.value)} aria-label="אזור">
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn primary" onClick={run}>
            איתור זוגות חונכות
          </button>
        </div>
      </Section>

      {matches && (
        <Section title={`הצעות (${matches.length})`}>
          {!matches.length ? (
            <Empty>לא נמצאו פערים משמעותיים.</Empty>
          ) : (
            <ul className="rec-list">
              {matches.map((m) => (
                <li key={m.menteeId} className="rec">
                  <div className="row between">
                    <b>{SKILL_LABEL[m.skill]}</b>
                    <span className="muted small">
                      {m.menteeValue.toFixed(2)} → יעד {m.goal.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    חונכת: <b>{names.seller(m.mentorId)}</b> ({names.store(names.sellerObj(m.mentorId)?.storeId ?? '')}) · חניכה: <b>{names.seller(m.menteeId)}</b> (
                    {names.store(names.sellerObj(m.menteeId)?.storeId ?? '')})
                  </div>
                  <p className="small">{m.explanation}</p>
                  <div className="muted tiny">ימים שבהם שתיהן זמינות: {m.jointDays.map((d) => WEEKDAY_LABEL[d]).join(', ')}</div>
                  {done[m.menteeId] ? (
                    <div className={done[m.menteeId] === 'approved' ? 'good small' : 'muted small'}>{done[m.menteeId] === 'approved' ? 'אושר' : 'נדחה'}</div>
                  ) : (
                    <div className="row gap">
                      <button className="btn primary small" onClick={() => decide(m, true)}>
                        אישור
                      </button>
                      <button className="btn ghost small" onClick={() => decide(m, false)}>
                        דחייה
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="חונכויות פעילות: מדידה">
        {!active.length ? (
          <Empty>אין חונכויות מאושרות.</Empty>
        ) : (
          <ul className="rec-list">
            {active.map((r) => {
              const p = r.payload as unknown as MentorMatch & { startDate: string };
              const ev = evaluateMentorship(data!, p.menteeId, p.skill as Skill, p.startDate, dateKey(new Date()));
              return (
                <li key={r.id} className="rec">
                  <b>{r.title}</b>
                  <div className="small">
                    התחלה {p.startDate} · לפני: {ev.before?.toFixed(2) ?? '—'} · אחרי ({ev.daysAfter} ימים): {ev.after?.toFixed(2) ?? 'עוד אין נתונים'}
                    {ev.change != null && (
                      <span className={ev.change >= 0 ? 'good' : 'bad'}>
                        {' '}
                        ({ev.change >= 0 ? '+' : ''}
                        {ev.change.toFixed(2)})
                      </span>
                    )}
                    {' '}· יעד {p.goal.toFixed(2)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function HistoryTab({ regionId }: { regionId: string | null }) {
  const { data, me } = useApp();
  const list = data!.recommendations
    .filter((r) => me!.role === 'admin' || r.payload.regionId === regionId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const label = { pairing: 'זיווג', store: 'שיבוץ לחנות', mentoring: 'חונכות' } as const;
  return (
    <Section title="היסטוריית החלטות">
      {!list.length ? (
        <Empty>עדיין לא אושרו או נדחו המלצות.</Empty>
      ) : (
        <ul className="rec-list">
          {list.map((r) => (
            <li key={r.id} className="rec">
              <div className="row between">
                <b>{r.title}</b>
                <span className={r.status === 'approved' ? 'good small' : 'muted small'}>{r.status === 'approved' ? 'אושר' : r.status === 'rejected' ? 'נדחה' : 'הוצע'}</span>
              </div>
              <div className="muted tiny">
                {label[r.kind]} · {new Date(r.createdAt).toLocaleString('he-IL')}
              </div>
              {r.explanation && <p className="small">{r.explanation}</p>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function Recommendations() {
  const { data, me } = useApp();
  const regionId = regionOf(data!, me!);
  const isStoreManager = me!.role === 'store_manager';
  const [tab, setTab] = useState<Tab>('pairing');
  const tabs: { value: Tab; label: string }[] = isStoreManager
    ? [
        { value: 'pairing', label: 'זיווג משמרות' },
        { value: 'history', label: 'היסטוריה' },
      ]
    : [
        { value: 'pairing', label: 'זיווג' },
        { value: 'store', label: 'שיבוץ לחנות' },
        { value: 'mentoring', label: 'חונכות' },
        { value: 'history', label: 'היסטוריה' },
      ];
  return (
    <div className="stack">
      <Segmented value={tab} onChange={setTab} options={tabs} label="סוג המלצה" />
      {tab === 'pairing' && <PairingTab regionId={regionId} />}
      {tab === 'store' && <StoreTab regionId={regionId} />}
      {tab === 'mentoring' && <MentoringTab regionId={regionId} />}
      {tab === 'history' && <HistoryTab regionId={regionId} />}
    </div>
  );
}

