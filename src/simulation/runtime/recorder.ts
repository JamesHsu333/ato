import type { Vec2 } from '../../domain/math/vec';
import type { Simulation, SimulationSnapshot } from './simulation';
import { EMPTY_INPUT, SIM_DT } from './types';

export const SNAPSHOT_INTERVAL_TICKS = 30; // 0.5 s (spec §45)

export interface TimelineSegment {
  actor: string;
  label: string;
  node: string;
  start: number;
  end: number;
}

export interface RecordedPath {
  node: string;
  actor: string;
  /** Index of the action within node.actions. */
  actionIndex: number;
  path: Vec2[];
}

/** A full deterministic run of a play: what the designer timeline shows and seeks through. */
export interface Recording {
  duration: number;
  snapshots: { tick: number; snap: SimulationSnapshot }[];
  segments: TimelineSegment[];
  events: { t: number; name: string }[];
  trails: Record<string, Vec2[]>;
  paths: RecordedPath[];
  nodes: { node: string; t: number }[];
}

/** Runs `sim` (fresh, AI-only) to the end of the play and records it. */
export function recordPlay(sim: Simulation, maxSeconds = 20): Recording {
  const rec: Recording = { duration: 0, snapshots: [], segments: [], events: [], trails: {}, paths: [], nodes: [] };
  const open = new Map<string, TimelineSegment>();
  const seenPaths = new Set<unknown>();
  let endTick: number | null = null;
  const play = sim.play;

  const sample = () => {
    const t = sim.time;
    for (const c of sim.chars) {
      const task = sim.playState?.tasks[c.id];
      let label = c.state.team === 'defense' ? 'defend' : '';
      if (task && !task.done) label = task.started ? task.semantic : `wait → ${task.semantic}`;
      const node = task?.nodeId ?? '';
      const cur = open.get(c.id);
      if (cur && cur.label === label && cur.node === node) cur.end = t;
      else {
        const seg = { actor: c.id, label, node, start: t, end: t };
        open.set(c.id, seg);
        if (label) rec.segments.push(seg);
      }
      if (sim.tick % 3 === 0) (rec.trails[c.id] ??= []).push({ x: c.state.position.x, z: c.state.position.z });
      // Capture each action's default path the first time it is built.
      if (play && task?.step.path && !seenPaths.has(task.steps)) {
        seenPaths.add(task.steps);
        const actions = play.nodes[task.nodeId]?.actions ?? [];
        const actionIndex = actions.findIndex((a) => a.steps === task.steps);
        if (actionIndex >= 0) rec.paths.push({ node: task.nodeId, actor: c.id, actionIndex, path: task.step.path.slice() });
      }
    }
  };

  rec.snapshots.push({ tick: sim.tick, snap: sim.snapshot() });
  sample();
  for (let i = 0; i < maxSeconds * 60; i++) {
    sim.step(EMPTY_INPUT);
    for (const e of sim.drainEvents()) {
      if (e.type !== 'play.event') continue;
      if (e.name.startsWith('play.node.')) rec.nodes.push({ node: e.name.slice('play.node.'.length), t: sim.time });
      else rec.events.push({ t: sim.time, name: e.name });
    }
    if (sim.tick % SNAPSHOT_INTERVAL_TICKS === 0) rec.snapshots.push({ tick: sim.tick, snap: sim.snapshot() });
    sample();
    const live = (sim.ball.shot && !sim.ball.shot.resolved) || (sim.ball.holder === null && sim.ball.passTarget !== null);
    if (sim.playState?.complete && !live) endTick ??= sim.tick;
    if (endTick !== null && sim.tick - endTick > 45) break;
  }
  rec.duration = sim.tick * SIM_DT;
  if (play) rec.nodes.unshift({ node: play.start, t: 0 });
  return rec;
}

/** Restores the closest snapshot at or before `t` and fast-forwards (spec §45 seek procedure). */
export function seek(sim: Simulation, rec: Recording, t: number): void {
  const target = Math.max(0, Math.round(t / SIM_DT));
  let best = rec.snapshots[0];
  for (const s of rec.snapshots) if (s.tick <= target && s.tick >= best.tick) best = s;
  sim.restore(best.snap);
  while (sim.tick < target) sim.step(EMPTY_INPUT);
  sim.drainEvents();
}
