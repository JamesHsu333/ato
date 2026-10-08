# 3D Basketball Tactics Sandbox

**Version:** PRD v0.1  
**Platform:** Web  
**Primary Renderer:** Three.js  
**Status:** Ready for implementation planning

---

## 1. Product Vision

Build a programmable, editable, interactive **3D half-court basketball tactics simulator** for the web.

The product is not intended to be a full NBA 2K-style basketball game.

Its primary purpose is to let users:

1. Design basketball plays.
2. Visualize plays in an editable 3D half court.
3. Control one player and practice executing a play.
4. Practice reading defensive coverages and reacting in real time.
5. Customize player appearance using 3D models or 2D sprites.
6. Define plays through both visual editing and YAML/JSON.
7. Reuse the same play definition regardless of character appearance.

Core principle:

> Basketball logic must be deterministic, editable, and inspectable.  
> AI-generated video should not be responsible for deciding how the play unfolds.

---

# 2. Core Product Modes

The system contains three main runtime modes.

## 2.1 Designer Mode

Used to create and inspect basketball plays.

Users can:

- Place up to 5 offensive players.
- Place up to 5 defensive players.
- Place and control the basketball.
- Assign custom characters.
- Drag starting positions.
- Create movement paths.
- Define basketball actions.
- Edit Bezier paths.
- Configure defensive coverage.
- Play, pause, seek, and restart simulations.
- Inspect the play timeline.
- Edit YAML/JSON directly.
- Import/export play definitions.

Example actions:

- screen
- roll
- pop
- drive
- cut
- back cut
- curl
- flare
- handoff
- pass
- lob
- shoot
- layup
- dunk
- alley-oop
- elevator screen

---

## 2.2 Guided Practice Mode

The user controls one player in an existing play.

Example:

```text
LeBron               Ball

Hachiware          Usagi
      \            /
       \          /
         Player
       (Chiikawa)
```

The user may control:

- ball handler
- shooter
- screener
- cutter
- defender
- any other role

Other players are controlled by the simulation runtime.

### Controls

```text
WASD / Arrow Keys
Move

Shift
Sprint

Mouse
Facing / aiming

Hold Space
Charge shot

Release Space
Shoot

1–4
Smart pass to teammate

Shift + 1–4
Lob pass
```

Ball handlers automatically dribble while moving.

Manual advanced dribble combinations are not part of MVP.

---

## 2.3 Read & React Mode

The user executes a play while the defense reacts dynamically.

Example High Pick-and-Roll decision tree:

```text
                     ┌── Under ─────→ Pull-up
                     │
                     ├── Drop ──────→ Drive / Pocket Pass
Ball Screen → Read ──┼── Switch ────→ Attack mismatch
                     │
                     ├── Hedge ─────→ Retreat / Short Roll
                     │
                     └── Go-over ───→ Downhill attack
```

The player should not be told the coverage in advance.

The defense must expose its choice through movement.

The user reads the defense visually and chooses the response.

---

# 3. MVP Scope

The engine must support:

```text
5 offensive players
5 defensive players
1 basketball
```

Initial demos may use smaller configurations such as 2v2.

The architecture must support full 5v5 from the beginning.

---

# 4. Open Source and Asset Strategy

The project should prioritize open-source or permissively licensed resources.

## 4.1 Core technology

Recommended:

- Three.js
- React
- TypeScript
- React Three Fiber
- Drei
- Rapier 3D
- Zustand
- IndexedDB
- YAML parser
- JSON Schema
- Vitest
- Playwright

React Three Fiber is MIT licensed and integrates Three.js into React. :chatgpt-content-reference{index="0"}

Rapier provides browser-compatible rigid-body physics and supports JavaScript/WASM usage suitable for this type of simulation.

---

## 4.2 Generic humanoid assets

Preferred MVP source:

**Quaternius Universal Base Characters**

Useful characteristics:

- humanoid rig
- GLTF/FBX support
- lightweight models
- suitable for animation retargeting
- CC0 licensing

Generic humanoids should be the built-in default characters.

---

## 4.3 Generic animation assets

Preferred source:

**Quaternius Universal Animation Library**

Useful for:

- idle
- walking
- running
- sprinting
- directional movement
- generic physical actions

