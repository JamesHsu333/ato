import { create } from 'zustand';
import type { CameraBehavior, CameraPreset } from '../rendering/cameras/cameraRig';
import type { AppearanceConfig } from '../rendering/characters/createCharacterRenderer';
import type { ShotOutcomeConfig } from '../simulation/ball/ballSystem';
import type { CollisionMode, ShotTiming, SimStats } from '../simulation/runtime/types';
import type { CoverageName } from '../domain/play/schema/playDefinition';
import type { PlayIssue } from '../domain/play/schema/validate';
import type { PracticeResult } from '../simulation/decision/practiceEvaluator';
import { ALL_ASSISTS, type Assists } from '../rendering/three/PlayOverlay';

export interface ShotFeedback {
  id: number;
  actor: string;
  timing: ShotTiming;
  probability: number;
  distance: number;
  three: boolean;
  contest: number;
  result: 'pending' | 'make' | 'miss';
}

export interface HudSnapshot {
  controlledId: string | null;
  holderId: string | null;
  shotMeter: { progress: number; ideal: number } | null;
  stats: SimStats;
  simTime: number;
  playNode: string | null;
  playComplete: boolean;
  visited: string[];
  cue: Cue | null;
  passKeys: { slot: number; id: string; open: boolean }[];
}

export type AppMode = 'sandbox' | 'play' | 'designer';
export type PlayMode = 'watch' | 'practice' | 'react';

export interface RepResult {
  outcome: 'make' | 'miss' | 'turnover' | 'done';
  coverage: CoverageName;
  branch: string | null;
  practice: PracticeResult | null;
}

/** Guidance banner for the user in practice modes. */
export interface Cue {
  tone: 'wait' | 'go' | 'read' | 'info';
  title: string;
  detail?: string;
}

/**
 * UI-only state. Simulation state never lives here (spec §66); the driver copies a
 * small read-only HUD snapshot in, and UI preferences are read by the driver.
 */
interface UiState {
  mode: AppMode;
  /** Source text of the loaded play (YAML or JSON). */
  playText: string | null;
  playIssues: PlayIssue[];
  coverage: CoverageName;
  playMode: PlayMode;
  /** Actor the user controls in practice / read & react. */
  playControl: string | null;
  assists: Assists;
  rep: number;
  repResult: RepResult | null;
  paused: boolean;
  eventLog: { id: number; t: number; name: string }[];
  cameraPreset: CameraPreset;
  cameraBehavior: CameraBehavior;
  collisionMode: CollisionMode;
  shotOutcome: ShotOutcomeConfig;
  mouseFacing: boolean;
  appearance: Record<string, AppearanceConfig | undefined>;
  hud: HudSnapshot;
  lastShot: ShotFeedback | null;
  toasts: { id: number; text: string }[];
  set: (p: Partial<Omit<UiState, 'set'>>) => void;
}

export const useUi = create<UiState>((set) => ({
  cameraPreset: 'broadcast',
  cameraBehavior: 'follow',
  collisionMode: 'hard',
  shotOutcome: { mode: 'simulated' },
  mouseFacing: true,
  appearance: {},
  mode: 'sandbox',
  playText: null,
  playIssues: [],
  coverage: 'drop',
  playMode: 'watch',
  playControl: null,
  assists: ALL_ASSISTS,
  rep: 0,
  repResult: null,
  paused: false,
  eventLog: [],
  hud: {
    controlledId: null,
    holderId: null,
    shotMeter: null,
    stats: { attempts: 0, makes: 0, points: 0 },
    simTime: 0,
    playNode: null,
    playComplete: false,
    visited: [],
    cue: null,
    passKeys: [],
  },
  lastShot: null,
  toasts: [],
  set: (p) => set(p),
}));

let toastId = 0;
export function toast(text: string): void {
  const id = ++toastId;
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, text }] }));
  setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2600);
}

let logId = 0;
/** Named play events shown in the event log; movement chatter is filtered out. */
export function logEvents(t: number, names: string[]): void {
  const shown = names.filter((n) => !/\.(arrived|move_done|has_ball)$|^play\.node\./.test(n));
  if (!shown.length) return;
  useUi.setState((s) => ({ eventLog: [...s.eventLog, ...shown.map((name) => ({ id: ++logId, t, name }))].slice(-40) }));
}
