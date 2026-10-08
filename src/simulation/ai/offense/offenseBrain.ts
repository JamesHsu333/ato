import type { MoveSpeed, PrimitiveAction } from '../../../domain/actions/primitives';
import { evaluateCondition } from '../../../domain/conditions/condition';
import { RIM_CENTER } from '../../../domain/court/dimensions';
import { normalize2, type Vec2 } from '../../../domain/math/vec';
import { samplePath } from '../../../domain/play/compiler/paths';
import type { CoverageName } from '../../../domain/play/schema/playDefinition';
import { scopeContext, type ActorTask } from '../../runtime/playRuntime';
import { SIM_DT } from '../../runtime/types';
import { isDynamicTarget, resolveTarget } from '../targets';
import type { PlayerView, WorldView } from '../world';

/** What an offensive AI player can do to the world. Implemented by the Simulation. */
export interface OffenseOps {
  tick: number;
  coverage: CoverageName | null;
  hasBall(id: string): boolean;
  /** A pass is still travelling to its receiver. */
  passInFlight(): boolean;
  /** `oopSpot`: throw an alley-oop to this spot instead of to the receiver. */
  pass(from: string, to: string, lob: boolean, oopSpot?: Vec2 | null): boolean;
  handoff(from: string, to: string): boolean;
  /** Where to meet a pass thrown to this player, if one is in the air. */
  incomingPass(id: string): Vec2 | null;
  /** Starts a jump shot; returns the ideal release time (seconds into the shot) or null. */
  startShot(id: string, shotType?: string): number | null;
  /** Seconds into the actor's current jump shot, or null. */
  shotTime(id: string): number | null;
  releaseShot(id: string): void;
  createScreen(screener: string, defender: string | null, user?: string): number | null;
  screenCleared(index: number): boolean;
  releaseScreen(index: number): void;
  setPose(id: string, pose: 'none' | 'screen'): void;
  random(): number;
  emit(name: string): void;
}

export interface MotorCommand {
  move: Vec2;
  sprint: boolean;
  face: Vec2 | null;
}

const SPEED_FACTOR: Record<MoveSpeed, number> = { walk: 0.32, jog: 0.6, run: 1, sprint: 1 };
const STEP_TIMEOUT = 8; // seconds: a stuck step resets into safe behavior (spec §31)
const SCREEN_HOLD_TIMEOUT = 12;

/**
 * Standing still. Off-ball players watch the ball; the ball handler faces the rim
 * (facing the ball he is dribbling would chase his own dribble and spin).
 */
export const idle = (self: PlayerView, w: WorldView): MotorCommand => ({
  move: { x: 0, z: 0 },
  sprint: false,
  face:
    w.ball.holder === self.id
      ? { x: RIM_CENTER.x - self.position.x, z: RIM_CENTER.z - self.position.z }
      : { x: w.ball.position.x - self.position.x, z: w.ball.position.z - self.position.z },
});

/**
 * Executes an offensive player's task for one step and returns the desired motion.
 * Instant primitives (face, setPose, pass...) chain within the same step.
 */
export function runOffenseTask(task: ActorTask | undefined, self: PlayerView, w: WorldView, ops: OffenseOps): MotorCommand {
  // Come to the ball: a receiver who isn't running a route steps to meet the pass.
  const meet = ops.incomingPass(self.id);
  const onRoute = task && !task.done && task.started && task.steps[task.index]?.op === 'move';
  if (meet && !onRoute) {
    const d = { x: meet.x - self.position.x, z: meet.z - self.position.z };
    const l = Math.hypot(d.x, d.z);
    if (l > 0.25) return { move: { x: (d.x / l) * Math.min(1, l / 0.8), z: (d.z / l) * Math.min(1, l / 0.8) }, sprint: l > 2, face: d };
  }
  if (!task || task.done) return idle(self, w);
  if (!task.started) {
    const ctx = scopeContext(task.events, task.startTick, ops.tick, ops.coverage);
    if (!task.when || evaluateCondition(task.when, ctx)) {
      task.started = true;
      task.prev = undefined;
      task.step = { startTick: ops.tick, path: null, pathIndex: 0 };
    } else if (task.prev && !task.prev.done) {
      // Waiting on an event dependency doesn't freeze the player: keep doing the previous action.
      return runOffenseTask(task.prev, self, w, ops);
    } else return idle(self, w);
  }

  for (let guard = 0; guard < 8 && !task.done; guard++) {
    const step = task.steps[task.index];
    const result = runStep(step, task, self, w, ops);
    if (result === 'done') {
      task.index++;
      task.step = { startTick: ops.tick, path: null, pathIndex: 0 };
      if (task.index >= task.steps.length) {
        task.done = true;
        ops.emit(`${self.id}.${task.semantic}_done`);
      }
      continue;
    }
    return result;
  }
  return idle(self, w);
}

