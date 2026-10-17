import { useEffect, useRef, useState } from 'react';
import type { Exercise, Prefs, SetType, WExercise, WSet } from '../types';
import { usesDistance, usesDuration, usesReps, usesWeight } from '../lib/stats';
import { clock, dUnit, fromD, fromW, toD, toW, wUnit } from '../lib/format';
import { newSet } from '../lib/actions';
import { effectiveRest, nextSets, previousFor, setLabels, toggleUnilateral } from '../lib/unilateral';
import { go } from '../router';
import { setText } from './SetTable';
import { applyTargets, SuggestionStrip, useSuggestion } from './Suggestion';
import { floorOnStack } from '../lib/overload';
import { ExercisePicker } from './ExercisePicker';
import { MachineSheet } from './Gym';
import { useData } from '../store';
import { machineId } from '../db';
import { backoffTarget, copyLast, effectiveStack, learnBackoff, learnStack, substitutes, swapRatio, warmupRamp } from "../lib/training";
import { Icon, Sheet } from './ui';

/** Numeric input that keeps its own text while typing ("62." stays "62.") and reports parsed numbers. */
function NumInput({ value, onChange, placeholder, decimals = true, ariaLabel }: {
  value: number | null; onChange: (v: number | null) => void; placeholder?: string; decimals?: boolean; ariaLabel: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(value == null ? '' : String(value)); }, [value]);
  return (
    <input
      className="num" inputMode={decimals ? 'decimal' : 'numeric'} aria-label={ariaLabel}
      value={text} placeholder={placeholder}
      onFocus={e => { focused.current = true; e.target.select(); }}
      onBlur={() => { focused.current = false; setText(value == null ? '' : String(value)); }}
      onChange={e => {
        const t = e.target.value.replace(',', '.');
        if (!/^\d*\.?\d*$/.test(t)) return;
        setText(t);
        onChange(t === '' || t === '.' ? null : Number(t));
      }}
    />
  );
}

/** Duration input shown as m:ss. Typing a plain number means minutes for cardio and seconds for holds. */
function DurInput({ value, onChange, placeholder, plainIsMinutes }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; plainIsMinutes: boolean }) {
  const fmt = (v: number | null) => (v == null ? '' : clock(v));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(fmt(value)); }, [value]);
  const parse = (t: string): number | null => {
    if (!t.trim()) return null;
    const parts = t.split(':').map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 1) return plainIsMinutes ? Math.round(parts[0] * 60) : Math.round(parts[0]);
    return parts.reduce((a, p) => a * 60 + p, 0);
  };
  return (
    <input className="num" inputMode="numeric" aria-label="Duration" value={text} placeholder={placeholder}
      onFocus={e => { focused.current = true; e.target.select(); }}
      onBlur={() => { focused.current = false; setText(fmt(value)); }}
      onChange={e => { setText(e.target.value); onChange(parse(e.target.value)); }} />
  );
}

const round2 = (v: number) => Math.round(v * 100) / 100;

interface Props {
  ex: WExercise;
  exercise: Exercise | undefined;
  prefs: Prefs;
  previous: WSet[];
  mode: 'log' | 'routine';
  supersetLabel?: string;
  /** Gym of the workout being logged (machine settings, stacks, gym-specific suggestions). */
  gymId?: string | null;
  /** Today's readiness score (1–5), if checked in. */
  readiness?: number | null;
  /** Show the next-session suggestion strip (off when editing a past workout). */
  showSuggestion?: boolean;
  onChange: (ex: WExercise) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onToggleSuperset: () => void;
  /** Called with the rest time (seconds) to start after a set is ticked. */
  onSetDone?: (restSecs: number) => void;
}

/** Swipe a set row right to complete it (vertical scrolling still works). */
function useSwipe(onSwipe: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') start.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (s && e.clientX - s.x > 70 && Math.abs(e.clientY - s.y) < 30) onSwipe();
    },
    onPointerCancel: () => { start.current = null; },
  };
}

function SetRow({ children, onSwipe, className, style }: { children: React.ReactNode; onSwipe: () => void; className: string; style: React.CSSProperties }) {
  const swipe = useSwipe(onSwipe);
  return <div className={className} style={style} {...swipe}>{children}</div>;
}

