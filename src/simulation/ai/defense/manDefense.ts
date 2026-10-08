import { RIM_CENTER } from '../../../domain/court/dimensions';
import { normalize2, type Vec2 } from '../../../domain/math/vec';
import type { PlayerView } from '../world';
import type { DefenseView } from './defenseView';

const RIM: Vec2 = { x: RIM_CENTER.x, z: RIM_CENTER.z };

/** Where a defender wants to stand against his man (priorities 1, 2 and 4 of spec §34). */
export function manSpot(man: PlayerView, view: DefenseView): Vec2 {
  const toRim = normalize2({ x: RIM.x - man.position.x, z: RIM.z - man.position.z });
  const hasBall = view.ball.holder === man.id;
  if (hasBall) {
    // On-ball: between the man and the rim, close enough to contest.
    return { x: man.position.x + toRim.x * 1.0 + man.velocity.x * 0.15, z: man.position.z + toRim.z * 1.0 + man.velocity.z * 0.15 };
  }
  // Off-ball: sag toward the rim and the ball.
  const toBall = normalize2({ x: view.ball.position.x - man.position.x, z: view.ball.position.z - man.position.z });
  const distToBall = Math.hypot(view.ball.position.x - man.position.x, view.ball.position.z - man.position.z);
  const sag = Math.min(2.2, 1.0 + distToBall * 0.12);
  return {
    x: man.position.x + toRim.x * sag + toBall.x * 0.4,
    z: man.position.z + toRim.z * sag + toBall.z * 0.4,
  };
}
