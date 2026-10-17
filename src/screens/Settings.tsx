import { useEffect, useRef, useState } from 'react';
import { useData } from '../store';
import { db, setCurrentGym, setPrefs } from '../db';
import { importFile, wipeAll } from '../lib/actions';
import { clock } from '../lib/format';
import { Header, Icon, Segmented, Sheet } from '../components/ui';
import { runBackup } from '../components/Banners';
import { addGymHere, QR } from '../components/Setup';
import { appUrl, getPosition, isPhone } from '../lib/device';
import { go } from '../router';

export function Settings() {
  const { prefs, workouts, gyms, currentGym, lastBackup } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [gymName, setGymName] = useState('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null)); }, []);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setMsg(null);
    try {
      const r = await importFile(await f.text());
      setMsg(`Imported ${r.workouts} workouts, ${r.routines} routines and ${r.exercises} custom exercises.`);
      void navigator.storage?.persist?.().then(setPersisted);
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="screen">
      <Header title="Settings" onBack />
      <section className="card form">
        <h3>Units</h3>
        <label className="inline">Weight<Segmented value={prefs.weightUnit} onChange={v => setPrefs({ weightUnit: v })} options={[['kg', 'kg'], ['lbs', 'lbs']]} /></label>
        <label className="inline">Distance<Segmented value={prefs.distanceUnit} onChange={v => setPrefs({ distanceUnit: v })} options={[['kilometers', 'km'], ['miles', 'mi']]} /></label>
        <h3>Workout</h3>
        <label className="inline">Default rest
          <select value={prefs.defaultRest} onChange={e => setPrefs({ defaultRest: Number(e.target.value) })}>
            {[0, 30, 45, 60, 90, 120, 150, 180, 240, 300].map(v => <option key={v} value={v}>{v ? clock(v) : 'Off'}</option>)}
          </select>
        </label>
        <label className="inline">Count warm-ups in volume
          <input type="checkbox" checked={prefs.volumeIncludesWarmups} onChange={e => setPrefs({ volumeIncludesWarmups: e.target.checked })} />
        </label>
        <label className="inline">Readiness check-in before workouts
          <input type="checkbox" checked={prefs.readinessCheck} onChange={e => setPrefs({ readinessCheck: e.target.checked })} />
        </label>
        <label className="inline">Fill in next-session targets automatically
          <input type="checkbox" checked={prefs.autoFill} onChange={e => setPrefs({ autoFill: e.target.checked })} />
        </label>
        <label className="inline">Pick the gym from my location
          <input type="checkbox" checked={prefs.autoGym} onChange={e => setPrefs({ autoGym: e.target.checked })} />
        </label>
        <h3>Goals</h3>
        <label className="inline">Workouts per week
          <select value={prefs.weeklyTarget} onChange={e => setPrefs({ weeklyTarget: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="inline">Sets per muscle per week
          <select value={prefs.volumeBand.join('-')} onChange={e => setPrefs({ volumeBand: e.target.value.split('-').map(Number) as [number, number] })}>
            {[[6, 10], [8, 14], [10, 20], [12, 22], [15, 25]].map(([a, b]) => <option key={a} value={`${a}-${b}`}>{a}–{b}</option>)}
          </select>
        </label>
      </section>

      <section className="card form">
        <h3>Gyms</h3>
        <p className="muted small">Each gym keeps its own machine settings, weight stacks and suggestions. New workouts use the selected gym.</p>
        {gyms.map(g => (
          <div key={g.id} className="gym-row">
            <button className={'radio' + (g.id === currentGym ? ' on' : '')} aria-label={`Use ${g.name}`} onClick={() => setCurrentGym(g.id)} />
            <input className="text-in grow" value={g.name} onChange={e => db.gyms.update(g.id, { name: e.target.value })} aria-label="Gym name" />
            <button className={'icon-btn sm' + (g.lat != null ? ' located' : '')} title={g.lat != null ? 'Location saved: tap to update' : 'Save this gym’s location (stand in the gym)'}
              aria-label={`Set location of ${g.name} to here`}
              onClick={async () => {
                const p = await getPosition(8000);
                if (p) await db.gyms.update(g.id, { lat: p.lat, lon: p.lon });
                setMsg(p ? `${g.name}: location saved. Workouts started there pick it automatically.` : 'Location unavailable. Allow location access for LAIT and try again.');
              }}>📍</button>
            <button className="icon-btn sm" aria-label={`Delete ${g.name}`} onClick={async () => {
              await db.transaction('rw', db.gyms, db.machines, db.kv, async () => {
                await db.gyms.delete(g.id);
                await db.machines.where('gymId').equals(g.id).delete();
                if (currentGym === g.id) await setCurrentGym(null);
              });
            }}><Icon name="trash" size={16} /></button>
          </div>
        ))}
        <div className="row gap">
          <input className="text-in grow" placeholder="Add a gym" value={gymName} onChange={e => setGymName(e.target.value)} />
          <button className="btn primary sm" disabled={!gymName.trim()} onClick={async () => {
            const r = await addGymHere(gymName, prefs.autoGym);
            setGymName('');
            setMsg(r.located ? `${gymName.trim()} added with its location.` : `${gymName.trim()} added. Use 📍 inside the gym to save its location.`);
          }}>Add</button>
        </div>
      </section>

      <section className="card form">
        <h3>Your data</h3>
        <p className="muted small">
          {workouts.length} workouts stored on this device only.
          {lastBackup ? ` Last backup ${new Date(lastBackup).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.` : ' Never backed up.'}
        </p>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => onFile(e.target.files?.[0])} />
        <button className="btn primary full" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Importing…' : 'Import Hevy export / LAIT backup'}</button>
        <button className="btn ghost full" onClick={() => runBackup()}>Back up all data</button>
        <label className="inline">Remind me to back up
          <select value={prefs.backupEveryDays} onChange={e => setPrefs({ backupEveryDays: Number(e.target.value) })}>
            {[[0, 'Never'], [3, 'Every 3 days'], [7, 'Weekly'], [14, 'Every 2 weeks'], [30, 'Monthly']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <p className="muted small">Backups include workouts, routines, gyms, machines, body measurements and experiments. Photos stay on the phone only.</p>
        {msg && <p className="note">{msg}</p>}
        <p className="muted small">
          Storage: {persisted === true ? 'protected from automatic clearing ✓' : persisted === false ? 'not yet protected. Add LAIT to your Home Screen to keep data safe.' : 'unknown'}
        </p>
        <button className="btn danger-ghost full" onClick={() => setWipe(true)}>Delete all data</button>
      </section>

      {!isPhone() && (
        <section className="card form">
          <h3>Open on your iPhone</h3>
          <p className="muted small">Scan with the iPhone camera, open in Safari, then Share → Add to Home Screen.</p>
          <div className="qr-wrap"><QR text={appUrl()} /></div>
        </section>
      )}
      <button className="btn ghost full setup-again" onClick={() => db.kv.delete('setupDone').then(() => go('/'))}>Run setup again</button>

      <p className="muted small center-t">LAIT · your own training log</p>

      <Sheet open={wipe} onClose={() => setWipe(false)} title="Delete all data?">
        <div className="menu">
          <p className="muted pad">Every workout, routine, custom exercise, gym, measurement and photo on this device will be erased.</p>
          <button className="btn danger full" onClick={async () => { await wipeAll(); setWipe(false); setMsg('All data deleted.'); }}>Delete everything</button>
          <button className="btn ghost full" onClick={() => setWipe(false)}>Cancel</button>
        </div>
      </Sheet>
    </div>
  );
}
