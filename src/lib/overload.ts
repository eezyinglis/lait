// Progressive-overload suggestions from your own history, on a realistic (slow, slowing) curve.
//
// Calibration (measured on 4 years of real training data, see scripts/analyze-rates.mjs):
// over long stretches on the same machine, estimated 1RM rose a median 0.26%/week (IQR 0.08–0.67%).
// Short-term swings look much faster but don't last, so suggestions are paced by the long-run rate.
//
// Model per exercise:
// - Streak: sessions since the last machine/gym change (a >25% top-set jump).
// - Rep range: where recent top sets land (20th–80th percentile). Weight step: the usual jump you make.
// - Capability E0: best estimated 1RM of the last 3 streak sessions, capped at +10% over the last one.
// - Rate r: the streak's own long-run trend, shrunk toward your personal median, capped by experience.
// - Projection with diminishing returns: E(w) = E0 * (1 + r*K*ln(1 + w/K)), K = 16 weeks.
//   Gains per week start at r and keep shrinking, so each milestone takes longer than the last.
// - Ladder (double progression on the top set): +1 rep until the top of the range, then +1 weight step
//   at the reps that keep the same 1RM. Each rung is due when the projection reaches its 1RM.
// - Next session: take the next rung only if the projection for that day covers it; otherwise match the
//   current level and show when the next rung is realistically due.
// Pure module (only stats.ts at runtime), unit-tested under node.
import type { ExerciseType, Illness, WSet } from '../types';
import type { Session } from './stats';
import { oneRepMax } from './stats.ts';

export type Advice = 'weight' | 'reps' | 'hold' | 'plateau' | 'return' | 'easy';

export interface SetTarget { kg: number | null; reps: number | null; sec: number | null; side?: 'L' | 'R' | null }

export interface Milestone { kg: number; reps: number; e1rm: number; weeks: number; kind: 'reps' | 'weight' }

export interface Suggestion {
  advice: Advice;
  /** Next-session target. Units are added by the UI. */
  headline: { kg: number | null; reps: number | null; sec?: number | null; addKg?: number; addReps?: number; addSec?: number };
  /** Why, in plain words. */
  reason: string;
  /** Targets for the working sets of the next session, in last session's order (warm-ups excluded). */
  sets: SetTarget[];
  repRange: [number, number];
  step: number;
  /** Current capability (estimated 1RM). */
  e1rm: number;
  /** Expected long-run gain, fraction per week (0.0026 = 0.26%/week). */
  rate: number;
  /** Rungs after the next-session target, with expected weeks from now (non-linear spacing). */
  milestones: Milestone[];
  /** Typical days between sessions of this exercise. */
  gapDays: number;
  theory: { atKg: number; forReps: number; repsAtWeight: number; addReps: number; kgAtReps: number; addKg: number } | null;
  lastDate: number;
  sessions: number;
  /** Post-illness mode: reps to keep in reserve, and working sets to leave out per exercise. */
  targetRir?: number;
  dropSets?: number;
}

const PCT: number[] = [0, 1, 0.97, 0.94, 0.92, 0.89, 0.86, 0.83, 0.81, 0.78, 0.75, 0.73, 0.71, 0.7, 0.68, 0.67, 0.65, 0.64, 0.63, 0.61, 0.6,
  0.59, 0.58, 0.57, 0.56, 0.55, 0.54, 0.53, 0.52, 0.51, 0.5];

/** Max reps the 1RM table allows at `kg` for someone whose 1RM is `e1rm` (0 if not even one). */
export function repsAt(e1rm: number, kg: number): number {
  if (kg <= 0 || e1rm <= 0) return 0;
  let r = 0;
  for (let i = 1; i <= 30; i++) if (kg <= e1rm * PCT[i] * (1 + 1e-9)) r = i;
  return r;
}

/** Heaviest weight the table allows for `reps` reps. */
export const kgAt = (e1rm: number, reps: number) => e1rm * PCT[Math.min(30, Math.max(1, Math.round(reps)))];

// ---- Projection with diminishing returns -------------------------------------------------------

/**
 * Time scale (weeks) of the slowdown: gain/week = r / (1 + w/K), so it halves after K weeks.
 * K = 16 bends the curve visibly: 16 weeks give ~70% of a straight line, a year ~45%.
 */
