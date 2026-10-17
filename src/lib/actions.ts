import { db, getActive, getCurrentGym, getPrefs, nowSec, setActive, setCurrentGym, setPrefs, uid } from '../db';
import type { ActiveWorkout, Routine, WExercise, WSet, Workout } from '../types';
import { fromLaitFile, parseLaitFile, toLaitFile } from './importer';
import { autoTune, nearestGym } from './training';
import { getPosition } from './device';

const blankSet = (): WSet => ({ type: 'normal', kg: null, reps: null, rpe: null, m: null, sec: null, done: false });

/** Copies exercises so the logger can edit them; sets start un-ticked with the source values pre-filled. */
const cloneForLogging = (exs: WExercise[]): WExercise[] =>
  exs.map(e => ({ ...e, sets: (e.sets.length ? e.sets : [blankSet()]).map(s => ({ ...s, done: false, at: null })) }));

/** `exercises` overrides the routine's exercises (e.g. trimmed to a time limit). */
export async function startWorkout(opts: { routine?: Routine; from?: Workout; exercises?: WExercise[] } = {}) {
  if (await getActive()) return false;
  const src = opts.routine ?? opts.from;
  const a: ActiveWorkout = {
    id: uid(),
    name: opts.routine?.title ?? opts.from?.name ?? workoutNameForNow(),
    notes: '',
    start: nowSec(),
    routineId: opts.routine?.id ?? opts.from?.routineId ?? null,
    exercises: src ? cloneForLogging(opts.exercises ?? src.exercises) : opts.exercises ? cloneForLogging(opts.exercises) : [],
    gymId: await getCurrentGym(),
    // readiness stays undefined until the check-in is answered (object) or skipped (null).
  };
  await setActive(a);
  void autoPickGym(a.id, a.gymId ?? null);
  return true;
}

/**
 * Picks the nearest saved gym from your location, in the background so starting is instant. Only applies while
 * the workout still has the gym it started with and nothing is logged yet (a manual choice always wins).
 */
async function autoPickGym(workoutId: string, startedWith: string | null) {
  const prefs = await getPrefs();
  if (!prefs.autoGym) return;
  const gyms = (await db.gyms.toArray()).filter(g => g.lat != null && g.lon != null);
  if (!gyms.length) return;
  const pos = await getPosition();
  if (!pos) return;
  const g = nearestGym(gyms, pos.lat, pos.lon);
  if (!g || g.id === startedWith) return;
  const cur = await getActive();
  if (!cur || cur.id !== workoutId || (cur.gymId ?? null) !== startedWith || cur.exercises.some(e => e.sets.some(s => s.done))) return;
  await setActive({ ...cur, gymId: g.id });
  await setCurrentGym(g.id);
}

function workoutNameForNow() {
  const h = new Date().getHours();
  return h < 12 ? 'Morning Workout' : h < 17 ? 'Afternoon Workout' : 'Evening Workout';
}

export const newSet = blankSet;

/** A set counts as logged if it is ticked; unticked sets are dropped on finish (like Hevy). */
export async function finishWorkout(a: ActiveWorkout): Promise<Workout | null> {
  const exercises = a.exercises
    .map(({ auto: _auto, ...e }) => ({ ...e, sets: e.sets.filter(s => s.done).map(({ done: _d, ...s }) => s) }))
    .filter(e => e.sets.length);
  if (!exercises.length) return null;
  const w: Workout = {
    id: a.id, name: a.name.trim() || 'Workout', notes: a.notes, start: a.start, end: nowSec(),
    routineId: a.routineId, exercises, source: 'lait', gymId: a.gymId ?? null, readiness: a.readiness ?? null,
  };
  await db.transaction('rw', db.workouts, db.kv, async () => {
    await db.workouts.put(w);
    await setActive(null);
  });
  return w;
}

export const discardWorkout = () => setActive(null);

export async function saveRoutine(r: Routine) {
  await db.routines.put({ ...r, updated: nowSec() });
}

