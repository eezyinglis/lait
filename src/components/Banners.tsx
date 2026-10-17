// Home-screen nudges: overdue backup and an accumulated-fatigue (deload) hint.
import { useMemo, useState } from 'react';
import { useData } from '../store';
import { db } from '../db';
import { exportBackup } from '../lib/actions';
import { deloadCheck } from '../lib/training';
import { Icon } from './ui';

/** Shares (iPhone: save to Files / iCloud Drive) or downloads a full backup, and remembers when. */
export async function runBackup() {
  const blob = new Blob([await exportBackup()], { type: 'application/json' });
  const name = `lait-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  let ok = false;
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); ok = true; } catch { /* cancelled */ }
  }
  if (!ok) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    ok = true;
  }
  if (ok) await db.kv.put({ key: 'lastBackup', value: Date.now() });
}

export function BackupBanner() {
  const { prefs, lastBackup, workouts } = useData();
  const [busy, setBusy] = useState(false);
  const every = prefs.backupEveryDays;
  if (!every || workouts.length === 0) return null;
  const days = lastBackup ? (Date.now() - lastBackup) / 86400000 : Infinity;
  if (days < every) return null;
  return (
    <div className="banner warn">
      <Icon name="list" size={18} />
      <span className="grow">{lastBackup ? `Last backup ${Math.floor(days)} days ago.` : 'No backup yet.'} Your data lives only on this phone.</span>
      <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); try { await runBackup(); } finally { setBusy(false); } }}>Back up</button>
    </div>
  );
}

export function DeloadBanner() {
  const { history, types, workouts } = useData();
  const d = useMemo(() => deloadCheck(history, types, Date.now() / 1000), [history, types]);
  const [hidden, setHidden] = useState(false);
  if (!d.suggest || hidden || !workouts.length) return null;
  return (
    <div className="banner deload">
      <span className="grow">
        <b>Time for a lighter week?</b> {d.down} of your {d.active} active lifts are below where they were a month ago.
        That's usually fatigue, not lost strength. Try one week at ~90% weight and one set fewer, then come back.
      </span>
      <button className="icon-btn" aria-label="Dismiss" onClick={() => setHidden(true)}><Icon name="x" size={18} /></button>
    </div>
  );
}
