import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  backoffTarget, balanceWarnings, copyLast, deloadCheck, effectiveStack, estimateMinutes, evaluateExperiment, imbalance, learnBackoff,
  learnStack, monthlyReport, muscleVolume, parseStack, playbook, readinessScore, sideHistory, swapRatio,
  timeBox, warmupRamp,
} from '../src/lib/training.ts';
import { floorOnStack, nextOnStack, rampFor, setE1rm, suggest } from '../src/lib/overload.ts';
import { buildHistory, oneRepMax, type Session } from '../src/lib/stats.ts';
import { fromLaitFile, parseLaitFile, toLaitFile } from '../src/lib/importer.ts';
import type { Exercise, WExercise, WSet, Workout } from '../src/types.ts';

const DAY = 86400, WEEK = 7 * DAY;
const set = (kg: number, reps: number, extra: Partial<WSet> = {}): WSet => ({ type: 'normal', kg, reps, rpe: null, m: null, sec: null, ...extra });
const sess = (start: number, sets: WSet[], gymId: string | null = null): Session =>
  ({ workoutId: 'w' + start, workoutName: 'W', start, gymId, prs: new Map(), ex: { exId: 'X', notes: '', ss: null, rest: null, sets } });

test('reps in reserve raise the strength estimate', () => {
  assert.equal(setE1rm(set(65, 8)), oneRepMax(65, 8));
  assert.equal(setE1rm(set(65, 8, { rir: 2 })), oneRepMax(65, 10));
  assert.equal(setE1rm(set(65, 8, { rir: 7 })), oneRepMax(65, 11)); // "3+" counts as 3
});

test('weight stacks: parse, learn, snap', () => {
  assert.deepEqual(parseStack('5, 10;12.5  20-30/5'), [5, 10, 12.5, 20, 25, 30]);
  const ss = [sess(1, [set(62.5, 8), set(60, 6)]), sess(2, [set(66.3, 7)], 'g1'), sess(3, [set(66.3, 6)], 'g1')];
  assert.deepEqual(learnStack(ss), [60, 62.5, 66.3]);
  assert.deepEqual(learnStack(ss, 'g1'), [66.3]);
  assert.equal(effectiveStack([], [1, 2]), undefined); // too little variety to trust
  assert.deepEqual(effectiveStack([20, 10], []), [10, 20]);
  const stack = [59, 66.3, 73.6, 80.9];
  assert.equal(nextOnStack(66.3, stack, 2.5), 73.6);
  assert.equal(nextOnStack(81, stack, 2.5), 83.5); // above the stack: fall back to the step
  assert.equal(floorOnStack(70, stack, 2.5), 66.3);
  assert.equal(floorOnStack(65 * (62.5 / 65), undefined, 1.25), 62.5); // float noise must not drop a step
});

test('weight steps follow the real stack (and a big plate jump is not rushed)', () => {
  const tops: [number, number][] = [[66.3, 6], [66.3, 7], [66.3, 8], [66.3, 7], [66.3, 9], [66.3, 8]];
  const ss = tops.map(([kg, r], i) => sess((400 - (5 - i) * 3) * DAY, [set(kg, r), set(kg, r - 1)]));
  const s = suggest(ss, 'weight_reps', 'machine', 401 * DAY, { stack: [59, 66.3, 73.6, 80.9] })!;
  // 66.3 -> 73.6 is an 11% jump: realistic advice is to keep building reps first.
  assert.equal(s.advice, 'hold');
  assert.equal(s.milestones[0].kg, 73.6);
  assert.equal(s.step, 73.6 - 66.3);
  // With a fine-grained stack the same history is ready to move up.
  const fine = suggest(ss, 'weight_reps', 'machine', 401 * DAY, { stack: [64.3, 66.3, 68.3, 70.3] })!;
  assert.equal(fine.advice, 'weight');
  assert.equal(fine.headline.kg, 68.3);
});

test('return ramp: several sessions from ~90% back to the old level', () => {
  assert.deepEqual(rampFor(25), { sessions: 2, startPct: 0.95 });
  assert.deepEqual(rampFor(40), { sessions: 3, startPct: 0.9 });
  const before = [0, 3, 6, 9].map(d => sess((300 + d) * DAY, [set(100, 8), set(100, 7)]));
  const s1 = suggest(before, 'weight_reps', 'barbell', 349 * DAY)!; // 40 days off
  assert.equal(s1.advice, 'return');
  assert.match(s1.reason, /session 1 of 3/);
  assert.equal(s1.headline.kg, 90);
  assert.equal(s1.milestones.at(-1)!.kg, 100);
  // After the first session back at 90 kg, the next one ramps to 95.
  const s2 = suggest([...before, sess(349 * DAY, [set(90, 7), set(90, 6)])], 'weight_reps', 'barbell', 352 * DAY)!;
  assert.match(s2.reason, /session 2 of 3/);
  assert.equal(s2.headline.kg, 95);
});

