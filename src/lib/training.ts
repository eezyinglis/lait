// Training helpers beyond overload: weight stacks, back-off and warm-up sets, muscle balance, left/right
// imbalance, monthly report, deload detection, time-boxed sessions, exercise swaps and the plateau playbook.
// Pure module (runtime imports only from other pure .ts modules), unit-tested under node.
import type { Exercise, ExerciseType, Experiment, ExperimentKind, Readiness, WExercise, WSet, Workout } from '../types';
import type { HistoryIndex, Session } from './stats';
import { countSets, oneRepMax, weekStart, workoutVolume } from './stats.ts';
import { repsAt, setE1rm } from './overload.ts';

const DAY = 86400, WEEK = 7 * DAY;
/** Same threshold the overload engine uses: a jump this big means a different machine or gym. */
const LEVEL_SHIFT = 0.25;
const working = (sets: WSet[]) => sets.filter(s => s.type !== 'warmup');
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

// ---- Weight stacks -------------------------------------------------------------------------------

/** Weights you've actually used on this exercise (optionally only at one gym), ascending, deduplicated to 0.05 kg. */
export function learnStack(sessions: Session[], gymId?: string | null): number[] {
  const src = gymId ? sessions.filter(s => s.gymId === gymId) : sessions;
  const ws = new Set<number>();
  for (const s of src) for (const set of s.ex.sets) if (set.kg && set.kg > 0) ws.add(Math.round(set.kg * 20) / 20);
  return [...ws].sort((a, b) => a - b);
}

/** Stack used for suggestions: what you entered for the machine, else what you've used (if enough variety). */
export function effectiveStack(entered: number[] | undefined, learned: number[]): number[] | undefined {
  if (entered?.length) return [...entered].sort((a, b) => a - b);
  return learned.length >= 4 ? learned : undefined;
}

/** Parses "5, 10, 12.5 15-30/5" into a sorted list (ranges as from-to/step). */
export function parseStack(text: string): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = part.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
    if (m) {
      const [a, b, st] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (st > 0 && b >= a && (b - a) / st <= 200) for (let v = a; v <= b + 1e-9; v += st) out.add(Math.round(v * 100) / 100);
    } else if (!isNaN(Number(part))) out.add(Number(part));
  }
  return [...out].filter(v => v > 0).sort((a, b) => a - b);
}

export const formatStack = (ws: number[]) => ws.map(w => String(Math.round(w * 100) / 100)).join(', ');

// ---- Back-off sets and warm-ups ------------------------------------------------------------------

/**
 * How your back-off set usually relates to the top set:
 * - ratio: back-off weight / top weight (1 = same weight)
 * - fatigue: back-off strength shown / top-set strength (estimated 1RMs), i.e. how much the first set took out of you.
 * Weight and reps are linked (drop the weight and the reps hold up; keep it and they fall), so the reps are
 * derived from the fatigue factor at the back-off weight rather than averaged separately.
 */
export interface BackoffPattern { ratio: number; fatigue: number }

export function learnBackoff(sessions: Session[]): BackoffPattern {
  const ratios: number[] = [], fatigue: number[] = [];
  for (const s of sessions.slice(-12)) {
    const w = working(s.ex.sets).filter(x => !x.side || x.side === 'L');
    if (w.length < 2 || !w[0].kg || !w[1].kg || !w[0].reps || !w[1].reps) continue;
    const r = w[1].kg / w[0].kg;
    if (r < 0.6 || r > 1.05) continue; // not a back-off (different exercise use or a typo)
    ratios.push(r);
    fatigue.push(oneRepMax(w[1].kg, w[1].reps) / oneRepMax(w[0].kg, w[0].reps));
  }
  if (!ratios.length) return { ratio: 1, fatigue: 0.965 }; // ≈ one rep fewer at the same weight
  const ratio = median(ratios);
  return { ratio: ratio > 0.985 ? 1 : ratio, fatigue: Math.min(1, median(fatigue)) };
}