The project should not assume that a complete basketball-specific animation pack exists.

---

## 4.4 Basketball-specific animation strategy

Basketball-specific actions may require:

1. procedural animation
2. authored Blender animation
3. retargeted permissively licensed clips

Required MVP animation targets:

```text
idle
walk
run
sprint

defensive_stance
defensive_slide

dribble_idle
dribble_walk
dribble_run

catch
pass_chest
pass_lob

shoot_jump
layup
dunk

screen_set
screen_hold
screen_roll

jump
land
```

Animation quality must not block simulation correctness.

---

# 5. Intellectual Property Strategy

The engine must not depend on copyrighted or celebrity assets.

Built-in characters should be generic.

The system must support user-provided assets such as:

```text
GLB
GLTF
PNG
WebP
sprite sheets
```

This allows users to locally load characters such as:

- custom basketball players
- cartoon characters
- personal models

The engine architecture must not require any specific copyrighted character.

---

# 6. Technical Architecture

```text
┌──────────────────────────────────────────────┐
│                   Web App                    │
│                                              │
│   Editor UI      Practice UI      YAML UI    │
└────────┬──────────────┬──────────────┬────────┘
         │              │              │
         └──────────────┼──────────────┘
                        ↓
                Play Definition
                        ↓
                  Play Compiler
                        ↓
                    Play Graph
                        ↓
┌──────────────────────────────────────────────┐
│              Simulation Runtime              │
│                                              │
│ Offense AI   Defense AI   Decision Engine    │
│      │           │              │             │
│      └───────────┼──────────────┘             │
│                  ↓                            │
│         Character Controllers                │
│                  ↓                            │
│             Physics Layer                    │
└──────────────────┬───────────────────────────┘
                   ↓
              Render Adapter
                   ↓
                Three.js
```

---

# 7. Architecture Rules

These rules are mandatory.

```text
1. Basketball domain logic must not live inside React components.

2. Basketball domain logic must not live inside Three.js objects.

3. Three.js must not know what a pick-and-roll is.

4. PlayDefinition must be renderer-independent.

5. Simulation must run on a fixed timestep.

6. Semantic basketball actions compile into lower-level runtime actions.

7. Defense AI must never inspect future PlayGraph nodes.

8. GLTF and Sprite characters implement the same runtime interface.

9. Physics state must support snapshot and restore.

10. PlayDefinition must validate against a versioned JSON Schema.

11. The same play must work regardless of character appearance.

12. Do not add backend, account, or multiplayer requirements during MVP.
```

---

# 8. Court Coordinate System

The DSL supports both semantic basketball positions and exact coordinates.

Example semantic position:

```yaml
position: right_corner
```

Exact position:

```yaml
position:
  x: 6.7
  z: 0.9
```

Semantic position with offset:

```yaml
position:
  spot: right_wing
  offset:
    - 0.6
    - -0.3
```

Coordinate convention:

```text
origin = basket center projected onto floor

+x = right side of court
-x = left side of court

+z = away from basket

y = height
```

---

# 9. Semantic Court Locations

Initial semantic spots:

```text
rim

restricted_area

left_block
right_block

left_elbow
right_elbow

top

left_slot
right_slot

left_wing
right_wing

left_corner
right_corner

short_corner_left
short_corner_right
```

---

# 10. Character Definition

Example TypeScript model:

```ts
interface CharacterDefinition {
  id: string;
  name: string;

  renderer:
    | GltfCharacterRenderer
    | SpriteCharacterRenderer;

  dimensions: {
    height: number;
    collisionRadius: number;
  };

  attributes: PlayerAttributes;

  motionProfile: string;
}
```

---

# 11. Player Attributes

Attributes exist in the initial schema.

Avoid an NBA 2K-sized attribute system.

Initial attributes:

```yaml
physical:
  speed: 80
  acceleration: 80
  agility: 80
  strength: 80
  jump: 80

offense:
  finishing: 80
  midrange: 80
  three_point: 80
  passing: 80
  ball_handling: 80
  screening: 80

defense:
  perimeter_defense: 80
  interior_defense: 80
  steal: 80
  block: 80

tendencies:
  help_defense: 50
  screen_navigation: 50
  aggression: 50
```

