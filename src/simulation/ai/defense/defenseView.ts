import type { CoverageName } from '../../../domain/play/schema/playDefinition';
import type { Vec2 } from '../../../domain/math/vec';
import type { WorldView } from '../world';

/**
 * Everything the defensive AI is allowed to see (spec §32): positions, velocities,
 * ball state, assignments, visible screen cues and its coverage policy. Built from
 * live state only; the play graph is intentionally unreachable from here (rule 7).
 */
export interface DefenseView extends WorldView {
  screens: { screener: string; defender: string; user: string | null; spot: Vec2; cleared: boolean }[];
  coverage: CoverageName;
  /** Pressure policy: off-ball defenders deny passes one pass away. */
  deny: boolean;
}

export interface DefenderIntent {
  id: string;
  move: Vec2;
  sprint: boolean;
  face: Vec2 | null;
}

/** The defensive "read" of an active ball screen. */
export interface PnrRead {
  handler: string;
  screener: string;
  onBall: string;
  big: string | null;
  /** Direction the handler is expected to attack (toward the screen side). */
  drive: Vec2;
  /** Seconds since the screen was recognized / since the handler cleared it. */
  t: number;
  clearedT: number | null;
}

/** Defensive AI memory (spec §45 "AI state"): plain data, snapshotted with the sim. */
export interface DefenseMemory {
  /** Reaction-delayed positions of offensive players. */
  perceived: Record<string, Vec2>;
  /** Assignment changes made during the possession (switches). */
  assignments: Record<string, string>;
  pnr: PnrRead | null;
  /** Help defender currently tagging the roller. */
  tagger: string | null;
}

export const createDefenseMemory = (): DefenseMemory => ({ perceived: {}, assignments: {}, pnr: null, tagger: null });
