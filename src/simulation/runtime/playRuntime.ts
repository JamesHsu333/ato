import type { PrimitiveAction } from '../../domain/actions/primitives';
import { evaluateCondition, type Condition } from '../../domain/conditions/condition';
import type { CompiledAction, PlayGraph } from '../../domain/play/graph/playGraph';
import type { CoverageName } from '../../domain/play/schema/playDefinition';
import type { Vec2 } from '../../domain/math/vec';
import { SIM_DT } from './types';

/** Per-primitive scratch state. */
export interface StepState {
  startTick: number;
  path: Vec2[] | null;
  pathIndex: number;
  releaseAt?: number;
  screen?: number;
  started?: boolean;
}

/** One actor's current semantic action, compiled to primitives. Plain data. */
export interface ActorTask {
  semantic: string;
  nodeId: string;
  when?: Condition;
  started: boolean;
  startTick: number;
  /** Named events seen since the task was assigned. */
  events: string[];
  steps: PrimitiveAction[];
  index: number;
  step: StepState;
  done: boolean;
  /** What the actor was doing before; continues while this task waits on `when`. */
  prev?: ActorTask;
}

/** Play graph execution state (spec §45: part of every snapshot). */
export interface PlayState {
  node: string;
  nodeEnterTick: number;
  nodeEvents: string[];
  complete: boolean;
  chosenOption: string | null;
  tasks: Record<string, ActorTask>;
  history: { node: string; tick: number }[];
}

export interface PlayContext {
  tick: number;
  /** Coverage exposed by the defense runtime (never the reverse direction). */
  coverage: CoverageName | null;
  /** The user-controlled actor does not receive AI tasks. */
  controlled: string | null;
  /** Option picked by the user for the current node, if any. */
  pendingChoice: string | null;
  emit(name: string): void;
  onNode(node: string): void;
}

export function createTask(a: CompiledAction, nodeId: string, tick: number): ActorTask {
  return {
    semantic: a.semantic,
    nodeId,
    when: a.when,
    started: a.when === undefined,
    startTick: tick,
    events: [],
    steps: a.steps,
    index: 0,
    step: { startTick: tick, path: null, pathIndex: 0 },
    done: a.steps.length === 0,
  };
}

export function createPlayState(graph: PlayGraph, ctx: PlayContext): PlayState {
  const s: PlayState = { node: '', nodeEnterTick: 0, nodeEvents: [], complete: false, chosenOption: null, tasks: {}, history: [] };
  enterNode(s, graph, graph.start, ctx);
  return s;
}

function enterNode(s: PlayState, graph: PlayGraph, id: string, ctx: PlayContext): void {
  s.node = id;
  s.nodeEnterTick = ctx.tick;
  s.nodeEvents = [];
  s.chosenOption = null;
  s.history.push({ node: id, tick: ctx.tick });
  // Actors with a new action switch to it; others finish what they were doing.
  for (const a of graph.nodes[id].actions) assignTask(s, a.actor, createTask(a, id, ctx.tick));
  ctx.emit(`play.node.${id}`);
  ctx.onNode(id);
}

function assignTask(s: PlayState, actor: string, task: ActorTask): void {
  const old = s.tasks[actor];
  if (!task.started && old && !old.done) task.prev = old.started ? { ...old, prev: undefined } : old.prev;
  s.tasks[actor] = task;
}

/** Feeds named events (from the previous step) into node and task scopes. */
export function observeEvents(s: PlayState, events: string[]): void {
  if (!events.length) return;
  s.nodeEvents.push(...events);
  for (const t of Object.values(s.tasks)) {
    t.events.push(...events);
    t.prev?.events.push(...events);
  }
}

export function scopeContext(events: string[], sinceTick: number, tick: number, coverage: CoverageName | null) {
  return { hasEvent: (n: string) => events.includes(n), elapsed: (tick - sinceTick) * SIM_DT, coverage };
}

/** Advances the graph: transitions, option selection, completion. */
export function updatePlay(s: PlayState, graph: PlayGraph, ctx: PlayContext): void {
  if (s.complete) return;
  const recordUserPick = () => {
    // A user's choice is recorded before the node can move on (a pass may be caught the same step).
    const node = graph.nodes[s.node];
    const userPick = s.chosenOption === null ? node.options.find((o) => o.id === ctx.pendingChoice && o.action.actor === ctx.controlled) : undefined;
    if (userPick) {
      s.chosenOption = userPick.id;
      ctx.emit(`play.option.${userPick.id}`);
    }
  };
  recordUserPick();
  // A possession ends when a shot goes up or the defense takes the ball.
  const defense = new Set(graph.actors.filter((a) => a.team === 'defense').map((a) => a.id));
  const turnover = s.nodeEvents.some((n) => n.endsWith('.has_ball') && defense.has(n.slice(0, -'.has_ball'.length)));
  if (s.nodeEvents.includes('shot.released') || s.nodeEvents.includes('play.dead_ball') || turnover) {
    s.complete = true;
    if (turnover) ctx.emit('play.turnover');
    ctx.emit('play.complete');
    return;
  }
  // Follow at most a few transitions per step (guards against condition cycles).
  for (let hop = 0; hop < 4; hop++) {
    const node = graph.nodes[s.node];
    if (hop > 0) recordUserPick();
    const cctx = scopeContext(s.nodeEvents, s.nodeEnterTick, ctx.tick, ctx.coverage);
    const t = node.transitions.find((tr) => evaluateCondition(tr.when, cctx));
    if (!t) break;
    enterNode(s, graph, t.to, ctx);
  }

  const node = graph.nodes[s.node];
  if (node.options.length && s.chosenOption === null) {
    const userOwned = node.options.some((o) => o.action.actor === ctx.controlled);
    const pick = userOwned ? node.options.find((o) => o.id === ctx.pendingChoice) : node.options[0];
    if (pick) {
      s.chosenOption = pick.id;
      ctx.emit(`play.option.${pick.id}`);
      if (pick.action.actor !== ctx.controlled) assignTask(s, pick.action.actor, createTask(pick.action, node.id, ctx.tick));
    }
  }

  if (!node.transitions.length && (node.options.length === 0 || s.chosenOption !== null)) {
    const nodeTasksDone = Object.values(s.tasks).every((t) => t.nodeId !== node.id || t.done);
    if (nodeTasksDone) {
      s.complete = true;
      ctx.emit('play.complete');
    }
  }
}
