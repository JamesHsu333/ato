import type { TargetRef } from '../../domain/actions/primitives';
import { normalize2, type Vec2 } from '../../domain/math/vec';
import { RIM_CENTER } from '../../domain/court/dimensions';
import { playerById, type PlayerView, type WorldView } from './world';

const SCREEN_GAP = 0.04;

/**
 * Screen spot (spec §17): beside the screened defender, on the side the ball
 * handler will attack. Side is from the screen user's point of view.
 */
export function screenSpot(w: WorldView, screener: PlayerView, defenderId: string, side: 'left' | 'right' | 'auto'): Vec2 | null {
  const d = playerById(w, defenderId);
  if (!d) return null;
  const userId = d.assignment ?? w.ball.holder;
  const u = userId ? playerById(w, userId) : undefined;
  const from = u?.position ?? { x: d.position.x, z: d.position.z + 1 };
  const f = normalize2({ x: d.position.x - from.x, z: d.position.z - from.z });
  const right = { x: -f.z, z: f.x };
  let s: number;
  if (side === 'auto') {
    const rel = (screener.position.x - d.position.x) * right.x + (screener.position.z - d.position.z) * right.z;
    s = rel >= 0 ? 1 : -1;
  } else s = side === 'right' ? 1 : -1;
  const dist = d.radius + screener.radius + SCREEN_GAP;
  return { x: d.position.x + right.x * s * dist, z: d.position.z + right.z * s * dist };
}

/**
 * Resolves a target against live positions. Actor points ("screener.right_shoulder")
 * are named as seen by the acting player looking at the target actor.
 */
export function resolveTarget(w: WorldView, self: PlayerView, t: TargetRef): Vec2 | null {
  switch (t.kind) {
    case 'point':
      return { x: t.x, z: t.z };
    case 'screenSpot':
      return screenSpot(w, self, t.defender, t.side);
    case 'self': {
      const toRim = normalize2({ x: RIM_CENTER.x - self.position.x, z: RIM_CENTER.z - self.position.z });
      return { x: self.position.x + toRim.x * t.distance, z: self.position.z + toRim.z * t.distance };
    }
    case 'actor': {
      const o = playerById(w, t.actor);
      if (!o) return null;
      const f = normalize2({ x: o.position.x - self.position.x, z: o.position.z - self.position.z });
      const right = { x: -f.z, z: f.x };
      const gap = o.radius + self.radius + 0.12;
      let p = { ...o.position };
      if (t.point === 'right_shoulder') p = { x: p.x + right.x * gap, z: p.z + right.z * gap };
      else if (t.point === 'left_shoulder') p = { x: p.x - right.x * gap, z: p.z - right.z * gap };
      else if (t.point === 'front') p = { x: p.x - f.x * gap, z: p.z - f.z * gap };
      else if (t.point === 'back') p = { x: p.x + f.x * gap, z: p.z + f.z * gap };
      if (t.offset) p = { x: p.x + t.offset[0], z: p.z + t.offset[1] };
      return p;
    }
  }
}

/** Whether a target moves with other players (and must be re-resolved every step). */
export const isDynamicTarget = (t: TargetRef): boolean => t.kind === 'actor' || t.kind === 'screenSpot';
