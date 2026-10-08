import { SEMANTIC_SPOTS, type SemanticSpot } from '../../court/spots';
import { COURT } from '../../court/dimensions';
import type { Vec2 } from '../../math/vec';
import type { ActionDef, ActorDef, PlayDefinition, PositionDef } from '../schema/playDefinition';

/**
 * Pure edit operations on a PlayDefinition (the editor's source of truth).
 * Each returns a new definition; the input is never mutated, which keeps undo/redo trivial.
 */
const clone = (p: PlayDefinition): PlayDefinition => structuredClone(p);
const round = (v: number) => Math.round(v * 100) / 100;

/** Snaps a floor point to a semantic spot when close, else exact coordinates (clamped to the court). */
export function toPosition(p: Vec2, snapRadius = 0.45): PositionDef {
  for (const [name, s] of Object.entries(SEMANTIC_SPOTS)) {
    if (Math.hypot(s.x - p.x, s.z - p.z) <= snapRadius) return name as SemanticSpot;
  }
  return {
    x: round(Math.max(-COURT.halfWidth, Math.min(COURT.halfWidth, p.x))),
    z: round(Math.max(COURT.baselineZ, Math.min(COURT.halfCourtZ, p.z))),
  };
}

export function moveActorStart(play: PlayDefinition, actor: string, p: Vec2): PlayDefinition {
  const next = clone(play);
  const s = next.setup[actor] ?? {};
  // Dragging pins the player to an absolute spot (a defender stops being "relative to" his man).
  delete s.relative_to;
  delete s.defensive_position;
  s.position = toPosition(p);
  next.setup[actor] = s;
  return next;
}

function freshId(play: PlayDefinition, prefix: string): string {
  for (let i = 1; ; i++) if (!(`${prefix}${i}` in play.actors)) return `${prefix}${i}`;
}

/** Adds a player; returns id null (play unchanged) when that team already has 5. */
export function addActor(play: PlayDefinition, team: ActorDef['team'], character: string, at: Vec2): { play: PlayDefinition; id: string | null } {
  if (Object.values(play.actors).filter((a) => a.team === team).length >= 5) return { play, id: null };
  const next = clone(play);
  const id = freshId(next, team === 'offense' ? 'o' : 'x');
  next.actors[id] = { character, team };
  next.setup[id] = { position: toPosition(at) };
  return { play: next, id };
}

/** Removes an actor and every action, option and assignment that refers to it. */
export function removeActor(play: PlayDefinition, id: string): PlayDefinition {
  const next = clone(play);
  delete next.actors[id];
  delete next.setup[id];
  for (const a of Object.values(next.actors)) if (a.assignment === id) delete a.assignment;
  for (const [sid, s] of Object.entries(next.setup)) {
    if (s.relative_to === id) next.setup[sid] = { position: 'top' };
    if (s.possession === 'ball' && sid === id) delete s.possession;
  }
  const refs = (a: ActionDef) => a.actor === id || a.target === id || (typeof a.via === 'string' && a.via.split('.')[0] === id) || (typeof a.to === 'string' && a.to.split('.')[0] === id);
  for (const n of Object.values(next.graph)) {
    if (n.actions) n.actions = n.actions.filter((a) => !refs(a));
    if (n.player_options) {
      n.player_options = n.player_options.filter((o) => !refs(o.action));
      if (!n.player_options.length) delete n.player_options;
    }
  }
  return next;
}

export function updateActor(play: PlayDefinition, id: string, patch: Partial<ActorDef>): PlayDefinition {
  const next = clone(play);
  next.actors[id] = { ...next.actors[id], ...patch };
  for (const k of Object.keys(patch) as (keyof ActorDef)[]) if (patch[k] === undefined) delete next.actors[id][k];
  return next;
}

export function giveBallTo(play: PlayDefinition, id: string): PlayDefinition {
  const next = clone(play);
  for (const s of Object.values(next.setup)) delete s.possession;
  next.setup[id] = { ...next.setup[id], possession: 'ball' };
  return next;
}

