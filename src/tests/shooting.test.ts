import { beforeAll, describe, expect, it } from 'vitest';
import { gradeTiming, shotProbability } from '../simulation/ball/shooting';
import { DEFAULT_ATTRIBUTES } from '../domain/characters/definition';
import { SEMANTIC_SPOTS } from '../domain/court/spots';
import { initPhysics, makeSim, run, shoot } from './helpers';

beforeAll(() => initPhysics());

describe('shot physics', () => {
  const spots = ['top', 'right_wing', 'left_corner', 'right_elbow', 'restricted_area', 'left_slot'] as const;

  for (const spot of spots) {
    it(`a forced make from ${spot} physically goes through the rim`, () => {
      expectForcedMake(SEMANTIC_SPOTS[spot]);
    });
  }

  for (const z of [0.2, 0.6, 1.2, 1.6, 2.0, 2.6, 3.2, 4.0, 5.5, 9.0]) {
    it(`a forced make from ${z}m straight on goes in`, () => expectForcedMake({ x: 0, z }));
    it(`a forced make from ${z}m at 45 degrees goes in`, () => expectForcedMake({ x: z * Math.SQRT1_2, z: z * Math.SQRT1_2 }));
  }

  function expectForcedMake(at: { x: number; z: number }) {
    const sim = makeSim({ at, shotOutcome: { mode: 'forced', result: 'make' } });
    run(sim, 20); // finish the pickup gather
    const events = shoot(sim);
    expect(events.find((e) => e.type === 'shot.released')).toBeTruthy();
    expect(events.some((e) => e.type === 'shot.made')).toBe(true);
    expect(sim.stats).toMatchObject({ attempts: 1, makes: 1 });
  }

  it('forced misses mostly do not go in', () => {
    let made = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const sim = makeSim({ seed, at: SEMANTIC_SPOTS.top, shotOutcome: { mode: 'forced', result: 'miss' } });
      run(sim, 20);
      const events = shoot(sim);
      expect(events.some((e) => e.type === 'shot.made' || e.type === 'shot.missed')).toBe(true);
      if (events.some((e) => e.type === 'shot.made')) made++;
    }
    expect(made).toBeLessThanOrEqual(2);
  });

  it('awards three points from beyond the arc', () => {
    const sim = makeSim({ at: SEMANTIC_SPOTS.top, shotOutcome: { mode: 'forced', result: 'make' } });
    run(sim, 20);
    shoot(sim);
    expect(sim.stats.points).toBe(3);
  });

  it('grades release timing', () => {
    expect(gradeTiming(0)).toBe('EXCELLENT');
    expect(gradeTiming(-0.07)).toBe('SLIGHTLY EARLY');
    expect(gradeTiming(0.07)).toBe('SLIGHTLY LATE');
    expect(gradeTiming(-0.2)).toBe('EARLY');
    expect(gradeTiming(0.2)).toBe('LATE');
  });

  it('reports release timing from the jump apex', () => {
    const sim = makeSim({ shotOutcome: { mode: 'forced', result: 'make' } });
    run(sim, 20);
    const early = shoot(sim, -0.2).find((e) => e.type === 'shot.released');
    expect(early && early.type === 'shot.released' && early.timing).toBe('EARLY');
  });

  it('shot probability responds to timing, distance, movement and contest', () => {
    const base = { attrs: DEFAULT_ATTRIBUTES, x: 0, z: 5, timing: 'EXCELLENT' as const, movementSpeed: 0, contest: 0 };
    const p = shotProbability(base);
    expect(shotProbability({ ...base, timing: 'LATE' })).toBeLessThan(p);
    expect(shotProbability({ ...base, z: 8.5 })).toBeLessThan(p);
    expect(shotProbability({ ...base, movementSpeed: 4 })).toBeLessThan(p);
    expect(shotProbability({ ...base, contest: 1 })).toBeLessThan(p);
    expect(shotProbability({ ...base, z: 1 })).toBeGreaterThan(p);
  });
});

describe('shot contest', () => {
  it('a defender in the shooter’s face lowers the make probability', async () => {
    const { Simulation } = await import('../simulation/runtime/simulation');
    const { GENERIC_GUARD, GENERIC_DEFENDER } = await import('../domain/characters/builtins');
    const { shotContest } = await import('../simulation/ball/ballSystem');
    const make = (defZ: number) =>
      new Simulation({
        seed: 1,
        collisionMode: 'hard',
        shotOutcome: { mode: 'simulated' },
        actors: [
          { id: 's', definition: GENERIC_GUARD, team: 'offense', position: { x: 0, z: 6 } },
          { id: 'd', definition: GENERIC_DEFENDER, team: 'defense', position: { x: 0, z: defZ } },
        ],
        ballHolder: 's',
        controlled: 's',
      });
    const tight = make(5.1);
    const open = make(1.5);
    expect(shotContest(tight.chars, tight.character('s')!)).toBeGreaterThan(0.6);
    expect(shotContest(open.chars, open.character('s')!)).toBe(0);
  });
});
