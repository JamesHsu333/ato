import type { PrimitiveAction } from '../../actions/primitives';
import type { Condition } from '../../conditions/condition';
import type { Vec2 } from '../../math/vec';
import type { CoverageName, PlayDefinition } from '../schema/playDefinition';

/** A semantic action after compilation: one actor, a sequence of primitives. */
export interface CompiledAction {
  actor: string;
  semantic: string;
  /** Start condition (spec §30): the actor waits until it holds. */
  when?: Condition;
  steps: PrimitiveAction[];
}

export interface PlayerOption {
  id: string;
  label: string;
  action: CompiledAction;
}

export interface Transition {
  when: Condition;
  to: string;
}

/** A play is a graph, not a timeline (spec §21). */
export interface PlayNode {
  id: string;
  actions: CompiledAction[];
  options: PlayerOption[];
  transitions: Transition[];
}

export interface CompiledActor {
  id: string;
  characterId: string;
  team: 'offense' | 'defense';
  role?: string;
  assignment?: string;
  start: Vec2;
  facing: number;
}

export interface PlayGraph {
  id: string;
  name: string;
  description?: string;
  actors: CompiledActor[];
  ballHolder: string | null;
  start: string;
  nodes: Record<string, PlayNode>;
  simulation: {
    seed: number;
    shotOutcome: { mode: 'simulated' } | { mode: 'forced'; result: 'make' | 'miss' };
    coverage: CoverageName;
    /** Off-ball defenders deny passes one pass away. */
    deny: boolean;
  };
  /** The source definition, kept for export and editing. */
  source: PlayDefinition;
}
