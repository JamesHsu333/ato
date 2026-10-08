import type { CharacterDefinition } from '../../domain/characters/definition';
import { COURT, RIM_CENTER } from '../../domain/court/dimensions';
import { Rng } from '../../domain/math/rng';
import { lerp, lerp3, lerpAngle, type Vec2, type Vec3 } from '../../domain/math/vec';
import type { PlayGraph } from '../../domain/play/graph/playGraph';
import type { CoverageName } from '../../domain/play/schema/playDefinition';
import { createCharacterState, KinematicCharacterController } from '../characters/characterController';
import { resolveCharacterCollisions } from '../characters/collision';
import { PhysicsWorld } from '../physics/physicsWorld';
import {
  createBallState,
  giveBall,
  laneBlocker,
  type PassPlan,
  releasePass,
  releaseShot,
  updateBallPostPhysics,
  updateBallPrePhysics,
  type ShotOutcomeConfig,
} from '../ball/ballSystem';
import { idealReleaseTime, jumpHeightAt, jumpVelocity, SHOT_GATHER, shotDuration } from '../ball/shooting';
import { runDefense } from '../ai/defense/defenseAI';
import { createDefenseMemory, type DefenseMemory, type DefenseView } from '../ai/defense/defenseView';
import { ensureMovePath, runOffenseTask, type MotorCommand, type OffenseOps } from '../ai/offense/offenseBrain';
import { createScreen, updateScreen, type ScreenState } from '../ai/screens';
import { runGuidedTask } from '../ai/offense/guidedTask';
import { resolveTarget } from '../ai/targets';
import {
  createPracticeState,
  expectedDecisions,
  finishPractice,
  recordRoute,
  updatePractice,
  type PracticeResult,
  type PracticeState,
} from '../decision/practiceEvaluator';
import type { PlayerView, WorldView } from '../ai/world';
import { createPlayState, observeEvents, updatePlay, type ActorTask, type PlayContext, type PlayState } from './playRuntime';
import {
  GRAVITY,
  SIM_DT,
  type BallState,
  type CharacterState,
  type CollisionMode,
  type RenderState,
  type SimEvent,
  type SimInput,
  type SimStats,
  type Team,
} from './types';

export interface ActorSpawn {
  id: string;
  definition: CharacterDefinition;
  team: Team;
  position: Vec2;
  facing?: number;
  assignment?: string;
}

export interface SimulationOptions {
  seed: number;
  collisionMode: CollisionMode;
  shotOutcome: ShotOutcomeConfig;
  actors: ActorSpawn[];
  /** Actor that starts with the ball; omit to start with a loose ball. */
  ballHolder?: string | null;
  /** User-controlled actor; null = everyone is AI-driven. */
  controlled?: string | null;
  /** Compiled play to execute; omit for free sandbox play. */
  play?: PlayGraph;
  coverage?: CoverageName;
}

export interface SimulationSnapshot {
  tick: number;
  physics: Uint8Array;
  characters: CharacterState[];
  ball: BallState;
  rng: number;
  stats: SimStats;
  controlled: string | null;
  shootHeld: boolean;
  play: PlayState | null;
  screens: ScreenState[];
  pendingNamed: string[];
  coverage: CoverageName;
  defense: DefenseMemory;
  denied: string[];
  optionTrack: Simulation['optionTrack'];
  practice: PracticeState | null;
  pendingChoice: string | null;
}

/**
 * The deterministic simulation runtime (spec §44). Advances only in fixed SIM_DT
 * steps; knows nothing about React or Three.js.
 *
 * Step order: input → play graph → AI decisions → character motion → collision →
 * screens → ball/physics → events.
 */
export class Simulation {
  readonly physics = new PhysicsWorld();
  readonly chars: KinematicCharacterController[] = [];
  readonly rng: Rng;
  readonly play: PlayGraph | null;
  ball: BallState;
  stats: SimStats = { attempts: 0, makes: 0, points: 0 };
  tick = 0;
  controlled: string | null;
  collisionMode: CollisionMode;
  shotOutcome: ShotOutcomeConfig;
  coverage: CoverageName;
  playState: PlayState | null = null;
  screens: ScreenState[] = [];
  defenseMemory: DefenseMemory = createDefenseMemory();
  /** Guided practice scoring for the user-controlled actor in a play. */
  practice: PracticeState | null = null;
  /** Offensive players currently denied (defender in the passing lane): read cue. */
  denied: string[] = [];
  /** Option choice by movement: distances to each option's target at node entry. */
  optionTrack: { node: string; start: Record<string, number> } | null = null;
  /** User's pick among the current node's player options (practice modes). */
  pendingChoice: string | null = null;

