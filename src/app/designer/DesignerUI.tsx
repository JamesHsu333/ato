import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILTIN_CHARACTERS } from '../../domain/characters/builtins';
import { SEMANTIC_SPOTS } from '../../domain/court/spots';
import type { ActionDef, PlayDefinition, PositionDef, TargetDef } from '../../domain/play/schema/playDefinition';
import { serializePlay } from '../../domain/play/schema/validate';
import {
  addActor,
  addNodeAfter,
  emptyPlay,
  giveBallTo,
  removeAction,
  removeActor,
  renamePlay,
  updateAction,
  updateActor,
} from '../../domain/play/edit/edits';
import { SAMPLE_PLAYS } from '../../samples';
import type { Session } from '../session';
import { toast, useUi } from '../store';
import { exportPlay, loadPlayText } from '../playControls';
import {
  applyEdit,
  applyYaml,
  deleteSaved,
  duplicateCurrent,
  openInDesigner,
  openSaved,
  redo,
  setTime,
  togglePlay,
  undo,
} from './designerController';
import { useDesigner } from './designerStore';
import { AppearancePicker } from '../AppearancePicker';
import { parsePlayText } from '../../domain/play/schema/validate';

const SPOTS = Object.keys(SEMANTIC_SPOTS);

const posLabel = (p: PositionDef | TargetDef | undefined): string =>
  p === undefined ? '—' : typeof p === 'string' ? p : 'x' in p ? `(${p.x}, ${p.z})` : 'spot' in p ? `${p.spot}+` : `near ${p.relative_to}`;