---

# 12. Character Rendering

Two primary rendering types:

## 12.1 GLTF Character

Used for normal humanoid basketball players.

Supports:

- skeleton
- animation blending
- IK later
- locomotion
- basketball animations

---

## 12.2 Sprite Character

Used for cartoon or simplified characters.

Example:

```text
Chiikawa
Hachiware
Usagi
custom mascot
```

The same play logic must work for both GLTF and sprite characters.

---

# 13. Sprite Direction System

Sprites support 8 directions.

```text
N
NE
E
SE
S
SW
W
NW
```

Sprites must not always face the camera.

The visible sprite direction should depend on world-facing direction relative to camera.

---

# 14. Sprite Animation System

Architecture must support both static directional sprites and animated sprite sheets.

## Static mode

Example:

```text
front.png
front_left.png
left.png
back_left.png
back.png
back_right.png
right.png
front_right.png
```

Movement animation is generated procedurally using:

- bob
- hop
- squash
- stretch
- rotation
- acceleration
- stop timing

---

## Animated mode

Example:

```text
idle/N/*
idle/NE/*
run/N/*
run/NE/*
screen/N/*
shoot/N/*
```

---

# 15. Motion Profiles

Sprites and characters may have motion personalities.

Example:

```yaml
motion_profile:
  locomotion:
    style: hop
    cadence: fast
    bob_height: 0.08
    squash: 0.05

  acceleration:
    style: abrupt

  stopping:
    style: hard

  screen:
    pose: brace
```

Character Editor should expose:

```text
Preset

Advanced
  cadence
  bob
  squash
  acceleration
  stop style
  facing behavior
```

---

# 16. Physics

Recommended engine:

**Rapier 3D**

The simulation uses hybrid physics.

---

## 16.1 Characters

Characters use kinematic controllers.

Do not use full rigid-body ragdoll simulation during normal gameplay.

---

## 16.2 Character Collision

Designer mode:

```text
soft collision
assisted navigation
less chance of players becoming stuck
```

Practice / Read & React mode:

```text
stronger collision
real route blocking
screen interaction matters
```

---

## 16.3 Basketball

The basketball is a dynamic rigid body.

Physics includes:

```text
gravity
floor collision
rim collision
backboard collision
bounce
```

Spin can be added later.

---

## 16.4 Ball Possession

While possessed:

```text
ball follows hand / possession constraint
```

During a dribble:

```text
ball alternates between hand control and controlled bounce
```

After release:

```text
dynamic rigid body simulation
```

---

# 17. Screen System

A screen is a basketball semantic action.

It is not merely an animation.

Example:

```yaml
action: screen
actor: screener

target: x1

side: left
angle: auto

hold_until:
  event: handler.clears_screen
```

The runtime calculates:

```text
screen location
screen angle
screen plane
defender route
legal stance
handler route
```

Possible screen events:

```text
screen.set
screen.connected
screen.missed
screen.illegal
handler.clears_screen
```

---

# 18. Illegal Screens

MVP should detect illegal screens.

Example conditions:

```text
screener not stationary
invalid angle
moving collision
illegal contact
```

MVP behavior:

```text
record event
show feedback
continue play
```

Later versions may implement:

```text
whistle
dead ball
foul
possession change
```

---

# 19. Play Definition Format

Human authoring format:

**YAML**

Internal normalized representation:

**JSON**

Validation:

**JSON Schema**

Versioned format:

```yaml
version: "0.1"
```

---

# 20. Base Play Schema

```yaml
version: "0.1"

play:
  id: high-pnr
  name: High Pick & Roll

court:
  type: nba_half

actors: {}

setup: {}

graph: {}

simulation: {}
```

---

# 21. Play Graph

A play is not simply a timeline.

It is a graph.

Example:

```text
                 ┌── Shoot
                 │
Setup → Screen → Read ── Drive → Finish
                 │
                 ├── Pocket Pass → Roll
                 │
                 └── Reject Screen
```

Conceptual interface:

```ts
interface PlayNode {
  id: string;

  actions: Action[];

  completion?: Condition;

  transitions: Transition[];
}
```

Transition:

```ts
interface Transition {
  when: Condition;

  to: NodeId;
}
```

---

