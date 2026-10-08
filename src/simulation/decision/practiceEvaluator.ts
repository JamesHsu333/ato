import { COVERAGE_INFO } from '../../domain/play/coaching';
import type { PlayGraph } from '../../domain/play/graph/playGraph';
import type { CoverageName } from '../../domain/play/schema/playDefinition';
import { RIM_CENTER } from '../../domain/court/dimensions';
import type { TargetRef } from '../../domain/actions/primitives';
import type { Vec2 } from '../../domain/math/vec';
import type { ActorTask } from '../runtime/playRuntime';
import { SIM_DT } from '../runtime/types';

/** A decisive basketball choice: shoot, pass to someone, or drive to the rim. */
export type Decision = 'shoot' | 'drive' | `pass:${string}`;

export interface PracticeResult {
  actor: string;
  coverage: CoverageName;
  branch: string | null;
  scores: { timing: number | null; spacing: number | null; route: number | null };
  decision: { observed: Decision | null; expected: Decision[]; correct: boolean | null };
  notes: string[];
}

/** Practice scoring state (spec §36). Plain data: part of the snapshot. */
export interface PracticeState {
  actor: string;
  routeDev: number;
  routeSamples: number;
  spacingOk: number;
  spacingSamples: number;
  timing: { delta: number; note: string }[];
  /** Waiting on a `when` condition: where the user stood and when they left. */
  wait: { key: string; anchor: Vec2; departTick: number | null; condTick: number | null; label: [string, string] } | null;
  earlyScreen: { leftTick: number; event: string } | null;
  branch: string | null;
  observed: Decision | null;
  observedBeforeRead: boolean;
}

export function createPracticeState(actor: string): PracticeState {
  return {
    actor,
    routeDev: 0,
    routeSamples: 0,
    spacingOk: 0,
    spacingSamples: 0,
    timing: [],
    wait: null,
    earlyScreen: null,
    branch: null,
    observed: null,
    observedBeforeRead: false,
  };
}

const RIM: Vec2 = { x: RIM_CENTER.x, z: RIM_CENTER.z };
const nearRim = (p: Vec2, r = 2.8) => Math.hypot(p.x - RIM.x, p.z - RIM.z) < r;

/** Event → [clause, noun]: "before the screen was set" / "off the screen". */
const humanize = (event: string): [string, string] =>
  event.endsWith('.screen_set')
    ? ['the screen was set', 'the screen']
    : event.endsWith('.clears_screen')
      ? ['the ball handler used the screen', 'the ball handler']
      : event.endsWith('.caught')
        ? ['the catch', 'the catch']
        : [event, event];

export interface PracticeFrame {
  tick: number;
  graph: PlayGraph;
  /** Nodes visited so far, in order. */
  history: string[];
  task: ActorTask | undefined;
  /** First point the task's movement heads for (resolved live), if it moves. */
  taskTarget: Vec2 | null;
  self: { position: Vec2; hasBall: boolean; screening: boolean };
  teammates: Vec2[];
  stepEvents: string[];
}

/** Updates practice scoring for one step. */
export function updatePractice(p: PracticeState, f: PracticeFrame): void {
  const me = p.actor;

  // Branch: the first node entered from a coverage read.
  if (p.branch === null) {
    const i = f.history.findIndex((_, k) => k > 0 && f.graph.nodes[f.history[k - 1]].transitions.some((t) => t.when.kind === 'coverage'));
    if (i > 0) p.branch = f.history[i];
  }

  // Timing: leaving before (or long after) the event you were told to wait for.
  const t = f.task;
  if (t && t.when && !t.done && f.taskTarget) {
    const key = `${t.nodeId}:${t.semantic}:${t.startTick}`;
    if (!p.wait || p.wait.key !== key) {
      const ev = t.when.kind === 'event' ? t.when.name : 'the cue';
      p.wait = { key, anchor: { ...f.self.position }, departTick: null, condTick: null, label: humanize(ev) };
    }
    const w = p.wait;
    // Departure: the user's own movement toward the action's first target (the
    // target itself may be moving, e.g. a screener coming up).
    const toT = { x: f.taskTarget.x - w.anchor.x, z: f.taskTarget.z - w.anchor.z };
    const l = Math.hypot(toT.x, toT.z) || 1;
    const progress = ((f.self.position.x - w.anchor.x) * toT.x + (f.self.position.z - w.anchor.z) * toT.z) / l;
    if (w.departTick === null && w.condTick === null && progress < 0) w.anchor = { ...f.self.position }; // drifting away (jab) resets
    const moved = progress > 0.8;
    if (t.started && w.condTick === null) {
      w.condTick = f.tick;
      if (w.departTick !== null) {
        const early = (f.tick - w.departTick) * SIM_DT;
        p.timing.push({ delta: -early, note: `You left ${early.toFixed(2)} s before ${w.label[0]}.` });
        w.departTick = -1; // recorded
      }
    }
    if (moved && w.departTick === null) {
      w.departTick = f.tick;
      if (w.condTick !== null) {
        const late = (f.tick - w.condTick) * SIM_DT;
        p.timing.push({
          delta: late,
          note: late > 0.5 ? `You went ${late.toFixed(2)} s after ${w.label[0]} — a beat late.` : `Good timing off ${w.label[1]}.`,
        });
      }
    }
  }
  if (f.stepEvents.includes(`${me}.left_screen_early`) && t) {
    const until = t.steps.find((s) => s.op === 'screenPosition');
    const hold = until && until.op === 'screenPosition' && until.holdUntil?.kind === 'event' ? until.holdUntil.name : null;
    if (hold) p.earlyScreen = { leftTick: f.tick, event: hold };
  }
  if (p.earlyScreen && f.stepEvents.includes(p.earlyScreen.event)) {
    const early = (f.tick - p.earlyScreen.leftTick) * SIM_DT;
    p.timing.push({ delta: -early, note: `You left the screen ${early.toFixed(2)} s before ${humanize(p.earlyScreen.event)[0]}.` });
    p.earlyScreen = null;
  }

  // Spacing: off the ball (and not screening), stay away from teammates.
  if (!f.self.hasBall && !f.self.screening && f.teammates.length) {
    const nearest = Math.min(...f.teammates.map((q) => Math.hypot(q.x - f.self.position.x, q.z - f.self.position.z)));
    p.spacingSamples++;
    if (nearest > 2.4) p.spacingOk++;
  }

  // Decision: the first decisive action with the ball.
  if (p.observed === null) {
    let d: Decision | null = null;
    const passed = f.stepEvents.find((e) => e.startsWith(`${me}.passed_`));
    if (passed) d = `pass:${passed.slice(`${me}.passed_`.length)}`;
    else if (f.stepEvents.includes(`${me}.shot`)) d = nearRim(f.self.position) ? 'drive' : 'shoot';
    else if (f.self.hasBall && nearRim(f.self.position)) d = 'drive';
    if (d) {
      p.observed = d;
      p.observedBeforeRead = p.branch === null && hasRead(f.graph);
    }
  }
}

