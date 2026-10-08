import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three';
import type { MotionProfile, SpriteCharacterRenderer as SpriteConfig, SpriteDirection } from '../../../domain/characters/definition';
import { clamp } from '../../../domain/math/vec';
import type { CharacterRenderState } from '../../../simulation/runtime/types';
import type { CharacterRenderer, ViewContext } from '../types';
import { createMascotTextures, MASCOT_ASPECT } from './proceduralMascot';
import { spriteDirection } from './spriteDirection';

const DIRECTIONS: SpriteDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Fallback order when a direction image is missing: nearest available view. */
const FALLBACK: Record<SpriteDirection, SpriteDirection[]> = {
  S: ['S', 'SE', 'SW', 'E', 'W', 'N'],
  SE: ['SE', 'S', 'E', 'SW', 'NE', 'N'],
  E: ['E', 'SE', 'NE', 'S', 'N', 'W'],
  NE: ['NE', 'N', 'E', 'NW', 'SE', 'S'],
  N: ['N', 'NE', 'NW', 'E', 'W', 'S'],
  NW: ['NW', 'N', 'W', 'NE', 'SW', 'S'],
  W: ['W', 'SW', 'NW', 'S', 'N', 'E'],
  SW: ['SW', 'S', 'W', 'SE', 'NW', 'N'],
};

const CADENCE = { slow: 0.75, normal: 1, fast: 1.3 } as const;

/**
 * Cylindrical-billboard sprite character (spec §12.2–14). The image shown depends
 * on world facing relative to the camera; movement is animated procedurally from
 * the motion profile (bob, hop, squash/stretch, lean).
 */
export class SpriteCharacterRenderer implements CharacterRenderer {
  readonly object = new Group();
  private readonly yaw = new Group();
  private readonly tilt = new Group();
  private readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private textures: Partial<Record<SpriteDirection, Texture>> = {};
  private owned: Texture[] = [];
  private current: SpriteDirection | null = null;
  private squashVel = 0;
  private squash = 0;
  private prevSpeed = 0;
  private prevY = 0;
  private baseScale = { x: 1, y: 1 };

  constructor(
    config: SpriteConfig,
    private readonly height: number,
    private readonly motion: MotionProfile,
    accent: string,
  ) {
    let aspect = MASCOT_ASPECT;
    if (config.directions && Object.keys(config.directions).length > 0) {
      const loader = new TextureLoader();
      for (const d of DIRECTIONS) {
        const url = config.directions[d];
        if (!url) continue;
        const t = loader.load(url, (tex) => {
          const img = tex.image as { width: number; height: number };
          if (img?.width && img?.height) this.setAspect(img.width / img.height);
        });
        t.colorSpace = SRGBColorSpace;
        this.textures[d] = t;
        this.owned.push(t);
      }
      aspect = 1;
    } else {
      this.textures = createMascotTextures(config.tint ?? '#f4f1ea', accent);
      this.owned = Object.values(this.textures);
    }

    const geo = new PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0); // pivot at the feet
    this.mesh = new Mesh(geo, new MeshBasicMaterial({ transparent: true, alphaTest: 0.08, side: DoubleSide }));
    this.setAspect(aspect);
    this.tilt.add(this.mesh);
    this.yaw.add(this.tilt);
    this.object.add(this.yaw);
  }

  private setAspect(aspect: number): void {
    this.mesh.scale.set(this.height * aspect, this.height, 1);
    this.baseScale = { x: this.height * aspect, y: this.height };
  }

  update(s: CharacterRenderState, view: ViewContext): void {
    const cam = view.cameraPosition;
    this.object.position.set(s.position.x, 0, s.position.z);

    // Billboard toward the camera around Y, then tilt back so steep cameras still see it.
    const dx = cam.x - s.position.x;
    const dz = cam.z - s.position.z;
    const horiz = Math.hypot(dx, dz);
    this.yaw.rotation.y = Math.atan2(dx, dz);
    const pitch = Math.atan2(cam.y - this.height * 0.5, horiz);
    this.tilt.rotation.x = -clamp(pitch, 0, 1.4) * 0.85;

    // Directional image.
    const dir = spriteDirection(s.facing, s.position, cam);
    if (dir !== this.current) {
      const tex = FALLBACK[dir].map((d) => this.textures[d]).find(Boolean);
      if (tex) {
        this.mesh.material.map = tex;
        this.mesh.material.needsUpdate = true;
      }
      this.current = dir;
    }

    // Procedural motion.
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    const loco = this.motion.locomotion;
    const cadence = CADENCE[loco.cadence];
    const phase = (s.stride / (this.height * 0.55)) * Math.PI * cadence;
    const moving = clamp(speed / 3, 0, 1);
    const bob =
      loco.style === 'hop'
        ? Math.abs(Math.sin(phase)) * loco.bob_height * 2 * moving
        : Math.abs(Math.sin(phase)) * loco.bob_height * moving;
    const sway = loco.style === 'waddle' ? Math.sin(phase) * 0.12 * moving : Math.sin(phase) * 0.04 * moving;

    // Squash/stretch spring: impulses on landing, hard stops and jump take-off.
    const dt = Math.min(view.dt, 0.05);
    const decel = (this.prevSpeed - speed) / Math.max(dt, 1e-3);
    if (this.motion.stopping.style === 'hard' && decel > 12) this.squashVel -= 0.4;
    if (this.prevY > 0.02 && s.position.y <= 0.001) this.squashVel -= 1.2; // landing
    this.prevSpeed = speed;
    this.prevY = s.position.y;
    this.squashVel += (-this.squash * 220 - this.squashVel * 16) * dt;
    this.squash += this.squashVel * dt;
    const hopSquash = loco.style === 'hop' ? -Math.cos(phase * 2) * loco.squash * moving : 0;
    const airStretch = s.position.y > 0.02 ? 0.06 : 0;
    const sq = clamp(this.squash + hopSquash + airStretch, -0.25, 0.25);

    this.mesh.scale.set(this.baseScale.x * (1 - sq * 0.6), this.baseScale.y * (1 + sq), 1);
    this.mesh.position.y = s.position.y + bob;

    // Lean into screen-lateral motion.
    const rightX = Math.cos(this.yaw.rotation.y);
    const rightZ = -Math.sin(this.yaw.rotation.y);
    const lateral = s.velocity.x * rightX + s.velocity.z * rightZ;
    this.mesh.rotation.z = clamp(-lateral * 0.035, -0.2, 0.2) + sway;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    for (const t of this.owned) t.dispose();
  }
}
