import { compilePlay } from '../../domain/play/compiler/compile';
import type { PlayDefinition } from '../../domain/play/schema/playDefinition';
import { parsePlayText, serializePlay, validatePlay } from '../../domain/play/schema/validate';
import { duplicatePlay } from '../../domain/play/edit/edits';
import { deletePlay, listPlays, savePlay } from '../../persistence/playStore';
import { simulationFromPlay } from '../../simulation/runtime/fromPlay';
import { recordPlay, seek } from '../../simulation/runtime/recorder';
import type { Session } from '../session';
import { toast, useUi } from '../store';
import { useDesigner } from './designerStore';

const HISTORY_LIMIT = 100;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Rebuilds the designer simulation and its recording from a (valid) definition. */
function rebuild(session: Session, play: PlayDefinition, keepTime: boolean): void {
  const graph = compilePlay(play);
  const opts = { controlled: null, collisionMode: 'soft' as const, coverage: useUi.getState().coverage };
  const recSim = simulationFromPlay(graph, opts);
  const recording = recordPlay(recSim);
  recSim.dispose();
  session.loadPlay(graph, opts);
  session.paused = true;
  const t = keepTime ? Math.min(useDesigner.getState().time, recording.duration) : 0;
  if (t > 0) seek(session.sim, recording, t);
  useDesigner.setState({ recording, time: t, playing: false });
}

/** Opens a play in the designer (resets history). */
export function openInDesigner(session: Session, play: PlayDefinition): void {
  useDesigner.setState({ play, past: [], future: [], issues: [], warnings: [], selectedActor: null, selectedAction: null, selectedNode: play.play.start ?? 'start', yamlDirty: false });
  useUi.setState({ mode: 'designer', paused: true, repResult: null });
  rebuild(session, play, false);
  void refreshLibrary();
}

/**
 * Applies an edit: validate → push undo history → recompile + re-record → autosave.
 * Invalid results are rejected with the issues shown (the previous play stays).
 */
export function applyEdit(session: Session, next: PlayDefinition, opts: { keepTime?: boolean } = {}): boolean {
  const r = validatePlay(next);
  if (!r.ok) {
    useDesigner.setState({ issues: r.errors });
    return false;
  }
  const d = useDesigner.getState();
  useDesigner.setState({
    play: next,
    past: d.play ? [...d.past, d.play].slice(-HISTORY_LIMIT) : d.past,
    future: [],
    issues: [],
    warnings: r.warnings,
  });
  rebuild(session, next, opts.keepTime ?? false);
  scheduleSave(next);
  return true;
}

export function undo(session: Session): void {
  const d = useDesigner.getState();
  const prev = d.past[d.past.length - 1];
  if (!prev || !d.play) return;
  useDesigner.setState({ play: prev, past: d.past.slice(0, -1), future: [d.play, ...d.future], issues: [] });
  rebuild(session, prev, true);
  scheduleSave(prev);
}

export function redo(session: Session): void {
  const d = useDesigner.getState();
  const next = d.future[0];
  if (!next || !d.play) return;
  useDesigner.setState({ play: next, past: [...d.past, d.play], future: d.future.slice(1), issues: [] });
  rebuild(session, next, true);
  scheduleSave(next);
}

/** YAML editor input: applied as an edit when it parses and validates. */
export function applyYaml(session: Session, text: string): void {
  const r = parsePlayText(text);
  if (!r.ok) {
    useDesigner.setState({ issues: r.errors, yamlDirty: true });
    return;
  }
  useDesigner.setState({ yamlDirty: false });
  applyEdit(session, r.play, { keepTime: true });
}

export function setTime(session: Session, t: number): void {
  const rec = useDesigner.getState().recording;
  if (!rec) return;
  const clamped = Math.max(0, Math.min(rec.duration, t));
  seek(session.sim, rec, clamped);
  session.paused = true;
  useDesigner.setState({ time: clamped, playing: false });
}

export function togglePlay(session: Session): void {
  const d = useDesigner.getState();
  if (!d.recording) return;
  if (d.playing) {
    session.paused = true;
    useDesigner.setState({ playing: false });
    return;
  }
  if (d.time >= d.recording.duration - 0.05) setTime(session, 0);
  session.paused = false;
  useDesigner.setState({ playing: true });
}

function scheduleSave(play: PlayDefinition): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await savePlay({ id: play.play.id, name: play.play.name, yaml: serializePlay(play, 'yaml') });
      useDesigner.setState({ savedAt: Date.now() });
      await refreshLibrary();
    } catch {
      /* storage unavailable: keep editing without autosave */
    }
  }, 400);
}

export async function refreshLibrary(): Promise<void> {
  useDesigner.setState({ library: await listPlays() });
}

export function duplicateCurrent(session: Session): void {
  const d = useDesigner.getState();
  if (!d.play) return;
  const ids = d.library.map((p) => p.id).concat(d.play.play.id);
  const copy = duplicatePlay(d.play, ids);
  openInDesigner(session, copy);
  scheduleSave(copy);
  toast(`Duplicated as ${copy.play.name}`);
}

export async function deleteSaved(id: string): Promise<void> {
  await deletePlay(id);
  await refreshLibrary();
}

export function openSaved(session: Session, yaml: string): void {
  const r = parsePlayText(yaml);
  if (r.ok) openInDesigner(session, r.play);
  else toast('Saved play is no longer valid');
}
