import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<void> | null = null;

/** Initializes the Rapier WASM module once. Must resolve before creating a Simulation. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export { RAPIER };
