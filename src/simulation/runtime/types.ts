import type { Vec2, Vec3 } from '../../domain/math/vec';

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
export const GRAVITY = 9.81;

export type Team = 'offense' | 'defense';
export type CollisionMode = 'soft' | 'hard';
export type Locomotion = 'idle' | 'walk' | 'run' | 'sprint';
export type Hand = 'left' | 'right';
export type ShotTiming = 'EARLY' | 'SLIGHTLY EARLY' | 'EXCELLENT' | 'SLIGHTLY LATE' | 'LATE';

/** One-shot commands. Delivered to exactly one simulation step. */
export type SimCommand =
  | { kind: 'pass'; slot: number; lob: boolean }
  | { kind: 'switchControl' }
  | { kind: 'resetBall' };

/** Per-step input. Renderer-independent: already resolved into world space. */
export interface SimInput {
  /** Desired movement direction in world xz, magnitude 0..1. */
  move: Vec2;
  sprint: boolean;
  /** World-space floor point the mouse is aiming at, if any. */
  aim: Vec2 | null;
  shootHeld: boolean;
  commands: SimCommand[];
}

export const EMPTY_INPUT: SimInput = { move: { x: 0, z: 0 }, sprint: false, aim: null, shootHeld: false, commands: [] };

export type CharacterAction =
  | { kind: 'none' }
  | { kind: 'shoot'; t: number; jumpV0: number; released: boolean; shotType?: string }
  /** `air`: jump velocity when leaping for a high pass (alley-oop catch). */
  | { kind: 'catch'; t: number; air?: number };

/** Complete, cloneable runtime state of one character. */
export interface CharacterState {
  id: string;
  definitionId: string;
  team: Team;
  radius: number;
  height: number;
  /** y = height of the feet above the floor (non-zero while airborne). */
  position: Vec3;
  velocity: Vec3;
  facing: number;
  desiredMove: Vec2;
  desiredSprint: boolean;
  desiredFacing: number | null;
  locomotion: Locomotion;
  action: CharacterAction;
  /** Accumulated travel distance, used for gait phase. */
  stride: number;
  pickupCooldown: number;
  /** Presentation hint set by semantic actions (e.g. a planted screen). */
  pose: Pose;
  /** Defensive assignment (offensive actor id), if any. */
  assignment?: string;
}

export type Pose = 'none' | 'screen';

export interface ShotTracking {
  shooter: string;
  releaseTick: number;
  probability: number;
  timing: ShotTiming;
  intendedMake: boolean;
  distance: number;
  three: boolean;
  resolved: boolean;
}

export interface BallState {
  holder: string | null;
  hand: Hand;
  /** 0..1 position in the dribble cycle (0 = in hand, 0.5 = at the floor). */
  dribblePhase: number;
  /** Seconds the holder keeps the ball gathered (catch, before dribbling). */
  gatherTimer: number;
  /** While > 0 the loose ball ignores character colliders (just released). */
  ignoreCharactersTimer: number;
  passTarget: string | null;
  shot: ShotTracking | null;
  /** Position at the previous step, for rim-plane crossing detection. */
  prevPosition: Vec3;
}

export type SimEvent =
  | { type: 'possession.gained'; actor: string; via: 'pickup' | 'catch' }
  | { type: 'pass.released'; actor: string; target: string; lob: boolean }
  | {
      type: 'shot.released';
      actor: string;
      timing: ShotTiming;
      timingError: number;
      probability: number;
      distance: number;
      three: boolean;
      contest: number;
    }
  | { type: 'shot.made'; actor: string; three: boolean }
  | { type: 'shot.missed'; actor: string }
  | { type: 'control.changed'; actor: string }
  /** Named basketball events consumed by the play graph, e.g. "handler.clears_screen". */
  | { type: 'play.event'; name: string };

export interface SimStats {
  attempts: number;
  makes: number;
  points: number;
}

/** Interpolated, renderer-facing view of a character. */
export interface CharacterRenderState {
  id: string;
  definitionId: string;
  team: Team;
  position: Vec3;
  velocity: Vec3;
  facing: number;
  locomotion: Locomotion;
  action: CharacterAction['kind'];
  actionTime: number;
  hasBall: boolean;
  dribbleHand: Hand | null;
  stride: number;
  controlled: boolean;
  pose: Pose;
}

export interface BallRenderState {
  position: Vec3;
  holder: string | null;
}

export interface RenderState {
  characters: CharacterRenderState[];
  ball: BallRenderState;
}