/**
 * Adds a movement action from a drag gesture (spec §28). A curved drag (Option)
 * stores the bend as a path override waypoint.
 */
export function addMove(play: PlayDefinition, node: string, actor: string, to: Vec2, bend?: Vec2): PlayDefinition {
  const next = clone(play);
  const n = (next.graph[node] ??= {});
  const action: ActionDef = { actor, action: 'move', to: toPosition(to, 0.3) };
  if (bend) action.path = { mode: 'override', points: [[round(bend.x), round(bend.z)]] };
  // Two moves for one actor in the same node: the second waits for the first.
  const prior = (n.actions ?? []).filter((a) => a.actor === actor);
  if (prior.length) action.when = { event: `${actor}.${prior[prior.length - 1].action}_done` };
  (n.actions ??= []).push(action);
  return next;
}

export function setActionWaypoints(play: PlayDefinition, node: string, index: number, points: Vec2[]): PlayDefinition {
  const next = clone(play);
  const a = next.graph[node]?.actions?.[index];
  if (!a) return play;
  if (points.length) a.path = { mode: 'override', points: points.map((p) => [round(p.x), round(p.z)]) };
  else delete a.path;
  return next;
}

export function setActionTarget(play: PlayDefinition, node: string, index: number, to: Vec2): PlayDefinition {
  const next = clone(play);
  const a = next.graph[node]?.actions?.[index];
  if (!a) return play;
  a.to = toPosition(to, 0.3);
  return next;
}

export function updateAction(play: PlayDefinition, node: string, index: number, patch: Partial<ActionDef>): PlayDefinition {
  const next = clone(play);
  const a = next.graph[node]?.actions?.[index];
  if (!a) return play;
  Object.assign(a, patch);
  for (const k of Object.keys(patch) as (keyof ActionDef)[]) if (patch[k] === undefined) delete a[k];
  return next;
}

export function removeAction(play: PlayDefinition, node: string, index: number): PlayDefinition {
  const next = clone(play);
  next.graph[node]?.actions?.splice(index, 1);
  return next;
}

/**
 * Appends a new step after `node`: the graph moves on once every action in
 * `node` has finished (event-based, not a timestamp — spec §30).
 */
export function addNodeAfter(play: PlayDefinition, node: string): { play: PlayDefinition; id: string } {
  const next = clone(play);
  let i = 2;
  while (`step_${i}` in next.graph) i++;
  const id = `step_${i}`;
  const src = next.graph[node];
  const done = (src.actions ?? []).map((a) => `${a.actor}.${a.action}_done`);
  const when = done.length === 0 ? { elapsed: 1 } : done.length === 1 ? done[0] : { all: done };
  (src.transitions ??= []).push({ when, to: id });
  next.graph[id] = { actions: [] };
  return { play: next, id };
}

export function renamePlay(play: PlayDefinition, name: string): PlayDefinition {
  const next = clone(play);
  next.play.name = name;
  return next;
}

/** A copy with a new id (spec §47 "duplicate play"). */
export function duplicatePlay(play: PlayDefinition, existingIds: string[]): PlayDefinition {
  const next = clone(play);
  let id = `${play.play.id}-copy`;
  for (let i = 2; existingIds.includes(id); i++) id = `${play.play.id}-copy-${i}`;
  next.play.id = id;
  next.play.name = `${play.play.name} (copy)`;
  return next;
}

export function emptyPlay(id: string): PlayDefinition {
  return {
    version: '0.1',
    play: { id, name: 'New play' },
    court: { type: 'nba_half' },
    actors: {
      o1: { character: 'generic_guard', team: 'offense', role: 'ball_handler' },
      x1: { character: 'generic_defender', team: 'defense', assignment: 'o1' },
    },
    setup: { o1: { position: 'top', possession: 'ball' }, x1: { relative_to: 'o1', defensive_position: 'on_ball' } },
    graph: { start: { actions: [] } },
    simulation: { seed: 42, shot_outcome: { mode: 'forced', result: 'make' } },
  };
}
