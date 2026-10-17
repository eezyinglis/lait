// Muscle recovery UI: the list of recovering muscles and a readiness chip for routines.
import { useEffect, useMemo, useState } from 'react';
import { useData } from '../store';
import { muscleRecovery, PRIOR_HOURS, routineReadiness, type MuscleRecovery } from '../lib/recovery';
import { label } from '../lib/format';
import { Sheet } from './ui';

/** Recovery of every muscle trained in the last week, ticking forward every minute. */
export function useRecovery(): MuscleRecovery[] {
  const { workouts, exercises, recoveryCal } = useData();
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 60000); return () => clearInterval(t); }, []);
  return useMemo(() => muscleRecovery(workouts, exercises, now, recoveryCal.scale), [workouts, exercises, now, recoveryCal.scale]);
}

const tone = (pct: number) => (pct >= 90 ? 'ready' : pct >= 60 ? 'mid' : 'low');
const fmtH = (h: number) => (h <= 0 ? 'ready' : h < 24 ? `~${h} h` : `~${Math.round(h / 24 * 10) / 10} d`);

/** "Chest 62% · ready in ~13 h" chip for a routine (its least-recovered target muscle). */
export function RoutineReadiness({ exercises: exs }: { exercises: { exId: string }[] }) {
  const { exercises, prefs } = useData();
  const rec = useRecovery();
  if (!prefs.showRecovery) return null;
  const r = routineReadiness(exs, rec, exercises);
  if (!r.worst || r.worst.pct >= 90) return <span className="ready-tag ready">All target muscles recovered</span>;
  return (
    <span className={'ready-tag ' + tone(r.worst.pct)}>
      {label(r.worst.muscle)} {r.worst.pct}% · ready {fmtH(r.worst.hoursToReady)}
      {r.recovering.length > 1 ? ` · +${r.recovering.length - 1} more recovering` : ''}
    </span>
  );
}

export function RecoveryCard() {
  const { prefs, recoveryCal } = useData();
  const rec = useRecovery();
  const [info, setInfo] = useState(false);
  const [all, setAll] = useState(false);
  if (!prefs.showRecovery) return null;
  const recovering = rec.filter(r => r.pct < 90);
  const shown = all ? rec : recovering;
  const c = recoveryCal;
  const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

  return (
    <section className="card recovery">
      <div className="row between">
        <h3>Muscle recovery</h3>
        <button className="icon-btn sm" aria-label="How recovery is calculated" onClick={() => setInfo(true)}>ⓘ</button>
      </div>
      {rec.length === 0 && <p className="muted small">No training in the last 7 days: everything is fully recovered.</p>}
      {rec.length > 0 && recovering.length === 0 && !all && <p className="muted small">Everything you trained this week is recovered (90%+).</p>}
      {shown.map(r => (
        <div key={r.muscle} className="rec-row-m">
          <span>{label(r.muscle)}</span>
          <div className="rec-bar"><div className={tone(r.pct)} style={{ width: `${r.pct}%` }} /></div>
          <b>{r.pct}%</b>
          <span className="muted small">{fmtH(r.hoursToReady)}</span>
        </div>
      ))}
      {rec.length > recovering.length && (
        <button className="btn ghost sm" onClick={() => setAll(!all)}>{all ? 'Show only recovering' : `Show all ${rec.length} trained this week`}</button>
      )}

      <Sheet open={info} onClose={() => setInfo(false)} title="How recovery is calculated" tall>
        <div className="sheet-scroll info">
          <p>Each working set leaves fatigue on the muscle it trains (secondary muscles count half). Sets closer to failure count more:
            failure 100%, 1 RIR 85%, 2 RIR 70%, 3 RIR 55%; sets without RIR count 85%. Warm-ups don't count.</p>
          <p><b>Research starting point.</b> Fatigue fades to ~95% recovered in about {PRIOR_HOURS.biceps} h for small muscles
            (arms, calves, abs), {PRIOR_HOURS.chest} h for chest, back and shoulders, and {PRIOR_HOURS.quadriceps} h for legs and lower back.
            Training to failure lengthens recovery, and large multi-joint and lower-body work needs about 48–72 h.</p>
          <p><b>Your data.</b> {c.samples} sessions compare your top-set strength with how long ago that muscle was last trained:</p>
          <div className="cal-table">
            {c.bins.map(b => (
              <div key={b.label} className="kv"><span>{b.label}</span><span className="muted">{b.n} sessions</span>
                <b>{b.n && !isNaN(b.pct) ? (b.from >= 84 ? 'baseline' : pct(b.pct)) : '–'}</b></div>
            ))}
          </div>
          <p>
            {c.scale < 0.99 ? `You perform normally sooner than the research average, so LAIT uses recovery times about ${Math.round((1 - c.scale) * 100)}% shorter. `
              : c.scale > 1.01 ? `Your performance drops when you train a muscle again too soon, so LAIT uses recovery times about ${Math.round((c.scale - 1) * 100)}% longer. `
                : 'LAIT uses the research timings as-is. '}
            Because you mostly train a muscle again when it feels ready, "no drop" can only shorten the timings a little (max 20%).
          </p>
          <p className="muted small">Sources: Morán-Navarro et al. 2017 (Eur J Appl Physiol, training to failure and recovery time);
            studies on recovery time course after squat, bench and deadlift (e.g. PMC10101404); Pareja-Blanco et al. 2019 (Sports, effort and recovery).
            Recovery is an estimate: how you feel and perform on the day still wins.</p>
        </div>
      </Sheet>
    </section>
  );
}
