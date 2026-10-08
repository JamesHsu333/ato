import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { BUILTIN_CHARACTERS } from '../../domain/characters/builtins';
import { COURT } from '../../domain/court/dimensions';
import type { Session } from '../../app/session';
import { KeyboardInput } from '../../app/keyboard';
import { logEvents, toast, useUi } from '../../app/store';
import { Court } from '../court/Court';
import { PlayOverlay, type Assists } from './PlayOverlay';
import { computeCue } from '../../app/cues';
import { DesignerLayer } from './DesignerLayer';
import { useDesigner } from '../../app/designer/designerStore';
import { CameraRig } from '../cameras/cameraRig';
import { createCharacterRenderer, type AppearanceConfig } from '../characters/createCharacterRenderer';
import type { CharacterRenderer } from '../characters/types';
import type { SimEvent } from '../../simulation/runtime/types';
import type { Simulation } from '../../simulation/runtime/simulation';

interface ActorView {
  renderer: CharacterRenderer;
  appearance: AppearanceConfig | undefined;
  shadow: Mesh;
  ring: Mesh;
}

/**
 * Bridges the fixed-step simulation and Three.js each render frame:
 * input → FixedStepLoop → interpolated RenderState → renderers + camera + HUD.
 */
function SimulationDriver({ session }: { session: Session }) {
  const { scene, camera, pointer } = useThree();
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const keyboard = useMemo(() => new KeyboardInput((cmd) => session.loop.queue(cmd)), [session]);
  const rig = useMemo(() => new CameraRig(), []);
  const actors = useRef(new Map<string, ActorView>());
  const root = useMemo(() => new Group(), []);
  const ball = useMemo(() => makeBallMesh(), []);
  const ballShadow = useMemo(() => makeShadow(0.16), []);
  const raycaster = useMemo(() => new Raycaster(), []);
  const floor = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new Vector3(), []);
  const preset = useUi((s) => s.cameraPreset);
  const behavior = useUi((s) => s.cameraBehavior);

  useEffect(() => keyboard.attach(), [keyboard]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // Test hook for Playwright: where is a court point on screen, and where are the players?
    (window as unknown as Record<string, unknown>).__ato = {
      screenOf: (x: number, z: number) => {
        const v = new Vector3(x, 0, z).project(camera);
        const el = document.querySelector('canvas')!.getBoundingClientRect();
        return { x: el.left + ((v.x + 1) / 2) * el.width, y: el.top + ((1 - v.y) / 2) * el.height };
      },
      positions: () => Object.fromEntries(session.sim.chars.map((c) => [c.id, { x: c.state.position.x, z: c.state.position.z }])),
    };
  }, [camera, session]);

  useEffect(() => {
    scene.add(root);
    root.add(ball, ballShadow);
    return () => {
      scene.remove(root);
      for (const a of actors.current.values()) a.renderer.dispose();
      actors.current.clear();
    };
  }, [scene, root, ball, ballShadow]);

  useEffect(() => {
    const rs = session.sim.getRenderState(0);
    rig.snap(camera as PerspectiveCamera, preset, behavior, targetsOf(rs, session));
  }, [preset, behavior, rig, camera, session]);

  const builtVersion = useRef(session.version);
  const routes = useMemo(() => new PlayOverlay(), []);
  const repEnd = useRef<{ version: number; rep: number; completeAt: number | null; turnover: boolean }>({ version: -1, rep: -1, completeAt: null, turnover: false });
  useEffect(() => {
    root.add(routes.object);
    return () => routes.dispose();
  }, [root, routes]);

  useFrame((_, frameDt) => {
    const ui = useUi.getState();
    const sim = session.sim;
    if (builtVersion.current !== session.version) {
      // The simulation was replaced (play loaded / mode change): rebuild all actor views.
      for (const a of actors.current.values()) {
        root.remove(a.renderer.object, a.shadow, a.ring);
        a.renderer.dispose();
      }
      actors.current.clear();
      builtVersion.current = session.version;
      rig.snap(camera as PerspectiveCamera, ui.cameraPreset, ui.cameraBehavior, targetsOf(sim.getRenderState(0), session));
    }
    if (ui.mode === 'designer') syncDesignerTime(session);
    else session.paused = ui.paused;
    sim.collisionMode = ui.collisionMode;
    if (ui.mode === 'sandbox') sim.shotOutcome = ui.shotOutcome;

    // Camera-relative movement.
    const cam = camera as PerspectiveCamera;
    const fwd = cam.getWorldDirection(new Vector3());
    if (Math.abs(fwd.y) > 0.95) fwd.set(0, 1, 0).applyQuaternion(cam.quaternion); // looking straight down: screen-up
    fwd.y = 0;
    fwd.normalize();
    const axes = keyboard.axes();
    const move = { x: fwd.x * axes.y - fwd.z * axes.x, z: fwd.z * axes.y + fwd.x * axes.x };

    raycaster.setFromCamera(pointer, cam);
    const aimHit = ui.mouseFacing ? raycaster.ray.intersectPlane(floor, hit) : null;

    const alpha = session.loop.advance(frameDt, {
      move,
      sprint: keyboard.sprint,
      aim: aimHit ? { x: aimHit.x, z: aimHit.z } : null,
      shootHeld: keyboard.shootHeld,
    });
    const events = sim.drainEvents();
    handleEvents(events, sim);
    const named = events.flatMap((e) => (e.type === 'play.event' ? [e.name] : []));
    logEvents(sim.time, named);
    const showAi = ui.mode === 'play' && (ui.playMode === 'watch' || ui.assists.ghostRoute);
    routes.update(sim, ui.mode === 'play' ? ui.assists : NO_ASSISTS, frameDt, showAi);
    if (ui.mode === 'play') trackRepEnd(sim, named);

    // Render interpolated state.
    const rs = sim.getRenderState(alpha);
    const view = { cameraPosition: { x: cam.position.x, y: cam.position.y, z: cam.position.z }, ballPosition: rs.ball.position, dt: frameDt };
    for (const c of rs.characters) {
      const actor = ensureActor(c.id, c.definitionId, c.team, ui.appearance[c.id]);
      actor.renderer.update(c, view);
      actor.shadow.position.set(c.position.x, 0.006, c.position.z);
      actor.shadow.scale.setScalar(1 - Math.min(0.5, c.position.y));
      actor.ring.visible = c.controlled;
      actor.ring.position.set(c.position.x, 0.008, c.position.z);
    }
    const bp = rs.ball.position;
    ball.position.set(bp.x, bp.y, bp.z);
    const v = rs.ball.holder ? null : sim.physics.getBallVelocity();
    if (v) {
      ball.rotation.x += (v.z / COURT.ballRadius) * frameDt * 0.5;
      ball.rotation.z -= (v.x / COURT.ballRadius) * frameDt * 0.5;
    }
    ballShadow.position.set(bp.x, 0.007, bp.z);
    ballShadow.scale.setScalar(Math.max(0.3, 1 - bp.y * 0.15));

    // Camera.
    const targets = targetsOf(rs, session);
    const delta = rig.update(cam, ui.cameraPreset, ui.cameraBehavior, targets, frameDt);
    if (ui.cameraPreset === 'free' && controls && ui.cameraBehavior !== 'static') {
      controls.target.add(delta);
      cam.position.add(delta);
    }

    // HUD snapshot (read-only copy of sim state).
    const meter = sim.shotMeter();
    const hud = ui.hud;
    const ps = sim.playState;
    if (
      hud.controlledId !== sim.controlled ||
      hud.holderId !== sim.ball.holder ||
      hud.stats.attempts !== sim.stats.attempts ||
      hud.stats.makes !== sim.stats.makes ||
      hud.playNode !== (ps?.node ?? null) ||
      hud.playComplete !== (ps?.complete ?? false) ||
      (ui.mode === 'play' && ui.playMode !== 'watch') ||
      Math.floor(hud.simTime * 10) !== Math.floor(sim.time * 10) ||
      meter !== null ||
      hud.shotMeter !== null
    ) {
      ui.set({
        hud: {
          controlledId: sim.controlled,
          holderId: sim.ball.holder,
          shotMeter: meter,
          stats: { ...sim.stats },
          simTime: sim.time,
          playNode: ps?.node ?? null,
          playComplete: ps?.complete ?? false,
          visited: ps ? ps.history.map((h) => h.node) : [],
          cue: ui.mode === 'play' && ui.playMode !== 'watch' && !ui.repResult ? computeCue(sim, ui.playMode, ui.assists.readHint) : null,
          passKeys: sim.ball.holder === sim.controlled ? sim.passWindows() : [],
        },
      });
    }
  });

  /** Ends the rep shortly after the possession is over: pause the clock and show the result. */
  function trackRepEnd(sim: Simulation, named: string[]): void {
    const ui = useUi.getState();
    const r = repEnd.current;
    if (r.version !== session.version || r.rep !== ui.rep) {
      repEnd.current = { version: session.version, rep: ui.rep, completeAt: null, turnover: false };
      return;
    }
    if (named.includes('play.turnover')) r.turnover = true;
    const ps = sim.playState;
    const ballLive = (sim.ball.shot && !sim.ball.shot.resolved) || (sim.ball.holder === null && sim.ball.passTarget !== null);
    if (!ps?.complete || ballLive || ui.repResult) return;
    r.completeAt ??= sim.time;
    if (sim.time - r.completeAt < 1.0) return;
    const shot = ui.lastShot;
    const branchIdx = ps.history.findIndex((_, k) => k > 0 && session.play!.nodes[ps.history[k - 1].node].transitions.some((t) => t.when.kind === 'coverage'));
    ui.set({
      paused: true,
      repResult: {
        outcome: r.turnover ? 'turnover' : shot && shot.result !== 'pending' ? shot.result : 'done',
        coverage: sim.coverage,
        branch: branchIdx > 0 ? ps.history[branchIdx].node : null,
        practice: sim.practiceResult(),
      },
    });
  }

  function ensureActor(id: string, defId: string, team: 'offense' | 'defense', appearance: AppearanceConfig | undefined): ActorView {
    let a = actors.current.get(id);
    if (a && a.appearance === appearance) return a;
    if (a) {
      root.remove(a.renderer.object);
      a.renderer.dispose();
    }
    const def = BUILTIN_CHARACTERS[defId];
    const renderer = createCharacterRenderer(def, team, appearance ?? def.renderer, () => toast(`Could not load model for ${def.name}`));
    root.add(renderer.object);
    if (!a) {
      const shadow = makeShadow(def.dimensions.collisionRadius * 1.1);
      const ring = new Mesh(
        new RingGeometry(def.dimensions.collisionRadius + 0.08, def.dimensions.collisionRadius + 0.16, 40),
        new MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9 }),
      );
      ring.rotation.x = -Math.PI / 2;
      root.add(shadow, ring);
      a = { renderer, appearance, shadow, ring };
    } else {
      a = { ...a, renderer, appearance };
    }
    actors.current.set(id, a);
    return a;
  }

  return null;
}

