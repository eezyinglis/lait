import Dexie, { type EntityTable } from 'dexie';
import type { ActiveWorkout, BodyEntry, Exercise, Experiment, Gym, Machine, Photo, Prefs, RestState, Routine, Workout } from './types';
import { DEFAULT_PREFS } from './types';
import library from './data/library.json';

interface KV {
  key: string;
  value: unknown;
}

export const db = new Dexie('lait') as Dexie & {
  exercises: EntityTable<Exercise, 'id'>;
  workouts: EntityTable<Workout, 'id'>;
  routines: EntityTable<Routine, 'id'>;
  kv: EntityTable<KV, 'key'>;
  gyms: EntityTable<Gym, 'id'>;
  machines: EntityTable<Machine, 'id'>;
  body: EntityTable<BodyEntry, 'id'>;
  photos: EntityTable<Photo, 'id'>;
  experiments: EntityTable<Experiment, 'id'>;
};

db.version(1).stores({
  exercises: 'id, title',
  workouts: 'id, start',
  routines: 'id, order',
  kv: 'key',
});
// v2 adds tables only; existing data is untouched.
db.version(2).stores({
  gyms: 'id, order',
  machines: 'id, gymId, exId',
  body: 'id, date',
  photos: 'id, date',
  experiments: 'id, exId, started',
});

export const machineId = (gymId: string, exId: string) => `${gymId}|${exId}`;

export async function getCurrentGym(): Promise<string | null> {
  return ((await db.kv.get('currentGym'))?.value as string) ?? null;
}
export const setCurrentGym = (id: string | null) =>
  id ? db.kv.put({ key: 'currentGym', value: id }) : db.kv.delete('currentGym');

/** Seeds the built-in exercise library on first run (and adds new library entries later without touching customs). */
export async function ensureLibrary() {
  const count = await db.exercises.count();
  if (count >= library.length) return;
  const existing = new Set(await db.exercises.toCollection().primaryKeys());
  const missing = (library as Omit<Exercise, 'custom'>[])
    .filter(e => !existing.has(e.id))
    .map(e => ({ ...e, custom: false }) as Exercise);
  await db.exercises.bulkPut(missing);
}

export async function getPrefs(): Promise<Prefs> {
  const row = await db.kv.get('prefs');
  return { ...DEFAULT_PREFS, ...((row?.value as Partial<Prefs>) ?? {}) };
}

export async function setPrefs(patch: Partial<Prefs>) {
  await db.kv.put({ key: 'prefs', value: { ...(await getPrefs()), ...patch } });
}

export async function getActive(): Promise<ActiveWorkout | null> {
  return ((await db.kv.get('active'))?.value as ActiveWorkout) ?? null;
}

export async function setActive(a: ActiveWorkout | null) {
  if (a) await db.kv.put({ key: 'active', value: a });
  else await db.kv.bulkDelete(['active', 'rest']);
}

export async function setRest(r: RestState | null) {
  if (r) await db.kv.put({ key: 'rest', value: r });
  else await db.kv.delete('rest');
}

export const uid = () => crypto.randomUUID();
export const nowSec = () => Math.floor(Date.now() / 1000);
