import { COURT, RIM_CENTER, isThreePoint } from '../../domain/court/dimensions';
import { clamp, facingToVec, type Vec3 } from '../../domain/math/vec';
import type { Rng } from '../../domain/math/rng';
import type { PhysicsWorld } from '../physics/physicsWorld';
import type { KinematicCharacterController } from '../characters/characterController';
import { GRAVITY, SIM_DT, type BallState, type SimEvent, type SimStats } from '../runtime/types';
import {
  gradeTiming,
  idealReleaseTime,
  launchAngle,
  shotAimPoint,
  shotProbability,
  solveLaunch,
} from './shooting';

export type ShotOutcomeConfig = { mode: 'simulated' } | { mode: 'forced'; result: 'make' | 'miss' };

export function createBallState(pos: Vec3): BallState {
  return {
    holder: null,
    hand: 'right',
    dribblePhase: 0,
    gatherTimer: 0,
    ignoreCharactersTimer: 0,
    passTarget: null,
    shot: null,
    prevPosition: { ...pos },
  };
}

interface BallContext {
  ball: BallState;
  physics: PhysicsWorld;
  chars: KinematicCharacterController[];
  rng: Rng;
  tick: number;
  stats: SimStats;
  shotOutcome: ShotOutcomeConfig;
  emit(e: SimEvent): void;
}

const DRIBBLE_HZ = { idle: 1.7, walk: 2.0, run: 2.4, sprint: 2.8 } as const;

/** Where the ball sits relative to its holder this step (hand / dribble / shot pocket). */
export function possessedBallPosition(holder: KinematicCharacterController, ball: BallState): Vec3 {
  const s = holder.state;
  const fwd = facingToVec(s.facing);
  const right = { x: -fwd.z, z: fwd.x }; // forward × up
  const h = s.height;

  if (s.action.kind === 'shoot') {
    // Set point above the forehead.
    return {
      x: s.position.x + fwd.x * 0.18,
      y: s.position.y + h * 1.08,
      z: s.position.z + fwd.z * 0.18,
    };
  }
  if (ball.gatherTimer > 0) {
    // Chest pocket after a catch.
    return { x: s.position.x + fwd.x * 0.32, y: s.position.y + h * 0.62, z: s.position.z + fwd.z * 0.32 };
  }
  const side = ball.hand === 'right' ? 1 : -1;
  const handY = h * 0.47;
  const r = COURT.ballRadius;
  const y = r + (handY - r) * Math.abs(Math.cos(Math.PI * ball.dribblePhase));
  // Lead the ball slightly in the direction of travel.
  const lead = 0.06;
  return {
    x: s.position.x + fwd.x * 0.3 + right.x * side * 0.3 + s.velocity.x * lead,
    y,
    z: s.position.z + fwd.z * 0.3 + right.z * side * 0.3 + s.velocity.z * lead,
  };
}

/** Before the physics step: drive a possessed ball, advance dribble and timers. */
export function updateBallPrePhysics(ctx: BallContext): void {
  const { ball, physics } = ctx;
  ball.prevPosition = physics.getBallPosition();

  if (ball.ignoreCharactersTimer > 0) {
    ball.ignoreCharactersTimer -= SIM_DT;
    if (ball.ignoreCharactersTimer <= 0 && ball.holder === null) physics.setBallCollision('all');
  }

  const holder = ctx.chars.find((c) => c.id === ball.holder);
  if (!holder) return;

  if (ball.gatherTimer > 0) {
    ball.gatherTimer = Math.max(0, ball.gatherTimer - SIM_DT);
  } else if (holder.state.action.kind !== 'shoot') {
    // Auto-dribble; cadence follows locomotion state (spec §41).
    ball.dribblePhase = (ball.dribblePhase + DRIBBLE_HZ[holder.state.locomotion] * SIM_DT) % 1;
    // Hand selection by lateral movement relative to facing, switched only while the ball is up.
    const fwd = facingToVec(holder.state.facing);
    const lateral = -holder.state.velocity.x * fwd.z + holder.state.velocity.z * fwd.x; // + = moving right
    const inHand = ball.dribblePhase < 0.08 || ball.dribblePhase > 0.92;
    if (inHand && Math.abs(lateral) > 1.2) ball.hand = lateral > 0 ? 'right' : 'left';
  }
  physics.setBallKinematicTarget(possessedBallPosition(holder, ball));
}

