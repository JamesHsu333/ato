import { RIM_CENTER } from '../../../domain/court/dimensions';
import { clamp, normalize2, type Vec2 } from '../../../domain/math/vec';
import type { CoverageName } from '../../../domain/play/schema/playDefinition';
import { SIM_DT } from '../../runtime/types';
import { playerById, type PlayerView } from '../world';
import type { DefenderIntent, DefenseMemory, DefenseView } from './defenseView';
import { manSpot } from './manDefense';
import { navigate, type ScreenNavigation } from './navigation';

const RIM: Vec2 = { x: RIM_CENTER.x, z: RIM_CENTER.z };
const REACTION_TAU = 0.16; // seconds: defenders see the offense with a short lag
const RECOVER_AFTER = 2.6; // seconds after the handler clears before the PnR read ends

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + b.x * k, z: a.z + b.z * k });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** How each coverage navigates the screen with the on-ball defender. */
const ON_BALL_NAV: Record<CoverageName, ScreenNavigation> = {
  man: 'through',
  drop: 'over',
  go_over: 'over',
  under: 'under',
  switch: 'through',
  hedge: 'over',
};

function perceive(mem: DefenseMemory, view: DefenseView): void {
  const k = 1 - Math.exp(-SIM_DT / REACTION_TAU);
  for (const p of view.players) {
    if (p.team !== 'offense') continue;
    const prev = mem.perceived[p.id];
    mem.perceived[p.id] = prev ? { x: prev.x + (p.position.x - prev.x) * k, z: prev.z + (p.position.z - prev.z) * k } : { ...p.position };
  }
}

const assignmentOf = (mem: DefenseMemory, d: PlayerView): string | undefined => mem.assignments[d.id] ?? d.assignment;

/** Recognizes a ball screen from visible cues: a set screen, or a big closing on the on-ball defender. */
function readScreen(mem: DefenseMemory, view: DefenseView, defenders: PlayerView[]): void {
  const holder = view.ball.holder ? playerById(view, view.ball.holder) : undefined;
  if (mem.pnr) {
    const p = mem.pnr;
    p.t += SIM_DT;
    const handler = playerById(view, p.handler);
    const screener = playerById(view, p.screener);
    const scr = view.screens.find((s) => s.screener === p.screener);
    if (p.clearedT === null && (scr?.cleared || (handler && screener && dist(handler.position, screener.position) > 3.2 && p.t > 0.8))) p.clearedT = 0;
    if (p.clearedT !== null) p.clearedT += SIM_DT;
    const ballMoved = view.ball.holder !== p.handler;
    if ((p.clearedT ?? 0) > RECOVER_AFTER || (ballMoved && p.t > 0.3 && view.ball.holder !== null) || p.t > 7) mem.pnr = null;
    return;
  }
  if (!holder || holder.team !== 'offense') return;
  const onBall = defenders.find((d) => assignmentOf(mem, d) === holder.id);
  if (!onBall) return;
  const active = view.screens.find((s) => s.defender === onBall.id && !s.cleared);
  let screener = active ? playerById(view, active.screener) : undefined;
  if (!screener) {
    // Early call: an offensive player closing on the on-ball defender.
    screener = view.players.find((p) => {
      if (p.team !== 'offense' || p.id === holder.id) return false;
      const rel = sub(onBall.position, p.position);
      const d = Math.hypot(rel.x, rel.z);
      const closing = (p.velocity.x * rel.x + p.velocity.z * rel.z) / (d || 1);
      return d < 2.0 && closing > 1.0;
    });
  }
  if (!screener) return;
  const big = defenders.find((d) => assignmentOf(mem, d) === screener!.id) ?? null;
  const drive = normalize2(sub(add(screener.position, normalize2(sub(RIM, screener.position)), 1.5), holder.position));
  mem.pnr = { handler: holder.id, screener: screener.id, onBall: onBall.id, big: big?.id ?? null, drive, t: 0, clearedT: null };
}

function steer(self: PlayerView, target: Vec2, face: Vec2 | null, opts: { urgency?: number; sprintBeyond?: number } = {}): DefenderIntent {
  const delta = sub(target, self.position);
  const d = Math.hypot(delta.x, delta.z);
  const dir = normalize2(delta);
  const urgency = d < 0.1 ? 0 : Math.min(opts.urgency ?? 1, d / 0.7);
  return {
    id: self.id,
    move: { x: dir.x * urgency, z: dir.z * urgency },
    sprint: d > (opts.sprintBeyond ?? 2.2),
    face: face ? sub(face, self.position) : null,
  };
}

/**
 * Coverage-aware team defense (spec §32–34). Priorities: assignment → ball →
 * screen → help → recover. Coverage is a policy, not an animation: each one
 * moves the screened defender and the screener's defender differently, which is
 * what the offense has to read.
 */
