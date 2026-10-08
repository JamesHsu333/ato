import { useMemo } from 'react';
import { DoubleSide } from 'three';
import { COURT } from '../../domain/court/dimensions';

const LINE = 0.05;
const LINE_Y = 0.004;
const LINE_COLOR = '#f7f3ea';

function Line({ x1, z1, x2, z2 }: { x1: number; z1: number; x2: number; z2: number }) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const angle = Math.atan2(x2 - x1, z2 - z1);
  return (
    <mesh position={[(x1 + x2) / 2, LINE_Y, (z1 + z2) / 2]} rotation={[-Math.PI / 2, 0, angle]}>
      <planeGeometry args={[LINE, len + LINE]} />
      <meshBasicMaterial color={LINE_COLOR} />
    </mesh>
  );
}

/** Arc on the floor; angles measured as atan2(z, x) around the center. */
function Arc({ cx, cz, r, from, to, dashed = false }: { cx: number; cz: number; r: number; from: number; to: number; dashed?: boolean }) {
  if (dashed) {
    const n = 14;
    const step = (to - from) / n;
    return (
      <>
        {Array.from({ length: n }, (_, i) =>
          i % 2 === 0 ? <Arc key={i} cx={cx} cz={cz} r={r} from={from + i * step} to={from + (i + 1) * step} /> : null,
        )}
      </>
    );
  }
  // Ring geometry lies in XY; after rotating -90° about X a ring angle θ lands at floor angle -θ.
  return (
    <mesh position={[cx, LINE_Y, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r - LINE / 2, r + LINE / 2, 64, 1, -to, to - from]} />
      <meshBasicMaterial color={LINE_COLOR} side={DoubleSide} />
    </mesh>
  );
}

function Floor() {
  const w = COURT.halfWidth * 2;
  const len = COURT.halfCourtZ - COURT.baselineZ;
  const laneLen = COURT.freeThrowZ - COURT.baselineZ;
  return (
    <>
      <mesh position={[0, -0.002, (COURT.baselineZ + COURT.halfCourtZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w + 6, len + 6]} />
        <meshStandardMaterial color="#3a3f4a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, (COURT.baselineZ + COURT.halfCourtZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, len]} />
        <meshStandardMaterial color="#d1a46c" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.002, COURT.baselineZ + laneLen / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[COURT.laneHalfWidth * 2, laneLen]} />
        <meshStandardMaterial color="#9c3b2e" roughness={0.6} />
      </mesh>
    </>
  );
}

function Lines() {
  const { halfWidth: hw, baselineZ: bz, halfCourtZ: hz, laneHalfWidth: lw, freeThrowZ: ft } = COURT;
  const cornerZ = COURT.threePointCornerZ;
  const cornerAngle = Math.atan2(cornerZ, COURT.threePointCornerX);
  return (
    <>
      <Line x1={-hw} z1={bz} x2={hw} z2={bz} />
      <Line x1={-hw} z1={bz} x2={-hw} z2={hz} />
      <Line x1={hw} z1={bz} x2={hw} z2={hz} />
      <Line x1={-hw} z1={hz} x2={hw} z2={hz} />
      {/* Lane */}
      <Line x1={-lw} z1={bz} x2={-lw} z2={ft} />
      <Line x1={lw} z1={bz} x2={lw} z2={ft} />
      <Line x1={-lw} z1={ft} x2={lw} z2={ft} />
      <Arc cx={0} cz={ft} r={COURT.freeThrowCircleRadius} from={0} to={Math.PI} />
      <Arc cx={0} cz={ft} r={COURT.freeThrowCircleRadius} from={Math.PI} to={Math.PI * 2} dashed />
      {/* Three-point line */}
      <Line x1={-COURT.threePointCornerX} z1={bz} x2={-COURT.threePointCornerX} z2={cornerZ} />
      <Line x1={COURT.threePointCornerX} z1={bz} x2={COURT.threePointCornerX} z2={cornerZ} />
      <Arc cx={0} cz={0} r={COURT.threePointRadius} from={cornerAngle} to={Math.PI - cornerAngle} />
      {/* Restricted area */}
      <Arc cx={0} cz={0} r={COURT.restrictedAreaRadius} from={0} to={Math.PI} />
      {/* Center circle (half) */}
      <Arc cx={0} cz={hz} r={1.83} from={Math.PI} to={Math.PI * 2} />
    </>
  );
}

