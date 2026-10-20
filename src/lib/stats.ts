// Pure workout maths: 1RM, volume, PR detection and the per-exercise history index.
// No runtime imports, so it runs under plain `node --test` as well as in the app.
import type { Exercise, ExerciseType, Illness, PRType, WExercise, WSet, Workout } from '../types';

/** Hevy's %-of-1RM table (reps -> fraction). Anything above 30 reps uses 50%. */
const PCT: Record<number, number> = {
  1: 1, 2: 0.97, 3: 0.94, 4: 0.92, 5: 0.89, 6: 0.86, 7: 0.83, 8: 0.81, 9: 0.78, 10: 0.75,
  11: 0.73, 12: 0.71, 13: 0.7, 14: 0.68, 15: 0.67, 16: 0.65, 17: 0.64, 18: 0.63, 19: 0.61, 20: 0.6,
  21: 0.59, 22: 0.58, 23: 0.57, 24: 0.56, 25: 0.55, 26: 0.54, 27: 0.53, 28: 0.52, 29: 0.51, 30: 0.5,
};

export function oneRepMax(kg: number | null, reps: number | null): number {
  if (!kg || !reps || reps <= 0) return 0;
  return kg / (reps > 30 ? 0.5 : PCT[Math.round(reps)]);
}

export const usesWeight = (t: ExerciseType) =>
  t === 'weight_reps' || t === 'bodyweight_reps' || t === 'bodyweight_assisted_reps' ||
  t === 'weight_duration' || t === 'short_distance_weight';
export const usesReps = (t: ExerciseType) =>
  t === 'weight_reps' || t === 'reps_only' || t === 'bodyweight_reps' || t === 'bodyweight_assisted_reps' ||
  t === 'floors_duration' || t === 'steps_duration';
export const usesDuration = (t: ExerciseType) =>
  t === 'duration' || t === 'weight_duration' || t === 'distance_duration' || t === 'floors_duration' || t === 'steps_duration';
export const usesDistance = (t: ExerciseType) => t === 'distance_duration' || t === 'short_distance_weight';

/** Volume a set contributes (kg x reps). Assisted bodyweight counts as zero, like Hevy. */
export function setVolume(s: WSet, t: ExerciseType): number {
  if (t === 'bodyweight_assisted_reps') return 0;
  if (t === 'weight_reps' || t === 'bodyweight_reps') return (s.kg ?? 0) * (s.reps ?? 0);
  return 0;
}

export function workoutVolume(w: Pick<Workout, 'exercises'>, types: Map<string, ExerciseType>, includeWarmups = true) {
  let v = 0;
  for (const e of w.exercises) {
    const t = types.get(e.exId) ?? 'weight_reps';
    for (const s of e.sets) if (includeWarmups || s.type !== 'warmup') v += setVolume(s, t);
  }
  return v;
}

export const countSets = (w: Pick<Workout, 'exercises'>) => w.exercises.reduce((a, e) => a + e.sets.length, 0);
export const countReps = (w: Pick<Workout, 'exercises'>) =>
  w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.reps ?? 0), 0), 0);

/** Which record types an exercise type can set. */
export function prTypesFor(t: ExerciseType): PRType[] {
  switch (t) {
    case 'weight_reps': return ['best_weight', 'best_1rm', 'best_volume'];
    case 'bodyweight_reps': return ['best_reps', 'best_weight'];
    case 'reps_only': case 'bodyweight_assisted_reps': return ['best_reps'];
    case 'duration': case 'floors_duration': case 'steps_duration': return ['best_duration'];
    case 'weight_duration': return ['best_weight', 'best_duration'];
    case 'distance_duration': return ['best_distance', 'best_duration'];
    case 'short_distance_weight': return ['best_weight', 'best_distance'];
  }
}

export function prValue(type: PRType, s: WSet): number {
  switch (type) {
    case 'best_weight': return s.kg ?? 0;
    case 'best_1rm': return oneRepMax(s.kg, s.reps);
    case 'best_volume': return (s.kg ?? 0) * (s.reps ?? 0);
    case 'best_reps': return s.reps ?? 0;
    case 'best_duration': return s.sec ?? 0;
    case 'best_distance': return s.m ?? 0;
  }
}

export interface SetPR { type: PRType; value: number }

/** One appearance of an exercise in a workout, for history lists and charts. */
export interface Session {
  workoutId: string;
  workoutName: string;
  start: number;
  /** Gym of the workout (null for imported Hevy history). */
  gymId: string | null;
  /** Set when the workout was marked as done while ill or just after. */
  illness?: Illness | null;
  ex: WExercise;
  /** PRs keyed by set index within ex.sets. */
  prs: Map<number, SetPR[]>;
}