/** Back-off target from what you actually just did on the top set, following your usual pattern. */
export function backoffTarget(top: WSet, p: BackoffPattern, snap: (kg: number) => number = kg => Math.round(kg * 4) / 4): { kg: number | null; reps: number | null } {
  if (top.kg == null || top.reps == null) return { kg: top.kg, reps: top.reps };
  const kg = p.ratio === 1 ? top.kg : snap(top.kg * p.ratio);
  const reps = repsAt(oneRepMax(top.kg, top.reps) * p.fatigue, kg);
  return { kg, reps: Math.max(1, Math.min(reps, p.ratio === 1 ? top.reps : 30)) };
}

/**
 * Warm-up ramp toward a working weight: heavier targets get more steps. Loads snap down to the stack/step,
 * and the ramp never repeats a load or reaches the working weight.
 */
export function warmupRamp(targetKg: number, stack: number[] | undefined, step: number): { kg: number; reps: number }[] {
  if (!targetKg || targetKg <= 0) return [];
  const plan: [number, number][] = targetKg >= 100 ? [[0.4, 10], [0.6, 6], [0.75, 4], [0.85, 2]]
    : targetKg >= 40 ? [[0.5, 8], [0.7, 4], [0.85, 2]]
      : targetKg >= 15 ? [[0.55, 8], [0.8, 3]]
        : [[0.6, 8]];
  const snap = (kg: number) => {
    if (stack?.length) return [...stack].reverse().find(x => x <= kg + 1e-6) ?? stack[0];
    return Math.max(step, Math.round(kg / step) * step);
  };
  const out: { kg: number; reps: number }[] = [];
  for (const [p, reps] of plan) {
    const kg = snap(targetKg * p);
    if (kg < targetKg - 1e-6 && !out.some(o => Math.abs(o.kg - kg) < 1e-6)) out.push({ kg, reps });
  }
  return out;
}

// ---- Readiness -----------------------------------------------------------------------------------

/** Average of the check-in (soreness is entered as 5 = fresh, 1 = very sore). */
export const readinessScore = (r: Readiness | null | undefined) => (r ? (r.sleep + r.energy + r.soreness) / 3 : null);

// ---- Muscle balance ------------------------------------------------------------------------------

export interface MuscleVolume { muscle: string; perWeek: number; prevPerWeek: number; status: 'low' | 'ok' | 'high' }

/**
 * Working sets per muscle per week over the last `weeks` weeks (secondary muscles count half), compared with
 * the `weeks` before, and against your target band.
 */
export function muscleVolume(workouts: Workout[], exercises: Map<string, Exercise>, nowSec: number, band: [number, number], weeks = 4): MuscleVolume[] {
  const tally = (from: number, to: number) => {
    const m = new Map<string, number>();
    for (const w of workouts) {
      if (w.start < from || w.start >= to) continue;
      for (const e of w.exercises) {
        const ex = exercises.get(e.exId);
        if (!ex || ex.muscle === 'cardio' || ex.muscle === 'full_body' || ex.muscle === 'other') continue;
        // An L+R pair is one set for the muscle.
        const n = e.sets.filter(s => s.type !== 'warmup' && s.side !== 'R').length;
        m.set(ex.muscle, (m.get(ex.muscle) ?? 0) + n);
        for (const o of ex.other) m.set(o, (m.get(o) ?? 0) + n / 2);
      }
    }
    return m;
  };
  const cur = tally(nowSec - weeks * WEEK, nowSec + 1), prev = tally(nowSec - 2 * weeks * WEEK, nowSec - weeks * WEEK);
  const muscles = new Set([...cur.keys(), ...prev.keys()]);
  return [...muscles].map(muscle => {
    const perWeek = (cur.get(muscle) ?? 0) / weeks, prevPerWeek = (prev.get(muscle) ?? 0) / weeks;
    return { muscle, perWeek, prevPerWeek, status: perWeek < band[0] ? 'low' as const : perWeek > band[1] ? 'high' as const : 'ok' as const };
  }).sort((a, b) => b.perWeek - a.perWeek);
}

const PUSH = ['chest', 'shoulders', 'triceps'], PULL = ['lats', 'upper_back', 'biceps', 'traps'];

