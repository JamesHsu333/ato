import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, BoxGeometry, Vector3, type Material } from 'three';
import { clamp } from '../../../domain/math/vec';
import type { CharacterRenderState } from '../../../simulation/runtime/types';
import type { CharacterRenderer, ViewContext } from '../types';

export interface HumanoidColors {
  jersey: string;
  shorts: string;
  skin: string;
}

interface Limb {
  upper: Group;
  lower: Group;
}

const SWING = { idle: 0, walk: 0.45, run: 0.85, sprint: 1.05 } as const;

/**
 * Built-in generic humanoid made from primitives, animated procedurally
 * (spec §65: animation is presentation; a rough but correct body is fine).
 * Local +z is forward, local -x is the character's right side.
 */
export class ProceduralHumanoidRenderer implements CharacterRenderer {
  readonly object = new Group();
  private readonly body = new Group();
  private readonly legs: Record<'left' | 'right', Limb>;
  private readonly arms: Record<'left' | 'right', Limb>;
  private readonly materials: Material[] = [];
  private readonly tmp = new Vector3();
  private crouch = 0;
  private phase = 0;
  private prevVel = { x: 0, z: 0 };
  private prevFacing: number | null = null;
  private lean = 0;
  private bank = 0;
  private shuffle = 0;

  constructor(
    private readonly height: number,
    colors: HumanoidColors,
  ) {
    const H = height;
    const mat = (color: string) => {
      const m = new MeshStandardMaterial({ color, roughness: 0.7 });
      this.materials.push(m);
      return m;
    };
    const skin = mat(colors.skin);
    const jersey = mat(colors.jersey);
    const shorts = mat(colors.shorts);
    const shoe = mat('#eeeeee');

    this.object.add(this.body);

    const torso = new Mesh(new BoxGeometry(0.25 * H, 0.3 * H, 0.13 * H), jersey);
    torso.position.y = 0.67 * H;
    const hips = new Mesh(new BoxGeometry(0.23 * H, 0.1 * H, 0.13 * H), shorts);
    hips.position.y = 0.5 * H;
    const head = new Mesh(new SphereGeometry(0.066 * H, 16, 12), skin);
    head.position.y = 0.915 * H;
    const neck = new Mesh(new CapsuleGeometry(0.025 * H, 0.03 * H, 4, 8), skin);
    neck.position.y = 0.845 * H;
    this.body.add(torso, hips, head, neck);

    const limb = (x: number, y: number, upperLen: number, lowerLen: number, r: number, upperMat: Material, lowerMat: Material, foot?: Material): Limb => {
      const upper = new Group();
      upper.position.set(x, y, 0);
      const um = new Mesh(new CapsuleGeometry(r, upperLen - 2 * r, 4, 8), upperMat);
      um.position.y = -upperLen / 2;
      upper.add(um);
      const lower = new Group();
      lower.position.y = -upperLen;
      const lm = new Mesh(new CapsuleGeometry(r * 0.85, lowerLen - 2 * r, 4, 8), lowerMat);
      lm.position.y = -lowerLen / 2;
      lower.add(lm);
      if (foot) {
        const f = new Mesh(new BoxGeometry(r * 2.2, r * 1.2, r * 4.2), foot);
        f.position.set(0, -lowerLen + r * 0.4, r * 1.2);
        lower.add(f);
      }
      upper.add(lower);
      this.body.add(upper);
      return { upper, lower };
    };
    const legLen = 0.25 * H;
    this.legs = {
      right: limb(-0.065 * H, 0.5 * H, legLen, legLen, 0.042 * H, shorts, skin, shoe),
      left: limb(0.065 * H, 0.5 * H, legLen, legLen, 0.042 * H, shorts, skin, shoe),
    };
    this.arms = {
      right: limb(-0.155 * H, 0.8 * H, 0.17 * H, 0.17 * H, 0.03 * H, jersey, skin),
      left: limb(0.155 * H, 0.8 * H, 0.17 * H, 0.17 * H, 0.03 * H, jersey, skin),
    };
    this.object.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = true;
    });
  }

  update(s: CharacterRenderState, view: ViewContext): void {
    const H = this.height;
    const dt = Math.min(Math.max(view.dt, 1e-3), 0.05);
    this.object.position.set(s.position.x, s.position.y, s.position.z);
    this.object.rotation.y = s.facing;

    // Local motion: forward/lateral relative to facing, acceleration and turn rate.
    const fwd = { x: Math.sin(s.facing), z: Math.cos(s.facing) };
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    const vF = s.velocity.x * fwd.x + s.velocity.z * fwd.z;
    const vR = -s.velocity.x * fwd.z + s.velocity.z * fwd.x; // + = moving to the character's right
    const aF = ((s.velocity.x - this.prevVel.x) * fwd.x + (s.velocity.z - this.prevVel.z) * fwd.z) / dt;
    const turn = this.prevFacing === null ? 0 : Math.atan2(Math.sin(s.facing - this.prevFacing), Math.cos(s.facing - this.prevFacing)) / dt;
    this.prevVel = { x: s.velocity.x, z: s.velocity.z };
    this.prevFacing = s.facing;
    const k = 1 - Math.exp(-dt * 8);

    // Gait phase advances with distance; stride lengthens with speed so feet don't skate.
    const strideLen = H * (0.42 + 0.075 * Math.min(speed, 7));
    this.phase += (speed * dt * Math.PI) / strideLen;
    const airborne = s.position.y > 0.01;
    const defending = s.team === 'defense' && !s.hasBall;
    const lateral = Math.abs(vR) > Math.abs(vF) * 1.2 && speed > 0.4 && speed < 4.8;
    this.shuffle += ((lateral || (defending && speed < 0.4) ? 1 : 0) - this.shuffle) * k;
    const amp = SWING[s.locomotion] * clamp(speed / 2, 0.4, 1) * (1 - this.shuffle);
    const dir = vF < -0.3 ? -1 : 1; // backpedal reverses the swing
    const swing = Math.sin(this.phase) * amp * dir;

    // Legs: forward swing (negative x-rotation), knee bend on the back-swing, abduction for shuffles.
    const kneeBase = (s.hasBall && !airborne ? 0.25 : 0.08) + (defending ? 0.35 : 0);
    const legPose = (leg: Limb, sw: number, side: number, shufflePhase: number) => {
      leg.upper.rotation.x = airborne ? -0.35 : -sw - (defending ? 0.25 : 0);
      leg.lower.rotation.x = airborne ? 0.7 : kneeBase + Math.max(0, -sw) * (amp > 0.5 ? 1.3 : 0.9);
      const spread = 0.1 + 0.2 * Math.max(0, shufflePhase);
      leg.upper.rotation.z = airborne ? 0 : side * spread * this.shuffle;
    };
    const sh = Math.sin(this.phase * 1.4);
    legPose(this.legs.right, swing, -1, sh);
    legPose(this.legs.left, -swing, 1, -sh);

    // Crouch (ball handling, defensive stance), stride bob, lean into acceleration, bank into turns.
    const wantCrouch = airborne ? 0 : s.hasBall ? 0.035 * H : defending ? 0.07 * H : 0;
    this.crouch += (wantCrouch - this.crouch) * k;
    this.body.position.y = -this.crouch - Math.abs(Math.cos(this.phase)) * 0.012 * H * (amp > 0 ? 1 : 0);
    this.lean += (clamp(vF * 0.025 + aF * 0.012, -0.12, 0.28) + (s.hasBall ? 0.06 : 0) + (defending ? 0.12 : 0) - this.lean) * k;
    this.bank += (clamp(-turn * speed * 0.02, -0.22, 0.22) + clamp(-vR * 0.02 * (1 - this.shuffle), -0.1, 0.1) - this.bank) * k;
    this.body.rotation.x = this.lean;
    this.body.rotation.z = this.bank;

    // Arms: running swing, or defensive "active hands".
    const armSwing = (arm: Limb, sw: number) => {
      arm.upper.rotation.set(sw * 0.8, 0, 0);
      arm.lower.rotation.x = -0.35 - Math.max(0, -sw) * 0.6;
    };
    armSwing(this.arms.right, -swing);
    armSwing(this.arms.left, swing);
    if (defending && s.pose !== 'screen') {
      const active = 0.85 + 0.08 * Math.sin(this.phase * 2);
      this.arms.right.upper.rotation.set(-0.55, 0, -active);
      this.arms.left.upper.rotation.set(-0.55, 0, active);
      this.arms.right.lower.rotation.x = -0.5;
      this.arms.left.lower.rotation.x = -0.5;
    }

    if (s.pose === 'screen' && !s.hasBall) {
      // Planted screen: wide base, arms folded across the chest.
      this.legs.right.upper.rotation.z = -0.16;
      this.legs.left.upper.rotation.z = 0.16;
      for (const leg of [this.legs.right, this.legs.left]) leg.lower.rotation.x = 0.25;
      this.arms.right.upper.rotation.set(-0.5, 0, 0.35);
      this.arms.left.upper.rotation.set(-0.5, 0, -0.35);
      this.arms.right.lower.rotation.x = -1.9;
      this.arms.left.lower.rotation.x = -1.9;
    } else if (s.action === 'shoot') {
      // Set point overhead; follow-through comes from the arms staying up through landing.
      for (const arm of [this.arms.right, this.arms.left]) {
        arm.upper.rotation.set(-2.7, 0, 0);
        arm.lower.rotation.x = -0.5;
      }
    } else if (s.hasBall) {
      const ballH = view.ballPosition.y - s.position.y;
      if (ballH > 0.55 * H || s.action === 'catch') {
        // Ball in the chest pocket: both hands on it.
        for (const arm of [this.arms.right, this.arms.left]) this.reachToward(arm, view.ballPosition, 0.6);
      } else if (s.dribbleHand) {
        this.reachToward(this.arms[s.dribbleHand], view.ballPosition, 0.15);
      }
    }
  }

  /** Points an arm at a world position (simple aim, not true IK). */
  private reachToward(arm: Limb, world: { x: number; y: number; z: number }, elbow: number): void {
    this.object.updateMatrixWorld();
    const local = this.body.worldToLocal(this.tmp.set(world.x, world.y, world.z));
    const dx = local.x - arm.upper.position.x;
    const dy = local.y - arm.upper.position.y;
    const dz = local.z - arm.upper.position.z;
    // Arm rest direction is -y; Rx(a) maps it to (0, -cos a, -sin a).
    arm.upper.rotation.x = Math.atan2(-dz, -dy);
    arm.upper.rotation.z = clamp(Math.atan2(dx, -dy) * 0.6, -0.6, 0.6);
    arm.lower.rotation.x = -elbow;
  }

  dispose(): void {
    this.object.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
