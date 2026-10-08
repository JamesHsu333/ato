/**
 * Character definitions (spec §10–15). Pure data: appearance (renderer) is fully
 * separate from basketball behavior (attributes, dimensions).
 */

export interface PlayerAttributes {
  physical: { speed: number; acceleration: number; agility: number; strength: number; jump: number };
  offense: {
    finishing: number;
    midrange: number;
    three_point: number;
    passing: number;
    ball_handling: number;
    screening: number;
  };
  defense: { perimeter_defense: number; interior_defense: number; steal: number; block: number };
  tendencies: { help_defense: number; screen_navigation: number; aggression: number };
}

export const DEFAULT_ATTRIBUTES: PlayerAttributes = {
  physical: { speed: 80, acceleration: 80, agility: 80, strength: 80, jump: 80 },
  offense: { finishing: 80, midrange: 80, three_point: 80, passing: 80, ball_handling: 80, screening: 80 },
  defense: { perimeter_defense: 80, interior_defense: 80, steal: 80, block: 80 },
  tendencies: { help_defense: 50, screen_navigation: 50, aggression: 50 },
};

export type SpriteDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface GltfCharacterRenderer {
  type: 'gltf';
  /** URL of a GLB/GLTF file. Omit to use the built-in procedural humanoid. */
  url?: string;
  /** Optional mapping from animation target (e.g. "run") to a clip name in the file. */
  clipMap?: Partial<Record<string, string>>;
  colors?: { jersey: string; skin: string; shorts: string };
}

export interface SpriteCharacterRenderer {
  type: 'sprite';
  mode: 'static' | 'animated';
  /**
   * Static mode: one image URL per view direction. Omit for the built-in
   * procedurally drawn mascot.
   */
  directions?: Partial<Record<SpriteDirection, string>>;
  /** Animated mode: `${state}/${direction}` → frame URLs. Reserved for later. */
  frames?: Record<string, string[]>;
  tint?: string;
}

export interface MotionProfile {
  locomotion: { style: 'stride' | 'hop' | 'waddle'; cadence: 'slow' | 'normal' | 'fast'; bob_height: number; squash: number };
  acceleration: { style: 'smooth' | 'abrupt' };
  stopping: { style: 'soft' | 'hard' };
  screen: { pose: 'brace' | 'wide' };
  facing: 'velocity' | 'aim';
}

export const MOTION_PROFILES: Record<string, MotionProfile> = {
  athletic: {
    locomotion: { style: 'stride', cadence: 'normal', bob_height: 0.03, squash: 0.0 },
    acceleration: { style: 'smooth' },
    stopping: { style: 'soft' },
    screen: { pose: 'brace' },
    facing: 'aim',
  },
  bouncy: {
    locomotion: { style: 'hop', cadence: 'fast', bob_height: 0.08, squash: 0.05 },
    acceleration: { style: 'abrupt' },
    stopping: { style: 'hard' },
    screen: { pose: 'brace' },
    facing: 'aim',
  },
};

export interface CharacterDefinition {
  id: string;
  name: string;
  renderer: GltfCharacterRenderer | SpriteCharacterRenderer;
  dimensions: { height: number; collisionRadius: number };
  attributes: PlayerAttributes;
  motionProfile: string;
}
