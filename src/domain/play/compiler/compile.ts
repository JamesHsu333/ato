import type { PrimitiveAction, TargetRef, ActorPoint } from '../../actions/primitives';
import { normalizeCondition } from '../../conditions/condition';
import { RIM_CENTER } from '../../court/dimensions';
import { resolveSpot, SEMANTIC_SPOTS, type SemanticSpot } from '../../court/spots';
import { normalize2, type Vec2 } from '../../math/vec';
import type { CompiledAction, CompiledActor, PlayGraph, PlayNode } from '../graph/playGraph';
import { ACTION_ALIASES, type ActionDef, type PlayDefinition, type PositionDef, type SetupDef, type TargetDef } from '../schema/playDefinition';

const isSpot = (s: string): s is SemanticSpot => s in SEMANTIC_SPOTS;

export function resolvePosition(p: PositionDef): Vec2 {
  if (typeof p === 'string') return resolveSpot(p);
  if ('spot' in p) return resolveSpot(p.spot, p.offset ?? [0, 0]);
  return { x: p.x, z: p.z };
}

const RIM: Vec2 = { x: RIM_CENTER.x, z: RIM_CENTER.z };

/** Defensive alignment relative to the man (and ball) for setup placement. */
export function defensiveSpot(man: Vec2, ball: Vec2 | null, kind: SetupDef['defensive_position'] = 'matchup'): Vec2 {
  const toRim = normalize2({ x: RIM.x - man.x, z: RIM.z - man.z });
  const toBall = ball ? normalize2({ x: ball.x - man.x, z: ball.z - man.z }) : { x: 0, z: 0 };
  const [d, b] = kind === 'on_ball' ? [1.0, 0] : kind === 'help' ? [2.2, 0.9] : [1.4, 0.35];
  return { x: man.x + toRim.x * d + toBall.x * b, z: man.z + toRim.z * d + toBall.z * b };
}

function resolveSetup(play: PlayDefinition): { positions: Record<string, Vec2>; ballHolder: string | null } {
  const positions: Record<string, Vec2> = {};
  const ballHolder = Object.entries(play.setup).find(([, s]) => s.possession === 'ball')?.[0] ?? null;
  // Absolute positions first, then relative ones (defenders relative to their man).
  for (const [id, s] of Object.entries(play.setup)) if (s.position) positions[id] = resolvePosition(s.position);
  const ball = ballHolder ? positions[ballHolder] ?? null : null;
  for (const [id, s] of Object.entries(play.setup)) {
    if (s.position || !s.relative_to) continue;
    const anchor = positions[s.relative_to];
    if (!anchor) throw new Error(`setup.${id}: relative_to "${s.relative_to}" has no absolute position`);
    positions[id] = defensiveSpot(anchor, ball, s.defensive_position);
  }
  return { positions, ballHolder };
}

function targetRef(t: TargetDef): TargetRef {
  if (typeof t === 'string') {
    if (isSpot(t)) return { kind: 'point', ...resolveSpot(t) };
    const [actor, point] = t.split('.');
    return { kind: 'actor', actor, point: (point as ActorPoint | undefined) ?? 'center' };
  }
  if ('relative_to' in t) {
    if (t.purpose === 'screen') return { kind: 'screenSpot', defender: t.relative_to, side: t.side ?? 'auto' };
    return { kind: 'actor', actor: t.relative_to, point: 'center', offset: t.offset };
  }
  const p = resolvePosition(t);
  return { kind: 'point', x: p.x, z: p.z };
}

function popTarget(start: Vec2): TargetRef {
  return { kind: 'point', ...resolveSpot(start.x >= 0 ? 'right_slot' : 'left_slot') };
}

const RIM_TARGET: TargetRef = { kind: 'point', x: RIM.x, z: RIM.z };

