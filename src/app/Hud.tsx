import { AppearancePicker } from './AppearancePicker';
import { CAMERA_BEHAVIORS, CAMERA_PRESETS, type CameraBehavior, type CameraPreset } from '../rendering/cameras/cameraRig';
import type { Session } from './session';
import { toast, useUi } from './store';
import { PlayPanel } from './PlayPanel';
import { CueBanner, PassKeys, RepResultCard } from './PracticeHud';
import { DesignerDock, DesignerInspector, DesignerPanel, useDesignerShortcuts } from './designer/DesignerUI';
import { openInDesigner } from './designer/designerController';
import { parsePlayText } from '../domain/play/schema/validate';
import { loadPlayText } from './playControls';
import { SAMPLE_PLAYS } from '../samples';


function ModeTabs({ session }: { session: Session }) {
  const mode = useUi((s) => s.mode);
  const set = useUi((s) => s.set);
  return (
    <div className="tabs">
      <button
        className={mode === 'sandbox' ? 'on' : ''}
        onClick={() => {
          if (mode === 'sandbox') return;
          session.loadSandbox();
          set({ mode: 'sandbox', paused: false, lastShot: null, repResult: null });
        }}
      >
        Sandbox
      </button>
      <button
        className={mode === 'play' ? 'on' : ''}
        onClick={() => {
          if (mode === 'play') return;
          const { playText } = useUi.getState();
          loadPlayText(session, playText ?? SAMPLE_PLAYS[0].yaml);
        }}
      >
        Play
      </button>
      <button
        className={mode === 'designer' ? 'on' : ''}
        onClick={() => {
          if (mode === 'designer') return;
          const r = parsePlayText(useUi.getState().playText ?? SAMPLE_PLAYS[0].yaml);
          if (!r.ok) return;
          set({ cameraPreset: 'top-down', cameraBehavior: 'static' });
          openInDesigner(session, r.play);
        }}
      >
        Designer
      </button>
    </div>
  );
}

export function Hud({ session }: { session: Session }) {
  const mode = useUi((s) => s.mode);
  useDesignerShortcuts(session);
  if (mode === 'designer') {
    return (
      <>
        <div className="panel panel-left designer">
          <h1>ATO <span>tactics sandbox</span></h1>
          <ModeTabs session={session} />
          <DesignerPanel session={session} />
          <CameraPanel />
        </div>
        <DesignerInspector session={session} />
        <DesignerDock session={session} />
        <Toasts />
      </>
    );
  }
  return (
    <>
      <div className="panel panel-left">
        <h1>ATO <span>tactics sandbox</span></h1>
        <ModeTabs session={session} />
        {mode === 'play' && <PlayPanel session={session} />}
        <PlayerPanel session={session} />
        <CameraPanel />
        <SimPanel session={session} />
      </div>
      <ShotMeter />
      <CueBanner />
      <ShotFeedbackBanner />
      <PassKeys />
      <RepResultCard session={session} />
      <Scoreboard />
      <Toasts />
      <ControlsHelp />
    </>
  );
}

function PlayerPanel({ session }: { session: Session }) {
  const hud = useUi((s) => s.hud);
  const id = hud.controlledId;
  const ctrl = id ? session.sim.character(id) : undefined;
  if (!ctrl || !id) return null;
  const def = ctrl.definition;
  return (
    <section>
      <h2>Controlling</h2>
      <div className="row strong">
        {def.name} {hud.holderId === id ? <span className="tag">ball</span> : null}
      </div>
      <div className="row muted">
        {def.dimensions.height.toFixed(2)} m · speed {def.attributes.physical.speed} · 3PT {def.attributes.offense.three_point}
      </div>
      <AppearancePicker actorId={id} definition={def} />
    </section>
  );
}

function CameraPanel() {
  const preset = useUi((s) => s.cameraPreset);
  const behavior = useUi((s) => s.cameraBehavior);
  const set = useUi((s) => s.set);
  return (
    <section>
      <h2>Camera</h2>
      <div className="buttons">
        {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((p) => (
          <button key={p} className={p === preset ? 'on' : ''} onClick={() => set({ cameraPreset: p })}>
            {CAMERA_PRESETS[p].label}
          </button>
        ))}
      </div>
      <div className="buttons">
        {(Object.keys(CAMERA_BEHAVIORS) as CameraBehavior[]).map((b) => (
          <button key={b} className={b === behavior ? 'on' : ''} onClick={() => set({ cameraBehavior: b })}>
            {CAMERA_BEHAVIORS[b].label}
          </button>
        ))}
      </div>
    </section>
  );
}

