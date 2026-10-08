/**
 * Authoring format of a play (spec §19–22), as written in YAML/JSON.
 * Renderer-independent: nothing here refers to appearance.
 */
import type { SemanticSpot } from '../../court/spots';

export const PLAY_FORMAT_VERSION = '0.1';

export type PositionDef =
  | SemanticSpot
  | { x: number; z: number }
  | { spot: SemanticSpot; offset?: [number, number] };

/** Where a movement goes: a court position, or a point relative to another actor. */
export type TargetDef =
  | PositionDef
  /** "<actor>" or "<actor>.<point>", e.g. "screener.right_shoulder". */
  | string
  | { relative_to: string; purpose?: 'screen'; side?: 'left' | 'right' | 'auto'; offset?: [number, number] };

export type CoverageName = 'man' | 'go_over' | 'under' | 'drop' | 'switch' | 'hedge';

export type ConditionDef =
  | string // shorthand for { event: "<name>" }
  | { event: string }
  | { coverage: CoverageName }
  | { elapsed: number }
  | { all: ConditionDef[] }
  | { any: ConditionDef[] };

/** Semantic basketball actions (spec §24). Snake case; camelCase aliases are accepted on input. */
export const SEMANTIC_ACTIONS = [
  'move',
  'wait',
  'pass',
  'lob',
  'shoot',
  'layup',
  'dunk',
  'screen',
  'roll',
  'pop',
  'slip',
  'drive',
  'cut',
  'back_cut',
  'v_cut',
  'curl',
  'flare',
  'handoff',
  'alley_oop',
  'pin_down',
  'flare_screen',
  'elevator',
] as const;
export type SemanticActionName = (typeof SEMANTIC_ACTIONS)[number];
export const ACTION_ALIASES: Record<string, SemanticActionName> = {
  backCut: 'back_cut',
  vCut: 'v_cut',
  alleyOop: 'alley_oop',
  pinDown: 'pin_down',
  flareScreen: 'flare_screen',
};
export type Speed = 'walk' | 'jog' | 'run' | 'sprint';

export interface ActionDef {
  actor: string;
  action: SemanticActionName;
  to?: TargetDef;
  via?: TargetDef;
  target?: string;
  type?: string;
  side?: 'left' | 'right' | 'auto';
  angle?: 'auto' | number;
  hold_until?: ConditionDef;
  duration?: number;
  speed?: Speed;
  /** Start this action only once the condition holds (event-based timing, spec §30). */
  when?: ConditionDef;
  path?: { mode: 'auto' | 'override'; points?: [number, number][] };
  /** Off-ball screens: the offensive player the screen is set for. */
  for?: string;
  /** Curl: the screener to curl around. */
  around?: string;
  /** Elevator: where the door closes once the user has come through. */
  close_to?: TargetDef;
}

export interface PlayerOptionDef {
  id: string;
  label?: string;
  action: ActionDef;
}

export interface TransitionDef {
  when: ConditionDef;
  to: string;
}

export interface NodeDef {
  actions?: ActionDef[];
  player_options?: PlayerOptionDef[];
  transitions?: TransitionDef[];
}

export interface ActorDef {
  character: string;
  team: 'offense' | 'defense';
  role?: string;
  assignment?: string;
}

export interface SetupDef {
  position?: PositionDef;
  possession?: 'ball';
  facing?: number | SemanticSpot;
  relative_to?: string;
  defensive_position?: 'on_ball' | 'matchup' | 'help';
}

export interface PlayDefinition {
  version: typeof PLAY_FORMAT_VERSION;
  play: { id: string; name: string; description?: string; start?: string };
  court?: { type: 'nba_half' };
  actors: Record<string, ActorDef>;
  setup: Record<string, SetupDef>;
  graph: Record<string, NodeDef>;
  simulation?: {
    seed?: number;
    shot_outcome?: { mode: 'simulated' } | { mode: 'forced'; result: 'make' | 'miss' };
    defense?: { coverage?: CoverageName; deny?: boolean };
  };
}
