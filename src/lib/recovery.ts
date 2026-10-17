// Muscle recovery: how ready each muscle is for another hard session.
//
// Research prior:
// - Training to failure lengthens neuromuscular recovery; sets stopped short of failure recover within
//   ~24–48 h (Morán-Navarro et al. 2017, Eur J Appl Physiol, doi 10.1007/s00421-017-3725-7).
// - Large / multi-joint / lower-body work typically needs ~48–72 h, small single-joint muscles less
//   (e.g. PMC10101404; IJES vol 8 iss 1 art 10).
// - More fatigue within a set means slower recovery (Pareja-Blanco et al. 2019, Sports).
// Model: every working set leaves a "dose" on its muscles (secondary muscles ½, as in volume research),
// weighted by proximity to failure. Each dose recovers exponentially, ~95% after the muscle's recovery time T.
// Personal calibration: T is scaled by how long *your* performance actually stays depressed after training a
// muscle, measured from your own history (performance vs hours since that muscle was last trained).
// Pure module, unit-tested under node.
import type { Exercise, Workout, WSet } from '../types';
import { setE1rm } from './overload.ts';

const HOUR = 3600;

/** Research-based time (hours) to ~95% recovery by muscle. */
export const PRIOR_HOURS: Record<string, number> = {
  quadriceps: 72, hamstrings: 72, glutes: 72, lower_back: 72, adductors: 60, abductors: 48,
  chest: 60, lats: 60, upper_back: 60, shoulders: 60, traps: 60,
  biceps: 48, triceps: 48, forearms: 48, calves: 48, abdominals: 48, neck: 48,
};
const DEFAULT_HOURS = 60;

/**
 * How much a set counts toward fatigue, by reps in reserve: failure 1.0, 1 RIR 0.85, 2 RIR 0.7, 3+ RIR 0.55.
 * Sets without an RIR entry count 0.85 (most logged working sets are taken close to failure).
 */
export function effortWeight(s: Pick<WSet, 'type' | 'rir'>): number {
  if (s.type === 'warmup') return 0;
  if (s.type === 'failure') return 1;
  switch (s.rir) {
    case 0: return 1;
    case 1: return 0.85;
    case 2: return 0.7;
    case 3: return 0.55;
    default: return s.rir != null && s.rir > 3 ? 0.4 : 0.85;
  }
}

/** Effort-weighted hard sets an exercise put on each muscle (primary 1, secondary ½). An L+R pair counts once. */
export function setDoses(e: { sets: WSet[] }, ex: Exercise): Map<string, number> {
  const work = e.sets.filter(s => s.type !== 'warmup' && s.side !== 'R');
  const d = work.reduce((a, s) => a + effortWeight(s), 0);
  const m = new Map<string, number>();
  if (!d || ex.muscle === 'cardio' || ex.muscle === 'full_body' || ex.muscle === 'other') return m;
  m.set(ex.muscle, d);
  for (const o of ex.other) m.set(o, (m.get(o) ?? 0) + d / 2);
  return m;
}

/** A "full" session for one muscle: ~4 hard sets. Fatigue at or above this reads as 0% recovered. */
const FULL_DOSE = 4;

export interface MuscleRecovery {
  muscle: string;
  /** 0–100. */
  pct: number;
  /** Hours until ≥90% (0 if already there). */
  hoursToReady: number;
  lastTrained: number | null;
}

const recoveredFrac = (hours: number, T: number) => 1 - Math.exp((-3 * hours) / T); // ≈95% at T

/** Recovery of every muscle trained in the last 7 days. `scale` stretches recovery times (personal calibration). */
export function muscleRecovery(workouts: Workout[], exercises: Map<string, Exercise>, nowSec: number, scale = 1): MuscleRecovery[] {
  const doses: { muscle: string; t: number; dose: number }[] = [];
  for (const w of workouts) {
    if (w.end < nowSec - 7 * 24 * HOUR || w.start > nowSec) continue;
    for (const e of w.exercises) {
      const ex = exercises.get(e.exId);
      if (!ex) continue;
      for (const [muscle, dose] of setDoses(e, ex)) doses.push({ muscle, t: w.end, dose });
    }
  }
  const muscles = [...new Set(doses.map(d => d.muscle))];
  const fatigueAt = (muscle: string, at: number) => {
    const T = (PRIOR_HOURS[muscle] ?? DEFAULT_HOURS) * scale;
    return doses.filter(d => d.muscle === muscle && d.t <= at)
      .reduce((a, d) => a + d.dose * (1 - recoveredFrac((at - d.t) / HOUR, T)), 0) / FULL_DOSE;
  };
  return muscles.map(muscle => {
    const pct = Math.round(100 * (1 - Math.min(1, fatigueAt(muscle, nowSec))));
    let h = 0;
    while (h < 168 && 100 * (1 - Math.min(1, fatigueAt(muscle, nowSec + h * HOUR))) < 90) h += 1;
    const last = Math.max(...doses.filter(d => d.muscle === muscle).map(d => d.t));
    return { muscle, pct, hoursToReady: h, lastTrained: last };
  }).sort((a, b) => a.pct - b.pct);
}

