import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import highPnr from '../samples/high-pnr.yaml?raw';
import { parsePlayText } from '../domain/play/schema/validate';
import { compilePlay } from '../domain/play/compiler/compile';
import type { CoverageName } from '../domain/play/schema/playDefinition';
import { simulationFromPlay } from '../simulation/runtime/fromPlay';
import type { Simulation } from '../simulation/runtime/simulation';
import { EMPTY_INPUT } from '../simulation/runtime/types';
import { initPhysics } from './helpers';

beforeAll(() => initPhysics());

function graph() {
  const r = parsePlayText(highPnr);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return compilePlay(r.play);
}

/** Runs until the play completes (and any shot resolves) or the time limit. */
function runPlay(sim: Simulation, seconds = 20): string[] {
  const names: string[] = [];
  for (let i = 0; i < seconds * 60; i++) {
    sim.step(EMPTY_INPUT);
    for (const e of sim.drainEvents()) if (e.type === 'play.event') names.push(e.name);
    const shotPending = sim.ball.shot && !sim.ball.shot.resolved;
    if (sim.playState?.complete && !shotPending && i > 0) break;
  }
  return names;
}

const before = (names: string[], a: string, b: string) => {
  expect(names).toContain(a);
  expect(names).toContain(b);
  expect(names.indexOf(a)).toBeLessThan(names.indexOf(b));
};

describe('High Pick & Roll execution (5v5 sample)', () => {
  /** Positions of the two PnR defenders sampled while the handler uses the screen. */
  function trace(coverage: CoverageName) {
    const sim = simulationFromPlay(graph(), { coverage });
    const names: string[] = [];
    const samples: { t: number; node: string; x1: { x: number; z: number }; x5: { x: number; z: number }; h: { x: number; z: number }; s: { x: number; z: number } }[] = [];
    for (let i = 0; i < 14 * 60; i++) {
      sim.step(EMPTY_INPUT);
      for (const e of sim.drainEvents()) if (e.type === 'play.event') names.push(e.name);
      const p = (id: string) => ({ x: sim.character(id)!.state.position.x, z: sim.character(id)!.state.position.z });
      samples.push({ t: sim.time, node: sim.playState!.node, x1: p('x1'), x5: p('x5'), h: p('handler'), s: p('screener') });
      if (sim.playState!.complete && !(sim.ball.shot && !sim.ball.shot.resolved)) break;
    }
    return { sim, names, samples };
  }
  const rimDist = (p: { x: number; z: number }) => Math.hypot(p.x, p.z);

  it('the screen is set before the handler goes, and has collision meaning', () => {
    const { names } = trace('drop');
    before(names, 'screen.set', 'handler.clears_screen');
    expect(names).toContain('screen.connected');
    expect(names).not.toContain('screen.illegal');
  });

  it('drop: the big sits deep while the handler comes off; the handler pulls up', () => {
    const { names, samples } = trace('drop');
    const during = samples.filter((s) => s.node === 'drop_read');
    expect(Math.max(...during.map((s) => rimDist(s.x5)))).toBeLessThan(4.6);
    expect(names).toContain('play.option.pull_up');
    expect(names).toContain('handler.shot');
    expect(names).toContain('play.complete');
  });

  it('hedge: the big jumps out above the screen, then the short roll is hit', () => {
    const { names, samples } = trace('hedge');
    expect(Math.max(...samples.map((s) => rimDist(s.x5)))).toBeGreaterThan(7);
    before(names, 'play.node.hedge_read', 'play.node.short_roll');
    before(names, 'play.node.short_roll', 'screener.caught');
    expect(names).toContain('screener.shot');
  });

  it('switch: the screener\'s defender ends up guarding the handler', () => {
    const { sim, names, samples } = trace('switch');
    expect(sim.defenseMemory.assignments).toEqual({ x1: 'screener', x5: 'handler' });
    const late = samples.filter((s) => s.node === 'finish');
    expect(late.length).toBeGreaterThan(0);
    expect(names).toContain('handler.shot');
  });

  it('under vs over: the on-ball defender takes a different side of the screen', () => {
    const lowestZ = (c: CoverageName) => {
      const { samples } = trace(c);
      const window = samples.filter((s) => s.node === 'start' && s.t > 1.4);
      // How far the on-ball defender dips below the screener (toward the rim).
      return Math.min(...window.map((s) => s.x1.z - s.s.z));
    };
    expect(lowestZ('under')).toBeLessThan(lowestZ('go_over') - 0.3);
  });

  const finishes: [CoverageName, string][] = [
    ['under', 'pull_up'],
    ['go_over', 'downhill'],
    ['switch', 'switch_read'],
    ['drop', 'drop_read'],
    ['hedge', 'hedge_read'],
  ];
  for (const [coverage, node] of finishes) {
    it(`${coverage}: branches to ${node} and ends with a resolved shot`, () => {
      const { names } = trace(coverage);
      expect(names).toContain(`play.node.${node}`);
      expect(names.some((n) => n === 'shot.made' || n === 'shot.missed')).toBe(true);
      expect(names).toContain('play.complete');
    });
  }

  it('is deterministic and seekable mid-play', () => {
    const a = simulationFromPlay(graph());
    const b = simulationFromPlay(graph());
    for (let i = 0; i < 150; i++) {
      a.step(EMPTY_INPUT);
      b.step(EMPTY_INPUT);
    }
    const snap = a.snapshot();
    const fp = (s: Simulation) =>
      JSON.stringify({ c: s.chars.map((c) => c.state), b: s.physics.getBallPosition(), p: s.playState, scr: s.screens, d: s.defenseMemory });
    for (let i = 0; i < 300; i++) {
      a.step(EMPTY_INPUT);
      b.step(EMPTY_INPUT);
    }
    expect(fp(a)).toBe(fp(b));
    const end = fp(a);
    a.restore(snap);
    for (let i = 0; i < 300; i++) a.step(EMPTY_INPUT);
    expect(fp(a)).toBe(end);
  });

  it('a user-controlled actor gets no AI task, the rest of the play still runs', () => {
    const sim = simulationFromPlay(graph(), { controlled: 'handler' });
    const names = runPlay(sim, 4);
    expect(names).toContain('screen.set');
    expect(sim.playState!.tasks.handler).toBeDefined(); // assigned, but not executed by AI
    expect(Math.hypot(sim.character('handler')!.state.velocity.x, sim.character('handler')!.state.velocity.z)).toBeLessThan(0.01);
  });
});

describe('architecture', () => {
  it('defensive AI cannot import the play graph or play runtime (spec rule 7)', () => {
    const dir = join(__dirname, '../simulation/ai/defense');
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/playRuntime|play\/graph|offenseBrain/);
    }
  });

  it('domain and simulation never import React or Three.js', () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of [...walk(join(__dirname, '../domain')), ...walk(join(__dirname, '../simulation'))]) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/from 'three'|from 'react'|@react-three/);
    }
  });
});

describe('idle stability', () => {
  it('a ball handler standing still does not spin', () => {
    const sim = simulationFromPlay(graph(), { coverage: 'hedge' });
    for (let i = 0; i < 12 * 60; i++) sim.step(EMPTY_INPUT);
    const holder = sim.character(sim.ball.holder!)!;
    const before = holder.state.facing;
    for (let i = 0; i < 120; i++) sim.step(EMPTY_INPUT);
    expect(Math.abs(holder.state.facing - before)).toBeLessThan(0.05);
  });
});
