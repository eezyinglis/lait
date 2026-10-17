import { useMemo, useState } from 'react';
import { useData } from '../store';
import { db, uid } from '../db';
import { EQUIPMENT, MUSCLES, label } from '../lib/format';
import type { Exercise, ExerciseType } from '../types';
import { Icon, Sheet } from './ui';

export const TYPE_LABEL: Record<ExerciseType, string> = {
  weight_reps: 'Weight & reps', reps_only: 'Reps only', bodyweight_reps: 'Weighted bodyweight',
  bodyweight_assisted_reps: 'Assisted bodyweight', duration: 'Duration', weight_duration: 'Weight & duration',
  distance_duration: 'Distance & duration', short_distance_weight: 'Weight & distance',
  floors_duration: 'Floors & duration', steps_duration: 'Steps & duration',
};

/** Sorted exercise list: most-used first, then alphabetical. Shared by the picker and the Exercises tab. */
export function useExerciseList(query: string, muscle: string, equip: string) {
  const { exercises, history } = useData();
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    return [...exercises.values()]
      .filter(e => (!muscle || e.muscle === muscle) && (!equip || e.equip === equip))
      .filter(e => words.every(w => e.title.toLowerCase().includes(w) || e.muscle.includes(w) || e.equip.includes(w)))
      .map(e => ({ e, uses: history.byExercise.get(e.id)?.length ?? 0 }))
      .sort((a, b) => b.uses - a.uses || a.e.title.localeCompare(b.e.title));
  }, [exercises, history, query, muscle, equip]);
}

export function ExerciseRow({ e, uses, selected, onClick }: { e: Exercise; uses: number; selected?: boolean; onClick: () => void }) {
  return (
    <button className={'ex-row' + (selected ? ' sel' : '')} onClick={onClick}>
      <span className="ex-avatar">{e.title[0]}</span>
      <span className="ex-main">
        <span className="ex-title">{e.title}</span>
        <span className="ex-sub">{label(e.muscle)}{e.equip !== 'none' ? ` · ${label(e.equip)}` : ''}{e.custom ? ' · Custom' : ''}</span>
      </span>
      {uses > 0 && <span className="ex-uses">{uses}×</span>}
      {selected && <span className="ex-check"><Icon name="check" size={18} /></span>}
    </button>
  );
}

export function Filters({ q, setQ, muscle, setMuscle, equip, setEquip }: {
  q: string; setQ: (v: string) => void; muscle: string; setMuscle: (v: string) => void; equip: string; setEquip: (v: string) => void;
}) {
  return (
    <div className="filters">
      <label className="search">
        <Icon name="search" size={18} />
        <input placeholder="Search exercise" value={q} onChange={e => setQ(e.target.value)} type="search" />
      </label>
      <div className="filter-row">
        <select value={muscle} onChange={e => setMuscle(e.target.value)} aria-label="Muscle">
          <option value="">All muscles</option>
          {MUSCLES.map(m => <option key={m} value={m}>{label(m)}</option>)}
        </select>
        <select value={equip} onChange={e => setEquip(e.target.value)} aria-label="Equipment">
          <option value="">All equipment</option>
          {EQUIPMENT.map(m => <option key={m} value={m}>{label(m)}</option>)}
        </select>
      </div>
    </div>
  );
}

export function ExercisePicker({ open, onClose, onPick, multi = true }: { open: boolean; onClose: () => void; onPick: (ids: string[]) => void; multi?: boolean }) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('');
  const [equip, setEquip] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const list = useExerciseList(q, muscle, equip);

  const close = () => { setSel([]); setQ(''); setCreating(false); onClose(); };
  const toggle = (id: string) => {
    if (!multi) { onPick([id]); close(); return; }
    setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  };

  return (
    <Sheet open={open} onClose={close} tall title={creating ? 'New exercise' : 'Add exercise'}>
      {creating ? (
        <CustomExerciseForm initialTitle={q} onDone={id => { setCreating(false); if (id) toggle(id); }} />
      ) : (
        <>
          <Filters {...{ q, setQ, muscle, setMuscle, equip, setEquip }} />
          <div className="sheet-scroll">
            {list.slice(0, 200).map(({ e, uses }) => (
              <ExerciseRow key={e.id} e={e} uses={uses} selected={sel.includes(e.id)} onClick={() => toggle(e.id)} />
            ))}
            {list.length === 0 && <div className="empty">No match.</div>}
            <button className="btn ghost full" onClick={() => setCreating(true)}><Icon name="plus" size={18} /> Create custom exercise</button>
          </div>
          {multi && sel.length > 0 && (
            <div className="sheet-foot">
              <button className="btn primary full" onClick={() => { onPick(sel); close(); }}>
                Add {sel.length} exercise{sel.length > 1 ? 's' : ''}
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

export function CustomExerciseForm({ initialTitle = '', onDone }: { initialTitle?: string; onDone: (id: string | null) => void }) {
  const [title, setTitle] = useState(initialTitle);
  const [muscle, setMuscle] = useState('chest');
  const [equip, setEquip] = useState('none');
  const [type, setType] = useState<ExerciseType>('weight_reps');
  const save = async () => {
    if (!title.trim()) return;
    const id = uid();
    await db.exercises.put({ id, title: title.trim(), muscle, other: [], type, equip, custom: true });
    onDone(id);
  };
  return (
    <div className="form">
      <label>Name<input value={title} onChange={e => setTitle(e.target.value)} autoFocus /></label>
      <label>Primary muscle<select value={muscle} onChange={e => setMuscle(e.target.value)}>{MUSCLES.map(m => <option key={m} value={m}>{label(m)}</option>)}</select></label>
      <label>Equipment<select value={equip} onChange={e => setEquip(e.target.value)}>{EQUIPMENT.map(m => <option key={m} value={m}>{label(m)}</option>)}</select></label>
      <label>Tracking<select value={type} onChange={e => setType(e.target.value as ExerciseType)}>
        {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select></label>
      <div className="row gap">
        <button className="btn ghost" onClick={() => onDone(null)}>Cancel</button>
        <button className="btn primary grow" onClick={save} disabled={!title.trim()}>Save</button>
      </div>
    </div>
  );
}