# 22. High Pick-and-Roll Example

```yaml
version: "0.1"

play:
  id: high-pnr
  name: High Pick & Roll

court:
  type: nba_half

actors:

  handler:
    character: generic_guard
    team: offense
    role: ball_handler

  screener:
    character: generic_big
    team: offense
    role: screener

  x1:
    character: generic_defender
    team: defense
    assignment: handler

  x5:
    character: generic_defender
    team: defense
    assignment: screener

setup:

  handler:
    position: top
    possession: ball

  screener:
    position: right_elbow

  x1:
    relative_to: handler
    defensive_position: on_ball

  x5:
    relative_to: screener
    defensive_position: matchup

graph:

  start:

    actions:

      - actor: screener
        action: move

        to:
          relative_to: x1
          purpose: screen

    transitions:

      - when:
          event: screener.screen_position_ready

        to: screen

  screen:

    actions:

      - actor: screener
        action: screen
        target: x1
        angle: auto
        hold_until: handler.clears_screen

      - actor: handler
        action: drive
        via: screener.right_shoulder

    transitions:

      - when:
          event: handler.clears_screen

        to: read

  read:

    transitions:

      - when:
          coverage: under
        to: pull_up

      - when:
          coverage: drop
        to: drop_read

      - when:
          coverage: switch
        to: switch_read

      - when:
          coverage: hedge
        to: hedge_read

      - when:
          coverage: go_over
        to: downhill

  drop_read:

    player_options:

      - id: pocket_pass

        action:
          actor: handler
          action: pass
          target: screener
          type: smart

      - id: floater

        action:
          actor: handler
          action: shoot
          type: floater

  pull_up:

    actions:

      - actor: handler
        action: shoot
        type: pull_up

  downhill:

    actions:

      - actor: screener
        action: roll
        to: rim

      - actor: handler
        action: drive
        to: rim

simulation:

  seed: 42

  shot_outcome:
    mode: simulated
```

---

# 23. Primitive Runtime Actions

Low-level engine primitives:

```text
move
face
wait
hold
jump

possess
release
pass
catch

setPose
playAnimation

screenPosition
```

---

# 24. Basketball Semantic Actions

Higher-level actions:

```text
screen
roll
pop
slip

drive

cut
backCut
vCut
curl
flare

handoff

pass
lob

shoot
layup
dunk

alleyOop

pinDown
flareScreen
elevator
```

Semantic actions compile into primitive actions.

Example:

```text
alleyOop
```

may compile into:

```text
receiver.move
passer.lob
receiver.jump
receiver.catch
receiver.finish
```

---

# 25. Movement Path System

Semantic actions automatically generate default paths.

Example:

```yaml
action: curl
around: screener
to: right_wing
```

Compiler output:

```text
Bezier path
```

The editor allows the user to override it.

Example:

```yaml
path:
  mode: override

  points:

    - [1.2, 5.0]

    - [0.5, 4.0]

    - [-0.8, 3.2]
```

---

# 26. Path Editor

Interaction:

```text
Select player

Drag destination

System generates path

Drag Bezier handles

Add waypoint

Delete waypoint
```

Semantic actions should always generate a usable default path first.

---

# 27. Editor Layout

Suggested layout:

```text
┌──────────────┬────────────────────────┬─────────────┐
│              │                        │             │
│ Asset        │       3D Court         │ Inspector   │
│ Palette      │                        │             │
│              │                        │             │
├──────────────┴────────────────────────┴─────────────┤
│                    Timeline                        │
├────────────────────────────────────────────────────┤
│ YAML / JSON Editor                                 │
└────────────────────────────────────────────────────┘
```

---

# 28. Editor Interaction

```text
Drag
Move initial player position

Shift + Drag
Create movement action

Option + Drag
Create curved route

Click actor
Open inspector

Cmd-Z
Undo

Cmd-Shift-Z
Redo
```

---

# 29. Timeline

MVP includes Timeline UI.

Graph editor UI is Phase 2.

Example:

```text
0        1        2        3        4

LBJ      ├──────── drive ────────┤ pass

Usagi    ├── screen ──┤ roll ──────────

X1       ├──────── defend ──────────────
```

Even though the UI initially shows a timeline, the underlying model remains event-graph based.