export interface HistoryIndex {
  /** exerciseId -> sessions, oldest first. */
  byExercise: Map<string, Session[]>;
  /** workoutId -> number of PRs set in it. */
  prCount: Map<string, number>;
  /** workoutId -> (exercise index -> set index -> PRs). */
  prsByWorkout: Map<string, Map<number, Map<number, SetPR[]>>>;
  /** exerciseId -> current record values. */
  records: Map<string, Partial<Record<PRType, { value: number; workoutId: string; start: number }>>>;
}

/**
 * Walks every workout oldest -> newest and flags a set as a PR when it beats the exercise's previous best.
 * Warm-up sets never count, and an exercise's first-ever session establishes the baseline without flagging PRs.
 */
export function buildHistory(workouts: Workout[], types: Map<string, ExerciseType>): HistoryIndex {
  const sorted = [...workouts].sort((a, b) => a.start - b.start);
  const byExercise = new Map<string, Session[]>();
  const prCount = new Map<string, number>();
  const prsByWorkout = new Map<string, Map<number, Map<number, SetPR[]>>>();
  const records: HistoryIndex['records'] = new Map();

  for (const w of sorted) {
    let count = 0;
    const wMap = new Map<number, Map<number, SetPR[]>>();
    w.exercises.forEach((ex, ei) => {
      const t = types.get(ex.exId) ?? 'weight_reps';
      const rec = records.get(ex.exId) ?? {};
      const firstTime = !byExercise.has(ex.exId);
      const setPrs = new Map<number, SetPR[]>();
      for (const type of prTypesFor(t)) {
        // Best value of this type within this session, and which set achieved it.
        let bestIdx = -1, best = 0;
        ex.sets.forEach((s, si) => {
          if (s.type === 'warmup') return;
          const v = prValue(type, s);
          if (v > best) { best = v; bestIdx = si; }
        });
        if (bestIdx < 0) continue;
        const prev = rec[type]?.value ?? 0;
        if (best > prev) {
          if (!firstTime && prev > 0) {
            const list = setPrs.get(bestIdx) ?? [];
            list.push({ type, value: best });
            setPrs.set(bestIdx, list);
            count++;
          }
          rec[type] = { value: best, workoutId: w.id, start: w.start };
        }
      }
      records.set(ex.exId, rec);
      if (setPrs.size) wMap.set(ei, setPrs);
      const list = byExercise.get(ex.exId) ?? [];
      list.push({ workoutId: w.id, workoutName: w.name, start: w.start, gymId: w.gymId ?? null, illness: w.illness ?? null, ex, prs: setPrs });
      byExercise.set(ex.exId, list);
    });
    prCount.set(w.id, count);
    if (wMap.size) prsByWorkout.set(w.id, wMap);
  }
  return { byExercise, prCount, prsByWorkout, records };
}

/** The sets from the most recent session of an exercise, for the logger's "Previous" column. */
export function previousSets(index: HistoryIndex, exId: string): WSet[] {
  const s = index.byExercise.get(exId);
  return s?.length ? s[s.length - 1].ex.sets : [];
}

/** Monday 00:00 local time of the week containing `sec`. */
export function weekStart(sec: number): number {
  const d = new Date(sec * 1000);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return Math.floor(d.getTime() / 1000);
}

export type WeeklyMetric = 'duration' | 'volume' | 'reps' | 'workouts';

/** Totals per week for the last `weeks` weeks (oldest first), including empty weeks. */
export function weeklyTotals(workouts: Workout[], types: Map<string, ExerciseType>, metric: WeeklyMetric, weeks: number, nowSec: number, includeWarmups = true) {
  const current = weekStart(nowSec);
  const buckets: { week: number; value: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(current * 1000);
    d.setDate(d.getDate() - i * 7);
    buckets.push({ week: Math.floor(d.getTime() / 1000), value: 0 });
  }
  const byWeek = new Map(buckets.map(b => [b.week, b]));
  for (const w of workouts) {
    const b = byWeek.get(weekStart(w.start));
    if (!b) continue;
    if (metric === 'duration') b.value += Math.max(0, w.end - w.start);
    else if (metric === 'volume') b.value += workoutVolume(w, types, includeWarmups);
    else if (metric === 'reps') b.value += countReps(w);
    else b.value += 1;
  }
  return buckets;
}

/** Working sets per primary muscle (secondary muscles count half), for the muscle split. */
export function muscleSplit(workouts: Workout[], exercises: Map<string, Exercise>) {
  const m = new Map<string, number>();
  for (const w of workouts)
    for (const e of w.exercises) {
      const ex = exercises.get(e.exId);
      if (!ex) continue;
      const n = e.sets.filter(s => s.type !== 'warmup').length;
      m.set(ex.muscle, (m.get(ex.muscle) ?? 0) + n);
      for (const o of ex.other) m.set(o, (m.get(o) ?? 0) + n / 2);
    }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