/** Plain-language warnings: push/pull and quad/hamstring ratios, and muscles whose volume dropped sharply. */
export function balanceWarnings(vol: MuscleVolume[]): string[] {
  const v = (m: string) => vol.find(x => x.muscle === m)?.perWeek ?? 0;
  const out: string[] = [];
  const push = PUSH.reduce((a, m) => a + v(m), 0), pull = PULL.reduce((a, m) => a + v(m), 0);
  if (push > 4 && pull < push * 0.75) out.push(`Pulling volume is ${Math.round((pull / push) * 100)}% of pushing. Aim for roughly 1:1 to keep shoulders healthy.`);
  if (pull > 4 && push < pull * 0.6) out.push(`Pushing volume is only ${Math.round((push / pull) * 100)}% of pulling.`);
  const q = v('quadriceps'), h = v('hamstrings');
  if (q > 3 && h < q * 0.6) out.push(`Hamstrings get ${Math.round((h / q) * 100)}% of the quad volume. Around 70–100% is a healthier balance.`);
  for (const m of vol) if (m.prevPerWeek >= 4 && m.perWeek < m.prevPerWeek * 0.6) {
    out.push(`${m.muscle.replace(/_/g, ' ')} volume fell ${Math.round((1 - m.perWeek / m.prevPerWeek) * 100)}% compared with the 4 weeks before.`);
  }
  return out;
}

// ---- Left / right ----------------------------------------------------------------------------------

export interface SidePoint { start: number; L: number; R: number }

/** Best estimated 1RM per side for each unilateral session of an exercise. */
export function sideHistory(sessions: Session[]): SidePoint[] {
  return sessions.filter(s => s.ex.sets.some(x => x.side)).map(s => {
    const best = (side: 'L' | 'R') => Math.max(0, ...working(s.ex.sets).filter(x => x.side === side).map(setE1rm));
    return { start: s.start, L: best('L'), R: best('R') };
  }).filter(p => p.L > 0 && p.R > 0);
}

/** Weaker side over the last 3 unilateral sessions, if it trails by 5% or more. */
export function imbalance(points: SidePoint[]): { weak: 'L' | 'R'; pct: number; reps: number } | null {
  const last = points.slice(-3);
  if (last.length < 2) return null;
  const L = last.reduce((a, p) => a + p.L, 0) / last.length, R = last.reduce((a, p) => a + p.R, 0) / last.length;
  const weak = L < R ? 'L' : 'R';
  const pct = Math.abs(L - R) / Math.max(L, R);
  // ~3% of 1RM per rep in the 6–10 rep zone.
  return pct >= 0.05 ? { weak, pct, reps: Math.max(1, Math.round(pct / 0.03)) } : null;
}

// ---- Monthly report --------------------------------------------------------------------------------

export interface MonthReport {
  year: number; month: number;
  workouts: number; seconds: number; volume: number; sets: number; prs: number;
  weeksHit: number; weeksTotal: number; targetPerWeek: number;
  topPrs: { exId: string; count: number }[];
  gains: { exId: string; pct: number }[];
  stalled: { exId: string; sessions: number }[];
  prev: { workouts: number; volume: number } | null;
}