function targetsOf(rs: ReturnType<Session['sim']['getRenderState']>, session: Session) {
  const me = rs.characters.find((c) => c.id === session.sim.controlled);
  return { controlled: me?.position ?? null, players: rs.characters.map((c) => c.position), ball: rs.ball.position };
}

/** Designer playback: mirror sim time into the timeline and stop at the end of the recording. */
function syncDesignerTime(session: Session): void {
  const d = useDesigner.getState();
  if (!d.playing || !d.recording) return;
  const t = session.sim.time;
  if (t >= d.recording.duration) {
    session.paused = true;
    useDesigner.setState({ playing: false, time: d.recording.duration });
  } else useDesigner.setState({ time: t });
}

const NO_ASSISTS: Assists = { ghostRoute: false, targetSpot: false, screenCue: false, timingCue: false, passingWindow: false, readHint: false };

let shotSeq = 0;
function handleEvents(events: SimEvent[], sim: Simulation): void {
  const { set } = useUi.getState();
  for (const e of events) {
    switch (e.type) {
      case 'shot.released':
        set({
          lastShot: {
            id: ++shotSeq,
            actor: e.actor,
            timing: e.timing,
            probability: e.probability,
            distance: e.distance,
            three: e.three,
            contest: e.contest,
            result: 'pending',
          },
        });
        break;
      case 'shot.made':
      case 'shot.missed': {
        const last = useUi.getState().lastShot;
        if (last && last.result === 'pending') set({ lastShot: { ...last, result: e.type === 'shot.made' ? 'make' : 'miss' } });
        break;
      }
      case 'control.changed':
        toast(`Now controlling ${sim.character(e.actor)?.definition.name ?? e.actor}`);
        break;
    }
  }
}