function elapsed(task: ActorTask, ops: OffenseOps): number {
  return (ops.tick - task.step.startTick) * SIM_DT;
}

function runStep(step: PrimitiveAction, task: ActorTask, self: PlayerView, w: WorldView, ops: OffenseOps): MotorCommand | 'done' {
  const ctx = () => scopeContext(task.events, task.startTick, ops.tick, ops.coverage);
  switch (step.op) {
    case 'move':
      return runMove(step, task, self, w, ops);
    case 'face': {
      const p = resolveTarget(w, self, step.target);
      return p ? { move: { x: 0, z: 0 }, sprint: false, face: { x: p.x - self.position.x, z: p.z - self.position.z } } : 'done';
    }
    case 'setPose':
      ops.setPose(self.id, step.pose);
      return 'done';
    case 'wait': {
      const timeUp = step.duration !== undefined && elapsed(task, ops) >= step.duration;
      const condMet = step.until !== undefined && evaluateCondition(step.until, ctx());
      return timeUp || condMet ? 'done' : idle(self, w);
    }
    case 'hold': {
      const condMet = step.until !== undefined && evaluateCondition(step.until, ctx());
      return condMet || elapsed(task, ops) >= (step.maxSeconds ?? STEP_TIMEOUT) ? 'done' : idle(self, w);
    }
    case 'pass': {
      // Completes when the ball arrives (caught or loose), not on release.
      if (task.step.started) return ops.passInFlight() && elapsed(task, ops) < 4 ? idle(self, w) : 'done';
      if (!ops.hasBall(self.id)) return elapsed(task, ops) > 4 ? 'done' : idle(self, w);
      const lead = step.lead ? resolveTarget(w, self, step.lead) : null;
      if (ops.pass(self.id, step.target, step.lob, lead)) task.step.started = true;
      return idle(self, w);
    }
    case 'handoff': {
      // Hold the ball, square up to the teammate, give it when he runs by.
      if (!ops.hasBall(self.id)) return elapsed(task, ops) > 6 ? 'done' : idle(self, w);
      const r = w.players.find((p) => p.id === step.target);
      if (!r) return 'done';
      const d = Math.hypot(r.position.x - self.position.x, r.position.z - self.position.z);
      if (d < self.radius + r.radius + 0.55 && ops.handoff(self.id, step.target)) return 'done';
      return { move: { x: 0, z: 0 }, sprint: false, face: { x: r.position.x - self.position.x, z: r.position.z - self.position.z } };
    }
    case 'shoot': {
      const t = ops.shotTime(self.id);
      if (t === null) {
        if (task.step.started) return 'done'; // shot finished
        if (!ops.hasBall(self.id)) return elapsed(task, ops) > 4 ? 'done' : idle(self, w);
        const ideal = ops.startShot(self.id, step.shotType);
        if (ideal === null) return idle(self, w);
        task.step.started = true;
        // AI release timing: near the apex, with a little seeded noise.
        task.step.releaseAt = ideal + (ops.random() - 0.5) * 0.08;
        return { move: { x: 0, z: 0 }, sprint: false, face: null };
      }
      if (task.step.releaseAt !== undefined && t >= task.step.releaseAt) {
        ops.releaseShot(self.id);
        return 'done';
      }
      return { move: { x: 0, z: 0 }, sprint: false, face: null };
    }
    case 'screenPosition': {
      const stillEnough = Math.hypot(self.velocity.x, self.velocity.z) < 0.35;
      if (task.step.screen === undefined) {
        if (!stillEnough && elapsed(task, ops) < 1) return { move: { x: 0, z: 0 }, sprint: false, face: null };
        const idx = ops.createScreen(self.id, step.defender, step.user);
        if (idx === null) return 'done';
        task.step.screen = idx;
        ops.emit('screen.set');
        ops.emit(`${self.id}.screen_set`);
      }
      const holdMet = step.holdUntil ? evaluateCondition(step.holdUntil, ctx()) : ops.screenCleared(task.step.screen);
      // Hold as long as it takes (a late teammate is waited for, spec §30); the timeout is only a safety reset.
      if (holdMet || elapsed(task, ops) > SCREEN_HOLD_TIMEOUT) {
        ops.releaseScreen(task.step.screen);
        ops.emit(`${self.id}.screen_released`);
        return 'done';
      }
      // Planted: no movement; square up to the screened defender.
      const d = w.players.find((p) => p.id === (step.defender ?? w.players.find((q) => q.assignment === step.user)?.id));
      return { move: { x: 0, z: 0 }, sprint: false, face: d ? { x: d.position.x - self.position.x, z: d.position.z - self.position.z } : null };
    }
  }
}

