import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import highPnr from '../samples/high-pnr.yaml?raw';
import type { PlayDefinition } from '../domain/play/schema/playDefinition';
import { validatePlay } from '../domain/play/schema/validate';
import * as E from '../domain/play/edit/edits';

const base = () => parseYaml(highPnr) as PlayDefinition;
const valid = (p: PlayDefinition) => {
  const r = validatePlay(p);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};

describe('play edits', () => {
  it('dragging a player snaps to semantic spots, otherwise stores coordinates', () => {
    const p = base();
    expect(E.moveActorStart(p, 'handler', { x: 6.1, z: 4.9 }).setup.handler.position).toBe('right_wing');
    expect(E.moveActorStart(p, 'handler', { x: 1.234, z: 5.678 }).setup.handler.position).toEqual({ x: 1.23, z: 5.68 });
    expect(p.setup.handler.position).toEqual({ spot: 'top', offset: [0.4, 0.6] }); // input untouched
  });

  it('dragging a defender pins him (drops relative setup)', () => {
    const next = E.moveActorStart(base(), 'x1', { x: 1, z: 6 });
    expect(next.setup.x1).toEqual({ position: { x: 1, z: 6 } });
    valid(next);
  });

  it('shift-drag adds a move; a second move waits for the first', () => {
    let p = E.addMove(base(), 'start', 'wing', { x: -6.2, z: 4.8 });
    p = E.addMove(p, 'start', 'wing', { x: -3, z: 7 }, { x: -5, z: 7 });
    const moves = p.graph.start.actions!.filter((a) => a.actor === 'wing');
    expect(moves[0]).toEqual({ actor: 'wing', action: 'move', to: 'left_wing' });
    expect(moves[1]).toMatchObject({ to: { x: -3, z: 7 }, path: { mode: 'override', points: [[-5, 7]] }, when: { event: 'wing.move_done' } });
    valid(p);
  });

  it('adding and removing actors keeps the play valid', () => {
    expect(E.addActor(base(), 'defense', 'generic_defender', { x: 0, z: 2 }).id).toBeNull(); // already 5
    const { play, id } = E.addActor(E.emptyPlay('t'), 'defense', 'generic_defender', { x: 0, z: 2 });
    expect(id).toBe('x2');
    valid(play);
    const removed = E.removeActor(base(), 'screener');
    valid(removed);
    expect(JSON.stringify(removed.graph)).not.toContain('"screener"');
    expect(removed.actors.x5.assignment).toBeUndefined();
  });

  it('adds an event-sequenced step after a node', () => {
    const { play, id } = E.addNodeAfter(E.addMove(E.emptyPlay('t'), 'start', 'o1', { x: 2, z: 6 }), 'start');
    expect(play.graph.start.transitions).toEqual([{ when: 'o1.move_done', to: id }]);
    valid(play);
  });

  it('duplicates with a unique id', () => {
    const d = E.duplicatePlay(base(), ['high-pnr', 'high-pnr-copy']);
    expect(d.play.id).toBe('high-pnr-copy-2');
    expect(d.play.name).toBe('High Pick & Roll (copy)');
  });

  it('the empty play template is valid', () => {
    valid(E.emptyPlay('new-play'));
  });
});