/** Left panel: library, palette, play metadata. */
export function DesignerPanel({ session }: { session: Session }) {
  const play = useDesigner((s) => s.play);
  const library = useDesigner((s) => s.library);
  const savedAt = useDesigner((s) => s.savedAt);
  const past = useDesigner((s) => s.past.length);
  const future = useDesigner((s) => s.future.length);
  const [character, setCharacter] = useState('generic_wing');
  const fileInput = useRef<HTMLInputElement>(null);
  if (!play) return null;
  const onImport = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const r = parsePlayText(await f.text());
    if (r.ok) {
      openInDesigner(session, r.play);
      toast(`Imported ${f.name}`);
    } else {
      useDesigner.setState({ issues: r.errors });
      toast(`${f.name} is not a valid play`);
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const add = (team: 'offense' | 'defense') => {
    const { play: next, id } = addActor(play, team, team === 'defense' && character === 'generic_wing' ? 'generic_defender' : character, team === 'offense' ? { x: 0, z: 9 } : { x: 0, z: 3 });
    if (!id) return toast(`A team has at most 5 players`);
    if (applyEdit(session, next)) useDesigner.setState({ selectedActor: id, selectedAction: null });
  };

  return (
    <section>
      <h2>Designer</h2>
      <label>
        Name
        <input className="text" value={play.play.name} onChange={(e) => applyEdit(session, renamePlay(play, e.target.value), { keepTime: true })} />
      </label>
      <div className="buttons">
        <button disabled={!past} onClick={() => undo(session)} title="Cmd/Ctrl-Z">
          ↶ Undo
        </button>
        <button disabled={!future} onClick={() => redo(session)} title="Cmd/Ctrl-Shift-Z">
          ↷ Redo
        </button>
        <button onClick={() => duplicateCurrent(session)}>Duplicate</button>
        <button
          onClick={() => {
            if (loadPlayText(session, serializePlay(play, 'yaml'))) useUi.setState({ playMode: 'practice' });
          }}
        >
          Practice it ▶
        </button>
      </div>
      <div className="muted small">{savedAt ? `Autosaved ${new Date(savedAt).toLocaleTimeString()}` : 'Edits autosave to this browser.'}</div>

      <h3>Add player</h3>
      <div className="buttons">
        <select value={character} onChange={(e) => setCharacter(e.target.value)}>
          {Object.values(BUILTIN_CHARACTERS).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button onClick={() => add('offense')}>+ Offense</button>
        <button onClick={() => add('defense')}>+ Defense</button>
      </div>

      <h3>Library</h3>
      <div className="library">
        {SAMPLE_PLAYS.map((s) => (
          <div key={s.id} className="lib-row">
            <span>{s.name}</span>
            <button
              onClick={() => {
                const r = parsePlayText(s.yaml);
                if (r.ok) openInDesigner(session, r.play);
              }}
            >
              Open
            </button>
          </div>
        ))}
        {library.map((p) => (
          <div key={p.id} className={`lib-row ${p.id === play.play.id ? 'current' : ''}`}>
            <span title={p.id}>{p.name}</span>
            <button onClick={() => openSaved(session, p.yaml)}>Open</button>
            <button onClick={() => void deleteSaved(p.id)} title="Delete">
              ✕
            </button>
          </div>
        ))}
        <div className="buttons">
          <button onClick={() => openInDesigner(session, emptyPlay(`play-${Date.now().toString(36)}`))}>+ New play</button>
          <button onClick={() => fileInput.current?.click()}>Import…</button>
          <button onClick={() => exportPlay(session, 'yaml')}>Export YAML</button>
          <button onClick={() => exportPlay(session, 'json')}>JSON</button>
        </div>
      </div>
      <input ref={fileInput} type="file" accept=".yaml,.yml,.json" hidden data-testid="designer-import" onChange={(e) => void onImport(e.target.files)} />
      <div className="muted small help">
        Drag a player to move his start · <b>Shift</b>-drag: new move · <b>Option</b>-drag: curved route · drag ● waypoints · double-click route: add waypoint ·
        <b> Alt</b>-click waypoint: delete
      </div>
    </section>
  );
}

/** Right panel: inspector for the selected player and his actions. */
export function DesignerInspector({ session }: { session: Session }) {
  const play = useDesigner((s) => s.play);
  const selectedActor = useDesigner((s) => s.selectedActor);
  const selectedAction = useDesigner((s) => s.selectedAction);
  const selectedNode = useDesigner((s) => s.selectedNode);
  const issues = useDesigner((s) => s.issues);
  const warnings = useDesigner((s) => s.warnings);
  if (!play) return null;
  const edit = (next: PlayDefinition) => applyEdit(session, next, { keepTime: true });
  const actor = selectedActor ? play.actors[selectedActor] : undefined;
  const actorIds = Object.keys(play.actors);
  const nodes = Object.keys(play.graph);

  return (
    <div className="panel panel-right">
      <h2>Inspector</h2>
      <label>
        New moves go to
        <select value={selectedNode} onChange={(e) => useDesigner.setState({ selectedNode: e.target.value })}>
          {nodes.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <div className="buttons">
        <button
          onClick={() => {
            const { play: next, id } = addNodeAfter(play, selectedNode);
            if (edit(next)) useDesigner.setState({ selectedNode: id });
          }}
        >
          + Step after “{selectedNode}”
        </button>
      </div>

      {(issues.length > 0 || warnings.length > 0) && (
        <ul className="issues">
          {[...issues, ...warnings].map((i, k) => (
            <li key={k} className={k >= issues.length ? 'warn' : ''}>
              <code>{i.path || '(root)'}</code> {i.message}
            </li>
          ))}
        </ul>
      )}

      {!actor && <div className="muted small">Select a player on the court.</div>}
      {actor && selectedActor && (
        <>
          <h3>
            {selectedActor} <span className="muted">· {actor.team}</span>
          </h3>
          <label>
            Character
            <select value={actor.character} onChange={(e) => edit(updateActor(play, selectedActor, { character: e.target.value }))}>
              {Object.values(BUILTIN_CHARACTERS).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {actor.team === 'offense' ? (
            <label>
              Role
              <input className="text" value={actor.role ?? ''} onChange={(e) => edit(updateActor(play, selectedActor, { role: e.target.value || undefined }))} />
            </label>
          ) : (
            <label>
              Guards
              <select value={actor.assignment ?? ''} onChange={(e) => edit(updateActor(play, selectedActor, { assignment: e.target.value || undefined }))}>
                <option value="">— (zone/help)</option>
                {actorIds
                  .filter((id) => play.actors[id].team === 'offense')
                  .map((id) => (
                    <option key={id}>{id}</option>
                  ))}
              </select>
            </label>
          )}
          <AppearancePicker actorId={selectedActor} definition={BUILTIN_CHARACTERS[actor.character]} />
          <div className="row muted small">Start: {posLabel(play.setup[selectedActor]?.position ?? (play.setup[selectedActor]?.relative_to ? { relative_to: play.setup[selectedActor].relative_to! } : undefined))}</div>
          <div className="buttons">
            {actor.team === 'offense' && play.setup[selectedActor]?.possession !== 'ball' && <button onClick={() => edit(giveBallTo(play, selectedActor))}>Give ball</button>}
            <button
              className="danger"
              onClick={() => {
                if (edit(removeActor(play, selectedActor))) useDesigner.setState({ selectedActor: null, selectedAction: null });
              }}
            >
              Remove player
            </button>
          </div>

          <h3>Actions</h3>
          {nodes.flatMap((node) =>
            (play.graph[node].actions ?? []).map((a, index) =>
              a.actor !== selectedActor ? null : (
                <ActionEditor
                  key={`${node}-${index}`}
                  play={play}
                  node={node}
                  index={index}
                  action={a}
                  selected={selectedAction?.node === node && selectedAction.index === index}
                  onEdit={edit}
                />
              ),
            ),
          )}
          <div className="muted small">Shift-drag from the player to add a move to “{selectedNode}”.</div>
        </>
      )}
    </div>
  );
}

function ActionEditor(props: { play: PlayDefinition; node: string; index: number; action: ActionDef; selected: boolean; onEdit: (p: PlayDefinition) => boolean }) {
  const { play, node, index, action: a, selected, onEdit } = props;
  const patch = (p: Partial<ActionDef>) => onEdit(updateAction(play, node, index, p));
  const teammates = Object.keys(play.actors).filter((id) => play.actors[id].team === play.actors[a.actor].team && id !== a.actor);
  const opponents = Object.keys(play.actors).filter((id) => play.actors[id].team !== play.actors[a.actor].team);
  const needsTo = ['move', 'roll', 'pop', 'drive'].includes(a.action);
  return (
    <div className={`action ${selected ? 'selected' : ''}`} onClick={() => useDesigner.setState({ selectedAction: { node, index } })}>
      <div className="action-head">
        <span className="node-chip">{node}</span>
        <select value={a.action} onChange={(e) => patch({ action: e.target.value as ActionDef['action'] })}>
          {['move', 'drive', 'roll', 'pop', 'screen', 'pass', 'shoot', 'wait'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button className="danger" title="Delete action" onClick={(e) => (e.stopPropagation(), onEdit(removeAction(play, node, index)))}>
          ✕
        </button>
      </div>
      {needsTo && (
        <label>
          To
          <select
            value={typeof a.to === 'string' && SPOTS.includes(a.to) ? a.to : ''}
            onChange={(e) => e.target.value && patch({ to: e.target.value as TargetDef })}
          >
            <option value="">{posLabel(a.to)}</option>
            {SPOTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {(a.action === 'pass' || a.action === 'screen') && (
        <label>
          {a.action === 'pass' ? 'To' : 'Screen on'}
          <select value={a.target ?? ''} onChange={(e) => patch({ target: e.target.value })}>
            <option value="" disabled>
              —
            </option>
            {(a.action === 'pass' ? teammates : opponents).map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
      )}
      {a.action !== 'wait' && a.action !== 'pass' && a.action !== 'shoot' && (
        <label>
          Speed
          <select value={a.speed ?? 'run'} onChange={(e) => patch({ speed: e.target.value as ActionDef['speed'] })}>
            {['walk', 'jog', 'run', 'sprint'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        Start when
        <input
          className="text"
          placeholder="immediately (event name)"
          defaultValue={typeof a.when === 'string' ? a.when : a.when && 'event' in a.when ? a.when.event : ''}
          onBlur={(e) => patch({ when: e.target.value.trim() ? { event: e.target.value.trim() } : undefined })}
        />
      </label>
      {a.path?.mode === 'override' && (
        <button className="link" onClick={() => patch({ path: undefined })}>
          Reset route to default
        </button>
      )}
    </div>
  );
}

const SEG_COLOR: Record<string, string> = {
  screen: '#ff8a3d',
  roll: '#b07cff',
  pop: '#b07cff',
  drive: '#3ddc84',
  move: '#4d9dff',
  pass: '#2bc4c4',
  shoot: '#ef6461',
  defend: 'rgba(255,90,77,0.25)',
};

/** Bottom dock: timeline (spec §29) and YAML editor. */
export function DesignerDock({ session }: { session: Session }) {
  const [showYaml, setShowYaml] = useState(true);
  return (
    <div className="dock">
      <Timeline session={session} />
      <div className="dock-yaml-head">
        <button className="link" onClick={() => setShowYaml(!showYaml)}>
          {showYaml ? '▾' : '▸'} YAML
        </button>
      </div>
      {showYaml && <YamlEditor session={session} />}
    </div>
  );
}

function Timeline({ session }: { session: Session }) {
  const rec = useDesigner((s) => s.recording);
  const time = useDesigner((s) => s.time);
  const playing = useDesigner((s) => s.playing);
  const play = useDesigner((s) => s.play);
  const track = useRef<HTMLDivElement>(null);
  const actors = useMemo(() => (play ? Object.keys(play.actors).sort((a, b) => (play.actors[a].team === play.actors[b].team ? 0 : play.actors[a].team === 'offense' ? -1 : 1)) : []), [play]);
  if (!rec || !play) return null;
  const dur = Math.max(rec.duration, 1);
  const pct = (t: number) => `${(t / dur) * 100}%`;
  const seekAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    setTime(session, ((clientX - r.left) / r.width) * dur);
  };
  const keyEvents = rec.events.filter((e) => /screen\.set|clears_screen|\.shot$|\.passed$|caught$|shot\.made|shot\.missed/.test(e.name));

  return (
    <div className="timeline">
      <div className="transport">
        <button onClick={() => setTime(session, 0)} title="Back to start">
          ⏮
        </button>
        <button className="primary" onClick={() => togglePlay(session)} title="Play / pause">
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="clock">
          {time.toFixed(2)} / {rec.duration.toFixed(1)} s
        </span>
        <span className="muted small">Timeline is a view of the event graph run — edits re-simulate instantly.</span>
      </div>
      <div className="tl-grid">
        <div className="tl-labels">
          <div className="tl-label">nodes</div>
          {actors.map((a) => (
            <div key={a} className={`tl-label ${play.actors[a].team}`} onClick={() => useDesigner.setState({ selectedActor: a, selectedAction: null })}>
              {a}
            </div>
          ))}
        </div>
        <div
          className="tl-track"
          ref={track}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            seekAt(e.clientX);
          }}
          onPointerMove={(e) => e.buttons === 1 && seekAt(e.clientX)}
        >
          <div className="tl-row">
            {rec.nodes.map((n, i) => (
              <div key={i} className="tl-node" style={{ left: pct(n.t), width: pct((rec.nodes[i + 1]?.t ?? rec.duration) - n.t) }} title={n.node}>
                {n.node}
              </div>
            ))}
            {keyEvents.map((e, i) => (
              <div key={`e${i}`} className="tl-event" style={{ left: pct(e.t) }} title={`${e.t.toFixed(2)}s ${e.name}`} />
            ))}
          </div>
          {actors.map((a) => (
            <div key={a} className="tl-row">
              {rec.segments
                .filter((s) => s.actor === a)
                .map((s, i) => {
                  const base = s.label.startsWith('wait') ? 'wait' : s.label;
                  return (
                    <div
                      key={i}
                      className={`tl-seg ${base === 'wait' ? 'waiting' : ''}`}
                      style={{ left: pct(s.start), width: pct(Math.max(0.05, s.end - s.start)), background: base === 'wait' ? undefined : SEG_COLOR[base] ?? '#8892a6' }}
                      title={`${s.label} (${s.node}) ${s.start.toFixed(2)}–${s.end.toFixed(2)}s`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const idx = (play.graph[s.node]?.actions ?? []).findIndex((x) => x.actor === a);
                        useDesigner.setState({ selectedActor: a, selectedAction: idx >= 0 ? { node: s.node, index: idx } : null, selectedNode: s.node || 'start' });
                        setTime(session, s.start);
                      }}
                    >
                      {s.label}
                    </div>
                  );
                })}
            </div>
          ))}
          <div className="tl-playhead" style={{ left: pct(time) }} />
        </div>
      </div>
    </div>
  );
}

function YamlEditor({ session }: { session: Session }) {
  const play = useDesigner((s) => s.play);
  const dirty = useDesigner((s) => s.yamlDirty);
  const issues = useDesigner((s) => s.issues);
  const [text, setText] = useState('');
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (play && !focused.current) setText(serializePlay(play, 'yaml'));
  }, [play]);

  return (
    <div className="yaml">
      <textarea
        spellCheck={false}
        value={text}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          if (play && !useDesigner.getState().yamlDirty) setText(serializePlay(useDesigner.getState().play!, 'yaml'));
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => applyYaml(session, v), 600);
        }}
      />
      <div className={`yaml-status ${dirty || issues.length ? 'bad' : 'good'}`}>
        {dirty || issues.length ? `✕ ${issues[0]?.path ?? ''} ${issues[0]?.message ?? 'invalid'}` : '✓ valid — applied'}
      </div>
    </div>
  );
}

/** Designer keyboard shortcuts (spec §28). */
export function useDesignerShortcuts(session: Session): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().mode !== 'designer') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo(session);
        else undo(session);
      } else if (e.code === 'Space') {
        e.preventDefault();
        togglePlay(session);
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        const d = useDesigner.getState();
        if (d.play && d.selectedAction) {
          if (applyEdit(session, removeAction(d.play, d.selectedAction.node, d.selectedAction.index))) useDesigner.setState({ selectedAction: null });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);
}
