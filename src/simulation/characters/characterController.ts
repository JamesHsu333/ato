import type { CharacterDefinition, MotionProfile } from '../../domain/characters/definition';
import { MOTION_PROFILES } from '../../domain/characters/definition';
import { angleDelta, clamp, facingToVec, len2, vecToFacing, type Vec2, type Vec3 } from '../../domain/math/vec';
import { COURT } from '../../domain/court/dimensions';
import type { CharacterAction, CharacterState, Locomotion, Team } from '../runtime/types';

export interface DesiredMovement {
  /** World xz direction, magnitude 0..1. */
  direction: Vec2;
  sprint: boolean;
}

/** Runtime control surface for a character (spec §63). */
export interface CharacterController {
  readonly id: string;
  getPosition(): Vec3;
  getVelocity(): Vec3;
  setDesiredMovement(movement: DesiredMovement): void;
  setFacing(direction: Vec2 | null): void;
  setAction(action: CharacterAction): void;
}

export function createCharacterState(def: CharacterDefinition, id: string, team: Team, pos: Vec2, facing: number): CharacterState {
  return {
    id,
    definitionId: def.id,
    team,
    radius: def.dimensions.collisionRadius,
    height: def.dimensions.height,
    position: { x: pos.x, y: 0, z: pos.z },
    velocity: { x: 0, y: 0, z: 0 },
    facing,
    desiredMove: { x: 0, z: 0 },
    desiredSprint: false,
    desiredFacing: null,
    locomotion: 'idle',
    action: { kind: 'none' },
    stride: 0,
    pickupCooldown: 0,
    pose: 'none',
  };
}

/**
 * Kinematic character controller. Wraps a plain CharacterState (which is what gets
 * snapshotted) together with its static definition.
 */
export class KinematicCharacterController implements CharacterController {
  constructor(
    public state: CharacterState,
    public readonly definition: CharacterDefinition,
  ) {}

  get id(): string {
    return this.state.id;
  }

  get motion(): MotionProfile {
    return MOTION_PROFILES[this.definition.motionProfile] ?? MOTION_PROFILES.athletic;
  }

  getPosition(): Vec3 {
    return { ...this.state.position };
  }

  getVelocity(): Vec3 {
    return { ...this.state.velocity };
  }

  setDesiredMovement(m: DesiredMovement): void {
    const l = len2(m.direction);
    this.state.desiredMove = l > 1 ? { x: m.direction.x / l, z: m.direction.z / l } : { ...m.direction };
    this.state.desiredSprint = m.sprint;
  }

  setFacing(direction: Vec2 | null): void {
    this.state.desiredFacing = direction && len2(direction) > 1e-6 ? vecToFacing(direction) : null;
  }

  setAction(action: CharacterAction): void {
    this.state.action = action;
  }

  runSpeed(): number {
    return 3.2 + 2.6 * (this.definition.attributes.physical.speed / 100);
  }

  /** Integrates desired motion for one fixed step. */
  integrate(dt: number, hasBall: boolean): void {
    const s = this.state;
    const attrs = this.definition.attributes.physical;
    const motion = this.motion;

    const locked = s.action.kind === 'shoot';
    let maxSpeed = this.runSpeed() * (s.desiredSprint ? 1.3 : 1);
    if (hasBall) maxSpeed *= 0.92;
    const target = locked ? { x: 0, z: 0 } : { x: s.desiredMove.x * maxSpeed, z: s.desiredMove.z * maxSpeed };

    let accel = 6 + 14 * (attrs.acceleration / 100);
    if (motion.acceleration.style === 'abrupt') accel *= 1.4;
    const stopping = len2(target) < len2({ x: s.velocity.x, z: s.velocity.z });
    if (stopping) accel *= motion.stopping.style === 'hard' ? 2.2 : 1.4;
    if (locked) accel *= 2.5; // gather and rise: momentum dies quickly once the shot starts

    const dvx = target.x - s.velocity.x;
    const dvz = target.z - s.velocity.z;
    const dvl = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    const k = dvl > maxDv ? maxDv / dvl : 1;
    s.velocity.x += dvx * k;
    s.velocity.z += dvz * k;

    s.position.x += s.velocity.x * dt;
    s.position.z += s.velocity.z * dt;
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    s.stride += speed * dt;

    // Facing: explicit desired facing wins, otherwise face the direction of travel.
    let wantFacing: number | null = s.desiredFacing;
    if (wantFacing === null && speed > 0.4) wantFacing = vecToFacing({ x: s.velocity.x, z: s.velocity.z });
    if (wantFacing !== null) {
      const turnRate = 6 + 10 * (attrs.agility / 100);
      const d = angleDelta(s.facing, wantFacing);
      s.facing += clamp(d, -turnRate * dt, turnRate * dt);
    }

    s.locomotion = classifyLocomotion(speed, this.runSpeed());
    if (s.pickupCooldown > 0) s.pickupCooldown = Math.max(0, s.pickupCooldown - dt);
    clampToCourt(s);
  }

  forward(): Vec2 {
    return facingToVec(this.state.facing);
  }
}

export function classifyLocomotion(speed: number, runSpeed: number): Locomotion {
  if (speed < 0.3) return 'idle';
  if (speed < 2.2) return 'walk';
  if (speed <= runSpeed * 1.05) return 'run';
  return 'sprint';
}

function clampToCourt(s: CharacterState): void {
  const margin = 1.2;
  s.position.x = clamp(s.position.x, -COURT.halfWidth - margin, COURT.halfWidth + margin);
  s.position.z = clamp(s.position.z, COURT.baselineZ - margin, COURT.halfCourtZ + margin);
}