function Basket() {
  const bbY = COURT.backboardBottomY + COURT.backboardHeight / 2;
  const bbZ = COURT.backboardFrontZ - COURT.backboardThickness / 2;
  const poleZ = COURT.baselineZ - 1.1;
  return (
    <group>
      {/* Backboard */}
      <mesh position={[0, bbY, bbZ]}>
        <boxGeometry args={[COURT.backboardWidth, COURT.backboardHeight, COURT.backboardThickness]} />
        <meshStandardMaterial color="#e8f1ff" transparent opacity={0.35} roughness={0.1} />
      </mesh>
      <BackboardFrame y={bbY} z={COURT.backboardFrontZ + 0.002} w={COURT.backboardWidth} h={COURT.backboardHeight} t={0.05} />
      <BackboardFrame y={COURT.rimHeight + 0.2} z={COURT.backboardFrontZ + 0.002} w={0.59} h={0.45} t={0.04} />
      {/* Rim + bracket */}
      <mesh position={[0, COURT.rimHeight, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[COURT.rimRadius + COURT.rimTubeRadius, COURT.rimTubeRadius * 1.6, 10, 40]} />
        <meshStandardMaterial color="#e2541b" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, COURT.rimHeight - 0.02, COURT.backboardFrontZ + 0.07]}>
        <boxGeometry args={[0.16, 0.04, 0.14]} />
        <meshStandardMaterial color="#e2541b" />
      </mesh>
      {/* Net */}
      <mesh position={[0, COURT.rimHeight - 0.22, 0]}>
        <cylinderGeometry args={[COURT.rimRadius, COURT.rimRadius * 0.62, 0.44, 14, 4, true]} />
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.8} />
      </mesh>
      {/* Stanchion */}
      <mesh position={[0, 1.7, poleZ]} castShadow>
        <boxGeometry args={[0.2, 3.4, 0.2]} />
        <meshStandardMaterial color="#2a2f38" />
      </mesh>
      <mesh position={[0, bbY, (poleZ + bbZ) / 2]}>
        <boxGeometry args={[0.12, 0.12, bbZ - poleZ]} />
        <meshStandardMaterial color="#2a2f38" />
      </mesh>
      <mesh position={[0, 0.3, poleZ - 0.4]} castShadow>
        <boxGeometry args={[1.4, 0.6, 1.6]} />
        <meshStandardMaterial color="#1d3557" />
      </mesh>
    </group>
  );
}

function BackboardFrame({ y, z, w, h, t }: { y: number; z: number; w: number; h: number; t: number }) {
  const bars = useMemo(
    () => [
      { p: [0, y + h / 2 - t / 2, z] as const, s: [w, t] as const },
      { p: [0, y - h / 2 + t / 2, z] as const, s: [w, t] as const },
      { p: [-w / 2 + t / 2, y, z] as const, s: [t, h] as const },
      { p: [w / 2 - t / 2, y, z] as const, s: [t, h] as const },
    ],
    [y, z, w, h, t],
  );
  return (
    <>
      {bars.map((b, i) => (
        <mesh key={i} position={[...b.p]}>
          <planeGeometry args={[...b.s]} />
          <meshBasicMaterial color="#ffffff" side={DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

/** Static half-court visuals. Purely presentational: collision lives in the PhysicsWorld. */
export function Court() {
  return (
    <group>
      <Floor />
      <Lines />
      <Basket />
    </group>
  );
}
