import { BUILTIN_CHARACTERS } from '../../domain/characters/builtins';
import type { CharacterDefinition } from '../../domain/characters/definition';
import type { PlayGraph } from '../../domain/play/graph/playGraph';
import type { CoverageName } from '../../domain/play/schema/playDefinition';
import type { ShotOutcomeConfig } from '../ball/ballSystem';
import { Simulation } from './simulation';
import type { CollisionMode } from './types';

export interface PlaySimOptions {
  controlled?: string | null;
  collisionMode?: CollisionMode;
  coverage?: CoverageName;
  shotOutcome?: ShotOutcomeConfig;
  seed?: number;
  characters?: Record<string, CharacterDefinition>;
}

/** Builds a simulation that executes a compiled play. Appearance is not involved. */
export function simulationFromPlay(play: PlayGraph, opts: PlaySimOptions = {}): Simulation {
  const characters = opts.characters ?? BUILTIN_CHARACTERS;
  return new Simulation({
    seed: opts.seed ?? play.simulation.seed,
    collisionMode: opts.collisionMode ?? 'hard',
    shotOutcome: opts.shotOutcome ?? play.simulation.shotOutcome,
    coverage: opts.coverage ?? play.simulation.coverage,
    actors: play.actors.map((a) => ({
      id: a.id,
      definition: characters[a.characterId],
      team: a.team,
      position: a.start,
      facing: a.facing,
      assignment: a.assignment,
    })),
    ballHolder: play.ballHolder,
    controlled: opts.controlled ?? null,
    play,
  });
}
