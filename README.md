# LAIT

A personal workout tracker for iPhone, built as an installable web app (PWA) and modelled on Hevy.
All data lives on the device (IndexedDB). There's no server and no account.

## Use it
1. Open the hosted URL in **Safari** on the iPhone → Share → **Add to Home Screen**.
2. Open LAIT from the Home Screen → Settings (gear) → **Import Hevy export / LAIT backup** → pick `hevy-export.json`
   (AirDrop it or put it in iCloud Drive first).
3. Use **Back up all data** now and then; the backup file imports the same way.

## Features beyond Hevy
- **Gyms & machines:** pick a gym per workout. Each machine keeps its settings (seat, pads…) and its real weight stack. Suggestions and "Previous" use that gym's history.
- **Realistic progressive overload:** paced by your own long-run rate, slowing over time. Includes a projected path, an off-day brake and a return-from-break ramp (2–4 sessions).
- **Effort tap (reps left):** sharpens the strength estimate behind every suggestion.
- **Auto back-off & warm-ups:** the back-off target follows your actual top set and your usual pattern. The warm-up ramp snaps to the machine's stack.
- **Readiness check-in:** a rough day holds or lightens targets.
- **Plateau playbook:** rep-range, tempo or variation experiments, scored automatically after 3 weeks.
- **Time-boxed sessions, swap exercise** (with converted loads), **copy last session, swipe to complete.**
- **Insights:** muscle balance vs target, left/right imbalance, monthly report, deload detector.
- **Body:** weight trend, measurements, progress photos (on-device only).
- **Backup reminders:** backups include everything except photos.

## Develop
```bash
npm install
npm run dev      # http://localhost:5173 (also reachable from the phone on the same Wi-Fi)
npm test         # stats engine checks against data/hevy-export.json when present
npm run build    # static site in dist/
npm run deploy   # test + build + publish dist/ to the gh-pages branch → https://eezyinglis.github.io/lait/
```
The repo is public (needed for free GitHub Pages). Personal data never goes in it: `/data/`, `/research/`,
`/HEVY_BREAKDOWN.md` and `tests/private/` (tests against your real export) are git-ignored.

## Layout
- `src/lib/stats.ts`: 1RM (Hevy's %-table), volume, PR detection and history index. Pure and unit-tested.
- `src/lib/importer.ts`: `lait-import-v1` file ⇄ records (Hevy export and LAIT backups share it).
- `src/lib/actions.ts`: start/finish workouts, routines, import/export.
- `src/screens/*`: Home feed, Logger, Routines, Exercises, Profile, Settings.
- `public/sw.js`: offline cache. `scripts/make-icons.mjs` regenerates PNG icons.
- `data/`, `research/` (git-ignored): your personal export and the Hevy analysis material.
- `HEVY_BREAKDOWN.md` (git-ignored, local only): the reverse-engineering notes this app is based on.
