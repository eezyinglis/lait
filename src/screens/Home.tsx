import { useEffect, useRef, useState } from 'react';
import { useData } from '../store';
import { countSets, weekStart, workoutVolume } from '../lib/stats';
import { fmtDuration, fmtVolume, relDate } from '../lib/format';
import type { Workout } from '../types';
import { go } from '../router';
import { Header, Icon } from '../components/ui';
import { BackupBanner, DeloadBanner } from '../components/Banners';
import { SetupWizard } from '../components/Setup';
import { NextUpCard } from '../components/NextUp';

export function WorkoutCard({ w }: { w: Workout }) {
  const { exercises, types, prefs, history } = useData();
  const prs = history.prCount.get(w.id) ?? 0;
  return (
    <button className="card wcard" onClick={() => go(`/workout/${w.id}`)}>
      <div className="wcard-h">
        <div className="wcard-name">{w.name}</div>
        <div className="wcard-date">{relDate(w.start)}</div>
      </div>
      <div className="stats3">
        <div><span>Duration</span><b>{fmtDuration(w.end - w.start)}</b></div>
        <div><span>Volume</span><b>{fmtVolume(workoutVolume(w, types, prefs.volumeIncludesWarmups), prefs)}</b></div>
        {prs > 0 ? <div><span>Records</span><b className="gold"><Icon name="trophy" size={14} /> {prs}</b></div>
          : <div><span>Sets</span><b>{countSets(w)}</b></div>}
      </div>
      <div className="wcard-ex">
        {w.exercises.slice(0, 3).map((e, i) => (
          <div key={i} className="wcard-exl">
            <span className="ex-avatar sm">{exercises.get(e.exId)?.title[0] ?? '?'}</span>
            {e.sets.length} set{e.sets.length !== 1 ? 's' : ''} {exercises.get(e.exId)?.title ?? 'Unknown'}
          </div>
        ))}
        {w.exercises.length > 3 && <div className="muted small">See {w.exercises.length - 3} more exercise{w.exercises.length - 3 > 1 ? 's' : ''}</div>}
      </div>
    </button>
  );
}

const PAGE = 20;

export function Home() {
  const { workouts, ready, setupDone } = useData();
  const [n, setN] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(es => es[0].isIntersecting && setN(x => x + PAGE), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ready]);

  const thisWeek = workouts.filter(w => w.start >= weekStart(Date.now() / 1000)).length;

  return (
    <div className="screen">
      <Header title={<span className="brand">LAIT</span>} right={<button className="icon-btn" aria-label="Settings" onClick={() => go('/settings')}><Icon name="gear" /></button>} />
      <SetupWizard />
      {ready && setupDone && workouts.length === 0 && (
        <div className="empty big">
          <Icon name="dumbbell" size={40} />
          <p>No workouts yet</p>
          <span>Import your Hevy history in Settings, or start a workout.</span>
          <button className="btn primary" onClick={() => go('/settings')}>Import history</button>
        </div>
      )}
      <BackupBanner />
      <DeloadBanner />
      <NextUpCard />
      {workouts.length > 0 && (
        <div className="week-strip">
          <b>{thisWeek}</b> workout{thisWeek !== 1 ? 's' : ''} this week · <b>{workouts.length}</b> total
        </div>
      )}
      {workouts.slice(0, n).map(w => <WorkoutCard key={w.id} w={w} />)}
      {n < workouts.length && <div ref={sentinel} className="loading">Loading…</div>}
    </div>
  );
}
