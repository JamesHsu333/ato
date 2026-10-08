import type { Vec2 } from '../../math/vec';

export interface CubicSegment {
  p0: Vec2;
  c1: Vec2;
  c2: Vec2;
  p1: Vec2;
}

/**
 * Smooth path through the given points as cubic Bezier segments (Catmull-Rom
 * converted to Bezier). This is the default movement path (spec §25); the editor
 * can later expose c1/c2 as handles.
 */
export function bezierThrough(points: Vec2[], tension = 0.5): CubicSegment[] {
  const segs: CubicSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const prev = points[i - 1] ?? p0;
    const next = points[i + 2] ?? p1;
    const k = tension / 3;
    segs.push({
      p0,
      c1: { x: p0.x + (p1.x - prev.x) * k, z: p0.z + (p1.z - prev.z) * k },
      c2: { x: p1.x - (next.x - p0.x) * k, z: p1.z - (next.z - p0.z) * k },
      p1,
    });
  }
  return segs;
}

export function evalCubic(s: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p1.x, z: a * s.p0.z + b * s.c1.z + c * s.c2.z + d * s.p1.z };
}

/** Samples a smooth path as a polyline with roughly `spacing` meters between points. */
export function samplePath(points: Vec2[], spacing = 0.25): Vec2[] {
  if (points.length < 2) return points.slice();
  const out: Vec2[] = [points[0]];
  for (const seg of bezierThrough(points)) {
    const approxLen = Math.hypot(seg.p1.x - seg.p0.x, seg.p1.z - seg.p0.z);
    const n = Math.max(2, Math.ceil(approxLen / spacing));
    for (let i = 1; i <= n; i++) out.push(evalCubic(seg, i / n));
  }
  return out;
}

export function polylineLength(pts: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return l;
}
