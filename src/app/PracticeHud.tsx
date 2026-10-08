import { useEffect } from 'react';
import { COVERAGE_INFO } from '../domain/play/coaching';
import { startRep } from './playControls';
import type { Session } from './session';
import { useUi } from './store';

/** Big guidance banner at the top of the screen (timing cue / read prompt). */
export function CueBanner() {
  const cue = useUi((s) => s.hud.cue);
  if (!cue) return null;
  return (
    <div className={`cue cue-${cue.tone}`}>
      <div className="cue-title">{cue.title}</div>
      {cue.detail && cue.detail.split('\n').map((l, i) => <div key={i} className="cue-detail">{l}</div>)}
    </div>
  );
}

/** Pass keys for the ball handler: which teammates are open. */
export function PassKeys() {
  const keys = useUi((s) => s.hud.passKeys);
  const mode = useUi((s) => s.mode);
  if (mode !== 'play' || !keys.length) return null;
  return (
    <div className="pass-keys">
      {keys.map((k) => (
        <span key={k.id} className={k.open ? 'open' : 'covered'}>
          <kbd>{k.slot}</kbd> {k.id}
        </span>
      ))}
    </div>
  );
}

const pctClass = (v: number | null) => (v === null ? '' : v >= 80 ? 'good' : v >= 55 ? 'ok' : 'bad');

/** End-of-rep card: outcome, revealed coverage and practice feedback (spec §36). */
export function RepResultCard({ session }: { session: Session }) {
  const result = useUi((s) => s.repResult);
  const playMode = useUi((s) => s.playMode);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && useUi.getState().repResult) startRep(session);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);
  if (!result) return null;
  const p = result.practice;
  const info = COVERAGE_INFO[result.coverage];
  const outcome = { make: 'Bucket!', miss: 'Missed', turnover: 'Turnover', done: 'Play complete' }[result.outcome];
  return (
    <div className="result-card">
      <div className={`result-outcome ${result.outcome === 'make' ? 'good' : result.outcome === 'done' ? '' : 'bad'}`}>{outcome}</div>
      <div className="result-coverage">
        Defense played <b>{info.label}</b>
        {result.branch ? <span className="muted"> → {result.branch.replace(/_/g, ' ')}</span> : null}
      </div>
      <div className="muted small">{info.looksLike}</div>
      {p && (
        <>
          <div className="scores">
            <Score label="Timing" value={p.scores.timing} />
            <Score label="Spacing" value={p.scores.spacing} />
            <Score label="Route" value={p.scores.route} />
            <div className="score">
              <div className="score-label">Decision</div>
              <div className={`score-value ${p.decision.correct === null ? '' : p.decision.correct ? 'good' : 'bad'}`}>
                {p.decision.correct === null ? '—' : p.decision.correct ? 'Correct' : 'Wrong'}
              </div>
            </div>
          </div>
          {p.notes.length > 0 && (
            <ul className="notes">
              {p.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {!p && <div className="notes muted">{info.read}</div>}
      <div className="buttons center">
        <button className="primary" onClick={() => startRep(session)}>
          {playMode === 'react' ? 'Next rep' : 'Run it again'} <kbd>Enter</kbd>
        </button>
      </div>
    </div>
  );
}

function Score({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="score">
      <div className="score-label">{label}</div>
      <div className={`score-value ${pctClass(value)}`}>{value === null ? '—' : `${value}%`}</div>
    </div>
  );
}
