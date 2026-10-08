import { COURT, RIM_CENTER, isThreePoint } from '../../domain/court/dimensions';
import type { PlayerAttributes } from '../../domain/characters/definition';
import { clamp, type Vec3 } from '../../domain/math/vec';
import type { Rng } from '../../domain/math/rng';
import { GRAVITY, type ShotTiming } from '../runtime/types';

/** Seconds spent gathering before leaving the floor on a jump shot. */
export const SHOT_GATHER = 0.12;

export function jumpVelocity(attrs: PlayerAttributes): number {
  const jumpHeight = 0.2 + 0.35 * (attrs.physical.jump / 100);
  return Math.sqrt(2 * GRAVITY * jumpHeight);
}

/** Time from pressing shoot to the apex of the jump: the ideal release point. */
export const idealReleaseTime = (jumpV0: number): number => SHOT_GATHER + jumpV0 / GRAVITY;

/** Total time from press to landing. */
export const shotDuration = (jumpV0: number): number => SHOT_GATHER + (2 * jumpV0) / GRAVITY;

export function jumpHeightAt(t: number, jumpV0: number): number {
  const ta = t - SHOT_GATHER;
  if (ta <= 0) return 0;
  return Math.max(0, jumpV0 * ta - 0.5 * GRAVITY * ta * ta);
}

export function gradeTiming(error: number): ShotTiming {
  const a = Math.abs(error);
  if (a <= 0.04) return 'EXCELLENT';
  if (a <= 0.1) return error < 0 ? 'SLIGHTLY EARLY' : 'SLIGHTLY LATE';
  return error < 0 ? 'EARLY' : 'LATE';
}

const TIMING_FACTOR: Record<ShotTiming, number> = {
  EXCELLENT: 1.2,
  'SLIGHTLY EARLY': 0.95,
  'SLIGHTLY LATE': 0.95,
  EARLY: 0.55,
  LATE: 0.55,
};

export interface ShotContext {
  attrs: PlayerAttributes;
  /** Floor position of the shooter. */
  x: number;
  z: number;
  timing: ShotTiming;
  /** Horizontal speed of the shooter at release (m/s). */
  movementSpeed: number;
  /** 0 = wide open, 1 = fully contested. */
  contest: number;
  shotType?: string;
}

/** Shot type multipliers (spec §38): rim attacks are easier than pull-ups. */
const SHOT_TYPE_FACTOR: Record<string, number> = {
  dunk: 1.5,
  layup: 1.15,
  floater: 0.85,
  pull_up: 0.95,
  pull_up_three: 0.95,
  catch_and_shoot: 1.08,
};

/**
 * Shot quality model (spec §38). Produces a make probability; the physics engine
 * then decides the actual trajectory outcome.
 */
export function shotProbability(ctx: ShotContext): number {
  const d = Math.hypot(ctx.x, ctx.z);
  const three = isThreePoint(ctx.x, ctx.z);
  let base: number;
  let skill: number;
  if (d < 2.5) {
    base = 0.62 - 0.06 * d;
    skill = ctx.attrs.offense.finishing;
  } else if (!three) {
    base = 0.46 - 0.012 * (d - 2.5);
    skill = ctx.attrs.offense.midrange;
  } else {
    base = 0.37 - 0.05 * Math.max(0, d - 7.5);
    skill = ctx.attrs.offense.three_point;
  }
  const skillFactor = 0.6 + 0.6 * (skill / 100);
  const movement = 1 - Math.min(0.45, ctx.movementSpeed * 0.07);
  const contest = 1 - 0.6 * clamp(ctx.contest, 0, 1);
  // Dunks only count as dunks at the rim.
  const type = ctx.shotType === 'dunk' && d > 1.8 ? 'layup' : ctx.shotType;
  const typeFactor = type ? (SHOT_TYPE_FACTOR[type] ?? 1) : 1;
  return clamp(base * skillFactor * TIMING_FACTOR[ctx.timing] * movement * contest * typeFactor, 0.02, 0.97);
}

/** Launch angle (radians) used for a given horizontal distance to the rim. */
export function launchAngle(distance: number): number {
  // Close shots need a steep arc to clear the front of the rim on the way up.
  const deg = distance < 1.0 ? 78 : distance < 3.5 ? 70 - ((distance - 1.0) / 2.5) * 18 : 52;
  return (deg * Math.PI) / 180;
}

/**
 * Initial velocity that carries a projectile from `from` to `to` under gravity
 * with the given launch angle. Falls back to steeper angles if unreachable.
 */
export function solveLaunch(from: Vec3, to: Vec3, angle: number): Vec3 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = to.y - from.y;
  let theta = angle;
  for (let i = 0; i < 20; i++) {
    const denom = 2 * Math.cos(theta) ** 2 * (d * Math.tan(theta) - h);
    if (denom > 1e-4 && d > 1e-3) {
      const v = Math.sqrt((GRAVITY * d * d) / denom);
      const vh = v * Math.cos(theta);
      return { x: (dx / d) * vh, y: v * Math.sin(theta), z: (dz / d) * vh };
    }
    theta = Math.min(theta + 0.05, 1.53);
  }
  // Directly under the rim: pop it straight up to rim height.
  return { x: dx, y: Math.sqrt(2 * GRAVITY * Math.max(0.3, h + 0.3)), z: dz };
}

/**
 * Chooses the aim point at rim height. A make aims at the rim center; a miss aims
 * off the center by a random amount so physics produces a realistic rim-out or airball.
 */
export function shotAimPoint(intendedMake: boolean, from: Vec3, rng: Rng): Vec3 {
  if (intendedMake) {
    const jitter = 0.03;
    return { x: RIM_CENTER.x + rng.range(-jitter, jitter), y: RIM_CENTER.y, z: RIM_CENTER.z + rng.range(-jitter, jitter) };
  }
  const toRim = { x: RIM_CENTER.x - from.x, z: RIM_CENTER.z - from.z };
  const l = Math.hypot(toRim.x, toRim.z) || 1;
  const fwd = { x: toRim.x / l, z: toRim.z / l };
  const side = { x: -fwd.z, z: fwd.x };
  const miss = rng.range(COURT.rimRadius * 0.95, COURT.rimRadius * 1.9);
  const roll = rng.next();
  // Long, short, or off to one side.
  const [f, s] = roll < 0.35 ? [1, 0] : roll < 0.7 ? [-1, 0] : roll < 0.85 ? [0, 1] : [0, -1];
  const jitter = rng.range(-0.06, 0.06);
  return {
    x: RIM_CENTER.x + fwd.x * (f * miss + jitter) + side.x * (s * miss + jitter),
    y: RIM_CENTER.y,
    z: RIM_CENTER.z + fwd.z * (f * miss + jitter) + side.z * (s * miss + jitter),
  };
}
