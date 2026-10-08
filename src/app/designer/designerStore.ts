import { create } from 'zustand';
import type { PlayDefinition } from '../../domain/play/schema/playDefinition';
import type { PlayIssue } from '../../domain/play/schema/validate';
import type { SavedPlay } from '../../persistence/playStore';
import type { Recording } from '../../simulation/runtime/recorder';

export interface ActionRef {
  node: string;
  index: number;
}

/** Designer UI state. The PlayDefinition is the source of truth; the sim is derived from it. */
export interface DesignerState {
  play: PlayDefinition | null;
  past: PlayDefinition[];
  future: PlayDefinition[];
  issues: PlayIssue[];
  warnings: PlayIssue[];
  recording: Recording | null;
  time: number;
  playing: boolean;
  selectedActor: string | null;
  selectedNode: string;
  selectedAction: ActionRef | null;
  library: SavedPlay[];
  savedAt: number | null;
  /** True while the YAML editor holds text that doesn't parse. */
  yamlDirty: boolean;
}

export const useDesigner = create<DesignerState>(() => ({
  play: null,
  past: [],
  future: [],
  issues: [],
  warnings: [],
  recording: null,
  time: 0,
  playing: false,
  selectedActor: null,
  selectedNode: 'start',
  selectedAction: null,
  library: [],
  savedAt: null,
  yamlDirty: false,
}));
