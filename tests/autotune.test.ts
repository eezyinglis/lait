import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoTune } from '../src/lib/training.ts';
import type { Exercise, Workout, WSet } from '../src/types.ts';

const DAY = 86400;
const set = (at: number): WSet => ({ type: 'normal', kg: 50, reps: 8, rpe: null, m: null, sec: null, at });
const exs = new Map<string, Exercise>([['a', { id: 'a', title: 'A', muscle: 'chest', other: [], type: 'weight_reps', equip: 'machine', custom: false }]]);

test('auto-tune learns weekly target, a low-volume band and rest from set timestamps', () => {
  const now = 1000 * DAY;
  const ws: Workout[] = [];
  // 12 weeks, 4 workouts a week, 2 sets each with 2:35 between set completions.
  for (let wk = 0; wk < 12; wk++) for (let d = 0; d < 4; d++) {
    const start = now - wk * 7 * DAY - d * DAY - 3600;
    ws.push({ id: `${wk}-${d}`, name: 'W', notes: '', start, end: start + 3600, routineId: null, source: 'lait',
      exercises: [{ exId: 'a', notes: '', ss: null, rest: null, sets: [set(start + 100), set(start + 255)] }] });
  }
  const t = autoTune(ws, exs, now);
  assert.equal(t.weeklyTarget, 4);
  // 8 sets/week of chest -> a low-volume band that contains it, not the generic 10–20.
  assert.ok(t.volumeBand[0] <= 8 && t.volumeBand[1] >= 8 && t.volumeBand[0] < 10, JSON.stringify(t.volumeBand));
  assert.equal(t.defaultRest, 120); // 155 s between sets - ~35 s set time
});

test('weekly target follows your normal rhythm, not occasional light weeks', () => {
  const now = 1000 * DAY;
  const ws: Workout[] = [];
  const perWeek = [4, 4, 4, 1, 1, 2, 1, 4, 4]; // a light patch in between
  perWeek.forEach((n, wk) => { for (let d = 0; d < n; d++) { const start = now - wk * 7 * DAY - d * DAY - 3600; ws.push({ id: `${wk}-${d}`, name: 'W', notes: '', start, end: start + 60, routineId: null, source: 'lait', exercises: [] }); } });
  assert.equal(autoTune(ws, exs, now).weeklyTarget, 4);
});

test('auto-tune falls back sensibly with no history', () => {
  assert.deepEqual(autoTune([], exs, 1000 * DAY), { weeklyTarget: 3, volumeBand: [10, 20], defaultRest: null });
});

test('nearest saved gym within 400 m', async () => {
  const { distanceM, nearestGym } = await import('../src/lib/training.ts');
  // ~111 m per 0.001° latitude.
  assert.ok(Math.abs(distanceM(50, 14, 50.001, 14) - 111) < 2);
  const gyms = [{ id: 'far', lat: 50.01, lon: 14 }, { id: 'near', lat: 50.002, lon: 14 }, { id: 'nowhere' }];
  assert.equal(nearestGym(gyms, 50, 14)?.id, 'near');
  assert.equal(nearestGym(gyms, 51, 14), null);
});
