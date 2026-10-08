import { compilePlay } from '../domain/play/compiler/compile';
import { Rng } from '../domain/math/rng';
import type { CoverageName } from '../domain/play/schema/playDefinition';
import { parsePlayText, serializePlay } from '../domain/play/schema/validate';
import type { PlayGraph } from '../domain/play/graph/playGraph';
import type { Session } from './session';
import { toast, useUi } from './store';

/** Coverages a play can actually branch on (from its read nodes), in a stable order. */
export function playCoverages(g: PlayGraph): CoverageName[] {
  const set = new Set<CoverageName>();
  for (const n of Object.values(g.nodes)) for (const t of n.transitions) if (t.when.kind === 'coverage') set.add(t.when.coverage);
  return [...set];
}

/** Default actor for the user: the ball handler, else the first offensive player. */
export function defaultControl(g: PlayGraph): string {
  return (g.actors.find((a) => a.id === g.ballHolder) ?? g.actors.find((a) => a.team === 'offense')!).id;
}

/** Parses, validates and compiles a play, then starts a rep. False (with issues in the store) if invalid. */
export function loadPlayText(session: Session, text: string): boolean {
  const r = parsePlayText(text);
  if (!r.ok) {
    useUi.setState({ playIssues: r.errors });
    return false;
  }
  const graph = compilePlay(r.play);
  const ui = useUi.getState();
  const sameText = text === ui.playText;
  useUi.setState({
    mode: 'play',
    playText: text,
    playIssues: r.warnings,
    coverage: sameText ? ui.coverage : graph.simulation.coverage,
    playControl: ui.playControl && graph.actors.some((a) => a.id === ui.playControl) ? ui.playControl : defaultControl(graph),
  });
  startRep(session, graph);
  return true;
}

/** Starts (or restarts) a rep of the loaded play with the current mode settings. */
export function startRep(session: Session, graph = session.play): void {
  if (!graph) return;
  const ui = useUi.getState();
  const rep = ui.rep + 1;
  let coverage = ui.coverage;
  if (ui.playMode === 'react') {
    // Read & React: the defense picks its coverage; the user must read it.
    const options = playCoverages(graph);
    if (options.length) coverage = options[Math.floor(new Rng(graph.simulation.seed * 7919 + rep).next() * options.length)];
  }
  const controlled = ui.playMode === 'watch' ? null : ui.playControl;
  session.loadPlay(graph, { coverage, controlled, collisionMode: ui.collisionMode });
  useUi.setState({ rep, paused: false, eventLog: [], lastShot: null, repResult: null, ...(ui.playMode === 'react' ? {} : { coverage }) });
}

export function restartPlay(session: Session): void {
  startRep(session);
}

export function exportPlay(session: Session, format: 'yaml' | 'json'): void {
  if (!session.play) return;
  const text = serializePlay(session.play.source, format);
  const blob = new Blob([text], { type: format === 'json' ? 'application/json' : 'application/yaml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${session.play.id}.${format === 'json' ? 'json' : 'yaml'}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${a.download}`);
}
