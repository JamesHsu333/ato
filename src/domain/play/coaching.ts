import type { CoverageName } from './schema/playDefinition';

/** Coverage names and the read each one gives the ball handler (basketball knowledge, not rendering). */
export const COVERAGE_INFO: Record<CoverageName, { label: string; looksLike: string; read: string }> = {
  drop: {
    label: 'Drop',
    looksLike: "The screener's defender sits back in the paint at free-throw depth.",
    read: 'Come off tight and pull up in the mid-range, float it, or hit the roller with a pocket pass.',
  },
  hedge: {
    label: 'Hedge',
    looksLike: "The screener's defender jumps out hard above the screen into your path.",
    read: 'Retreat dribble to beat the show, then hit the short roll before the big recovers.',
  },
  switch: {
    label: 'Switch',
    looksLike: 'The two defenders swap: the big picks you up, the guard takes the screener.',
    read: 'Attack the big off the dribble (or feed the screener sealing the smaller guard).',
  },
  under: {
    label: 'Under',
    looksLike: 'Your defender goes underneath the screen, between the screener and the rim.',
    read: 'Shoot it right behind the screen — the pull-up three is open.',
  },
  go_over: {
    label: 'Over',
    looksLike: 'Your defender chases over the top and trails; the big shows at the level, then recovers.',
    read: 'Turn the corner and get downhill before the trailing defender recovers.',
  },
  man: {
    label: 'Man (no coverage)',
    looksLike: 'Nobody adjusts to the screen.',
    read: 'Use the screen and attack.',
  },
};
