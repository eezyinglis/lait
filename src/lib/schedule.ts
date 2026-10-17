// Which routine is next: learned from the order you actually do your routines in.
// Pure module, unit-tested under node.
import type { Routine, Workout } from '../types';

export interface NextUp { routine: Routine; reason: 'rotation' | 'least-recent' | 'first'; lastDone: number | null }

/**
 * Looks at the last 60 workouts that used one of your routines. The routine that most often followed the
 * last one you did is next (e.g. Ant → Post → Ant…). With no clear pattern, the routine you've done least
 * recently comes next. Routines you haven't touched in 60 days only come up if nothing else exists.
 */
export function nextRoutine(workouts: Workout[], routines: Routine[], nowSec: number): NextUp | null {
  const usable = routines.filter(r => r.exercises.length);
  if (!usable.length) return null;
  const ids = new Set(usable.map(r => r.id));
  const seq = workouts.filter(w => w.routineId && ids.has(w.routineId)).sort((a, b) => a.start - b.start).slice(-60);
  const lastDone = (id: string) => { const w = [...seq].reverse().find(x => x.routineId === id); return w ? w.start : null; };
  const byId = new Map(usable.map(r => [r.id, r]));

  if (seq.length >= 2) {
    const last = seq[seq.length - 1].routineId!;
    const counts = new Map<string, number>();
    for (let i = 1; i < seq.length; i++) {
      if (seq[i - 1].routineId !== last || seq[i].routineId === last) continue;
      counts.set(seq[i].routineId!, (counts.get(seq[i].routineId!) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || (lastDone(a[0]) ?? 0) - (lastDone(b[0]) ?? 0))[0];
    if (best && byId.has(best[0])) return { routine: byId.get(best[0])!, reason: 'rotation', lastDone: lastDone(best[0]) };
  }
  // Least recently done among routines used in the last 60 days, else the first in your list.
  const active = usable.filter(r => (lastDone(r.id) ?? 0) >= nowSec - 60 * 86400);
  const pool = active.length ? active : [];
  if (pool.length) {
    const r = [...pool].sort((a, b) => (lastDone(a.id) ?? 0) - (lastDone(b.id) ?? 0))[0];
    return { routine: r, reason: 'least-recent', lastDone: lastDone(r.id) };
  }
  return { routine: usable[0], reason: 'first', lastDone: lastDone(usable[0].id) };
}
