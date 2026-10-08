import { COURT } from './dimensions';
import type { Vec2 } from '../math/vec';

/** Semantic court locations (spec §9). Used by the play DSL later. */
export const SEMANTIC_SPOTS = {
  rim: { x: 0, z: 0 },
  restricted_area: { x: 0, z: 0.9 },
  left_block: { x: -2.6, z: 1.0 },
  right_block: { x: 2.6, z: 1.0 },
  left_elbow: { x: -COURT.laneHalfWidth, z: COURT.freeThrowZ },
  right_elbow: { x: COURT.laneHalfWidth, z: COURT.freeThrowZ },
  top: { x: 0, z: 8.2 },
  left_slot: { x: -3.6, z: 7.4 },
  right_slot: { x: 3.6, z: 7.4 },
  left_wing: { x: -6.2, z: 4.8 },
  right_wing: { x: 6.2, z: 4.8 },
  left_corner: { x: -7.0, z: 0.4 },
  right_corner: { x: 7.0, z: 0.4 },
  short_corner_left: { x: -4.5, z: 0.3 },
  short_corner_right: { x: 4.5, z: 0.3 },
} as const satisfies Record<string, Vec2>;

export type SemanticSpot = keyof typeof SEMANTIC_SPOTS;

export function resolveSpot(spot: SemanticSpot, offset: [number, number] = [0, 0]): Vec2 {
  const p = SEMANTIC_SPOTS[spot];
  return { x: p.x + offset[0], z: p.z + offset[1] };
}
