import { beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_PLAYS } from '../samples';
import { parsePlayText } from '../domain/play/schema/validate';
import { compilePlay } from '../domain/play/compiler/compile';
import { simulationFromPlay, type PlaySimOptions } from '../simulation/runtime/fromPlay';
import type { Simulation } from '../simulation/runtime/simulation';
import { EMPTY_INPUT, type SimEvent, type SimInput } from '../simulation/runtime/types';
import { idealReleaseTime, jumpVelocity } from '../simulation/ball/shooting';
import { initPhysics } from './helpers';

beforeAll(() => initPhysics());

const graphOf = (id: string, patch?: (yaml: string) => string) => {
  const s = SAMPLE_PLAYS.find((p) => p.id === id)!;
  const r = parsePlayText(patch ? patch(s.yaml) : s.yaml);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return compilePlay(r.play);
};

type Policy = (sim: Simulation, names: string[]) => SimInput;

function run(id: string, opts: PlaySimOptions = {}, policy: Policy = () => EMPTY_INPUT, onStep?: (sim: Simulation, names: string[], raw: SimEvent[]) => void, patch?: (y: string) => string) {
  const sim = simulationFromPlay(graphOf(id, patch), opts);
  const names: string[] = [];
  for (let i = 0; i < 16 * 60; i++) {
    sim.step(policy(sim, names));
    const raw = sim.drainEvents();
    for (const e of raw) if (e.type === 'play.event') names.push(e.name);
    onStep?.(sim, names, raw);
    if (sim.playState!.complete && !(sim.ball.shot && !sim.ball.shot.resolved)) break;
  }
  return { sim, names };
}

const before = (names: string[], a: string, b: string) => {
  expect(names, a).toContain(a);
  expect(names, b).toContain(b);
  expect(names.indexOf(a)).toBeLessThan(names.indexOf(b));
};

describe('sample play library (spec §49–50)', () => {
  it('has all eight plays', () => {
    expect(SAMPLE_PLAYS.map((p) => p.id)).toEqual(['high-pnr', 'elevator', 'floppy', 'spain-pnr', 'horns', 'backdoor', 'dho', 'alley-oop']);
  });

  for (const p of SAMPLE_PLAYS) {
    it(`${p.name} runs to a resolved possession`, () => {
      const { sim, names } = run(p.id);
      expect(sim.playState!.complete).toBe(true);
      expect(names.some((n) => n === 'shot.made' || n === 'shot.missed')).toBe(true);
      expect(names).not.toContain('play.turnover');
      expect(names).not.toContain('screen.illegal');
    });
  }

  it('Elevator: doors set, shooter comes through, doors close on his man, catch-and-shoot', () => {
    const gaps: { t: number; gap: number; cleared: boolean }[] = [];
    let separationAtCatch = 0;
    const { names } = run('elevator', {}, undefined, (sim, n, raw) => {
      const l = sim.character('door_l')!.state.position;
      const r = sim.character('door_r')!.state.position;
      gaps.push({ t: sim.time, gap: Math.hypot(l.x - r.x, l.z - r.z), cleared: n.includes('shooter.clears_screen') });
      if (raw.some((e) => e.type === 'possession.gained' && e.actor === 'shooter')) {
        const s = sim.character('shooter')!.state.position;
        const d = sim.character('x2')!.state.position;
        separationAtCatch = Math.hypot(s.x - d.x, s.z - d.z);
      }
    });
    before(names, 'door_r.screen_set', 'shooter.clears_screen');
    before(names, 'shooter.clears_screen', 'shooter.caught');
    before(names, 'shooter.caught', 'shooter.shot');
    // Open while he comes through; the doors then close and his defender is caught behind them.
    expect(Math.min(...gaps.filter((g) => !g.cleared && g.t > 0.8).map((g) => g.gap))).toBeGreaterThan(1.5);
    expect(Math.min(...gaps.filter((g) => g.cleared).map((g) => g.gap))).toBeLessThan(1.25);
    expect(separationAtCatch).toBeGreaterThan(1.8);
  });

  it('Floppy: the route picks the screen; the shooter catches and shoots', () => {
    const { names } = run('floppy');
    expect(names).toContain('play.option.double_side');
    before(names, 'shooter.cut_done', 'shooter.caught');
    expect(names).toContain('shooter.shot');
  });

  it('Spain PnR: ball screen, then a back screen on the big’s defender, multi-stage graph', () => {
    const { names } = run('spain-pnr');
    before(names, 'screener.screen_set', 'spain.screen_set');
    for (const n of ['play.node.spain', 'play.node.big_finish', 'play.node.slam']) expect(names).toContain(n);
  });

  it('Horns: branching entry — the AI takes the right horn, a user can take the left', () => {
    expect(run('horns').names).toContain('play.node.right_pnr');
    const { names } = run('horns', { controlled: 'handler' }, (sim) =>
      sim.time < 1.2 ? { ...EMPTY_INPUT, move: { x: 0.7, z: 0.3 } } : EMPTY_INPUT,
    );
    expect(names).toContain('play.option.left_horn');
    expect(names).toContain('play.node.left_pnr');
  });

  it('Backdoor: denial triggers the back cut; without denial the wing just catches', () => {
    const denied = run('backdoor').names;
    before(denied, 'wing.denied', 'play.node.backdoor');
    before(denied, 'play.node.backdoor', 'wing.caught');
    const sag = run('backdoor', {}, undefined, undefined, (y) => y.replace('deny: true', 'deny: false')).names;
    expect(sag).not.toContain('play.node.backdoor');
    expect(sag).toContain('play.node.entry');
  });

  it('DHO: possession changes hands with no pass in the air', () => {
    let flights = 0;
    const { names } = run('dho', {}, undefined, (_s, _n, raw) => {
      flights += raw.filter((e) => e.type === 'pass.released').length;
    });
    before(names, 'big.handed_off', 'guard.caught');
    expect(flights).toBe(0);
  });

  it('Alley-Oop: lob above the rim, timed jump, airborne catch, finish at the rim', () => {
    let catchY = -1;
    let release: { distance: number; timing: string } | null = null;
    run('alley-oop', {}, undefined, (sim, _n, raw) => {
      for (const e of raw) {
        if (e.type === 'possession.gained' && e.actor === 'big') {
          const a = sim.character('big')!.state.action;
          catchY = a.kind === 'catch' && a.air ? a.air : 0;
        }
        if (e.type === 'shot.released') release = e;
      }
    });
    expect(catchY).toBeGreaterThan(0); // caught while airborne
    expect(release).not.toBeNull();
    expect(release!.distance).toBeLessThan(2);
    expect(release!.timing).toMatch(/EXCELLENT|SLIGHTLY/);
  });
});

