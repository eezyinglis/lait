import { useMemo, useState } from 'react';
import { useData } from '../store';
import { balanceWarnings, monthlyReport, muscleVolume } from '../lib/training';
import { fmtDuration, fmtVolume, label } from '../lib/format';
import { go } from '../router';
import { Empty, Header, Icon } from '../components/ui';

/** Weekly working sets per muscle against your target band, plus balance warnings. */
export function Balance() {
  const { workouts, exercises, prefs } = useData();
  const band = prefs.volumeBand;
  const vol = useMemo(() => muscleVolume(workouts, exercises, Date.now() / 1000, band), [workouts, exercises, band]);
  const warnings = useMemo(() => balanceWarnings(vol), [vol]);
  const max = Math.max(band[1] * 1.25, ...vol.map(v => v.perWeek));
  return (
    <div className="screen">
      <Header title="Muscle balance" onBack />
      <div className="pad-x">
        <p className="muted small">
          Working sets per week over the last 4 weeks (secondary muscles count ½). The shaded band is your target,
          {' '}{band[0]}–{band[1]} sets, which you can change in Settings. Arrows compare with the 4 weeks before.
        </p>
      </div>
      {warnings.length > 0 && (
        <section className="card warn-card">
          {warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
        </section>
      )}
      <section className="card">
        {vol.length === 0 && <Empty>No training in the last 8 weeks.</Empty>}
        {vol.map(v => {
          const trend = v.prevPerWeek ? v.perWeek / v.prevPerWeek - 1 : 0;
          return (
            <div key={v.muscle} className="bal-row">
              <span>{label(v.muscle)}</span>
              <div className="bal-track">
                <div className="bal-band" style={{ left: `${(band[0] / max) * 100}%`, width: `${((band[1] - band[0]) / max) * 100}%` }} />
                <div className={'bal-bar ' + v.status} style={{ width: `${Math.min(100, (v.perWeek / max) * 100)}%` }} />
              </div>
              <b>{v.perWeek.toFixed(1)}</b>
              <span className={'bal-trend ' + (trend > 0.15 ? 'up' : trend < -0.15 ? 'down' : '')}>
                {trend > 0.15 ? '↑' : trend < -0.15 ? '↓' : '·'}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** Month in review, generated on the phone. */
export function Report() {
  const { workouts, history, types, prefs, exercises } = useData();
  const now = new Date();
  const [offset, setOffset] = useState(0);
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const r = useMemo(() => monthlyReport(workouts, history, types, d.getFullYear(), d.getMonth(), prefs.weeklyTarget, prefs.volumeIncludesWarmups),
    [workouts, history, types, offset, prefs.weeklyTarget, prefs.volumeIncludesWarmups]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => exercises.get(id)?.title ?? '?';
  const delta = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%` : '');
  return (
    <div className="screen">
      <Header title="Monthly report" onBack />
      <div className="row between pad-x">
        <button className="icon-btn" aria-label="Previous month" onClick={() => setOffset(o => o - 1)}><Icon name="back" /></button>
        <h2>{d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
        <button className="icon-btn flip" aria-label="Next month" disabled={offset >= 0} onClick={() => setOffset(o => o + 1)}><Icon name="back" /></button>
      </div>
      {r.workouts === 0 ? <Empty>No workouts this month.</Empty> : (
        <>
          <section className="card">
            <div className="stats3">
              <div><span>Workouts</span><b>{r.workouts}</b>{r.prev && <small className="muted"> {delta(r.workouts, r.prev.workouts)}</small>}</div>
              <div><span>Time</span><b>{fmtDuration(r.seconds)}</b></div>
              <div><span>Volume</span><b>{fmtVolume(r.volume, prefs)}</b>{r.prev && <small className="muted"> {delta(r.volume, r.prev.volume)}</small>}</div>
            </div>
            <div className="stats3">
              <div><span>Sets</span><b>{r.sets}</b></div>
              <div><span>Records</span><b className="gold"><Icon name="trophy" size={14} /> {r.prs}</b></div>
              <div><span>Weeks at {r.targetPerWeek}+</span><b>{r.weeksHit}/{r.weeksTotal}</b></div>
            </div>
          </section>
          {r.gains.length > 0 && (
            <section className="card">
              <h3>Biggest strength gains</h3>
              {r.gains.map(g => (
                <button key={g.exId} className="kv rowbtn" onClick={() => go(`/exercise/${g.exId}`)}><span>{name(g.exId)}</span><b className="good">+{(g.pct * 100).toFixed(1)}%</b></button>
              ))}
              <div className="muted small">Best estimated 1RM this month vs last month.</div>
            </section>
          )}
          {r.topPrs.length > 0 && (
            <section className="card">
              <h3><Icon name="trophy" size={16} /> Most records</h3>
              {r.topPrs.map(p => <button key={p.exId} className="kv rowbtn" onClick={() => go(`/exercise/${p.exId}`)}><span>{name(p.exId)}</span><b>{p.count}</b></button>)}
            </section>
          )}
          {r.stalled.length > 0 && (
            <section className="card">
              <h3>Stalled this month</h3>
              {r.stalled.map(p => <button key={p.exId} className="kv rowbtn" onClick={() => go(`/exercise/${p.exId}`)}><span>{name(p.exId)}</span><span className="muted">{p.sessions} sessions, no gain</span></button>)}
              <div className="muted small">Open one to see its plateau playbook.</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
