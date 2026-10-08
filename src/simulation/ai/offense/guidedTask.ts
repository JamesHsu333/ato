import { evaluateCondition } from '../../../domain/conditions/condition';
import { scopeContext, type ActorTask } from '../../runtime/playRuntime';
import { SIM_DT } from '../../runtime/types';
import { resolveTarget } from '../targets';
import type { PlayerView, WorldView } from '../world';
import { ensureMovePath, trackPath, type OffenseOps } from './offenseBrain';

export interface GuidedOps extends OffenseOps {
  /** Distance of the user from their ghost route this step (for route scoring). */
  recordRouteDeviation(d: number): void;
}

/**
 * Guided practice (spec §2.2, §59): the user moves the player; this follows along
 * through the same primitive steps the AI would execute, completing each one when
 * the user has done it, and emitting the same events so teammates and the graph
 * adapt to the user's timing. It never moves the character.
 */
export function runGuidedTask(task: ActorTask | undefined, self: PlayerView, w: WorldView, ops: GuidedOps): void {
  if (!task || task.done) return;
  if (!task.started) {
    const ctx = scopeContext(task.events, task.startTick, ops.tick, ops.coverage);
    if (task.when && !evaluateCondition(task.when, ctx)) return;
    task.started = true;
    task.prev = undefined;
    task.step = { startTick: ops.tick, path: null, pathIndex: 0 };
  }
  const speed = Math.hypot(self.velocity.x, self.velocity.z);
  for (let guard = 0; guard < 8 && !task.done; guard++) {
    const step = task.steps[task.index];
    let done = false;
    switch (step.op) {
      case 'move': {
        const path = ensureMovePath(step, task, self, w);
        if (!path) {
          done = true;
          break;
        }
        ops.recordRouteDeviation(trackPath(task, self));
        const end = path[path.length - 1];
        const distEnd = Math.hypot(end.x - self.position.x, end.z - self.position.z);
        const nearlyThrough = task.step.pathIndex >= path.length - 3 && distEnd < 1.4;
        if (distEnd < 0.8 || nearlyThrough) {
          ops.emit(`${self.id}.arrived`);
          if (step.arriveEvent) ops.emit(`${self.id}.${step.arriveEvent}`);
          done = true;
        }
        break;
      }
      case 'face':
      case 'setPose':
        done = true; // the user's own body: pose is handled by screenPosition below
        break;
      case 'wait':
      case 'hold': {
        const ctx = scopeContext(task.events, task.startTick, ops.tick, ops.coverage);
        const timeUp = step.op === 'wait' && step.duration !== undefined && (ops.tick - task.step.startTick) * SIM_DT >= step.duration;
        done = timeUp || (step.until !== undefined && evaluateCondition(step.until, ctx));
        break;
      }
      case 'pass':
      case 'handoff':
        done = task.events.includes(`${self.id}.passed`);
        break;
      case 'shoot':
        done = task.events.includes(`${self.id}.shot`);
        break;
      case 'screenPosition': {
        if (task.step.screen === undefined) {
          const prevMove = task.steps.slice(0, task.index).reverse().find((st) => st.op === 'move');
          const spot = prevMove && prevMove.op === 'move' ? resolveTarget(w, self, prevMove.to) : self.position;
          const close = spot ? Math.hypot(spot.x - self.position.x, spot.z - self.position.z) < 0.9 : false;
          if (close && speed < 0.9) {
            const idx = ops.createScreen(self.id, step.defender, step.user);
            if (idx === null) {
              done = true;
              break;
            }
            task.step.screen = idx;
            ops.setPose(self.id, 'screen');
            ops.emit('screen.set');
            ops.emit(`${self.id}.screen_set`);
          }
          break;
        }
        const ctx = scopeContext(task.events, task.startTick, ops.tick, ops.coverage);
        const holdMet = step.holdUntil ? evaluateCondition(step.holdUntil, ctx) : ops.screenCleared(task.step.screen);
        if (holdMet || speed > 1.2) {
          if (!holdMet) ops.emit(`${self.id}.left_screen_early`);
          ops.releaseScreen(task.step.screen);
          ops.setPose(self.id, 'none');
          ops.emit(`${self.id}.screen_released`);
          done = true;
        }
        break;
      }
    }
    if (!done) return;
    task.index++;
    task.step = { startTick: ops.tick, path: null, pathIndex: 0 };
    if (task.index >= task.steps.length) {
      task.done = true;
      ops.emit(`${self.id}.${task.semantic}_done`);
    }
  }
}
