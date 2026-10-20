import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../store';
import { getActive, setActive } from '../db';
import { discardWorkout, finishWorkout, updateRoutineFromWorkout } from '../lib/actions';
import { buildHistory, countSets, previousSets, workoutVolume } from '../lib/stats';
import { clock, fmtDuration, fmtVolume, PR_LABEL } from '../lib/format';
import type { ActiveWorkout, Illness, Readiness, WExercise, Workout } from '../types';
import { ILLNESS } from '../lib/overload';
import { readinessScore } from '../lib/training';
import { GymPicker } from '../components/Gym';
import { runBackup } from '../components/Banners';
import { ExerciseCard, listOps, supersetLabels } from '../components/ExerciseCard';
import { ExercisePicker } from '../components/ExercisePicker';
import { Icon, Sheet } from '../components/ui';
import { go } from '../router';
import { cancelBeep, startRest } from '../components/RestTimer';
import { applyTargets, suggestionFor } from '../components/Suggestion';
import { keepScreenOn } from '../lib/device';

export function Logger() {
  const data = useData();
  const { active, exercises, history, prefs, types, gyms, routines } = data;
  const [w, setW] = useState<ActiveWorkout | null>(active);
  const [picker, setPicker] = useState(false);
  const [gymOpen, setGymOpen] = useState(false);
  const [illOpen, setIllOpen] = useState(false);
  const [confirm, setConfirm] = useState<'finish' | 'discard' | null>(null);
  const [done, setDone] = useState<Workout | null>(null);
  const [now, setNow] = useState(Date.now());
  const saveT = useRef<number | undefined>(undefined);

  // Adopt the stored workout when it first loads (the live query resolves after the first render), and a gym
  // picked automatically from your location while nothing has been logged yet.
  useEffect(() => {
    if (!active) return;
    if (!w || active.id !== w.id) { setW(active); return; }
    if (active.gymId !== w.gymId && !w.exercises.some(e => e.sets.some(s => s.done))) setW({ ...w, gymId: active.gymId });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // Keep the screen on while the logger is open, so the rest timer and its beep keep running.
  const workoutOpen = !!w && !done;
  useEffect(() => keepScreenOn(prefs.keepAwake && workoutOpen), [prefs.keepAwake, workoutOpen]);

  const update = (next: ActiveWorkout) => {
    setW(next);
    clearTimeout(saveT.current);
    saveT.current = window.setTimeout(() => { if (!ended.current) void setActive(next); }, 250);
  };
  // Flush pending writes when leaving or backgrounding the app.
  const latest = useRef(w);
  latest.current = w;
  /** Set once the workout is saved or discarded, so no pending write can resurrect it. */
  const ended = useRef(false);
  useEffect(() => {
    // Only write back if this workout is still the stored one, so a workout finished or discarded
    // elsewhere (another tab, another screen) is never resurrected.
    const flush = () => {
      clearTimeout(saveT.current);
      const w = latest.current;
      if (!w || ended.current) return;
      void getActive().then(cur => { if (cur?.id === w.id && !ended.current) void setActive(w); });
    };
    document.addEventListener('visibilitychange', flush);
    return () => { document.removeEventListener('visibilitychange', flush); flush(); };
  }, []);

  const labels = useMemo(() => supersetLabels(w?.exercises ?? []), [w?.exercises]);

  // Auto-fill: every exercise that hasn't been started gets its next-session targets, once the readiness
  // check-in is answered or skipped (so a rough day is already taken into account). Exercises added later
  // are filled the same way. Each exercise is filled once, so your own edits are never overwritten.
  useEffect(() => {
    if (!w || !prefs.autoFill || ended.current) return;
    if (prefs.readinessCheck && w.readiness === undefined) return;
    if (!w.exercises.some(e => !e.auto && !e.sets.some(s => s.done))) return;
    const r = readinessScore(w.readiness);
    update({
      ...w,
      autofilled: true,
      exercises: w.exercises.map(e => {
        if (e.auto || e.sets.some(s => s.done)) return e;
        const s = suggestionFor(data, e.exId, w.gymId ?? null, r, w.illness ?? null);
        return { ...(s ? dropSets(applyTargets(e, s.sets), s.dropSets ?? 0) : e), auto: true };
      }),
    });
  }, [w, prefs.autoFill, prefs.readinessCheck, data.history]); // eslint-disable-line react-hooks/exhaustive-deps

  if (done) return <Summary w={done} />;
  if (!w) {
    return (
      <div className="screen center">
        <p>No workout in progress.</p>
        <button className="btn primary" onClick={() => go('/routines')}>Start one</button>
      </div>
    );
  }

  const ops = listOps(w.exercises, exs => update({ ...w, exercises: exs }));
  const doneSets = w.exercises.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
  const pending = w.exercises.reduce((a, e) => a + e.sets.filter(s => !s.done).length, 0);
  const vol = workoutVolume({ exercises: w.exercises.map(e => ({ ...e, sets: e.sets.filter(s => s.done) })) }, types, prefs.volumeIncludesWarmups);

  const onSetDone = (secs: number) => startRest(secs);
  /** Turns post-illness mode on/off: exercises not started yet get their targets again (sets an earlier setting left out come back). */
  const setIllness = (ill: Illness | null) => {
    const routine = routines.find(x => x.id === w.routineId);
    update({
      ...w, illness: ill,
      exercises: w.exercises.map(e => {
        if (e.sets.some(s => s.done)) return e;
        const orig = routine?.exercises.find(x => x.exId === e.exId);
        const base = orig && orig.sets.length > e.sets.length ? { ...e, sets: orig.sets.map(s => ({ ...s })) } : e;
        return { ...base, auto: false };
      }),
    });
    setIllOpen(false);
  };
  const ready = readinessScore(w.readiness);
  const gymName = gyms.find(g => g.id === w.gymId)?.name;
  // Previous values come from the same gym's machine when you've used it there before.
  const previousAt = (exId: string) => {
    const ss = history.byExercise.get(exId) ?? [];
    const atGym = w.gymId ? ss.filter(x => x.gymId === w.gymId) : [];
    return (atGym.length ? atGym : ss).at(-1)?.ex.sets ?? previousSets(history, exId);
  };

  const finish = async () => {
    ended.current = true;
    clearTimeout(saveT.current);
    cancelBeep();
    const saved = await finishWorkout(w);
    setConfirm(null);
    if (saved) setDone(saved);
    else ended.current = false;
  };

  return (
    <div className="screen logger">
      <header className="hdr">
        <div className="hdr-l"><button className="icon-btn" aria-label="Minimise" onClick={() => { setActive(w); go('/'); }}><Icon name="back" /></button></div>
        <div className="hdr-t"><div className="hdr-title">Log workout</div></div>
        <div className="hdr-r"><button className="btn primary sm" onClick={() => setConfirm('finish')}>Finish</button></div>
      </header>

      <div className="log-top">
        <input className="title-input" value={w.name} onChange={e => update({ ...w, name: e.target.value })} aria-label="Workout name" />
        <button className="gym-chip" onClick={() => setGymOpen(true)}><Icon name="home" size={14} /> {gymName ?? 'Choose gym'}</button>
        {ready != null && <span className={'ready-chip' + (ready <= 2.5 ? ' low' : '')}>Readiness {ready.toFixed(1)}/5</span>}
        <button className={'ill-chip' + (w.illness ? ' on' : '')} onClick={() => setIllOpen(true)}>
          ♡ {w.illness ? `After illness: ${w.illness === 'flu' ? 'fever/flu' : 'mild'}` : 'After illness?'}
        </button>
        <div className="log-stats">
          <div><span>Duration</span><b className="accent">{clock((now / 1000) - w.start)}</b></div>
          <div><span>Volume</span><b>{fmtVolume(vol, prefs)}</b></div>
          <div><span>Sets</span><b>{doneSets}</b></div>
        </div>
      </div>

      {prefs.readinessCheck && w.readiness === undefined && !w.exercises.some(e => e.sets.some(s => s.done)) && (
        <ReadinessCard onSave={r => update({ ...w, readiness: r })} />
      )}

      {w.exercises.length === 0 && (
        <div className="empty big">
          <Icon name="dumbbell" size={40} />
          <p>Get started</p>
          <span>Add an exercise to start your workout.</span>
        </div>
      )}

      {w.exercises.map((ex, i) => (
        <ExerciseCard key={i + ex.exId} ex={ex} exercise={exercises.get(ex.exId)} prefs={prefs} mode="log"
          previous={previousAt(ex.exId)} supersetLabel={labels[i]} gymId={w.gymId ?? null} readiness={ready} illness={w.illness ?? null}
          onChange={e => ops.change(i, e)} onRemove={() => ops.remove(i)} onMove={d => ops.move(i, d)}
          onToggleSuperset={() => ops.toggleSuperset(i)} onSetDone={onSetDone} />
      ))}

      <div className="log-actions">
        <button className="btn primary full" onClick={() => setPicker(true)}><Icon name="plus" size={18} /> Add exercise</button>
        <button className="btn danger-ghost full" onClick={() => setConfirm('discard')}>Discard workout</button>
      </div>

      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={ids => ops.add(ids)} />
      <GymPicker open={gymOpen} onClose={() => setGymOpen(false)} value={w.gymId ?? null} onPick={id => update({ ...w, gymId: id })} />

      <Sheet open={illOpen} onClose={() => setIllOpen(false)} title="Post-illness mode">
        <div className="menu">
          <p className="muted pad">Today's plan goes easier and this workout won't count against your progress or trigger a deload warning.</p>
          {(Object.keys(ILLNESS) as Illness[]).map(k => (
            <button key={k} className={'menu-i' + (w.illness === k ? ' sel' : '')} onClick={() => setIllness(k)}>
              <span className="grow">{ILLNESS[k].label}<br /><span className="muted small">
                ~{Math.round((1 - ILLNESS[k].pct) * 100)}% lighter · stop at {ILLNESS[k].rir}+ RIR{ILLNESS[k].dropSets ? ` · ${ILLNESS[k].dropSets} set fewer per exercise` : ''}
              </span></span>
              {w.illness === k && <span className="accent">✓</span>}
            </button>
          ))}
          <button className="menu-i" onClick={() => setIllness(null)}><span className="grow">I'm healthy (normal plan)</span>{!w.illness && <span className="accent">✓</span>}</button>
          <p className="muted small pad">Fever, chest symptoms or body aches: rest instead. Train again once you've been fever-free for a day or two.</p>
        </div>
      </Sheet>

      <Sheet open={confirm === 'finish'} onClose={() => setConfirm(null)} title="Finish workout?">
        <div className="menu">
          {doneSets === 0 ? (
            <p className="muted pad">Tick at least one set before finishing.</p>
          ) : (
            <>
              {pending > 0 && <p className="muted pad">{pending} unfinished set{pending > 1 ? 's' : ''} will be discarded.</p>}
              <button className="btn primary full" onClick={finish}>Save workout</button>
            </>
          )}
          <button className="btn ghost full" onClick={() => setConfirm(null)}>Keep going</button>
        </div>
      </Sheet>

      <Sheet open={confirm === 'discard'} onClose={() => setConfirm(null)} title="Discard workout?">
        <div className="menu">
          <p className="muted pad">This workout will be lost.</p>
          <button className="btn danger full" onClick={async () => { ended.current = true; clearTimeout(saveT.current); cancelBeep(); await discardWorkout(); setW(null); go('/'); }}>Discard</button>
          <button className="btn ghost full" onClick={() => setConfirm(null)}>Cancel</button>
        </div>
      </Sheet>
    </div>
  );
}

/** Leaves out the last `n` working sets that aren't ticked yet (L/R pairs count as one), keeping at least one. */
function dropSets(e: WExercise, n: number): WExercise {
  if (n <= 0) return e;
  const per = e.uni ? 2 : 1;
  const working = e.sets.filter(s => s.type !== 'warmup').length;
  let left = Math.max(0, Math.min(n * per, working - per));
  const sets = [...e.sets];
  for (let i = sets.length - 1; i >= 0 && left > 0; i--) if (sets[i].type !== 'warmup' && !sets[i].done) { sets.splice(i, 1); left--; }
  return { ...e, sets };
}

function Summary({ w }: { w: Workout }) {
  const { exercises, prefs, types, workouts, routines, lastBackup } = useData();
  // PRs for this workout, computed with the saved workout included even before the live query catches up.
  const all = workouts.some(x => x.id === w.id) ? workouts : [w, ...workouts];
  const h = useMemo(() => buildHistory(all, types), [all.length, types]); // eslint-disable-line react-hooks/exhaustive-deps
  const prs = h.prsByWorkout.get(w.id);
  const nth = all.filter(x => x.start <= w.start).length;
  const routine = w.routineId ? routines.find(r => r.id === w.routineId) : undefined;
  const [updated, setUpdated] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const backupDue = prefs.backupEveryDays > 0 && (!lastBackup || Date.now() - lastBackup > prefs.backupEveryDays * 86400000);
  return (
      <div className="screen summary">
        <div className="trophy-big"><Icon name="trophy" size={44} /></div>
        <h1>Well done!</h1>
        <p className="muted">This was workout #{nth}</p>
        <div className="card">
          <h3>{w.name}</h3>
          <div className="stats3">
            <div><span>Duration</span><b>{fmtDuration(w.end - w.start)}</b></div>
            <div><span>Volume</span><b>{fmtVolume(workoutVolume(w, types, prefs.volumeIncludesWarmups), prefs)}</b></div>
            <div><span>Sets</span><b>{countSets(w)}</b></div>
          </div>
          {prs && (
            <div className="pr-list">
              {[...prs.entries()].flatMap(([ei, m]) => [...m.values()].flat().map((p, k) => (
                <div key={`${ei}-${k}`} className="pr-line"><Icon name="trophy" size={15} /> {exercises.get(w.exercises[ei].exId)?.title}: {PR_LABEL[p.type]}</div>
              )))}
            </div>
          )}
        </div>
        {routine && (
          <button className="btn ghost full" disabled={updated} onClick={async () => { await updateRoutineFromWorkout(routine.id, w); setUpdated(true); }}>
            {updated ? 'Routine updated ✓' : `Update “${routine.title}” with these values`}
          </button>
        )}
        {backupDue && !backedUp && (
          <button className="btn ghost full backup-now" onClick={async () => { await runBackup(); setBackedUp(true); }}>
            <Icon name="list" size={16} /> Back up now (your data lives only on this phone)
          </button>
        )}
        <button className="btn primary full" onClick={() => go(`/workout/${w.id}`)}>View workout</button>
        <button className="btn ghost full" onClick={() => go('/')}>Done</button>
      </div>
  );
}

/** Quick pre-workout check-in. A low score makes today's suggestions hold or lighten instead of pushing. */
function ReadinessCard({ onSave }: { onSave: (r: Readiness | null) => void }) {
  const [r, setR] = useState<Readiness>({ sleep: 3, energy: 3, soreness: 3 });
  const row = (k: keyof Readiness, label: string, lo: string, hi: string) => (
    <div className="ready-row">
      <span>{label}</span>
      <div className="ready-dots">
        {[1, 2, 3, 4, 5].map(v => (
          <button key={v} className={'chip' + (r[k] === v ? ' on' : '')} onClick={() => setR({ ...r, [k]: v })}>{v}</button>
        ))}
      </div>
      <small className="muted">{lo} → {hi}</small>
    </div>
  );
  return (
    <section className="card ready-card">
      <h3>How are you today?</h3>
      {row('sleep', 'Sleep', 'poor', 'great')}
      {row('energy', 'Energy', 'drained', 'fired up')}
      {row('soreness', 'Body', 'very sore', 'fresh')}
      <div className="row gap">
        <button className="btn ghost" onClick={() => onSave(null)}>Skip</button>
        <button className="btn primary grow" onClick={() => onSave(r)}>Save</button>
      </div>
    </section>
  );
}
