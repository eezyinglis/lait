// UI for progressive-overload suggestions: the hook that computes them and the pieces that show them.
import { useMemo } from 'react';
import { useData } from '../store';
import { suggest, type Advice, type SetTarget, type Suggestion } from '../lib/overload';
import { effectiveStack, learnStack } from '../lib/training';
import { machineId } from '../db';
import { clock, num, toW, wUnit } from '../lib/format';
import type { Prefs, WExercise } from '../types';
import { Icon } from './ui';

/**
 * Suggestion for one exercise, paced by your personal long-run rate. At a known gym it compares only sessions
 * from that gym (when there are at least 2) and jumps along that machine's real weight stack.
 */
export function useSuggestion(exId: string, ctx: { gymId?: string | null; readiness?: number | null } = {}): Suggestion | null {
  const { history, exercises, prefs, overloadPrior, machines, currentGym } = useData();
  const ex = exercises.get(exId);
  const gymId = ctx.gymId === undefined ? currentGym : ctx.gymId;
  const machine = gymId ? machines.get(machineId(gymId, exId)) : undefined;
  return useMemo(() => {
    const all = history.byExercise.get(exId);
    if (!ex || !all?.length) return null;
    const atGym = gymId ? all.filter(s => s.gymId === gymId) : [];
    const sessions = atGym.length >= 2 ? atGym : all;
    const stack = effectiveStack(machine?.weights, gymId ? learnStack(all, gymId) : []);
    return suggest(sessions, ex.type, ex.equip, Date.now() / 1000, {
      prior: overloadPrior, stack, readiness: ctx.readiness ?? null,
      fw: kg => `${num(toW(kg, prefs), 2)} ${wUnit(prefs)}`,
    });
  }, [history, ex, exId, prefs, overloadPrior, gymId, machine, ctx.readiness]);
}

export const ADVICE: Record<Advice, { label: string; cls: string; icon: string }> = {
  weight: { label: 'Add weight', cls: 'adv-weight', icon: '↑' },
  reps: { label: 'Add a rep', cls: 'adv-reps', icon: '+' },
  hold: { label: 'Match it', cls: 'adv-hold', icon: '=' },
  plateau: { label: 'Plateau', cls: 'adv-plateau', icon: '≈' },
  return: { label: 'Ease back in', cls: 'adv-return', icon: '↺' },
};

/** Advice label; several reps at once only happens when returning to your level after an off day. */
export const adviceLabel = (s: Suggestion) =>
  s.advice === 'reps' && (s.headline.addReps ?? 0) > 1 ? 'Back to your level'
    : s.advice === 'hold' && (s.headline.addKg ?? 0) < 0 ? 'Lighter today'
      : ADVICE[s.advice].label;

/** "65 kg × 8" plus a delta like "+2.5 kg" / "+1 rep". */
export function headlineText(s: Suggestion, p: Prefs) {
  const h = s.headline;
  const main = h.sec != null
    ? clock(h.sec)
    : [h.kg ? `${num(toW(h.kg, p), 2)} ${wUnit(p)}` : '', h.reps != null ? `${h.reps} reps` : ''].filter(Boolean).join(' × ');
  const delta = h.addKg ? `${h.addKg > 0 ? '+' : '−'}${num(Math.abs(toW(h.addKg, p)), 2)} ${wUnit(p)}`
    : h.addReps ? `+${h.addReps} rep${h.addReps > 1 ? 's' : ''}`
      : h.addSec ? `+${h.addSec}s` : '';
  return { main, delta };
}

/** "ready", "~3 weeks", "~4 months", "1+ year". */
export function fmtWeeks(w: number) {
  if (w <= 0.3) return 'ready';
  if (!isFinite(w) || w >= 52) return '1+ year';
  if (w < 1.5) return '~1 week';
  if (w < 9) return `~${Math.round(w)} weeks`;
  return `~${Math.round(w / 4.35)} months`;
}