/** Releases a jump shot from the holder (spec §37–38). */
export function releaseShot(ctx: BallContext, shooter: KinematicCharacterController): void {
  const { ball, physics, rng } = ctx;
  const s = shooter.state;
  if (s.action.kind !== 'shoot' || s.action.released || ball.holder !== s.id) return;
  s.action.released = true;

  const error = s.action.t - idealReleaseTime(s.action.jumpV0);
  const timing = gradeTiming(error);
  const contest = shotContest(ctx.chars, shooter);
  const probability = shotProbability({
    attrs: shooter.definition.attributes,
    x: s.position.x,
    z: s.position.z,
    timing,
    movementSpeed: Math.hypot(s.velocity.x, s.velocity.z),
    contest,
    shotType: s.action.shotType,
  });
  const intendedMake =
    ctx.shotOutcome.mode === 'forced' ? ctx.shotOutcome.result === 'make' : rng.next() < probability;

  const from = possessedBallPosition(shooter, ball);
  // Right under the basket the set point would be beneath the ring; release from just outside it.
  const minRadial = COURT.rimRadius + COURT.ballRadius + 0.2;
  const radial = Math.hypot(from.x - RIM_CENTER.x, from.z - RIM_CENTER.z);
  if (radial < minRadial) {
    const away = radial > 1e-3
      ? { x: (from.x - RIM_CENTER.x) / radial, z: (from.z - RIM_CENTER.z) / radial }
      : { x: Math.sin(s.facing + Math.PI), z: Math.cos(s.facing + Math.PI) };
    from.x = RIM_CENTER.x + away.x * minRadial;
    from.z = RIM_CENTER.z + away.z * minRadial;
  }
  const distance = Math.hypot(s.position.x - RIM_CENTER.x, s.position.z - RIM_CENTER.z);
  const aim = shotAimPoint(intendedMake, from, rng);
  const vel = solveLaunch(from, aim, launchAngle(Math.hypot(aim.x - from.x, aim.z - from.z)));

  ball.holder = null;
  ball.passTarget = null;
  ball.ignoreCharactersTimer = 0.35;
  s.pickupCooldown = 0.6;
  physics.releaseBall(from, vel);

  const three = isThreePoint(s.position.x, s.position.z);
  ball.shot = { shooter: s.id, releaseTick: ctx.tick, probability, timing, intendedMake, distance, three, resolved: false };
  ctx.stats.attempts++;
  ctx.emit({ type: 'shot.released', actor: s.id, timing, timingError: error, probability, distance, three, contest });
}

/**
 * How contested a shot is (0 open … 1 smothered): closest opponent, weighted by
 * whether he is between the shooter and the rim, his defensive skill and length.
 */
export function shotContest(chars: KinematicCharacterController[], shooter: KinematicCharacterController): number {
  const s = shooter.state;
  const toRim = { x: RIM_CENTER.x - s.position.x, z: RIM_CENTER.z - s.position.z };
  const l = Math.hypot(toRim.x, toRim.z) || 1;
  let best = 0;
  for (const c of chars) {
    if (c.state.team === s.team) continue;
    const dx = c.state.position.x - s.position.x;
    const dz = c.state.position.z - s.position.z;
    const d = Math.hypot(dx, dz);
    const inFront = (dx * toRim.x + dz * toRim.z) / (d * l || 1) > 0.2;
    const skill = 0.8 + 0.4 * (Math.max(c.definition.attributes.defense.perimeter_defense, c.definition.attributes.defense.block) / 100);
    const length = c.state.height / 1.98;
    const closeness = clamp((1.9 - d) / 1.3, 0, 1);
    best = Math.max(best, clamp(closeness * (inFront ? 1 : 0.4) * skill * length, 0, 1));
  }
  return best;
}

/** Smart pass / lob to a teammate (spec §40). */
/** Where and when a pass should arrive (computed by the caller from the receiver's route). */
export interface PassPlan {
  /** Floor point the receiver will be at when the ball arrives. */
  at: { x: number; z: number };
  /** Flight time in seconds. */
  t: number;
  /** Alley-oop: arrive above the rim rather than at the chest. */
  oop?: boolean;
}

export function releasePass(
  ctx: BallContext,
  passer: KinematicCharacterController,
  target: KinematicCharacterController,
  lob: boolean,
  plan: PassPlan | null = null,
): void {
  const { ball, physics } = ctx;
  if (ball.holder !== passer.id || passer.state.action.kind === 'shoot') return;
  const p = passer.state;
  const r = target.state;
  const fwd = { x: r.position.x - p.position.x, z: r.position.z - p.position.z };
  const d = Math.hypot(fwd.x, fwd.z) || 1;
  // Smart pass (spec §40): go over the top when an opponent sits in the lane.
  // (Callers with a plan decide this before planning, so flight time and aim agree.)
  if (!plan && !lob && laneBlocker(ctx.chars, passer, target)) lob = true;
  const from: Vec3 = {
    x: p.position.x + (fwd.x / d) * 0.4,
    y: p.position.y + p.height * 0.62,
    z: p.position.z + (fwd.z / d) * 0.4,
  };
  let t = lob ? 0.7 + d * 0.08 : clamp(d / 11, 0.22, 1.1);
  // Lead the receiver by their current velocity.
  let to: Vec3 = {
    x: r.position.x + r.velocity.x * t,
    y: lob ? r.height * 1.05 : r.height * 0.62,
    z: r.position.z + r.velocity.z * t,
  };
  if (plan) {
    // Lead the receiver along his route (or to a spot above the rim for an alley-oop).
    t = plan.oop ? plan.t : lob ? Math.max(t, plan.t) : plan.t;
    to = { x: plan.at.x, y: plan.oop ? COURT.rimHeight + 0.25 : to.y, z: plan.at.z };
  } else {
    // No route known: a soft, capped lead so a decelerating receiver isn't overthrown.
    const lx = (to.x - r.position.x) * 0.5, lz = (to.z - r.position.z) * 0.5;
    const ll = Math.hypot(lx, lz);
    const k = ll > 1.2 ? 1.2 / ll : 1;
    to.x = r.position.x + lx * k;
    to.z = r.position.z + lz * k;
  }
  const vel: Vec3 = {
    x: (to.x - from.x) / t,
    y: (to.y - from.y + 0.5 * GRAVITY * t * t) / t,
    z: (to.z - from.z) / t,
  };
  p.facing = Math.atan2(fwd.x, fwd.z);
  ball.holder = null;
  ball.passTarget = r.id;
  ball.shot = null;
  ball.ignoreCharactersTimer = 0.2;
  p.pickupCooldown = 0.5;
  physics.releaseBall(from, vel);
  ctx.emit({ type: 'pass.released', actor: p.id, target: r.id, lob });
}

