import { GENERIC_GUARD, GENERIC_MASCOT } from '../domain/characters/builtins';
import type { Vec2 } from '../domain/math/vec';
import { initPhysics } from '../simulation/physics/rapier';
import type { ShotOutcomeConfig } from '../simulation/ball/ballSystem';
import { idealReleaseTime, jumpVelocity } from '../simulation/ball/shooting';
import { Simulation } from '../simulation/runtime/simulation';
import { EMPTY_INPUT, SIM_DT, type SimEvent, type SimInput } from '../simulation/runtime/types';

export { initPhysics };

export function makeSim(opts: { at?: Vec2; shotOutcome?: ShotOutcomeConfig; seed?: number; mascotAt?: Vec2 } = {}) {
  return new Simulation({
    seed: opts.seed ?? 42,
    collisionMode: 'hard',
    shotOutcome: opts.shotOutcome ?? { mode: 'simulated' },
    actors: [
      { id: 'guard', definition: GENERIC_GUARD, team: 'offense', position: opts.at ?? { x: 0, z: 6 } },
      { id: 'mascot', definition: GENERIC_MASCOT, team: 'offense', position: opts.mascotAt ?? { x: 5, z: 3 } },
    ],
    ballHolder: 'guard',
    controlled: 'guard',
  });
}

export const input = (p: Partial<SimInput> = {}): SimInput => ({ ...EMPTY_INPUT, ...p });

export function run(sim: Simulation, ticks: number, inp: SimInput = input()): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(i === 0 ? inp : { ...inp, commands: [] });
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Holds shoot for `holdOffset` seconds relative to the ideal release, then plays the shot out. */
export function shoot(sim: Simulation, holdOffset = 0): SimEvent[] {
  const ideal = idealReleaseTime(jumpVelocity(sim.character(sim.controlled!)!.definition.attributes));
  const holdTicks = Math.round((ideal + holdOffset) / SIM_DT);
  const events = run(sim, holdTicks, input({ shootHeld: true }));
  events.push(...run(sim, 6 * 60));
  return events;
}
