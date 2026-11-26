/** The product city in three dimensions, as pure data and math: no DOM, no
 * WebGL. An area is a district on a plate, a capability is a building on it,
 * every record of the capability is one storey of that building, and every
 * scenario of the record is one window of its storey, coloured by the
 * scenario's state. Zoomed out beyond the whole product, a district becomes
 * one block whose height counts its records and whose colour is its proven
 * share. */

import { STOREY_COLOURS, UNMEASURED_COLOUR, storeyColour, type StoreyLens } from "./storeyLens";
import type { DomainView, FeatureView, ScenarioState } from "./model";

export type Vec3 = [number, number, number];

export type District3D = {
  index: number;
  id: string;
  title: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Indices into `World.buildings`. */
  buildings: number[];
  records: number;
  scenarios: number;
  proven: number;
  /** Height of the block that stands for the district when seen from far: its tallest building. */
  height: number;
};

export type Building3D = {
  index: number;
  /** `<domain>/<capability>`. */
  key: string;
  domain: string;
  capability: string;
  title: string;
  district: number;
  cx: number;
  cz: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Height of the roof: the plate plus one unit per floor. */
  top: number;
  /** Indices into `World.floors`, from the ground up. */
  floors: number[];
  scenarios: number;
  proven: number;
};

/** What a floor is built of: a running record, a planned one, a retired one. */
export type FloorKind = "active" | "planned" | "deprecated";

export type Floor3D = {
  index: number;
  feature: FeatureView;
  building: number;
  district: number;
  level: number;
  kind: FloorKind;
  /** One state per scenario, in the record's order: the storey's windows. */
  windows: ScenarioState[];
  lensColour: number | null;
};

/** The order windows are drawn in along a storey, left to right. */
export const WINDOW_ORDER: readonly ScenarioState[] = ["proven", "unbacked", "open"];

/** The windows of a record's storey: one per scenario, in the record's order.
 * The per-scenario states win; without them the counts say how many are
 * proven, and the rest are open. */

export function windowsOf(f: FeatureView): ScenarioState[] {
  if (f.scenarioStates && f.scenarioStates.length === f.scenarios) return [...f.scenarioStates];
  if (f.mosaic && f.mosaic.length === f.scenarios)
    return f.mosaic.map((p) => (p ? "proven" : "open"));
  const proven = Math.max(0, Math.min(f.proven, f.scenarios));
  return Array.from({ length: f.scenarios }, (_, i) => (i < proven ? "proven" : "open"));
}

/** How many windows of each state a storey (or several) has. */
export function countStates(windows: ScenarioState[]): Record<ScenarioState, number> {
  const out: Record<ScenarioState, number> = { proven: 0, unbacked: 0, open: 0 };
  for (const w of windows) out[w] += 1;
  return out;
}

/** The windows as the shader draws them: grouped by state, in `WINDOW_ORDER`. */
export function drawnWindows(windows: ScenarioState[]): ScenarioState[] {
  const c = countStates(windows);
  return WINDOW_ORDER.flatMap((s) => Array.from({ length: c[s] }, () => s));
}

export type World = {
  districts: District3D[];
  buildings: Building3D[];
  floors: Floor3D[];
  /** Extent of all districts on the ground, centred on the origin. */
  width: number;
  depth: number;
  /** The tallest roof. */
  height: number;
};

/** Height of the plates the buildings stand on. */
export const PLATE = 0.15;
/** One building lot: the grid a district lays its buildings on. */
const LOT = 6;
const DISTRICT_GAP = 8;
const BLOCK_INSET = 1.5;

