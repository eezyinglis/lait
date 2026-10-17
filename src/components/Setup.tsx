// First-launch setup: each step checks itself off as soon as LAIT detects it is done.
import { useEffect, useRef, useState } from 'react';
import { useData } from '../store';
import { db, setCurrentGym, uid } from '../db';
import { importFile } from '../lib/actions';
import { appUrl, getPosition, isIOS, isPhone, isStandalone } from '../lib/device';
import { clock } from '../lib/format';
import { Icon } from './ui';

/** QR code for a URL, drawn as SVG. The encoder is only loaded when a QR is actually shown (on a computer). */
export function QR({ text, size = 180 }: { text: string; size?: number }) {
  const [cells, setCells] = useState<boolean[][] | null>(null);
  useEffect(() => {
    let live = true;
    void import('qrcode-generator').then(({ default: qrcode }) => {
      const q = qrcode(0, 'M');
      q.addData(text);
      q.make();
      const n = q.getModuleCount();
      if (live) setCells(Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c))));
    });
    return () => { live = false; };
  }, [text]);
  if (!cells) return <div className="qr" style={{ width: size, height: size }} />;
  const n = cells.length, m = 2; // quiet zone
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${n + 2 * m} ${n + 2 * m}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges">
      <rect width={n + 2 * m} height={n + 2 * m} fill="#fff" />
      {cells.flatMap((row, r) => row.map((d, c) => (d ? <rect key={`${r}-${c}`} x={c + m} y={r + m} width={1} height={1} fill="#000" /> : null)))}
    </svg>
  );
}

/** Adds a gym; with `here`, stores your current location so workouts started there pick it automatically. */
export async function addGymHere(name: string, here: boolean) {
  const pos = here ? await getPosition(8000) : null;
  const id = uid();
  await db.gyms.put({ id, name: name.trim() || 'My gym', order: await db.gyms.count(), lat: pos?.lat ?? null, lon: pos?.lon ?? null });
  await setCurrentGym(id);
  return { id, located: !!pos };
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <div className={'step' + (done ? ' done' : '')}>
      <span className="step-n">{done ? <Icon name="check" size={16} stroke={3} /> : n}</span>
      <div className="grow">
        <b>{title}</b>
        {!done && children}
      </div>
    </div>
  );
}

export function SetupWizard() {
  const { workouts, gyms, setupDone, prefs } = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gymName, setGymName] = useState('');
  const [gymMsg, setGymMsg] = useState<string | null>(null);
  if (setupDone) return null;

  const phone = isPhone(), installed = isStandalone();
  const imported = workouts.length > 0, hasGym = gyms.length > 0;
  const finish = () => db.kv.put({ key: 'setupDone', value: true });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setMsg(null);
    try {
      const r = await importFile(await f.text());
      setMsg(`Imported ${r.workouts} workouts. Tuned to how you train: ${r.tuned.weeklyTarget} workouts/week, ` +
        `${r.tuned.volumeBand[0]}–${r.tuned.volumeBand[1]} sets per muscle per week` +
        (r.tuned.defaultRest ? `, ${clock(r.tuned.defaultRest)} rest.` : '.'));
      void navigator.storage?.persist?.();
    } catch (e) {
      setMsg(`That file didn't work: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="card setup">
      <div className="row between">
        <h3>Set up LAIT</h3>
        <button className="btn ghost sm" onClick={finish}>{imported ? 'Done' : 'Skip'}</button>
      </div>

      {!phone ? (
        <Step n={1} done={false} title="Open LAIT on your iPhone">
          <p className="muted small">Scan with the iPhone camera, open in Safari, then Share → <b>Add to Home Screen</b>. Do the rest of the setup there.</p>
          <div className="qr-wrap"><QR text={appUrl()} /></div>
          <div className="muted small center-t">{appUrl()}</div>
        </Step>
      ) : (
        <Step n={1} done={installed} title={isIOS() ? 'Add LAIT to your Home Screen' : 'Install LAIT'}>
          <p className="muted small">
            {isIOS()
              ? <>Tap <b>Share</b> <span className="share-ic">⬆︎</span> at the bottom of Safari, then <b>Add to Home Screen</b>. Open LAIT from the Home Screen and continue there: the installed app keeps its own data, separate from Safari.</>
              : <>Use your browser menu → <b>Install app</b> / <b>Add to Home screen</b>, then open it from there.</>}
          </p>
        </Step>
      )}

      <Step n={2} done={imported} title="Import your Hevy history">
        <p className="muted small">Your export is already in your cloud drive: <b>Files → Google Drive</b> (or <b>OneDrive</b>) <b>→ LAIT → hevy-export.json</b>.</p>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => onFile(e.target.files?.[0])} />
        <button className="btn primary full" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Importing…' : 'Choose hevy-export.json'}</button>
      </Step>
      {msg && <p className="note">{msg}</p>}

      <Step n={3} done={hasGym} title="Add the gym you're at">
        <p className="muted small">LAIT remembers its location and picks it automatically whenever you start a workout there. Machine settings and weights are kept per gym.</p>
        <div className="row gap">
          <input className="text-in grow" placeholder="Gym name" value={gymName} onChange={e => setGymName(e.target.value)} aria-label="Gym name" />
          <button className="btn primary sm" disabled={!gymName.trim()} onClick={async () => {
            const r = await addGymHere(gymName, prefs.autoGym);
            setGymName('');
            setGymMsg(r.located ? 'Saved with its location.' : 'Saved. Location wasn’t available, so pick it manually in a workout, or set it later in Settings.');
          }}>Add here</button>
        </div>
      </Step>
      {gymMsg && <p className="note">{gymMsg}</p>}

      <Step n={4} done={false} title="Train">
        <p className="muted small">Start a routine: targets fill in automatically, the gym is picked from your location, and LAIT reminds you to back up weekly.</p>
        <button className="btn ghost full" onClick={finish}>Finish setup</button>
      </Step>
    </section>
  );
}