/** Readiness of a routine: the least-recovered primary muscle it trains. */
export function routineReadiness(exs: { exId: string }[], rec: MuscleRecovery[], exercises: Map<string, Exercise>) {
  const primaries = [...new Set(exs.map(e => exercises.get(e.exId)?.muscle).filter((m): m is string => !!m))];
  const hits = rec.filter(r => primaries.includes(r.muscle));
  const worst = hits.reduce<MuscleRecovery | null>((w, r) => (!w || r.pct < w.pct ? r : w), null);
  return { worst, recovering: hits.filter(r => r.pct < 90) };
}

// ---- Personal calibration ----------------------------------------------------------------------------

export interface Calibration {
  /** Multiplier on the research recovery times (1 = research as-is). */
  scale: number;
  /** Mean performance vs your recent level by hours since the muscle was last trained (for display). */
  bins: { label: string; from: number; to: number; n: number; pct: number }[];
  /** Hours after which your performance is back to normal, if the data shows it. */
  personalHours: number | null;
  samples: number;
}

// "Rested" stops at 7 days: longer gaps are breaks, where detraining makes you weaker and would skew the baseline.
const BINS: [string, number, number][] = [['< 36 h', 0, 36], ['36–60 h', 36, 60], ['60–84 h', 60, 84], ['84 h – 7 d', 84, 168]];
/** A time window needs this many samples before it can move the research timings. */
const MIN_N = 50;

/**
 * Measures how your top-set strength depends on the time since that muscle was last trained.
 * Each sample: an exercise's best set vs the exercise's best of its previous 5 sessions (same machine: ±25%),
 * against hours since its primary muscle was last trained hard (by any exercise). When the data shows
 * when performance is back to normal, the research recovery times are scaled toward it (shrunk by sample size).
 */
export function calibrate(workouts: Workout[], exercises: Map<string, Exercise>): Calibration {
  const ws = [...workouts].sort((a, b) => a.start - b.start);
  const lastHit = new Map<string, number>(); // muscle -> end time of last session that trained it (primary)
  const recent = new Map<string, number[]>(); // exId -> last top e1RMs
  const samples: { h: number; ratio: number; prior: number }[] = [];
  for (const w of ws) {
    const hitNow = new Set<string>();
    for (const e of w.exercises) {
      const ex = exercises.get(e.exId);
      if (!ex || ex.type !== 'weight_reps') continue;
      const work = e.sets.filter(s => s.type !== 'warmup');
      const top = Math.max(0, ...work.map(setE1rm));
      const hist = recent.get(e.exId) ?? [];
      const prev = lastHit.get(ex.muscle);
      if (top > 0 && hist.length >= 3 && prev != null) {
        const ref = Math.max(...hist.slice(-5));
        const ratio = top / ref;
        const h = (w.start - prev) / HOUR;
        if (ratio > 0.75 && ratio < 1.33 && h > 6 && h < 168) samples.push({ h, ratio, prior: PRIOR_HOURS[ex.muscle] ?? DEFAULT_HOURS });
      }
      if (top > 0) recent.set(e.exId, [...hist, top].slice(-8));
      if (work.length) hitNow.add(ex.muscle);
    }
    for (const m of hitNow) lastHit.set(m, w.end);
  }

  const bins = BINS.map(([label, from, to]) => {
    const s = samples.filter(x => x.h >= from && x.h < to);
    const mean = s.length ? s.reduce((a, x) => a + x.ratio, 0) / s.length : NaN;
    return { label, from, to, n: s.length, pct: mean };
  });
  // Baseline = fully rested performance (84 h – 7 d).
  const rested = bins[3].n >= MIN_N ? bins[3] : null;
  let personalHours: number | null = null;
  if (rested) {
    // First well-sampled window where you perform within 1.5% of rested. If even 60–84 h falls short, you need
    // longer than that. Windows with too few samples say nothing either way.
    let lastDeficit: (typeof bins)[number] | null = null;
    for (const b of bins.slice(0, 3)) {
      if (b.n < MIN_N) continue;
      if (b.pct >= rested.pct - 0.015) { personalHours = b.from === 0 ? 30 : (b.from + b.to) / 2; break; }
      lastDeficit = b;
    }
    // Still weaker in the latest well-sampled window: recovery takes at least until the next one.
    if (personalHours == null && lastDeficit) personalHours = lastDeficit.to <= 60 ? 84 : 96;
  }
  const priorMean = samples.length ? samples.reduce((a, x) => a + x.prior, 0) / samples.length : DEFAULT_HOURS;
  // Shrink toward the research (full trust at ~200 samples). Asymmetric clamp: you mostly train a muscle again
  // when it feels ready, so "no drop" can't prove recovery is much faster (max −20%); a measured drop can
  // lengthen recovery more (up to +50%).
  const w = Math.min(1, samples.length / 200);
  const raw = personalHours != null ? personalHours / priorMean : 1;
  const scale = Math.min(1.5, Math.max(0.8, 1 + (raw - 1) * w));
  return {
    scale,
    bins: bins.map(b => ({ ...b, pct: isNaN(b.pct) ? NaN : (b.pct - (rested?.pct ?? 1)) })),
    personalHours,
    samples: samples.length,
  };
}
