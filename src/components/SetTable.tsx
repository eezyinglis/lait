// Read-only set list used by workout details and exercise history.
import type { ExerciseType, Prefs, WSet } from '../types';
import type { SetPR } from '../lib/stats';
import { dUnit, fmtDuration, num, toD, toW, wUnit, PR_LABEL } from '../lib/format';
import { usesDistance, usesDuration, usesReps, usesWeight } from '../lib/stats';
import { setLabels } from '../lib/unilateral';
import { Icon } from './ui';

export function setText(s: WSet, t: ExerciseType, p: Prefs) {
  const parts: string[] = [];
  if (usesWeight(t) && s.kg != null) {
    const w = `${num(toW(s.kg, p), 2)} ${wUnit(p)}`;
    parts.push(t === 'bodyweight_assisted_reps' ? `-${w}` : t === 'bodyweight_reps' ? `+${w}` : w);
  }
  if (usesReps(t) && s.reps != null) parts.push(`${s.reps} ${t === 'floors_duration' ? 'floors' : t === 'steps_duration' ? 'steps' : 'reps'}`);
  if (usesDistance(t) && s.m != null) parts.push(t === 'short_distance_weight' ? `${num(s.m, 0)} m` : `${num(toD(s.m, p), 2)} ${dUnit(p)}`);
  if (usesDuration(t) && s.sec != null) parts.push(fmtDuration(s.sec));
  if (s.rpe != null) parts.push(`@ RPE ${s.rpe}`);
  return parts.join(' × ').replace(' × @', ' @') || '–';
}

export function SetTable({ sets, type, prefs, prs }: { sets: WSet[]; type: ExerciseType; prefs: Prefs; prs?: Map<number, SetPR[]> }) {
  const labels = setLabels(sets);
  return (
    <div className="sets">
      {sets.map((s, i) => {
        const p = prs?.get(i);
        return (
          <div className="set-line" key={i}>
            <span className={'set-badge ' + s.type + (s.side ? ' sided' : '')}>{labels[i]}</span>
            <span className="set-txt">{setText(s, type, prefs)}</span>
            {p && <span className="pr-chip" title={p.map(x => PR_LABEL[x.type]).join(', ')}><Icon name="trophy" size={13} /> {p.length > 1 ? p.length : 'PR'}</span>}
          </div>
        );
      })}
    </div>
  );
}
