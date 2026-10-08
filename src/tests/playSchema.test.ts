import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import highPnr from './fixtures/high-pnr-spec.yaml?raw';
import { parsePlayText, serializePlay, validatePlay } from '../domain/play/schema/validate';
import { compilePlay } from '../domain/play/compiler/compile';
import type { PlayDefinition } from '../domain/play/schema/playDefinition';
import { SAMPLE_PLAYS } from '../samples';

const base = () => parseYaml(highPnr) as PlayDefinition;

function expectError(mutate: (p: PlayDefinition) => void, path: string, message: RegExp) {
  const p = base();
  mutate(p);
  const r = validatePlay(p);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors).toContainEqual({ path, message: expect.stringMatching(message) });
}

describe('play schema v0.1', () => {
  it('accepts the High PnR sample with no warnings', () => {
    const r = parsePlayText(highPnr);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.warnings).toEqual([]);
  });

  it('round-trips through YAML and JSON unchanged', () => {
    const r = parsePlayText(highPnr);
    if (!r.ok) throw new Error('invalid');
    for (const fmt of ['yaml', 'json'] as const) {
      const again = parsePlayText(serializePlay(r.play, fmt));
      expect(again.ok && again.play).toEqual(r.play);
    }
  });

  it('reports YAML syntax errors', () => {
    const r = parsePlayText('version: "0.1"\nplay: [unclosed');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toMatch(/YAML syntax/);
  });

  it('rejects an unsupported version', () => {
    expectError((p) => ((p as { version: string }).version = '9.9'), 'version', /must be "0.1"/);
  });

  it('rejects unknown properties', () => {
    expectError((p) => ((p.actors.handler as unknown as Record<string, unknown>).speed = 99), 'actors.handler', /unknown property "speed"/);
  });

  it('requires a pass target', () => {
    expectError(
      (p) => p.graph.pull_up.actions!.push({ actor: 'handler', action: 'pass' }),
      'graph.pull_up.actions[1]',
      /missing required property "target"/,
    );
  });

  it('rejects unknown semantic spots', () => {
    expectError((p) => (p.setup.handler.position = 'half_court_logo' as never), 'setup.handler.position', /.+/);
  });

  it('checks transition targets and actor references', () => {
    expectError((p) => (p.graph.start.transitions![0].to = 'nowhere'), 'graph.start.transitions[0].to', /unknown node "nowhere"/);
    expectError((p) => (p.graph.screen.actions![1].actor = 'ghost'), 'graph.screen.actions[1].actor', /unknown actor "ghost"/);
    expectError((p) => (p.graph.screen.actions![1].via = 'screener.elbow'), 'graph.screen.actions[1].via', /unknown point "elbow"/);
  });

  it('checks team rules', () => {
    expectError((p) => (p.setup.screener.possession = 'ball'), 'setup', /only one actor can start with the ball/);
    expectError((p) => (p.graph.screen.actions![0].target = 'handler'), 'graph.screen.actions[0].target', /opposing defender/);
    expectError(
      (p) => {
        for (let i = 0; i < 4; i++) {
          p.actors[`o${i}`] = { character: 'generic_wing', team: 'offense' };
          p.setup[`o${i}`] = { position: 'left_corner' };
        }
      },
      'actors',
      /at most 5 offense players/,
    );
    expectError((p) => (p.actors.x1.assignment = 'x5'), 'actors.x1.assignment', /not an offensive player/);
    expectError((p) => (p.actors.x1.character = 'lebron'), 'actors.x1.character', /unknown character/);
  });

  it('warns about unreachable nodes', () => {
    const p = base();
    p.graph.orphan = { actions: [] };
    const r = validatePlay(p);
    expect(r.ok && r.warnings).toContainEqual({ path: 'graph.orphan', message: expect.stringMatching(/not reachable/) });
  });
});

describe('sample library', () => {
  it('every sample play validates without warnings', () => {
    for (const s of SAMPLE_PLAYS) {
      const r = parsePlayText(s.yaml);
      expect(r.ok ? r.warnings : r.errors, s.id).toEqual([]);
    }
  });
});

describe('play compiler', () => {
  const graph = compilePlay(base());

  it('resolves semantic setup positions and defensive alignment', () => {
    const at = (id: string) => graph.actors.find((a) => a.id === id)!.start;
    expect(at('handler')).toEqual({ x: 0, z: 8.2 });
    const x1 = at('x1');
    expect(x1.x).toBeCloseTo(0);
    expect(x1.z).toBeCloseTo(7.2); // on-ball: 1 m toward the rim
    expect(graph.ballHolder).toBe('handler');
  });

  it('compiles the semantic screen into primitive actions', () => {
    const screen = graph.nodes.screen.actions.find((a) => a.actor === 'screener')!;
    expect(screen.steps.map((s) => s.op)).toEqual(['move', 'setPose', 'screenPosition', 'setPose']);
    expect(screen.steps[2]).toMatchObject({ defender: 'x1', holdUntil: { kind: 'event', name: 'handler.clears_screen' } });
  });

  it('compiles drive via an actor point and roll to the rim', () => {
    const drive = graph.nodes.screen.actions.find((a) => a.actor === 'handler')!;
    expect(drive.steps[0]).toMatchObject({ op: 'move', to: { kind: 'actor', actor: 'screener', point: 'right_shoulder' }, continuePast: 3.5 });
    const roll = graph.nodes.downhill.actions.find((a) => a.actor === 'screener')!;
    expect(roll.steps[0]).toMatchObject({ op: 'move', to: { kind: 'point', x: 0, z: 0 } });
  });

  it('keeps the play graph branching structure', () => {
    expect(graph.nodes.read.transitions.map((t) => t.to)).toEqual(['pull_up', 'drop_read', 'switch_read', 'hedge_read', 'downhill']);
    expect(graph.nodes.drop_read.options.map((o) => o.id)).toEqual(['pocket_pass', 'floater']);
  });
});