export function recordRoute(p: PracticeState, deviation: number): void {
  p.routeDev += Math.min(deviation, 4);
  p.routeSamples++;
}

const hasRead = (g: PlayGraph) => Object.values(g.nodes).some((n) => n.transitions.some((t) => t.when.kind === 'coverage'));

function decisiveOf(semantic: string, steps: ActorTask['steps']): Decision | null {
  for (const s of steps) {
    if (s.op === 'shoot') return 'shoot';
    if (s.op === 'pass') return `pass:${s.target}`;
    if (s.op === 'move' && (semantic === 'drive' || semantic === 'move') && targetNearRim(s.to)) return 'drive';
  }
  return null;
}
const targetNearRim = (t: TargetRef) => t.kind === 'point' && nearRim(t, 3);

/** The first decisive choices the play expects from `actor` from `node` on. */
export function expectedDecisions(g: PlayGraph, node: string, actor: string, depth = 3): Decision[] {
  const n = g.nodes[node];
  if (!n || depth < 0) return [];
  const opts = n.options.filter((o) => o.action.actor === actor).map((o) => decisiveOf(o.action.semantic, o.action.steps));
  if (opts.some(Boolean)) return [...new Set(opts.filter((x): x is Decision => !!x))];
  for (const a of n.actions.filter((x) => x.actor === actor)) {
    const d = decisiveOf(a.semantic, a.steps);
    if (d) return [d];
  }
  return [...new Set(n.transitions.flatMap((t) => expectedDecisions(g, t.to, actor, depth - 1)))];
}

const pct = (x: number) => Math.round(Math.max(0, Math.min(100, x)));

export function finishPractice(p: PracticeState, g: PlayGraph, coverage: CoverageName): PracticeResult {
  const notes: string[] = [];
  const timingRecords = p.earlyScreen
    ? [...p.timing, { delta: -0.6, note: `You left the screen before ${humanize(p.earlyScreen.event)[0]}.` }]
    : p.timing;
  const timing = timingRecords.length
    ? pct(timingRecords.reduce((s, t) => s + (100 - Math.abs(t.delta) * (t.delta < 0 ? 160 : 70)), 0) / timingRecords.length)
    : null;
  for (const t of timingRecords) notes.push(t.note);
  const route = p.routeSamples > 10 ? pct(100 * Math.exp(-p.routeDev / p.routeSamples / 0.9)) : null;
  const spacing = p.spacingSamples > 10 ? pct((100 * p.spacingOk) / p.spacingSamples) : null;

  const expected = p.branch ? expectedDecisions(g, p.branch, p.actor) : [];
  let correct: boolean | null = null;
  if (p.observed && p.observedBeforeRead) {
    correct = false;
    notes.push('You made your move before the defense showed its coverage — use the screen first, then read the big.');
  } else if (p.observed && expected.length) {
    correct = expected.includes(p.observed);
    const info = COVERAGE_INFO[coverage];
    if (correct) notes.push(`Correct read vs ${info.label}. ${info.read}`);
    else notes.push(`Defense was in ${info.label}: ${info.looksLike} ${info.read}`);
  }
  return { actor: p.actor, coverage, branch: p.branch, scores: { timing, spacing, route }, decision: { observed: p.observed, expected, correct }, notes };
}
