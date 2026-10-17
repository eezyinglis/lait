import { useMemo, useState } from 'react';
import { useData } from '../store';
import { muscleSplit, weeklyTotals, workoutVolume, type WeeklyMetric } from '../lib/stats';
import { fmtDuration, label, toW, wUnit } from '../lib/format';
import { go } from '../router';
import { BarChart } from '../components/Chart';
import { DeloadBanner } from '../components/Banners';
import { Header, Icon, Segmented } from '../components/ui';

export function Profile() {
  const { workouts, types, prefs, exercises } = useData();
  const [metric, setMetric] = useState<WeeklyMetric>('duration');
  const [weeks, setWeeks] = useState(12);
  const nowS = Date.now() / 1000;

  // Durations are charted in hours so the axis gets round ticks (2h, 4h…).
  const data = useMemo(() => weeklyTotals(workouts, types, metric, weeks, nowS, prefs.volumeIncludesWarmups).map(b => ({
    x: b.week, y: metric === 'volume' ? toW(b.value, prefs) : metric === 'duration' ? b.value / 3600 : b.value,
    label: new Date(b.week * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    tip: `week of ${new Date(b.week * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
  })), [workouts, types, metric, weeks, prefs]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (v: number) =>
    metric === 'duration' ? `${Math.round(v * 10) / 10}h`
      : metric === 'volume' ? (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)))
        : String(Math.round(v));
  const readFmt = (v: number) =>
    metric === 'duration' ? (v ? fmtDuration(v * 3600) : '0m')
      : metric === 'volume' ? `${Math.round(v).toLocaleString('en-US')} ${wUnit(prefs)}`
        : metric === 'reps' ? `${v} reps` : `${v} workout${v === 1 ? '' : 's'}`;

  const totals = useMemo(() => ({
    time: workouts.reduce((a, w) => a + (w.end - w.start), 0),
    volume: workouts.reduce((a, w) => a + workoutVolume(w, types, prefs.volumeIncludesWarmups), 0),
    first: workouts.length ? workouts[workouts.length - 1].start : null,
  }), [workouts, types, prefs.volumeIncludesWarmups]);

  const split = useMemo(() => muscleSplit(workouts.filter(w => w.start >= nowS - 30 * 86400), exercises), [workouts, exercises]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxSplit = split[0]?.[1] ?? 1;

  return (
    <div className="screen">
      <Header title="Profile" right={<button className="icon-btn" aria-label="Settings" onClick={() => go('/settings')}><Icon name="gear" /></button>} />
      <section className="card">
        <div className="stats3">
          <div><span>Workouts</span><b>{workouts.length}</b></div>
          <div><span>Total time</span><b>{Math.round(totals.time / 3600)}h</b></div>
          <div><span>Total volume</span><b>{Math.round(toW(totals.volume, prefs) / 1000).toLocaleString('en-US')}t</b></div>
        </div>
        {totals.first && <div className="muted small center-t">Training since {new Date(totals.first * 1000).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>}
      </section>

      <DeloadBanner />
      <section className="card links">
        {([
          ['/progress', '↑', 'Progressive overload', 'What to add next session, for every exercise'],
          ['/report', '★', 'Monthly report', 'Records, gains, consistency and stalled lifts'],
          ['/balance', '⚖', 'Muscle balance', 'Weekly sets per muscle vs your target'],
          ['/body', '♥', 'Body', 'Weight, measurements and progress photos'],
        ] as const).map(([path, ic, title, sub]) => (
          <button key={path} className="prog-link" onClick={() => go(path)}>
            <span className="prog-link-ic">{ic}</span>
            <span className="grow"><b>{title}</b><br /><span className="muted small">{sub}</span></span>
            <Icon name="chevron" size={18} />
          </button>
        ))}
      </section>

      <section className="card">
        <Segmented value={metric} onChange={setMetric} options={[['duration', 'Duration'], ['volume', `Volume (${wUnit(prefs)})`], ['reps', 'Reps'], ['workouts', 'Workouts']]} />
        <BarChart data={data} fmt={fmt} readFmt={readFmt} />
        <div className="chips center">
          {[12, 26, 52].map(n => <button key={n} className={'chip' + (weeks === n ? ' on' : '')} onClick={() => setWeeks(n)}>{n === 52 ? '1 year' : `${n} weeks`}</button>)}
        </div>
      </section>

      <Calendar />

      {split.length > 0 && (
        <section className="card">
          <h3>Muscle split · last 30 days</h3>
          <div className="muted small">Working sets (secondary muscles count ½)</div>
          {split.slice(0, 10).map(([m, v]) => (
            <div key={m} className="split-row">
              <span>{label(m)}</span>
              <div className="split-bar"><div style={{ width: `${(v / maxSplit) * 100}%` }} /></div>
              <b>{Math.round(v)}</b>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Calendar() {
  const { workouts } = useData();
  const [offset, setOffset] = useState(0);
  const base = new Date();
  const month = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = (month.getDay() + 6) % 7; // Monday first
  const byDay = new Map<number, string>();
  for (const w of workouts) {
    const d = new Date(w.start * 1000);
    if (d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth()) byDay.set(d.getDate(), w.id);
  }
  const today = new Date();
  return (
    <section className="card">
      <div className="row between">
        <button className="icon-btn" aria-label="Previous month" onClick={() => setOffset(o => o - 1)}><Icon name="back" /></button>
        <h3>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · {byDay.size}</h3>
        <button className="icon-btn flip" aria-label="Next month" disabled={offset >= 0} onClick={() => setOffset(o => o + 1)}><Icon name="back" /></button>
      </div>
      <div className="cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="cal-h">{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={'l' + i} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1, wid = byDay.get(d);
          const isToday = offset === 0 && d === today.getDate();
          return (
            <button key={d} className={'cal-d' + (wid ? ' on' : '') + (isToday ? ' today' : '')} disabled={!wid} onClick={() => wid && go(`/workout/${wid}`)}>{d}</button>
          );
        })}
      </div>
    </section>
  );
}
