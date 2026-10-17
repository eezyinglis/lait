import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, effortWeight, muscleRecovery, routineReadiness, setDoses } from '../src/lib/recovery.ts';
import { nextRoutine } from '../src/lib/schedule.ts';
import type { Exercise, Routine, Workout, WSet } from '../src/types.ts';

const H = 3600, DAY = 86400;
const ex = (id: string, muscle: string, other: string[] = []): Exercise => ({ id, title: id, muscle, other, type: 'weight_reps', equip: 'machine', custom: false });
const exs = new Map([ex('bench', 'chest', ['triceps']), ex('curl', 'biceps'), ex('legext', 'quadriceps')].map(e => [e.id, e]));
const s = (rir?: number | null, extra: Partial<WSet> = {}): WSet => ({ type: 'normal', kg: 50, reps: 8, rpe: null, m: null, sec: null, ...(rir !== undefined ? { rir } : {}), ...extra });
const wk = (end: number, items: [string, WSet[]][], routineId: string | null = null): Workout => ({
  id: 'w' + end + (routineId ?? ''), name: 'W', notes: '', start: end - H, end, routineId, source: 'lait',
  exercises: items.map(([exId, sets]) => ({ exId, notes: '', ss: null, rest: null, sets })),
});

test('closer to failure = more fatigue; warm-ups none; L/R pair counts once; secondary ½', () => {
  assert.equal(effortWeight(s(0)), 1);
  assert.ok(effortWeight(s(3)) < effortWeight(s(1)));
  assert.equal(effortWeight(s(null, { type: 'warmup' })), 0);
  const d = setDoses({ sets: [s(0), s(0), s(null, { type: 'warmup' })] }, exs.get('bench')!);
  assert.equal(d.get('chest'), 2);
  assert.equal(d.get('triceps'), 1);
  const uni = setDoses({ sets: [s(0, { side: 'L' }), s(0, { side: 'R' })] }, exs.get('curl')!);
  assert.equal(uni.get('biceps'), 1);
});

test('recovery rises over time, failure sets recover slower, untrained muscles are absent', () => {
  const now = 100 * DAY;
  const hard = [wk(now - 2 * H, [['bench', [s(0), s(0), s(0), s(0)]]])];
  const easy = [wk(now - 2 * H, [['bench', [s(3), s(3), s(3), s(3)]]])];
  const at = (ws: Workout[], h: number) => muscleRecovery(ws, exs, now + h * H).find(r => r.muscle === 'chest')!.pct;
  assert.ok(at(hard, 0) < 20);
  assert.ok(at(hard, 24) > at(hard, 0) && at(hard, 72) >= 95);
  assert.ok(at(easy, 12) > at(hard, 12));
  assert.equal(muscleRecovery(hard, exs, now).find(r => r.muscle === 'quadriceps'), undefined);
  // Personal scale < 1 = faster recovery.
  assert.ok(muscleRecovery(hard, exs, now + 24 * H, 0.8)[0].pct > muscleRecovery(hard, exs, now + 24 * H, 1)[0].pct);
});

test('routine readiness reports the least-recovered target muscle', () => {
  const now = 100 * DAY;
  const rec = muscleRecovery([wk(now - H, [['bench', [s(0), s(0), s(0), s(0)]]])], exs, now);
  const r = routineReadiness([{ exId: 'bench' }, { exId: 'legext' }], rec, exs);
  assert.equal(r.worst?.muscle, 'chest');
  assert.equal(routineReadiness([{ exId: 'legext' }], rec, exs).recovering.length, 0);
});

test('calibration: a measured drop when training too soon lengthens recovery; no data keeps research', () => {
  assert.equal(calibrate([], exs).scale, 1);
  // Bench every ~42 h (weaker: 7 reps) or every ~4 days (rested: 8 reps), many times.
  const ws: Workout[] = [];
  let t = 10 * DAY;
  for (let i = 0; i < 220; i++) {
    const soon = i % 2 === 1;
    t += soon ? 42 * H : 100 * H;
    ws.push(wk(t, [['bench', [s(0, { reps: soon ? 6 : 8 })]]]));
  }
  const c = calibrate(ws, exs);
  assert.ok(c.samples > 100);
  assert.ok(c.scale > 1, `scale ${c.scale}`);
});

const r = (id: string): Routine => ({ id, title: id, notes: '', order: 0, updated: 0, exercises: [{ exId: 'bench', notes: '', ss: null, rest: null, sets: [s()] }] });

test('next routine follows your rotation, else the least recently done', () => {
  const now = 100 * DAY;
  const rs = [r('Ant'), r('Post'), r('Legs')];
  const seq = ['Ant', 'Post', 'Ant', 'Post', 'Ant', 'Post', 'Ant'].map((id, i) => wk(now - (7 - i) * 2 * DAY, [['bench', [s()]]], id));
  assert.equal(nextRoutine(seq, rs, now)!.routine.id, 'Post');
  assert.equal(nextRoutine([...seq, wk(now - DAY, [['bench', [s()]]], 'Post')], rs, now)!.routine.id, 'Ant');
  // No history: first routine.
  assert.equal(nextRoutine([], rs, now)!.reason, 'first');
  // Only one workout: least recently done of the routines used recently.
  const one = nextRoutine([wk(now - DAY, [['bench', [s()]]], 'Ant')], rs, now)!;
  assert.equal(one.routine.id, 'Ant');
});
