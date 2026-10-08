import type { Object3D } from 'three';
import type { Vec3 } from '../../domain/math/vec';
import type { CharacterRenderState } from '../../simulation/runtime/types';

export interface ViewContext {
  cameraPosition: Vec3;
  ballPosition: Vec3;
  /** Render-frame delta (seconds); presentation only, never fed back into the sim. */
  dt: number;
}

/**
 * Renderer abstraction (spec §63). GLTF, procedural humanoid and sprite characters
 * all implement this; none of them know any basketball semantics.
 */
export interface CharacterRenderer {
  readonly object: Object3D;
  update(state: CharacterRenderState, view: ViewContext): void;
  dispose(): void;
}