export function runDefense(view: DefenseView, defenders: PlayerView[], mem: DefenseMemory): DefenderIntent[] {
  perceive(mem, view);
  readScreen(mem, view, defenders);
  const seen = (id: string): PlayerView | undefined => {
    const p = playerById(view, id);
    const q = mem.perceived[id];
    return p && q ? { ...p, position: q } : p;
  };
  const offense = view.players.filter((p) => p.team === 'offense');
  const pnr = mem.pnr;
  const coverage = view.coverage;

  // Switch: swap matchups as soon as the screen is set or contact is made.
  if (pnr && coverage === 'switch' && pnr.big && !mem.assignments[pnr.onBall]) {
    const set = view.screens.some((s) => s.screener === pnr.screener && s.defender === pnr.onBall);
    if (set || pnr.t > 0.6) {
      mem.assignments[pnr.onBall] = pnr.screener;
      mem.assignments[pnr.big] = pnr.handler;
    }
  }

  const intents = new Map<string, DefenderIntent>();
  const handler = pnr ? seen(pnr.handler) : undefined;
  const screener = pnr ? seen(pnr.screener) : undefined;

  if (pnr && handler && screener && !mem.assignments[pnr.onBall]) {
    const onBall = playerById(view, pnr.onBall)!;
    const big = pnr.big ? playerById(view, pnr.big) : undefined;
    const cleared = pnr.clearedT !== null;
    const hToRim = normalize2(sub(RIM, handler.position));

    // Screened defender: get back in front of the ball, navigating the screen per coverage.
    const nav = cleared ? 'over' : ON_BALL_NAV[coverage];
    const sag = coverage === 'under' ? 1.4 : 0.9;
    const chase = add(handler.position, hToRim, sag);
    const blockers = offense.filter((p) => p.id !== pnr.handler);
    intents.set(onBall.id, steer(onBall, navigate(onBall, chase, blockers, nav), handler.position, { sprintBeyond: 1.2 }));

    if (big) {
      let spot: Vec2;
      let urgency = 1;
      const hRim = dist(handler.position, RIM);
      switch (coverage) {
        case 'drop': {
          // Deep, between ball and rim: contain the drive, keep the roller in front.
          const depth = clamp(hRim * 0.42, 2.2, 3.6);
          spot = add(RIM, normalize2(sub(handler.position, RIM)), depth);
          if (cleared && hRim < 3.4) spot = add(handler.position, hToRim, 0.9); // step up to contest
          break;
        }
        case 'hedge': {
          // Jump out hard into the handler's path above the screen, then recover to the roller.
          const showing = !cleared ? pnr.t < 2.2 : (pnr.clearedT ?? 0) < 0.9;
          spot = showing ? add(add(handler.position, pnr.drive, 1.1), normalize2(sub(handler.position, RIM)), 0.35) : add(screener.position, normalize2(sub(RIM, screener.position)), 0.8);
          break;
        }
        case 'go_over': {
          // "At the level": touch up beside the screen, then get back to the big.
          const level = add(screener.position, normalize2(sub(handler.position, screener.position)), 0.75);
          spot = !cleared || (pnr.clearedT ?? 0) < 0.5 ? add(level, pnr.drive, 0.35) : add(screener.position, normalize2(sub(RIM, screener.position)), 0.8);
          break;
        }
        case 'under':
          // A step back off the screener, leaving a lane for the guard to go under.
          spot = add(screener.position, normalize2(sub(RIM, screener.position)), 1.3);
          break;
        default:
          spot = manSpot(screener, view);
          urgency = 0.9;
      }
      intents.set(big.id, steer(big, spot, handler.position, { urgency, sprintBeyond: 1.5 }));
    }
  }

  // Tag the roller: the low help defender steps in if the roller is open near the rim.
  if (pnr && screener && pnr.clearedT !== null && coverage !== 'switch') {
    const rollerOpen = !defenders.some((d) => dist(d.position, screener.position) < 1.5);
    if (rollerOpen && dist(screener.position, RIM) < 4.5 && !mem.tagger) {
      const helpers = defenders.filter((d) => d.id !== pnr.onBall && d.id !== pnr.big && !intents.has(d.id));
      helpers.sort((a, b) => dist(a.position, { x: 0, z: 1.5 }) - dist(b.position, { x: 0, z: 1.5 }));
      mem.tagger = helpers[0]?.id ?? null;
    }
  } else mem.tagger = null;
  if (mem.tagger && screener) {
    const t = playerById(view, mem.tagger)!;
    intents.set(t.id, steer(t, add(screener.position, normalize2(sub(RIM, screener.position)), 0.9), screener.position));
  }

  // Everyone else: man-to-man with help (assignment, ball, help position).
  return defenders.map((d) => {
    const existing = intents.get(d.id);
    if (existing) return existing;
    const manId = assignmentOf(mem, d);
    const man = manId ? seen(manId) : undefined;
    if (!man) return steer(d, { x: 0, z: 2.2 }, view.ball.position);
    const holder = view.ball.holder ? seen(view.ball.holder) : undefined;
    if (view.deny && holder && holder.id !== man.id && dist(man.position, holder.position) < 7.8 && dist(man.position, RIM) > 4.2) {
      // Deny: get into the passing lane, a step toward the ball and the rim.
      const spot = add(add(man.position, normalize2(sub(holder.position, man.position)), 0.85), normalize2(sub(RIM, man.position)), 0.25);
      return steer(d, spot, holder.position, { sprintBeyond: 1.2 });
    }
    return steer(d, manSpot(man, view), man.position);
  });
}
