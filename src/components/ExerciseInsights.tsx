// Exercise-page extras: the plateau playbook (with your own experiment track record) and left/right balance.
import { useData } from '../store';
import { db, uid } from '../db';
import type { Suggestion } from '../lib/overload';
import { imbalance, playbook, sideHistory, substitutes } from '../lib/training';
import { fmtDate, num, toW, wUnit } from '../lib/format';
import type { ExperimentKind } from '../types';
import { Icon } from './ui';

const KIND: Record<ExperimentKind, string> = { rep_range: 'Rep-range switch', tempo: 'Slow eccentrics', variation: 'Variation swap' };

export function PlaybookCard({ exId, s }: { exId: string; s: Suggestion | null }) {
  const { exercises, experiments, history, prefs } = useData();
  const ex = exercises.get(exId);
  const mine = experiments.filter(e => e.exId === exId);
  const running = mine.find(e => e.result == null);
  if (!ex || (!running && s?.advice !== 'plateau' && !mine.length)) return null;
  const fmt = (kg: number) => `${num(toW(kg, prefs), 1)} ${wUnit(prefs)}`;
  const top = s?.headline.kg && s.headline.reps ? { kg: s.headline.kg, reps: s.headline.reps } : null;
  const opts = top ? playbook(ex, top.kg, top.reps, substitutes(ex, [...exercises.values()], history), experiments, fmt) : [];
  const days = (t: number) => Math.floor((Date.now() / 1000 - t) / 86400);

  return (
    <section className="card playbook">
      <h3><Icon name="trophy" size={16} /> Plateau playbook</h3>
      {running ? (
        <div className="exp-running">
          <b>{KIND[running.kind]}</b>{running.altExId ? ` → ${exercises.get(running.altExId)?.title}` : ''} · day {days(running.started)} of 21
          <div className="muted small">After 3 weeks, LAIT compares your next {ex.title} session with today's level ({fmt(running.baseline)} est. 1RM) and records whether it worked.</div>
          <button className="btn ghost sm" onClick={() => db.experiments.delete(running.id)}>Cancel experiment</button>
        </div>
      ) : s?.advice === 'plateau' && top && (
        <>
          <p className="muted small">Stuck for 4+ sessions. Pick one change for 3 weeks; LAIT tracks whether it works for you.</p>
          {opts.map(o => (
            <div key={o.kind} className="play-opt">
              <div className="grow"><b>{o.title}</b><div className="muted small">{o.how}</div></div>
              <button className="btn sm primary" onClick={() => db.experiments.put({
                id: uid(), exId, kind: o.kind, altExId: o.altExId ?? null, started: Math.floor(Date.now() / 1000),
                baseline: s.e1rm, result: null, ended: null,
              })}>Try</button>
            </div>
          ))}
        </>
      )}
      {mine.some(e => e.result != null) && (
        <div className="exp-hist">
          <div className="menu-label">Your past experiments</div>
          {mine.filter(e => e.result != null).map(e => (
            <div key={e.id} className="kv">
              <span>{KIND[e.kind]} · {fmtDate(e.started)}</span>
              <b className={e.result! > 0.01 ? 'good' : e.result! < -0.01 ? 'bad' : ''}>{e.result! > 0 ? '+' : ''}{(e.result! * 100).toFixed(1)}%</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function SidesCard({ exId }: { exId: string }) {
  const { history, prefs } = useData();
  const pts = sideHistory(history.byExercise.get(exId) ?? []);
  if (!pts.length) return null;
  const imb = imbalance(pts);
  const last = pts.slice(-6);
  const max = Math.max(...last.flatMap(p => [p.L, p.R]));
  const w = (kg: number) => `${num(toW(kg, prefs), 1)}`;
  return (
    <section className="card sides">
      <h3>Left vs right</h3>
      {imb ? (
        <p className="warn-t">{imb.weak === 'L' ? 'Left' : 'Right'} side trails by {(imb.pct * 100).toFixed(0)}% (≈ {imb.reps} rep{imb.reps > 1 ? 's' : ''}). Start sets with the weaker side and match its reps on the other.</p>
      ) : <p className="muted small">Both sides are within 5% of each other.</p>}
      {last.map(p => (
        <div key={p.start} className="side-row">
          <span className="muted small">{new Date(p.start * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
          <div className="side-bars">
            <div className="side-bar l" style={{ width: `${(p.L / max) * 100}%` }}><span>L {w(p.L)}</span></div>
            <div className="side-bar r" style={{ width: `${(p.R / max) * 100}%` }}><span>R {w(p.R)}</span></div>
          </div>
        </div>
      ))}
      <div className="muted small">Estimated 1RM per side ({wUnit(prefs)})</div>
    </section>
  );
}