/** Semantic → primitive actions (spec §24, rule 6). */
export function compileAction(input: ActionDef, startOf: (actor: string) => Vec2, defenderOf: (actor: string) => string | null): CompiledAction {
  const a: ActionDef = { ...input, action: ACTION_ALIASES[input.action] ?? input.action };
  const speed = a.speed ?? 'run';
  const override = a.path?.mode === 'override' ? a.path.points?.map(([x, z]) => ({ x, z })) : undefined;
  const via = a.via !== undefined ? [targetRef(a.via)] : [];
  const holdUntil = a.hold_until !== undefined ? normalizeCondition(a.hold_until) : undefined;
  const steps: PrimitiveAction[] = [];
  const screenSteps = (spotTo: TargetRef | null, defender: string | null, user: string | undefined, hold = holdUntil): PrimitiveAction[] => [
    {
      op: 'move',
      to: spotTo ?? { kind: 'screenSpot', defender: defender!, side: a.side ?? 'auto' },
      via: [],
      speed,
      arriveEvent: 'screen_position_ready',
    },
    { op: 'setPose', pose: 'screen' },
    { op: 'screenPosition', defender, user, side: a.side ?? 'auto', angle: a.angle ?? 'auto', holdUntil: hold },
    { op: 'setPose', pose: 'none' },
  ];
  switch (a.action) {
    case 'move':
    case 'cut':
    case 'flare': {
      const screenPurpose = typeof a.to === 'object' && a.to !== null && 'purpose' in a.to && a.to.purpose === 'screen';
      steps.push({
        op: 'move',
        to: targetRef(a.to!),
        via,
        override,
        speed: a.speed ?? (a.action === 'cut' ? 'sprint' : speed),
        arriveEvent: screenPurpose ? 'screen_position_ready' : undefined,
      });
      break;
    }
    case 'back_cut':
      steps.push({ op: 'move', to: a.to !== undefined ? targetRef(a.to) : RIM_TARGET, via, override, speed: a.speed ?? 'sprint' });
      break;
    case 'v_cut':
      // Sell it inside, then pop out.
      steps.push(
        { op: 'move', to: { kind: 'self', toward: 'rim', distance: 1.6 }, via: [], speed: 'run' },
        { op: 'move', to: targetRef(a.to!), via, override, speed: a.speed ?? 'sprint' },
      );
      break;
    case 'curl':
      // Tight around the screener's far side, then toward the rim (or `to`).
      steps.push({
        op: 'move',
        to: a.to !== undefined ? targetRef(a.to) : { kind: 'point', ...resolveSpot('restricted_area', [0, 0.8]) },
        via: [{ kind: 'actor', actor: a.around!, point: 'back' }],
        override,
        speed: a.speed ?? 'sprint',
      });
      break;
    case 'slip':
      // Fake the screen, then dive before contact.
      steps.push(
        { op: 'move', to: { kind: 'screenSpot', defender: a.target ?? '', side: a.side ?? 'auto' }, via: [], speed },
        { op: 'move', to: a.to !== undefined ? targetRef(a.to) : RIM_TARGET, via: [], speed: 'sprint' },
      );
      if (!a.target) steps.shift();
      break;
    case 'wait':
      steps.push({ op: 'wait', duration: a.duration, until: holdUntil });
      break;
    case 'pass':
    case 'lob':
      steps.push({ op: 'pass', target: a.target!, lob: a.action === 'lob' || a.type === 'lob' });
      break;
    case 'alley_oop':
      steps.push({ op: 'pass', target: a.target!, lob: true, lead: a.to !== undefined ? targetRef(a.to) : RIM_TARGET });
      break;
    case 'handoff':
      if (a.to !== undefined) steps.push({ op: 'move', to: targetRef(a.to), via, override, speed: a.speed ?? 'jog' });
      steps.push({ op: 'handoff', target: a.target! });
      break;
    case 'shoot':
      steps.push({ op: 'shoot', shotType: a.type ?? 'jump_shot' });
      break;
    case 'layup':
    case 'dunk':
      steps.push({ op: 'shoot', shotType: a.action });
      break;
    case 'screen':
    case 'pin_down':
    case 'flare_screen': {
      const defender = a.target ?? (a.for ? defenderOf(a.for) : null);
      const spot = a.to !== undefined ? targetRef(a.to) : null;
      if (!spot && !defender) throw new Error(`${a.actor}: ${a.action} needs a target defender or a spot`);
      steps.push(...screenSteps(spot, defender, a.for));
      break;
    }
    case 'elevator': {
      // One "door": stand at `to`, let the user come through, then close to `close_to`.
      const defender = a.target ?? defenderOf(a.for!);
      const through = { kind: 'event' as const, name: `${a.for}.clears_screen` };
      steps.push(...screenSteps(targetRef(a.to!), defender, a.for, holdUntil ?? through));
      steps.push(
        { op: 'move', to: targetRef(a.close_to!), via: [], speed: 'sprint' },
        { op: 'setPose', pose: 'screen' },
        { op: 'hold', maxSeconds: 1.5 },
        { op: 'setPose', pose: 'none' },
      );
      break;
    }
    case 'roll':
      steps.push({ op: 'move', to: targetRef(a.to ?? 'rim'), via, override, speed: a.speed ?? 'run' });
      break;
    case 'pop':
      steps.push({ op: 'move', to: a.to !== undefined ? targetRef(a.to) : popTarget(startOf(a.actor)), via, override, speed });
      break;
    case 'drive': {
      const to = a.to !== undefined ? targetRef(a.to) : via[0];
      steps.push({
        op: 'move',
        to,
        via: a.to !== undefined ? via : [],
        override,
        speed: a.speed ?? 'run',
        continuePast: a.to === undefined ? 3.5 : undefined,
      });
      break;
    }
  }
  return { actor: a.actor, semantic: a.action, when: a.when !== undefined ? normalizeCondition(a.when) : undefined, steps };
}