  private shootHeld = false;
  private shootQueued = false;
  private events: SimEvent[] = [];
  /** Named events from the previous step, observed by the play graph this step. */
  private pendingNamed: string[] = [];
  private namedThisStep: string[] = [];
  private prev = new Map<string, { pos: Vec3; facing: number }>();
  private prevBall: Vec3;

  constructor(opts: SimulationOptions) {
    this.rng = new Rng(opts.seed);
    this.collisionMode = opts.collisionMode;
    this.shotOutcome = opts.shotOutcome;
    this.coverage = opts.coverage ?? 'drop';
    this.play = opts.play ?? null;
    for (const a of opts.actors) {
      const facing = a.facing ?? Math.atan2(RIM_CENTER.x - a.position.x, RIM_CENTER.z - a.position.z);
      const state = createCharacterState(a.definition, a.id, a.team, a.position, facing);
      state.assignment = a.assignment;
      this.chars.push(new KinematicCharacterController(state, a.definition));
      this.physics.addCharacter(a.id, state.radius, state.height, state.position);
    }
    this.controlled = opts.controlled === undefined ? (this.chars[0]?.id ?? null) : opts.controlled;
    this.ball = createBallState(this.physics.getBallPosition());
    const holder = this.chars.find((c) => c.id === opts.ballHolder);
    if (holder) giveBall(this.ballContext(), holder, 'pickup');
    if (this.play) this.playState = createPlayState(this.play, this.playContext());
    if (this.play && this.controlled) this.practice = createPracticeState(this.controlled);
    this.events = [];
    this.pendingNamed = this.namedThisStep;
    this.namedThisStep = [];
    this.capturePrev();
    this.prevBall = this.physics.getBallPosition();
  }

  get time(): number {
    return this.tick * SIM_DT;
  }

  character(id: string): KinematicCharacterController | undefined {
    return this.chars.find((c) => c.id === id);
  }

  private ballContext() {
    return {
      ball: this.ball,
      physics: this.physics,
      chars: this.chars,
      rng: this.rng,
      tick: this.tick,
      stats: this.stats,
      shotOutcome: this.shotOutcome,
      emit: (e: SimEvent) => this.events.push(e),
    };
  }

  private emitNamed(name: string): void {
    this.namedThisStep.push(name);
    this.events.push({ type: 'play.event', name });
  }

  private playContext(): PlayContext {
    return {
      tick: this.tick,
      coverage: this.coverage,
      controlled: this.controlled,
      pendingChoice: this.pendingChoice,
      emit: (n) => this.emitNamed(n),
      onNode: () => {
        this.pendingChoice = null;
      },
    };
  }

  /** Read-only world view for AI. */
  worldView(): WorldView {
    const bp = this.physics.getBallPosition();
    return {
      players: this.chars.map((c): PlayerView => ({
        id: c.id,
        team: c.state.team,
        position: { x: c.state.position.x, z: c.state.position.z },
        velocity: { x: c.state.velocity.x, z: c.state.velocity.z },
        radius: c.state.radius,
        facing: c.state.facing,
        moving: Math.hypot(c.state.desiredMove.x, c.state.desiredMove.z) > 0.1,
        assignment: c.state.assignment,
      })),
      ball: { position: { x: bp.x, z: bp.z }, height: bp.y, holder: this.ball.holder },
    };
  }

  /** Advances the simulation by exactly one fixed step. */
  step(input: SimInput): void {
    this.capturePrev();
    const ctx = this.ballContext();
    const stepStart = this.events.length;

    // 1. Input → controlled character.
    for (const cmd of input.commands) this.applyCommand(cmd, ctx);
    const me = this.controlled ? this.character(this.controlled) : undefined;
    if (me) this.applyControl(me, input, ctx);

    // 2. Play graph: observe last step's events, follow transitions.
    if (this.play && this.playState) {
      observeEvents(this.playState, this.pendingNamed);
      updatePlay(this.playState, this.play, this.playContext());
    }

    // 3. AI decisions.
    this.runAi(ctx, me);

    this.jumpForHighPass();

    // 4. Character desired motion → kinematic integration + collision.
    for (const c of this.chars) {
      c.integrate(SIM_DT, this.ball.holder === c.id);
      this.advanceAction(c, ctx);
    }
    resolveCharacterCollisions(this.chars, this.collisionMode);
    for (const c of this.chars) this.physics.moveCharacter(c.id, c.state.position, c.state.height);

    // Screens react to the resolved positions.
    if (this.screens.some((s) => !s.released)) {
      const w = this.worldView();
      for (const s of this.screens) for (const n of updateScreen(s, w)) this.emitNamed(n);
    }

    // 5. Ball (possession constraint) → 6. physics → 7. events.
    updateBallPrePhysics(ctx);
    this.physics.step();
    const firstNew = this.events.length;
    updateBallPostPhysics(ctx);
    if (!this.play) this.followBallOnCatch(this.events.slice(firstNew));
    this.nameBallEvents(this.events.slice(stepStart));
    this.trackDeadBall();
    this.trackDenials();
    this.trackUserChoice();
    this.updatePracticeScoring();
    this.pendingNamed = this.namedThisStep;
    this.namedThisStep = [];
    this.tick++;
  }

