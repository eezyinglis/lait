// App-wide live data: every table is small enough (hundreds of workouts) to keep in memory,
// and the derived history index (PRs, previous sets) is rebuilt only when workouts change.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { buildHistory, type HistoryIndex } from './lib/stats';
import { personalRate } from './lib/overload';
import { evaluateExperiment } from './lib/training';
import { calibrate, type Calibration } from './lib/recovery';
import type { ActiveWorkout, BodyEntry, Exercise, ExerciseType, Experiment, Gym, Machine, Prefs, RestState, Routine, Workout } from './types';
import { DEFAULT_PREFS } from './types';

interface Data {
  ready: boolean;
  workouts: Workout[]; // newest first
  routines: Routine[];
  exercises: Map<string, Exercise>;
  types: Map<string, ExerciseType>;
  history: HistoryIndex;
  /** Your median long-run strength gain per week, used to pace overload suggestions. */
  overloadPrior: number;
  prefs: Prefs;
  active: ActiveWorkout | null;
  rest: RestState | null;
  gyms: Gym[];
  /** Gym selected for new workouts. */
  currentGym: string | null;
  /** Keyed by `${gymId}|${exId}`. */
  machines: Map<string, Machine>;
  body: BodyEntry[]; // newest first
  experiments: Experiment[]; // newest first
  /** Unix ms of the last backup, if any. */
  lastBackup: number | null;
  /** First-launch setup finished or dismissed. */
  setupDone: boolean;
  /** Personal recovery calibration from your history (performance vs time since a muscle was trained). */
  recoveryCal: Calibration;
}

const Ctx = createContext<Data | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const workouts = useLiveQuery(() => db.workouts.orderBy('start').reverse().toArray(), []);
  const routines = useLiveQuery(() => db.routines.orderBy('order').toArray(), []);
  const exList = useLiveQuery(() => db.exercises.toArray(), []);
  const kv = useLiveQuery(() => db.kv.bulkGet(['prefs', 'active', 'rest', 'currentGym', 'lastBackup', 'setupDone']), []);
  const gyms = useLiveQuery(() => db.gyms.orderBy('order').toArray(), []);
  const machineList = useLiveQuery(() => db.machines.toArray(), []);
  const body = useLiveQuery(() => db.body.orderBy('date').reverse().toArray(), []);
  const experiments = useLiveQuery(() => db.experiments.orderBy('started').reverse().toArray(), []);

  const exercises = useMemo(() => new Map((exList ?? []).map(e => [e.id, e])), [exList]);
  const types = useMemo(() => new Map((exList ?? []).map(e => [e.id, e.type])), [exList]);
  const history = useMemo(() => buildHistory(workouts ?? [], types), [workouts, types]);
  const overloadPrior = useMemo(() => personalRate(history.byExercise.values()), [history]);
  const machines = useMemo(() => new Map((machineList ?? []).map(m => [m.id, m])), [machineList]);
  const recoveryCal = useMemo(() => calibrate((workouts ?? []).filter(w => !w.illness), exercises), [workouts, exercises]);

  // Plateau experiments are scored automatically once 3 weeks have passed and the lift was done again.
  useEffect(() => {
    const now = Date.now() / 1000;
    for (const e of experiments ?? []) {
      if (e.result != null) continue;
      const r = evaluateExperiment(e, history.byExercise.get(e.exId) ?? [], now);
      if (r != null) void db.experiments.update(e.id, { result: r, ended: Math.floor(now) });
    }
  }, [experiments, history]);

  const [prefsRow, activeRow, restRow, gymRow, backupRow, setupRow] = kv ?? [];
  const value: Data = {
    ready: !!workouts && !!routines && !!exList,
    workouts: workouts ?? [],
    routines: routines ?? [],
    exercises,
    types,
    history,
    overloadPrior,
    prefs: { ...DEFAULT_PREFS, ...((prefsRow?.value as Partial<Prefs>) ?? {}) },
    active: (activeRow?.value as ActiveWorkout) ?? null,
    rest: (restRow?.value as RestState) ?? null,
    gyms: gyms ?? [],
    currentGym: (gymRow?.value as string) ?? null,
    machines,
    body: body ?? [],
    experiments: experiments ?? [],
    lastBackup: (backupRow?.value as number) ?? null,
    // Unknown until the first query resolves; treat as done meanwhile so the wizard doesn't flash.
    setupDone: kv ? !!setupRow?.value : true,
    recoveryCal,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const d = useContext(Ctx);
  if (!d) throw new Error('useData outside DataProvider');
  return d;
}
