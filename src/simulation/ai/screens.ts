import { normalize2, type Vec2 } from '../../domain/math/vec';
import { playerById, type WorldView } from './world';

/** Runtime state of one screen (spec §17–18). Plain data: part of snapshots. */
export interface ScreenState {
  screener: string;
  defender: string;
  /** The offensive player the screen is set for (the defender's man). */
  user: string | null;
  spot: Vec2;
  /** Direction the user travels to get past the screen. */
  normal: Vec2;
  setTick: number;
  connected: boolean;
  cleared: boolean;
  illegal: boolean;
  released: boolean;
}

/**
 * Creates a screen. `defender` is who gets screened (null: whoever guards `user`);
 * `user` is who it is for (default: the defender's man, e.g. the ball handler).
 */
export function createScreen(w: WorldView, screener: string, defender: string | null, tick: number, user?: string): ScreenState | null {
  const s = playerById(w, screener);
  const forId = user ?? (defender ? playerById(w, defender)?.assignment : undefined) ?? w.ball.holder ?? null;
  const defId = defender ?? w.players.find((p) => p.team === 'defense' && p.assignment === forId)?.id ?? '';
  if (!s) return null;
  const u = forId ? playerById(w, forId) : undefined;
  const normal = u ? normalize2({ x: s.position.x - u.position.x, z: s.position.z - u.position.z }) : { x: 0, z: -1 };
  return { screener, defender: defId, user: forId, spot: { ...s.position }, normal, setTick: tick, connected: false, cleared: false, illegal: false, released: false };
}

/**
 * Updates an active screen against current positions. Returns named events:
 * screen.connected, screen.illegal, <user>.clears_screen, screen.missed.
 */
export function updateScreen(scr: ScreenState, w: WorldView): string[] {
  if (scr.released) return [];
  const events: string[] = [];
  const s = playerById(w, scr.screener);
  const d = playerById(w, scr.defender);
  if (!s) return events;

  const contact = !!d && Math.hypot(s.position.x - d.position.x, s.position.z - d.position.z) < s.radius + d.radius + 0.06;
  if (contact) {
    // Moving screen: the screener is still trying to move into the defender.
    if (s.moving && !scr.illegal) {
      // MVP: record and show feedback, play continues (spec §18).
      scr.illegal = true;
      events.push('screen.illegal', `${scr.screener}.illegal_screen`);
    }
    if (!scr.connected) {
      scr.connected = true;
      events.push('screen.connected', `${scr.screener}.screen_connected`);
    }
  }

  const u = scr.user ? playerById(w, scr.user) : undefined;
  if (u && !scr.cleared) {
    const rel = { x: u.position.x - s.position.x, z: u.position.z - s.position.z };
    const past = rel.x * scr.normal.x + rel.z * scr.normal.z;
    if (past > 0.35 && Math.hypot(rel.x, rel.z) < 3.5) {
      scr.cleared = true;
      events.push(`${u.id}.clears_screen`, 'screen.cleared');
      if (!scr.connected) events.push('screen.missed');
    }
  }
  return events;
}
