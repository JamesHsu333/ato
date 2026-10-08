import type { Vec2 } from '../../domain/math/vec';

/** Minimal read-only view of a player used by AI helpers. */
export interface PlayerView {
  id: string;
  team: 'offense' | 'defense';
  position: Vec2;
  velocity: Vec2;
  radius: number;
  facing: number;
  /** Whether the player is trying to move (desired motion, not velocity from being pushed). */
  moving: boolean;
  assignment?: string;
}

export interface WorldView {
  players: PlayerView[];
  ball: { position: Vec2; height: number; holder: string | null };
}

export const playerById = (w: WorldView, id: string): PlayerView | undefined => w.players.find((p) => p.id === id);
