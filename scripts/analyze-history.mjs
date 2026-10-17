// One-off analysis of data/hevy-export.json to calibrate the progressive-overload engine.
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync('data/hevy-export.json', 'utf8'));
const T = d.templates;
const byEx = new Map();
for (const w of d.workouts) for (const e of w.ex) {
  const work = e.s.filter(s => s[0] !== 'warmup');
  if (!work.length) continue;
  (byEx.get(e.t) ?? byEx.set(e.t, []).get(e.t)).push({ start: w.start, sets: work });
}
const now = d.workouts.at(-1).start;
const rows = [];
for (const [id, ss] of byEx) {
  const t = T[id];
  if (ss.length < 6 || t.type !== 'weight_reps') continue;
  const reps = ss.flatMap(s => s.sets.map(x => x[2])).filter(Boolean).sort((a, b) => a - b);
  const q = p => reps[Math.floor((reps.length - 1) * p)];
  const ws = [...new Set(ss.flatMap(s => s.sets.map(x => x[1])).filter(x => x > 0))].sort((a, b) => a - b);
  const diffs = ws.slice(1).map((w, i) => +(w - ws[i]).toFixed(2)).filter(x => x > 0);
  const cnt = {}; diffs.forEach(x => cnt[x] = (cnt[x] || 0) + 1);
  const step = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0];
  const setsPer = ss.map(s => s.sets.length);
  const last = ss.at(-1), recent = ss.filter(s => s.start > now - 90 * 86400);
  rows.push({
    title: t.title.slice(0, 28), equip: t.equip, n: ss.length, recent: recent.length,
    reps: `${q(0.1)}-${q(0.5)}-${q(0.9)}`, step, sets: (setsPer.reduce((a, b) => a + b) / setsPer.length).toFixed(1),
    last: last.sets.map(x => `${x[1]}x${x[2]}`).join(' '), daysAgo: Math.round((now - last.start) / 86400),
  });
}
rows.sort((a, b) => b.recent - a.recent || b.n - a.n);
console.table(rows.slice(0, 40));

// How often does the top set improve session to session? (recent sessions only)
let up = 0, same = 0, down = 0;
for (const [, ss] of byEx) for (let i = 1; i < ss.length; i++) {
  const top = s => Math.max(...s.sets.map(x => (x[1] || 0) * (1 + (x[2] || 0) / 30)));
  const a = top(ss[i - 1]), b = top(ss[i]);
  if (b > a * 1.005) up++; else if (b < a * 0.995) down++; else same++;
}
console.log({ up, same, down });
// Gap between sessions
const gaps = d.workouts.slice(1).map((w, i) => (w.start - d.workouts[i].start) / 86400).sort((a, b) => a - b);
console.log('median days between workouts', gaps[Math.floor(gaps.length / 2)].toFixed(1), 'longest', gaps.at(-1).toFixed(0));
