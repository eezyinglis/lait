import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest } from '../src/lib/overload.ts';
import type { Session } from '../src/lib/stats.ts';
import type { WSet } from '../src/types.ts';

const DAY = 86400;
const set = (kg: number, reps: number): WSet => ({ type: 'normal', kg, reps, rpe: null, m: null, sec: null });
const sessions = (tops: [number, number][], gap = 3): Session[] => tops.map(([kg, reps], i) => ({
  workoutId: 'w' + i, workoutName: 'W', start: (400 - (tops.length - 1 - i) * gap) * DAY, gymId: null, prs: new Map(),
  ex: { exId: 'X', notes: '', ss: null, rest: null, sets: [set(kg, reps), set(kg, reps - 1), set(kg, reps - 2)] },
}));
const NOW = 401 * DAY;
const steady = sessions(Array.from({ length: 10 }, () => [60, 8] as [number, number]));

test('mild illness: ~10% lighter, 3 RIR, same number of sets', () => {
  const s = suggest(steady, 'weight_reps', 'machine', NOW, { illness: 'mild' })!;
  assert.equal(s.advice, 'easy');
  assert.equal(s.headline.kg, 52.5); // 60 × 0.9 = 54, rounded down to the 2.5 kg step
  assert.equal(s.headline.reps, 8);
  assert.equal(s.targetRir, 3);
  assert.equal(s.dropSets, 0);
  assert.ok(s.sets.every(t => (t.kg ?? 0) <= 54));
});

test('after flu: ~20% lighter and one set fewer', () => {
  const s = suggest(steady, 'weight_reps', 'machine', NOW, { illness: 'flu' })!;
  assert.equal(s.headline.kg, 47.5); // 60 × 0.8 = 48 → 47.5
  assert.equal(s.dropSets, 1);
});

test('no lighter weight on the stack: cut reps instead', () => {
  const s = suggest(steady, 'weight_reps', 'machine', NOW, { illness: 'mild', stack: [60, 70] })!;
  assert.equal(s.headline.kg, 60);
  assert.equal(s.headline.reps, 6);
});

test('sessions done while ill do not drag the next normal suggestion down', () => {
  const ill = sessions([...Array.from({ length: 10 }, () => [60, 8] as [number, number]), [45, 6]]);
  ill[ill.length - 1].illness = 'flu';
  const s = suggest(ill, 'weight_reps', 'machine', NOW)!;
  assert.ok((s.headline.kg ?? 0) >= 60, `suggested ${s.headline.kg}`);
});
