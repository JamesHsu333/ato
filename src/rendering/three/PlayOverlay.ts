import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  BoxGeometry,
  type Texture,
} from 'three';
import type { Vec2 } from '../../domain/math/vec';
import type { Simulation } from '../../simulation/runtime/simulation';

export interface Assists {
  ghostRoute: boolean;
  targetSpot: boolean;
  screenCue: boolean;
  timingCue: boolean;
  passingWindow: boolean;
  readHint: boolean;
}

export const ALL_ASSISTS: Assists = { ghostRoute: true, targetSpot: true, screenCue: true, timingCue: true, passingWindow: true, readHint: true };

const LABEL: Record<string, string> = {
  screen: 'SCREEN',
  roll: 'ROLL',
  pop: 'POP',
  drive: 'DRIVE',
  move: 'MOVE',
  pass: 'PASS',
  shoot: 'SHOOT',
};

const Y = 0.018;

/** Flat ribbon along a polyline with an arrowhead; u runs along the length (meters). */
export function ribbon(points: Vec2[], width: number, arrow: boolean): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let u = 0;
  const n = points.length;
  const headLen = arrow ? Math.min(0.55, width * 3) : 0;
  // Trim the body so the arrowhead sits at the end.
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  const bodyLen = Math.max(0, total - headLen);
  let acc = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) acc += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    if (acc > bodyLen && i > 0) break;
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const nx = -dz * (width / 2), nz = dx * (width / 2);
    u = acc;
    pos.push(points[i].x + nx, Y, points[i].z + nz, points[i].x - nx, Y, points[i].z - nz);
    uv.push(u, 0, u, 1);
    if (last > 0 || i > 0) {
      const k = pos.length / 3 - 4;
      if (k >= 0) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    last = i;
  }
  if (arrow && n >= 2) {
    const end = points[n - 1];
    const prev = points[Math.max(0, n - 3)];
    let dx = end.x - prev.x, dz = end.z - prev.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const base = { x: end.x - dx * headLen, z: end.z - dz * headLen };
    const hw = width * 1.6;
    const k = pos.length / 3;
    pos.push(base.x - dz * hw, Y, base.z + dx * hw, base.x + dz * hw, Y, base.z - dx * hw, end.x, Y, end.z);
    uv.push(u, 0, u, 1, u + headLen, 0.5);
    idx.push(k, k + 1, k + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Chevron stripes that scroll along the route to show direction of travel. */
function chevronTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(0, 0, 64, 32);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  g.moveTo(10, 0);
  g.lineTo(34, 16);
  g.lineTo(10, 32);
  g.lineTo(24, 32);
  g.lineTo(48, 16);
  g.lineTo(24, 0);
  g.closePath();
  g.fill();
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

const labelCache = new Map<string, Texture>();
function labelTexture(text: string, color: string, bg: string): Texture {
  const key = `${text}|${color}|${bg}`;
  let t = labelCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = '700 44px ui-sans-serif, system-ui, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w;
  c.height = 64;
  g.font = '700 44px ui-sans-serif, system-ui, sans-serif';
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(0, 4, w, 56, 14);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 18, 34);
  t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  labelCache.set(key, t);
  return t;
}

export class Label {
  readonly sprite = new Sprite(new SpriteMaterial({ depthTest: false, transparent: true }));
  private text = '';
  constructor() {
    this.sprite.renderOrder = 10;
  }
  set(text: string, color: string, bg: string, height = 0.32): void {
    const key = `${text}|${color}|${bg}`;
    if (key !== this.text) {
      const tex = labelTexture(text, color, bg);
      this.sprite.material.map = tex;
      this.sprite.material.needsUpdate = true;
      const img = tex.image as HTMLCanvasElement;
      this.sprite.scale.set((height * img.width) / img.height, height, 1);
      this.text = key;
    }
    this.sprite.visible = true;
  }
}

interface RouteView {
  mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  ring: Mesh;
  label: Label;
  key: string;
}

/**
 * Tactical overlay: routes, cues and passing windows (spec §35 assists).
 * Reads simulation state; never writes to it.
 */
export class PlayOverlay {
  readonly object = new Group();
  private routes = new Map<string, RouteView>();
  private readonly chevrons = chevronTexture();
  private readonly ringGeo = new RingGeometry(0.3, 0.42, 40);
  private screenBars: Mesh[] = [];
  private screenLabel = new Label();
  private cue = new Label();
  private passRings = new Map<string, { ring: Mesh; label: Label }>();
  private t = 0;

  constructor() {
    this.object.add(this.screenLabel.sprite, this.cue.sprite);
  }

  private route(id: string): RouteView {
    let r = this.routes.get(id);
    if (!r) {
      const mat = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide, map: this.chevrons.clone() });
      mat.map!.wrapS = RepeatWrapping;
      const mesh = new Mesh(new BufferGeometry(), mat);
      mesh.renderOrder = 2;
      const ring = new Mesh(this.ringGeo, new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      const label = new Label();
      this.object.add(mesh, ring, label.sprite);
      r = { mesh, ring, label, key: '' };
      this.routes.set(id, r);
    }
    return r;
  }

  update(sim: Simulation, assists: Assists, dt: number, showAiRoutes: boolean): void {
    this.t += dt;
    const me = sim.controlled;
    const seen = new Set<string>();
    for (const c of sim.chars) {
      if (c.state.team !== 'offense') continue;
      const mine = c.id === me;
      if (mine ? !assists.ghostRoute : !showAiRoutes) continue;
      const r = sim.routeFor(c.id);
      if (!r || r.path.length < 2) continue;
      const pts = r.path.slice(Math.max(0, r.progress - 1));
      if (pts.length < 2) continue;
      // Start the ribbon at the player's feet so it reads as "from here".
      pts[0] = { x: c.state.position.x, z: c.state.position.z };
      seen.add(c.id);
      const v = this.route(c.id);
      const color = mine ? (r.waiting ? '#7fd8ea' : '#33e1ff') : '#ffd23f';
      const width = mine ? 0.26 : 0.13;
      v.mesh.geometry.dispose();
      v.mesh.geometry = ribbon(pts, width, true);
      v.mesh.material.color.set(color);
      v.mesh.material.opacity = mine ? (r.waiting ? 0.5 : 0.9) : 0.55;
      v.mesh.material.map!.repeat.set(1 / 0.6, 1);
      if (!r.waiting) v.mesh.material.map!.offset.x -= dt * (mine ? 2.2 : 1.4);
      v.mesh.visible = true;

      const end = pts[pts.length - 1];
      v.ring.visible = mine ? assists.targetSpot : true;
      v.ring.position.set(end.x, Y + 0.002, end.z);
      (v.ring.material as MeshBasicMaterial).color.set(color);
      (v.ring.material as MeshBasicMaterial).opacity = mine ? 0.6 + 0.3 * Math.sin(this.t * 6) : 0.5;
      v.ring.scale.setScalar(mine ? 1 + 0.12 * Math.sin(this.t * 6) : 0.7);

      const text = LABEL[r.semantic] ?? r.semantic.toUpperCase();
      v.label.set(mine ? `YOU · ${text}` : text, mine ? '#06232b' : '#2a2200', mine ? '#33e1ff' : '#ffd23f', mine ? 0.36 : 0.3);
      v.label.sprite.position.set(end.x, 0.45, end.z);
      v.label.sprite.visible = mine ? assists.targetSpot : true;
    }
    for (const [id, v] of this.routes) {
      if (seen.has(id)) continue;
      v.mesh.visible = false;
      v.ring.visible = false;
      v.label.sprite.visible = false;
    }

    // Screen cue: a wall across the screener showing the screen plane.
    const active = assists.screenCue ? sim.screens.filter((s) => !s.released) : [];
    while (this.screenBars.length < active.length) {
      const bar = new Mesh(new BoxGeometry(1.15, 0.05, 0.14), new MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.85, depthWrite: false }));
      bar.renderOrder = 3;
      this.screenBars.push(bar);
      this.object.add(bar);
    }
    this.screenBars.forEach((bar, i) => {
      const scr = active[i];
      bar.visible = !!scr;
      if (!scr) return;
      const sc = sim.character(scr.screener)!.state.position;
      bar.position.set(sc.x, 0.03, sc.z);
      // Bar runs across the defender's chase path (perpendicular to the user's direction through).
      bar.rotation.y = Math.atan2(scr.normal.x, scr.normal.z) + Math.PI / 2;
    });
    if (active[0] && assists.screenCue) {
      const sc = sim.character(active[0].screener)!.state;
      this.screenLabel.set(active[0].connected ? 'SCREEN ✓' : 'SCREEN', '#2a1200', '#ff9a4a', 0.26);
      this.screenLabel.sprite.position.set(sc.position.x, sc.height + 0.45, sc.position.z);
    } else this.screenLabel.sprite.visible = false;

    // Timing cue over the user's head.
    const meC = me ? sim.character(me) : undefined;
    const myRoute = me ? sim.routeFor(me) : null;
    if (meC && assists.timingCue && myRoute) {
      const waiting = myRoute.waiting;
      this.cue.set(waiting ? 'WAIT' : 'GO', waiting ? '#2b1d00' : '#022b16', waiting ? '#ffb020' : '#3ddc84', 0.36);
      this.cue.sprite.position.set(meC.state.position.x, meC.state.height + 0.32, meC.state.position.z);
      this.cue.sprite.visible = waiting || Math.sin(this.t * 8) > -0.3;
    } else this.cue.sprite.visible = false;

    // Passing windows: open lanes green, covered red, with the pass key.
    const windows = assists.passingWindow ? sim.passWindows() : [];
    const seenPass = new Set<string>();
    for (const w of windows) {
      let pr = this.passRings.get(w.id);
      if (!pr) {
        const ring = new Mesh(new RingGeometry(0.5, 0.6, 40), new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        const label = new Label();
        this.object.add(ring, label.sprite);
        pr = { ring, label };
        this.passRings.set(w.id, pr);
      }
      const c = sim.character(w.id)!.state;
      seenPass.add(w.id);
      pr.ring.visible = true;
      pr.ring.position.set(c.position.x, Y, c.position.z);
      (pr.ring.material as MeshBasicMaterial).color.set(w.open ? '#3ddc84' : '#ef6461');
      (pr.ring.material as MeshBasicMaterial).opacity = 0.75;
      pr.label.set(String(w.slot), '#ffffff', w.open ? 'rgba(20,120,70,0.9)' : 'rgba(160,40,40,0.9)', 0.3);
      pr.label.sprite.position.set(c.position.x, c.height + 0.4, c.position.z);
    }
    for (const [id, pr] of this.passRings) {
      if (seenPass.has(id)) continue;
      pr.ring.visible = false;
      pr.label.sprite.visible = false;
    }
  }

  dispose(): void {
    for (const v of this.routes.values()) {
      v.mesh.geometry.dispose();
      v.mesh.material.map?.dispose();
      v.mesh.material.dispose();
    }
    this.ringGeo.dispose();
    this.chevrons.dispose();
  }
}