export function monthlyReport(workouts: Workout[], history: HistoryIndex, types: Map<string, ExerciseType>, year: number, month: number, targetPerWeek: number, includeWarmups = true): MonthReport {
  const from = new Date(year, month, 1).getTime() / 1000, to = new Date(year, month + 1, 1).getTime() / 1000;
  const inMonth = workouts.filter(w => w.start >= from && w.start < to);
  const pFrom = new Date(year, month - 1, 1).getTime() / 1000;
  const prevW = workouts.filter(w => w.start >= pFrom && w.start < from);

  const prCounts = new Map<string, number>();
  let prs = 0;
  for (const w of inMonth) {
    const m = history.prsByWorkout.get(w.id);
    if (!m) continue;
    for (const [ei, sets] of m) {
      const n = [...sets.values()].reduce((a, x) => a + x.length, 0);
      prs += n;
      const id = w.exercises[ei].exId;
      prCounts.set(id, (prCounts.get(id) ?? 0) + n);
    }
  }

  // Weeks (Mon–Sun) that start in this month and hit the weekly target.
  const weeks = new Map<number, number>();
  for (let t = weekStart(from); t < to; t += WEEK) if (t >= from - 6 * DAY) weeks.set(t, 0);
  for (const w of workouts) { const k = weekStart(w.start); if (weeks.has(k)) weeks.set(k, weeks.get(k)! + 1); }

  // Strength change: best top-set e1RM this month vs the month before, per exercise done in both.
  const gains: { exId: string; pct: number }[] = [], stalled: { exId: string; sessions: number }[] = [];
  for (const [exId, ss] of history.byExercise) {
    if ((types.get(exId) ?? 'weight_reps') !== 'weight_reps') continue;
    const best = (a: number, b: number) => Math.max(0, ...ss.filter(s => !s.illness && s.start >= a && s.start < b).flatMap(s => working(s.ex.sets).map(setE1rm)));
    const now = best(from, to), before = best(pFrom, from);
    const n = ss.filter(s => s.start >= from && s.start < to).length;
    // A month-over-month change beyond ±25% is a different machine or gym, not strength.
    if (now > 0 && before > 0 && Math.abs(now / before - 1) <= LEVEL_SHIFT) {
      const pct = now / before - 1;
      gains.push({ exId, pct });
      if (pct <= 0 && n >= 3) stalled.push({ exId, sessions: n });
    }
  }
  gains.sort((a, b) => b.pct - a.pct);
  const vol = (ws: Workout[]) => ws.reduce((a, w) => a + workoutVolume(w, types, includeWarmups), 0);
  return {
    year, month,
    workouts: inMonth.length,
    seconds: inMonth.reduce((a, w) => a + (w.end - w.start), 0),
    volume: vol(inMonth),
    sets: inMonth.reduce((a, w) => a + countSets(w), 0),
    prs,
    weeksHit: [...weeks.values()].filter(n => n >= targetPerWeek).length,
    weeksTotal: weeks.size,
    targetPerWeek,
    topPrs: [...prCounts.entries()].map(([exId, count]) => ({ exId, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    gains: gains.filter(g => g.pct > 0).slice(0, 5),
    stalled: stalled.sort((a, b) => b.sessions - a.sessions).slice(0, 5),
    prev: prevW.length ? { workouts: prevW.length, volume: vol(prevW) } : null,
  };
}

// ---- Deload detection ------------------------------------------------------------------------------

/**
 * Many lifts going backwards at the same time points to accumulated fatigue rather than single-exercise plateaus.
 * Compares each active exercise's best e1RM of the last 2 weeks with the 4 weeks before.
 */
export function deloadCheck(history: HistoryIndex, types: Map<string, ExerciseType>, nowSec: number): { suggest: boolean; down: number; active: number } {
  let down = 0, active = 0;
  for (const [exId, ss] of history.byExercise) {
    if ((types.get(exId) ?? 'weight_reps') !== 'weight_reps') continue;
    const best = (a: number, b: number) => Math.max(0, ...ss.filter(s => s.start >= a && s.start < b).flatMap(s => working(s.ex.sets).map(setE1rm)));
    const recent = best(nowSec - 2 * WEEK, nowSec + 1), before = best(nowSec - 6 * WEEK, nowSec - 2 * WEEK);
    if (!recent || !before || Math.abs(recent / before - 1) > LEVEL_SHIFT) continue; // machine change, not fatigue
    active++;
    if (recent < before * 0.97) down++;
  }
  return { suggest: active >= 5 && down / active >= 0.4, down, active };
}

// ---- Time-boxed sessions ---------------------------------------------------------------------------

/** Rough session length: ~40 s per set plus rest between sets, plus 1 min per exercise for setup. */
export function estimateMinutes(exs: WExercise[], defaultRest: number): number {
  let sec = 0;
  for (const e of exs) {
    const n = e.sets.length;
    const rest = (e.uni ? 0.5 : 1) * (e.rest ?? defaultRest);
    sec += 60 + n * 40 + Math.max(0, n - 1) * rest;
  }
  return Math.round(sec / 60);
}

/**
 * Trims a routine to fit `minutes`: first drops warm-ups beyond one, then back-off sets of later exercises,
 * then whole exercises from the end. The first exercises (your priorities) are kept longest.
 */
export function timeBox(exs: WExercise[], minutes: number, defaultRest: number): { exercises: WExercise[]; dropped: string[]; minutes: number } {
  let list = exs.map(e => ({ ...e, sets: [...e.sets] }));
  const dropped: string[] = [];
  const fits = () => estimateMinutes(list, defaultRest) <= minutes;
  // 1) At most one warm-up per exercise.
  for (const e of list) {
    if (fits()) break;
    let seen = 0;
    e.sets = e.sets.filter(s => s.type !== 'warmup' || ++seen <= 1);
  }
  // 2) Remove back-off sets from the last exercise backwards (keep the top set, or one L/R pair).
  for (let i = list.length - 1; i >= 0 && !fits(); i--) {
    const e = list[i];
    const keep = e.uni ? 2 : 1;
    while (!fits() && e.sets.filter(s => s.type !== 'warmup').length > keep) {
      const idx = e.sets.map(s => s.type !== 'warmup').lastIndexOf(true);
      e.sets.splice(idx, 1);
    }
  }
  // 3) Drop whole exercises from the end, but always keep the first.
  while (!fits() && list.length > 1) dropped.push(list.pop()!.exId);
  return { exercises: list, dropped, minutes: estimateMinutes(list, defaultRest) };
}

// ---- Exercise swap ---------------------------------------------------------------------------------

/**
 * Converts a target load from one exercise to a substitute using your own strength ratio between them
 * (best e1RM in the last 6 months on each). Null if you have no history on one of them.
 */
export function swapRatio(from: Session[], to: Session[], nowSec: number): number | null {
  const best = (ss: Session[]) => Math.max(0, ...ss.filter(s => s.start >= nowSec - 26 * WEEK).flatMap(s => working(s.ex.sets).map(setE1rm)));
  const a = best(from), b = best(to);
  return a > 0 && b > 0 ? b / a : null;
}

/** Substitutes: same primary muscle, most-used first. */
export function substitutes(ex: Exercise, all: Exercise[], history: HistoryIndex, limit = 8): Exercise[] {
  return all.filter(e => e.id !== ex.id && e.muscle === ex.muscle && e.type === ex.type)
    .map(e => ({ e, uses: history.byExercise.get(e.id)?.length ?? 0 }))
    .sort((a, b) => b.uses - a.uses || a.e.title.localeCompare(b.e.title))
    .slice(0, limit).map(x => x.e);
}

// ---- Plateau playbook ------------------------------------------------------------------------------

export interface PlaybookOption { kind: ExperimentKind; title: string; how: string; altExId?: string }

/** Concrete ways out of a plateau, best first: what has worked for you before is listed first. */
export function playbook(ex: Exercise, kg: number, reps: number, alts: Exercise[], past: Experiment[], fmt: (kg: number) => string): PlaybookOption[] {
  const lighter = kg * 0.85;
  const opts: PlaybookOption[] = [
    { kind: 'rep_range', title: 'Switch rep range for 3 weeks', how: `Use about ${fmt(lighter)} for ${reps + 4}–${reps + 6} reps, then come back to ${fmt(kg)}.` },
    { kind: 'tempo', title: 'Slow eccentrics for 3 weeks', how: `Same ${fmt(kg)}, lower each rep over 3 seconds. Expect 1–2 fewer reps at first.` },
  ];
  if (alts[0]) opts.push({ kind: 'variation', title: `Swap to ${alts[0].title} for 3 weeks`, how: `Train ${alts[0].title} in its place, then return to ${ex.title}.`, altExId: alts[0].id });
  // Your own track record first: average result of past experiments per kind.
  const score = (k: ExperimentKind) => {
    const done = past.filter(p => p.kind === k && p.result != null);
    return done.length ? done.reduce((a, p) => a + p.result!, 0) / done.length : 0;
  };
  return opts.sort((a, b) => score(b.kind) - score(a.kind));
}

/** An experiment is evaluated once 3 weeks have passed and the stuck exercise has been done again since. */
export function evaluateExperiment(exp: Experiment, sessions: Session[], nowSec: number): number | null {
  if (nowSec - exp.started < 3 * WEEK) return null;
  const after = sessions.filter(s => s.start >= exp.started + 3 * WEEK - DAY);
  if (!after.length) return null;
  const best = Math.max(...after.flatMap(s => working(s.ex.sets).map(setE1rm)));
  return best > 0 && exp.baseline > 0 ? best / exp.baseline - 1 : null;
}

// ---- Copy last ---------------------------------------------------------------------------------------

/** Replaces the unticked sets with the last session's sets (values and types), keeping ticked ones. */
export function copyLast(ex: WExercise, last: WSet[]): WExercise {
  if (!last.length) return ex;
  const done = ex.sets.filter(s => s.done);
  const fresh = last.slice(done.length).map(s => ({ ...s, done: false, at: null, rir: null }));
  return { ...ex, uni: last.some(s => s.side) || undefined, sets: [...done, ...fresh] };
}


// ---- Auto-tune settings from history ----------------------------------------------------------------

const BANDS: [number, number][] = [[6, 10], [8, 14], [10, 20], [12, 22], [15, 25]];

export interface Tuned {
  weeklyTarget: number;
  volumeBand: [number, number];
  /** Seconds; null if the history has no set timestamps. */
  defaultRest: number | null;
}

/**
 * Settings that match how you actually train, learned from history:
 * - weekly target: median workouts per active week over the last 12 weeks,
 * - volume band: the preset closest to your typical weekly sets per muscle,
 * - default rest: median time between completed sets (minus ~35 s for the set itself), to the nearest 15 s.
 */
export function autoTune(workouts: Workout[], exercises: Map<string, Exercise>, nowSec: number): Tuned {
  const recent = workouts.filter(w => w.start >= nowSec - 12 * WEEK);
  const perWeek = new Map<number, number>();
  for (const w of recent) perWeek.set(weekStart(w.start), (perWeek.get(weekStart(w.start)) ?? 0) + 1);
  // Your normal rhythm, not the light weeks: the 75th percentile of weeks you trained at all.
  const counts = [...perWeek.values()].sort((a, b) => a - b);
  const p75 = counts.length ? counts[Math.min(counts.length - 1, Math.floor(counts.length * 0.75))] : 0;
  const weeklyTarget = Math.min(7, Math.max(1, p75 || 3));

  const vol = muscleVolume(workouts, exercises, nowSec, [10, 20]).filter(v => v.perWeek > 0).slice(0, 8);
  const typical = median(vol.map(v => v.perWeek));
  // The preset whose middle is closest to your typical weekly sets (a little above, to leave room to grow).
  const volumeBand = vol.length
    ? BANDS.reduce((b, x) => (Math.abs((x[0] + x[1]) / 2 - typical * 1.15) < Math.abs((b[0] + b[1]) / 2 - typical * 1.15) ? x : b))
    : [10, 20] as [number, number];

  const gaps: number[] = [];
  for (const w of workouts.slice(0, 60)) for (const e of w.exercises) {
    const t = e.sets.map(s => s.at ?? 0).filter(Boolean).sort((a, b) => a - b);
    for (let i = 1; i < t.length; i++) { const g = t[i] - t[i - 1]; if (g >= 30 && g <= 600) gaps.push(g); }
  }
  const defaultRest = gaps.length >= 10 ? Math.min(300, Math.max(30, Math.round((median(gaps) - 35) / 15) * 15)) : null;
  return { weeklyTarget, volumeBand, defaultRest };
}

// ---- Gym by location ---------------------------------------------------------------------------------

/** Metres between two coordinates (haversine). */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** The closest saved gym within `maxM` metres (gyms without a location are ignored). */
export function nearestGym<G extends { id: string; lat?: number | null; lon?: number | null }>(gyms: G[], lat: number, lon: number, maxM = 400): G | null {
  let best: G | null = null, bestD = Infinity;
  for (const g of gyms) {
    if (g.lat == null || g.lon == null) continue;
    const d = distanceM(lat, lon, g.lat, g.lon);
    if (d < bestD && d <= maxM) { best = g; bestD = d; }
  }
  return best;
}