/** A small deterministic hash of a string, so a building keeps its shape. */
export function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Two numbers in [0, 1) derived from a string, for a building's footprint. */
function twoOf(text: string): [number, number] {
  const h = hashOf(text);
  const g = hashOf(`${text}#`);
  return [(h % 1000) / 1000, (g % 1000) / 1000];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Columns and rows of the lot grid of a district with `count` capabilities. */
export function lotGrid(count: number): [number, number] {
  const cols = clamp(Math.ceil(Math.sqrt(count * 1.4)), 2, 6);
  return [cols, Math.max(1, Math.ceil(count / cols))];
}

function kindOf(f: FeatureView): FloorKind {
  return f.lifecycle === "planned"
    ? "planned"
    : f.lifecycle === "deprecated"
      ? "deprecated"
      : "active";
}

/** Lays the registry out as a city. Districts sit in a near-square grid of
 * equal cells, each district as large as its capabilities need; a capability
 * stands in the middle of its lot with a footprint that varies a little by
 * name, and its records are stacked on it in the order they come. */

// @facet: registry/coverage/product-city
// @facet-role: related
export function buildWorld(
  domains: DomainView[],
  features: FeatureView[],
  lens: StoreyLens = "tests",
): World {
  const districts: District3D[] = [];
  const buildings: Building3D[] = [];
  const floors: Floor3D[] = [];
  const grids = domains.map((d) => lotGrid(d.capabilities.length));
  const cellW = Math.max(8, ...grids.map(([c]) => c * LOT + 2));
  const cellD = Math.max(8, ...grids.map(([, r]) => r * LOT + 2));
  const perRow = Math.max(1, Math.ceil(Math.sqrt(domains.length * 1.5)));
  const rows = Math.max(1, Math.ceil(domains.length / perRow));
  const width = perRow * (cellW + DISTRICT_GAP) - DISTRICT_GAP;
  const depth = rows * (cellD + DISTRICT_GAP) - DISTRICT_GAP;

  domains.forEach((d, di) => {
    const [cols, lotRows] = grids[di];
    const ox = (di % perRow) * (cellW + DISTRICT_GAP) - width / 2;
    const oz = Math.floor(di / perRow) * (cellD + DISTRICT_GAP) - depth / 2;
    const district: District3D = {
      index: di,
      id: d.id,
      title: d.title,
      x0: ox,
      z0: oz,
      x1: ox + cols * LOT + 2,
      z1: oz + lotRows * LOT + 2,
      buildings: [],
      records: 0,
      scenarios: 0,
      proven: 0,
      height: PLATE,
    };
    d.capabilities.forEach((c, ci) => {
      const key = `${d.id}/${c.id}`;
      const [a, b] = twoOf(key);
      const w = 3.6 + a * 1.3;
      const dp = 3.6 + b * 1.3;
      const cx = ox + 1 + (ci % cols) * LOT + LOT / 2;
      const cz = oz + 1 + Math.floor(ci / cols) * LOT + LOT / 2;
      const building: Building3D = {
        index: buildings.length,
        key,
        domain: d.id,
        capability: c.id,
        title: c.title,
        district: di,
        cx,
        cz,
        x0: cx - w / 2,
        x1: cx + w / 2,
        z0: cz - dp / 2,
        z1: cz + dp / 2,
        top: PLATE,
        floors: [],
        scenarios: 0,
        proven: 0,
      };
      for (const f of features) {
        if (f.domain !== d.id || f.capability !== c.id) continue;
        const floor: Floor3D = {
          index: floors.length,
          feature: f,
          building: building.index,
          district: di,
          level: building.floors.length,
          kind: kindOf(f),
          windows: lens === "tests" ? windowsOf(f) : [],
          lensColour: lens === "tests" ? null : storeyColour(f, lens),
        };
        floors.push(floor);
        building.floors.push(floor.index);
        building.scenarios += f.scenarios;
        building.proven += Math.min(f.proven, f.scenarios);
      }
      building.top = PLATE + building.floors.length;
      buildings.push(building);
      district.buildings.push(building.index);
      district.records += building.floors.length;
      district.scenarios += building.scenarios;
      district.proven += building.proven;
    });
    districts.push(district);
  });
  // From far a district is as tall as its tallest building, so zooming out
  // does not shrink or grow the skyline.
  for (const d of districts)
    d.height = Math.max(PLATE, ...d.buildings.map((i) => buildings[i].top));
  const height = Math.max(PLATE, ...buildings.map((b) => b.top));
  return { districts, buildings, floors, width, depth, height };
}

/** Proven share of a district or building, 0 when it has no scenario. */
export function shareOf(x: { scenarios: number; proven: number }): number {
  return x.scenarios ? x.proven / x.scenarios : 0;
}

/** Camera -------------------------------------------------------------------------------------- */

/** An orbit camera: it looks at a target from a distance, turned and tilted. */
export type Camera = {
  tx: number;
  ty: number;
  tz: number;
  /** Turn about the vertical axis, in radians. */
  yaw: number;
  /** Tilt above the ground, in radians. */
  pitch: number;
  dist: number;
};

export const VIEW = {
  yaw: -0.7,
  pitch: 0.86,
  /** Half the vertical field of view, in radians. */
  half: 0.35,
  near: 0.5,
  far: 2000,
  minDist: 10,
  maxDist: 1000,
  minPitch: 0.14,
  maxPitch: 1.45,
  /** Radians per pixel of drag. */
  turnPerPx: 0.006,
  tiltPerPx: 0.005,
  /** World units per pixel of pan, per unit of distance. */
  panPerPx: 0.0016,
  /** Districts become blocks this far beyond the view of the whole product, tallest tower included. */
  farBeyond: 1.3,
  /** Nearer than this, a click chooses a storey instead of a building. */
  nearTo: 60,
} as const;

export type Level = "far" | "mid" | "near";

/** The height up to which the home view keeps the city in frame; a taller tower may leave it at the top. */
export const FIT_HEIGHT = 12;

/** The distance at which the whole product fits a view of this aspect, seen
 * from the home angle, with a margin of `margin` of the view on each side.
 * By default only the first `FIT_HEIGHT` units of height count: one tower of a
 * hundred storeys must not shrink the rest of the city out of reading. */

export function fitDistance(
  world: World,
  aspect: number,
  margin = 0.06,
  upTo: number = FIT_HEIGHT,
): number {
  const xs = [-world.width / 2, world.width / 2];
  const zs = [-world.depth / 2, world.depth / 2];
  const ys = [0, Math.min(world.height, upTo)];
  const corners: Vec3[] = [];
  for (const x of xs) for (const y of ys) for (const z of zs) corners.push([x, y, z]);
  const lim = 1 - margin * 2;
  const fits = (dist: number) => {
    const m = viewProjection(
      { tx: 0, ty: 0, tz: 0, yaw: VIEW.yaw, pitch: VIEW.pitch, dist },
      aspect,
    );
    return corners.every((p) => {
      const q = project(m, p, 2, 2);
      return !!q && Math.abs(q[0] - 1) <= lim && Math.abs(q[1] - 1) <= lim;
    });
  };
  let lo: number = VIEW.minDist;
  let hi: number = VIEW.maxDist;
  if (fits(lo)) return lo;
  if (!fits(hi)) return hi;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The distance of the home view: the whole product fits, and never so close
 * that a small product starts at the storeys instead of its buildings. */

export function homeDistance(world: World, aspect: number): number {
  return Math.max(fitDistance(world, aspect), VIEW.nearTo * 1.1);
}

export function homeCamera(dist: number): Camera {
  return { tx: 0, ty: 0, tz: 0, yaw: VIEW.yaw, pitch: VIEW.pitch, dist };
}

/** Where the districts become blocks: beyond the home view, and beyond the view
 * that holds the whole product with its tallest tower, so every storey can be
 * seen before the storeys give way to blocks. */

export function farDistance(world: World, aspect: number): number {
  return (
    Math.max(homeDistance(world, aspect), fitDistance(world, aspect, 0.06, Infinity)) *
    VIEW.farBeyond
  );
}

/** The level of detail at a distance, for a product whose blocks begin at `farAt`. */
export function levelOf(dist: number, farAt: number): Level {
  if (dist < VIEW.nearTo) return "near";
  return dist > farAt ? "far" : "mid";
}

export function eyeOf(c: Camera): Vec3 {
  const flat = Math.cos(c.pitch) * c.dist;
  return [
    c.tx + flat * Math.sin(c.yaw),
    c.ty + c.dist * Math.sin(c.pitch),
    c.tz + flat * Math.cos(c.yaw),
  ];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The camera's own axes: right, up, and back (from the target to the eye). */
export function axesOf(c: Camera) {
  const eye = eyeOf(c);
  const back = unit([eye[0] - c.tx, eye[1] - c.ty, eye[2] - c.tz]);
  const right = unit(cross([0, 1, 0], back));
  const up = cross(back, right);
  return { eye, right, up, back };
}

/** View and projection in one column-major 4 × 4 matrix. */
export function viewProjection(c: Camera, aspect: number): Float32Array {
  const { eye, right, up, back } = axesOf(c);
  const f = 1 / Math.tan(VIEW.half);
  const { near: n, far: fa } = VIEW;
  // Rows of the view matrix.
  const view = [
    [right[0], right[1], right[2], -dot(right, eye)],
    [up[0], up[1], up[2], -dot(up, eye)],
    [back[0], back[1], back[2], -dot(back, eye)],
    [0, 0, 0, 1],
  ];
  const proj = [
    [f / aspect, 0, 0, 0],
    [0, f, 0, 0],
    [0, 0, (fa + n) / (n - fa), (2 * fa * n) / (n - fa)],
    [0, 0, -1, 0],
  ];
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r += 1)
    for (let col = 0; col < 4; col += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += proj[r][k] * view[k][col];
      out[col * 4 + r] = s;
    }
  return out;
}

/** A world point on the screen, in pixels of a `w` × `h` view, or null when it
 * lies behind the camera. */

export function project(m: Float32Array, p: Vec3, w: number, h: number): [number, number] | null {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const q = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (q <= 0.2) return null;
  return [((x / q) * 0.5 + 0.5) * w, (1 - ((y / q) * 0.5 + 0.5)) * h];
}

export type Ray = { origin: Vec3; dir: Vec3 };

/** The ray through a point of the view; `nx`, `ny` run from −1 to 1, y up. */
export function rayAt(c: Camera, nx: number, ny: number, aspect: number): Ray {
  const { eye, right, up, back } = axesOf(c);
  const t = Math.tan(VIEW.half);
  const dir = unit(
    [0, 1, 2].map((i) => -back[i] + nx * t * aspect * right[i] + ny * t * up[i]) as Vec3,
  );
  return { origin: eye, dir };
}

/** Distance along the ray to an axis-aligned box, or null when it misses. */
export function hitBox(ray: Ray, lo: Vec3, hi: Vec3): number | null {
  let near = -Infinity;
  let far = Infinity;
  for (let i = 0; i < 3; i += 1) {
    const d = ray.dir[i];
    if (Math.abs(d) < 1e-12) {
      if (ray.origin[i] < lo[i] || ray.origin[i] > hi[i]) return null;
      continue;
    }
    let a = (lo[i] - ray.origin[i]) / d;
    let b = (hi[i] - ray.origin[i]) / d;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
  }
  if (far < Math.max(near, 0)) return null;
  return Math.max(near, 0);
}

/** Where the ray meets the ground, or null when it points away from it. */
export function groundAt(ray: Ray): Vec3 | null {
  if (ray.dir[1] >= -1e-9) return null;
  const t = -ray.origin[1] / ray.dir[1];
  return [ray.origin[0] + ray.dir[0] * t, 0, ray.origin[2] + ray.dir[2] * t];
}

/** The target may wander only a little beyond the city. */
function keepTarget(c: Camera, world: World): Camera {
  const bx = world.width / 2 + 20;
  const bz = world.depth / 2 + 20;
  return { ...c, tx: clamp(c.tx, -bx, bx), tz: clamp(c.tz, -bz, bz) };
}

/** Zooms by `factor` (above 1 is closer) towards a point of the view: the
 * ground point under it stays under it, as long as the distance limits allow. */

export function zoomAt(
  c: Camera,
  factor: number,
  nx: number,
  ny: number,
  aspect: number,
  world: World,
): Camera {
  const dist = clamp(c.dist / factor, VIEW.minDist, VIEW.maxDist);
  const before = groundAt(rayAt(c, nx, ny, aspect));
  const moved = { ...c, dist };
  if (!before) return moved;
  const after = groundAt(rayAt(moved, nx, ny, aspect));
  if (!after) return moved;
  return keepTarget(
    { ...moved, tx: c.tx + before[0] - after[0], tz: c.tz + before[2] - after[2] },
    world,
  );
}

/** Turns and tilts by a drag of `dx`, `dy` pixels; the tilt stays in its range. */
export function orbit(c: Camera, dx: number, dy: number): Camera {
  return {
    ...c,
    yaw: c.yaw - dx * VIEW.turnPerPx,
    pitch: clamp(c.pitch + dy * VIEW.tiltPerPx, VIEW.minPitch, VIEW.maxPitch),
  };
}

/** Moves the target along the ground, as if the drag pulled the ground along. */
export function pan(c: Camera, dx: number, dy: number, world: World): Camera {
  const k = c.dist * VIEW.panPerPx;
  const s = Math.sin(c.yaw);
  const co = Math.cos(c.yaw);
  return keepTarget(
    { ...c, tx: c.tx + (-co * dx - s * dy) * k, tz: c.tz + (s * dx - co * dy) * k },
    world,
  );
}

/** The camera on its way from `a` to `b`; the turn takes the shorter way round. */
export function between(a: Camera, b: Camera, t: number): Camera {
  const e = t * t * (3 - 2 * t);
  const mix = (x: number, y: number) => x + (y - x) * e;
  const turn = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
  return {
    tx: mix(a.tx, b.tx),
    ty: mix(a.ty, b.ty),
    tz: mix(a.tz, b.tz),
    yaw: a.yaw + turn * e,
    pitch: mix(a.pitch, b.pitch),
    dist: mix(a.dist, b.dist),
  };
}

/** Places ------------------------------------------------------------------------------------- */

export type Place =
  | { kind: "district"; index: number }
  | { kind: "building"; index: number }
  | { kind: "floor"; index: number };

/** The path of a place: `domain`, `domain/capability` or the record's id. */
export function pathOf(world: World, p: Place | null): string {
  if (!p) return "";
  if (p.kind === "district") return world.districts[p.index].id;
  if (p.kind === "building") return world.buildings[p.index].key;
  return world.floors[p.index].feature.id;
}

/** What a click at a point of the view chooses. From far a district; nearer a
 * building; close up the floor that was hit. */

export function pick(
  world: World,
  c: Camera,
  farAt: number,
  nx: number,
  ny: number,
  aspect: number,
): Place | null {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  const ray = rayAt(c, nx, ny, aspect);
  const level = levelOf(c.dist, farAt);
  let best: { t: number; i: number } | null = null;
  if (level === "far") {
    for (const d of world.districts) {
      const t = hitBox(ray, [d.x0, 0, d.z0], [d.x1, d.height, d.z1]);
      if (t !== null && (!best || t < best.t)) best = { t, i: d.index };
    }
    return best ? { kind: "district", index: best.i } : null;
  }
  for (const b of world.buildings) {
    if (!b.floors.length) continue;
    const t = hitBox(ray, [b.x0, PLATE, b.z0], [b.x1, b.top, b.z1]);
    if (t !== null && (!best || t < best.t)) best = { t, i: b.index };
  }
  if (!best) return null;
  const b = world.buildings[best.i];
  if (level !== "near") return { kind: "building", index: b.index };
  const y = ray.origin[1] + ray.dir[1] * best.t;
  const level0 = clamp(Math.floor(y - PLATE), 0, b.floors.length - 1);
  return { kind: "floor", index: b.floors[level0] };
}

/** Where the camera goes to look at a place. A building is always seen from
 * close enough that its floors can be chosen next. */

export function viewOfPlace(world: World, p: Place): Partial<Camera> {
  if (p.kind === "district") {
    const d = world.districts[p.index];
    return { tx: (d.x0 + d.x1) / 2, ty: 0, tz: (d.z0 + d.z1) / 2, dist: 82, pitch: 0.8 };
  }
  const b = world.buildings[p.kind === "building" ? p.index : world.floors[p.index].building];
  if (p.kind === "building") {
    const h = b.floors.length;
    return {
      tx: b.cx,
      ty: h * 0.45,
      tz: b.cz,
      dist: Math.min(VIEW.nearTo - 2, 26 + h * 0.9),
      pitch: 0.55,
    };
  }
  return { tx: b.cx, ty: 0.65 + world.floors[p.index].level, tz: b.cz, dist: 17, pitch: 0.3 };
}

/** The place the camera looks at most directly, for Enter. */
export function placeAtCentre(world: World, c: Camera, farAt: number): Place | null {
  const far = levelOf(c.dist, farAt) === "far";
  const away = (x: number, z: number) => Math.hypot(x - c.tx, z - c.tz);
  if (far) {
    const d = [...world.districts].sort(
      (a, b) =>
        away((a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2) - away((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2),
    )[0];
    return d ? { kind: "district", index: d.index } : null;
  }
  const b = world.buildings
    .filter((x) => x.floors.length)
    .sort((a, b2) => away(a.cx, a.cz) - away(b2.cx, b2.cz))[0];
  return b ? { kind: "building", index: b.index } : null;
}

/** Mesh ---------------------------------------------------------------------------------------- */

/** What a surface is; the shader colours by it. */
export const SURFACE = {
  ground: 0,
  plate: 1,
  block: 2,
  floor: 3,
  planned: 4,
  deprecated: 5,
  kerb: 6,
} as const;

/** How far the plate of a district stands in from its kerb. */
const KERB = 0.4;

/** Floats per vertex: position 3, normal 3, uv 2, place 4, look 4. */
export const STRIDE = 16;

/** The triangles of the city. Each vertex carries its place (building, floor,
 * district) and its look (surface, scenarios, proven, share), so selection and
 * windows are decided in the shader without another buffer. A negative
 * scenario count encodes the storey palette index in a count lens. */

export function meshOf(world: World, far: boolean): Float32Array {
  const out: number[] = [];
  const corners: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const face = (q: Vec3[], n: Vec3, place: number[], look: number[]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(...q[i], ...n, ...corners[i], ...place, ...look);
  };
  const box = (lo: Vec3, hi: Vec3, place: number[], look: number[], roof: boolean) => {
    const [x0, y0, z0] = lo;
    const [x1, y1, z1] = hi;
    // Four sides, each wound so that u runs left to right seen from outside.
    face(
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 0, 1],
      place,
      look,
    );
    face(
      [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
      ],
      [0, 0, -1],
      place,
      look,
    );
    face(
      [
        [x1, y0, z1],
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
      ],
      [1, 0, 0],
      place,
      look,
    );
    face(
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
      [-1, 0, 0],
      place,
      look,
    );
    if (roof)
      face(
        [
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ],
        [0, 1, 0],
        place,
        look,
      );
  };
  const gx = world.width / 2 + 80;
  const gz = world.depth / 2 + 80;
  face(
    [
      [-gx, -0.02, gz],
      [gx, -0.02, gz],
      [gx, -0.02, -gz],
      [-gx, -0.02, -gz],
    ],
    [0, 1, 0],
    [-1, -1, -1, 0],
    [SURFACE.ground, 0, 0, 0],
  );
  // A district is a lot: a kerb around it in the line colour, and a lighter
  // plate on it that stands a little higher.
  for (const d of world.districts) {
    box(
      [d.x0, -0.02, d.z0],
      [d.x1, PLATE, d.z1],
      [-1, -1, d.index, 0],
      [SURFACE.kerb, 0, 0, 0],
      true,
    );
    box(
      [d.x0 + KERB, -0.02, d.z0 + KERB],
      [d.x1 - KERB, PLATE + 0.04, d.z1 - KERB],
      [-1, -1, d.index, 0],
      [SURFACE.plate, 0, 0, 0],
      true,
    );
  }
  if (far) {
    const bands = new Map<number, number>();
    for (const f of world.floors) {
      if (f.lensColour == null) continue;
      const district = f.district;
      const previous = bands.get(district);
      // An unmeasured storey gives the block its colour only if no storey is measured.
      if (
        previous == null ||
        (f.lensColour !== UNMEASURED_COLOUR &&
          (previous === UNMEASURED_COLOUR || f.lensColour > previous))
      ) {
        bands.set(district, f.lensColour);
      }
    }
    for (const d of world.districts) {
      if (!d.records) continue;
      const band = bands.get(d.index);
      box(
        [d.x0 + BLOCK_INSET, PLATE, d.z0 + BLOCK_INSET],
        [d.x1 - BLOCK_INSET, d.height, d.z1 - BLOCK_INSET],
        [-1, -1, d.index, 0],
        [SURFACE.block, band == null ? d.scenarios : -1 - band, d.proven, shareOf(d)],
        true,
      );
    }
  } else {
    for (const b of world.buildings) {
      b.floors.forEach((fi, level) => {
        const f = world.floors[fi];
        const y0 = PLATE + level;
        const surface =
          f.kind === "planned"
            ? SURFACE.planned
            : f.kind === "deprecated"
              ? SURFACE.deprecated
              : SURFACE.floor;
        const c = countStates(f.windows);
        box(
          [b.x0, y0, b.z0],
          [b.x1, y0 + 1, b.z1],
          [b.index, fi, b.district, level],
          [
            surface,
            f.lensColour == null ? f.windows.length : -1 - f.lensColour,
            c.proven,
            c.unbacked,
          ],
          level === b.floors.length - 1,
        );
      });
    }
  }
  return new Float32Array(out);
}

/** Windows on the screen ----------------------------------------------------------------------- */

/** The four sides of a box, with the direction their windows run along. */
const SIDES: {
  normal: Vec3;
  start: (b: Building3D) => [number, number];
  along: [number, number];
}[] = [
  { normal: [0, 0, 1], start: (b) => [b.x0, b.z1], along: [1, 0] },
  { normal: [0, 0, -1], start: (b) => [b.x1, b.z0], along: [-1, 0] },
  { normal: [1, 0, 0], start: (b) => [b.x1, b.z1], along: [0, -1] },
  { normal: [-1, 0, 0], start: (b) => [b.x0, b.z0], along: [0, 1] },
];

export type WindowSpot = { state: ScenarioState; point: Vec3; visible: boolean };

/** The centres of a storey's windows on the side that faces the camera most,
 * in drawn order, each with whether nothing else stands in front of it. */

export function windowSpots(world: World, c: Camera, floor: number): WindowSpot[] {
  const f = world.floors[floor];
  const b = world.buildings[f.building];
  const eye = eyeOf(c);
  const centre: Vec3 = [b.cx, PLATE + f.level + 0.5, b.cz];
  const toEye: Vec3 = [eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2]];
  const side = [...SIDES].sort((p, q) => dot(q.normal, toEye) - dot(p.normal, toEye))[0];
  const [sx, sz] = side.start(b);
  const length = side.along[0] ? b.x1 - b.x0 : b.z1 - b.z0;
  const drawn = drawnWindows(f.windows);
  const lift = 0.002;
  return drawn.map((state, i) => {
    const u = ((i + 0.5) / drawn.length) * length;
    const point: Vec3 = [
      sx + side.along[0] * u + side.normal[0] * lift,
      centre[1],
      sz + side.along[1] * u + side.normal[2] * lift,
    ];
    const dir = unit([point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]]);
    const ray = { origin: eye, dir };
    const own = hitBox(ray, [b.x0, PLATE, b.z0], [b.x1, b.top, b.z1]);
    let visible = own !== null && dot(side.normal, toEye) > 0;
    if (visible) {
      for (const o of world.buildings) {
        if (o.index === b.index || !o.floors.length) continue;
        const t = hitBox(ray, [o.x0, PLATE, o.z0], [o.x1, o.top, o.z1]);
        if (t !== null && t < (own as number) - 1e-6) {
          visible = false;
          break;
        }
      }
    }
    return { state, point, visible };
  });
}

/** Colours ------------------------------------------------------------------------------------- */

export type Rgb = [number, number, number];

/** A CSS colour as 0..1 floats; a translucent one is laid over `under`. Reads
 * hex (3, 4, 6 or 8 digits) and rgb()/rgba(); null for anything else. */

export function parseColour(text: string, under: Rgb = [0, 0, 0]): Rgb | null {
  const s = text.trim();
  let rgba: number[] | null = null;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) rgba = [...h].map((ch) => parseInt(ch + ch, 16) / 255);
    else if (h.length === 6 || h.length === 8)
      rgba = (h.match(/../g) ?? []).map((pair) => parseInt(pair, 16) / 255);
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    const nums = parts.map((p, i) =>
      p.endsWith("%") ? parseFloat(p) / 100 : i < 3 ? parseFloat(p) / 255 : parseFloat(p),
    );
    if (nums.length >= 3 && nums.every((n) => Number.isFinite(n))) rgba = nums;
  }
  if (!rgba || rgba.length < 3) return null;
  const a = rgba.length > 3 ? rgba[3] : 1;
  return [0, 1, 2].map((i) => rgba![i] * a + under[i] * (1 - a)) as Rgb;
}

