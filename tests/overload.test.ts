import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_RATE, kgAt, ladder, learnRepRange, learnStep, personalRate, project, repsAt, suggest, weeksTo } from '../src/lib/overload.ts';
import { buildHistory, oneRepMax, type Session } from '../src/lib/stats.ts';
import { fromLaitFile, parseLaitFile } from '../src/lib/importer.ts';
import type { WSet } from '../src/types.ts';

const DAY = 86400;
const set = (kg: number, reps: number, type: WSet['type'] = 'normal'): WSet => ({ type, kg, reps, rpe: null, m: null, sec: null });
/** Sessions every `gap` days ending at day 400, from [kg, reps] top sets (plus a back-off set 1 rep lower). */
const sessions = (tops: [number, number][], gap = 3): Session[] => tops.map(([kg, reps], i) => ({
  workoutId: 'w' + i, workoutName: 'W', start: (400 - (tops.length - 1 - i) * gap) * DAY, prs: new Map(),
  ex: { exId: 'X', notes: '', ss: null, rest: null, sets: [set(kg * 0.5, 10, 'warmup'), set(kg, reps), set(kg, reps - 1)] },
}));
const NOW = 401 * DAY;

test('1RM table inversion', () => {
  assert.equal(repsAt(100, 81), 8); // 81 / 0.81 = 100
  assert.equal(repsAt(oneRepMax(65, 8), 65), 8);
  assert.equal(repsAt(100, 101), 0);
  assert.equal(Math.round(kgAt(oneRepMax(65, 8), 8) * 100) / 100, 65);
});

test('projection has diminishing returns and inverts exactly', () => {
  const r = DEFAULT_RATE;
  const gain = (a: number, b: number) => project(100, r, b) - project(100, r, a);
  // Each successive 12-week block gains less than the one before: a slowing curve, not a line.
  assert.ok(gain(0, 12) > gain(12, 24) && gain(12, 24) > gain(24, 36));
  // Early rate matches r (~0.26%/week).
  assert.ok(Math.abs(gain(0, 1) - 100 * r) < 0.01);
  // A year at the median rate is roughly +6%, under half of the +13.5% a straight line would give.
  const year = project(100, r, 52) / 100 - 1;
  assert.ok(year > 0.05 && year < 0.08, `year ${year}`);
  // Visible bend within the 16-week chart window: ~70% of linear.
  const ratio = (project(100, r, 16) - 100) / (100 * r * 16);
  assert.ok(ratio > 0.65 && ratio < 0.75, `16-week ratio ${ratio}`);
  assert.ok(Math.abs(weeksTo(100, r, project(100, r, 20)) - 20) < 1e-6);
  assert.equal(weeksTo(100, r, 99), 0);
});

test('ladder: reps first, then weight; each rung takes longer than the last', () => {
  const m = ladder(65, 6, [6, 8], 2.5, oneRepMax(65, 6), DEFAULT_RATE, 5);
  // After 65x8, +2.5 kg drops to the reps the 1RM table allows (6), then climbs again.
  assert.deepEqual(m.map(x => [x.kg, x.reps, x.kind]), [[65, 7, 'reps'], [65, 8, 'reps'], [67.5, 6, 'weight'], [67.5, 7, 'reps'], [67.5, 8, 'reps']]);
  const gaps = m.map((x, i) => x.weeks - (i ? m[i - 1].weeks : 0));
  assert.ok(m[0].weeks > 4, `first rep should take weeks at 0.26%/wk, got ${m[0].weeks}`);
  assert.ok(gaps[1] > gaps[0], 'second rep takes longer than the first');
});

test('learns the usual weight jump and rep band', () => {
  const s = sessions([[60, 6], [60, 7], [60, 8], [62.5, 6], [62.5, 7], [62.5, 8], [65, 6], [65, 7]]);
  assert.equal(learnStep(s, 'machine'), 2.5);
  assert.deepEqual(learnRepRange(s), [6, 8]);
  assert.equal(learnStep(sessions([[50, 8]]), 'dumbbell'), 2);
});