  private runAi(ctx: ReturnType<Simulation['ballContext']>, me: KinematicCharacterController | undefined): void {
    const w = this.worldView();
    const ops = this.offenseOps(ctx);
    if (me && this.playState) {
      const self = w.players.find((p) => p.id === me.id)!;
      runGuidedTask(this.playState.tasks[me.id], self, w, {
        ...ops,
        recordRouteDeviation: (d) => this.practice && recordRoute(this.practice, d),
      });
    }
    for (const c of this.chars) {
      if (c === me || c.state.team !== 'offense') continue;
      const cmd: MotorCommand = runOffenseTask(this.playState?.tasks[c.id], w.players.find((p) => p.id === c.id)!, w, ops);
      this.applyMotor(c, cmd);
    }

    this.releaseAbandonedScreens();

    const defenders = w.players.filter((p) => p.team === 'defense' && p.id !== me?.id);
    if (defenders.length) {
      const view: DefenseView = {
        ...w,
        screens: this.screens
          .filter((s) => !s.released)
          .map((s) => ({ screener: s.screener, defender: s.defender, user: s.user, spot: s.spot, cleared: s.cleared })),
        coverage: this.coverage,
        deny: this.play?.simulation.deny ?? false,
      };
      for (const intent of runDefense(view, defenders, this.defenseMemory)) {
        this.applyMotor(this.character(intent.id)!, { move: intent.move, sprint: intent.sprint, face: intent.face });
      }
    }
  }

  /**
   * Jump timing for passes above standing reach (alley-oops): leave the floor so the
   * hands meet the ball near the top of the jump (spec §50 "jump timing, airborne catch").
   */
  private jumpForHighPass(): void {
    const id = this.ball.passTarget;
    if (!id || this.ball.holder !== null) return;
    const c = this.character(id);
    if (!c || c.state.action.kind !== 'none' || c.state.position.y > 0) return;
    const p = this.physics.getBallPosition();
    const v = this.physics.getBallVelocity();
    const s = c.state;
    // When will ball and receiver (both moving) meet within arm's reach?
    let tArr = -1;
    for (let k = 1; k <= 60; k++) {
      const t = k / 60;
      const bx = p.x + v.x * t, bz = p.z + v.z * t;
      const rx = s.position.x + s.velocity.x * t, rz = s.position.z + s.velocity.z * t;
      if (Math.hypot(bx - rx, bz - rz) < s.radius + 0.6) {
        tArr = t;
        break;
      }
    }
    if (tArr < 0) return;
    const yArr = p.y + v.y * tArr - 0.5 * GRAVITY * tArr * tArr;
    const reach = s.height * 1.3;
    const v0 = jumpVelocity(c.definition.attributes);
    // Leave the floor so the hands are near the top of the jump when the ball arrives.
    if (yArr > reach - 0.05 && tArr <= v0 / GRAVITY) c.setAction({ kind: 'catch', t: 0, air: v0 });
  }

  /** A screen ends when its screener's task moves on (e.g. the graph branched mid-screen). */
  private releaseAbandonedScreens(): void {
    this.screens.forEach((scr, i) => {
      if (scr.released) return;
      const task = this.playState?.tasks[scr.screener];
      const holding = task && !task.done && task.steps[task.index]?.op === 'screenPosition' && task.step.screen === i;
      if (holding) return;
      scr.released = true;
      const c = this.character(scr.screener);
      if (c) c.state.pose = 'none';
      this.emitNamed(`${scr.screener}.screen_released`);
    });
  }

  private applyMotor(c: KinematicCharacterController, cmd: MotorCommand): void {
    c.setDesiredMovement({ direction: cmd.move, sprint: cmd.sprint });
    const shooting = c.state.action.kind === 'shoot';
    c.setFacing(shooting ? { x: RIM_CENTER.x - c.state.position.x, z: RIM_CENTER.z - c.state.position.z } : cmd.face);
  }