export const PROJ_K = 16;

/** Projected 1RM `weeks` from now, starting at `e0` and gaining `rate`/week initially. */
export function project(e0: number, rate: number, weeks: number): number {
  return e0 * (1 + rate * PROJ_K * Math.log(1 + Math.max(0, weeks) / PROJ_K));
}

/** Weeks until the projection reaches `target` (0 if already there, Infinity if never). */
export function weeksTo(e0: number, rate: number, target: number): number {
  if (target <= e0) return 0;
  if (rate <= 0) return Infinity;
  return PROJ_K * (Math.exp((target / e0 - 1) / (rate * PROJ_K)) - 1);
}

/** Your typical long-run rate across exercises (fallback 0.26%/week, the measured median). */
export const DEFAULT_RATE = 0.0026;

/** Experience cap on the weekly rate: generous on a brand-new exercise, tight after half a year. */
export function rateCap(weeksOnExercise: number): number {
  return weeksOnExercise < 8 ? 0.015 : weeksOnExercise < 26 ? 0.0075 : 0.005;
}
const RATE_FLOOR = 0.0005;

// ---- History helpers -----------------------------------------------------------------------------

const working = (sets: WSet[]) => sets.filter(s => s.type !== 'warmup');
/**
 * Estimated 1RM of a set, counting reps left in reserve: 8 reps with 2 in the tank is treated like 10 to failure.
 * RIR 3 means "3 or more", so it is counted as 3.
 */
export const setE1rm = (s: WSet) => oneRepMax(s.kg, (s.reps ?? 0) + Math.min(3, Math.max(0, s.rir ?? 0)));
const topSet = (sets: WSet[]) =>
  working(sets).reduce<WSet | null>((b, s) => (!b || setE1rm(s) > setE1rm(b) ? s : b), null);
const topKg = (s: Session) => topSet(s.ex.sets)?.kg ?? 0;
const topE1rm = (s: Session) => { const t = topSet(s.ex.sets); return t ? setE1rm(t) : 0; };

const STEP_BY_EQUIP: Record<string, number> = { barbell: 2.5, dumbbell: 2, kettlebell: 4, machine: 2.5, plate: 2.5, resistance_band: 2.5, suspension: 2.5, other: 2.5, none: 2.5 };
const WEEK = 7 * 86400;
const DAY = 86400;

const quantile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};

/** A top-set weight change this big means a different machine/gym, not progress. */
const LEVEL_SHIFT = 0.25;

/** Sessions since the last machine/gym change (a >25% jump in the top set). */
export function currentStreak(sessions: Session[]): Session[] {
  let i = sessions.length - 1;
  while (i > 0) {
    const a = topKg(sessions[i - 1]), b = topKg(sessions[i]);
    if (a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) > LEVEL_SHIFT) break;
    i--;
  }
  return sessions.slice(i);
}

/** All streaks of an exercise, oldest first. */
function streaks(sessions: Session[]): Session[][] {
  const out: Session[][] = [];
  let rest = sessions;
  while (rest.length) {
    const s = currentStreak(rest);
    out.unshift(s);
    rest = rest.slice(0, rest.length - s.length);
  }
  return out;
}

/** Net long-run rate of a streak (ln growth per week), or null if it's too short to say. */
export function streakRate(streak: Session[]): { rate: number; weeks: number } | null {
  if (streak.length < 6) return null;
  const weeks = (streak[streak.length - 1].start - streak[0].start) / WEEK;
  if (weeks < 6) return null;
  const a = Math.max(...streak.slice(0, 3).map(topE1rm)), b = Math.max(...streak.slice(-3).map(topE1rm));
  if (a <= 0 || b <= 0) return null;
  return { rate: Math.log(b / a) / weeks, weeks };
}

/** Your personal median long-run rate across every exercise streak of 12+ weeks. */
export function personalRate(all: Iterable<Session[]>): number {
  const rates: number[] = [];
  for (const sessions of all)
    for (const st of streaks(sessions.filter(s => working(s.ex.sets).length))) {
      const r = streakRate(st);
      if (r && r.weeks >= 12) rates.push(r.rate);
    }
  return rates.length >= 3 ? Math.max(RATE_FLOOR, quantile(rates, 0.5)) : DEFAULT_RATE;
}

