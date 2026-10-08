import { DEFAULT_ATTRIBUTES, type CharacterDefinition, type PlayerAttributes } from './definition';

type AttrPatch = { [K in keyof PlayerAttributes]?: Partial<PlayerAttributes[K]> };

function attrs(patch: AttrPatch): PlayerAttributes {
  return {
    physical: { ...DEFAULT_ATTRIBUTES.physical, ...patch.physical },
    offense: { ...DEFAULT_ATTRIBUTES.offense, ...patch.offense },
    defense: { ...DEFAULT_ATTRIBUTES.defense, ...patch.defense },
    tendencies: { ...DEFAULT_ATTRIBUTES.tendencies, ...patch.tendencies },
  };
}

/**
 * Built-in generic characters. No proprietary assets are required. Jersey colors
 * come from the team at render time, so any character can play on either side.
 */
export const GENERIC_GUARD: CharacterDefinition = {
  id: 'generic_guard',
  name: 'Generic Guard',
  renderer: { type: 'gltf' },
  dimensions: { height: 1.91, collisionRadius: 0.32 },
  attributes: attrs({ physical: { speed: 86, acceleration: 85 }, offense: { three_point: 84, ball_handling: 85, passing: 84 } }),
  motionProfile: 'athletic',
};

export const GENERIC_WING: CharacterDefinition = {
  id: 'generic_wing',
  name: 'Generic Wing',
  renderer: { type: 'gltf' },
  dimensions: { height: 2.0, collisionRadius: 0.34 },
  attributes: attrs({ physical: { speed: 82 }, offense: { three_point: 82, midrange: 82 } }),
  motionProfile: 'athletic',
};

export const GENERIC_BIG: CharacterDefinition = {
  id: 'generic_big',
  name: 'Generic Big',
  renderer: { type: 'gltf' },
  dimensions: { height: 2.11, collisionRadius: 0.4 },
  attributes: attrs({
    physical: { speed: 70, acceleration: 68, agility: 64, strength: 92, jump: 76 },
    offense: { finishing: 86, three_point: 60, screening: 90, ball_handling: 55 },
    defense: { interior_defense: 88, block: 86 },
  }),
  motionProfile: 'athletic',
};

export const GENERIC_DEFENDER: CharacterDefinition = {
  id: 'generic_defender',
  name: 'Generic Defender',
  renderer: { type: 'gltf' },
  dimensions: { height: 1.98, collisionRadius: 0.34 },
  attributes: attrs({ physical: { speed: 82, agility: 84 }, defense: { perimeter_defense: 84 } }),
  motionProfile: 'athletic',
};

export const GENERIC_MASCOT: CharacterDefinition = {
  id: 'generic_mascot',
  name: 'Generic Mascot',
  renderer: { type: 'sprite', mode: 'static', tint: '#f4f1ea' },
  dimensions: { height: 1.4, collisionRadius: 0.36 },
  attributes: attrs({ physical: { speed: 74, agility: 88, jump: 70 }, offense: { three_point: 76, finishing: 72 } }),
  motionProfile: 'bouncy',
};

export const BUILTIN_CHARACTERS: Record<string, CharacterDefinition> = Object.fromEntries(
  [GENERIC_GUARD, GENERIC_WING, GENERIC_BIG, GENERIC_DEFENDER, GENERIC_MASCOT].map((c) => [c.id, c]),
);