type MoveStep = Extract<PrimitiveAction, { op: 'move' }>;

/** Builds (once) and refreshes the path for a move step. Shared by AI and guided practice. */
export function ensureMovePath(step: MoveStep, task: ActorTask, self: PlayerView, w: WorldView): Vec2[] | null {
  const target = resolveTarget(w, self, step.to);
  if (!target) return null;
  const st = task.step;
  if (!st.path) {
    const pts: Vec2[] = [{ ...self.position }];
    if (step.override?.length) pts.push(...step.override);
    for (const v of step.via) {
      const p = resolveTarget(w, self, v);
      if (p) pts.push(p);
    }
    pts.push(target);
    if (step.continuePast) {
      // Turn the corner: carry on past the last point, bending toward the rim.
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2] ?? self.position;
      const dir = normalize2({ x: last.x - prev.x, z: last.z - prev.z });
      const toRim = normalize2({ x: RIM_CENTER.x - last.x, z: RIM_CENTER.z - last.z });
      const bend = normalize2({ x: dir.x + toRim.x, z: dir.z + toRim.z });
      pts.push({ x: last.x + bend.x * step.continuePast, z: last.z + bend.z * step.continuePast });
    }
    st.path = samplePath(dedupe(pts), 0.2);
    st.pathIndex = 0;
  }
  // Moving targets (screen spots, players) pull the end of the path along.
  if (isDynamicTarget(step.to) && !step.continuePast) st.path[st.path.length - 1] = target;
  return st.path;
}

/** Advances the closest-point index along the path; returns distance to the path. */
export function trackPath(task: ActorTask, self: PlayerView): number {
  const path = task.step.path!;
  let i = task.step.pathIndex;
  let best = Infinity;
  for (let k = task.step.pathIndex; k < Math.min(path.length, task.step.pathIndex + 30); k++) {
    const d = Math.hypot(path[k].x - self.position.x, path[k].z - self.position.z);
    if (d < best) {
      best = d;
      i = k;
    }
  }
  task.step.pathIndex = i;
  return best;
}

function runMove(step: MoveStep, task: ActorTask, self: PlayerView, w: WorldView, ops: OffenseOps): MotorCommand | 'done' {
  const path = ensureMovePath(step, task, self, w);
  if (!path) return 'done';
  const end = path[path.length - 1];
  const distEnd = Math.hypot(end.x - self.position.x, end.z - self.position.z);
  const arriveRadius = isDynamicTarget(step.to) ? 0.25 : 0.2;
  if (distEnd < arriveRadius || elapsed(task, ops) > STEP_TIMEOUT) {
    ops.emit(`${self.id}.arrived`);
    if (step.arriveEvent) ops.emit(`${self.id}.${step.arriveEvent}`);
    return 'done';
  }

  // Pure pursuit along the polyline.
  trackPath(task, self);
  const lookahead = 0.8;
  let look = path[path.length - 1];
  for (let k = task.step.pathIndex; k < path.length; k++) {
    if (Math.hypot(path[k].x - self.position.x, path[k].z - self.position.z) >= lookahead) {
      look = path[k];
      break;
    }
  }
  const dir = normalize2({ x: look.x - self.position.x, z: look.z - self.position.z });
  const arrive = Math.min(1, Math.max(0.3, distEnd / 0.9));
  const k = SPEED_FACTOR[step.speed] * arrive;
  return { move: { x: dir.x * k, z: dir.z * k }, sprint: step.speed === 'sprint', face: null };
}

function dedupe(pts: Vec2[]): Vec2[] {
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.05);
}