  private offenseOps(ctx: ReturnType<Simulation['ballContext']>): OffenseOps {
    return {
      tick: this.tick,
      coverage: this.coverage,
      hasBall: (id) => this.ball.holder === id,
      passInFlight: () => this.ball.holder === null && this.ball.passTarget !== null,
      pass: (from, to, lob, oopSpot) => {
        const a = this.character(from);
        const b = this.character(to);
        if (!a || !b || this.ball.gatherTimer > 0) return false;
        this.passBall(ctx, a, b, lob, oopSpot ?? null);
        return this.ball.holder !== from;
      },
      incomingPass: (id) => this.incomingPass(id),
      handoff: (from, to) => {
        const b = this.character(to);
        if (!b || this.ball.holder !== from) return false;
        // Possession changes hands directly: no flight (spec §50 DHO).
        this.emitNamed(`${from}.handed_off`);
        this.emitNamed(`${from}.passed`);
        this.emitNamed(`${from}.passed_${to}`);
        giveBall(ctx, b, 'catch');
        this.ball.gatherTimer = 0.08;
        return true;
      },
      startShot: (id, shotType) => {
        const c = this.character(id);
        const a = c?.state.action;
        if (!c || !a || this.ball.holder !== id || a.kind === 'shoot' || this.ball.gatherTimer > 0) return null;
        if (a.kind === 'catch' && a.air) {
          // Finish in the same jump as the airborne catch (alley-oop).
          c.setAction({ kind: 'shoot', t: SHOT_GATHER + a.t, jumpV0: a.air, released: false, shotType });
          return idealReleaseTime(a.air); // finish at the top of the same jump
        }
        const jumpV0 = jumpVelocity(c.definition.attributes);
        c.setAction({ kind: 'shoot', t: 0, jumpV0, released: false, shotType });
        return idealReleaseTime(jumpV0);
      },
      shotTime: (id) => {
        const a = this.character(id)?.state.action;
        return a && a.kind === 'shoot' && !a.released ? a.t : null;
      },
      releaseShot: (id) => {
        const c = this.character(id);
        if (c) releaseShot(ctx, c);
      },
      createScreen: (screener, defender, user) => {
        const s = createScreen(this.worldView(), screener, defender, this.tick, user);
        if (!s) return null;
        this.screens.push(s);
        return this.screens.length - 1;
      },
      screenCleared: (i) => this.screens[i]?.cleared ?? true,
      releaseScreen: (i) => {
        if (this.screens[i]) this.screens[i].released = true;
      },
      setPose: (id, pose) => {
        const c = this.character(id);
        if (c) c.state.pose = pose;
      },
      random: () => this.rng.next(),
      emit: (n) => this.emitNamed(n),
    };
  }

  /** Translates ball/shot events into named events for the play graph. */
  private nameBallEvents(stepEvents: SimEvent[]): void {
    const names: string[] = [];
    for (const e of stepEvents) {
      switch (e.type) {
        case 'possession.gained':
          names.push(`${e.actor}.has_ball`);
          if (e.via === 'catch') names.push(`${e.actor}.caught`, 'pass.caught');
          break;
        case 'pass.released':
          names.push(`${e.actor}.passed`, `${e.actor}.passed_${e.target}`, 'pass.released');
          break;
        case 'shot.released':
          names.push(`${e.actor}.shot`, 'shot.released');
          break;
        case 'shot.made':
          names.push('shot.made', `${e.actor}.scored`);
          break;
        case 'shot.missed':
          names.push('shot.missed');
          break;
      }
    }
    for (const n of names) this.emitNamed(n);
  }

  /** Smart pass (spec §40): lob over a defender in the lane, led along the receiver's route. */
  private passBall(ctx: ReturnType<Simulation['ballContext']>, a: KinematicCharacterController, b: KinematicCharacterController, lob: boolean, oopSpot: Vec2 | null): void {
    const useLob = lob || !!oopSpot || !!laneBlocker(this.chars, a, b);
    releasePass(ctx, a, b, useLob, this.planPass(a, b, useLob, oopSpot) ?? undefined);
  }

  /** Where an AI receiver should go to meet a pass in flight (null if none is coming). */
  incomingPass(id: string): Vec2 | null {
    if (this.ball.passTarget !== id || this.ball.holder !== null) return null;
    const c = this.character(id)!;
    const p = this.physics.getBallPosition();
    const v = this.physics.getBallVelocity();
    // Meet a chest pass at the chest; a lob where it comes down to jumping reach.
    const catchHeight = p.y > c.state.height * 1.1 || v.y > 0 ? c.state.height * 1.3 + 0.35 : c.state.height * 0.65;
    // When will the ball come down through that height?
    const a = -0.5 * GRAVITY, b = v.y, cc = p.y - catchHeight;
    const disc = b * b - 4 * a * cc;
    const t = disc >= 0 ? Math.max((-b - Math.sqrt(disc)) / (2 * a), 0) : 0.3;
    return { x: p.x + v.x * t, z: p.z + v.z * t };
  }

