// Body weight, measurements and progress photos. Everything stays on the device.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useData } from '../store';
import { db, uid } from '../db';
import { fmtDate, fromW, num, toW, wUnit } from '../lib/format';
import type { BodyEntry, Photo } from '../types';
import { LineChart } from '../components/Chart';
import { Empty, Header, Icon, Segmented, Sheet } from '../components/ui';

const MEASURES: [keyof BodyEntry, string][] = [['waist', 'Waist'], ['chest', 'Chest'], ['arm', 'Arm'], ['thigh', 'Thigh'], ['hips', 'Hips']];

/** Downscales a camera photo to at most 1280 px (JPEG) so hundreds fit comfortably on the phone. */
async function shrink(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.82));
  return { blob, w, h };
}

function usePhotoUrl(p: Photo | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!p) return;
    const u = URL.createObjectURL(p.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [p]);
  return url;
}

function Thumb({ p, onClick }: { p: Photo; onClick: () => void }) {
  const url = usePhotoUrl(p);
  return (
    <button className="thumb" onClick={onClick}>
      {url && <img src={url} alt={`Progress photo ${fmtDate(p.date)}`} />}
      <span>{new Date(p.date * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
    </button>
  );
}

function Viewer({ p, onClose }: { p: Photo; onClose: () => void }) {
  const url = usePhotoUrl(p);
  return (
    <Sheet open onClose={onClose} tall title={fmtDate(p.date)}>
      <div className="viewer">{url && <img src={url} alt="Progress photo" />}</div>
      <button className="btn danger-ghost full" onClick={async () => { await db.photos.delete(p.id); onClose(); }}><Icon name="trash" size={16} /> Delete photo</button>
    </Sheet>
  );
}

export function Body() {
  const { body, prefs } = useData();
  const photos = useLiveQuery(() => db.photos.orderBy('date').reverse().toArray(), []) ?? [];
  const [tab, setTab] = useState<'weight' | 'measure' | 'photos'>('weight');
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const weights = useMemo(() => [...body].reverse().filter(b => b.weightKg != null).map(b => ({
    x: b.date, y: toW(b.weightKg!, prefs), label: new Date(b.date * 1000).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
    tip: `${wUnit(prefs)} · ${fmtDate(b.date)}`,
  })), [body, prefs]);
  // 7-entry moving average: day-to-day water swings hide the real trend.
  const trend = useMemo(() => weights.map((p, i) => {
    const win = weights.slice(Math.max(0, i - 6), i + 1);
    return { x: p.x, y: win.reduce((a, q) => a + q.y, 0) / win.length };
  }), [weights]);
  const latest = body.find(b => b.weightKg != null);
  const monthAgo = body.find(b => b.weightKg != null && b.date <= (latest?.date ?? 0) - 28 * 86400);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const { blob, w, h } = await shrink(f);
        await db.photos.put({ id: uid(), date: Math.floor((f.lastModified || Date.now()) / 1000), blob, w, h });
      }
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="screen">
      <Header title="Body" onBack right={tab !== 'photos'
        ? <button className="icon-btn" aria-label="Add entry" onClick={() => setAdding(true)}><Icon name="plus" /></button>
        : <button className="icon-btn" aria-label="Add photo" onClick={() => fileRef.current?.click()}><Icon name="plus" /></button>} />
      <div className="pad-x"><Segmented value={tab} onChange={setTab} options={[['weight', 'Weight'], ['measure', 'Measurements'], ['photos', `Photos (${photos.length})`]]} /></div>

      {tab === 'weight' && (
        weights.length ? (
          <>
            <section className="card">
              <div className="stats3">
                <div><span>Latest</span><b>{num(toW(latest!.weightKg!, prefs), 1)} {wUnit(prefs)}</b></div>
                <div><span>Trend (7)</span><b>{num(trend[trend.length - 1].y, 1)}</b></div>
                <div><span>vs 4 weeks</span><b>{monthAgo ? `${latest!.weightKg! >= monthAgo.weightKg! ? '+' : ''}${num(toW(latest!.weightKg! - monthAgo.weightKg!, prefs), 1)}` : '–'}</b></div>
              </div>
              <LineChart data={weights} fmt={v => num(v, 1)} projection={undefined} />
              <div className="muted small center-t">Weigh in at the same time of day; the 7-entry trend smooths out water swings.</div>
            </section>
            <EntryList entries={body.filter(b => b.weightKg != null)} render={b => `${num(toW(b.weightKg!, prefs), 1)} ${wUnit(prefs)}${b.bodyFat != null ? ` · ${b.bodyFat}% fat` : ''}`} />
          </>
        ) : <Empty>No weigh-ins yet. Tap + to add one.</Empty>
      )}

      {tab === 'measure' && (
        body.some(b => MEASURES.some(([k]) => b[k] != null)) ? (
          <EntryList entries={body.filter(b => MEASURES.some(([k]) => b[k] != null))}
            render={b => MEASURES.filter(([k]) => b[k] != null).map(([k, l]) => `${l} ${b[k]} cm`).join(' · ')} />
        ) : <Empty>No measurements yet. Tap + to add.</Empty>
      )}

      {tab === 'photos' && (
        <>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => addPhotos(e.target.files)} />
          {busy && <div className="loading">Saving…</div>}
          {photos.length ? (
            <div className="thumbs">{photos.map(p => <Thumb key={p.id} p={p} onClick={() => setView(p)} />)}</div>
          ) : <Empty>Progress photos stay on this phone. Tap + to take or pick one.</Empty>}
        </>
      )}

      <EntrySheet open={adding} onClose={() => setAdding(false)} />
      {view && <Viewer p={view} onClose={() => setView(null)} />}
    </div>
  );
}

function EntryList({ entries, render }: { entries: BodyEntry[]; render: (b: BodyEntry) => string }) {
  return (
    <section className="card">
      {entries.slice(0, 60).map(b => (
        <div key={b.id} className="kv">
          <span>{fmtDate(b.date)}</span>
          <span className="grow right">{render(b)}</span>
          <button className="icon-btn sm" aria-label="Delete entry" onClick={() => db.body.delete(b.id)}><Icon name="trash" size={16} /></button>
        </div>
      ))}
    </section>
  );
}

function EntrySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs } = useData();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setDate(today); setVals({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = (k: string) => (vals[k] ? Number(vals[k].replace(',', '.')) : null);
  const field = (k: string, l: string, unit: string) => (
    <label className="inline">{l}
      <span className="unit-in"><input inputMode="decimal" aria-label={`${l} (${unit})`} value={vals[k] ?? ''} onChange={e => setVals({ ...vals, [k]: e.target.value })} />{unit}</span>
    </label>
  );
  const save = async () => {
    const w = n('weight');
    const entry: BodyEntry = {
      id: uid(), date: Math.floor(new Date(date + 'T08:00:00').getTime() / 1000),
      weightKg: w == null ? null : fromW(w, prefs), bodyFat: n('bodyFat'),
      waist: n('waist'), chest: n('chest'), arm: n('arm'), thigh: n('thigh'), hips: n('hips'), notes: '',
    };
    await db.body.put(entry);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="New entry" tall>
      <div className="form sheet-scroll">
        <label className="inline">Date<input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} /></label>
        {field('weight', 'Body weight', wUnit(prefs))}
        {field('bodyFat', 'Body fat', '%')}
        {MEASURES.map(([k, l]) => <div key={k}>{field(k, l, 'cm')}</div>)}
        <button className="btn primary full" onClick={save} disabled={!Object.values(vals).some(v => v.trim())}>Save</button>
      </div>
    </Sheet>
  );
}
