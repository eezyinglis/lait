import { useEffect, useState } from 'react';
import { useData } from '../store';
import { db } from '../db';
import { newRoutine, saveRoutine, startWorkout } from '../lib/actions';
import { back, go } from '../router';
import type { Routine } from '../types';
import { ExerciseCard, listOps, supersetLabels } from '../components/ExerciseCard';
import { ExercisePicker } from '../components/ExercisePicker';
import { Empty, Header, Icon, Sheet } from '../components/ui';
import { estimateMinutes, timeBox } from '../lib/training';

/** Starts a workout, or simply opens the one already running. */
async function start(r?: Routine) {
  await startWorkout(r ? { routine: r } : {});
  go('/logger');
}

/** Asks how much time you have and starts the routine trimmed to fit (priority lifts first are kept). */
export function StartSheet({ routine, onClose }: { routine: Routine | null; onClose: () => void }) {
  const { prefs, exercises } = useData();
  if (!routine) return null;
  const full = estimateMinutes(routine.exercises, prefs.defaultRest);
  const options = [30, 45, 60, 75, 90].filter(m => m < full);
  return (
    <Sheet open onClose={onClose} title={`Start ${routine.title}`}>
      <div className="menu">
        <button className="menu-i" onClick={async () => { onClose(); await startWorkout({ routine }); go('/logger'); }}>
          <Icon name="play" size={18} /> <span className="grow">Full routine</span><span className="muted">~{full} min</span>
        </button>
        {options.length > 0 && <div className="menu-label">Short on time?</div>}
        {options.map(m => {
          const t = timeBox(routine.exercises, m, prefs.defaultRest);
          const cut = t.dropped.map(id => exercises.get(id)?.title ?? '?');
          const fewer = routine.exercises.reduce((a, e) => a + e.sets.length, 0) - t.exercises.reduce((a, e) => a + e.sets.length, 0);
          return (
            <button key={m} className="menu-i" onClick={async () => { onClose(); await startWorkout({ routine, exercises: t.exercises }); go('/logger'); }}>
              <Icon name="timer" size={18} />
              <span className="grow">{m} minutes<br /><span className="muted small">
                {fewer} fewer sets{cut.length ? ` · skips ${cut.join(', ')}` : ''}
              </span></span>
              <span className="muted">~{t.minutes} min</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

export function Routines() {
  const { routines, exercises, active } = useData();
  const [starting, setStarting] = useState<Routine | null>(null);
  return (
    <div className="screen">
      <Header title="Workout" />
      <div className="pad-x">
        <h2 className="sec">Quick start</h2>
        <button className="btn ghost full big-start" onClick={() => start()}>
          <Icon name="plus" size={20} /> {active ? 'Resume workout in progress' : 'Start empty workout'}
        </button>
        <div className="row between">
          <h2 className="sec">Routines</h2>
          <button className="btn ghost sm" onClick={async () => go(`/routine/${await newRoutine()}`)}><Icon name="plus" size={16} /> New</button>
        </div>
      </div>
      {routines.length === 0 && <Empty>No routines yet.</Empty>}
      {routines.map(r => (
        <div key={r.id} className="card rcard">
          <button className="rcard-main" onClick={() => go(`/routine/${r.id}`)}>
            <div className="rcard-title">{r.title}</div>
            <div className="muted small clamp2">{r.exercises.map(e => exercises.get(e.exId)?.title ?? '?').join(', ') || 'No exercises'}</div>
          </button>
          <button className="btn primary full" disabled={!!active || r.exercises.length === 0} onClick={() => setStarting(r)}>Start routine</button>
        </div>
      ))}
      <StartSheet routine={starting} onClose={() => setStarting(null)} />
    </div>
  );
}

export function RoutineEditor({ id }: { id: string }) {
  const { routines, exercises, prefs, active, ready } = useData();
  const stored = routines.find(r => r.id === id);
  const [r, setR] = useState<Routine | null>(stored ?? null);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [starting, setStarting] = useState<Routine | null>(null);
  useEffect(() => { if (stored && !r) setR(stored); }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!r) return <div className="screen"><Header title="Routine" onBack /><Empty>{ready ? 'Routine not found.' : 'Loading…'}</Empty></div>;
  const edit = (next: Routine) => { setR(next); setDirty(true); };
  const ops = listOps(r.exercises, exs => edit({ ...r, exercises: exs }));
  const labels = supersetLabels(r.exercises);
  const save = async () => { await saveRoutine(r); setDirty(false); };

  return (
    <div className="screen">
      <Header title="Routine" onBack={async () => { if (dirty) await save(); back('/routines'); }}
        right={<>
          {dirty && <button className="btn primary sm" onClick={save}>Save</button>}
          <button className="icon-btn" aria-label="Routine options" onClick={() => setMenu(true)}><Icon name="more" /></button>
        </>} />
      <div className="pad-x">
        <input className="title-input" value={r.title} onChange={e => edit({ ...r, title: e.target.value })} aria-label="Routine name" />
        <textarea className="notes" rows={1} placeholder="Routine notes" value={r.notes} onChange={e => edit({ ...r, notes: e.target.value })} />
        <button className="btn primary full" disabled={!!active || r.exercises.length === 0}
          onClick={async () => { await save(); setStarting(r); }}>
          <Icon name="play" size={16} /> Start routine
        </button>
      </div>
      {r.exercises.map((ex, i) => (
        <ExerciseCard key={i + ex.exId} ex={ex} exercise={exercises.get(ex.exId)} prefs={prefs} mode="routine" previous={[]}
          supersetLabel={labels[i]} onChange={e => ops.change(i, e)} onRemove={() => ops.remove(i)}
          onMove={d => ops.move(i, d)} onToggleSuperset={() => ops.toggleSuperset(i)} />
      ))}
      <div className="log-actions">
        <button className="btn ghost full" onClick={() => setPicker(true)}><Icon name="plus" size={18} /> Add exercise</button>
      </div>
      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={ids => ops.add(ids)} />
      <StartSheet routine={starting} onClose={() => setStarting(null)} />
      <Sheet open={menu} onClose={() => setMenu(false)} title={r.title}>
        <div className="menu">
          <button className="menu-i" onClick={async () => { await saveRoutine({ ...r, id: crypto.randomUUID(), title: r.title + ' (copy)', order: routines.length }); setMenu(false); go('/routines'); }}>
            Duplicate routine
          </button>
          <button className="menu-i danger" onClick={async () => { await db.routines.delete(r.id); setMenu(false); go('/routines'); }}>
            <Icon name="trash" size={18} /> Delete routine
          </button>
        </div>
      </Sheet>
    </div>
  );
}
