import type { CollisionMode } from '../runtime/types';
import type { KinematicCharacterController } from './characterController';

/**
 * Resolves character–character overlap (spec §16.2).
 *  soft: partial correction per step, players slide past each other (designer).
 *  hard: full separation and approach velocity removed, so bodies block routes
 *        (practice / read & react — screens must matter).
 * Stronger players are displaced less.
 */
export function resolveCharacterCollisions(chars: KinematicCharacterController[], mode: CollisionMode): void {
  const correction = mode === 'hard' ? 1 : 0.35;
  for (let i = 0; i < chars.length; i++) {
    for (let j = i + 1; j < chars.length; j++) {
      const a = chars[i].state;
      const b = chars[j].state;
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const minDist = a.radius + b.radius;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minDist * minDist) continue;
      const dist = Math.sqrt(distSq);
      // Deterministic fallback normal for exactly coincident players.
      const nx = dist > 1e-6 ? dx / dist : 1;
      const nz = dist > 1e-6 ? dz / dist : 0;
      const overlap = (minDist - dist) * correction;

      // A planted screener is effectively immovable.
      const sa = a.pose === 'screen' ? 1e4 : chars[i].definition.attributes.physical.strength;
      const sb = b.pose === 'screen' ? 1e4 : chars[j].definition.attributes.physical.strength;
      const wa = sb / (sa + sb); // share of the push applied to a
      const wb = 1 - wa;
      a.position.x -= nx * overlap * wa;
      a.position.z -= nz * overlap * wa;
      b.position.x += nx * overlap * wb;
      b.position.z += nz * overlap * wb;

      if (mode === 'hard') {
        const rel = (b.velocity.x - a.velocity.x) * nx + (b.velocity.z - a.velocity.z) * nz;
        if (rel < 0) {
          a.velocity.x += nx * rel * wa;
          a.velocity.z += nz * rel * wa;
          b.velocity.x -= nx * rel * wb;
          b.velocity.z -= nz * rel * wb;
        }
      }
    }
  }
}
