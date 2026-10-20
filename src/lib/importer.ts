// Converts between the `lait-import-v1` file (produced from Hevy, and by LAIT's own backups) and app records.
// Later additions (sides, effort, gyms, machines, body, experiments) are optional fields, so every older file
// still imports and every new backup still reads as v1.
import type { BodyEntry, Exercise, ExerciseType, Experiment, Gym, Illness, Machine, Readiness, Routine, SetType, WExercise, WSet, Workout } from '../types';

/** [type, kg, reps, rpe, meters, seconds, completedAt?, side?, rir?] — trailing nulls are trimmed. */
type RawSet = [SetType, number | null, number | null, number | null, number | null, number | null, (number | null)?, ('L' | 'R' | null)?, (number | null)?];
/** `u` marks a unilateral exercise; older files simply omit it. */
interface RawEx { t: string; n: string; ss: number | null; rest: number | null; u?: boolean; s: RawSet[] }

export interface LaitFile {
  format: 'lait-import-v1';
  source: 'hevy' | 'lait';
  exportedAt: string;
  prefs?: Record<string, unknown>;
  templates: Record<string, { id: string; title: string; muscle: string; other: string[]; type: ExerciseType; equip: string; custom: boolean }>;
  routines: { id: string; title: string; notes: string; index?: number; updated?: string | number; ex: RawEx[] }[];
  workouts: {
    id: string; name: string; desc: string; start: number; end: number; routineId: string | null; ex: RawEx[]; source?: 'hevy' | 'lait';
    gym?: string | null; ready?: Readiness | null; ill?: Illness | null;
  }[];
  gyms?: Gym[];
  machines?: Machine[];
  body?: BodyEntry[];
  experiments?: Experiment[];
}

const toSet = (r: RawSet): WSet => ({
  type: r[0] ?? 'normal', kg: r[1] ?? null, reps: r[2] ?? null, rpe: r[3] ?? null, m: r[4] ?? null, sec: r[5] ?? null, at: r[6] ?? null,
  ...(r[7] ? { side: r[7] } : {}),
  ...(r[8] != null ? { rir: r[8] } : {}),
});
const toEx = (e: RawEx): WExercise => ({
  exId: e.t, notes: e.n ?? '', ss: e.ss ?? null, rest: e.rest ?? null, ...(e.u ? { uni: true } : {}), sets: e.s.map(toSet),
});

export function parseLaitFile(text: string): LaitFile {
  const f = JSON.parse(text);
  if (f?.format !== 'lait-import-v1' || !Array.isArray(f.workouts)) throw new Error('Not a LAIT/Hevy export file');
  return f as LaitFile;
}

export function fromLaitFile(f: LaitFile) {
  const exercises: Exercise[] = Object.values(f.templates).map(t => ({
    id: t.id, title: t.title, muscle: t.muscle, other: t.other ?? [], type: t.type, equip: t.equip ?? 'none', custom: !!t.custom,
  }));
  const workouts: Workout[] = f.workouts.map(w => ({
    id: w.id, name: w.name, notes: w.desc ?? '', start: w.start, end: w.end, routineId: w.routineId ?? null,
    exercises: w.ex.map(toEx), source: w.source ?? f.source,
    ...(w.gym ? { gymId: w.gym } : {}),
    ...(w.ready ? { readiness: w.ready } : {}),
    ...(w.ill ? { illness: w.ill } : {}),
  }));
  const routines: Routine[] = f.routines.map((r, i) => ({
    id: r.id, title: r.title, notes: r.notes ?? '', order: i, exercises: r.ex.map(toEx),
    updated: typeof r.updated === 'number' ? r.updated : r.updated ? Date.parse(r.updated) / 1000 : 0,
  }));
  return { exercises, workouts, routines, gyms: f.gyms ?? [], machines: f.machines ?? [], body: f.body ?? [], experiments: f.experiments ?? [] };
}

const fromSet = (s: WSet): RawSet => {
  const r: (string | number | null)[] = [s.type, s.kg, s.reps, s.rpe, s.m, s.sec, s.at ?? null, s.side ?? null, s.rir ?? null];
  while (r.length > 6 && r[r.length - 1] == null) r.pop();
  return r as RawSet;
};
const fromEx = (e: WExercise): RawEx => ({ t: e.exId, n: e.notes, ss: e.ss, rest: e.rest, ...(e.uni ? { u: true } : {}), s: e.sets.map(fromSet) });

export interface Extras { gyms?: Gym[]; machines?: Machine[]; body?: BodyEntry[]; experiments?: Experiment[] }

/** Full backup in the same format the importer reads, so backups round-trip. Photos are not included. */
export function toLaitFile(exercises: Exercise[], workouts: Workout[], routines: Routine[], prefs: LaitFile['prefs'], extras: Extras = {}): LaitFile {
  const used = new Set<string>();
  for (const w of [...workouts, ...routines]) for (const e of w.exercises) used.add(e.exId);
  const templates: LaitFile['templates'] = {};
  for (const e of exercises) if (e.custom || used.has(e.id)) templates[e.id] = { ...e };
  return {
    format: 'lait-import-v1', source: 'lait', exportedAt: new Date().toISOString(), prefs, templates,
    routines: routines.map(r => ({ id: r.id, title: r.title, notes: r.notes, index: r.order, updated: r.updated, ex: r.exercises.map(fromEx) })),
    workouts: [...workouts].sort((a, b) => a.start - b.start).map(w => ({
      id: w.id, name: w.name, desc: w.notes, start: w.start, end: w.end, routineId: w.routineId, ex: w.exercises.map(fromEx), source: w.source,
      ...(w.gymId ? { gym: w.gymId } : {}),
      ...(w.readiness ? { ready: w.readiness } : {}),
      ...(w.illness ? { ill: w.illness } : {}),
    })),
    ...(extras.gyms?.length ? { gyms: extras.gyms } : {}),
    ...(extras.machines?.length ? { machines: extras.machines } : {}),
    ...(extras.body?.length ? { body: extras.body } : {}),
    ...(extras.experiments?.length ? { experiments: extras.experiments } : {}),
  };
}
