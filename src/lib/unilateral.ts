// Unilateral (one side at a time) exercises: every set is a Left + Right pair and rest is halved,
// since each side rests while the other one works.
import type { WExercise, WSet } from '../types';

/** Splits every set into an L/R pair (same values), or merges pairs back into single sets. */
export function toggleUnilateral(ex: WExercise): WExercise {
  if (!ex.uni) {
    const sets = ex.sets.flatMap(s => [{ ...s, side: 'L' as const }, { ...s, side: 'R' as const }]);
    return { ...ex, uni: true, sets };
  }
  const sets: WSet[] = [];
  ex.sets.forEach((s, i) => {
    // Drop the right half of each pair; the left set (with its values) becomes the single set.
    if (s.side === 'R' && ex.sets[i - 1]?.side === 'L') return;
    const { side: _side, ...rest } = s;
    sets.push(rest);
  });
  return { ...ex, uni: false, sets };
}

/** The set(s) "Add set" appends: a copy of the last set, or of the last L/R pair for unilateral exercises. */
export function nextSets(ex: WExercise, blank: () => WSet): WSet[] {
  const fresh = (s: WSet): WSet => ({ ...s, type: s.type === 'warmup' ? 'normal' : s.type, done: false, at: null });
  const last = ex.sets[ex.sets.length - 1];
  if (!ex.uni) return [last ? fresh(last) : blank()];
  const l = [...ex.sets].reverse().find(s => s.side === 'L') ?? last;
  const r = [...ex.sets].reverse().find(s => s.side === 'R') ?? l;
  return [{ ...(l ? fresh(l) : blank()), side: 'L' }, { ...(r ? fresh(r) : blank()), side: 'R' }];
}

/** Rest after a set: the exercise's own rest (or the default), halved when unilateral. */
export function effectiveRest(ex: Pick<WExercise, 'rest' | 'uni'>, defaultRest: number): number {
  const base = ex.rest ?? defaultRest;
  return ex.uni ? Math.round(base / 2) : base;
}

/**
 * Badge text for each set: 1, 2… for normal sets, W/D/F for types, plus L/R for unilateral sides.
 * A left/right pair shares one set number.
 */
export function setLabels(sets: WSet[]): string[] {
  let n = 0;
  return sets.map((s, i) => {
    const pairedRight = s.side === 'R' && sets[i - 1]?.side === 'L';
    if (s.type !== 'warmup' && !pairedRight) n++;
    const base = s.type === 'warmup' ? 'W' : s.type === 'dropset' ? 'D' : s.type === 'failure' ? 'F' : String(n);
    return s.side ? base + s.side : base;
  });
}

/**
 * The "previous" set to show beside row `i`. When the last session was logged bilaterally but this one is
 * unilateral, both sides of pair k map to previous set k (and vice versa).
 */
export function previousFor(prev: WSet[], i: number, uni: boolean): WSet | undefined {
  const prevUni = prev.some(s => s.side);
  if (uni === prevUni) return prev[i];
  return uni ? prev[Math.floor(i / 2)] : prev[i * 2];
}
