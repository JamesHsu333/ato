import { GENERIC_GUARD, GENERIC_MASCOT } from '../domain/characters/builtins';
import { SEMANTIC_SPOTS } from '../domain/court/spots';
import type { PlayGraph } from '../domain/play/graph/playGraph';
import { FixedStepLoop } from '../simulation/runtime/fixedStep';
import { simulationFromPlay, type PlaySimOptions } from '../simulation/runtime/fromPlay';
import { Simulation, type SimulationSnapshot } from '../simulation/runtime/simulation';

function sandboxSimulation(): Simulation {
  return new Simulation({
    seed: 42,
    collisionMode: 'hard',
    shotOutcome: { mode: 'simulated' },
    actors: [
      { id: 'guard', definition: GENERIC_GUARD, team: 'offense', position: SEMANTIC_SPOTS.top },
      { id: 'mascot', definition: GENERIC_MASCOT, team: 'offense', position: SEMANTIC_SPOTS.right_wing },
    ],
    ballHolder: 'guard',
    controlled: 'guard',
  });
}

/**
 * The active simulation plus its fixed-step driver. Lives outside React;
 * components receive it by reference. `version` bumps whenever the simulation
 * object is replaced so renderers can rebuild their actor set.
 */
export class Session {
  sim: Simulation;
  readonly loop: FixedStepLoop;
  version = 0;
  paused = false;
  play: PlayGraph | null = null;
  private initial: SimulationSnapshot;

  constructor() {
    this.sim = sandboxSimulation();
    this.loop = new FixedStepLoop((input) => {
      if (!this.paused) this.sim.step(input);
    });
    this.initial = this.sim.snapshot();
  }

  private replace(sim: Simulation): void {
    this.sim.dispose();
    this.sim = sim;
    this.initial = sim.snapshot();
    this.loop.reset();
    this.version++;
  }

  loadSandbox(): void {
    this.play = null;
    this.paused = false;
    this.replace(sandboxSimulation());
  }

  loadPlay(play: PlayGraph, opts: PlaySimOptions): void {
    this.play = play;
    this.replace(simulationFromPlay(play, opts));
  }

  /** Restores the opening snapshot (the same path timeline seeking will use). */
  reset(): void {
    this.sim.restore(this.initial);
    this.loop.reset();
  }

  dispose(): void {
    this.sim.dispose();
  }
}
