// Edit a saved workout: name, date and time, duration, gym, notes, exercises and sets.
// Records and statistics are derived from history, so they update automatically after saving.
import { useEffect, useState } from 'react';
import { useData } from '../store';
import { db } from '../db';
import { back } from '../router';
import type { Illness, Workout } from '../types';
import { ILLNESS } from '../lib/overload';
import { ExerciseCard, listOps, supersetLabels } from '../components/ExerciseCard';
import { ExercisePicker } from '../components/ExercisePicker';
import { Empty, Header, Icon, Sheet } from '../components/ui';

/** `YYYY-MM-DDTHH:mm` in local time, for <input type="datetime-local">. */
const toLocalInput = (sec: number) => {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function EditWorkout({ id }: { id: string }) {
  const { workouts, exercises, prefs, gyms, ready } = useData();
  const stored = workouts.find(w => w.id === id);
  const [w, setW] = useState<Workout | null>(stored ?? null);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState(false);
  const [leave, setLeave] = useState(false);
  useEffect(() => { if (stored && !w) setW(stored); }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!w) return <div className="screen"><Header title="Edit workout" onBack /><Empty>{ready ? 'Workout not found.' : 'Loading…'}</Empty></div>;

  const edit = (next: Workout) => { setW(next); setDirty(true); };
  const ops = listOps(w.exercises, exs => edit({ ...w, exercises: exs }));
  const labels = supersetLabels(w.exercises);
  const minutes = Math.max(1, Math.round((w.end - w.start) / 60));

  const save = async () => {
    // Drop empty sets and exercises; strip logger-only flags.
    const clean: Workout = {
      ...w,
      name: w.name.trim() || 'Workout',
      exercises: w.exercises
        .map(({ auto: _a, ...e }) => ({
          ...e,
          sets: e.sets
            .filter(s => s.kg != null || s.reps != null || s.sec != null || s.m != null)
            .map(({ done: _d, ...s }) => s),
        }))
        .filter(e => e.sets.length),
    };
    await db.workouts.put(clean);
    setDirty(false);
    back(`/workout/${w.id}`);
  };

  return (
    <div className="screen">
      <Header title="Edit workout" sub={dirty ? 'Unsaved changes' : undefined}
        onBack={() => (dirty ? setLeave(true) : back(`/workout/${w.id}`))}
        right={<button className="btn primary sm" disabled={!dirty} onClick={save}>Save</button>} />
      <div className="pad-x form edit-meta">
        <input className="title-input" value={w.name} onChange={e => edit({ ...w, name: e.target.value })} aria-label="Workout name" />
        <label className="inline">Started
          <input type="datetime-local" value={toLocalInput(w.start)} max={toLocalInput(Date.now() / 1000)}
            onChange={e => {
              const s = Math.floor(new Date(e.target.value).getTime() / 1000);
              if (!isNaN(s)) edit({ ...w, start: s, end: s + (w.end - w.start) });
            }} />
        </label>
        <label className="inline">Duration (min)
          <input className="num short" inputMode="numeric" value={minutes}
            onChange={e => { const m = Number(e.target.value); if (m > 0 && m < 600) edit({ ...w, end: w.start + m * 60 }); }} />
        </label>
        {gyms.length > 0 && (
          <label className="inline">Gym
            <select value={w.gymId ?? ''} onChange={e => edit({ ...w, gymId: e.target.value || null })}>
              <option value="">No specific gym</option>
              {gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
        <label className="inline">Illness
          <select value={w.illness ?? ''} onChange={e => edit({ ...w, illness: (e.target.value || null) as Illness | null })}>
            <option value="">Healthy</option>
            {(Object.keys(ILLNESS) as Illness[]).map(k => <option key={k} value={k}>{ILLNESS[k].label}</option>)}
          </select>
        </label>
        <textarea className="notes" rows={2} placeholder="Workout notes" value={w.notes} onChange={e => edit({ ...w, notes: e.target.value })} />
      </div>

      {w.exercises.map((ex, i) => (
        <ExerciseCard key={i + ex.exId} ex={ex} exercise={exercises.get(ex.exId)} prefs={prefs} mode="routine" previous={[]}
          showSuggestion={false} rirInput gymId={w.gymId ?? null} supersetLabel={labels[i]}
          onChange={e => ops.change(i, e)} onRemove={() => ops.remove(i)} onMove={d => ops.move(i, d)} onToggleSuperset={() => ops.toggleSuperset(i)} />
      ))}
      <div className="log-actions">
        <button className="btn ghost full" onClick={() => setPicker(true)}><Icon name="plus" size={18} /> Add exercise</button>
        <p className="muted small center-t">Empty sets are removed when you save. Records and stats update automatically.</p>
      </div>
      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={ids => ops.add(ids)} />

      <Sheet open={leave} onClose={() => setLeave(false)} title="Save your changes?">
        <div className="menu">
          <button className="btn primary full" onClick={save}>Save</button>
          <button className="btn ghost full" onClick={() => { setLeave(false); setDirty(false); back(`/workout/${w.id}`); }}>Discard changes</button>
        </div>
      </Sheet>
    </div>
  );
}
