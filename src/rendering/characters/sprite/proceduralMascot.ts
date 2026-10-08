import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import type { SpriteDirection } from '../../../domain/characters/definition';

const VIEW_ANGLE: Record<SpriteDirection, number> = {
  S: 0,
  SE: Math.PI / 4,
  E: Math.PI / 2,
  NE: (3 * Math.PI) / 4,
  N: Math.PI,
  NW: (-3 * Math.PI) / 4,
  W: -Math.PI / 2,
  SW: -Math.PI / 4,
};

export const MASCOT_ASPECT = 0.8; // width / height

/**
 * Draws a generic round mascot as seen from one of 8 view directions. This is the
 * built-in sprite character, so the sprite pipeline needs no external assets.
 */
export function drawMascot(dir: SpriteDirection, tint: string, accent: string): HTMLCanvasElement {
  const W = 256;
  const H = 320;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const a = VIEW_ANGLE[dir];
  const side = Math.sin(a); // + = facing screen-right
  const front = Math.cos(a); // + = facing the viewer
  const cx = W / 2;
  const outline = '#3b3530';
  g.lineWidth = 7;
  g.strokeStyle = outline;
  g.lineJoin = 'round';

  // Feet.
  g.fillStyle = tint;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + s * 42 + side * 10, H - 22, 30, 16, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  // Ears (drawn behind the head when seen from the front).
  const ear = (ox: number) => {
    g.beginPath();
    g.moveTo(cx + ox - 26, 70);
    g.lineTo(cx + ox + 2, 18);
    g.lineTo(cx + ox + 30, 70);
    g.closePath();
    g.fill();
    g.stroke();
  };
  g.fillStyle = tint;
  const earSpread = 58 * (0.55 + 0.45 * Math.abs(front));
  ear(-earSpread - side * 14);
  ear(earSpread - side * 14);

  // Body: one soft blob.
  g.beginPath();
  g.ellipse(cx, H / 2 + 26, 108, 128, 0, 0, Math.PI * 2);
  g.fillStyle = tint;
  g.fill();
  g.stroke();

  // Jersey band in the accent color.
  g.save();
  g.beginPath();
  g.ellipse(cx, H / 2 + 26, 104, 124, 0, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = accent;
  g.fillRect(0, H / 2 + 60, W, 46);
  g.restore();

  // Arms, shifted by view direction.
  g.fillStyle = tint;
  for (const s of [-1, 1]) {
    const visible = s * side > -0.75;
    if (!visible) continue;
    g.beginPath();
    g.ellipse(cx + s * (104 - Math.abs(side) * 26) + side * 18, H / 2 + 50, 22, 34, s * 0.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  if (front > -0.2) {
    // Face: features slide toward the facing side and compress near profile.
    const fx = cx + side * 62;
    const spread = 40 * Math.max(0.15, front);
    const eyeY = H / 2 - 18;
    g.fillStyle = outline;
    const eyes = Math.abs(side) > 0.9 ? [side > 0 ? 1 : -1] : [-1, 1];
    for (const s of eyes) {
      const ex = Math.abs(side) > 0.9 ? fx + s * 6 : fx + s * spread;
      g.beginPath();
      g.ellipse(ex, eyeY, 9 * Math.max(0.6, Math.abs(front) + 0.3), 13, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(ex + 3, eyeY - 5, 3.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = outline;
    }
    // Mouth.
    g.lineWidth = 5;
    g.beginPath();
    g.arc(fx + side * 6, eyeY + 26, 9, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    // Cheeks.
    g.fillStyle = 'rgba(240, 130, 140, 0.55)';
    for (const s of eyes) {
      g.beginPath();
      g.ellipse(fx + s * (spread + 22), eyeY + 22, 14, 8, 0, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // Back view: a small tail.
    g.fillStyle = tint;
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx - side * 30, H / 2 + 120, 18, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  return c;
}

export function createMascotTextures(tint: string, accent: string): Record<SpriteDirection, Texture> {
  const out = {} as Record<SpriteDirection, Texture>;
  for (const d of Object.keys(VIEW_ANGLE) as SpriteDirection[]) {
    const t = new CanvasTexture(drawMascot(d, tint, accent));
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    out[d] = t;
  }
  return out;
}