/** The opponent standing in the straight passing lane between two players, if any. */
export function laneBlocker(
  chars: KinematicCharacterController[],
  passer: KinematicCharacterController,
  target: KinematicCharacterController,
): KinematicCharacterController | undefined {
  const a = passer.state.position;
  const b = target.state.position;
  const abx = b.x - a.x, abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  return chars.find((c) => {
    if (c.state.team === passer.state.team) return false;
    const t = ((c.state.position.x - a.x) * abx + (c.state.position.z - a.z) * abz) / len2;
    if (t < 0.08 || t > 0.92) return false;
    const px = a.x + abx * t - c.state.position.x;
    const pz = a.z + abz * t - c.state.position.z;
    return Math.hypot(px, pz) < c.state.radius + 0.45;
  });
}

export function giveBall(ctx: BallContext, c: KinematicCharacterController, via: 'pickup' | 'catch'): void {
  const { ball } = ctx;
  if (ball.shot && !ball.shot.resolved) resolveMiss(ctx);
  ball.holder = c.id;
  ball.passTarget = null;
  ball.gatherTimer = via === 'catch' ? 0.25 : 0.12;
  ball.dribblePhase = 0;
  ball.ignoreCharactersTimer = 0;
  if (via === 'catch') {
    const a = c.state.action;
    // Airborne catch keeps the jump going (alley-oop); otherwise a normal catch.
    if (a.kind === 'catch' && a.air) ball.gatherTimer = 0.04;
    else c.setAction({ kind: 'catch', t: 0 });
  }
  ctx.physics.setBallKinematicTarget(possessedBallPosition(c, ball));
  ctx.emit({ type: 'possession.gained', actor: c.id, via });
}

function resolveMiss(ctx: BallContext): void {
  const shot = ctx.ball.shot!;
  shot.resolved = true;
  ctx.emit({ type: 'shot.missed', actor: shot.shooter });
}

/** After the physics step: scoring, catches, loose-ball pickups. */
export function updateBallPostPhysics(ctx: BallContext): void {
  const { ball, physics } = ctx;
  if (ball.holder !== null) return;
  const pos = physics.getBallPosition();

  // Made basket: ball center crosses the rim plane downward inside the cylinder.
  const shot = ball.shot;
  if (shot && !shot.resolved) {
    const prev = ball.prevPosition;
    if (prev.y >= RIM_CENTER.y && pos.y < RIM_CENTER.y) {
      const t = (prev.y - RIM_CENTER.y) / (prev.y - pos.y || 1);
      const cx = prev.x + (pos.x - prev.x) * t;
      const cz = prev.z + (pos.z - prev.z) * t;
      if (Math.hypot(cx - RIM_CENTER.x, cz - RIM_CENTER.z) < COURT.rimRadius) {
        shot.resolved = true;
        ctx.stats.makes++;
        ctx.stats.points += shot.three ? 3 : 2;
        ctx.emit({ type: 'shot.made', actor: shot.shooter, three: shot.three });
      }
    }
    if (!shot.resolved) {
      const elapsed = (ctx.tick - shot.releaseTick) * SIM_DT;
      if (pos.y < COURT.ballRadius + 0.05 || elapsed > 5) resolveMiss(ctx);
    }
  }

  // A pass that hits the floor or dies out is a loose ball.
  if (ball.passTarget !== null && pos.y < COURT.ballRadius + 0.05) ball.passTarget = null;

  for (const c of ctx.chars) {
    const s = c.state;
    if (s.action.kind === 'shoot') continue;
    const horiz = Math.hypot(pos.x - s.position.x, pos.z - s.position.z);
    // A pass in flight belongs to its receiver; others can only deflect it physically.
    if (ball.passTarget !== null && ball.passTarget !== s.id) continue;
    if (ball.passTarget === s.id) {
      if (horiz < s.radius + 0.75 && pos.y > 0.2 && pos.y < s.position.y + s.height * 1.32 + 0.1) {
        giveBall(ctx, c, 'catch');
        return;
      }
    } else if (s.pickupCooldown <= 0 && horiz < s.radius + 0.35 && pos.y < s.height * 0.8) {
      giveBall(ctx, c, 'pickup');
      return;
    }
  }
}
