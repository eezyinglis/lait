import { useState } from 'react';
import { useData } from '../store';
import { db } from '../db';
import { countSets, workoutVolume } from '../lib/stats';
import { fmtDate, fmtDuration, fmtVolume, PR_LABEL } from '../lib/format';
import { newRoutine, startWorkout } from '../lib/actions';
import { back, go } from '../router';
import { SetTable } from '../components/SetTable';
import { supersetLabels } from '../components/ExerciseCard';
import { Empty, Header, Icon, Sheet } from '../components/ui';

export function WorkoutDetail({ id }: { id: string }) {
  const { workouts, exercises, types, prefs, history, active, ready } = useData();
  const [menu, setMenu] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const w = workouts.find(x => x.id === id);
  if (!w) return <div className="screen"><Header title="Workout" onBack /><Empty>{ready ? 'Workout not found.' : 'Loading…'}</Empty></div>;

  const prs = history.prsByWorkout.get(w.id);
  const prTotal = history.prCount.get(w.id) ?? 0;
  const labels = supersetLabels(w.exercises);
  const time = new Date(w.start * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="screen">
      <Header title="Workout" onBack right={<button className="icon-btn" aria-label="Workout options" onClick={() => setMenu(true)}><Icon name="more" /></button>} />
      <div className="detail-top">
        <h1>{w.name}</h1>
        <div className="muted">{fmtDate(w.start)} · {time}</div>
        {w.notes && <p className="wnotes">{w.notes}</p>}
        <div className="stats4">
          <div><span>Duration</span><b>{fmtDuration(w.end - w.start)}</b></div>
          <div><span>Volume</span><b>{fmtVolume(workoutVolume(w, types, prefs.volumeIncludesWarmups), prefs)}</b></div>
          <div><span>Sets</span><b>{countSets(w)}</b></div>
          <div><span>Records</span><b className={prTotal ? 'gold' : ''}>{prTotal}</b></div>
        </div>
      </div>

      {w.exercises.map((e, i) => {
        const ex = exercises.get(e.exId);
        const exPrs = prs?.get(i);
        return (
          <section key={i} className={'card' + (labels[i] ? ' superset' : '')}>
            <div className="ex-card-h">
              <button className="ex-card-title" onClick={() => go(`/exercise/${e.exId}`)}>{ex?.title ?? 'Unknown exercise'}</button>
              {labels[i] && <span className="ss-tag">{labels[i]}</span>}
            </div>
            {e.notes && <p className="wnotes">{e.notes}</p>}
            <SetTable sets={e.sets} type={ex?.type ?? 'weight_reps'} prefs={prefs} prs={exPrs} />
            {exPrs && (
              <div className="pr-list">
                {[...exPrs.values()].flat().map((p, k) => <div key={k} className="pr-line"><Icon name="trophy" size={14} /> {PR_LABEL[p.type]}</div>)}
              </div>
            )}
          </section>
        );
      })}

      <Sheet open={menu} onClose={() => setMenu(false)} title={w.name}>
        <div className="menu">
          <button className="menu-i" disabled={!!active} onClick={async () => { await startWorkout({ from: w }); go('/logger'); }}>
            <Icon name="play" size={18} /> {active ? 'Finish your current workout first' : 'Repeat this workout'}
          </button>
          <button className="menu-i" onClick={async () => { const rid = await newRoutine(w); go(`/routine/${rid}`); }}>
            <Icon name="list" size={18} /> Save as routine
          </button>
          <button className="menu-i danger" onClick={() => { setMenu(false); setConfirmDel(true); }}><Icon name="trash" size={18} /> Delete workout</button>
        </div>
      </Sheet>
      <Sheet open={confirmDel} onClose={() => setConfirmDel(false)} title="Delete this workout?">
        <div className="menu">
          <p className="muted pad">This can't be undone (unless you have a backup).</p>
          <button className="btn danger full" onClick={async () => { await db.workouts.delete(w.id); setConfirmDel(false); back(); }}>Delete</button>
          <button className="btn ghost full" onClick={() => setConfirmDel(false)}>Cancel</button>
        </div>
      </Sheet>
    </div>
  );
}
