import { RAPIER } from './rapier';
import type RapierNS from '@dimforge/rapier3d-compat';
import { COURT } from '../../domain/court/dimensions';
import type { Vec3 } from '../../domain/math/vec';
import { GRAVITY, SIM_DT } from '../runtime/types';

type World = RapierNS.World;

// Collision group bits (membership << 16 | filter).
const G_STATIC = 0x0001;
const G_BALL = 0x0002;
const G_CHAR = 0x0004;
const groups = (member: number, filter: number) => (member << 16) | filter;

const BALL_WITH_CHARS = groups(G_BALL, G_STATIC | G_CHAR);
const BALL_NO_CHARS = groups(G_BALL, G_STATIC);
const BALL_NONE = groups(G_BALL, 0);
const CHAR_GROUPS = groups(G_CHAR, G_BALL); // characters only collide with the ball here
const STATIC_GROUPS = groups(G_STATIC, G_BALL);

export type BallCollisionMode = 'none' | 'static' | 'all';

/**
 * Thin wrapper over the Rapier world. Holds only integer handles so the whole
 * physics state can be snapshotted and restored (spec rule 9).
 *
 * Characters are kinematic bodies (spec §16.1); the ball is a dynamic rigid body
 * that is switched to kinematic while possessed (spec §16.4).
 */
export class PhysicsWorld {
  world: World;
  private ballHandle: number;
  private ballColliderHandle: number;
  private charHandles = new Map<string, number>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = SIM_DT;
    this.buildCourt();
    const { body, collider } = this.buildBall();
    this.ballHandle = body;
    this.ballColliderHandle = collider;
  }

  private buildCourt(): void {
    const w = this.world;
    const fixed = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    // Floor (large so a loose ball never falls off), plus low boundary walls.
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 6).setRestitution(0.82).setFriction(0.6).setCollisionGroups(STATIC_GROUPS),
      fixed,
    );
    const wall = (hx: number, hz: number, x: number, z: number) =>
      w.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, 2, hz).setTranslation(x, 2, z).setRestitution(0.5).setCollisionGroups(STATIC_GROUPS),
        fixed,
      );
    const xEdge = COURT.halfWidth + 2.5;
    const zBack = COURT.baselineZ - 2.5;
    const zFront = COURT.halfCourtZ + 2.5;
    const zMid = (zBack + zFront) / 2;
    const zHalf = (zFront - zBack) / 2;
    wall(0.25, zHalf, -xEdge, zMid);
    wall(0.25, zHalf, xEdge, zMid);
    wall(xEdge, 0.25, 0, zBack);
    wall(xEdge, 0.25, 0, zFront);

    // Backboard.
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(COURT.backboardWidth / 2, COURT.backboardHeight / 2, COURT.backboardThickness / 2)
        .setTranslation(0, COURT.backboardBottomY + COURT.backboardHeight / 2, COURT.backboardFrontZ - COURT.backboardThickness / 2)
        .setRestitution(0.6)
        .setCollisionGroups(STATIC_GROUPS),
      fixed,
    );

    // Rim: a ring of short capsules approximating a torus.
    const segments = 24;
    const r = COURT.rimRadius + COURT.rimTubeRadius;
    const segHalf = (Math.PI * r) / segments;
    for (let i = 0; i < segments; i++) {
      const a = ((i + 0.5) / segments) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Capsule axis is local Y; rotate it to lie along the tangent.
      const q = tangentCapsuleRotation(a);
      w.createCollider(
        RAPIER.ColliderDesc.capsule(segHalf, COURT.rimTubeRadius)
          .setTranslation(x, COURT.rimHeight, z)
          .setRotation(q)
          .setRestitution(0.35)
          .setCollisionGroups(STATIC_GROUPS),
        fixed,
      );
    }
    // Rim-to-backboard bracket.
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(0.08, 0.02, 0.07)
        .setTranslation(0, COURT.rimHeight - 0.02, COURT.backboardFrontZ + 0.07)
        .setCollisionGroups(STATIC_GROUPS),
      fixed,
    );
  }

  private buildBall(): { body: number; collider: number } {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, COURT.ballRadius, 4).setCcdEnabled(true).setLinearDamping(0).setAngularDamping(0.4),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(COURT.ballRadius)
        .setMass(COURT.ballMass)
        .setRestitution(0.82)
        .setFriction(0.6)
        .setCollisionGroups(BALL_WITH_CHARS),
      body,
    );
    return { body: body.handle, collider: collider.handle };
  }

  addCharacter(id: string, radius: number, height: number, pos: Vec3): void {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + height / 2, pos.z),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.capsule(Math.max(0.01, height / 2 - radius), radius).setCollisionGroups(CHAR_GROUPS).setRestitution(0.3),
      body,
    );
    this.charHandles.set(id, body.handle);
  }

  moveCharacter(id: string, pos: Vec3, height: number): void {
    const h = this.charHandles.get(id);
    if (h === undefined) return;
    this.world.getRigidBody(h).setNextKinematicTranslation({ x: pos.x, y: pos.y + height / 2, z: pos.z });
  }

  private get ball() {
    return this.world.getRigidBody(this.ballHandle);
  }

  getBallPosition(): Vec3 {
    const t = this.ball.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  getBallVelocity(): Vec3 {
    const v = this.ball.linvel();
    return { x: v.x, y: v.y, z: v.z };
  }

  /** Possession: ball follows a kinematic target (hand / dribble). */
  setBallKinematicTarget(p: Vec3): void {
    const b = this.ball;
    if (b.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
      b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      this.setBallCollision('none');
    }
    b.setNextKinematicTranslation(p);
  }

  /** Release: ball becomes a dynamic rigid body with the given launch state. */
  releaseBall(pos: Vec3, vel: Vec3): void {
    const b = this.ball;
    b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    b.setTranslation(pos, true);
    b.setLinvel(vel, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.setBallCollision('static');
  }

  /** Teleports a loose ball (used for resets). */
  placeBall(pos: Vec3, vel: Vec3 = { x: 0, y: 0, z: 0 }): void {
    this.releaseBall(pos, vel);
    this.setBallCollision('all');
  }

  setBallCollision(mode: BallCollisionMode): void {
    const g = mode === 'all' ? BALL_WITH_CHARS : mode === 'static' ? BALL_NO_CHARS : BALL_NONE;
    this.world.getCollider(this.ballColliderHandle).setCollisionGroups(g);
  }

  step(): void {
    this.world.step();
  }

  snapshot(): Uint8Array {
    return this.world.takeSnapshot();
  }

  restore(bytes: Uint8Array): void {
    const next = RAPIER.World.restoreSnapshot(bytes);
    this.world.free();
    this.world = next;
  }

  dispose(): void {
    this.world.free();
  }
}

/**
 * Rotation taking a capsule's local +Y axis onto the rim tangent at angle `a`
 * (tangent = (-sin a, 0, cos a)): q = Ry(-a) * Rx(PI/2).
 */
function tangentCapsuleRotation(a: number) {
  const s = Math.SQRT1_2, c = Math.SQRT1_2;
  const S = Math.sin(-a / 2), C = Math.cos(-a / 2);
  return { x: C * s, y: c * S, z: -S * s, w: C * c };
}
