import { COVERAGE_INFO } from '../domain/play/coaching';
import type { Cue, PlayMode } from './store';
import type { Simulation } from '../simulation/runtime/simulation';

const EVENT_TEXT: Record<string, string> = {
  screen_set: 'the screen to be set',
  clears_screen: 'the ball handler to come off the screen',
  caught: 'the catch',
  screen_position_ready: 'the screener to arrive',
};

function describeEvent(name: string): string {
  const [actor, ev] = name.split('.');
  return EVENT_TEXT[ev] ?? `${actor} ${ev?.replace(/_/g, ' ') ?? ''}`.trim();
}

/** What the user should do right now, derived read-only from simulation state. */
export function computeCue(sim: Simulation, mode: PlayMode, readHint: boolean): Cue | null {
  const me = sim.controlled;
  const ps = sim.playState;
  if (!me || !ps || !sim.play || ps.complete) return null;
  const task = ps.tasks[me];
  const node = sim.play.nodes[ps.node];
  const hasBall = sim.ball.holder === me;
  const hint =
    mode === 'practice' && readHint && sim.defenseMemory.pnr
      ? `Defense: ${COVERAGE_INFO[sim.coverage].label} — ${COVERAGE_INFO[sim.coverage].looksLike}`
      : undefined;

  const myOptions = node.options.filter((o) => o.action.actor === me);
  if (myOptions.length && ps.chosenOption === null) {
    if (mode === 'react') return { tone: 'read', title: 'READ THE DEFENSE', detail: 'Shoot (Space), attack the rim, or pass (1–4)' };
    const keys = myOptions.map((o) => {
      const pass = o.action.steps.find((s) => s.op === 'pass');
      const key = pass && pass.op === 'pass' ? `${1 + sim.passSlots().indexOf(pass.target)}` : 'Space';
      return `${o.label} — ${key}`;
    });
    return { tone: 'read', title: 'READ IT', detail: [keys.join(' · '), hint].filter(Boolean).join('\n') };
  }
  if (sim.practice?.branch && mode === 'react' && hasBall && !sim.practice.observed) {
    return { tone: 'read', title: 'READ THE DEFENSE', detail: 'Shoot (Space), attack the rim, or pass (1–4)' };
  }

  if (task && !task.done) {
    if (!task.started) {
      const waitFor = task.when?.kind === 'event' ? describeEvent(task.when.name) : 'your cue';
      return { tone: 'wait', title: 'WAIT', detail: [`Wait for ${waitFor}.`, hint].filter(Boolean).join('\n') };
    }
    const step = task.steps[task.index];
    switch (step?.op) {
      case 'move':
        return {
          tone: 'go',
          title: task.semantic === 'screen' ? 'GO SET THE SCREEN' : `GO — ${task.semantic.toUpperCase()}`,
          detail: [task.semantic === 'drive' ? 'Come off the screen shoulder-to-shoulder. Follow the blue route.' : 'Follow the blue route.', hint]
            .filter(Boolean)
            .join('\n'),
        };
      case 'screenPosition':
        return task.step.screen === undefined
          ? { tone: 'go', title: 'STOP — SET THE SCREEN', detail: 'Get to the spot and stand still.' }
          : { tone: 'wait', title: 'HOLD THE SCREEN', detail: 'Stay planted until the ball handler comes off.' };
      case 'pass': {
        const slot = 1 + sim.passSlots().indexOf(step.target);
        return { tone: 'go', title: `PASS TO ${step.target.toUpperCase()}`, detail: `Press ${slot}` };
      }
      case 'shoot':
        return { tone: 'go', title: 'SHOOT', detail: 'Hold Space, release at the top of the jump.' };
      case 'wait':
      case 'hold':
        return { tone: 'wait', title: 'WAIT', detail: hint };
    }
  }
  if (hasBall) return { tone: 'info', title: 'MAKE A PLAY', detail: 'Space to shoot · 1–4 to pass' };
  return hint ? { tone: 'info', title: 'SPACE THE FLOOR', detail: hint } : null;
}