---

# 30. Event-Based Timing

Events are more important than fixed timestamps.

Bad:

```yaml
at: 2.0
action: close_screen
```

Preferred:

```yaml
when:
  event: shooter.enters_elevator
```

Example Elevator action:

```text
Shooter approaches

Screeners wait

Shooter passes through

Screens close

Shooter exits

Pass is delivered
```

If the player arrives late, AI screeners should wait.

---

# 31. Adaptive Offense AI

Phase 1 behavior:

```text
wait for event dependencies

maintain spacing

do not block ball handler

relocate if passing lane becomes invalid

hold screen until required event

timeout → reset into safe spacing
```

Phase 2:

```text
automatic cut

automatic replace

secondary action

flow offense
```

---

# 32. Defensive AI

Defense is rule-based reactive AI.

It must not know future play nodes.

The defense sees only:

```text
current player positions

velocities

ball state

assignments

screen cues

coverage policy
```

---

# 33. MVP Defensive Coverages

Support:

```text
on-ball man

go-over

under

drop

switch

hedge
```

Coverage defines policy, not a fixed animation.

---

# 34. Defensive AI Priority

Suggested priority order:

```text
1. Maintain primary assignment

2. React to ball

3. React to screen

4. Maintain help position

5. Recover / rotate

6. Contest / rebound
```

---

# 35. Guided Practice Assistance

Each feature is toggleable:

```text
Ghost route

Target spot

Screen cue

Timing cue

Passing window

Defensive read hint
```

---

# 36. Practice Feedback

Possible feedback metrics:

```text
Timing

Spacing

Route

Decision
```

Example:

```text
Timing: 83%

Spacing: 94%

Route: 78%

Decision: Correct
```

Possible feedback:

```text
You left the screen 0.31 seconds before it was fully set.
```

---

# 37. Shooting Controls

Practice mode:

```text
Hold Space
Charge shot

Release Space
Shoot
```

Shot timing feedback:

```text
EARLY

SLIGHTLY EARLY

EXCELLENT

SLIGHTLY LATE

LATE
```

---

# 38. Shot Quality Model

Shot probability considers:

```text
release timing

distance

shooting attribute

defender contest

movement velocity

shot type
```

Then physics determines actual ball trajectory.

---

# 39. Shot Outcome Modes

Designer:

```yaml
shot_outcome:
  mode: forced
  result: make
```

Practice:

```yaml
shot_outcome:
  mode: simulated
```

---

# 40. Passing

Controls:

```text
1–4
Smart pass

Shift + 1–4
Lob
```

MVP does not require manual chest/bounce/pass type controls.

The smart passing system may choose contextually appropriate pass trajectories.

---

# 41. Dribbling

MVP uses automatic dribbling.

States:

```text
idle dribble

walking dribble

running dribble

sprint dribble
```

Hand selection can change automatically based on direction.

Hooks should exist for future:

```text
protect ball

change hand

hesitation

crossover
```

---

# 42. Camera Presets

MVP supports:

```text
top-down

sideline tactical

broadcast

free orbit
```

---

# 43. Camera Behaviors

Support:

```text
static

follow

tactical-auto
```

Cinematic camera is not MVP.

---

# 44. Simulation Loop

Simulation uses fixed timestep.

Recommended:

```text
60 Hz
```

Do not run physics directly using variable render delta.

Correct conceptual loop:

```text
Input
 ↓
Play Graph
 ↓
AI Decisions
 ↓
Character Desired Motion
 ↓
Physics
 ↓
Events
 ↓
Animation State
 ↓
Render Interpolation
```

Simulation FPS and rendering FPS are independent.

---

# 45. Timeline Seeking

Physics simulation must support seeking.

Snapshots are stored approximately every:

```text
0.5 seconds
```

Snapshot includes:

```text
physics state

character state

ball state

play graph state

AI state

random state
```

Seek procedure:

```text
Find closest snapshot before target time

Restore snapshot

Fast-forward fixed timestep simulation

Reach target timestamp
```

---

# 46. Replay Determinism

Designer mode uses fixed seed.

Example:

```yaml
simulation:
  seed: 42
```

Practice supports:

```text
fixed seed

random seed
```