/** The weight jump this exercise usually progresses by (only plausible jumps, seen at least twice). */
export function learnStep(sessions: Session[], equip: string): number {
  const tops = sessions.slice(-30).map(topKg).filter(k => k > 0);
  const jumps = new Map<number, number>();
  for (let i = 1; i < tops.length; i++) {
    const d = Math.round((tops[i] - tops[i - 1]) * 4) / 4; // to 0.25 kg
    // Under 1 kg is kg/lb rounding noise; over max(5 kg, 10%) is a machine change or a typo.
    if (d >= 1 && d <= Math.max(5, tops[i - 1] * 0.1)) jumps.set(d, (jumps.get(d) ?? 0) + 1);
  }
  const best = [...jumps.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return best && best[1] >= 2 ? best[0] : STEP_BY_EQUIP[equip] ?? 2.5;
}

/** Rep band the recent top sets land in. */
export function learnRepRange(sessions: Session[]): [number, number] {
  const reps = sessions.slice(-12).map(s => topSet(s.ex.sets)?.reps ?? 0).filter(r => r > 0);
  if (reps.length < 2) return [6, 10];
  let lo = Math.max(3, Math.round(quantile(reps, 0.2)));
  let hi = Math.min(30, Math.round(quantile(reps, 0.8)));
  if (hi <= lo) hi = lo + 2;
  if (hi - lo > 6) lo = hi - 6;
  return [lo, hi];
}

/** Typical days between sessions of this exercise (recent median, 2–14). */
function typicalGap(sessions: Session[]): number {
  const t = sessions.slice(-9).map(s => s.start);
  const gaps = t.slice(1).map((x, i) => (x - t[i]) / DAY);
  return gaps.length ? Math.min(14, Math.max(2, quantile(gaps, 0.5))) : 4;
}

/**
 * Upcoming rungs from the current top set: +1 rep up to the top of the range, then one weight step
 * at the reps that keep the same 1RM (at least the bottom of the range).
 */
export function ladder(kg: number, reps: number, [lo, hi]: [number, number], step: number | ((w: number) => number), e0: number, rate: number, count = 4): Milestone[] {
  const nextW = typeof step === 'number' ? (w: number) => w + step : step;
  const out: Milestone[] = [];
  let w = kg, r = reps;
  for (let i = 0; i < count; i++) {
    let kind: Milestone['kind'];
    if (r < hi) { r += 1; kind = 'reps'; }
    else { const cur = oneRepMax(w, r); w = nextW(w); r = Math.max(lo, Math.min(r - 1, repsAt(cur, w))); kind = 'weight'; }
    const e = oneRepMax(w, r);
    out.push({ kg: w, reps: r, e1rm: e, weeks: weeksTo(e0, rate, e), kind });
  }
  // A later rung can never be due earlier than the one before it.
  for (let i = 1; i < out.length; i++) out[i].weeks = Math.max(out[i].weeks, out[i - 1].weeks);
  return out;
}

export interface SuggestOptions {
  /** Formats a kg value for reason text in the user's unit. */
  fw?: (kg: number) => string;
  /** Personal long-run rate prior (see personalRate). */
  prior?: number;
  /** Weights this machine actually has (kg, ascending); weight jumps go to the next one up. */
  stack?: number[];
  /** Today's readiness check-in, average of sleep/energy/soreness on 1–5. */
  readiness?: number | null;
  /** Training while ill or just after (ticked on the workout). */
  illness?: Illness | null;
}

/**
 * Post-illness mode. A cold with symptoms only above the neck: train lighter. After a fever or the flu, strength
 * and heat tolerance are down for a while and the heart works harder, so go clearly lighter with less volume.
 * Both stop well short of failure (3+ reps in reserve): effort is what costs recovery, and the immune system is
 * still busy. The level comes back within a few normal sessions, so these sessions never count as a drop.
 */
export const ILLNESS: Record<Illness, { pct: number; rir: number; dropSets: number; label: string }> = {
  mild: { pct: 0.9, rir: 3, dropSets: 0, label: 'Mild (cold, no fever)' },
  flu: { pct: 0.8, rir: 3, dropSets: 1, label: 'After fever or flu' },
};

/** Next real weight above `w` on a stack, else `w + step`. */
export function nextOnStack(w: number, stack: number[] | undefined, step: number): number {
  return stack?.find(x => x > w + 1e-6) ?? w + step;
}
/** Heaviest real weight at or below `w` (never below the lightest), else rounded down to the step. */
export function floorOnStack(w: number, stack: number[] | undefined, step: number): number {
  if (stack?.length) return [...stack].reverse().find(x => x <= w + 1e-6) ?? stack[0];
  // The epsilon keeps 62.4999… (65 × 0.9615) at 62.5 instead of dropping a whole step.
  return Math.max(step, Math.floor(w / step + 1e-6) * step);
}

/** Return-from-break ramp: sessions needed and the starting load, by days off. */
export function rampFor(daysOff: number): { sessions: number; startPct: number } {
  return daysOff <= 28 ? { sessions: 2, startPct: 0.95 } : daysOff <= 56 ? { sessions: 3, startPct: 0.9 } : { sessions: 4, startPct: 0.85 };
}

export function suggest(sessions: Session[], type: ExerciseType, equip: string, nowSec: number, opts: SuggestOptions = {}): Suggestion | null {
  const fw = opts.fw ?? (kg => `${trim(kg)} kg`);
  const prior = opts.prior ?? DEFAULT_RATE;
  // Sessions done while ill say nothing about your real level, so they're left out (unless that's all there is).
  const healthy = sessions.filter(s => !s.illness && working(s.ex.sets).length);
  const done = healthy.length ? healthy : sessions.filter(s => working(s.ex.sets).length);
  if (!done.length) return null;
  const last = done[done.length - 1];
  const lastWork = working(last.ex.sets);
  const daysOff = (nowSec - last.start) / DAY;
  const gapDays = typicalGap(done);
  const base = { lastDate: last.start, sessions: done.length, gapDays };

  if (type !== 'weight_reps') {
    const simple = simpleSuggest(done, type, lastWork, daysOff, base);
    return opts.illness ? easeSimple(simple, opts.illness) : simple;
  }

  const streak = currentStreak(done);
  const stack = opts.stack?.length ? [...opts.stack].sort((a, b) => a - b) : undefined;
  const learned = learnStep(done, equip);
  const repRange = learnRepRange(done);
  const [lo, hi] = repRange;
  const top = topSet(last.ex.sets)!;
  const W = top.kg ?? 0, R = top.reps ?? 0;
  const nextW = (w: number) => nextOnStack(w, stack, learned);
  const step = nextW(W) - W;

  // Capability: best of the last 3 comparable sessions, at most 10% above the last one.
  const e0 = Math.min(Math.max(...streak.slice(-3).map(topE1rm)), topE1rm(last) * 1.1);

  // Rate: the streak's own trend shrunk toward your personal median (12 weeks of prior weight), capped by experience.
  const own = streakRate(streak);
  const weeksOnExercise = (last.start - done[0].start) / WEEK;
  const blended = own ? (own.rate * own.weeks + prior * 12) / (own.weeks + 12) : prior;
  let rate = Math.min(rateCap(weeksOnExercise), Math.max(RATE_FLOOR, blended));
  // The first few sessions on a new machine climb fast while you learn its feel and find your real level.
  const freshSetup = streak.length < 4 && done.length > streak.length;
  if (freshSetup) rate = Math.max(rate, 0.015);

  const theory = W > 0 && e0 > 0 ? (() => {
    const ra = repsAt(e0, W), ka = kgAt(e0, R || lo);
    return { atKg: W, forReps: R || lo, repsAtWeight: ra, addReps: Math.max(0, ra - R), kgAtReps: ka, addKg: Math.max(0, ka - W) };
  })() : null;

  const milestones = ladder(W, R, repRange, nextW, e0, rate, 7);
  const common = { ...base, step, repRange, e1rm: e0, rate, milestones, theory };
  const pctWk = `${(rate * 100).toFixed(2)}%/week`;
  const when = (weeks: number) => (weeks < 1 ? 'within a week' : weeks < 1.5 ? 'in about a week' : `in about ${Math.round(weeks)} weeks`);
  const newSetup = freshSetup
    ? 'Your weights changed a lot recently (different machine or gym?), so this builds only on the sessions since, and expects faster progress while you settle in. ' : '';

  // Back-off sets keep last session's drop-off from the top set (fatigue), they don't all progress at once.
  const targetsFor = (kg: number, reps: number): SetTarget[] => lastWork.map(s => {
    if (s === top) return { kg, reps, sec: null, side: s.side };
    const sameLoad = Math.abs((s.kg ?? 0) - W) < 1e-6;
    const drop = Math.max(0, R - (s.reps ?? R));
    return sameLoad
      ? { kg, reps: Math.max(1, reps - drop), sec: null, side: s.side }
      : { kg: s.kg, reps: s.reps, sec: null, side: s.side };
  });

  // Post-illness mode: lighter than your normal level (not than a plan that may add weight), well short of failure.
  if (opts.illness) {
    const il = ILLNESS[opts.illness];
    const ease = (kg: number) => floorOnStack(kg * il.pct, stack, learned);
    const kg = ease(W);
    // When the machine has no lighter weight, cut reps instead.
    const reps = kg >= W - 1e-6 ? Math.max(1, R - (opts.illness === 'flu' ? 3 : 2)) : R;
    const sets = targetsFor(W, R).map(t => (t.kg != null && t.kg > 0 ? { ...t, kg: ease(t.kg), reps: kg >= W - 1e-6 ? reps : t.reps } : t));
    const fewer = il.dropSets && lastWork.length > 2 ? ` and ${il.dropSets} set fewer` : '';
    return {
      ...common, advice: 'easy', targetRir: il.rir, dropSets: lastWork.length > 2 ? il.dropSets : 0,
      headline: { kg, reps, addKg: kg - W },
      reason: (opts.illness === 'flu'
        ? `Back after being ill: about ${Math.round((1 - il.pct) * 100)}% lighter (${fw(kg)} × ${reps})${fewer}, stopping with ${il.rir}+ reps in reserve. `
        : `Under the weather: about ${Math.round((1 - il.pct) * 100)}% lighter (${fw(kg)} × ${reps}), stopping with ${il.rir} reps in reserve. `) +
        `This session won't count against your progress; your normal targets (${fw(W)} × ${R}) are waiting when you feel well.`,
      sets,
    };
  }

  // Return-from-break ramp: after 3+ weeks away, 2–4 sessions climb from 85–95% back to the pre-break level.
  // Works both for the first session back and for the ones after it (found from the gap in the history).
  const ramp = (() => {
    if (daysOff > 21) return { ref: last, gap: daysOff, done: 0 };
    for (let g = done.length - 1; g > 0; g--) {
      const gap = (done[g].start - done[g - 1].start) / DAY;
      if (gap > 21) return { ref: done[g - 1], gap, done: done.length - g };
      if (done.length - g >= 4) break;
    }
    return null;
  })();
  if (ramp) {
    const { sessions: n, startPct } = rampFor(ramp.gap);
    const refTop = topSet(ramp.ref.ex.sets)!;
    const refE = setE1rm(refTop), rW = refTop.kg ?? 0, rR = refTop.reps ?? 0;
    const sinceBest = ramp.done ? Math.max(...done.slice(-ramp.done).map(topE1rm)) : 0;
    if (ramp.done < n && sinceBest < refE * 0.99) {
      const pct = (i: number) => startPct + ((1 - startPct) * i) / Math.max(1, n - 1);
      const plan = Array.from({ length: n }, (_, i) => ({
        kg: i === n - 1 ? rW : floorOnStack(rW * pct(i), stack, learned),
        reps: i === n - 1 ? rR : Math.max(lo, rR - 1),
      }));
      const t = plan[ramp.done];
      return {
        ...common, advice: 'return',
        milestones: plan.slice(ramp.done + 1).map((p, j) => ({
          kg: p.kg, reps: p.reps, e1rm: oneRepMax(p.kg, p.reps), weeks: ((j + 1) * gapDays) / 7, kind: p.kg !== t.kg ? 'weight' as const : 'reps' as const,
        })),
        headline: { kg: t.kg, reps: t.reps, addKg: t.kg - W },
        reason: `Back after ${Math.round(ramp.gap)} days: session ${ramp.done + 1} of ${n} on the way back to ${fw(rW)} × ${rR}. ` +
          `Ramping up protects joints and lets strength return faster than it was built.`,
        sets: targetsFor(t.kg, t.reps),
      };
    }
  }

  // Take the highest rung your projected strength by the next session already covers (after an off day that
  // means getting back to your recent reps), with two brakes: a weight jump ends the climb for that session
  // (you start the new weight at its entry reps), and no weight jump right after an off day (last session >5%
  // under your recent level, i.e. ~1.5+ reps down; one rep less is normal day-to-day variation).
  const nextSessionWeeks = gapDays / 7;
  const offDay = topE1rm(last) < e0 * 0.95;

  // Readiness check-in: a rough day is not the day to chase progress.
  const ready = opts.readiness;
  if (ready != null && ready <= 1.75) {
    const kg = floorOnStack(W * 0.95, stack, learned);
    return {
      ...common, advice: 'hold',
      headline: { kg, reps: R, addKg: kg - W },
      reason: `Low readiness today (${ready.toFixed(1)}/5): about 5% lighter, ${fw(kg)} × ${R}. Get the work in, then build again next time.`,
      sets: targetsFor(kg, R),
    };
  }
  const lowReady = ready != null && ready <= 2.5;

  let k = -1;
  for (let i = 0; i < milestones.length && !lowReady && milestones[i].weeks <= nextSessionWeeks; i++) {
    if (milestones[i].kind === 'weight' && offDay) break;
    k = i;
    if (milestones[i].kind === 'weight') break;
  }
  if (k >= 0) {
    const t = milestones[k];
    const isWeight = t.kg !== W;
    const upcoming = milestones.slice(k + 1);
    return {
      ...common, milestones: upcoming, advice: isWeight ? 'weight' : 'reps',
      headline: isWeight ? { kg: t.kg, reps: t.reps, addKg: t.kg - W } : { kg: t.kg, reps: t.reps, addReps: t.reps - R },
      reason: newSetup + (k > 0 && !isWeight
        ? `Last time (${fw(W)} × ${R}) was below your recent level; your recent best sessions show ${fw(t.kg)} × ${t.reps} is there.`
        : isWeight
          ? `You've reached the top of your ${lo}–${hi} range and your recent sessions show the strength for more: go up ${fw(t.kg - W)} and aim for ${t.reps} reps.`
          : `Your recent best sessions show enough strength for one more rep at ${fw(W)}.`),
      sets: targetsFor(t.kg, t.reps),
    };
  }
  const next = milestones[0];
  if (offDay && next?.kind === 'weight' && next.weeks <= nextSessionWeeks) {
    // At the top of the range but last time was an off day: confirm the level before adding weight.
    return {
      ...common, advice: 'hold',
      headline: { kg: W, reps: R },
      reason: `Last time was below your recent level. Match ${fw(W)} × ${R} solidly first; if it moves well, go up ${fw(next.kg - W)} next time.`,
      sets: targetsFor(W, R),
    };
  }

  // Plateau: a long streak with no new best in its last 4 sessions compared with the 6 before.
  const recentBest = Math.max(...streak.slice(-4).map(topE1rm));
  const before = streak.slice(0, -4).slice(-6).map(topE1rm);
  if (streak.length >= 8 && before.length && recentBest <= Math.max(...before)) {
    return {
      ...common, advice: 'plateau',
      headline: { kg: W, reps: R },
      reason: `No new best in your last 4 sessions. Match ${fw(W)} × ${R} with clean reps; if it keeps stalling, do one lighter week (about ${fw(floorOnStack(W * 0.9, stack, learned))}) or work in a different rep range for a few weeks.`,
      sets: targetsFor(W, R),
    };
  }

  if (lowReady && next && next.weeks <= nextSessionWeeks) {
    return {
      ...common, advice: 'hold',
      headline: { kg: W, reps: R },
      reason: `You'd normally go for ${fw(next.kg)} × ${next.reps} today, but readiness is low (${ready!.toFixed(1)}/5). Match ${fw(W)} × ${R} and try next time.`,
      sets: targetsFor(W, R),
    };
  }

  return {
    ...common, advice: 'hold',
    headline: { kg: W, reps: R },
    reason: newSetup + `Match ${fw(W)} × ${R}. At your realistic pace (~${pctWk}, slowing over time) the next step, ` +
      `${next ? `${fw(next.kg)} × ${next.reps}` : 'one more rep'}, is due ${next ? when(next.weeks) : 'later'}. Try for it when a set feels easy.`,
    sets: targetsFor(W, R),
  };
}

/** Post-illness mode for exercises without a weight × reps target: fewer reps or shorter time. */
function easeSimple(s: Suggestion, illness: Illness): Suggestion {
  const il = ILLNESS[illness];
  const cut = (v: number | null) => (v == null ? v : Math.max(1, Math.round(v * il.pct)));
  return {
    ...s, advice: 'easy', targetRir: il.rir, dropSets: s.sets.length > 2 ? il.dropSets : 0,
    headline: { ...s.headline, reps: cut(s.headline.reps), sec: s.headline.sec == null ? s.headline.sec : cut(s.headline.sec), addReps: undefined, addSec: undefined },
    reason: `Going easier while ill: about ${Math.round((1 - il.pct) * 100)}% less, well short of failure. This session won't count against your progress.`,
    sets: s.sets.map(t => ({ ...t, reps: cut(t.reps), sec: cut(t.sec) })),
  };
}

function simpleSuggest(done: Session[], type: ExerciseType, lastWork: WSet[], daysOff: number, base: Pick<Suggestion, 'lastDate' | 'sessions' | 'gapDays'>): Suggestion {
  const timed = type === 'duration' || type === 'weight_duration' || type === 'distance_duration' || type === 'floors_duration' || type === 'steps_duration';
  const back = daysOff > 21;
  const common = { ...base, step: 0, e1rm: 0, rate: 0, milestones: [], theory: null };
  // Bodyweight reps and holds also progress slowly: one rep / ~5% time at most every couple of weeks.
  const recent = done.slice(-6);
  const bestOf = (f: (s: WSet) => number) => (s: Session) => Math.max(0, ...working(s.ex.sets).map(f));
  if (timed) {
    const bestSec = Math.max(0, ...lastWork.map(s => s.sec ?? 0));
    const improvedRecently = recent.length >= 2 && bestOf(s => s.sec ?? 0)(recent[recent.length - 1]) > Math.max(...recent.slice(0, -1).map(bestOf(s => s.sec ?? 0)));
    const add = back || improvedRecently ? 0 : Math.max(5, Math.round((bestSec * 0.05) / 5) * 5);
    return {
      ...common, advice: back ? 'return' : add ? 'reps' : 'hold', repRange: [0, 0],
      headline: { kg: null, reps: null, sec: bestSec + add, addSec: add },
      reason: back ? `${Math.round(daysOff)} days off: match your last time before adding more.`
        : add ? `Add about 5% time (${add}s) to your best set.` : 'You just set a new best time: match it before adding more.',
      sets: lastWork.map(s => ({ kg: s.kg, reps: s.reps, sec: s.sec == null ? null : s.sec + add, side: s.side })),
    };
  }
  const repRange = learnRepRange(done);
  const bestReps = Math.max(0, ...lastWork.map(s => s.reps ?? 0));
  const improvedRecently = recent.length >= 2 && bestOf(s => s.reps ?? 0)(recent[recent.length - 1]) > Math.max(...recent.slice(0, -1).map(bestOf(s => s.reps ?? 0)));
  const add = back || improvedRecently ? 0 : 1;
  const assisted = type === 'bodyweight_assisted_reps';
  return {
    ...common, advice: back ? 'return' : add ? 'reps' : 'hold', repRange,
    headline: { kg: lastWork[0]?.kg ?? null, reps: bestReps + add, addReps: add },
    reason: back ? `${Math.round(daysOff)} days off: repeat your last session first.`
      : !add ? `You just set a new best (${bestReps} reps): match it before adding more.`
        : assisted && bestReps >= repRange[1] ? 'Top of your range: use a little less assistance next time.'
          : `Beat your best set by one rep (${bestReps + 1}).`,
    sets: lastWork.map(s => ({ kg: s.kg, reps: (s.reps ?? 0) + add, sec: s.sec, side: s.side })),
  };
}

const trim = (v: number) => String(Math.round(v * 100) / 100);
