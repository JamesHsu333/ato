import { Vector3, type PerspectiveCamera } from 'three';
import type { Vec3 } from '../../domain/math/vec';

export type CameraPreset = 'top-down' | 'sideline' | 'broadcast' | 'free';
export type CameraBehavior = 'static' | 'follow' | 'tactical-auto';

export const CAMERA_PRESETS: Record<CameraPreset, { label: string }> = {
  'top-down': { label: 'Top-down' },
  sideline: { label: 'Sideline tactical' },
  broadcast: { label: 'Broadcast' },
  free: { label: 'Free orbit' },
};

export const CAMERA_BEHAVIORS: Record<CameraBehavior, { label: string }> = {
  static: { label: 'Static' },
  follow: { label: 'Follow' },
  'tactical-auto': { label: 'Tactical auto' },
};

interface PresetPose {
  /** Camera position relative to the focus point. */
  offset: Vector3;
  /** Focus used by the static behavior. */
  staticFocus: Vector3;
  fov: number;
}

const POSES: Record<Exclude<CameraPreset, 'free'>, PresetPose> = {
  'top-down': { offset: new Vector3(0, 21, 0.001), staticFocus: new Vector3(0, 0, 5.4), fov: 45 },
  sideline: { offset: new Vector3(14.5, 11, 0), staticFocus: new Vector3(0, 0.5, 5), fov: 45 },
  broadcast: { offset: new Vector3(0, 6.2, 10.5), staticFocus: new Vector3(0, 1.4, 4.5), fov: 52 },
};

export interface CameraTargets {
  controlled: Vec3 | null;
  players: Vec3[];
  ball: Vec3;
}

/**
 * Camera presets × behaviors (spec §42–43). Presentation only: reads positions,
 * never writes to the simulation.
 */
export class CameraRig {
  private focus = new Vector3(0, 0.5, 5);
  private zoom = 1;
  private readonly tmp = new Vector3();

  /** Returns the desired focus point (also used to move OrbitControls' target in free mode). */
  computeFocus(preset: CameraPreset, behavior: CameraBehavior, t: CameraTargets): Vector3 {
    if (behavior === 'follow' && t.controlled) {
      return this.tmp.set(t.controlled.x, 0.8, t.controlled.z);
    }
    if (behavior === 'tactical-auto' && t.players.length) {
      // Weighted centroid of players and ball; the ball counts double.
      let x = t.ball.x * 2, z = t.ball.z * 2;
      for (const p of t.players) {
        x += p.x;
        z += p.z;
      }
      const n = t.players.length + 2;
      return this.tmp.set(x / n, 0.8, z / n);
    }
    return this.tmp.copy(preset === 'free' ? this.focus : POSES[preset].staticFocus);
  }

  private spread(t: CameraTargets): number {
    let m = 0;
    for (const p of t.players) m = Math.max(m, Math.hypot(p.x - t.ball.x, p.z - t.ball.z));
    return m;
  }

  /** Smoothly drives the camera for non-free presets. Returns the focus delta applied this frame. */
  update(camera: PerspectiveCamera, preset: CameraPreset, behavior: CameraBehavior, t: CameraTargets, dt: number): Vector3 {
    const want = this.computeFocus(preset, behavior, t).clone();
    const k = 1 - Math.exp(-dt * 4);
    const before = this.focus.clone();
    this.focus.lerp(want, k);
    const delta = this.focus.clone().sub(before);
    if (preset === 'free') return delta;

    const pose = POSES[preset];
    const wantZoom = behavior === 'tactical-auto' ? Math.min(1.35, Math.max(0.85, this.spread(t) / 6)) : 1;
    this.zoom += (wantZoom - this.zoom) * k;
    camera.up.set(0, 1, 0);
    if (preset === 'top-down') camera.up.set(0, 0, -1); // basket at the top of the screen
    camera.position.copy(this.focus).addScaledVector(pose.offset, this.zoom);
    camera.lookAt(this.focus);
    if (camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    return delta;
  }

  /** Snap without smoothing (preset change). */
  snap(camera: PerspectiveCamera, preset: CameraPreset, behavior: CameraBehavior, t: CameraTargets): void {
    this.focus.copy(this.computeFocus(preset, behavior, t));
    this.zoom = 1;
    if (preset !== 'free') this.update(camera, preset, behavior, t, 0);
    else camera.up.set(0, 1, 0);
  }
}