describe('Demo B — Elevator Doors with the user as the shooter', () => {
  function followGhost(sim: Simulation, me: string): SimInput {
    const task = sim.playState!.tasks[me];
    const path = task?.started && !task.done ? task.step.path : null;
    if (!path) return EMPTY_INPUT;
    const p = sim.character(me)!.state.position;
    const look = path.slice(task!.step.pathIndex).find((q) => Math.hypot(q.x - p.x, q.z - p.z) > 0.8) ?? path[path.length - 1];
    const d = Math.hypot(look.x - p.x, look.z - p.z) || 1;
    return { ...EMPTY_INPUT, move: { x: (look.x - p.x) / d, z: (look.z - p.z) / d } };
  }

  it('screeners wait for a late shooter, close only after he passes, and he catches and shoots', () => {
    let holdUntil = -1;
    let gapWhileWaiting = Infinity;
    const { names } = run('elevator', { controlled: 'shooter', shotOutcome: { mode: 'forced', result: 'make' } }, (sim, n) => {
      const setAt = n.includes('door_r.screen_set') && n.includes('door_l.screen_set');
      if (setAt && holdUntil < 0) holdUntil = sim.time + 3; // arrive 3 s late
      if (holdUntil < 0 || sim.time < holdUntil) {
        if (setAt) {
          const l = sim.character('door_l')!.state.position;
          const r = sim.character('door_r')!.state.position;
          gapWhileWaiting = Math.min(gapWhileWaiting, Math.hypot(l.x - r.x, l.z - r.z));
        }
        return EMPTY_INPUT;
      }
      if (sim.ball.holder === 'shooter') {
        const ideal = idealReleaseTime(jumpVelocity(sim.character('shooter')!.definition.attributes));
        const started = (sim.character('shooter')!.state.action.kind === 'shoot' && sim.character('shooter')!.state.action) as { t: number } | false;
        return { ...EMPTY_INPUT, shootHeld: !started || started.t < ideal };
      }
      return followGhost(sim, 'shooter');
    });
    expect(gapWhileWaiting).toBeGreaterThan(1.5); // doors stayed open while he was late
    before(names, 'shooter.clears_screen', 'door_l.screen_released');
    before(names, 'shooter.caught', 'shooter.shot');
    expect(names).toContain('shot.made');
  });
});
