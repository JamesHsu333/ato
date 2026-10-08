import type { SpriteDirection } from '../../../domain/characters/definition';
import type { Vec2 } from '../../../domain/math/vec';

/** View-relative directions, clockwise from "facing the camera". */
const ORDER: SpriteDirection[] = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];

/** Static-mode file names for each direction (spec §14). */
export const STATIC_SPRITE_FILES: Record<SpriteDirection, string> = {
  S: 'front',
  SE: 'front_right',
  E: 'right',
  NE: 'back_right',
  N: 'back',
  NW: 'back_left',
  W: 'left',
  SW: 'front_left',
};

/**
 * Signed angle of the character's facing relative to the camera, as seen on screen:
 * 0 = facing the camera, +PI/2 = facing screen-right, ±PI = facing away.
 */
export function viewRelativeAngle(facing: number, characterPos: Vec2, cameraPos: Vec2): number {
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);
  let cx = cameraPos.x - characterPos.x;
  let cz = cameraPos.z - characterPos.z;
  const l = Math.hypot(cx, cz);
  if (l < 1e-6) {
    // Camera straight overhead: treat "towards camera" as +z (screen-down in top-down view).
    cx = 0;
    cz = 1;
  } else {
    cx /= l;
    cz /= l;
  }
  // Screen-right for a camera looking along -c is (-c) × up = (cz, -cx).
  const rx = cz;
  const rz = -cx;
  return Math.atan2(fx * rx + fz * rz, fx * cx + fz * cz);
}

/** Picks which of the 8 directional sprites to show (spec §13). */
export function spriteDirection(facing: number, characterPos: Vec2, cameraPos: Vec2): SpriteDirection {
  const a = viewRelativeAngle(facing, characterPos, cameraPos);
  const sector = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return ORDER[sector];
}
