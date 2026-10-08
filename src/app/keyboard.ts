import type { SimCommand } from '../simulation/runtime/types';

/**
 * Keyboard → held-key state + one-shot commands (spec §2.2 controls).
 * Movement is resolved camera-relative by the render driver.
 */
export class KeyboardInput {
  private held = new Set<string>();

  constructor(private readonly onCommand: (cmd: SimCommand) => void) {}

  attach(): () => void {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        const digit = /^Digit([1-4])$/.exec(e.code);
        if (digit) this.onCommand({ kind: 'pass', slot: Number(digit[1]), lob: e.shiftKey });
        if (e.code === 'Tab') this.onCommand({ kind: 'switchControl' });
        if (e.code === 'KeyR') this.onCommand({ kind: 'resetBall' });
      }
      this.held.add(e.code);
    };
    const up = (e: KeyboardEvent) => this.held.delete(e.code);
    const blur = () => this.held.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }

  /** Screen-space intent: x = right, y = forward (away from camera). */
  axes(): { x: number; y: number } {
    const k = (c: string) => (this.held.has(c) ? 1 : 0);
    const x = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
    const y = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
    const l = Math.hypot(x, y);
    return l > 1 ? { x: x / l, y: y / l } : { x, y };
  }

  get sprint(): boolean {
    return this.held.has('ShiftLeft') || this.held.has('ShiftRight');
  }

  get shootHeld(): boolean {
    return this.held.has('Space');
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