This is important for debugging and reproducibility.

---

# 47. Local Persistence

MVP is local-first.

Use:

```text
IndexedDB
```

Required functionality:

```text
autosave

duplicate play

undo

redo

import YAML

export YAML

import JSON

export JSON
```

---

# 48. MVP Export

Required:

```text
YAML

JSON
```

Not required for MVP:

```text
video export

cloud share links

online collaboration
```

---

# 49. Sample Play Library

Initial sample plays:

```text
01 High Pick & Roll

02 Elevator Doors

03 Floppy

04 Spain Pick & Roll

05 Horns

06 Backdoor Cut

07 Dribble Handoff

08 Alley-Oop
```

---

# 50. Sample Play Purpose

## High Pick & Roll

Validates:

```text
screen

roll

coverage

pass

shot

ball physics
```

---

## Elevator Doors

Validates:

```text
off-ball movement

double screen

event waiting

player-controlled shooter

catch-and-shoot
```

---

## Floppy

Validates:

```text
off-ball route

screen selection

route branching
```

---

## Spain Pick & Roll

Validates:

```text
multiple screening actions

multi-stage play graph
```

---

## Horns

Validates:

```text
branching entry actions
```

---

## Backdoor Cut

Validates:

```text
defensive read

cut trigger

passing window
```

---

## Dribble Handoff

Validates:

```text
close-range interaction

ball possession transfer
```

---

## Alley-Oop

Validates:

```text
lob trajectory

jump timing

airborne catch

finish
```

---

# 51. MVP Acceptance Criteria

## Demo A — High Pick & Roll

The user can:

```text
control ball handler

use screen

see defender execute drop coverage

choose pull-up or pocket pass

shoot using timing mechanic
```

The screen must have actual collision/navigation meaning.

---

## Demo B — Elevator Doors

User controls shooter.

Expected behavior:

```text
screeners wait if shooter is late

screen closes only after shooter passes

catch-and-shoot works
```

---

## Demo C — Read & React

Same PnR can use:

```text
under

go-over

drop

switch

hedge
```

The user must visually identify the defense.

The system evaluates decision quality.

---

## Demo D — Character Swap

Same play definition works with:

```text
generic humanoid
```

and:

```text
custom sprite character
```

No play DSL changes are required.

---

## Demo E — YAML Round Trip

```text
Edit in UI

Export YAML

Modify YAML manually

Import

Scene updates correctly
```

---

# 52. MVP Non-Goals

Do not implement during MVP:

```text
full court

transition offense

multiplayer networking

accounts

cloud backend

custom jersey editor

advanced manual dribble combinations

referees

free throws

fouls stopping play

fatigue

substitutions

NBA roster database

audio commentary

cinematic video production
```

---

# 53. Implementation Milestones

## Milestone 0 — Foundation

Implement:

```text
Vite

React

TypeScript

Three.js / R3F

Rapier

half court

basket

rim

basketball

camera presets
```

### Done When

A physics basketball can be shot toward the hoop.

---

# 54. Milestone 1 — Character Runtime

Implement:

```text
generic humanoid

sprite character

kinematic controller

WASD movement

8-direction sprite facing

locomotion

character collision
```

### Done When

Both humanoid and sprite characters can move around the court.

---

# 55. Milestone 2 — Ball Possession

Implement:

```text
possession

auto dribble

pass

lob

catch

shot

shot timing

release into physics simulation
```

---

# 56. Milestone 3 — Play Schema

Implement:

```text
JSON Schema

YAML parser

semantic court locations

actors

setup

actions

conditions

events

play graph
```

Initial semantic actions:

```text
move

wait

pass

shoot

screen

roll
```

---

# 57. Milestone 4 — Designer

Implement:

```text
select player

drag

Shift + drag

Option + drag

Bezier editing

timeline

play

pause

seek

YAML editor

undo

redo
```

---

# 58. Milestone 5 — High Pick & Roll Vertical Slice

Implement first complete basketball play.

Add defensive AI:

```text
on-ball man

drop

go-over

under

switch

hedge
```

This milestone validates the architecture.

---

# 59. Milestone 6 — Guided Practice

Implement:

```text
controlled actor selection

ghost path

timing cue

AI teammates

adaptive waiting

practice feedback
```

