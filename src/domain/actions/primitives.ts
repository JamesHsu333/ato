import type { Vec2 } from '../math/vec';
import type { Condition } from '../conditions/condition';

/** A point resolved at runtime against live positions. */
export type TargetRef =
  | { kind: 'point'; x: number; z: number }
  | { kind: 'actor'; actor: string; point: ActorPoint; offset?: [number, number] }
  /** Screen spot next to a defender (spec §17): computed from live positions. */
  | { kind: 'screenSpot'; defender: string; side: 'left' | 'right' | 'auto' }
  /** A point relative to the actor's own position when the step starts (v-cut "in"). */
  | { kind: 'self'; toward: 'rim'; distance: number };

export type ActorPoint = 'center' | 'right_shoulder' | 'left_shoulder' | 'front' | 'back';

export type MoveSpeed = 'walk' | 'jog' | 'run' | 'sprint';

/** Low-level runtime primitives (spec §23). Semantic actions compile into these. */
export type PrimitiveAction =
  | {
      op: 'move';
      to: TargetRef;
      via: TargetRef[];
      /** Explicit path control points (editor override), replacing the auto path. */
      override?: Vec2[];
      /** Keep going past the last via point, turning toward the rim (drives). */
      continuePast?: number;
      speed: MoveSpeed;
      /** Extra event emitted on arrival, e.g. "screen_position_ready". */
      arriveEvent?: string;
    }
  | { op: 'face'; target: TargetRef }
  | { op: 'wait'; duration?: number; until?: Condition }
  | { op: 'hold'; until?: Condition; maxSeconds?: number }
  /** Pass to a teammate; `lead` throws to a spot instead of the receiver (alley-oop). */
  | { op: 'pass'; target: string; lob: boolean; lead?: TargetRef }
  /** Hand the ball to a teammate running by (dribble handoff). */
  | { op: 'handoff'; target: string }
  | { op: 'shoot'; shotType: string }
  | {
      op: 'screenPosition';
      /** Defender being screened; null = whoever guards `user`. */
      defender: string | null;
      /** Offensive player the screen is for; null = the defender's man. */
      user?: string;
      side: 'left' | 'right' | 'auto';
      angle: 'auto' | number;
      holdUntil?: Condition;
    }
  | { op: 'setPose'; pose: 'none' | 'screen' };
