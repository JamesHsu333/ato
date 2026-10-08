# ATO — 3D Basketball Tactics Sandbox

A programmable 3D half-court tactics simulator for the web (see `spec.md`): design plays, watch them run
against a reactive defense, practice a role with guidance, and learn to read coverages.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: physics, simulation, play schema/compiler/runtime, AI, practice scoring, samples
npm run test:e2e   # Playwright: every mode and acceptance demo in a real browser
npm run build
```

## Modes

| Mode | What it does |
| --- | --- |
| **Sandbox** | Free play: control a humanoid or sprite, dribble, pass, shoot with the timing meter. |
| **Play → Watch** | Everyone is AI. Pick a defensive coverage and watch the play adapt. Routes are drawn on the floor. |
| **Play → Practice** | You play one role. Ghost route, WAIT/GO timing cue, screen cue, passing windows and read hints guide you; teammates wait for you. A result card scores **Timing / Spacing / Route / Decision** with coaching notes. |
| **Play → Read & React** | The defense secretly picks a coverage each rep. Read it from how the defenders move and make the right play; the card reveals the coverage and grades your decision. |
| **Designer** | Drag players, Shift-drag to add a move, Option-drag for a curved route, edit waypoints, scrub the timeline, edit YAML live, undo/redo. Plays autosave to the browser (IndexedDB). |

### Controls (Sandbox / Practice)

| Input | Action |
| --- | --- |
| WASD / arrows | Move (camera-relative) · Shift sprint |
| Mouse | Facing |
| Hold / release Space | Jump shot — release at the top of the jump |
| 1–4 / Shift+1–4 | Smart pass / lob (key numbers float over teammates) |
| Enter | Next rep (on the result card) |

### Designer

Drag a player: starting spot · **Shift**-drag: new move · **Option**-drag: curved route · drag white handles:
waypoints · double-click a route: add waypoint · **Alt**-click a waypoint: delete · drag the cyan square: move the
target · **Cmd/Ctrl-Z** undo · **Cmd/Ctrl-Shift-Z** redo · **Space** play/pause · **Delete** remove the selected action.

## Sample plays (spec §49)

01 High Pick & Roll (5v5, all five coverages) · 02 Elevator Doors · 03 Floppy · 04 Spain Pick & Roll · 05 Horns ·
06 Backdoor Cut · 07 Dribble Handoff · 08 Alley-Oop — all in `src/samples/*.yaml`.

## Play format (YAML, `version: "0.1"`)

Validated by a versioned JSON Schema (`src/domain/play/schema/playSchema.ts`) plus cross-reference checks.

- **Semantic actions:** `move, cut, back_cut, v_cut, curl, flare, drive, screen, pin_down, flare_screen, elevator,
  roll, pop, slip, handoff, pass, lob, alley_oop, shoot, layup, dunk, wait` (camelCase aliases accepted). They
  compile to runtime primitives (`move, face, wait, hold, pass, handoff, shoot, screenPosition, setPose`).
- **Events, not timestamps:** `<actor>.<event>` (`handler.clears_screen`, `screener.screen_set`,
  `shooter.caught`, `wing.denied`, …) or global (`screen.connected`, `screen.illegal`, `shot.made`, …). Every action
  emits `<actor>.<action>_done`. An action with `when` waits for its condition while the player keeps doing what he
  was doing.
- **Conditions:** `event`, `coverage` (drop / hedge / switch / under / go_over / man), `elapsed`, `all`, `any`.
- **Graph:** nodes with `actions`, `player_options` (the AI takes the first; a user picks by doing it — pass, shoot
  or run the route) and `transitions`. A possession ends on a shot, a turnover or a dead ball.
- Actor points such as `screener.right_shoulder` are named as seen by the player using them.

## Architecture

```
src/
  domain/        court + semantic spots, characters, math/RNG, play schema, compiler, edits, coaching
  simulation/    60 Hz fixed-step runtime, Rapier physics, character controllers, ball/shot/pass systems,
                 play-graph runtime, offense AI (+ guided practice), coverage-aware defense, screens,
                 practice evaluator, recorder (snapshots every 0.5 s for timeline seeking)
  rendering/     React Three Fiber scene, court, cameras, character renderers (procedural humanoid, GLB,
                 8-direction sprite), tactical overlay, designer layer
  persistence/   IndexedDB play library
  app/           session, input, UI store, HUD, play/practice/designer UI
  samples/       sample plays
```

Spec rules the code enforces (several are tested):

- Simulation and domain code never import React or Three.js; the simulation only advances in fixed steps and
  rendering interpolates.
- The defensive AI sees positions, velocities, ball, assignments, screen cues and its coverage policy — it cannot
  import the play graph (a test checks this).
- All state (physics bytes, characters, ball, play graph, AI memory, RNG, practice scoring) is captured by
  `Simulation.snapshot()`; seeking restores the nearest snapshot and fast-forwards, matching a continuous run.
- Shots: a quality model (timing, distance, skill, movement, contest, shot type) decides intent; physics decides
  the trajectory.
- Appearance is independent of behavior: any actor can be a procedural humanoid, a user GLB or a sprite
  (`front.png … back.png`) without changing the play.

## Known limitations

- Built-in characters are procedural (no downloaded mocap); a GLB with standard clip names is animated through
  its own clips.
- The help defense is rule-based (tag the roller, deny, sag); it does not yet rotate on every drive.
- The production bundle is ~5.5 MB because Rapier's WASM is inlined.
