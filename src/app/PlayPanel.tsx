import { useRef, useState } from 'react';
import { COVERAGE_INFO } from '../domain/play/coaching';
import type { CoverageName } from '../domain/play/schema/playDefinition';
import { SAMPLE_PLAYS } from '../samples';
import type { Assists } from '../rendering/three/PlayOverlay';
import { exportPlay, loadPlayText, playCoverages, startRep } from './playControls';
import type { Session } from './session';
import { toast, useUi, type PlayMode } from './store';

const MODES: { id: PlayMode; label: string; hint: string }[] = [
  { id: 'watch', label: 'Watch', hint: 'Everyone is AI. Pick a coverage and watch the play adapt.' },
  { id: 'practice', label: 'Practice', hint: 'You play one role with guidance. Coverage is known.' },
  { id: 'react', label: 'Read & React', hint: 'The defense picks a coverage. Read it and make the right play.' },
];

const ASSISTS: { key: keyof Assists; label: string }[] = [
  { key: 'ghostRoute', label: 'Ghost route' },
  { key: 'targetSpot', label: 'Target spot' },
  { key: 'screenCue', label: 'Screen cue' },
  { key: 'timingCue', label: 'Timing cue' },
  { key: 'passingWindow', label: 'Passing window' },
  { key: 'readHint', label: 'Defensive read hint' },
];

export function PlayPanel({ session }: { session: Session }) {
  const playText = useUi((s) => s.playText);
  const issues = useUi((s) => s.playIssues);
  const coverage = useUi((s) => s.coverage);
  const playMode = useUi((s) => s.playMode);
  const playControl = useUi((s) => s.playControl);
  const assists = useUi((s) => s.assists);
  const paused = useUi((s) => s.paused);
  const hud = useUi((s) => s.hud);
  const set = useUi((s) => s.set);
  const fileInput = useRef<HTMLInputElement>(null);
  const [inspect, setInspect] = useState(false);
  const play = session.play;
  const currentSample = SAMPLE_PLAYS.find((p) => p.yaml === playText)?.id ?? '';
  const coverages = play ? playCoverages(play) : [];

  const onFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const text = await f.text();
    if (loadPlayText(session, text)) toast(`Loaded ${f.name}`);
    else toast(`${f.name} is not a valid play`);
    if (fileInput.current) fileInput.current.value = '';
  };

  const restartWith = (patch: Parameters<typeof set>[0]) => {
    set(patch);
    startRep(session);
  };

  return (
    <section>
      <h2>Play</h2>
      <label>
        Library
        <select
          value={currentSample}
          onChange={(e) => {
            const sample = SAMPLE_PLAYS.find((p) => p.id === e.target.value);
            if (sample) loadPlayText(session, sample.yaml);
          }}
        >
          {!currentSample && <option value="">{play ? play.name : '—'}</option>}
          {SAMPLE_PLAYS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="buttons">
        <button onClick={() => fileInput.current?.click()}>Import…</button>
        <button disabled={!play} onClick={() => exportPlay(session, 'yaml')}>
          Export YAML
        </button>
        <button disabled={!play} onClick={() => exportPlay(session, 'json')}>
          JSON
        </button>
      </div>
      <input ref={fileInput} type="file" accept=".yaml,.yml,.json" hidden onChange={(e) => onFile(e.target.files)} />
      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((i, k) => (
            <li key={k}>
              <code>{i.path || '(root)'}</code> {i.message}
            </li>
          ))}
        </ul>
      )}
      {play && (
        <>
          <div className="tabs modes">
            {MODES.map((m) => (
              <button key={m.id} className={playMode === m.id ? 'on' : ''} title={m.hint} onClick={() => restartWith({ playMode: m.id })}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="muted small">{MODES.find((m) => m.id === playMode)!.hint}</div>
          {playMode !== 'watch' && (
            <label>
              You play
              <select value={playControl ?? ''} onChange={(e) => restartWith({ playControl: e.target.value })}>
                {play.actors
                  .filter((a) => a.team === 'offense')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                      {a.role ? ` · ${a.role.replace(/_/g, ' ')}` : ''}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {coverages.length > 0 && (
            <label>
              Defense
              {playMode === 'react' ? (
                <span className="muted">{hud.playComplete || useUi.getState().repResult ? COVERAGE_INFO[session.sim.coverage].label : 'hidden — read it'}</span>
              ) : (
                <select value={coverage} onChange={(e) => restartWith({ coverage: e.target.value as CoverageName })}>
                  {coverages.map((c) => (
                    <option key={c} value={c}>
                      {COVERAGE_INFO[c].label}
                    </option>
                  ))}
                </select>
              )}
            </label>
          )}
          {playMode !== 'watch' && (
            <details className="assists">
              <summary>Assists</summary>
              {ASSISTS.map((a) => (
                <label key={a.key} className="check">
                  <input type="checkbox" checked={assists[a.key]} onChange={(e) => set({ assists: { ...assists, [a.key]: e.target.checked } })} />
                  {a.label}
                </label>
              ))}
            </details>
          )}
          <div className="buttons">
            <button className="primary" onClick={() => startRep(session)}>
              ↺ {playMode === 'react' ? 'New rep' : 'Restart'}
            </button>
            <button onClick={() => set({ paused: !paused })}>{paused ? '▶ Resume' : '❚❚ Pause'}</button>
            <span className="muted clock">{hud.simTime.toFixed(1)} s</span>
          </div>
          <button className="link" onClick={() => setInspect(!inspect)}>
            {inspect ? '▾' : '▸'} Inspector (graph & events)
          </button>
          {inspect && (
            <>
              <div className="nodes">
                {Object.keys(play.nodes).map((id) => (
                  <span
                    key={id}
                    className={`node ${hud.playNode === id ? (hud.playComplete ? 'done' : 'current') : hud.visited.includes(id) ? 'visited' : ''}`}
                  >
                    {id}
                  </span>
                ))}
              </div>
              <EventLog />
            </>
          )}
        </>
      )}
    </section>
  );
}

function EventLog() {
  const log = useUi((s) => s.eventLog);
  return (
    <div className="event-log">
      {log.length === 0 && <div className="muted">—</div>}
      {[...log].reverse().map((e) => (
        <div key={e.id} className={/illegal|missed|turnover|early/.test(e.name) ? 'bad' : /complete|made|connected/.test(e.name) ? 'good' : ''}>
          <span className="muted">{e.t.toFixed(2)}</span> {e.name}
        </div>
      ))}
    </div>
  );
}
