import type { Prefs } from '../types';

const LB = 2.20462262;

/** kg -> display unit. */
export const toW = (kg: number, p: Prefs) => (p.weightUnit === 'lbs' ? kg * LB : kg);
/** display unit -> kg. */
export const fromW = (v: number, p: Prefs) => (p.weightUnit === 'lbs' ? v / LB : v);
export const wUnit = (p: Prefs) => p.weightUnit;

export const toD = (m: number, p: Prefs) => (p.distanceUnit === 'miles' ? m / 1609.344 : m / 1000);
export const fromD = (v: number, p: Prefs) => (p.distanceUnit === 'miles' ? v * 1609.344 : v * 1000);
export const dUnit = (p: Prefs) => (p.distanceUnit === 'miles' ? 'mi' : 'km');

/** Trims trailing zeros: 62.5, 60, 0.25. */
export const num = (v: number, dp = 2) => {
  const r = Math.round(v * 10 ** dp) / 10 ** dp;
  return r.toLocaleString('en-US', { maximumFractionDigits: dp });
};

export const fmtWeight = (kg: number | null, p: Prefs) => (kg == null ? '' : `${num(toW(kg, p), 1)} ${wUnit(p)}`);
export const fmtVolume = (kg: number, p: Prefs) => `${Math.round(toW(kg, p)).toLocaleString('en-US')} ${wUnit(p)}`;

/** 1h 31m / 45m / 30s. Minutes are rounded to the nearest minute, matching Hevy. */
export function fmtDuration(sec: number) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  const mins = Math.round(sec / 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** 1:05:09 or 5:09 */
export function clock(sec: number) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function fmtDate(sec: number, withYear = true) {
  return new Date(sec * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

export function relDate(sec: number) {
  const d = new Date(sec * 1000), now = new Date();
  const day = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);
  const diff = day(now) - day(d);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  if (diff < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'long' })}, ${time}`;
  return fmtDate(sec, d.getFullYear() !== now.getFullYear());
}

export const MUSCLES = ['abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'cardio', 'chest', 'forearms', 'full_body', 'glutes', 'hamstrings', 'lats', 'lower_back', 'neck', 'quadriceps', 'shoulders', 'traps', 'triceps', 'upper_back', 'other'];
export const EQUIPMENT = ['none', 'barbell', 'dumbbell', 'kettlebell', 'machine', 'plate', 'resistance_band', 'suspension', 'other'];
export const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

export const PR_LABEL: Record<string, string> = {
  best_weight: 'Heaviest weight', best_1rm: 'Best 1RM', best_volume: 'Best set volume',
  best_reps: 'Most reps', best_duration: 'Longest time', best_distance: 'Longest distance',
};
