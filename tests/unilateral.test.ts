import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRest, nextSets, previousFor, setLabels, toggleUnilateral } from '../src/lib/unilateral.ts';
import { fromLaitFile, parseLaitFile, toLaitFile } from '../src/lib/importer.ts';
import type { WExercise, WSet } from '../src/types.ts';

const set = (kg: number, reps: number, type: WSet['type'] = 'normal'): WSet => ({ type, kg, reps, rpe: null, m: null, sec: null });
const ex = (sets: WSet[], rest: number | null = 120): WExercise => ({ exId: 'X', notes: '', ss: null, rest, sets });

test('toggle splits each set into an L/R pair and back', () => {
  const a = ex([set(20, 10, 'warmup'), set(30, 8), set(30, 6)]);
  const u = toggleUnilateral(a);
  assert.equal(u.uni, true);
  assert.equal(u.sets.length, 6);
  assert.deepEqual(u.sets.map(s => s.side), ['L', 'R', 'L', 'R', 'L', 'R']);
  assert.deepEqual(u.sets.map(s => s.kg), [20, 20, 30, 30, 30, 30]);
  const back = toggleUnilateral(u);
  assert.equal(back.uni, false);
  assert.deepEqual(back.sets, a.sets);
});

test('merging keeps the left values', () => {
  const u = toggleUnilateral(ex([set(30, 8)]));
  u.sets[1] = { ...u.sets[1], reps: 7 };
  assert.deepEqual(toggleUnilateral(u).sets, [set(30, 8)]);
});

test('rest is halved for unilateral exercises', () => {
  assert.equal(effectiveRest({ rest: 150, uni: true }, 120), 75);
  assert.equal(effectiveRest({ rest: null, uni: true }, 120), 60);
  assert.equal(effectiveRest({ rest: 150, uni: false }, 120), 150);
  assert.equal(effectiveRest({ rest: null }, 90), 90);
});

test('labels number pairs together', () => {
  const u = toggleUnilateral(ex([set(20, 10, 'warmup'), set(30, 8), set(30, 6)]));
  assert.deepEqual(setLabels(u.sets), ['WL', 'WR', '1L', '1R', '2L', '2R']);
  assert.deepEqual(setLabels([set(1, 1), set(1, 1, 'dropset'), set(1, 1)]), ['1', 'D', '3']);
});

test('add set appends a whole pair', () => {
  const u = toggleUnilateral(ex([set(30, 8)]));
  const add = nextSets(u, () => set(0, 0));
  assert.deepEqual(add.map(s => [s.side, s.kg, s.done]), [['L', 30, false], ['R', 30, false]]);
  assert.equal(nextSets(ex([set(30, 8)]), () => set(0, 0)).length, 1);
});

test('previous column maps between bilateral and unilateral sessions', () => {
  const prevBi = [set(30, 8), set(30, 6)];
  assert.equal(previousFor(prevBi, 3, true)?.reps, 6); // row 2R <- previous set 2
  const prevUni = toggleUnilateral(ex(prevBi)).sets;
  assert.equal(previousFor(prevUni, 1, false)?.reps, 6); // row 2 <- previous pair 2 (left)
  assert.equal(previousFor(prevUni, 3, true)?.side, 'R');
});

test('backups keep unilateral flag and sides', () => {
  const u = { ...toggleUnilateral(ex([set(30, 8)])), sets: toggleUnilateral(ex([set(30, 8)])).sets.map(s => ({ ...s, at: null })) };
  const w = { id: 'w', name: 'W', notes: '', start: 1, end: 2, routineId: null, exercises: [u], source: 'lait' as const };
  const back = fromLaitFile(parseLaitFile(JSON.stringify(toLaitFile([], [w], [], {})))).workouts[0].exercises[0];
  assert.equal(back.uni, true);
  assert.deepEqual(back.sets.map(s => s.side), ['L', 'R']);
});
