/** Plain-data vector types. Domain and simulation code never uses Three.js math objects. */
export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vec2 = (x = 0, z = 0): Vec2 => ({ x, z });

export const len2 = (v: Vec2): number => Math.hypot(v.x, v.z);
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

export function normalize2(v: Vec2): Vec2 {
  const l = len2(v);
  return l > 1e-9 ? { x: v.x / l, z: v.z / l } : { x: 0, z: 0 };
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** Shortest signed difference between two angles (radians), in [-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/**
 * Facing angle convention: angle 0 faces +z (away from the basket),
 * angle PI/2 faces +x. Direction vector = (sin a, cos a).
 */
export const facingToVec = (a: number): Vec2 => ({ x: Math.sin(a), z: Math.cos(a) });
export const vecToFacing = (v: Vec2): number => Math.atan2(v.x, v.z);