  /**
   * Plans a pass using the receiver's route (the offense knows its own play): the ball
   * is led to where he will be, never past where he stops. Alley-oops are timed to his
   * arrival at the spot.
   */
  planPass(passer: KinematicCharacterController, receiver: KinematicCharacterController, lob: boolean, oopSpot: Vec2 | null): PassPlan | null {
    const route = this.routeFor(receiver.id);
    const r = receiver.state;
    const vmax = receiver.runSpeed() * 1.25;
    const accel = 6 + 14 * (receiver.definition.attributes.physical.acceleration / 100);
    const v0 = Math.hypot(r.velocity.x, r.velocity.z);
    /** Distance covered in time t, accelerating from v0 toward vmax. */
    const travelled = (t: number) => {
      const ta = Math.max(0, (vmax - v0) / accel);
      return t <= ta ? v0 * t + 0.5 * accel * t * t : v0 * ta + 0.5 * accel * ta * ta + vmax * (t - ta);
    };
    const remaining = route && !route.waiting ? route.path.slice(route.progress) : null;
    const along = (dist: number): Vec2 => {
      if (!remaining || remaining.length < 2) return { x: r.position.x, z: r.position.z };
      let left = dist;
      let prev: Vec2 = { x: r.position.x, z: r.position.z };
      for (const q of remaining) {
        const seg = Math.hypot(q.x - prev.x, q.z - prev.z);
        if (seg >= left) return { x: prev.x + ((q.x - prev.x) * left) / (seg || 1), z: prev.z + ((q.z - prev.z) * left) / (seg || 1) };
        left -= seg;
        prev = q;
      }
      return remaining[remaining.length - 1];
    };
    const p = passer.state.position;
    if (oopSpot) {
      // Time the lob to the cutter's arrival at the spot (route length if he is running one).
      // Err late: a lob that hangs can still be met at the rim; an early one sails past.
      const pathLen = remaining ? remaining.reduce((acc, q, i) => acc + Math.hypot(q.x - (i ? remaining[i - 1].x : r.position.x), q.z - (i ? remaining[i - 1].z : r.position.z)), 0) : Math.hypot(oopSpot.x - r.position.x, oopSpot.z - r.position.z);
      let t = 0.2;
      while (travelled(t) * 0.92 < pathLen && t < 2.5) t += 0.02;
      return { at: oopSpot, t: Math.min(1.6, Math.max(0.75, t + 0.08)), oop: true };
    }
    if (!remaining) return null;
    let t = 0.4;
    let at: Vec2 = { x: r.position.x, z: r.position.z };
    for (let i = 0; i < 4; i++) {
      at = along(travelled(t));
      const d = Math.hypot(at.x - p.x, at.z - p.z);
      t = lob ? 0.7 + d * 0.08 : Math.min(1.1, Math.max(0.22, d / 11));
    }
    return { at, t };
  }

  /** A loose ball that leaves the court or lies dead ends the possession. */
  private looseTicks = 0;
  private trackDeadBall(): void {
    if (!this.play || this.playState?.complete) return;
    const loose = this.ball.holder === null && this.ball.passTarget === null && !(this.ball.shot && !this.ball.shot.resolved);
    this.looseTicks = loose ? this.looseTicks + 1 : 0;
    const p = this.physics.getBallPosition();
    const out = p.y < 0.5 && (Math.abs(p.x) > COURT.halfWidth + 0.1 || p.z < COURT.baselineZ - 0.1 || p.z > COURT.halfCourtZ + 0.1);
    if (loose && out) this.emitNamed('ball.out_of_bounds');
    if (loose && (out || this.looseTicks === 150)) this.emitNamed('play.dead_ball');
  }

  /** Emits `<player>.denied` when his defender gets into the passing lane (a read cue, e.g. backdoor). */
  private trackDenials(): void {
    if (!this.play?.simulation.deny) return;
    const holder = this.ball.holder ? this.character(this.ball.holder) : undefined;
    const now: string[] = [];
    if (holder) {
      for (const c of this.chars) {
        if (c === holder || c.state.team !== holder.state.team) continue;
        const blocker = laneBlocker(this.chars, holder, c);
        if (blocker && blocker.state.assignment === c.id) now.push(c.id);
      }
    }
    for (const id of now) if (!this.denied.includes(id)) this.emitNamed(`${id}.denied`);
    this.denied = now;
  }

