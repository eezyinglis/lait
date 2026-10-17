import { useMemo, useState } from 'react';
import { useData } from '../store';
import { oneRepMax, prTypesFor, setVolume, usesDistance, usesDuration, usesReps, usesWeight } from '../lib/stats';
import { dUnit, fmtDate, fmtDuration, label, num, PR_LABEL, toD, toW, wUnit } from '../lib/format';
import { go } from '../router';
import type { PRType, WSet } from '../types';
import { CustomExerciseForm, ExerciseRow, Filters, TYPE_LABEL, useExerciseList } from '../components/ExercisePicker';
import { LineChart } from '../components/Chart';
import { SetTable } from '../components/SetTable';
import { SuggestionCard, useSuggestion } from '../components/Suggestion';
import { project } from '../lib/overload';
import { PlaybookCard, SidesCard } from '../components/ExerciseInsights';
import { Empty, Header, Icon, Segmented, Sheet } from '../components/ui';

export function Exercises() {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('');
  const [equip, setEquip] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useExerciseList(q, muscle, equip);
  const [all, setAll] = useState(false);
  const shown = all || q || muscle || equip ? list : list.filter(x => x.uses > 0);
  return (
    <div className="screen">
      <Header title="Exercises" right={<button className="icon-btn" aria-label="New exercise" onClick={() => setCreating(true)}><Icon name="plus" /></button>} />
      <div className="pad-x"><Filters {...{ q, setQ, muscle, setMuscle, equip, setEquip }} /></div>
      {!q && !muscle && !equip && (
        <div className="pad-x"><Segmented value={all ? 'all' : 'mine'} onChange={v => setAll(v === 'all')} options={[['mine', 'My exercises'], ['all', 'Library']]} /></div>
      )}
      <div className="list">
        {shown.slice(0, 300).map(({ e, uses }) => <ExerciseRow key={e.id} e={e} uses={uses} onClick={() => go(`/exercise/${e.id}`)} />)}
        {shown.length === 0 && <Empty>No exercises.</Empty>}
      </div>
      <Sheet open={creating} onClose={() => setCreating(false)} title="New exercise">
        <CustomExerciseForm initialTitle={q} onDone={id => { setCreating(false); if (id) go(`/exercise/${id}`); }} />
      </Sheet>
    </div>
  );
}

type Metric = '1rm' | 'weight' | 'volume' | 'reps' | 'duration' | 'distance';

