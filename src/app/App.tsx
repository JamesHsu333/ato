import { useEffect, useState } from 'react';
import { initPhysics } from '../simulation/physics/rapier';
import { SimulationScene } from '../rendering/three/SimulationScene';
import { Hud } from './Hud';
import { Session } from './session';
import { useUi } from './store';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mode = useUi((s) => s.mode);

  useEffect(() => {
    let s: Session | null = null;
    let cancelled = false;
    initPhysics()
      .then(() => {
        if (cancelled) return;
        s = new Session();
        setSession(s);
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      cancelled = true;
      s?.dispose();
    };
  }, []);

  if (error) return <div className="loading">Failed to start physics: {error}</div>;
  if (!session) return <div className="loading">Loading physics…</div>;
  return (
    <div className="app">
      <div className={`stage ${mode === 'designer' ? 'stage-designer' : ''}`}>
        <SimulationScene session={session} />
      </div>
      <Hud session={session} />
    </div>
  );
}