export type Palette = {
  bg: Rgb;
  ground: Rgb;
  dot: Rgb;
  plate: Rgb;
  kerb: Rgb;
  body: Rgb;
  roof: Rgb;
  ok: Rgb;
  plan: Rgb;
  warn: Rgb;
  signal: Rgb;
  rest: Rgb;
  storeys: Rgb[];
  dark: boolean;
};

const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb =>
  [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k) as Rgb;

/** The scene's colours from the FACET tokens of the surrounding theme, so the
 * city follows every theme and mode. `token` returns a custom property's text. */

export function paletteOf(token: (name: string) => string): Palette {
  const grey: Rgb = [0.5, 0.5, 0.5];
  const bg = parseColour(token("--t-ground-2")) ?? [0.06, 0.07, 0.1];
  const read = (name: string, under: Rgb = bg) => parseColour(token(name), under) ?? grey;
  const surface = read("--t-surface");
  const float = read("--t-float");
  const sunken = read("--t-sunken");
  const dark = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] < 0.5;
  const body = dark ? float : surface;
  return {
    bg,
    ground: dark ? mixRgb(bg, surface, 0.35) : mixRgb(bg, sunken, 0.5),
    dot: read("--t-line-strong", bg),
    plate: dark ? mixRgb(surface, float, 0.5) : surface,
    kerb: read("--t-line-strong"),
    body,
    roof: dark ? read("--t-line-strong", float) : mixRgb(surface, sunken, 0.35),
    ok: read("--t-ok"),
    plan: read("--t-plan"),
    warn: read("--t-warn"),
    signal: read("--t-signal"),
    rest: read("--t-muted"),
    storeys: STOREY_COLOURS.map((name) => read(name)),
    dark,
  };
}