function SimPanel({ session }: { session: Session }) {
  const mode = useUi((s) => s.mode);
  const collisionMode = useUi((s) => s.collisionMode);
  const shotOutcome = useUi((s) => s.shotOutcome);
  const mouseFacing = useUi((s) => s.mouseFacing);
  const set = useUi((s) => s.set);
  const outcome = shotOutcome.mode === 'simulated' ? 'simulated' : shotOutcome.result;
  return (
    <section>
      <h2>Simulation</h2>
      <label>
        Collision
        <select value={collisionMode} onChange={(e) => set({ collisionMode: e.target.value as 'soft' | 'hard' })}>
          <option value="hard">Hard (practice)</option>
          <option value="soft">Soft (designer)</option>
        </select>
      </label>
      {mode === 'sandbox' && <label>
        Shot outcome
        <select
          value={outcome}
          onChange={(e) => {
            const v = e.target.value;
            set({ shotOutcome: v === 'simulated' ? { mode: 'simulated' } : { mode: 'forced', result: v as 'make' | 'miss' } });
          }}
        >
          <option value="simulated">Simulated</option>
          <option value="make">Forced make</option>
          <option value="miss">Forced miss</option>
        </select>
      </label>}
      <label className="check">
        <input type="checkbox" checked={mouseFacing} onChange={(e) => set({ mouseFacing: e.target.checked })} />
        Mouse facing
      </label>
      {mode === 'sandbox' && <div className="buttons">
        <button
          onClick={() => {
            session.reset();
            set({ lastShot: null });
            toast('Reset to opening snapshot');
          }}
        >
          Reset
        </button>
      </div>}
    </section>
  );
}

function ShotMeter() {
  const meter = useUi((s) => s.hud.shotMeter);
  if (!meter) return null;
  return (
    <div className="meter">
      <div className="meter-fill" style={{ height: `${Math.min(1, meter.progress) * 100}%` }} />
      <div className="meter-ideal" style={{ bottom: `${meter.ideal * 100}%` }} />
    </div>
  );
}

const TIMING_CLASS: Record<string, string> = {
  EXCELLENT: 'good',
  'SLIGHTLY EARLY': 'ok',
  'SLIGHTLY LATE': 'ok',
  EARLY: 'bad',
  LATE: 'bad',
};

function ShotFeedbackBanner() {
  const shot = useUi((s) => s.lastShot);
  if (!shot) return null;
  return (
    <div className="shot-banner" key={shot.id}>
      <div className={`timing ${TIMING_CLASS[shot.timing]}`}>{shot.timing}</div>
      <div className="details">
        {(shot.probability * 100).toFixed(0)}% · {shot.distance.toFixed(1)} m {shot.three ? '· 3PT' : ''}
        {shot.contest > 0.15 ? ` · ${shot.contest > 0.6 ? 'heavily ' : ''}contested` : ' · open'}
      </div>
      <div className={`result ${shot.result}`}>{shot.result === 'pending' ? '…' : shot.result === 'make' ? 'MAKE' : 'MISS'}</div>
    </div>
  );
}

function Scoreboard() {
  const stats = useUi((s) => s.hud.stats);
  return (
    <div className="scoreboard">
      <div>
        <b>{stats.points}</b> PTS
      </div>
      <div>
        {stats.makes}/{stats.attempts} FG
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

function ControlsHelp() {
  return (
    <div className="panel panel-help">
      <div><kbd>WASD</kbd> move · <kbd>Shift</kbd> sprint</div>
      <div><kbd>Mouse</kbd> facing</div>
      <div><kbd>Hold Space</kbd> jump · release at the top to shoot</div>
      <div><kbd>1</kbd>–<kbd>4</kbd> pass · <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>4</kbd> lob</div>
      <div><kbd>Tab</kbd> switch player · <kbd>R</kbd> get ball</div>
    </div>
  );
}
