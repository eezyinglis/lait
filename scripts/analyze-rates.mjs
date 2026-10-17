// One-off: how fast does estimated 1RM actually rise, and how does that rate change with time on an exercise?
// Splits each exercise's history at machine/gym changes (>25% top-set jump), then measures the
// %/week slope of e1RM in successive 8-week windows of each streak.
import fs from 'node:fs';

const PCT = [0, 1, .97, .94, .92, .89, .86, .83, .81, .78, .75, .73, .71, .7, .68, .67, .65, .64, .63, .61, .6, .59, .58, .57, .56, .55, .54, .53, .52, .51, .5];
const e1 = (kg, r) => (!kg || !r ? 0 : kg / (r > 30 ? .5 : PCT[r]));
const d = JSON.parse(fs.readFileSync('data/hevy-export.json', 'utf8'));
const W = 7 * 86400;
const byEx = new Map();
for (const w of d.workouts) for (const e of w.ex) {
  if (d.templates[e.t]?.type !== 'weight_reps') continue;
  const best = Math.max(0, ...e.s.filter(s => s[0] !== 'warmup').map(s => e1(s[1], s[2])));
  const kg = Math.max(0, ...e.s.filter(s => s[0] !== 'warmup').map(s => s[1] || 0));
  if (best > 0) (byEx.get(e.t) ?? byEx.set(e.t, []).get(e.t)).push({ t: w.start, e: best, kg });
}
// Theil-Sen slope of ln(e1RM) per week
const slope = pts => {
  const s = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
    if (pts[j].t - pts[i].t > 3 * 86400) s.push((Math.log(pts[j].e) - Math.log(pts[i].e)) / ((pts[j].t - pts[i].t) / W));
  s.sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const buckets = new Map(); // weeks since first session on the exercise -> slopes
for (const [, pts] of byEx) {
  const first = pts[0].t;
  // split streaks
  const streaks = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].kg, b = pts[i].kg;
    if (Math.abs(a - b) / Math.max(a, b) > 0.25) streaks.push([]);
    streaks.at(-1).push(pts[i]);
  }
  for (const st of streaks) {
    for (let w0 = st[0].t; w0 < st.at(-1).t; w0 += 8 * W) {
      const win = st.filter(p => p.t >= w0 && p.t < w0 + 8 * W);
      if (win.length < 4) continue;
      const sl = slope(win);
      if (sl == null) continue;
      const age = Math.floor((w0 - first) / W);
      const key = age < 8 ? '0-8 wk' : age < 26 ? '8-26 wk' : age < 52 ? '26-52 wk' : age < 104 ? '1-2 yr' : '2+ yr';
      (buckets.get(key) ?? buckets.set(key, []).get(key)).push(sl * 100);
    }
  }
}
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) * p)]; };
for (const k of ['0-8 wk', '8-26 wk', '26-52 wk', '1-2 yr', '2+ yr']) {
  const xs = buckets.get(k) ?? [];
  if (!xs.length) continue;
  console.log(k.padEnd(9), 'windows', String(xs.length).padStart(3), ' median %/wk', q(xs, .5).toFixed(2), ' p25', q(xs, .25).toFixed(2), ' p75', q(xs, .75).toFixed(2));
}

// Net long-run rate per streak (>= 12 weeks): best e1RM of last 3 vs first 3 sessions.
console.log('\nLong streaks (same machine >= 12 weeks): net %/week');
const net = [];
for (const [id, pts] of byEx) {
  const streaks = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].kg, b = pts[i].kg;
    if (Math.abs(a - b) / Math.max(a, b) > 0.25) streaks.push([]);
    streaks.at(-1).push(pts[i]);
  }
  for (const st of streaks) {
    const weeks = (st.at(-1).t - st[0].t) / W;
    if (weeks < 12 || st.length < 8) continue;
    const a = Math.max(...st.slice(0, 3).map(p => p.e)), b = Math.max(...st.slice(-3).map(p => p.e));
    const ageAtStart = (st[0].t - pts[0].t) / W;
    net.push({ ex: d.templates[id].title.slice(0, 24), weeks: Math.round(weeks), sessions: st.length, startAgeWk: Math.round(ageAtStart), pctPerWk: +((Math.log(b / a) / weeks) * 100).toFixed(2), totalPct: +((b / a - 1) * 100).toFixed(1) });
  }
}
net.sort((x, y) => y.weeks - x.weeks);
console.table(net.slice(0, 25));
const r = net.map(n => n.pctPerWk);
console.log('median', q(r, .5), 'p25', q(r, .25), 'p75', q(r, .75));
const early = net.filter(n => n.startAgeWk < 12).map(n => n.pctPerWk), late = net.filter(n => n.startAgeWk >= 52).map(n => n.pctPerWk);
console.log('streaks starting in first 12 wk on exercise: median', early.length ? q(early, .5) : '-', ' | starting after 1 yr: median', late.length ? q(late, .5) : '-');