test('readiness: low holds, very low lightens', () => {
  const tops: [number, number][] = [[60, 7], [62.5, 6], [62.5, 7], [65, 6], [65, 8], [64, 7], [65, 6]];
  const ss = tops.map(([kg, r], i) => sess((400 - (6 - i) * 3) * DAY, [set(kg, r), set(kg, r - 1)]));
  assert.equal(suggest(ss, 'weight_reps', 'machine', 401 * DAY)!.advice, 'reps');
  assert.equal(suggest(ss, 'weight_reps', 'machine', 401 * DAY, { readiness: 2.3 })!.advice, 'hold');
  const vl = suggest(ss, 'weight_reps', 'machine', 401 * DAY, { readiness: 1.3 })!;
  assert.ok(vl.headline.kg! < 65);
  assert.equal(readinessScore({ sleep: 2, energy: 3, soreness: 4 }), 3);
});

test('back-off target follows the top set you actually did, and your usual pattern', () => {
  // Same-weight back-offs, one rep down.
  const same = [sess(1, [set(65, 8), set(65, 6)]), sess(2, [set(65, 7), set(65, 6)]), sess(3, [set(65, 8), set(65, 7)])];
  assert.equal(learnBackoff(same).ratio, 1);
  assert.deepEqual(backoffTarget(set(67.5, 7), learnBackoff(same)), { kg: 67.5, reps: 6 });
  // Your T Bar Row style: drop ~2.5 kg and ~2 reps.
  const tbar = [sess(1, [set(65, 8), set(62.5, 6)]), sess(2, [set(65, 7), set(62.5, 6)]), sess(3, [set(65, 8), set(62.5, 6)])];
  const p = learnBackoff(tbar);
  assert.ok(p.ratio < 0.97 && p.fatigue < 0.95);
  assert.deepEqual(backoffTarget(set(66.25, 8), p, kg => Math.floor(kg / 1.25 + 1e-6) * 1.25), { kg: 62.5, reps: 6 });
  // Weight and reps stay linked: a mixed history (lower weight + same reps, or same weight + fewer reps)
  // must not produce "lower weight AND same reps as the top set".
  const mixed = [sess(1, [set(68.75, 6), set(67.5, 6)]), sess(2, [set(68.75, 8), set(68.75, 6)]), sess(3, [set(65, 7), set(61.25, 7)]), sess(4, [set(65, 8), set(62.5, 6)])];
  const m = backoffTarget(set(65, 8), learnBackoff(mixed), kg => Math.floor(kg / 1.25 + 1e-6) * 1.25);
  assert.ok(m.kg! < 65 && m.reps! < 8, JSON.stringify(m));
});

test('warm-up ramps scale with load and snap to the stack', () => {
  assert.deepEqual(warmupRamp(100, undefined, 2.5).map(w => w.kg), [40, 60, 75, 85]);
  assert.deepEqual(warmupRamp(65, undefined, 2.5).map(w => w.kg), [32.5, 45, 55]);
  assert.deepEqual(warmupRamp(66.3, [29.5, 36.8, 44.1, 51.4, 58.7, 66.3], 2.5).map(w => w.kg), [29.5, 44.1, 51.4]);
  assert.equal(warmupRamp(10, undefined, 1).length, 1);
});

const ex = (id: string, muscle: string, other: string[] = []): Exercise => ({ id, title: id, muscle, other, type: 'weight_reps', equip: 'machine', custom: false });
const wk = (start: number, items: [string, number][]): Workout => ({
  id: 'w' + start + items[0][0], name: 'W', notes: '', start, end: start + 3600, routineId: null, source: 'lait',
  exercises: items.map(([exId, n]) => ({ exId, notes: '', ss: null, rest: null, sets: Array.from({ length: n }, () => set(50, 8)) })),
});

test('muscle volume and balance warnings', () => {
  const exs = new Map([ex('bench', 'chest', ['triceps']), ex('row', 'upper_back', ['biceps']), ex('legext', 'quadriceps'), ex('curl', 'hamstrings')].map(e => [e.id, e]));
  const now = 100 * WEEK;
  const ws: Workout[] = [];
  for (let w = 0; w < 4; w++) ws.push(wk(now - w * WEEK - DAY, [['bench', 12], ['row', 4], ['legext', 10], ['curl', 3]]));
  const vol = muscleVolume(ws, exs, now, [10, 20]);
  assert.equal(vol.find(v => v.muscle === 'chest')!.perWeek, 12);
  assert.equal(vol.find(v => v.muscle === 'chest')!.status, 'ok');
  assert.equal(vol.find(v => v.muscle === 'upper_back')!.status, 'low');
  const warn = balanceWarnings(vol);
  assert.ok(warn.some(w => /Pulling volume/.test(w)));
  assert.ok(warn.some(w => /Hamstrings/.test(w)));
});