  /** In an option node, the user picks an option by doing it (pass, shot, or running its route). */
  private trackUserChoice(): void {
    const me = this.controlled;
    const ps = this.playState;
    if (!me || !ps || !this.play || ps.chosenOption !== null) return;
    const node = this.play.nodes[ps.node];
    const mine = node.options.filter((o) => o.action.actor === me);
    if (!mine.length) return;
    const meC = this.character(me)!;
    const w = this.worldView();
    const self = w.players.find((p) => p.id === me)!;
    const targetOf = (o: (typeof mine)[number]) => {
      const mv = o.action.steps.find((st) => st.op === 'move');
      return mv && mv.op === 'move' ? resolveTarget(w, self, mv.via[0] ?? mv.to) : null;
    };
    const distTo = (o: (typeof mine)[number]) => {
      const t = targetOf(o);
      return t ? Math.hypot(t.x - meC.state.position.x, t.z - meC.state.position.z) : Infinity;
    };
    if (this.optionTrack?.node !== ps.node) this.optionTrack = { node: ps.node, start: Object.fromEntries(mine.map((o) => [o.id, distTo(o)])) };
    const byRoute = mine
      .filter((o) => Number.isFinite(this.optionTrack!.start[o.id]))
      .map((o) => ({ o, gain: this.optionTrack!.start[o.id] - distTo(o) }))
      .sort((a, b) => b.gain - a.gain)[0];
    if (byRoute && byRoute.gain > Math.min(1.5, this.optionTrack.start[byRoute.o.id] * 0.6)) {
      this.pendingChoice = byRoute.o.id;
      return;
    }
    const passed = this.namedThisStep.find((n) => n.startsWith(`${me}.passed_`));
    const shot = this.namedThisStep.includes(`${me}.shot`);
    const pick = mine.find((o) =>
      o.action.steps.some((st) => (passed && st.op === 'pass' && `${me}.passed_${st.target}` === passed) || (shot && st.op === 'shoot')),
    );
    if (pick) this.pendingChoice = pick.id;
  }

  private updatePracticeScoring(): void {
    const me = this.controlled ? this.character(this.controlled) : undefined;
    if (!this.practice || !me || !this.play || !this.playState || this.playState.complete) return;
    const task = this.playState.tasks[me.id];
    const firstMove = task?.steps.find((st) => st.op === 'move');
    let taskTarget: { x: number; z: number } | null = null;
    if (firstMove && firstMove.op === 'move') {
      const w = this.worldView();
      const self = w.players.find((p) => p.id === me.id)!;
      taskTarget = resolveTarget(w, self, firstMove.via[0] ?? firstMove.to);
    }
    updatePractice(this.practice, {
      tick: this.tick,
      graph: this.play,
      history: this.playState.history.map((h) => h.node),
      task,
      taskTarget,
      self: {
        position: { x: me.state.position.x, z: me.state.position.z },
        hasBall: this.ball.holder === me.id,
        screening: !!task && !task.done && (task.semantic === 'screen' || task.steps[task.index]?.op === 'screenPosition'),
      },
      teammates: this.chars.filter((c) => c !== me && c.state.team === me.state.team).map((c) => ({ x: c.state.position.x, z: c.state.position.z })),
      stepEvents: this.namedThisStep,
    });
  }

  /** Practice feedback for the controlled actor (null when watching). */
  practiceResult(): PracticeResult | null {
    return this.practice && this.play ? finishPractice(this.practice, this.play, this.coverage) : null;
  }

  /** What the play expects the controlled actor to choose in the current branch (assist hint). */
  expectedForUser(): string[] {
    if (!this.practice?.branch || !this.play) return [];
    return expectedDecisions(this.play, this.practice.branch, this.practice.actor);
  }

  /**
   * Route the controlled (or any offensive) actor is expected to run next, for
   * the ghost-route overlay. Computed on a copy: never mutates the play state.
   */
  routeFor(actorId: string): { path: Vec2[]; progress: number; semantic: string; waiting: boolean; waitFor: string | null } | null {
    const task = this.playState?.tasks[actorId];
    if (!task || task.done) return null;
    const stepIdx = task.started ? task.index : 0;
    const step = task.steps.slice(stepIdx).find((st) => st.op === 'move');
    if (!step || step.op !== 'move') return null;
    let path = task.started && task.steps[task.index] === step ? task.step.path : null;
    let progress = task.started ? task.step.pathIndex : 0;
    if (!path) {
      const w = this.worldView();
      const self = w.players.find((p) => p.id === actorId)!;
      const scratch = { ...task, step: { startTick: this.tick, path: null, pathIndex: 0 } } as ActorTask;
      path = ensureMovePath(step, scratch, self, w);
      progress = 0;
    }
    if (!path) return null;
    const waitFor = !task.started && task.when?.kind === 'event' ? task.when.name : null;
    return { path, progress, semantic: task.semantic, waiting: !task.started, waitFor };
  }