/** The colour a window of this state is drawn in, as 0..255 channels. */
export function windowColour(p: Palette, state: ScenarioState): [number, number, number] {
  const c = state === "proven" ? p.ok : state === "unbacked" ? p.rest : p.warn;
  return c.map((v) => Math.round(v * 255)) as [number, number, number];
}

/** Labels -------------------------------------------------------------------------------------- */

/** Where a name hangs: `x` is the middle of its foundation on the screen, `y`
 * the foundation's lowest edge there, where the name's top edge is fixed. */

export type Spot = { index: number; x: number; y: number };

/** Where the names hang on the screen. Every name is fixed to the foot of what
 * it names, under the lowest edge of its foundation as the camera sees it, so
 * it moves with the city and never stands over a building. A name is never
 * moved aside to make room: where it would cover another name or the map's
 * controls, or where its building's foot is hidden behind another building,
 * it is left out.
 *
 * Which names show depends on the camera's distance and turn, never on where
 * the view is centred, so panning neither adds nor removes a name inside the
 * picture. A building is named once its foundation is about as wide on the
 * screen as its title, so zooming in names more; the chosen building is
 * always named, and so is the chosen district. Districts are named at every
 * level and placed first, then buildings, each front to back. */

// @facet: registry/coverage/product-city
// @facet-role: related
export function labelsOf(
  world: World,
  c: Camera,
  farAt: number,
  w: number,
  h: number,
  chosen: { district: number; building: number },
  style: "tag" | "pin" | "map" = "tag",
): { districts: Spot[]; buildings: Spot[] } {
  const m = viewProjection(c, w / h);
  const level = levelOf(c.dist, farAt);
  const { back, right: side, eye } = axesOf(c);
  /** Pixels per world unit at the distance of the camera's target. */
  const scale = h / (2 * c.dist * Math.tan(VIEW.half));
  const controls: Box[] = [
    { x0: Math.max(0, w - 190), x1: w, y0: Math.max(0, h - 170), y1: h },
    { x0: Math.max(0, w - 340), x1: w, y0: 0, y1: 64 },
  ];
  const foot = (x0: number, z0: number, x1: number, z1: number, yAt: number) => {
    const corners: Vec3[] = [
      [x0, yAt, z0],
      [x1, yAt, z0],
      [x0, yAt, z1],
      [x1, yAt, z1],
    ];
    const ps = corners.map((p) => project(m, p, w, h));
    if (ps.some((p) => !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
    const xs = ps.map((p) => p![0]);
    const ys = ps.map((p) => p![1]);
    const lowest = Math.max(...ys);
    // The middle of the outline and its lowest point both move smoothly while
    // the city turns; the lowest corner itself would jump from one to the next.
    const x = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    const y = Math.round(lowest);
    if (x < 0 || x > w || y < 0 || y > h) return null;
    return { x, y, front: corners[ys.indexOf(lowest)] };
  };
  const taken: Box[] = [];
  // A name that would reach past the canvas is left out rather than cut.
  const fits = (box: Box) =>
    box.x0 >= 0 &&
    box.x1 <= w &&
    box.y1 <= h - 6 &&
    !controls.some((control) => overlaps(control, box)) &&
    !taken.some((t) => overlaps(t, box));
  // Front to back. The depth along the view does not change when the camera
  // pans or zooms, so neither does which of two covering names stays.
  const depth = (x: number, z: number) => -(x * back[0] + z * back[2]);
  const districts: Spot[] = [];
  [...world.districts]
    .sort(
      (a, b) =>
        Number(b.index === chosen.district) - Number(a.index === chosen.district) ||
        depth((a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2) - depth((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) ||
        a.index - b.index,
    )
    .forEach((d) => {
      const f = foot(d.x0, d.z0, d.x1, d.z1, 0);
      if (!f) return;
      const box = nameBox(f.x, f.y, d.title.length + 4);
      if (d.index !== chosen.district && !fits(box)) return;
      taken.push(box);
      districts.push({ index: d.index, x: f.x, y: f.y });
    });
  districts.sort((a, b) => a.index - b.index);
  /** Whether another building stands between the eye and this point of it. */
  const hidden = (b: Building3D, front: Vec3) => {
    const to: Vec3 = [front[0] - eye[0], front[1] - eye[1], front[2] - eye[2]];
    const far = Math.hypot(to[0], to[1], to[2]);
    const ray = { origin: eye, dir: unit(to) };
    return world.buildings.some((o) => {
      if (o.index === b.index || !o.floors.length) return false;
      const t = hitBox(ray, [o.x0, PLATE, o.z0], [o.x1, o.top, o.z1]);
      return t !== null && t < far - 1e-6;
    });
  };
  const buildings: Spot[] = [];
  if (level !== "far") {
    world.buildings
      .filter((b) => b.floors.length)
      .sort(
        (a, b) =>
          Number(b.index === chosen.building) - Number(a.index === chosen.building) ||
          depth(a.cx, a.cz) - depth(b.cx, b.cz) ||
          a.index - b.index,
      )
      .forEach((b) => {
        const mine = b.index === chosen.building;
        // The foundation's width as seen at the distance of the camera's
        // target, not where it happens to stand: in perspective a building
        // grows towards the front of the view, and panning would then name it.
        const across =
          ((b.x1 - b.x0) * Math.abs(side[0]) + (b.z1 - b.z0) * Math.abs(side[2])) * scale;
        if (!mine && across < titleWidth(b.title) * NAME_FITS) return;
        // A pin stands on the middle of the roof; the other styles hang from the foot.
        const roof: Vec3 = [b.cx, b.top + 0.01, b.cz];
        const r = style === "pin" ? project(m, roof, w, h) : null;
        const f =
          style === "pin"
            ? r &&
              Number.isFinite(r[0]) &&
              Number.isFinite(r[1]) &&
              r[0] >= 0 &&
              r[0] <= w &&
              r[1] >= 0 &&
              r[1] <= h
              ? { x: Math.round(r[0]), y: Math.round(r[1]), front: roof }
              : null
            : foot(b.x0, b.z0, b.x1, b.z1, PLATE);
        if (!f) return;
        const box =
          style === "pin"
            ? pinBox(f.x, f.y, b.title.length + 10)
            : nameBox(f.x, f.y, b.title.length + 10);
        if (
          !mine &&
          (!fits(box) ||
            hidden(b, style === "pin" ? f.front : [f.front[0], PLATE + 0.2, f.front[2]]))
        )
          return;
        taken.push(box);
        buildings.push({ index: b.index, x: f.x, y: f.y });
      });
  }
  return { districts, buildings };
}

/** The height of one line of a name on the screen, in pixels. */
const NAME_LINE = 24;
/** The widest a name is drawn, in pixels; a longer one wraps to a second line. */
const NAME_WIDTH = 200;
/** How wide a foundation must be on the screen, as a share of its title's
 * width, before its building is named. */

export const NAME_FITS = 1;

/** The width a title takes on the screen, about 7 px per character plus padding. */
function titleWidth(title: string) {
  return Math.min(NAME_WIDTH, title.length * 7 + 18);
}

type Box = { x0: number; x1: number; y0: number; y1: number };

/** The room a name takes on the screen: centred on its spot and hanging from
 * it below a short stem, about 7 px per character plus padding, at most
 * 200 px wide and then two lines high, as the label is drawn. */

export function nameBox(x: number, top: number, chars: number): Box {
  const want = chars * 7 + 18;
  const width = Math.min(NAME_WIDTH, want);
  const lines = want > NAME_WIDTH ? 2 : 1;
  return { x0: x - width / 2, x1: x + width / 2, y0: top, y1: top + NAME_LINE * lines + 6 };
}

/** How far a pin's name stands above the roof it names, in pixels. */
export const PIN_STEM = 28;

/** The room a pin's name takes: centred over its roof point, above a stem. */
export function pinBox(x: number, roof: number, chars: number): Box {
  const under = nameBox(x, 0, chars);
  const height = under.y1 - under.y0;
  return { x0: under.x0, x1: under.x1, y0: roof - PIN_STEM - height, y1: roof };
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The storey a test can find again: the running record whose windows show the
 * most different states, then the one with about six windows, wide enough to
 * read each. Null when no record has a scenario. */

export function probeFloor(world: World): number | null {
  let best: { i: number; kinds: number; off: number } | null = null;
  for (const f of world.floors) {
    if (!f.windows.length || f.kind !== "active") continue;
    const kinds = new Set(f.windows).size;
    const off = Math.abs(f.windows.length - 6);
    if (!best || kinds > best.kinds || (kinds === best.kinds && off < best.off))
      best = { i: f.index, kinds, off };
  }
  return best ? best.i : null;
}
