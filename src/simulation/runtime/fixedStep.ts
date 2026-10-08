import { SIM_DT, type SimCommand, type SimInput } from './types';

/**
 * Fixed-timestep driver (spec §44): render frames feed variable deltas in, the
 * simulation only ever sees SIM_DT. One-shot commands are delivered to exactly
 * one step, even if a frame runs zero steps.
 */
export class FixedStepLoop {
  private accumulator = 0;
  private pending: SimCommand[] = [];
  /** Clamp to avoid a spiral of death after a stalled tab. */
  maxFrameDt = 0.25;

  constructor(private readonly step: (input: SimInput) => void) {}

  queue(cmd: SimCommand): void {
    this.pending.push(cmd);
  }

  /** Returns the interpolation alpha for rendering. */
  advance(frameDt: number, input: Omit<SimInput, 'commands'>): number {
    this.accumulator += Math.min(Math.max(frameDt, 0), this.maxFrameDt);
    while (this.accumulator >= SIM_DT) {
      this.step({ ...input, commands: this.pending.splice(0) });
      this.accumulator -= SIM_DT;
    }
    return this.accumulator / SIM_DT;
  }

  reset(): void {
    this.accumulator = 0;
    this.pending = [];
  }
}
