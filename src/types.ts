export type SetType = 'normal' | 'warmup' | 'dropset' | 'failure';

export type ExerciseType =
  | 'weight_reps'
  | 'reps_only'
  | 'bodyweight_reps'
  | 'bodyweight_assisted_reps'
  | 'duration'
  | 'weight_duration'
  | 'distance_duration'
  | 'short_distance_weight'
  | 'floors_duration'
  | 'steps_duration';

export interface Exercise {
  id: string;
  title: string;
  muscle: string;
  other: string[];
  type: ExerciseType;
  equip: string;
  custom: boolean;
}

/** One set. Weight is always stored in kg, distance in meters, duration in seconds. */
export interface WSet {
  type: SetType;
  kg: number | null;
  reps: number | null;
  rpe: number | null;
  m: number | null;
  sec: number | null;
  /** Logger only: whether the set has been ticked off. Saved workouts contain only done sets. */
  done?: boolean;
  /** Unix seconds the set was completed. */
  at?: number | null;
  /** Side of a unilateral set: left or right. */
  side?: 'L' | 'R' | null;
  /** Reps in reserve (0 = failure, 3 = 3 or more left), tapped after the set. */
  rir?: number | null;
}

export interface WExercise {
  exId: string;
  notes: string;
  /** Exercises sharing the same non-null value form a superset. */
  ss: number | null;
  /** Rest timer in seconds; null falls back to the default. */
  rest: number | null;
  /** Unilateral: every set is logged as a left + right pair and the rest timer is halved. */
  uni?: boolean;
  /** Logger only: targets were auto-filled for this exercise. */
  auto?: boolean;
  sets: WSet[];
}

export interface Workout {
  id: string;
  name: string;
  notes: string;
  /** Unix seconds. */
  start: number;
  end: number;
  routineId: string | null;
  exercises: WExercise[];
  source: 'hevy' | 'lait';
  /** Gym the workout was done at (machines differ between gyms). */
  gymId?: string | null;
  /** Pre-workout check-in, 1 (bad) to 5 (great). */
  readiness?: Readiness | null;
}

export interface Readiness { sleep: number; energy: number; soreness: number }

/** A gym; with a location, workouts started nearby pick it automatically. */
export interface Gym { id: string; name: string; order: number; lat?: number | null; lon?: number | null }

/** Per gym + exercise: machine settings and the weights the machine actually has. Id is `${gymId}|${exId}`. */
export interface Machine {
  id: string;
  gymId: string;
  exId: string;
  /** Free text: seat height, pad position, pin… */
  settings: string;
  /** Available loads in kg, ascending. Empty = learn from history. */
  weights: number[];
}

export interface BodyEntry {
  id: string;
  /** Unix seconds. */
  date: number;
  weightKg: number | null;
  bodyFat: number | null;
  /** Circumferences in cm. */
  waist: number | null;
  chest: number | null;
  arm: number | null;
  thigh: number | null;
  hips: number | null;
  notes: string;
}

export interface Photo { id: string; date: number; blob: Blob; w: number; h: number }

export type ExperimentKind = 'rep_range' | 'tempo' | 'variation';

/** A plateau-breaking experiment and how it turned out. */
export interface Experiment {
  id: string;
  /** Exercise that was stuck. */
  exId: string;
  kind: ExperimentKind;
  /** For 'variation': the substitute exercise. */
  altExId: string | null;
  started: number;
  /** Estimated 1RM on the stuck exercise when it started. */
  baseline: number;
  /** Set when evaluated: e1RM change as a fraction (0.03 = +3%). */
  result: number | null;
  ended: number | null;
}

export interface Routine {
  id: string;
  title: string;
  notes: string;
  order: number;
  exercises: WExercise[];
  updated: number;
}

/** An in-progress workout, persisted so closing the app never loses it. */
export type ActiveWorkout = Omit<Workout, 'end' | 'source'> & {
  /** Set once the next-session targets have been filled in automatically. */
  autofilled?: boolean;
};

/** Running rest timer, stored separately from the workout so the two never overwrite each other. */
export interface RestState {
  /** Unix ms. */
  endsAt: number;
  total: number;
}

export interface Prefs {
  weightUnit: 'kg' | 'lbs';
  distanceUnit: 'kilometers' | 'miles';
  defaultRest: number;
  volumeIncludesWarmups: boolean;
  /** Workouts per week you aim for (consistency). */
  weeklyTarget: number;
  /** Target working sets per muscle per week [low, high]. */
  volumeBand: [number, number];
  /** Ask sleep/energy/soreness when starting a workout. */
  readinessCheck: boolean;
  /** Days between backup reminders (0 = off). */
  backupEveryDays: number;
  /** Fill each workout with the overload targets automatically. */
  autoFill: boolean;
  /** Pick the nearest saved gym from your location when starting a workout. */
  autoGym: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  weightUnit: 'kg',
  distanceUnit: 'kilometers',
  defaultRest: 120,
  volumeIncludesWarmups: true,
  weeklyTarget: 4,
  volumeBand: [10, 20],
  readinessCheck: true,
  backupEveryDays: 7,
  autoFill: true,
  autoGym: true,
};

export type PRType = 'best_weight' | 'best_1rm' | 'best_volume' | 'best_reps' | 'best_duration' | 'best_distance';
