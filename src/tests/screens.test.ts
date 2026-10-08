import { beforeAll, describe, expect, it } from 'vitest';
import { createScreen, updateScreen } from '../simulation/ai/screens';
import { screenSpot } from '../simulation/ai/targets';
import type { PlayerView, WorldView } from '../simulation/ai/world';
import { laneBlocker } from '../simulation/ball/ballSystem';
import { GENERIC_DEFENDER, GENERIC_GUARD } from '../domain/characters/builtins';
import { Simulation } from '../simulation/runtime/simulation';
import { initPhysics } from './helpers';

beforeAll(() => initPhysics());

const player = (id: string, team: 'offense' | 'defense', x: number, z: number, extra: Partial<PlayerView> = {}): PlayerView => ({
  id,
  team,
  position: { x, z },
  velocity: { x: 0, z: 0 },
  radius: 0.35,
  facing: 0,
  moving: false,
  ...extra,
});

const world = (players: PlayerView[]): WorldView => ({ players, ball: { position: { x: 0, z: 8 }, height: 1, holder: 'h' } });

describe('screens', () => {
  it('places the screen beside the defender on the requested side (as seen by the user)', () => {
    const w = world([player('h', 'offense', 0, 8), player('x1', 'defense', 0, 7, { assignment: 'h' }), player('s', 'offense', 3, 5)]);
    const s = w.players[2];
    const auto = screenSpot(w, s, 'x1', 'auto')!;
    expect(auto.x).toBeGreaterThan(0.6); // screener came from the right
    expect(auto.z).toBeCloseTo(7);
    expect(screenSpot(w, s, 'x1', 'left')!.x).toBeLessThan(-0.6);
  });

  it('flags a moving screen as illegal but keeps tracking it', () => {
    const w = world([
      player('h', 'offense', 0, 8),
      player('x1', 'defense', 0, 7, { assignment: 'h' }),
      player('s', 'offense', 0.9, 7),
    ]);
    const scr = createScreen(w, 's', 'x1', 0)!;
    w.players[2] = player('s', 'offense', 0.65, 7, { moving: true });
    const events = updateScreen(scr, w);
    expect(events).toContain('screen.connected');
    expect(events).toContain('screen.illegal');
    expect(scr.released).toBe(false);
  });

  it('a stationary screen with contact is legal', () => {
    const w = world([player('h', 'offense', 0, 8), player('x1', 'defense', 0.05, 7, { assignment: 'h' }), player('s', 'offense', 0.75, 7)]);
    const scr = createScreen(w, 's', 'x1', 0)!;
    expect(updateScreen(scr, w)).toEqual(['screen.connected', 's.screen_connected']);
  });

  it('emits <user>.clears_screen once the user gets past the screen plane', () => {
    const w = world([player('h', 'offense', 0, 8.5), player('x1', 'defense', 0, 7.5, { assignment: 'h' }), player('s', 'offense', 0.8, 7.5)]);
    const scr = createScreen(w, 's', 'x1', 0)!;
    w.players[0] = player('h', 'offense', 1.6, 6.9);
    const events = updateScreen(scr, w);
    expect(events).toContain('h.clears_screen');
    expect(events).toContain('screen.missed'); // the defender never touched the screener
  });
});

describe('smart pass', () => {
  it('detects an opponent in the passing lane and lobs over him', () => {
    const sim = new Simulation({
      seed: 1,
      collisionMode: 'hard',
      shotOutcome: { mode: 'simulated' },
      actors: [
        { id: 'a', definition: GENERIC_GUARD, team: 'offense', position: { x: 0, z: 8 } },
        { id: 'b', definition: GENERIC_GUARD, team: 'offense', position: { x: 0, z: 2 } },
        { id: 'd', definition: GENERIC_DEFENDER, team: 'defense', position: { x: 0.2, z: 5 } },
      ],
      ballHolder: 'a',
      controlled: 'a',
    });
    expect(laneBlocker(sim.chars, sim.character('a')!, sim.character('b')!)?.id).toBe('d');
    for (let i = 0; i < 20; i++) sim.step({ move: { x: 0, z: 0 }, sprint: false, aim: null, shootHeld: false, commands: [] });
    sim.drainEvents();
    sim.step({ move: { x: 0, z: 0 }, sprint: false, aim: null, shootHeld: false, commands: [{ kind: 'pass', slot: 1, lob: false }] });
    expect(sim.drainEvents()).toContainEqual({ type: 'pass.released', actor: 'a', target: 'b', lob: true });
  });
});
