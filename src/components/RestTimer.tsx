import { useEffect, useState } from 'react';
import { useData } from '../store';
import { setRest } from '../db';
import { clock } from '../lib/format';

// iOS only lets audio start from a user gesture, so the context is created/resumed when a set is ticked
// and the beep is scheduled ahead on the audio clock rather than with a timer.
let ctx: AudioContext | null = null;
let pending: OscillatorNode[] = [];

export function beepSoon(secs: number) {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    cancelBeep();
    const t0 = ctx.currentTime + secs;
    for (const [off, freq] of [[0, 880], [0.25, 880], [0.5, 1320]] as const) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + off);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + off);
      o.stop(t0 + off + 0.2);
      pending.push(o);
    }
  } catch { /* audio unavailable: silent timer */ }
}

export function cancelBeep() {
  for (const o of pending) try { o.stop(); } catch { /* already stopped */ }
  pending = [];
}

/** Starts (or restarts) the rest timer and schedules its beep. */
export function startRest(secs: number) {
  if (secs <= 0) return;
  beepSoon(secs);
  void setRest({ endsAt: Date.now() + secs * 1000, total: secs });
}

export function RestBar() {
  const { rest } = useData();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!rest) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [rest]);

  useEffect(() => {
    // Clear an expired timer so it doesn't reappear.
    if (rest && rest.endsAt <= now) {
      navigator.vibrate?.(300);
      void setRest(null);
    }
  }, [now, rest]);

  if (!rest || rest.endsAt <= now) return null;
  const left = (rest.endsAt - now) / 1000;
  const skip = () => { cancelBeep(); void setRest(null); };
  const adjust = (d: number) => {
    const end = rest.endsAt + d * 1000;
    const secs = (end - Date.now()) / 1000;
    if (secs <= 0) { skip(); return; }
    beepSoon(secs);
    void setRest({ endsAt: end, total: Math.max(1, rest.total + d) });
  };
  return (
    <div className="rest-bar" role="timer">
      <div className="rest-fill" style={{ width: `${Math.min(100, (left / rest.total) * 100)}%` }} />
      <button className="rest-btn" onClick={() => adjust(-15)}>−15</button>
      <div className="rest-time">{clock(Math.ceil(left))}</div>
      <button className="rest-btn" onClick={() => adjust(15)}>+15</button>
      <button className="rest-btn skip" onClick={skip}>Skip</button>
    </div>
  );
}