export function ExerciseDetail({ id }: { id: string }) {
  const { exercises, history, prefs, ready } = useData();
  const [tab, setTab] = useState<'summary' | 'history'>('summary');
  const ex = exercises.get(id);
  const sessions = history.byExercise.get(id) ?? [];
  const records = history.records.get(id) ?? {};
  const t = ex?.type ?? 'weight_reps';

  const metrics = useMemo(() => {
    const m: [Metric, string][] = [];
    if (t === 'weight_reps') m.push(['1rm', 'Best 1RM'], ['weight', 'Heaviest'], ['volume', 'Session volume']);
    else if (usesWeight(t)) m.push(['weight', 'Heaviest']);
    if (usesReps(t)) m.push(['reps', t === 'weight_reps' ? 'Total reps' : 'Most reps']);
    if (usesDuration(t)) m.push(['duration', 'Best time']);
    if (usesDistance(t)) m.push(['distance', 'Distance']);
    return m;
  }, [t]);
  const [metric, setMetric] = useState<Metric | null>(null);
  const [range, setRange] = useState<'26' | '52' | 'all'>('52');
  const sugg = useSuggestion(id);
  const cur = metric ?? metrics[0]?.[0] ?? 'reps';

  if (!ex) return <div className="screen"><Header title="Exercise" onBack /><Empty>{ready ? 'Exercise not found.' : 'Loading…'}</Empty></div>;

  const work = (sets: WSet[]) => sets.filter(s => s.type !== 'warmup');
  const value = (sets: WSet[]): number => {
    const ws = work(sets);
    switch (cur) {
      case '1rm': return Math.max(0, ...ws.map(s => oneRepMax(s.kg, s.reps)));
      case 'weight': return Math.max(0, ...ws.map(s => s.kg ?? 0));
      case 'volume': return sets.reduce((a, s) => a + setVolume(s, t), 0);
      case 'reps': return t === 'weight_reps' ? ws.reduce((a, s) => a + (s.reps ?? 0), 0) : Math.max(0, ...ws.map(s => s.reps ?? 0));
      case 'duration': return Math.max(0, ...ws.map(s => s.sec ?? 0));
      case 'distance': return Math.max(0, ...ws.map(s => s.m ?? 0));
    }
  };
  const fmt = (v: number) =>
    cur === '1rm' || cur === 'weight' ? `${num(toW(v, prefs), 1)}`
      : cur === 'volume' ? `${Math.round(toW(v, prefs)).toLocaleString('en-US')}`
        : cur === 'duration' ? fmtDuration(v)
          : cur === 'distance' ? (t === 'short_distance_weight' ? `${num(v, 0)}m` : `${num(toD(v, prefs), 2)}`) : String(v);
  const unit = cur === '1rm' || cur === 'weight' || cur === 'volume' ? wUnit(prefs) : cur === 'distance' && t !== 'short_distance_weight' ? dUnit(prefs) : '';
  const nowS = Date.now() / 1000;
  const from = range === 'all' ? 0 : nowS - Number(range) * 7 * 86400;
  const points = sessions.filter(s => s.start >= from).map(s => ({
    x: s.start, y: value(s.ex.sets),
    label: new Date(s.start * 1000).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
    tip: `${unit} · ${fmtDate(s.start)}`,
  })).filter(p => p.y > 0);
  // Expected 1RM over the next 16 weeks on the slowing curve (not shown while returning from a break).
  const projection = cur === '1rm' && sugg && sugg.rate > 0 && sugg.advice !== 'return'
    ? Array.from({ length: 17 }, (_, w) => ({ x: nowS + w * 7 * 86400, y: project(sugg.e1rm, sugg.rate, w) }))
    : undefined;

  const recVal = (k: PRType, v: number) =>
    k === 'best_weight' || k === 'best_1rm' || k === 'best_volume' ? `${num(toW(v, prefs), 1)} ${wUnit(prefs)}`
      : k === 'best_duration' ? fmtDuration(v) : k === 'best_distance' ? (t === 'short_distance_weight' ? `${num(v, 0)} m` : `${num(toD(v, prefs), 2)} ${dUnit(prefs)}`) : `${v} reps`;

  return (
    <div className="screen">
      <Header title={ex.title} onBack sub={`${label(ex.muscle)}${ex.other.length ? ' · ' + ex.other.map(label).join(', ') : ''}`} />
      <div className="pad-x">
        <Segmented value={tab} onChange={setTab} options={[['summary', 'Summary'], ['history', `History (${sessions.length})`]]} />
      </div>

      {tab === 'summary' && (
        <>
          {sugg && <SuggestionCard s={sugg} />}
          <PlaybookCard exId={id} s={sugg} />
          <SidesCard exId={id} />
          {points.length > 0 ? (
            <section className="card">
              <div className="chips">
                {metrics.map(([k, l]) => <button key={k} className={'chip' + (cur === k ? ' on' : '')} onClick={() => setMetric(k)}>{l}</button>)}
              </div>
              <LineChart data={points} fmt={fmt} projection={projection} />
              <div className="chips center">
                {([['26', '6 months'], ['52', '1 year'], ['all', 'All']] as const).map(([k, l]) => (
                  <button key={k} className={'chip' + (range === k ? ' on' : '')} onClick={() => setRange(k)}>{l}</button>
                ))}
              </div>
              {projection && <div className="muted small center-t"><span className="legend-proj" /> expected next 16 weeks at your pace</div>}
            </section>
          ) : sessions.length ? <Empty>No sessions in this period.</Empty> : <Empty>You haven't done this exercise yet.</Empty>}
          {Object.keys(records).length > 0 && (
            <section className="card">
              <h3><Icon name="trophy" size={16} /> Personal records</h3>
              {prTypesFor(t).filter(k => records[k]).map(k => (
                <button key={k} className="rec-row" onClick={() => go(`/workout/${records[k]!.workoutId}`)}>
                  <span>{PR_LABEL[k]}</span>
                  <b>{recVal(k, records[k]!.value)}</b>
                  <span className="muted small">{fmtDate(records[k]!.start)}</span>
                </button>
              ))}
            </section>
          )}
          <section className="card">
            <div className="kv"><span>Tracking</span><b>{TYPE_LABEL[t]}</b></div>
            <div className="kv"><span>Equipment</span><b>{label(ex.equip)}</b></div>
            <div className="kv"><span>Times done</span><b>{sessions.length}</b></div>
          </section>
        </>
      )}

      {tab === 'history' && (
        <>
          {sessions.length === 0 && <Empty>No history yet.</Empty>}
          {[...sessions].reverse().map(s => (
            <section key={s.workoutId} className="card">
              <button className="hist-h" onClick={() => go(`/workout/${s.workoutId}`)}>
                <b>{s.workoutName}</b><span className="muted small">{fmtDate(s.start)}</span>
              </button>
              {s.ex.notes && <p className="wnotes">{s.ex.notes}</p>}
              <SetTable sets={s.ex.sets} type={t} prefs={prefs} prs={s.prs} />
            </section>
          ))}
        </>
      )}
    </div>
  );
}
