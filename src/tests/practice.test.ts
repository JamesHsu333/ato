import { beforeAll, describe, expect, it } from 'vitest';
import highPnr from '../samples/high-pnr.yaml?raw';
import { parsePlayText } from '../domain/play/schema/validate';
import { compilePlay } from '../domain/play/compiler/compile';
import type { CoverageName } from '../domain/play/schema/playDefinition';
import { simulationFromPlay } from '../simulation/runtime/fromPlay';
import type { Simulation } from '../simulation/runtime/simulation';
import { EMPTY_INPUT, type SimInput } from '../simulation/runtime/types';
import { idealReleaseTime, jumpVelocity } from '../simulation/ball/shooting';
import { initPhysics } from './helpers';

beforeAll(() => initPhysics());

const graph = () => {
  const r = parsePlayText(highPnr);
  if (!r.ok) throw new Error('invalid');
  return compilePlay(r.play);
};

/** Input that follows the user's ghost route (what a player sees on screen). */
function followGhost(sim: Simulation, me: string): SimInput {
  const task = sim.playState!.tasks[me];
  const path = task?.started && !task.done ? task.step.path : null;
  if (!path) return EMPTY_INPUT;
  const p = sim.character(me)!.state.position;
  const look = path.slice(task!.step.pathIndex).find((q) => Math.hypot(q.x - p.x, q.z - p.z) > 0.8) ?? path[path.length - 1];
  const d = Math.hypot(look.x - p.x, look.z - p.z) || 1;
  return { ...EMPTY_INPUT, move: { x: (look.x - p.x) / d, z: (look.z - p.z) / d } };
}

type Policy = (sim: Simulation, names: string[]) => SimInput;

function runRep(coverage: CoverageName, me: string, policy: Policy, seconds = 14) {
  const sim = simulationFromPlay(graph(), { coverage, controlled: me, shotOutcome: { mode: 'forced', result: 'make' } });
  const names: string[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    sim.step(policy(sim, names));
    for (const e of sim.drainEvents()) if (e.type === 'play.event') names.push(e.name);
    if (sim.playState!.complete && !(sim.ball.shot && !sim.ball.shot.resolved)) break;
  }
  return { sim, names, result: sim.practiceResult()! };
}

/** Holds Space for the ideal time once `trigger` is true. */
function shooter(trigger: (sim: Simulation, names: string[]) => boolean): Policy {
  let held = -1;
  return (sim, names) => {
    const me = sim.controlled!;
    const ideal = idealReleaseTime(jumpVelocity(sim.character(me)!.definition.attributes));
    if (held < 0 && sim.ball.holder === me && trigger(sim, names)) held = 0;
    if (held >= 0 && held < ideal * 60) {
      held++;
      return { ...EMPTY_INPUT, shootHeld: true };
    }
    return followGhost(sim, me);
  };
}

describe('guided practice (Demo A: High PnR, user is the ball handler)', () => {
  it('waits for the screen, uses it, sees drop, hits the pocket pass: correct read', () => {
    let passed = false;
    const { names, result, sim } = runRep('drop', 'handler', (s, n) => {
      if (!passed && n.includes('play.node.drop_read') && s.ball.holder === 'handler') {
        passed = true;
        return { ...EMPTY_INPUT, commands: [{ kind: 'pass', slot: 1 + s.passSlots().indexOf('screener'), lob: false }] };
      }
      return followGhost(s, 'handler');
    });
    expect(names.indexOf('screen.set')).toBeLessThan(names.indexOf('handler.clears_screen'));
    expect(names).toContain('play.option.pocket_pass');
    expect(names).toContain('screener.caught');
    expect(result.decision).toMatchObject({ observed: 'pass:screener', correct: true });
    expect(result.scores.route).toBeGreaterThan(70);
    expect(result.scores.timing).toBeGreaterThan(60);
    expect(sim.playState!.complete).toBe(true);
  });

  it('pull-up vs drop is also a correct read, and the shot uses the timing mechanic', () => {
    const { names, result } = runRep('drop', 'handler', shooter((_, n) => n.includes('play.node.drop_read')));
    expect(names).toContain('play.option.pull_up');
    expect(result.decision).toMatchObject({ observed: 'shoot', correct: true });
    expect(names).toContain('shot.made');
  });

  it('leaving before the screen is set is reported with how early', () => {
    const { result } = runRep('drop', 'handler', (s) => (s.tick < 50 ? { ...EMPTY_INPUT, move: { x: 1, z: -0.3 } } : followGhost(s, 'handler')));
    expect(result.notes.join(' ')).toMatch(/You left \d\.\d\d s before the screen was set/);
    expect(result.scores.timing!).toBeLessThan(80);
  });

  it('teammates wait for a late user (adaptive waiting)', () => {
    // Stand still for 4 s after the screen is set: the screener keeps holding it.
    const { names } = runRep('drop', 'handler', (s, n) => {
      const setAt = n.indexOf('screen.set');
      return setAt >= 0 && s.time < 6 ? EMPTY_INPUT : followGhost(s, 'handler');
    });
    expect(names).toContain('handler.clears_screen');
    expect(names).not.toContain('screener.screen_released'.replace('released', 'timeout'));
  });
});

describe('Read & React (Demo C)', () => {
  it('driving into an under coverage is the wrong read', () => {
    const { result } = runRep('under', 'handler', (s) => {
      const p = s.character('handler')!.state.position;
      if (s.playState!.node === 'pull_up' || s.practice!.branch) {
        const d = Math.hypot(p.x, p.z - 1) || 1;
        return { ...EMPTY_INPUT, move: { x: -p.x / d, z: (1 - p.z) / d } };
      }
      return followGhost(s, 'handler');
    });
    expect(result.coverage).toBe('under');
    expect(result.decision).toMatchObject({ observed: 'drive', correct: false });
    expect(result.notes.join(' ')).toMatch(/Under/);
  });

  it('the pull-up three vs under is the right read', () => {
    const { result } = runRep('under', 'handler', shooter((s) => !!s.practice!.branch));
    expect(result.decision).toMatchObject({ observed: 'shoot', correct: true });
  });

  it('vs hedge, the short roll pass is correct; shooting into the show is not', () => {
    const pass = runRep('hedge', 'handler', (s, n) =>
      n.includes('play.node.hedge_read') && s.ball.holder === 'handler' && s.time > 3.6
        ? { ...EMPTY_INPUT, commands: [{ kind: 'pass', slot: 1 + s.passSlots().indexOf('screener'), lob: false }] }
        : followGhost(s, 'handler'),
    );
    expect(pass.result.decision.correct).toBe(true);
    const shoot = runRep('hedge', 'handler', shooter((s) => !!s.practice!.branch));
    expect(shoot.result.decision.correct).toBe(false);
  });
});

describe('guided practice: user is the screener', () => {
  it('walking the ghost route sets the screen and the AI handler uses it', () => {
    const { names, result } = runRep('drop', 'screener', (s) => followGhost(s, 'screener'));
    expect(names).toContain('screen.set');
    expect(names).toContain('handler.clears_screen');
    expect(result.scores.route).toBeGreaterThan(60);
  });

  it('slipping out of the screen early is reported', () => {
    const { names, result } = runRep('drop', 'screener', (s, n) =>
      n.includes('screen.set') && !n.includes('handler.clears_screen') ? { ...EMPTY_INPUT, move: { x: 0, z: -1 } } : followGhost(s, 'screener'),
    );
    expect(names).toContain('screener.left_screen_early');
    expect(result.notes.join(' ')).toMatch(/left the screen/);
  });
});
