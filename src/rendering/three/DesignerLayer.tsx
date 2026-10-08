import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Vec2 } from '../../domain/math/vec';
import { addMove, moveActorStart, setActionTarget, setActionWaypoints } from '../../domain/play/edit/edits';
import { applyEdit, setTime } from '../../app/designer/designerController';
import { useDesigner } from '../../app/designer/designerStore';
import type { Session } from '../../app/session';
import { useUi } from '../../app/store';
import { Label, ribbon } from './PlayOverlay';

type Gesture =
  | { kind: 'actor'; actor: string; moved: boolean }
  | { kind: 'move'; actor: string; from: Vec2; curved: boolean; bend: Vec2 | null; samples: Vec2[] }
  | { kind: 'waypoint'; index: number }
  | { kind: 'bend' }
  | { kind: 'target' };

const TEAM_COLOR = { offense: '#4d8dff', defense: '#ff5a4d' } as const;
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Designer canvas layer (spec §26, §28): direct manipulation on the court plus the
 * edit overlay. Every gesture becomes a pure edit on the PlayDefinition.
 */
export function DesignerLayer({ session }: { session: Session }) {
  const { scene } = useThree();
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const root = useMemo(() => new Group(), []);
  const gesture = useRef<Gesture | null>(null);
  const pointer = useRef<Vec2>({ x: 0, z: 0 });
  const views = useMemo(() => new DesignerOverlay(), []);

  useEffect(() => {
    scene.add(root);
    root.add(views.object);
    return () => {
      scene.remove(root);
      views.dispose();
    };
  }, [scene, root, views]);

  useFrame(() => {
    if (useUi.getState().mode !== 'designer') {
      views.object.visible = false;
      return;
    }
    views.object.visible = true;
    views.update(session, gesture.current, pointer.current);
  });

  const selectedPath = (): Vec2[] | null => {
    const d = useDesigner.getState();
    if (!d.selectedAction || !d.recording) return null;
    const rp = d.recording.paths.find((p) => p.node === d.selectedAction!.node && p.actionIndex === d.selectedAction!.index);
    return rp?.path ?? null;
  };
  const selectedWaypoints = (): Vec2[] => {
    const d = useDesigner.getState();
    const a = d.selectedAction && d.play?.graph[d.selectedAction.node]?.actions?.[d.selectedAction.index];
    return a && a.path?.mode === 'override' ? (a.path.points ?? []).map(([x, z]) => ({ x, z })) : [];
  };

  const floor = (e: ThreeEvent<PointerEvent>): Vec2 => ({ x: e.point.x, z: e.point.z });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (useUi.getState().mode !== 'designer' || e.button !== 0) return;
    const p = floor(e);
    pointer.current = p;
    const d = useDesigner.getState();
    if (!d.play) return;
    e.stopPropagation();

    // Route handles of the selected action first.
    const path = selectedPath();
    if (path && d.selectedAction) {
      const wps = selectedWaypoints();
      const wi = wps.findIndex((w) => dist(w, p) < 0.35);
      if (wi >= 0) {
        if (e.nativeEvent.altKey) {
          // Alt-click deletes a waypoint.
          applyEdit(session, setActionWaypoints(d.play, d.selectedAction.node, d.selectedAction.index, wps.filter((_, i) => i !== wi)));
          return;
        }
        begin({ kind: 'waypoint', index: wi });
        return;
      }
      if (dist(path[path.length - 1], p) < 0.4) return begin({ kind: 'target' });
      if (!wps.length && dist(path[Math.floor(path.length / 2)], p) < 0.35) return begin({ kind: 'bend' });
    }

    // Players: positions as currently shown.
    const hit = session.sim.chars
      .map((c) => ({ id: c.id, d: dist({ x: c.state.position.x, z: c.state.position.z }, p) }))
      .filter((h) => h.d < 0.6)
      .sort((a, b) => a.d - b.d)[0];
    if (hit) {
      useDesigner.setState({ selectedActor: hit.id, selectedAction: null });
      if (e.nativeEvent.shiftKey || e.nativeEvent.altKey) {
        const c = session.sim.character(hit.id)!.state.position;
        begin({ kind: 'move', actor: hit.id, from: { x: c.x, z: c.z }, curved: e.nativeEvent.altKey, bend: null, samples: [] });
      } else {
        if (d.time > 0) setTime(session, 0); // starting positions are edited at t = 0
        begin({ kind: 'actor', actor: hit.id, moved: false });
      }
      return;
    }
    useDesigner.setState({ selectedActor: null, selectedAction: null });
  };

  const begin = (g: Gesture) => {
    gesture.current = g;
    if (controls) controls.enabled = false;
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (useUi.getState().mode !== 'designer') return;
    const p = floor(e);
    pointer.current = p;
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'actor') {
      g.moved = true;
      // Live preview: move the body in the paused sim (presentation only until commit).
      const c = session.sim.character(g.actor);
      if (c) {
        c.state.position.x = p.x;
        c.state.position.z = p.z;
      }
    }
    if (g.kind === 'move' && g.curved) {
      // The bend is the point of the drawn stroke farthest from the straight line start → pointer.
      g.samples.push(p);
      const dx = p.x - g.from.x, dz = p.z - g.from.z;
      const l = Math.hypot(dx, dz) || 1;
      let best: Vec2 | null = null;
      let bestOff = 0.25;
      for (const q of g.samples) {
        const off = Math.abs((q.x - g.from.x) * dz - (q.z - g.from.z) * dx) / l;
        if (off > bestOff) {
          bestOff = off;
          best = q;
        }
      }
      g.bend = best;
    }
  };

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const g = gesture.current;
    gesture.current = null;
    if (controls) controls.enabled = true;
    if (!g || useUi.getState().mode !== 'designer') return;
    const p = floor(e);
    const d = useDesigner.getState();
    if (!d.play) return;
    switch (g.kind) {
      case 'actor':
        if (g.moved) applyEdit(session, moveActorStart(d.play, g.actor, p));
        break;
      case 'move': {
        if (dist(g.from, p) < 0.5) break;
        const node = d.selectedNode in d.play.graph ? d.selectedNode : Object.keys(d.play.graph)[0];
        const next = addMove(d.play, node, g.actor, p, g.curved ? (g.bend ?? undefined) : undefined);
        if (applyEdit(session, next)) {
          const index = (next.graph[node].actions ?? []).length - 1;
          useDesigner.setState({ selectedAction: { node, index }, selectedActor: g.actor });
        }
        break;
      }
      case 'waypoint':
      case 'bend': {
        const wps = selectedWaypoints();
        const pts = g.kind === 'bend' ? [p] : wps.map((w, i) => (i === g.index ? p : w));
        applyEdit(session, setActionWaypoints(d.play, d.selectedAction!.node, d.selectedAction!.index, pts), { keepTime: true });
        break;
      }
      case 'target':
        applyEdit(session, setActionTarget(d.play, d.selectedAction!.node, d.selectedAction!.index, p), { keepTime: true });
        break;
    }
  };

  // Double-click on the selected route adds a waypoint there (spec §26).
  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    const d = useDesigner.getState();
    const path = selectedPath();
    if (useUi.getState().mode !== 'designer' || !path || !d.play || !d.selectedAction) return;
    const p = { x: e.point.x, z: e.point.z };
    let best = 0;
    path.forEach((q, i) => {
      if (dist(q, p) < dist(path[best], p)) best = i;
    });
    if (dist(path[best], p) > 0.6) return;
    const wps = selectedWaypoints();
    // Keep waypoints ordered along the route.
    const order = (w: Vec2) => path.reduce((bi, q, i) => (dist(q, w) < dist(path[bi], w) ? i : bi), 0);
    const pts = [...wps, p].sort((a, b) => order(a) - order(b));
    applyEdit(session, setActionWaypoints(d.play, d.selectedAction.node, d.selectedAction.index, pts), { keepTime: true });
  };

  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.003} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDouble}>
      <planeGeometry args={[40, 40]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** Imperative edit overlay: recorded trails, routes, handles, name tags, gesture preview. */
class DesignerOverlay {
  readonly object = new Group();
  private trails = new Map<string, Line>();
  private routes: Mesh[] = [];
  private handles: Mesh[] = [];
  private tags = new Map<string, Label>();
  private preview = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: '#33e1ff', transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide }));
  private selRing = new Mesh(new RingGeometry(0.5, 0.62, 40), new MeshBasicMaterial({ color: '#33e1ff', transparent: true, opacity: 0.9, side: DoubleSide }));
  private lastRecording: unknown = null;
  private readonly sphere = new SphereGeometry(0.11, 16, 12);
  private readonly box = new BoxGeometry(0.26, 0.06, 0.26);

  constructor() {
    this.selRing.rotation.x = -Math.PI / 2;
    this.object.add(this.preview, this.selRing);
  }

  update(session: Session, g: Gesture | null, pointer: Vec2): void {
    const d = useDesigner.getState();
    const rec = d.recording;

    // Recorded trails (what actually happened in the deterministic run).
    if (rec !== this.lastRecording) {
      this.lastRecording = rec;
      for (const l of this.trails.values()) {
        this.object.remove(l);
        l.geometry.dispose();
      }
      this.trails.clear();
      for (const [id, pts] of Object.entries(rec?.trails ?? {})) {
        const team = session.sim.character(id)?.state.team ?? 'offense';
        const line = new Line(
          new BufferGeometry().setFromPoints(pts.map((p) => new Vector3(p.x, 0.012, p.z))),
          new LineBasicMaterial({ color: TEAM_COLOR[team], transparent: true, opacity: 0.45 }),
        );
        this.trails.set(id, line);
        this.object.add(line);
      }
    }

    // Planned routes (default or overridden paths), selected action highlighted.
    for (const m of this.routes) {
      this.object.remove(m);
      m.geometry.dispose();
    }
    this.routes = [];
    for (const rp of rec?.paths ?? []) {
      const isSel = d.selectedAction?.node === rp.node && d.selectedAction.index === rp.actionIndex;
      const isActor = rp.actor === d.selectedActor;
      if (!isSel && !isActor && d.selectedActor) continue;
      const m = new Mesh(
        ribbon(rp.path, isSel ? 0.2 : 0.1, true),
        new MeshBasicMaterial({ color: isSel ? '#33e1ff' : '#ffd23f', transparent: true, opacity: isSel ? 0.85 : 0.5, depthWrite: false, side: DoubleSide }),
      );
      this.routes.push(m);
      this.object.add(m);
    }

    // Handles for the selected route: waypoints (white), bend (grey), target (cyan).
    for (const h of this.handles) this.object.remove(h);
    this.handles = [];
    const sel = d.selectedAction;
    const rp = sel ? rec?.paths.find((p) => p.node === sel.node && p.actionIndex === sel.index) : undefined;
    const action = sel ? d.play?.graph[sel.node]?.actions?.[sel.index] : undefined;
    if (rp && action) {
      const wps = action.path?.mode === 'override' ? (action.path.points ?? []) : [];
      const add = (geo: SphereGeometry | BoxGeometry, color: string, p: Vec2) => {
        const h = new Mesh(geo, new MeshBasicMaterial({ color }));
        h.position.set(p.x, 0.12, p.z);
        this.handles.push(h);
        this.object.add(h);
      };
      for (const [x, z] of wps) add(this.sphere, '#ffffff', { x, z });
      if (!wps.length) add(this.sphere, '#9aa3b2', rp.path[Math.floor(rp.path.length / 2)]);
      add(this.box, '#33e1ff', rp.path[rp.path.length - 1]);
    }

    // Selection ring and name tags.
    const selC = d.selectedActor ? session.sim.character(d.selectedActor) : undefined;
    this.selRing.visible = !!selC;
    if (selC) this.selRing.position.set(selC.state.position.x, 0.02, selC.state.position.z);
    for (const c of session.sim.chars) {
      let tag = this.tags.get(c.id);
      if (!tag) {
        tag = new Label();
        this.tags.set(c.id, tag);
        this.object.add(tag.sprite);
      }
      const role = d.play?.actors[c.id]?.role;
      tag.set(c.id + (role === 'ball_handler' ? ' ●' : ''), '#ffffff', c.state.team === 'offense' ? 'rgba(40,90,190,0.85)' : 'rgba(180,50,45,0.85)', 0.24);
      tag.sprite.position.set(c.state.position.x, c.state.height + 0.3, c.state.position.z);
    }
    for (const [id, tag] of this.tags) if (!session.sim.character(id)) tag.sprite.visible = false;

    // Gesture preview (shift/option drag).
    this.preview.visible = !!g && g.kind === 'move';
    if (g && g.kind === 'move') {
      const pts = g.curved && g.bend ? [g.from, g.bend, pointer] : [g.from, pointer];
      this.preview.geometry.dispose();
      this.preview.geometry = ribbon(pts.length === 3 ? smooth(pts) : pts, 0.16, true);
    }
  }

  dispose(): void {
    this.sphere.dispose();
    this.box.dispose();
  }
}

/** Quadratic curve through a bend point, for the curved-drag preview. */
function smooth([a, b, c]: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const u = 1 - t;
    // Control point chosen so the curve passes through b at t = 0.5.
    const cx = 2 * b.x - (a.x + c.x) / 2;
    const cz = 2 * b.z - (a.z + c.z) / 2;
    out.push({ x: u * u * a.x + 2 * u * t * cx + t * t * c.x, z: u * u * a.z + 2 * u * t * cz + t * t * c.z });
  }
  return out;
}