---

# 60. Milestone 7 — Read & React

Implement:

```text
coverage randomization

branching play graph

decision evaluation

defensive reads
```

---

# 61. Milestone 8 — Demo Play Library

Implement:

```text
Elevator Doors

Backdoor Cut

DHO

Floppy

Horns

Spain PnR

Alley-Oop
```

---

# 62. Suggested Repository Structure

```text
src/

  app/

  editor/
    components/
    timeline/
    inspectors/
    yaml/

  domain/

    play/
      schema/
      compiler/
      graph/

    actions/

    conditions/

    events/

    court/

  simulation/

    runtime/

    ai/

      offense/

      defense/

    characters/

    ball/

    physics/

    decision/

  rendering/

    three/

    court/

    cameras/

    characters/

      gltf/

      sprite/

  assets/

  persistence/

  samples/

    high-pnr.yaml

    elevator.yaml

    floppy.yaml

  tests/
```

---

# 63. Recommended Runtime Interfaces

Example:

```ts
interface CharacterController {
  id: string;

  getPosition(): Vec3;

  getVelocity(): Vec3;

  setDesiredMovement(
    movement: DesiredMovement
  ): void;

  setFacing(
    direction: Vec3
  ): void;

  setAction(
    action: CharacterAction
  ): void;
}
```

Renderer abstraction:

```ts
interface CharacterRenderer {
  update(
    state: CharacterRenderState
  ): void;

  dispose(): void;
}
```

---

# 64. Important Design Principle

Character appearance must be independent of basketball behavior.

Example:

```text
High PnR
```

can be played by:

```text
Generic Guard + Generic Center
```

or:

```text
Custom Human + Custom Sprite
```

or:

```text
Two Cartoon Characters
```

without rewriting the play.

---

# 65. Animation Is Presentation

Animation quality must never become a prerequisite for simulation correctness.

For example, an MVP screen may visually be:

```text
rotate character

plant feet

enter screen pose

hold pose
```

while the actual engine already correctly models:

```text
screen angle

screen location

collision

defender navigation

handler path

screen event
```

This is acceptable.

A mechanically correct but visually rough screen is better than a beautiful animation with incorrect basketball logic.

---

# 66. Claude Code Implementation Rules

Claude Code must follow these constraints:

```text
Do not put simulation state into React component state.

Do not use Three.js objects as domain objects.

Do not hardcode plays into renderer code.

Do not build the play system as a linear animation timeline.

Do not let defensive AI inspect future play nodes.

Do not make character assets responsible for basketball semantics.

Do not make specific proprietary characters required for testing.

Do not use variable-delta physics.

Do not implement multiplayer during MVP.

Do not implement cloud persistence during MVP.

Do not optimize graphics before the High PnR vertical slice works.
```

---

# 67. First Development Target

The first development target is intentionally small.

Build:

```text
one half court

one hoop

one physics basketball

one generic humanoid

one sprite character

WASD movement

camera controls

shot physics
```

Do **not** implement Pick-and-Roll yet.

Success criteria:

> A user can open the web app, control either a humanoid or sprite character on a half court, pick up a basketball, move while automatically dribbling, and shoot the ball using physics.

Only after this foundation works should development proceed to:

```text
Play Schema
→ High PnR
→ Designer
→ Practice
→ Read & React
```

---

# 68. Product North Star

The system should eventually make this possible:

```yaml
play: elevator-doors

shooter: chiikawa

ball_handler: lebron

screeners:
  - hachiware
  - usagi

defense:
  coverage: reactive
```

and allow the user to:

1. Watch the play execute.
2. Edit the paths visually.
3. Replace any character.
4. Control the shooter manually.
5. Run the play again.
6. Have the defense react differently.
7. Learn how timing and spacing affect the result.

That is the core product.

---

# 69. Product Summary

> **A programmable 3D basketball play designer and interactive tactics simulator for the web, combining visual editing, structured play definitions, basketball-aware simulation, physics, custom characters, guided practice, and reactive defensive reads.**

The first priority is:

> **Basketball correctness and editability.**

The second priority is:

> **Interactive learning.**

The third priority is:

> **Visual quality and character customization.**

Everything else is secondary.