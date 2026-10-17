// One-off: pull the built-in exercise library (names, muscles, type, equipment) out of the saved Hevy web bundle.
// Usage: node scripts/extract-library.mjs <hevy _app chunk> <out.json>
import fs from 'node:fs';

const src = fs.readFileSync(process.argv[2], 'utf8');
const out = new Map();
const re = /\{"id":"([0-9A-F]{8})","title":"((?:[^"\\]|\\.)*)"/g;
let m;
while ((m = re.exec(src))) {
  const win = src.slice(m.index, m.index + 3000);
  const end = win.indexOf('"localised_instructions"');
  const body = end > 0 ? win.slice(0, end) : win;
  const f = k => (body.match(new RegExp(`"${k}":"([a-z_]+)"`)) || [])[1];
  const other = (body.match(/"other_muscles":\[([^\]]*)\]/) || [])[1];
  if (!f('exercise_type') || !f('muscle_group')) continue;
  out.set(m[1], {
    id: m[1],
    title: JSON.parse(`"${m[2]}"`),
    muscle: f('muscle_group'),
    other: other ? JSON.parse(`[${other}]`) : [],
    type: f('exercise_type'),
    equip: f('equipment_category') || 'none',
  });
}
const list = [...out.values()].sort((a, b) => a.title.localeCompare(b.title));
fs.writeFileSync(process.argv[3], JSON.stringify(list));
console.log(list.length, 'exercises');