  /** For the ball handler: which teammates have an open (unblocked) passing lane. */
  passWindows(): { id: string; slot: number; open: boolean }[] {
    const me = this.controlled ? this.character(this.controlled) : undefined;
    if (!me || this.ball.holder !== me.id) return [];
    return this.passSlots().map((id, i) => ({ id, slot: i + 1, open: !laneBlocker(this.chars, me, this.character(id)!) }));
  }

  /** Teammates in pass-key order (1–4). */
  passSlots(id: string | null = this.controlled): string[] {
    const me = id ? this.character(id) : undefined;
    return me ? this.chars.filter((c) => c.state.team === me.state.team && c !== me).map((c) => c.id) : [];
  }

  private applyCommand(cmd: SimInput['commands'][number], ctx: ReturnType<Simulation['ballContext']>): void {
    switch (cmd.kind) {
      case 'switchControl': {
        if (this.chars.length === 0 || this.play) return; // a play rep keeps its role
        const i = this.chars.findIndex((c) => c.id === this.controlled);
        const next = this.chars[(i + 1) % this.chars.length];
        this.setControlled(next.id);
        return;
      }
      case 'resetBall': {
        if (this.play) return;
        const me = this.controlled ? this.character(this.controlled) : undefined;
        if (me && this.ball.holder !== me.id) {
          this.ball.shot = null;
          giveBall(ctx, me, 'pickup');
        }
        return;
      }
      case 'pass': {
        const me = this.controlled ? this.character(this.controlled) : undefined;
        if (!me || this.ball.holder !== me.id) return;
        const mates = this.chars.filter((c) => c.state.team === me.state.team && c !== me);
        const target = mates[cmd.slot - 1];
        if (target) this.passBall(ctx, me, target, cmd.lob, null);
        return;
      }
    }
  }

  setControlled(id: string | null): void {
    if (this.controlled === id || (id !== null && !this.character(id))) return;
    this.controlled = id;
    this.shootHeld = false;
    if (id) this.events.push({ type: 'control.changed', actor: id });
  }

  /** Offensive control follows a completed pass, like most basketball games. */
  private followBallOnCatch(newEvents: SimEvent[]): void {
    const me = this.controlled ? this.character(this.controlled) : undefined;
    for (const e of newEvents) {
      if (e.type !== 'possession.gained' || e.via !== 'catch') continue;
      const receiver = this.character(e.actor);
      if (me && receiver && receiver.state.team === me.state.team) this.setControlled(e.actor);
    }
  }

  private applyControl(me: KinematicCharacterController, input: SimInput, ctx: ReturnType<Simulation['ballContext']>): void {
    me.setDesiredMovement({ direction: input.move, sprint: input.sprint });
    // Mouse facing, with a dead zone: a cursor on top of the player would flip facing every frame.
    const aim = me.motion.facing === 'aim' ? input.aim : null;
    const aimDist = aim ? Math.hypot(aim.x - me.state.position.x, aim.z - me.state.position.z) : 0;
    if (aim && aimDist > 1.2) me.setFacing({ x: aim.x - me.state.position.x, z: aim.z - me.state.position.z });
    else if (!aim) me.setFacing(null);

    const hasBall = this.ball.holder === me.id;
    const pressed = input.shootHeld && !this.shootHeld;
    const released = !input.shootHeld && this.shootHeld;
    this.shootHeld = input.shootHeld;

    // A press during the catch gather is queued: catch-and-shoot starts as soon as the ball is secured.
    if (pressed) this.shootQueued = true;
    if (!input.shootHeld) this.shootQueued = false;
    if (this.shootQueued && hasBall && me.state.action.kind !== 'shoot' && this.ball.gatherTimer <= 0) {
      this.shootQueued = false;
      me.setAction({ kind: 'shoot', t: 0, jumpV0: jumpVelocity(me.definition.attributes), released: false });
    }
    if (me.state.action.kind === 'shoot') {
      me.setFacing({ x: RIM_CENTER.x - me.state.position.x, z: RIM_CENTER.z - me.state.position.z });
      if (released) releaseShot(ctx, me);
    }
  }

