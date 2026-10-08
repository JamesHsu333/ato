import type { CharacterDefinition, GltfCharacterRenderer as GltfConfig, SpriteCharacterRenderer as SpriteConfig } from '../../domain/characters/definition';
import { MOTION_PROFILES } from '../../domain/characters/definition';
import type { Team } from '../../simulation/runtime/types';
import { GltfCharacterRenderer } from './gltf/GltfCharacterRenderer';
import { ProceduralHumanoidRenderer } from './humanoid/ProceduralHumanoidRenderer';
import { SpriteCharacterRenderer } from './sprite/SpriteCharacterRenderer';
import type { CharacterRenderer } from './types';

export type AppearanceConfig = GltfConfig | SpriteConfig;

const TEAM_ACCENT: Record<Team, string> = { offense: '#1f5fbf', defense: '#c0392b' };

/**
 * Builds the renderer for an actor. Appearance may be overridden per actor without
 * touching the definition's attributes or the simulation (spec §64).
 */
export function createCharacterRenderer(
  def: CharacterDefinition,
  team: Team,
  appearance: AppearanceConfig = def.renderer,
  onError?: (err: unknown) => void,
): CharacterRenderer {
  const motion = MOTION_PROFILES[def.motionProfile] ?? MOTION_PROFILES.athletic;
  const height = def.dimensions.height;
  if (appearance.type === 'sprite') {
    // Sprites drawn for a shorter body still use the actor's real height for scale.
    return new SpriteCharacterRenderer(appearance, height, motion, TEAM_ACCENT[team]);
  }
  const colors = appearance.colors ?? { jersey: TEAM_ACCENT[team], shorts: '#1b2a44', skin: '#c68b62' };
  if (appearance.url) return new GltfCharacterRenderer(appearance, height, colors, onError);
  return new ProceduralHumanoidRenderer(height, colors);
}