export function ExerciseCard({ ex, exercise, prefs, previous, mode, supersetLabel, gymId = null, readiness = null, showSuggestion = true, onChange, onRemove, onMove, onToggleSuperset, onSetDone }: Props) {
  const { history, machines, exercises } = useData();
  const t = exercise?.type ?? 'weight_reps';
  const [menu, setMenu] = useState(false);
  const [setMenuIdx, setSetMenuIdx] = useState<number | null>(null);
  const [machineOpen, setMachineOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [pickAny, setPickAny] = useState(false);
  const cols = { w: usesWeight(t), r: usesReps(t), d: usesDistance(t), s: usesDuration(t) };
  const inputs = Object.values(cols).filter(Boolean).length;
  const gridStyle = { gridTemplateColumns: `34px ${mode === 'log' ? 'minmax(64px, 1.3fr) ' : ''}${'minmax(0, 1fr) '.repeat(inputs)}${mode === 'log' ? '38px' : ''}` };

  const sessions = history.byExercise.get(ex.exId) ?? [];
  const machine = gymId ? machines.get(machineId(gymId, ex.exId)) : undefined;
  const stack = effectiveStack(machine?.weights, gymId ? learnStack(sessions, gymId) : []);
  const patchSet = (i: number, p: Partial<WSet>) => onChange({ ...ex, sets: ex.sets.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const addSet = () => onChange({ ...ex, sets: [...ex.sets, ...nextSets(ex, newSet)] });
  const prevAt = (i: number) => previousFor(previous, i, !!ex.uni);
  const labels = setLabels(ex.sets);
  const rest = effectiveRest(ex, prefs.defaultRest);
  const sugg = useSuggestion(ex.exId, { gymId, readiness });
  const allDone = ex.sets.length > 0 && ex.sets.every(s => s.done);
  const weighted = t === 'weight_reps' || t === 'bodyweight_reps' || t === 'weight_duration';

  const tick = (i: number) => {
    const s = ex.sets[i];
    if (s.done) { patchSet(i, { done: false, at: null, rir: undefined }); return; }
    // Empty fields take the previous session's values, like Hevy's placeholders.
    const prev = prevAt(i);
    const fill = (k: 'kg' | 'reps' | 'm' | 'sec') => s[k] ?? prev?.[k] ?? null;
    patchSet(i, { kg: fill('kg'), reps: fill('reps'), m: fill('m'), sec: fill('sec'), done: true, at: Math.floor(Date.now() / 1000) });
    onSetDone?.(rest);
  };

  // "Reps left?" is asked for the most recently ticked working set until answered (or dismissed with ✕ = skip).
  const rirIdx = mode === 'log' && weighted
    ? ex.sets.reduce((best, s, i) => (s.done && s.type !== 'warmup' && s.rir === undefined && (best < 0 || (s.at ?? 0) >= (ex.sets[best].at ?? 0)) ? i : best), -1)
    : -1;

  // Back-off target: once the top set (first working set of a side) is done, the next working set of that side
  // gets a target from what you actually just did, using your usual drop-off.
  const workIdx = ex.sets.map((s, i) => (s.type !== 'warmup' ? i : -1)).filter(i => i >= 0);
  const backoff = (() => {
    if (mode !== 'log' || t !== 'weight_reps') return null;
    const sides: ('L' | 'R' | undefined)[] = ex.uni ? ['L', 'R'] : [undefined];
    const pattern = learnBackoff(sessions);
    const snap = (kg: number) => floorOnStack(kg, stack, sugg?.step || 1.25);
    const out: { at: number; topIdx: number; kg: number | null; reps: number | null }[] = [];
    for (const side of sides) {
      const idxs = workIdx.filter(i => !ex.uni || ex.sets[i].side === side);
      if (idxs.length < 2) continue;
      const top = ex.sets[idxs[0]], next = ex.sets[idxs[1]];
      if (!top.done || next.done) continue;
      const tgt = backoffTarget(top, pattern, snap);
      if (tgt.kg === next.kg && tgt.reps === next.reps) continue;
      out.push({ at: idxs[1], topIdx: idxs[0], ...tgt });
    }
    return out.length ? out : null;
  })();
  const applyBackoff = () => onChange({ ...ex, sets: ex.sets.map((s, i) => { const b = backoff?.find(x => x.at === i); return b ? { ...s, kg: b.kg, reps: b.reps } : s; }) });

  const addWarmups = () => {
    const first = ex.sets.find(s => s.type !== 'warmup');
    const target = first?.kg ?? sugg?.headline.kg ?? prevAt(0)?.kg ?? null;
    if (!target) return;
    const ramp = warmupRamp(target, stack, sugg?.step || 2.5);
    const warm: WSet[] = ramp.flatMap(r => {
      const base: WSet = { type: 'warmup', kg: r.kg, reps: r.reps, rpe: null, m: null, sec: null, done: false };
      return ex.uni ? [{ ...base, side: 'L' as const }, { ...base, side: 'R' as const }] : [base];
    });
    onChange({ ...ex, sets: [...warm, ...ex.sets.filter(s => s.type !== 'warmup' || s.done)] });
  };

  const swapTo = (newId: string) => {
    const ratio = swapRatio(sessions, history.byExercise.get(newId) ?? [], Date.now() / 1000);
    onChange({
      ...ex, exId: newId,
      // Convert target loads with your own strength ratio between the two; otherwise clear them so the
      // new exercise's "Previous" column guides you.
      sets: ex.sets.map(s => (s.done ? s : { ...s, kg: ratio && s.kg ? Math.round(s.kg * ratio * 2) / 2 : null })),
    });
    setSwapOpen(false);
  };
  const subs = exercise ? substitutes(exercise, [...exercises.values()], history) : [];

  return (
    <section className={'card ex-card' + (supersetLabel ? ' superset' : '')}>
      <div className="ex-card-h">
        <button className="ex-card-title" onClick={() => exercise && go(`/exercise/${exercise.id}`)}>
          {exercise?.title ?? 'Unknown exercise'}
        </button>
        {supersetLabel && <span className="ss-tag">{supersetLabel}</span>}
        <button className={'uni-btn' + (ex.uni ? ' on' : '')} aria-pressed={!!ex.uni} title="Unilateral: log left and right separately"
          onClick={() => onChange(toggleUnilateral(ex))}>L/R</button>
        <button className="icon-btn" aria-label="Exercise options" onClick={() => setMenu(true)}><Icon name="more" /></button>
      </div>
      {gymId && (machine?.settings || machine?.weights.length) && (
        <button className="machine-line" onClick={() => setMachineOpen(true)}>
          <Icon name="gear" size={14} /> {machine?.settings || `${machine?.weights.length} weights on this machine`}
        </button>
      )}
      <textarea className="notes" rows={1} placeholder="Add notes…" value={ex.notes} onChange={e => onChange({ ...ex, notes: e.target.value })} />
      <button className="rest-chip" onClick={() => setMenu(true)}>
        <Icon name="timer" size={15} /> Rest: {rest ? clock(rest) : 'off'}
        {ex.uni ? ' per side (½)' : ex.rest == null ? ' (default)' : ''}
      </button>
      {showSuggestion && sugg && !allDone && <SuggestionStrip s={sugg} onApply={() => onChange(applyTargets(ex, sugg.sets))} />}

      <div className={'set-grid head ' + mode} style={gridStyle}>
        <span>SET</span>
        {mode === 'log' && <span>PREVIOUS</span>}
        {cols.w && <span>{t === 'bodyweight_assisted_reps' ? '-' : t === 'bodyweight_reps' ? '+' : ''}{wUnit(prefs).toUpperCase()}</span>}
        {cols.d && <span>{t === 'short_distance_weight' ? 'M' : dUnit(prefs).toUpperCase()}</span>}
        {cols.r && <span>{t === 'floors_duration' ? 'FLOORS' : t === 'steps_duration' ? 'STEPS' : 'REPS'}</span>}
        {cols.s && <span>TIME</span>}
        {mode === 'log' && <span className="tick-h"><Icon name="check" size={16} /></span>}
      </div>

      {ex.sets.map((s, i) => {
        const prev = prevAt(i);
        const ph = (k: 'kg' | 'reps' | 'm' | 'sec') => {
          const v = prev?.[k];
          if (v == null) return '';
          if (k === 'kg') return String(round2(toW(v, prefs)));
          if (k === 'm') return t === 'short_distance_weight' ? String(v) : String(round2(toD(v, prefs)));
          return String(v);
        };
        const bo = backoff?.find(b => b.topIdx === i);
        return (
          <div key={i}>
            <SetRow className={'set-grid ' + mode + (s.done ? ' done' : '') + (s.side === 'R' ? ' side-r' : '')} style={gridStyle}
              onSwipe={() => mode === 'log' && !s.done && tick(i)}>
              <button className={'set-badge btn-badge ' + s.type + (s.side ? ' sided' : '')} onClick={() => setSetMenuIdx(i)} aria-label="Set type">{labels[i]}</button>
              {mode === 'log' && (
                <button className="prev" onClick={() => prev && patchSet(i, { kg: prev.kg, reps: prev.reps, m: prev.m, sec: prev.sec })}>
                  {prev ? setText(prev, t, prefs).replace(/ (kg|lbs)/, '') : '–'}
                </button>
              )}
              {cols.w && <NumInput ariaLabel="Weight" value={s.kg == null ? null : round2(toW(s.kg, prefs))} placeholder={ph('kg')}
                onChange={v => patchSet(i, { kg: v == null ? null : fromW(v, prefs) })} />}
              {cols.d && (t === 'short_distance_weight'
                ? <NumInput ariaLabel="Distance" value={s.m} placeholder={ph('m')} onChange={v => patchSet(i, { m: v })} />
                : <NumInput ariaLabel="Distance" value={s.m == null ? null : round2(toD(s.m, prefs))} placeholder={ph('m')}
                    onChange={v => patchSet(i, { m: v == null ? null : fromD(v, prefs) })} />)}
              {cols.r && <NumInput ariaLabel="Reps" decimals={false} value={s.reps} placeholder={ph('reps')} onChange={v => patchSet(i, { reps: v })} />}
              {cols.s && <DurInput value={s.sec} placeholder={prev?.sec != null ? clock(prev.sec) : ''} plainIsMinutes={t !== 'duration' && t !== 'weight_duration'}
                onChange={v => patchSet(i, { sec: v })} />}
              {mode === 'log' && (
                <button className={'tick' + (s.done ? ' on' : '')} onClick={() => tick(i)} aria-label={s.done ? 'Undo set' : 'Complete set'}>
                  <Icon name="check" size={18} stroke={3} />
                  {s.done && s.rir != null && <span className="rir-tag">{s.rir >= 3 ? '3+' : s.rir}</span>}
                </button>
              )}
            </SetRow>
            {i === rirIdx && (
              <div className="rir-row">
                <span>Reps left?</span>
                {[0, 1, 2, 3].map(v => <button key={v} className="chip" onClick={() => patchSet(i, { rir: v })}>{v === 3 ? '3+' : v}</button>)}
                <button className="chip ghost" aria-label="Skip" onClick={() => patchSet(i, { rir: null })}>✕</button>
              </div>
            )}
            {bo && i !== rirIdx && (
              <button className="backoff-row" onClick={applyBackoff}>
                ↳ Back-off target: <b>{bo.kg != null ? `${round2(toW(bo.kg, prefs))} ${wUnit(prefs)} × ` : ''}{bo.reps}</b> <span className="muted">tap to fill</span>
              </button>
            )}
          </div>
        );
      })}

      <button className="btn ghost full add-set" onClick={addSet}><Icon name="plus" size={18} /> Add set</button>

      <Sheet open={setMenuIdx !== null} onClose={() => setSetMenuIdx(null)} title="Set type">
        <div className="menu">
          {(['normal', 'warmup', 'dropset', 'failure'] as SetType[]).map(st => (
            <button key={st} className={'menu-i' + (setMenuIdx !== null && ex.sets[setMenuIdx]?.type === st ? ' on' : '')}
              onClick={() => { if (setMenuIdx !== null) patchSet(setMenuIdx, { type: st }); setSetMenuIdx(null); }}>
              <span className={'set-badge ' + st}>{st === 'normal' ? '1' : st[0].toUpperCase()}</span>
              {st === 'normal' ? 'Normal set' : st === 'warmup' ? 'Warm-up set' : st === 'dropset' ? 'Drop set' : 'Failure set'}
            </button>
          ))}
          <button className="menu-i danger" onClick={() => {
            if (setMenuIdx !== null) onChange({ ...ex, sets: ex.sets.filter((_, j) => j !== setMenuIdx) });
            setSetMenuIdx(null);
          }}><Icon name="trash" size={18} /> Remove set</button>
        </div>
      </Sheet>

      <Sheet open={menu} onClose={() => setMenu(false)} title={exercise?.title}>
        <div className="menu">
          <div className="menu-label">Rest timer{ex.uni ? ' (halved per side while L/R is on)' : ''}</div>
          <div className="chips">
            {[null, 30, 60, 90, 120, 150, 180, 240, 300].map(v => (
              <button key={String(v)} className={'chip' + (ex.rest === v ? ' on' : '')} onClick={() => onChange({ ...ex, rest: v })}>
                {v == null ? 'Default' : v === 0 ? 'Off' : clock(v)}
              </button>
            ))}
          </div>
          {weighted && <button className="menu-i" onClick={() => { addWarmups(); setMenu(false); }}><Icon name="timer" size={18} /> Add warm-up sets</button>}
          {mode === 'log' && previous.length > 0 && (
            <button className="menu-i" onClick={() => { onChange(copyLast(ex, previous)); setMenu(false); }}><Icon name="list" size={18} /> Copy last session</button>
          )}
          <button className="menu-i" onClick={() => { setMenu(false); setSwapOpen(true); }}><Icon name="dumbbell" size={18} /> Swap exercise</button>
          {gymId && <button className="menu-i" onClick={() => { setMenu(false); setMachineOpen(true); }}><Icon name="gear" size={18} /> Machine settings & weights</button>}
          <button className="menu-i" onClick={() => { onToggleSuperset(); setMenu(false); }}><Icon name="link" size={18} /> {ex.ss != null ? 'Remove from superset' : 'Superset with next exercise'}</button>
          <button className="menu-i" onClick={() => { onMove(-1); setMenu(false); }}>↑ Move up</button>
          <button className="menu-i" onClick={() => { onMove(1); setMenu(false); }}>↓ Move down</button>
          <button className="menu-i danger" onClick={() => { onRemove(); setMenu(false); }}><Icon name="trash" size={18} /> Remove exercise</button>
        </div>
      </Sheet>

      <Sheet open={swapOpen} onClose={() => setSwapOpen(false)} title="Swap exercise">
        <div className="menu">
          <p className="muted small pad">Machine taken or a different gym? Pick a substitute. Target weights are converted using your own strength on both.</p>
          {subs.map(s => (
            <button key={s.id} className="menu-i" onClick={() => swapTo(s.id)}>
              <span className="ex-avatar sm">{s.title[0]}</span>
              <span className="grow">{s.title}<br /><span className="muted small">{history.byExercise.get(s.id)?.length ?? 0} sessions</span></span>
            </button>
          ))}
          <button className="btn ghost full" onClick={() => { setSwapOpen(false); setPickAny(true); }}><Icon name="search" size={16} /> Search all exercises</button>
        </div>
      </Sheet>
      <ExercisePicker open={pickAny} multi={false} onClose={() => setPickAny(false)} onPick={ids => ids[0] && swapTo(ids[0])} />
      {gymId && <MachineSheet open={machineOpen} onClose={() => setMachineOpen(false)} gymId={gymId} exId={ex.exId} />}
    </section>
  );
}

/** Shared list operations for logger and routine editor. */
export function listOps(list: WExercise[], set: (l: WExercise[]) => void) {
  return {
    change: (i: number, e: WExercise) => set(list.map((x, j) => (j === i ? e : x))),
    remove: (i: number) => set(list.filter((_, j) => j !== i)),
    move: (i: number, d: -1 | 1) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return;
      const l = [...list];
      [l[i], l[j]] = [l[j], l[i]];
      set(l);
    },
    toggleSuperset: (i: number) => {
      const l = list.map(e => ({ ...e }));
      if (l[i].ss != null) { l[i].ss = null; }
      else if (i + 1 < l.length) {
        const g = l[i + 1].ss ?? Math.max(0, ...l.map(e => e.ss ?? 0)) + 1;
        l[i].ss = g; l[i + 1].ss = g;
      }
      // A superset needs at least two members.
      const counts = new Map<number, number>();
      l.forEach(e => e.ss != null && counts.set(e.ss, (counts.get(e.ss) ?? 0) + 1));
      l.forEach(e => { if (e.ss != null && counts.get(e.ss)! < 2) e.ss = null; });
      set(l);
    },
    add: (ids: string[], rest: number | null = null) =>
      set([...list, ...ids.map(exId => ({ exId, notes: '', ss: null, rest, sets: [newSet()] }))]),
  };
}

/** "Superset A", "Superset B"… by order of first appearance. */
export function supersetLabels(list: WExercise[]) {
  const order: number[] = [];
  list.forEach(e => e.ss != null && !order.includes(e.ss) && order.push(e.ss));
  return list.map(e => (e.ss == null ? undefined : `Superset ${String.fromCharCode(65 + order.indexOf(e.ss))}`));
}
