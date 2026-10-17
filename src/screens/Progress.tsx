import { useMemo, useState } from 'react';
import { useData } from '../store';
import { suggest, type Advice } from '../lib/overload';
import { num, relDate, toW, wUnit } from '../lib/format';
import { go } from '../router';
import { ADVICE, fmtWeeks, headlineText } from '../components/Suggestion';
import { Empty, Header, Segmented } from '../components/ui';

const ORDER: Advice[] = ['weight', 'reps', 'hold', 'plateau', 'return'];

/** Overview of every exercise trained recently, grouped by what to do next time. */
export function Progress() {
  const { history, exercises, prefs, overloadPrior } = useData();
  const [days, setDays] = useState<'60' | '180' | '3650'>('60');

  const rows = useMemo(() => {
    const now = Date.now() / 1000;
    const out: { id: string; title: string; s: NonNullable<ReturnType<typeof suggest>> }[] = [];
    for (const [id, sessions] of history.byExercise) {
      const ex = exercises.get(id);
      if (!ex || sessions[sessions.length - 1].start < now - Number(days) * 86400) continue;
      const s = suggest(sessions, ex.type, ex.equip, now, { prior: overloadPrior, fw: kg => `${num(toW(kg, prefs), 2)} ${wUnit(prefs)}` });
      if (s) out.push({ id, title: ex.title, s });
    }
    return out.sort((a, b) => b.s.lastDate - a.s.lastDate);
  }, [history, exercises, prefs, days, overloadPrior]);

  const counts = Object.fromEntries(ORDER.map(a => [a, rows.filter(r => r.s.advice === a).length]));

  return (
    <div className="screen">
      <Header title="Progressive overload" onBack />
      <div className="pad-x">
        <p className="muted small">
          Next-session targets paced by your real long-run progress (~{(overloadPrior * 100).toFixed(2)}% strength
          per week across your history), which slows the longer you train an exercise. Most sessions are about
          matching your best; extra reps or weight come when your recent sessions show the strength for them.
        </p>
        <Segmented value={days} onChange={setDays} options={[['60', 'Last 60 days'], ['180', '6 months'], ['3650', 'All']]} />
        <div className="adv-summary">
          {ORDER.map(a => counts[a] > 0 && (
            <span key={a} className={'adv-chip ' + ADVICE[a].cls}>{ADVICE[a].icon} {counts[a]} {ADVICE[a].label.toLowerCase()}</span>
          ))}
        </div>
      </div>
      {rows.length === 0 && <Empty>No exercises in this period.</Empty>}
      {ORDER.map(a => {
        const group = rows.filter(r => r.s.advice === a);
        if (!group.length) return null;
        return (
          <section key={a}>
            <h2 className="sec pad-x">{ADVICE[a].label}</h2>
            {group.map(({ id, title, s }) => {
              const { main, delta } = headlineText(s, prefs);
              return (
                <button key={id} className="card prog-row" onClick={() => go(`/exercise/${id}`)}>
                  <div className="prog-h">
                    <b>{title}</b>
                    <span className="muted small">{relDate(s.lastDate)}</span>
                  </div>
                  <div className="prog-t">
                    <span className={'adv-dot ' + ADVICE[a].cls}>{ADVICE[a].icon}</span>
                    <b>{main}</b> {delta && <span className="sugg-d">{delta}</span>}
                  </div>
                  {s.milestones.length > 1 && (
                    <div className="muted small">
                      Then: {s.milestones.slice(s.advice === 'weight' || s.advice === 'reps' ? 1 : 0, 3)
                        .map(m => `${num(toW(m.kg, prefs), 2)}×${m.reps} ${fmtWeeks(m.weeks)}`).join(' → ')}
                    </div>
                  )}
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