function makeBallMesh(): Group {
  const g = new Group();
  const r = COURT.ballRadius;
  const sphere = new Mesh(new SphereGeometry(r, 24, 16), new MeshStandardMaterial({ color: '#d4622a', roughness: 0.65 }));
  sphere.castShadow = true;
  g.add(sphere);
  const seamMat = new MeshBasicMaterial({ color: '#1d1310' });
  const seam = (rx: number, ry: number) => {
    const m = new Mesh(new TorusGeometry(r * 1.002, 0.004, 4, 32), seamMat);
    m.rotation.set(rx, ry, 0);
    g.add(m);
  };
  seam(0, 0);
  seam(0, Math.PI / 2);
  seam(Math.PI / 2, 0);
  return g;
}

function makeShadow(radius: number): Mesh {
  const m = new Mesh(new CircleGeometry(radius, 24), new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.3, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

export function SimulationScene({ session }: { session: Session }) {
  const preset = useUi((s) => s.cameraPreset);
  return (
    <Canvas shadows="percentage" camera={{ position: [0, 6, 15], fov: 50, near: 0.05, far: 200 }} dpr={[1, 2]}>
      <color attach="background" args={['#1b1e24']} />
      <hemisphereLight args={['#f4f6ff', '#3a2f25', 0.9]} />
      <directionalLight
        position={[6, 14, 8]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      <Court />
      {preset === 'free' && <OrbitControls makeDefault target={[0, 1, 4]} maxPolarAngle={Math.PI / 2 - 0.05} />}
      <SimulationDriver session={session} />
      <DesignerLayer session={session} />
    </Canvas>
  );
}
