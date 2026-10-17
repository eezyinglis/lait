// Gyms and per-gym machine profiles (settings + the weights a machine actually has).
import { useEffect, useState } from 'react';
import { useData } from '../store';
import { db, machineId, setCurrentGym } from '../db';
import { formatStack, learnStack, parseStack } from '../lib/training';
import { num, toW, fromW, wUnit } from '../lib/format';
import type { Machine } from '../types';
import { Icon, Sheet } from './ui';
import { addGymHere } from './Setup';

/** Choose the gym for a workout (or for new workouts), or add one. */
export function GymPicker({ open, onClose, value, onPick }: { open: boolean; onClose: () => void; value: string | null; onPick: (id: string | null) => void }) {
  const { gyms, prefs } = useData();
  const [name, setName] = useState('');
  const pick = async (id: string | null) => { onPick(id); await setCurrentGym(id); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="Gym">
      <div className="menu">
        <p className="muted small pad">Machines differ between gyms, so LAIT keeps history, weight stacks and suggestions per gym.</p>
        {gyms.map(g => (
          <button key={g.id} className={'menu-i' + (g.id === value ? ' on' : '')} onClick={() => pick(g.id)}>
            <Icon name="home" size={18} /> {g.name} {g.id === value && <span className="grow" />}{g.id === value && <Icon name="check" size={18} />}
          </button>
        ))}
        <button className={'menu-i' + (value == null ? ' on' : '')} onClick={() => pick(null)}>No specific gym</button>
        <div className="row gap add-row">
          <input className="text-in" placeholder="New gym name" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn primary sm" disabled={!name.trim()} onClick={async () => { const { id } = await addGymHere(name, prefs.autoGym); setName(''); await pick(id); }}>Add</button>
        </div>
      </div>
    </Sheet>
  );
}

/** Machine settings (seat, pin…) and available weights for one exercise at one gym. */
export function MachineSheet({ open, onClose, gymId, exId }: { open: boolean; onClose: () => void; gymId: string; exId: string }) {
  const { machines, history, prefs, gyms, exercises } = useData();
  const m = machines.get(machineId(gymId, exId));
  const learned = learnStack(history.byExercise.get(exId) ?? [], gymId);
  const learnedAll = learnStack(history.byExercise.get(exId) ?? []);
  const [settings, setSettings] = useState('');
  const [weights, setWeights] = useState('');
  const toText = (ws: number[]) => formatStack(ws.map(w => Math.round(toW(w, prefs) * 100) / 100));
  useEffect(() => {
    if (!open) return;
    setSettings(m?.settings ?? '');
    setWeights(m?.weights.length ? toText(m.weights) : '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const row: Machine = { id: machineId(gymId, exId), gymId, exId, settings: settings.trim(), weights: parseStack(weights).map(w => fromW(w, prefs)) };
    await db.machines.put(row);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={`${exercises.get(exId)?.title ?? 'Machine'} · ${gyms.find(g => g.id === gymId)?.name ?? ''}`}>
      <div className="form">
        <label>Machine settings<textarea className="text-in" rows={2} placeholder="e.g. seat 4, back pad 2, pin at 7" value={settings} onChange={e => setSettings(e.target.value)} /></label>
        <label>Available weights ({wUnit(prefs)})
          <textarea className="text-in" rows={2} placeholder="e.g. 5-100/5 or 59, 66.3, 73.6" value={weights} onChange={e => setWeights(e.target.value)} />
        </label>
        <div className="muted small">Ranges like <b>10-100/5</b> work. Suggestions will only use these weights.</div>
        {(learned.length > 0 || learnedAll.length > 0) && (
          <div className="chips">
            {learned.length > 0 && <button className="chip" onClick={() => setWeights(toText(learned))}>Use what I've lifted here ({learned.length})</button>}
            {learnedAll.length > learned.length && <button className="chip" onClick={() => setWeights(toText(learnedAll))}>Use all I've lifted ({learnedAll.length})</button>}
          </div>
        )}
        {weights && <div className="muted small">{parseStack(weights).length} weights: {parseStack(weights).slice(0, 12).map(w => num(w, 2)).join(', ')}{parseStack(weights).length > 12 ? '…' : ''}</div>}
        <div className="row gap">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary grow" onClick={save}>Save</button>
        </div>
      </div>
    </Sheet>
  );
}