  private advanceAction(c: KinematicCharacterController, ctx: ReturnType<Simulation['ballContext']>): void {
    const a = c.state.action;
    if (a.kind === 'shoot') {
      a.t += SIM_DT;
      c.state.position.y = jumpHeightAt(a.t, a.jumpV0);
      const total = shotDuration(a.jumpV0);
      // Held too long: the ball comes out on the way down.
      if (!a.released && a.t >= total - 0.08) releaseShot(ctx, c);
      if (a.t >= total) {
        c.state.position.y = 0;
        c.setAction({ kind: 'none' });
      }
    } else if (a.kind === 'catch') {
      a.t += SIM_DT;
      if (a.air) {
        c.state.position.y = Math.max(0, a.air * a.t - 0.5 * GRAVITY * a.t * a.t);
        if (a.t >= (2 * a.air) / GRAVITY) {
          c.state.position.y = 0;
          c.setAction({ kind: 'none' });
        }
      } else if (a.t > 0.25) c.setAction({ kind: 'none' });
    }
  }

  /** Events emitted since the last drain. */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Shot meter info for the controlled player's active jump shot. */
  shotMeter(): { progress: number; ideal: number } | null {
    const me = this.controlled ? this.character(this.controlled) : undefined;
    const a = me?.state.action;
    if (!a || a.kind !== 'shoot' || a.released) return null;
    const total = shotDuration(a.jumpV0);
    return { progress: a.t / total, ideal: idealReleaseTime(a.jumpV0) / total };
  }

  // ---- Snapshot / restore (spec §45) ----

  snapshot(): SimulationSnapshot {
    return {
      tick: this.tick,
      physics: this.physics.snapshot(),
      characters: this.chars.map((c) => structuredClone(c.state)),
      ball: structuredClone(this.ball),
      rng: this.rng.getState(),
      stats: { ...this.stats },
      controlled: this.controlled,
      shootHeld: this.shootHeld,
      play: structuredClone(this.playState),
      screens: structuredClone(this.screens),
      pendingNamed: [...this.pendingNamed],
      coverage: this.coverage,
      defense: structuredClone(this.defenseMemory),
      denied: [...this.denied],
      optionTrack: structuredClone(this.optionTrack),
      practice: structuredClone(this.practice),
      pendingChoice: this.pendingChoice,
    };
  }

  restore(s: SimulationSnapshot): void {
    this.tick = s.tick;
    this.physics.restore(s.physics);
    for (const cs of s.characters) {
      const c = this.character(cs.id);
      if (c) c.state = structuredClone(cs);
    }
    this.ball = structuredClone(s.ball);
    this.rng.setState(s.rng);
    this.stats = { ...s.stats };
    this.controlled = s.controlled;
    this.shootHeld = s.shootHeld;
    this.shootQueued = false;
    this.playState = structuredClone(s.play);
    this.screens = structuredClone(s.screens);
    this.pendingNamed = [...s.pendingNamed];
    this.namedThisStep = [];
    this.coverage = s.coverage;
    this.defenseMemory = structuredClone(s.defense);
    this.denied = [...s.denied];
    this.optionTrack = structuredClone(s.optionTrack);
    this.practice = structuredClone(s.practice);
    this.pendingChoice = s.pendingChoice;
    this.events = [];
    this.capturePrev();
    this.prevBall = this.physics.getBallPosition();
  }

  // ---- Render interpolation ----

  private capturePrev(): void {
    for (const c of this.chars) this.prev.set(c.id, { pos: { ...c.state.position }, facing: c.state.facing });
    this.prevBall = this.physics.getBallPosition();
  }

  /** Interpolated view between the previous and current step. alpha ∈ [0, 1). */
  getRenderState(alpha: number): RenderState {
    return {
      characters: this.chars.map((c) => {
        const s = c.state;
        const p = this.prev.get(s.id) ?? { pos: s.position, facing: s.facing };
        return {
          id: s.id,
          definitionId: s.definitionId,
          team: s.team,
          position: lerp3(p.pos, s.position, alpha),
          velocity: { ...s.velocity },
          facing: lerpAngle(p.facing, s.facing, alpha),
          locomotion: s.locomotion,
          action: s.action.kind,
          actionTime: s.action.kind === 'none' ? 0 : s.action.t,
          hasBall: this.ball.holder === s.id,
          dribbleHand: this.ball.holder === s.id ? this.ball.hand : null,
          stride: lerp(s.stride - Math.hypot(s.velocity.x, s.velocity.z) * SIM_DT, s.stride, alpha),
          controlled: this.controlled === s.id,
          pose: s.pose,
        };
      }),
      ball: { position: lerp3(this.prevBall, this.physics.getBallPosition(), alpha), holder: this.ball.holder },
    };
  }

  dispose(): void {
    this.physics.dispose();
  }
}