/** Calendar estimate, e.g. "early Dec". */
export function fmtWhen(w: number) {
  if (w <= 0.3) return 'one step per session';
  if (!isFinite(w) || w >= 52) return '';
  const d = new Date(Date.now() + w * 7 * 86400000);
  const part = d.getDate() <= 10 ? 'early' : d.getDate() <= 20 ? 'mid' : 'late';
  return `${part} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
}

/** Fills the not-yet-ticked working sets with the suggested targets. */
export function applyTargets(ex: WExercise, targets: SetTarget[]): WExercise {
  const targetsSided = targets.some(t => t.side);
  let k = 0;
  return {
    ...ex,
    sets: ex.sets.map(s => {
      if (s.type === 'warmup') return s;
      const idx = k++;
      if (s.done) return s;
      // Map between unilateral (L/R pairs) and bilateral sessions, like the "Previous" column does.
      const t = !!ex.uni === targetsSided ? targets[idx] : ex.uni ? targets[Math.floor(idx / 2)] : targets[idx * 2];
      return t ? { ...s, kg: t.kg ?? s.kg, reps: t.reps ?? s.reps, sec: t.sec ?? s.sec } : s;
    }),
  };
}

/** Compact strip inside a logger exercise card. */
export function SuggestionStrip({ s, onApply }: { s: Suggestion; onApply: () => void }) {
  const { prefs } = useData();
  const a = ADVICE[s.advice];
  const { main, delta } = headlineText(s, prefs);
  const next = s.milestones[0];
  return (
    <div className={'sugg ' + a.cls}>
      <span className="sugg-ic" aria-hidden="true">{a.icon}</span>
      <span className="sugg-t">
        <b>{main}</b> {delta && <span className="sugg-d">{delta}</span>}
        <span className="sugg-l">
          {adviceLabel(s)}
          {s.advice === 'hold' && !(s.headline.addKg && s.headline.addKg < 0) && next && next.weeks > 0.3 &&
            ` · next: ${num(toW(next.kg, prefs), 2)}×${next.reps} ${fmtWeeks(next.weeks)}`}
        </span>
      </span>
      <button className="btn sm sugg-apply" onClick={onApply}>Apply</button>
    </div>
  );
}

/** Full card for the exercise page: target, reasoning, projected path and theoretical headroom. */
export function SuggestionCard({ s }: { s: Suggestion }) {
  const { prefs } = useData();
  const a = ADVICE[s.advice];
  const { main, delta } = headlineText(s, prefs);
  const w = (kg: number) => `${num(toW(kg, prefs), 2)} ${wUnit(prefs)}`;
  const monthly = s.e1rm * s.rate * 4.35;
  return (
    <section className={'card sugg-card ' + a.cls}>
      <h3><Icon name="trophy" size={16} /> Next session</h3>
      <div className="sugg-big"><b>{main}</b> {delta && <span className="sugg-d">{delta}</span>} <span className="sugg-l">{adviceLabel(s)}</span></div>
      <p className="muted">{s.reason}</p>

      {s.milestones.length > 0 && (
        <>
          <div className="path-h">Projected path</div>
          <ol className="path">
            {s.milestones.map((m, i) => (
              <li key={i} className={m.weeks <= 0.3 ? 'ready' : ''}>
                <span className="path-dot">{m.kind === 'weight' ? '↑' : '+'}</span>
                <b>{w(m.kg)} × {m.reps}</b>
                <span className="path-when">{fmtWeeks(m.weeks)}<small>{fmtWhen(m.weeks)}</small></span>
              </li>
            ))}
          </ol>
          <div className="muted small">
            Pace: ~{(s.rate * 100).toFixed(2)}% strength per week (≈ +{num(toW(monthly, prefs), 1)} {wUnit(prefs)} 1RM a month), slowing over time.
          </div>
        </>
      )}

      {s.theory && (
        <div className="theory">
          <div><span>Est. 1RM now</span><b>{w(s.e1rm)}</b></div>
          <div><span>Possible reps at {w(s.theory.atKg)}</span>
            <b>{s.theory.repsAtWeight}{s.theory.addReps > 0 && <em> (+{s.theory.addReps})</em>}</b></div>
          <div><span>Possible weight for {s.theory.forReps} reps</span>
            <b>{w(s.theory.kgAtReps)}{s.theory.addKg > 0.05 && <em> (+{num(toW(s.theory.addKg, prefs), 1)})</em>}</b></div>
        </div>
      )}
      {s.step > 0 && (
        <div className="muted small">Your usual range: {s.repRange[0]}–{s.repRange[1]} reps · usual jump: {w(s.step)} · based on {s.sessions} sessions</div>
      )}
    </section>
  );
}
