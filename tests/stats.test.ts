import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHistory, oneRepMax, workoutVolume } from '../src/lib/stats.ts';
import { fromLaitFile, parseLaitFile, toLaitFile } from '../src/lib/importer.ts';

test('1RM uses Hevy client table (weight / pct[reps])', () => {
  assert.equal(oneRepMax(65, 8).toFixed(3), '80.247');
  assert.equal(oneRepMax(65, 7).toFixed(3), '78.313');
  assert.equal(oneRepMax(100, 1), 100);
  assert.equal(oneRepMax(50, 40), 100);
  assert.equal(oneRepMax(0, 5), 0);
});
