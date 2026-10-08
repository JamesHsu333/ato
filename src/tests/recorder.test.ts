import { beforeAll, describe, expect, it } from 'vitest';
import highPnr from '../samples/high-pnr.yaml?raw';
import { parsePlayText } from '../domain/play/schema/validate';
import { compilePlay } from '../domain/play/compiler/compile';
import { simulationFromPlay } from '../simulation/runtime/fromPlay';
import { recordPlay, seek, type Recording } from '../simulation/runtime/recorder';
import { EMPTY_INPUT } from '../simulation/runtime/types';
import type { Simulation } from '../simulation/runtime/simulation';
import { initPhysics } from './helpers';


const graph = () => {
  const r = parsePlayText(highPnr);
  if (!r.ok) throw new Error('invalid');
  return compilePlay(r.play);
};
const fp = (s: Simulation) => JSON.stringify({ c: s.chars.map((c) => c.state.position), b: s.physics.getBallPosition(), n: s.playState?.node });

describe('play recording & seeking', () => {
  let rec: Recording;
  beforeAll(async () => {
    await initPhysics();
    rec = recordPlay(simulationFromPlay(graph(), { collisionMode: 'soft' }));
  });

  it('records the whole possession with snapshots every 0.5 s', () => {
    expect(rec.duration).toBeGreaterThan(3);
    expect(rec.duration).toBeLessThan(15);
    const gaps = rec.snapshots.slice(1).map((s, i) => s.tick - rec.snapshots[i].tick);
    expect(new Set(gaps)).toEqual(new Set([30]));
  });

  it('records per-actor action segments and node changes for the timeline', () => {
    const screener = rec.segments.filter((s) => s.actor === 'screener').map((s) => s.label);
    expect(screener).toContain('screen');
    expect(screener).toContain('roll');
    expect(rec.segments.find((s) => s.actor === 'handler' && s.label.startsWith('wait'))).toBeDefined();
    expect(rec.nodes.map((n) => n.node)).toEqual(expect.arrayContaining(['start', 'read', 'drop_read']));
  });

  it('captures default paths for editable actions', () => {
    expect(rec.paths.find((p) => p.node === 'start' && p.actor === 'screener')?.path.length).toBeGreaterThan(5);
  });

  it('seeking to any time matches a continuous run exactly', () => {
    for (const t of [0, 0.7, 1.95, 3.33]) {
      const continuous = simulationFromPlay(graph(), { collisionMode: 'soft' });
      while (continuous.time < t - 1e-9) continuous.step(EMPTY_INPUT);
      const sought = simulationFromPlay(graph(), { collisionMode: 'soft' });
      seek(sought, rec, t);
      expect(fp(sought)).toBe(fp(continuous));
    }
  });
});