export async function newRoutine(from?: Workout): Promise<string> {
  const order = (await db.routines.count());
  const r: Routine = {
    id: uid(), title: from?.name ?? 'New Routine', notes: '', order, updated: nowSec(),
    exercises: (from?.exercises ?? []).map(e => ({ ...e, sets: e.sets.map(({ done: _d, at: _a, ...s }) => s) })),
  };
  await db.routines.put(r);
  return r.id;
}

/** Updates a routine's target sets from a finished workout (same exercises, new weights/reps). */
export async function updateRoutineFromWorkout(routineId: string, w: Workout) {
  const r = await db.routines.get(routineId);
  if (!r) return;
  await saveRoutine({ ...r, exercises: w.exercises.map(e => ({ ...e, sets: e.sets.map(({ at: _a, ...s }) => s) })) });
}

/** Imports a LAIT/Hevy file. Existing records with the same id are replaced, so importing twice is safe. */
export async function importFile(text: string) {
  const f = parseLaitFile(text);
  const { exercises, workouts, routines, gyms, machines, body, experiments } = fromLaitFile(f);
  await db.transaction('rw', [db.exercises, db.workouts, db.routines, db.kv, db.gyms, db.machines, db.body, db.experiments], async () => {
    // Keep built-in library rows as they are; only add exercises we don't know yet (and all customs).
    const known = new Set(await db.exercises.toCollection().primaryKeys());
    await db.exercises.bulkPut(exercises.filter(e => e.custom || !known.has(e.id)));
    await db.workouts.bulkPut(workouts);
    const existing = await db.routines.count();
    // Re-importing keeps a routine's existing position; new ones go to the end.
    const routineOrder = new Map((await db.routines.toArray()).map(r => [r.id, r.order]));
    await db.routines.bulkPut(routines.map((r, i) => ({ ...r, order: routineOrder.get(r.id) ?? existing + i })));
    await db.gyms.bulkPut(gyms);
    await db.machines.bulkPut(machines);
    await db.body.bulkPut(body);
    await db.experiments.bulkPut(experiments);
    if (f.prefs) {
      const p = await getPrefs();
      await db.kv.put({ key: 'prefs', value: { ...p, ...Object.fromEntries(Object.entries(f.prefs).filter(([, v]) => v != null)) } });
    }
  });
  // Match the settings to how you actually train (weekly target, volume band, rest), straight after importing.
  const all = await db.workouts.orderBy('start').reverse().toArray();
  const exMap = new Map((await db.exercises.toArray()).map(e => [e.id, e]));
  const tuned = autoTune(all, exMap, all.length ? all[0].start + 86400 : nowSec());
  await setPrefs({ weeklyTarget: tuned.weeklyTarget, volumeBand: tuned.volumeBand, ...(tuned.defaultRest ? { defaultRest: tuned.defaultRest } : {}) });
  return { workouts: workouts.length, routines: routines.length, exercises: exercises.filter(e => e.custom).length, tuned };
}

export async function exportBackup() {
  const [exercises, workouts, routines, prefs, gyms, machines, body, experiments] = await Promise.all([
    db.exercises.toArray(), db.workouts.toArray(), db.routines.toArray(), getPrefs(),
    db.gyms.toArray(), db.machines.toArray(), db.body.toArray(), db.experiments.toArray(),
  ]);
  return JSON.stringify(toLaitFile(exercises, workouts, routines, { ...prefs }, { gyms, machines, body, experiments }));
}

export async function wipeAll() {
  await db.transaction('rw', [db.workouts, db.routines, db.kv, db.exercises, db.gyms, db.machines, db.body, db.photos, db.experiments], async () => {
    await Promise.all([db.gyms.clear(), db.machines.clear(), db.body.clear(), db.photos.clear(), db.experiments.clear()]);
    await db.workouts.clear();
    await db.routines.clear();
    await db.kv.clear();
    await db.exercises.where('id').anyOf((await db.exercises.filter(e => e.custom).primaryKeys())).delete();
  });
}
