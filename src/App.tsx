import { useEffect, useState } from 'react';
import { useData } from './store';
import { go, useRoute, type Route } from './router';
import { clock } from './lib/format';
import { Home } from './screens/Home';
import { WorkoutDetail } from './screens/WorkoutDetail';
import { Logger } from './screens/Logger';
import { RoutineEditor, Routines } from './screens/Routines';
import { ExerciseDetail, Exercises } from './screens/Exercises';
import { Profile } from './screens/Profile';
import { Settings } from './screens/Settings';
import { Progress } from './screens/Progress';
import { Balance, Report } from './screens/Insights';
import { Body } from './screens/Body';
import { RestBar } from './components/RestTimer';
import { Icon } from './components/ui';

function screen(r: Route) {
  switch (r.name) {
    case 'home': return <Home />;
    case 'routines': return <Routines />;
    case 'exercises': return <Exercises />;
    case 'profile': return <Profile />;
    case 'settings': return <Settings />;
    case 'progress': return <Progress />;
    case 'balance': return <Balance />;
    case 'report': return <Report />;
    case 'body': return <Body />;
    case 'workout': return <WorkoutDetail id={r.id} />;
    case 'exercise': return <ExerciseDetail id={r.id} />;
    case 'routine': return <RoutineEditor id={r.id} />;
    case 'logger': return <Logger />;
  }
}

const TABS: { path: string; name: Route['name']; icon: string; label: string }[] = [
  { path: '/', name: 'home', icon: 'home', label: 'Home' },
  { path: '/routines', name: 'routines', icon: 'plus', label: 'Workout' },
  { path: '/exercises', name: 'exercises', icon: 'dumbbell', label: 'Exercises' },
  { path: '/profile', name: 'profile', icon: 'user', label: 'Profile' },
];

/** Bar above the tabs while a workout runs and the logger isn't open. */
function ActiveBar() {
  const { active } = useData();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!active) return null;
  return (
    <button className="active-bar" onClick={() => go('/logger')}>
      <span className="pulse" />
      <span className="grow">{active.name}</span>
      <b>{clock(now / 1000 - active.start)}</b>
      <Icon name="chevron" size={18} />
    </button>
  );
}

export function App() {
  const route = useRoute();
  const inLogger = route.name === 'logger';
  const tabFor = (r: Route) =>
    r.name === 'workout' ? 'home' : r.name === 'routine' ? 'routines' : r.name === 'exercise' ? 'exercises' : r.name === 'settings' || r.name === 'progress' || r.name === 'balance' || r.name === 'report' || r.name === 'body' ? 'profile' : r.name;
  const current = tabFor(route);
  return (
    <div className={'app' + (inLogger ? ' in-logger' : '')}>
      <main>{screen(route)}</main>
      <div className="bottom">
        <RestBar />
        {!inLogger && <ActiveBar />}
        {!inLogger && (
          <nav className="tabs">
            {TABS.map(t => (
              <button key={t.name} className={current === t.name ? 'on' : ''} onClick={() => go(t.path)}>
                <Icon name={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
