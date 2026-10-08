import { beforeAll, describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../simulation/runtime/fixedStep';
import { SIM_DT, type SimInput } from '../simulation/runtime/types';
import { resolveCharacterCollisions } from '../simulation/characters/collision';
import { initPhysics, input, makeSim, run } from './helpers';

beforeAll(() => initPhysics());

/** A scripted input sequence that exercises movement, dribbling and shooting. */
function scripted(tick: number): SimInput {
  const phase = Math.floor(tick / 40) % 4;
  const move = [{ x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0.3 }, { x: 0, z: 0 }][phase];
  return input({ move, sprint: phase === 1, aim: { x: 0, z: 0 }, shootHeld: tick > 200 && tick < 226 });
}

function fingerprint(sim: ReturnType<typeof makeSim>) {
  return JSON.stringify({
    chars: sim.chars.map((c) => c.state),
    ball: sim.physics.getBallPosition(),
    stats: sim.stats,
    rng: sim.rng.getState(),
  });
}

describe('simulation runtime', () => {
  it('is deterministic for the same seed and inputs', () => {
    const a = makeSim();
    const b = makeSim();
    for (let t = 0; t < 600; t++) {
      a.step(scripted(t));
      b.step(scripted(t));
    }
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('restores a snapshot and replays to an identical state (seek)', () => {
    const sim = makeSim();
    for (let t = 0; t < 180; t++) sim.step(scripted(t));
    const snap = sim.snapshot();
    for (let t = 180; t < 420; t++) sim.step(scripted(t));
    const expected = fingerprint(sim);

    sim.restore(snap);
    expect(sim.tick).toBe(180);
    for (let t = 180; t < 420; t++) sim.step(scripted(t));
    expect(fingerprint(sim)).toBe(expected);
  });

  it('moves the controlled character with WASD-style input and keeps auto-dribbling', () => {
    const sim = makeSim({ at: { x: 0, z: 6 } });
    const start = sim.character('guard')!.getPosition();
    const heights: number[] = [];
    for (let i = 0; i < 90; i++) {
      sim.step(input({ move: { x: 1, z: 0 } }));
      heights.push(sim.physics.getBallPosition().y);
    }
    const g = sim.character('guard')!;
    expect(g.getPosition().x - start.x).toBeGreaterThan(2.5);
    expect(g.state.locomotion).toBe('run');
    expect(sim.ball.holder).toBe('guard');
    // The ball bounces between the floor and the hand.
    expect(Math.min(...heights)).toBeLessThan(0.2);
    expect(Math.max(...heights)).toBeGreaterThan(0.8);
  });

  it('sprint is faster than run', () => {
    const speed = (sprint: boolean) => {
      const sim = makeSim();
      run(sim, 90, input({ move: { x: 1, z: 0 }, sprint }));
      return Math.hypot(sim.character('guard')!.state.velocity.x, sim.character('guard')!.state.velocity.z);
    };
    expect(speed(true)).toBeGreaterThan(speed(false) * 1.2);
  });

  it('smart pass reaches the teammate, who catches it and gains control', () => {
    const sim = makeSim({ at: { x: 0, z: 7 }, mascotAt: { x: 5, z: 4 } });
    run(sim, 20);
    const events = run(sim, 120, input({ commands: [{ kind: 'pass', slot: 1, lob: false }] }));
    expect(events.some((e) => e.type === 'pass.released')).toBe(true);
    expect(events).toContainEqual({ type: 'possession.gained', actor: 'mascot', via: 'catch' });
    expect(sim.ball.holder).toBe('mascot');
    expect(sim.controlled).toBe('mascot');
  });

  it('lob pass arcs higher and is still caught', () => {
    const sim = makeSim({ at: { x: 0, z: 7 }, mascotAt: { x: -5, z: 2 } });
    run(sim, 20);
    let peak = 0;
    for (let i = 0; i < 150; i++) {
      sim.step(input({ commands: i === 0 ? [{ kind: 'pass', slot: 1, lob: true }] : [] }));
      sim.drainEvents();
      if (sim.ball.holder === null) peak = Math.max(peak, sim.physics.getBallPosition().y);
    }
    expect(peak).toBeGreaterThan(3);
    expect(sim.ball.holder).toBe('mascot');
  });

  it('a loose ball can be picked up by walking to it', () => {
    const sim = makeSim({ at: { x: 0, z: 6 }, shotOutcome: { mode: 'forced', result: 'miss' } });
    run(sim, 20);
    sim.physics.placeBall({ x: 3, y: 0.12, z: 6 });
    sim.ball.holder = null;
    const events = run(sim, 120, input({ move: { x: 1, z: 0 } }));
    expect(events).toContainEqual({ type: 'possession.gained', actor: 'guard', via: 'pickup' });
  });

  it('hard collision blocks a route, soft collision lets players slide through', () => {
    for (const mode of ['hard', 'soft'] as const) {
      const sim = makeSim({ at: { x: -2, z: 5 }, mascotAt: { x: 0, z: 5 } });
      sim.collisionMode = mode;
      run(sim, 90, input({ move: { x: 1, z: 0 } }));
      const g = sim.character('guard')!.state;
      const m = sim.character('mascot')!.state;
      const gap = Math.hypot(g.position.x - m.position.x, g.position.z - m.position.z);
      if (mode === 'hard') expect(gap).toBeGreaterThan(g.radius + m.radius - 0.01);
      else expect(gap).toBeLessThan(g.radius + m.radius);
    }
  });

  it('resolves exactly coincident players deterministically', () => {
    const sim = makeSim({ at: { x: 1, z: 1 }, mascotAt: { x: 1, z: 1 } });
    resolveCharacterCollisions(sim.chars, 'hard');
    const [a, b] = sim.chars.map((c) => c.state.position);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(0.6);
  });
});

describe('FixedStepLoop', () => {
  it('runs a fixed number of steps independent of frame rate', () => {
    for (const fps of [30, 60, 144, 240]) {
      let steps = 0;
      const loop = new FixedStepLoop(() => steps++);
      for (let i = 0; i < fps * 2; i++) loop.advance(1 / fps, input());
      expect(Math.abs(steps - 120)).toBeLessThanOrEqual(1);
    }
  });

  it('delivers a queued command exactly once, even across zero-step frames', () => {
    const seen: number[] = [];
    const loop = new FixedStepLoop((inp) => seen.push(inp.commands.length));
    loop.queue({ kind: 'resetBall' });
    loop.advance(SIM_DT * 0.3, input()); // no step yet
    loop.advance(SIM_DT * 3, input()); // several steps
    expect(seen.filter((n) => n > 0)).toEqual([1]);
  });

  it('returns an interpolation alpha in [0, 1)', () => {
    const loop = new FixedStepLoop(() => {});
    const alpha = loop.advance(SIM_DT * 1.5, input());
    expect(alpha).toBeCloseTo(0.5, 5);
  });
});
