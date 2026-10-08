import { AnimationMixer, Box3, Group, LoopOnce, Mesh, Vector3, type AnimationAction, type AnimationClip } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GltfCharacterRenderer as GltfConfig } from '../../../domain/characters/definition';
import type { CharacterRenderState } from '../../../simulation/runtime/types';
import type { CharacterRenderer, ViewContext } from '../types';
import { ProceduralHumanoidRenderer, type HumanoidColors } from '../humanoid/ProceduralHumanoidRenderer';

/** Animation targets (spec §4.4) with fuzzy clip-name fallbacks for common rigs. */
const CLIP_HINTS: Record<string, string[]> = {
  idle: ['idle'],
  walk: ['walk'],
  run: ['run', 'jog'],
  sprint: ['sprint', 'run_fast', 'run'],
  dribble_idle: ['dribble_idle', 'dribble', 'idle'],
  dribble_walk: ['dribble_walk', 'dribble', 'walk'],
  dribble_run: ['dribble_run', 'dribble', 'run'],
  shoot_jump: ['shoot_jump', 'shoot', 'jump'],
  catch: ['catch', 'idle'],
};

/**
 * GLB/GLTF character (spec §12.1). Shows the procedural humanoid until the file
 * loads (or if it fails), then plays clips through an AnimationMixer. Implements
 * the same CharacterRenderer interface as sprites.
 */
export class GltfCharacterRenderer implements CharacterRenderer {
  readonly object = new Group();
  private placeholder: ProceduralHumanoidRenderer | null;
  private model: Group | null = null;
  private mixer: AnimationMixer | null = null;
  private clips: AnimationClip[] = [];
  private active: AnimationAction | null = null;
  private activeTarget = '';
  private disposed = false;

  constructor(
    private readonly config: GltfConfig,
    private readonly height: number,
    colors: HumanoidColors,
    onError?: (err: unknown) => void,
  ) {
    this.placeholder = new ProceduralHumanoidRenderer(height, colors);
    this.object.add(this.placeholder.object);
    if (config.url) {
      new GLTFLoader().load(
        config.url,
        (gltf) => this.attach(gltf.scene, gltf.animations),
        undefined,
        (err) => onError?.(err),
      );
    }
  }

  private attach(scene: Group, clips: AnimationClip[]): void {
    if (this.disposed) return;
    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3());
    const scale = size.y > 1e-6 ? this.height / size.y : 1;
    scene.scale.setScalar(scale);
    scene.position.y = -box.min.y * scale;
    scene.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = true;
    });
    const holder = new Group();
    holder.add(scene);
    this.model = holder;
    this.clips = clips;
    this.mixer = clips.length ? new AnimationMixer(scene) : null;
    if (this.placeholder) {
      this.object.remove(this.placeholder.object);
      this.placeholder.dispose();
      this.placeholder = null;
    }
    this.object.add(holder);
  }

  private findClip(target: string): AnimationClip | undefined {
    const mapped = this.config.clipMap?.[target];
    if (mapped) return this.clips.find((c) => c.name === mapped);
    for (const hint of CLIP_HINTS[target] ?? [target]) {
      const c = this.clips.find((clip) => clip.name.toLowerCase().includes(hint));
      if (c) return c;
    }
    return undefined;
  }

  private animationTarget(s: CharacterRenderState): string {
    if (s.action === 'shoot') return 'shoot_jump';
    if (s.action === 'catch') return 'catch';
    if (s.hasBall) return s.locomotion === 'idle' ? 'dribble_idle' : s.locomotion === 'walk' ? 'dribble_walk' : 'dribble_run';
    return s.locomotion;
  }

  update(s: CharacterRenderState, view: ViewContext): void {
    if (this.placeholder) {
      this.placeholder.update(s, view);
      return;
    }
    if (!this.model) return;
    this.model.position.set(s.position.x, s.position.y, s.position.z);
    this.model.rotation.y = s.facing;
    if (!this.mixer) return;
    const target = this.animationTarget(s);
    if (target !== this.activeTarget) {
      const clip = this.findClip(target) ?? this.findClip('idle') ?? this.clips[0];
      const next = this.mixer.clipAction(clip);
      if (next !== this.active) {
        next.reset();
        if (target === 'shoot_jump') {
          next.setLoop(LoopOnce, 1);
          next.clampWhenFinished = true;
        }
        next.play();
        if (this.active) next.crossFadeFrom(this.active, 0.18, false);
        this.active = next;
      }
      this.activeTarget = target;
    }
    this.mixer.update(view.dt);
  }

  dispose(): void {
    this.disposed = true;
    this.placeholder?.dispose();
    this.mixer?.stopAllAction();
    this.model?.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
  }
}
