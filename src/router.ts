// Tiny hash router: `#/workout/<id>` etc. Hash routes keep iOS swipe-back and survive static hosting.
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'routines' }
  | { name: 'exercises' }
  | { name: 'profile' }
  | { name: 'settings' }
  | { name: 'progress' }
  | { name: 'balance' }
  | { name: 'report' }
  | { name: 'body' }
  | { name: 'workout'; id: string }
  | { name: 'editWorkout'; id: string }
  | { name: 'exercise'; id: string }
  | { name: 'routine'; id: string }
  | { name: 'logger' };

export function parse(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('/');
  switch (a) {
    case 'routines': return { name: 'routines' };
    case 'exercises': return { name: 'exercises' };
    case 'profile': return { name: 'profile' };
    case 'settings': return { name: 'settings' };
    case 'progress': return { name: 'progress' };
    case 'balance': return { name: 'balance' };
    case 'report': return { name: 'report' };
    case 'body': return { name: 'body' };
    case 'workout': return b ? { name: 'workout', id: b } : { name: 'home' };
    case 'edit': return b ? { name: 'editWorkout', id: b } : { name: 'home' };
    case 'exercise': return b ? { name: 'exercise', id: b } : { name: 'exercises' };
    case 'routine': return b ? { name: 'routine', id: b } : { name: 'routines' };
    case 'logger': return { name: 'logger' };
    default: return { name: 'home' };
  }
}

export const go = (path: string) => { location.hash = path; };
export const back = (fallback = '/') => {
  if (history.length > 1) history.back();
  else go(fallback);
};

export function useRoute(): Route {
  const [r, setR] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => { setR(parse(location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
