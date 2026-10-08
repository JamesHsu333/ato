import { RIM_CENTER } from '../../../domain/court/dimensions';
import { normalize2, type Vec2 } from '../../../domain/math/vec';
import type { PlayerView } from '../world';

export type ScreenNavigation = 'over' | 'under' | 'through';

/**
 * Steering waypoint for a defender heading to `target` past offensive bodies.
 * 'over' fights over the top of a screen (away from the rim), 'under' slides
 * beneath it (rim side, with extra room), 'through' runs straight into it.
 */
export function navigate(self: PlayerView, target: Vec2, blockers: PlayerView[], how: ScreenNavigation): Vec2 {
  if (how === 'through') return target;
  const d = { x: target.x - self.position.x, z: target.z - self.position.z };
  const len = Math.hypot(d.x, d.z);
  if (len < 0.3) return target;
  const dir = { x: d.x / len, z: d.z / len };
  let best: { t: number; o: PlayerView } | null = null;
  for (const o of blockers) {
    const rel = { x: o.position.x - self.position.x, z: o.position.z - self.position.z };
    const t = rel.x * dir.x + rel.z * dir.z;
    if (t <= 0 || t > len + 0.3) continue;
    const off = Math.abs(rel.x * dir.z - rel.z * dir.x);
    if (off < o.radius + self.radius + 0.2 && (!best || t < best.t)) best = { t, o };
  }
  if (!best) return target;
  const o = best.o;
  const n1 = { x: -dir.z, z: dir.x };
  const awayFromRim = normalize2({ x: o.position.x - RIM_CENTER.x, z: o.position.z - RIM_CENTER.z });
  const overSide = n1.x * awayFromRim.x + n1.z * awayFromRim.z >= 0 ? n1 : { x: -n1.x, z: -n1.z };
  const side = how === 'over' ? overSide : { x: -overSide.x, z: -overSide.z };
  const clearance = o.radius + self.radius + (how === 'under' ? 0.9 : 0.3);
  return { x: o.position.x + side.x * clearance, z: o.position.z + side.z * clearance };
}
