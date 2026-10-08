/**
 * NBA half-court dimensions in meters.
 *
 * Coordinate convention (spec §8):
 *   origin = basket (rim) center projected onto the floor
 *   +x = right side of court, -x = left side
 *   +z = away from basket
 *   y  = height
 */
export const COURT = {
  halfWidth: 7.62, // 50 ft wide
  baselineZ: -1.575, // rim center is 5.25 ft from the baseline
  halfCourtZ: 12.75, // 47 ft from the baseline

  rimHeight: 3.048,
  rimRadius: 0.2286, // 18 in inner diameter
  rimTubeRadius: 0.01,

  backboardFrontZ: -0.38, // 15 in from backboard face to near rim edge
  backboardThickness: 0.05,
  backboardWidth: 1.83,
  backboardHeight: 1.07,
  backboardBottomY: 2.9,

  laneHalfWidth: 2.44, // 16 ft lane
  freeThrowZ: 4.215, // 19 ft from the baseline
  freeThrowCircleRadius: 1.83,
  restrictedAreaRadius: 1.22,

  threePointRadius: 7.24, // 23.75 ft
  threePointCornerX: 6.706, // 22 ft
  /** z at which the corner straight lines meet the arc */
  get threePointCornerZ(): number {
    return Math.sqrt(this.threePointRadius ** 2 - this.threePointCornerX ** 2);
  },

  ballRadius: 0.12,
  ballMass: 0.62,
} as const;

export const RIM_CENTER = { x: 0, y: COURT.rimHeight, z: 0 } as const;

/** Whether a floor point is beyond the three-point line. */
export function isThreePoint(x: number, z: number): boolean {
  if (z <= COURT.threePointCornerZ) return Math.abs(x) >= COURT.threePointCornerX;
  return Math.hypot(x, z) >= COURT.threePointRadius;
}