test('left/right imbalance', () => {
  const ss = [1, 2, 3].map(i => sess(i * DAY, [set(20, 8, { side: 'L' }), set(20, 6, { side: 'R' })]));
  const pts = sideHistory(ss);
  assert.equal(pts.length, 3);
  const imb = imbalance(pts)!;
  assert.equal(imb.weak, 'R');
  assert.ok(imb.reps >= 1);
  assert.equal(imbalance(sideHistory([1, 2].map(i => sess(i, [set(20, 8, { side: 'L' }), set(20, 8, { side: 'R' })])))), null);
});

test('time-box trims back-off sets and late exercises, keeps the first lift', () => {
  const mk = (exId: string, n: number): WExercise => ({ exId, notes: '', ss: null, rest: 120, sets: Array.from({ length: n }, () => set(50, 8)) });
  const routine = [mk('a', 3), mk('b', 3), mk('c', 3), mk('d', 3), mk('e', 3)];
  const full = estimateMinutes(routine, 120);
  assert.ok(full > 30);
  const t = timeBox(routine, 20, 120);
  assert.ok(t.minutes <= 20);
  assert.equal(t.exercises[0].exId, 'a');
  assert.ok(t.exercises[0].sets.length >= 1);
  assert.equal(timeBox(routine, 999, 120).exercises.reduce((a, e) => a + e.sets.length, 0), 15);
});

test('swap ratio and copy-last', () => {
  const now = 400 * DAY;
  const a = [sess(now - DAY, [set(100, 8)])], b = [sess(now - 2 * DAY, [set(80, 8)])];
  assert.equal(swapRatio(a, b, now), 0.8);
  assert.equal(swapRatio(a, [], now), null);
  const cur: WExercise = { exId: 'X', notes: '', ss: null, rest: null, sets: [{ ...set(60, 8), done: true }, set(0, 0), set(0, 0)] };
  const out = copyLast(cur, [set(65, 8), set(65, 7), set(65, 6)]);
  assert.deepEqual(out.sets.map(s => [s.kg, s.reps, !!s.done]), [[60, 8, true], [65, 7, false], [65, 6, false]]);
});

test('playbook prefers what worked before; experiments evaluate after 3 weeks', () => {
  const opts = playbook(ex('X', 'chest'), 100, 6, [ex('Y', 'chest')], [
    { id: '1', exId: 'Z', kind: 'tempo', altExId: null, started: 0, baseline: 100, result: 0.05, ended: 1 },
  ], kg => `${kg} kg`);
  assert.equal(opts[0].kind, 'tempo');
  assert.equal(opts.length, 3);
  const exp = { id: 'e', exId: 'X', kind: 'rep_range' as const, altExId: null, started: 100 * DAY, baseline: oneRepMax(100, 6), result: null, ended: null };
  assert.equal(evaluateExperiment(exp, [sess(130 * DAY, [set(100, 8)])], 110 * DAY), null); // too early
  const r = evaluateExperiment(exp, [sess(122 * DAY, [set(100, 8)])], 125 * DAY)!;
  assert.ok(r > 0.05);
});

test('backup v2 round-trips effort, gym, readiness and the new tables; v1 files still import', () => {
  const w: Workout = {
    id: 'w', name: 'W', notes: '', start: 10, end: 20, routineId: null, source: 'lait', gymId: 'g1', readiness: { sleep: 4, energy: 3, soreness: 5 },
    exercises: [{ exId: 'X', notes: '', ss: null, rest: null, uni: true, sets: [set(20, 8, { side: 'L', rir: 2, at: 11 }), set(20, 7, { side: 'R', at: 12 })] }],
  };
  const extras = {
    gyms: [{ id: 'g1', name: 'Home gym', order: 0 }],
    machines: [{ id: 'g1|X', gymId: 'g1', exId: 'X', settings: 'seat 4', weights: [10, 20, 30] }],
    body: [{ id: 'b', date: 5, weightKg: 80, bodyFat: null, waist: 82, chest: null, arm: null, thigh: null, hips: null, notes: '' }],
    experiments: [{ id: 'e', exId: 'X', kind: 'tempo' as const, altExId: null, started: 1, baseline: 100, result: 0.02, ended: 2 }],
  };
  const back = fromLaitFile(parseLaitFile(JSON.stringify(toLaitFile([], [w], [], {}, extras))));
  assert.deepEqual(back.workouts[0], w);
  assert.deepEqual(back.gyms, extras.gyms);
  assert.deepEqual(back.machines, extras.machines);
  assert.deepEqual(back.body, extras.body);
  assert.deepEqual(back.experiments, extras.experiments);
  // Minimal v1 file (as produced from Hevy) imports with empty extras.
  const v1 = fromLaitFile(parseLaitFile(JSON.stringify({ format: 'lait-import-v1', source: 'hevy', exportedAt: '', templates: {}, routines: [], workouts: [] })));
  assert.deepEqual([v1.gyms, v1.body], [[], []]);
});