test('experienced and just set a best -> match it, next rep is weeks away', () => {
  // 30 weekly sessions, +2.5 kg every 10; at 65 kg it took 9 sessions of 6 reps to finally get 7 (last session).
  const tops: [number, number][] = Array.from({ length: 30 }, (_, i) => [60 + Math.floor(i / 10) * 2.5, i === 29 ? 7 : 6] as [number, number]);
  const s = suggest(sessions(tops, 7), 'weight_reps', 'machine', NOW)!;
  assert.equal(s.advice, 'hold');
  assert.ok(s.rate <= 0.005);
  assert.ok(s.milestones[0].weeks > 1);
  assert.match(s.reason, /due in about \d+ weeks/);
});

test('a recent better session means the next rung is already within reach', () => {
  // Did 65x8 two sessions ago, then 65x6 (bad day): capability already covers 65x7.
  const s = suggest(sessions([[60, 7], [62.5, 6], [62.5, 7], [65, 6], [65, 8], [64, 7], [65, 6]]), 'weight_reps', 'machine', NOW)!;
  assert.equal(s.advice, 'reps');
  assert.deepEqual([s.headline.kg, s.headline.reps], [65, 7]);
  // Back-off set keeps last session's 1-rep drop-off.
  assert.deepEqual(s.sets.map(x => [x.kg, x.reps]), [[65, 7], [65, 6]]);
});

test('after an off day, aim straight back to the recent level (not +1 at a time)', () => {
  // 70x6 recently, then a bad 70x4: target 70x6 again, and the path only lists future steps.
  const s = suggest(sessions([[65, 6], [67.5, 6], [70, 5], [70, 6], [70, 6], [70, 4]]), 'weight_reps', 'machine', NOW)!;
  assert.deepEqual([s.advice, s.headline.kg, s.headline.reps], ['reps', 70, 6]);
  assert.match(s.reason, /below your recent level/);
  assert.ok(s.milestones.every(m => m.weeks > 0.3), 'path holds only future steps');
});

test('top of range with spare strength -> add a weight step at fewer reps', () => {
  const s = suggest(sessions([[60, 6], [62.5, 6], [62.5, 7], [65, 6], [65, 7], [65, 9], [65, 8]]), 'weight_reps', 'machine', NOW)!;
  assert.equal(s.advice, 'weight');
  assert.equal(s.headline.kg, 67.5);
  assert.ok(s.headline.reps! < 8);
});

test('flat trend with no new best -> plateau', () => {
  const s = suggest(sessions([[55, 8], [57.5, 8], [60, 8], [62.5, 8], [65, 7], [65, 6], [65, 7], [65, 6], [65, 6], [65, 6]], 7), 'weight_reps', 'machine', NOW)!;
  assert.equal(s.advice, 'plateau');
});

test('a different machine/gym starts a fresh comparison with faster early progress', () => {
  const s = suggest(sessions([[160, 7], [170, 7], [180, 5], [170, 7], [170, 9], [120, 6]]), 'weight_reps', 'machine', NOW)!;
  assert.equal(s.headline.kg, 120);
  assert.ok(s.theory!.repsAtWeight <= 8);
  assert.ok(s.rate >= 0.015);
  assert.ok(s.milestones[0].weeks < 4, `first step on a new machine in ${s.milestones[0].weeks} weeks`);
});

test('after a long break, ease back in', () => {
  const s = suggest(sessions([[60, 6], [62.5, 7], [65, 8]]), 'weight_reps', 'machine', 470 * DAY)!;
  assert.equal(s.advice, 'return');
  assert.ok(s.headline.kg! < 65);
});

test('bodyweight and timed: no +1 every session right after a new best', () => {
  const bw = (reps: number[]): Session[] => sessions(reps.map(r => [0, r] as [number, number])).map((x, i) => ({ ...x, ex: { ...x.ex, sets: [set(0, reps[i])] } }));
  assert.equal(suggest(bw([10, 12, 11]), 'reps_only', 'none', NOW)!.headline.reps, 12); // below best -> +1
  assert.equal(suggest(bw([10, 11, 12]), 'reps_only', 'none', NOW)!.advice, 'hold'); // just set a best -> match
});
