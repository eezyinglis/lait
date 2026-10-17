// "Next up" on Home: the routine your rotation says comes next, one tap to start.
import { useMemo, useState } from 'react';
import { useData } from '../store';
import { nextRoutine } from '../lib/schedule';
import { relDate } from '../lib/format';
import { StartSheet } from '../screens/Routines';
import { RoutineReadiness } from './Recovery';
import { Icon } from './ui';

export function NextUpCard() {
  const { workouts, routines, active } = useData();
  const [starting, setStarting] = useState(false);
  const next = useMemo(() => nextRoutine(workouts, routines, Date.now() / 1000), [workouts, routines]);
  if (!next || active) return null;
  const r = next.routine;
  return (
    <section className="card next-up">
      <div className="next-h">
        <span className="muted small">{next.reason === 'rotation' ? 'Next up in your rotation' : 'Next up'}</span>
        {next.lastDone && <span className="muted small">last done {relDate(next.lastDone).toLowerCase()}</span>}
      </div>
      <div className="next-title">{r.title}</div>
      <div className="muted small clamp2">{r.exercises.length} exercises</div>
      <RoutineReadiness exercises={r.exercises} />
      <button className="btn primary full" onClick={() => setStarting(true)}><Icon name="play" size={16} /> Start {r.title}</button>
      <StartSheet routine={starting ? r : null} onClose={() => setStarting(false)} />
    </section>
  );
}