/** PlayDefinition → PlayGraph. Assumes the definition already passed validatePlay(). */
export function compilePlay(play: PlayDefinition): PlayGraph {
  const { positions, ballHolder } = resolveSetup(play);
  const startOf = (id: string) => positions[id] ?? RIM;
  const defenderOf = (id: string) => Object.entries(play.actors).find(([, a]) => a.assignment === id)?.[0] ?? null;

  const actors: CompiledActor[] = Object.entries(play.actors).map(([id, a]) => {
    const s = play.setup[id] ?? {};
    const start = positions[id];
    let facing: number;
    if (typeof s.facing === 'number') facing = (s.facing * Math.PI) / 180;
    else {
      const look =
        typeof s.facing === 'string'
          ? resolveSpot(s.facing)
          : a.team === 'defense' && (s.relative_to ?? a.assignment)
            ? positions[(s.relative_to ?? a.assignment)!]
            : RIM;
      facing = Math.atan2(look.x - start.x, look.z - start.z);
    }
    return { id, characterId: a.character, team: a.team, role: a.role, assignment: a.assignment, start, facing };
  });

  const nodes: Record<string, PlayNode> = {};
  for (const [id, n] of Object.entries(play.graph)) {
    nodes[id] = {
      id,
      actions: (n.actions ?? []).map((a) => compileAction(a, startOf, defenderOf)),
      options: (n.player_options ?? []).map((o) => ({
        id: o.id,
        label: o.label ?? o.id.replace(/_/g, ' '),
        action: compileAction(o.action, startOf, defenderOf),
      })),
      transitions: (n.transitions ?? []).map((t) => ({ when: normalizeCondition(t.when), to: t.to })),
    };
  }

  const start = play.play.start ?? (play.graph.start ? 'start' : Object.keys(play.graph)[0]);
  return {
    id: play.play.id,
    name: play.play.name,
    description: play.play.description,
    actors,
    ballHolder,
    start,
    nodes,
    simulation: {
      seed: play.simulation?.seed ?? 42,
      shotOutcome: play.simulation?.shot_outcome ?? { mode: 'simulated' },
      coverage: play.simulation?.defense?.coverage ?? 'drop',
      deny: play.simulation?.defense?.deny ?? false,
    },
    source: play,
  };
}
