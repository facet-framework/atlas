import { StrictMode } from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderInEnglish as render, renderInEnglish as renderEnglish } from "../testing";
import { City3D } from "./City3D";
import { ProductPage } from "./ProductPage";
import { DOMAINS, FEATURES } from "./data.spec-support";
import type { DomainView, FeatureView } from "./model";
import {
  FIT_HEIGHT,
  PLATE,
  VIEW,
  between,
  buildWorld,
  countStates,
  farDistance,
  drawnWindows,
  fitDistance,
  groundAt,
  hitBox,
  homeCamera,
  homeDistance,
  labelsOf,
  levelOf,
  lotGrid,
  meshOf,
  orbit,
  paletteOf,
  pan,
  parseColour,
  pathOf,
  pick,
  placeAtCentre,
  probeFloor,
  project,
  rayAt,
  STRIDE,
  viewOfPlace,
  viewProjection,
  windowColour,
  windowSpots,
  windowsOf,
  zoomAt,
  type Camera,
} from "./scene3d";

/** A WebGL context that draws nothing and remembers what it was asked. ------------------------- */

function fakeGl() {
  const calls: string[] = [];
  const lose = jest.fn();
  const fixed: Record<string, unknown> = {
    getProgramParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    isContextLost: () => false,
    getExtension: () => ({ loseContext: lose }),
  };
  const gl = new Proxy(
    {},
    {
      get(_, key: string) {
        if (key in fixed) return fixed[key];
        if (/^[A-Z_0-9]+$/.test(key)) return 0;
        return (...args: unknown[]) => {
          calls.push(key);
          void args;
          return {};
        };
      },
    },
  );
  return { gl, calls, lose };
}

function withGl() {
  const fake = fakeGl();
  const spy = jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(() => fake.gl as unknown as RenderingContext);
  return { ...fake, spy };
}

/** Lets the frame that was asked for run. */
async function frame() {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}

/** Gives the canvas the size a browser would give it. */
function size(canvas: HTMLCanvasElement, w = 800, h = 400) {
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: w });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: h });
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0 }) as DOMRect;
}

afterEach(() => jest.restoreAllMocks());

/** jsdom has no PointerEvent, and the generic event it falls back to carries no
 * coordinates. A browser's pointer event is a mouse event with an id and a type. */

beforeAll(() => {
  if (!window.PointerEvent) {
    class Pointer extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    window.PointerEvent = Pointer as unknown as typeof PointerEvent;
  }
});

/** A small city with known scenario states. --------------------------------------------------- */

const D: DomainView[] = [
  {
    id: "shop",
    title: "Shop",
    purpose: "",
    cls: "core",
    team: "t",
    capabilities: [
      { id: "cart", title: "Cart", purpose: "", cls: "core" },
      { id: "pay", title: "Payment", purpose: "", cls: "core" },
    ],
  },
  {
    id: "ops",
    title: "Operations",
    purpose: "",
    cls: "support",
    team: "t",
    capabilities: [{ id: "log", title: "Logging", purpose: "", cls: "support" }],
  },
];

const feature = (id: string, extra: Partial<FeatureView>): FeatureView => {
  const [domain, capability] = id.split("/");
  return {
    id,
    slug: id.split("/")[2],
    domain,
    capability,
    summary: "",
    type: "feature",
    lifecycle: "active",
    owner: null,
    createdAt: "2026-11-01",
    scenarios: 0,
    proven: 0,
    anchors: 0,
    tests: 0,
    drift: 0,
    knowledgeOpen: 0,
    ...extra,
  };
};

const F: FeatureView[] = [
  feature("shop/cart/add", {
    scenarios: 4,
    proven: 2,
    scenarioStates: ["proven", "open", "unbacked", "proven"],
  }),
  feature("shop/cart/remove", { scenarios: 2, proven: 2, mosaic: [true, true] }),
  feature("shop/pay/card", { scenarios: 3, proven: 1, lifecycle: "planned" }),
  feature("ops/log/ship", { scenarios: 1, proven: 0, lifecycle: "deprecated" }),
];

const W = buildWorld(D, F);

describe("the 3D city as data", () => {
  it("gives a record one window per scenario, coloured by the scenario's state", () => {
    // Per-scenario states win, in the record's order.
    expect(windowsOf(F[0])).toEqual(["proven", "open", "unbacked", "proven"]);
    // Proven flags are the next best source.
    expect(windowsOf(F[1])).toEqual(["proven", "proven"]);
    // Only counts: the proven ones first, the rest open.
    expect(windowsOf(F[2])).toEqual(["proven", "open", "open"]);
    // A list of the wrong length is not trusted.
    expect(windowsOf({ ...F[0], scenarioStates: ["proven"] })).toEqual([
      "proven",
      "proven",
      "open",
      "open",
    ]);
    expect(countStates(windowsOf(F[0]))).toEqual({ proven: 2, unbacked: 1, open: 1 });
    // Drawn along the storey grouped by state: proven, unbacked, open.
    expect(drawnWindows(windowsOf(F[0]))).toEqual(["proven", "proven", "unbacked", "open"]);
    const p = paletteOf(
      (name) =>
        ({
          "--t-ground-2": "#ffffff",
          "--t-ok": "#1f8a5b",
          "--t-warn": "#c4501c",
          "--t-muted": "#6b7386",
        })[name] ?? "",
    );
    expect(windowColour(p, "proven")).toEqual([31, 138, 91]);
    expect(windowColour(p, "open")).toEqual([196, 80, 28]);
    expect(windowColour(p, "unbacked")).toEqual([107, 115, 134]);
  });

  it("makes an area a district, a capability a building and a record a storey", () => {
    expect(W.districts.map((d) => d.id)).toEqual(["shop", "ops"]);
    expect(W.buildings.map((b) => b.key)).toEqual(["shop/cart", "shop/pay", "ops/log"]);
    const cart = W.buildings[0];
    expect(cart.floors.map((i) => W.floors[i].feature.id)).toEqual([
      "shop/cart/add",
      "shop/cart/remove",
    ]);
    expect(cart.floors.map((i) => W.floors[i].level)).toEqual([0, 1]);
    expect(cart.top).toBeCloseTo(PLATE + 2);
    expect(W.floors.map((f) => f.kind)).toEqual(["active", "active", "planned", "deprecated"]);
    expect(W.districts[0]).toMatchObject({ records: 3, scenarios: 9, proven: 5 });
    // Buildings stand inside their district and keep their footprint by name.
    for (const b of W.buildings) {
      const d = W.districts[b.district];
      expect(b.x0).toBeGreaterThanOrEqual(d.x0);
      expect(b.x1).toBeLessThanOrEqual(d.x1);
      expect(b.x1 - b.x0).toBeGreaterThanOrEqual(3.6);
      expect(b.x1 - b.x0).toBeLessThanOrEqual(4.9);
    }
    expect(buildWorld(D, F).buildings[1]).toEqual(W.buildings[1]);
    expect(lotGrid(1)).toEqual([2, 1]);
    expect(lotGrid(30)).toEqual([6, 5]);
    expect(pathOf(W, null)).toBe("");
    expect(pathOf(W, { kind: "district", index: 1 })).toBe("ops");
    expect(pathOf(W, { kind: "floor", index: 0 })).toBe("shop/cart/add");
  });

  it("builds storeys near and blocks far, sixteen floats per vertex", () => {
    const near = meshOf(W, false);
    const far = meshOf(W, true);
    expect(near.length % STRIDE).toBe(0);
    const vertices = near.length / STRIDE;
    // Ground, a kerb and a plate per district (five faces each), four sides per
    // storey, a roof per building.
    const lots = 2 * 2 * 5 * 6;
    expect(vertices).toBe(6 + lots + 4 * 4 * 6 + 3 * 6);
    // From far a district with records is one block.
    expect(far.length / STRIDE).toBe(6 + lots + 2 * 5 * 6);
    // The kerb comes first and is drawn as a kerb, the plate on it as a plate.
    expect(near[6 * STRIDE + 12]).toBe(6);
    expect(near[(6 + 30) * STRIDE + 12]).toBe(1);
    // A storey's vertices carry its windows: four, two proven, one unbacked.
    const firstStorey = (6 + lots) * STRIDE;
    expect([...near.slice(firstStorey + 12, firstStorey + 16)]).toEqual([3, 4, 2, 1]);
  });

  it("projects a known point: the target sits in the middle of the view", () => {
    const c: Camera = { tx: 5, ty: 1, tz: -3, yaw: 0.4, pitch: 0.6, dist: 40 };
    const m = viewProjection(c, 2);
    const mid = project(m, [5, 1, -3], 800, 400)!;
    expect(mid[0]).toBeCloseTo(400, 3);
    expect(mid[1]).toBeCloseTo(200, 3);
    // Up in the world is up on the screen.
    expect(project(m, [5, 4, -3], 800, 400)![1]).toBeLessThan(200);
    // Behind the camera there is nothing to draw.
    const eye = rayAt(c, 0, 0, 2).origin;
    const behind = [eye[0] * 2 - 5, eye[1] * 2 - 1, eye[2] * 2 + 3] as [number, number, number];
    expect(project(m, behind, 800, 400)).toBeNull();
  });

  it("zooms about the pointer: the ground under the cursor stays under it", () => {
    const c = homeCamera(120);
    const world = buildWorld(DOMAINS, FEATURES);
    for (const [nx, ny] of [
      [0.5, -0.3],
      [-0.7, -0.6],
      [0, 0],
    ]) {
      const before = groundAt(rayAt(c, nx, ny, 2))!;
      const z = zoomAt(c, 1.6, nx, ny, 2, world);
      expect(z.dist).toBeCloseTo(120 / 1.6);
      const after = groundAt(rayAt(z, nx, ny, 2))!;
      expect(after[0]).toBeCloseTo(before[0], 6);
      expect(after[2]).toBeCloseTo(before[2], 6);
    }
    // The limits hold.
    expect(zoomAt(c, 1000, 0, 0, 2, world).dist).toBe(VIEW.minDist);
    expect(zoomAt(c, 0.001, 0, 0, 2, world).dist).toBe(VIEW.maxDist);
    // Above the horizon there is no ground to hold on to: only the distance changes.
    const up = zoomAt({ ...c, pitch: 0.2 }, 2, 0, 0.99, 2, world);
    expect([up.tx, up.tz, up.dist]).toEqual([c.tx, c.tz, c.dist / 2]);
  });

  it("turns freely but keeps the tilt between its limits; a pan stays near the city", () => {
    const c = homeCamera(100);
    expect(orbit(c, 0, 10_000).pitch).toBe(VIEW.maxPitch);
    expect(orbit(c, 0, -10_000).pitch).toBe(VIEW.minPitch);
    expect(orbit(c, 100, 0).yaw).toBeCloseTo(c.yaw - 100 * VIEW.turnPerPx);
    const far = pan(c, 1e6, 1e6, W);
    expect(Math.abs(far.tx)).toBeLessThanOrEqual(W.width / 2 + 20);
    expect(Math.abs(far.tz)).toBeLessThanOrEqual(W.depth / 2 + 20);
    const small = pan(c, 10, 0, W);
    expect(Math.hypot(small.tx, small.tz)).toBeCloseTo(10 * c.dist * VIEW.panPerPx);
  });

  it("picks by ray: the district from far, the building, then the storey", () => {
    const cart = W.buildings[0];
    const home = 100;
    const aspect = 2;
    const aim = (c: Camera, p: [number, number, number]) => {
      const q = project(viewProjection(c, aspect), p, 2, 2)!;
      return [q[0] - 1, 1 - q[1]] as [number, number];
    };
    const mid = homeCamera(home);
    const [mx, my] = aim(mid, [cart.cx, cart.top, cart.cz]);
    expect(pick(W, mid, home, mx, my, aspect)).toEqual({ kind: "building", index: 0 });
    const far = { ...mid, dist: home * 1.5 };
    const shop = W.districts[0];
    const [fx, fy] = aim(far, [(shop.x0 + shop.x1) / 2, shop.height, (shop.z0 + shop.z1) / 2]);
    expect(pick(W, far, home, fx, fy, aspect)).toEqual({ kind: "district", index: 0 });
    const near = { ...mid, ...viewOfPlace(W, { kind: "building", index: 0 }) } as Camera;
    expect(levelOf(near.dist, home)).toBe("near");
    // The middle of the lower storey's facing side.
    const spots = windowSpots(W, near, cart.floors[0]);
    const [nx, ny] = aim(near, spots[1].point);
    expect(pick(W, near, home, nx, ny, aspect)).toEqual({ kind: "floor", index: 0 });
    // Nothing under the pointer: nothing chosen.
    expect(pick(W, mid, home, 0.99, 0.99, aspect)).toBeNull();
    expect(pick(W, far, home, 0.99, 0.99, aspect)).toBeNull();
  });

  it("hits boxes by ray, and misses beside them", () => {
    const ray = {
      origin: [0, 5, 0] as [number, number, number],
      dir: [0, -1, 0] as [number, number, number],
    };
    expect(hitBox(ray, [-1, 0, -1], [1, 2, 1])).toBeCloseTo(3);
    expect(hitBox(ray, [2, 0, 2], [3, 2, 3])).toBeNull();
    expect(hitBox({ ...ray, dir: [1, 0, 0] }, [2, 4, -1], [3, 6, 1])).toBeCloseTo(2);
    expect(hitBox({ ...ray, dir: [-1, 0, 0] }, [2, 4, -1], [3, 6, 1])).toBeNull();
    expect(groundAt({ origin: [0, 5, 0], dir: [0, 1, 0] })).toBeNull();
  });

  it("fits the whole product into the view, a tall tower only up to a storey limit", () => {
    const d = fitDistance(W, 2);
    const m = viewProjection(homeCamera(d), 2);
    for (const x of [-W.width / 2, W.width / 2])
      for (const z of [-W.depth / 2, W.depth / 2]) {
        const p = project(m, [x, 0, z], 2, 2)!;
        expect(Math.abs(p[0] - 1)).toBeLessThanOrEqual(0.9);
        expect(Math.abs(p[1] - 1)).toBeLessThanOrEqual(0.9);
      }
    const tower = buildWorld(D, [
      ...F,
      ...Array.from({ length: 200 }, (_, i) => feature(`ops/log/f${i}`, { scenarios: 1 })),
    ]);
    expect(tower.height).toBeGreaterThan(200);
    expect(fitDistance(tower, 2)).toBeLessThan(fitDistance({ ...tower, height: 400 }, 2) + 1);
    expect(FIT_HEIGHT).toBeLessThan(tower.height);
    expect(fitDistance({ ...W, width: 1e5 }, 2)).toBe(VIEW.maxDist);
    expect(fitDistance({ ...W, width: 0.01, depth: 0.01, height: 0.01 }, 2, 0.4)).toBe(
      VIEW.minDist,
    );
  });

  it("keeps the storeys until the tallest tower is in view, and the blocks as tall as the towers", () => {
    const tower = buildWorld(D, [
      ...F,
      ...Array.from({ length: 105 }, (_, i) => feature(`ops/log/f${i}`, { scenarios: 1 })),
    ]);
    const whole = fitDistance(tower, 2, 0.06, Infinity);
    // The precondition: the tower does not fit the home view.
    expect(whole).toBeGreaterThan(homeDistance(tower, 2) * VIEW.farBeyond);
    // Every storey is in view before the storeys give way to blocks.
    expect(levelOf(whole, farDistance(tower, 2))).toBe("mid");
    expect(farDistance(tower, 2)).toBeLessThan(VIEW.maxDist);
    // From far each district is as tall as its tallest building.
    for (const d of tower.districts) {
      const top = Math.max(PLATE, ...d.buildings.map((i) => tower.buildings[i].top));
      expect(d.height).toBe(top);
    }
    expect(Math.max(...tower.districts.map((d) => d.height))).toBe(tower.height);
  });

  it("never stands two names on each other", () => {
    const crowd = buildWorld(
      [
        {
          ...D[0],
          capabilities: Array.from({ length: 30 }, (_, i) => ({
            id: `c${i}`,
            title: `Capability ${i}`,
            purpose: "",
            cls: "core",
          })),
        },
      ],
      Array.from({ length: 30 }, (_, i) => feature(`${D[0].id}/c${i}/f`, { scenarios: 1 })),
    );
    const home = homeDistance(crowd, 2);
    const { buildings } = labelsOf(crowd, homeCamera(home), farDistance(crowd, 2), 800, 400, {
      district: -1,
      building: -1,
    });
    // The precondition: the crowd is more than the window can name side by side.
    expect(buildings.length).toBeGreaterThan(1);
    expect(buildings.length).toBeLessThan(30);
    const box = (s: { index: number; x: number; y: number }) => {
      const w = Math.min(200, (crowd.buildings[s.index].title.length + 10) * 7 + 18);
      // The label hangs 4 px under its spot and is 28 px high.
      return { x0: s.x - w / 2, x1: s.x + w / 2, y0: s.y + 4, y1: s.y + 32 };
    };
    const covering = buildings.flatMap((a, i) =>
      buildings.slice(i + 1).flatMap((b) => {
        const p = box(a);
        const q = box(b);
        return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1 ? [[a.index, b.index]] : [];
      }),
    );
    expect(covering).toEqual([]);
  });

  it("keeps labels apart from each other and the controls at narrow and wide sizes", () => {
    for (const [width, height] of [
      [360, 300],
      [1280, 800],
    ] as const) {
      const labels = labelsOf(W, homeCamera(homeDistance(W, 2)), farDistance(W, 2), width, height, {
        district: -1,
        building: -1,
      });
      const boxes = [
        ...labels.districts.map((spot) => {
          const chars = W.districts[spot.index].title.length + 4;
          const width = Math.min(200, chars * 7 + 18);
          return {
            x0: spot.x - width / 2,
            x1: spot.x + width / 2,
            y0: spot.y - 2,
            y1: spot.y + 26,
          };
        }),
        ...labels.buildings.map((spot) => {
          const chars = W.buildings[spot.index].title.length + 10;
          const width = Math.min(200, chars * 7 + 18);
          return {
            x0: spot.x - width / 2,
            x1: spot.x + width / 2,
            y0: spot.y + 4,
            y1: spot.y + 32,
          };
        }),
      ];
      const overlaps = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
        a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
      for (const [index, box] of boxes.entries()) {
        expect(boxes.slice(index + 1).some((other) => overlaps(box, other))).toBe(false);
        expect(
          overlaps(box, {
            x0: Math.max(0, width - 190),
            x1: width,
            y0: Math.max(0, height - 170),
            y1: height,
          }),
        ).toBe(false);
        expect(overlaps(box, { x0: Math.max(0, width - 340), x1: width, y0: 0, y1: 64 })).toBe(
          false,
        );
      }
    }
  });

  it("does not label buildings whose projected point is outside the viewport", () => {
    const home = homeDistance(W, 2);
    const camera = { ...homeCamera(home), tx: 10_000, tz: 10_000 };
    const labels = labelsOf(W, camera, farDistance(W, 2), 1280, 800, {
      district: -1,
      building: -1,
    });
    expect(labels.buildings).toEqual([]);
  });

  it("names districts and every building at the level of capabilities, then the buildings near the middle", () => {
    const home = homeDistance(W, 2);
    const farAt = farDistance(W, 2);
    // The precondition: the small city starts at its buildings, not its storeys.
    expect(home).toBeGreaterThan(fitDistance(W, 2));
    expect(levelOf(home, farAt)).toBe("mid");
    const at = (c: Camera, chosen = { district: -1, building: -1 }) =>
      labelsOf(W, c, farAt, 800, 400, chosen);
    const whole = at(homeCamera(home));
    expect(whole.districts.map((s) => s.index)).toEqual([0, 1]);
    // With room for them, every building is named.
    const wide = labelsOf(W, homeCamera(home), farAt, 1600, 800, { district: -1, building: -1 });
    const standing = W.buildings.filter((b) => b.floors.length).map((b) => b.index);
    // The precondition: more than one building to name.
    expect(standing.length).toBeGreaterThan(1);
    expect(wide.buildings.map((s) => s.index).sort()).toEqual(standing);
    const narrow = labelsOf(W, homeCamera(home), farAt, 360, 300, {
      district: -1,
      building: -1,
    });
    expect(narrow.districts).toHaveLength(W.districts.length);
    for (const label of [...narrow.districts, ...narrow.buildings]) {
      expect(label.x).toBeGreaterThanOrEqual(0);
      expect(label.x).toBeLessThanOrEqual(360);
      expect(label.y).toBeGreaterThanOrEqual(0);
      expect(label.y).toBeLessThanOrEqual(300 - 74);
    }
    const close = {
      ...homeCamera(home),
      ...viewOfPlace(W, { kind: "building", index: 0 }),
    } as Camera;
    const near = at(close, { district: 0, building: 0 });
    expect(near.districts.map((s) => s.index).sort()).toEqual(
      W.districts.map((d) => d.index).sort(),
    );
    expect(near.buildings.map((s) => s.index)).toContain(0);
    expect(at({ ...homeCamera(home), dist: farAt * 1.1 }).buildings).toEqual([]);
    expect(placeAtCentre(W, close, farAt)).toEqual({ kind: "building", index: 0 });
    expect(placeAtCentre(W, { ...close, dist: farAt * 1.1 }, farAt)?.kind).toBe("district");
    expect(placeAtCentre(buildWorld([], []), close, farAt)).toBeNull();
  });

  it("flies the short way round, and ends where it was sent", () => {
    const a = homeCamera(100);
    const b = { ...a, yaw: a.yaw + 2 * Math.PI - 0.2, dist: 50 };
    expect(between(a, b, 0)).toEqual(a);
    expect(between(a, b, 1).yaw).toBeCloseTo(a.yaw - 0.2);
    expect(between(a, b, 1).dist).toBe(50);
    expect(between(a, b, 0.5).yaw).toBeCloseTo(a.yaw - 0.1);
  });

  it("reads theme colours, laying a translucent one over the ground", () => {
    expect(parseColour("#fff")).toEqual([1, 1, 1]);
    expect(parseColour("#00000000", [1, 1, 1])).toEqual([1, 1, 1]);
    expect(parseColour("rgb(255, 0, 0)")).toEqual([1, 0, 0]);
    expect(parseColour("rgba(0, 0, 0, 0.5)", [1, 1, 1])).toEqual([0.5, 0.5, 0.5]);
    expect(parseColour("rgb(100% 0% 0%)")).toEqual([1, 0, 0]);
    expect(parseColour("oklch(0.5 0.1 200)")).toBeNull();
    expect(parseColour("#12")).toBeNull();
    const dark = paletteOf((n) => (n === "--t-ground-2" ? "#10131a" : ""));
    expect(dark.dark).toBe(true);
    const light = paletteOf((n) => (n === "--t-ground-2" ? "#eceff5" : "#ffffff"));
    expect(light.dark).toBe(false);
    expect(paletteOf(() => "").bg).toEqual([0.06, 0.07, 0.1]);
  });

  it("finds a storey whose windows show different states, for the browser to check", () => {
    expect(W.floors[probeFloor(W)!].feature.id).toBe("shop/cart/add");
    expect(probeFloor(buildWorld(D, []))).toBeNull();
    const c = { ...homeCamera(80), ...viewOfPlace(W, { kind: "building", index: 0 }) } as Camera;
    const spots = windowSpots(W, c, 0);
    expect(spots.map((s) => s.state)).toEqual(["proven", "proven", "unbacked", "open"]);
    expect(spots.every((s) => s.visible)).toBe(true);
    // Seen from the other side, the same windows face the camera again.
    const back = windowSpots(W, { ...c, yaw: c.yaw + Math.PI }, 0);
    expect(back.every((s) => s.visible)).toBe(true);
  });
});

/** The component ------------------------------------------------------------------------------ */

function city(extra: Partial<Parameters<typeof City3D>[0]> = {}) {
  const props = {
    domains: D,
    features: F,
    selected: null,
    onSelect: jest.fn(),
    onOpenDomain: jest.fn(),
    onOpenCapability: jest.fn(),
    fallback: <p data-testid="fallback">plan</p>,
    ...extra,
  };
  return {
    props,
    ...renderEnglish(
      <div data-motion="reduced">
        <City3D {...props} />
      </div>,
    ),
  };
}

const scene = () => screen.getByTestId("city");
const canvasOf = () => scene().querySelector("canvas")!;

describe("City3D", () => {
  it("falls back to the plan when the browser offers no WebGL", () => {
    city();
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("city")).toBeNull();
  });

  it("falls back on the product page to the isometric city, with its own legend", () => {
    render(<ProductPage domains={DOMAINS} features={FEATURES} view="city" />);
    expect(screen.getByTestId("city").tagName.toLowerCase()).toBe("svg");
    expect(screen.getByTestId("product-legend-size")).toHaveTextContent("Height = scenarios");
  });

  it("draws a real scene, labelled, with a list of everything it draws", async () => {
    const gl = withGl();
    city();
    size(canvasOf());
    await frame();
    expect(gl.calls).toContain("drawArrays");
    expect(scene()).toHaveAttribute("role", "group");
    expect(scene()).toHaveAccessibleName("Product city: 2 areas, 3 capabilities, 4 records");
    const list = within(screen.getByTestId("city-list"));
    const items = list.getAllByRole("listitem").map((li) => li.firstChild?.textContent);
    expect(items).toEqual([
      "Shop: 2 capabilities, 3 records, 55% test named",
      "Cart: 2 features, 4 test named, 1 open, 1 unbacked",
      "shop/cart/add: test named, open, unbacked, test named",
      "shop/cart/remove: test named, test named",
      "Payment: 1 feature, 1 test named, 2 open",
      "shop/pay/card: test named, open, open",
      "Operations: 1 capability, 1 record, 0% test named",
      "Logging: 1 feature, 1 open",
      "ops/log/ship: open",
    ]);
    expect(screen.getByTestId("city-legend")).toHaveTextContent(
      "Storey = feature, window = scenario",
    );
  });

  it("turns, tilts, zooms and resets from the keyboard and the buttons, without flights", async () => {
    withGl();
    city();
    size(canvasOf());
    await frame();
    const yaw = () => Number(scene().getAttribute("data-yaw"));
    const zoom = () => Number(scene().getAttribute("data-zoom"));
    // The precondition: the whole product, from the home angle.
    expect(zoom()).toBe(1);
    expect(yaw()).toBe(Math.round((VIEW.yaw * 180) / Math.PI));
    fireEvent.keyDown(scene(), { key: "ArrowRight" });
    await frame();
    expect(yaw()).toBeLessThan(-40);
    fireEvent.keyDown(scene(), { key: "+" });
    await frame();
    expect(zoom()).toBeGreaterThan(1);
    fireEvent.keyDown(scene(), { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(scene(), { key: "ArrowDown" });
    fireEvent.keyDown(scene(), { key: "-" });
    fireEvent.keyDown(scene(), { key: "0" });
    await frame();
    expect(zoom()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await frame();
    expect(zoom()).toBeCloseTo(1.33, 2);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await frame();
    expect(zoom()).toBe(1);
    const before = yaw();
    fireEvent.click(screen.getByRole("button", { name: "Turn right" }));
    await frame();
    expect(yaw()).toBe(before - 45);
    fireEvent.click(screen.getByRole("button", { name: "Turn left" }));
    await frame();
    expect(yaw()).toBe(before);
    fireEvent.click(screen.getByRole("radio", { name: "Areas" }));
    await frame();
    expect(scene()).toHaveAttribute("data-level", "far");
    fireEvent.click(screen.getByRole("radio", { name: "Records" }));
    await frame();
    expect(scene()).toHaveAttribute("data-level", "near");
    fireEvent.click(screen.getByRole("radio", { name: "Capabilities" }));
    await frame();
    expect(scene()).toHaveAttribute("data-level", "mid");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await frame();
    expect(zoom()).toBe(1);
    // A key the city does not use passes through.
    const other = fireEvent.keyDown(scene(), { key: "x" });
    expect(other).toBe(true);
  });

  it("zooms with the wheel and keeps the page where it is", async () => {
    withGl();
    city();
    size(canvasOf());
    await frame();
    const wheel = new WheelEvent("wheel", {
      deltaY: -300,
      clientX: 400,
      clientY: 200,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      scene().dispatchEvent(wheel);
    });
    await frame();
    expect(wheel.defaultPrevented).toBe(true);
    expect(Number(scene().getAttribute("data-zoom"))).toBeGreaterThan(1);
  });

  it("chooses a building, then a storey, by click; a drag only turns", async () => {
    withGl();
    const { props } = city();
    size(canvasOf());
    await frame();
    const probe = () => JSON.parse(scene().getAttribute("data-probe")!);
    const click = (x: number, y: number) => {
      fireEvent.pointerDown(scene(), { pointerId: 1, button: 0, clientX: x, clientY: y });
      fireEvent.pointerUp(scene(), { pointerId: 1, button: 0, clientX: x, clientY: y });
    };
    let p = probe();
    expect(p.path).toBe("shop/cart");
    // A drag from the building turns the city and chooses nothing.
    const yaw = scene().getAttribute("data-yaw");
    fireEvent.pointerDown(scene(), { pointerId: 1, button: 0, clientX: p.x, clientY: p.y });
    fireEvent.pointerMove(scene(), { pointerId: 1, clientX: p.x + 60, clientY: p.y });
    fireEvent.pointerUp(scene(), { pointerId: 1, clientX: p.x + 60, clientY: p.y });
    await frame();
    expect(scene().getAttribute("data-yaw")).not.toBe(yaw);
    expect(scene()).toHaveAttribute("data-chosen", "");
    fireEvent.keyDown(scene(), { key: "0" });
    await frame();
    p = probe();
    click(p.x, p.y);
    await frame();
    expect(scene()).toHaveAttribute("data-chosen", "shop/cart");
    expect(scene()).toHaveAttribute("data-level", "near");
    p = probe();
    expect(p.path).toBe("shop/cart/add");
    expect(p.windows.map((w: { state: string }) => w.state)).toEqual([
      "proven",
      "proven",
      "unbacked",
      "open",
    ]);
    click(p.x, p.y);
    await frame();
    expect(props.onSelect).toHaveBeenLastCalledWith("shop/cart/add");
    // Escape clears the choice and tells the page.
    fireEvent.keyDown(scene(), { key: "Escape" });
    expect(scene()).toHaveAttribute("data-chosen", "");
    // Enter chooses what is in the middle.
    fireEvent.keyDown(scene(), { key: "Enter" });
    await frame();
    expect(scene().getAttribute("data-chosen")).not.toBe("");
    // A click on empty ground clears it again.
    click(799, 1);
    await frame();
    expect(scene()).toHaveAttribute("data-chosen", "");
  });

  it("pans with shift or the right button, and pinches to zoom", async () => {
    withGl();
    city();
    size(canvasOf());
    await frame();
    const probe = () => JSON.parse(scene().getAttribute("data-probe")!);
    const before = probe();
    fireEvent.pointerDown(scene(), { pointerId: 1, button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(scene(), { pointerId: 1, clientX: 180, clientY: 120 });
    fireEvent.pointerUp(scene(), { pointerId: 1, clientX: 180, clientY: 120 });
    await frame();
    expect(probe().x).not.toBe(before.x);
    expect(scene().getAttribute("data-yaw")).toBe(String(Math.round((VIEW.yaw * 180) / Math.PI)));
    fireEvent.pointerDown(scene(), { pointerId: 1, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerDown(scene(), { pointerId: 2, button: 0, clientX: 340, clientY: 200 });
    fireEvent.pointerMove(scene(), { pointerId: 2, clientX: 400, clientY: 200 });
    fireEvent.pointerUp(scene(), { pointerId: 2, clientX: 400, clientY: 200 });
    fireEvent.pointerUp(scene(), { pointerId: 1, clientX: 300, clientY: 200 });
    await frame();
    expect(Number(scene().getAttribute("data-zoom"))).toBeGreaterThan(1);
    fireEvent.contextMenu(scene());
  });

  it("names a building's storeys and window states where the pointer rests", async () => {
    withGl();
    city();
    size(canvasOf());
    await frame();
    const p = JSON.parse(scene().getAttribute("data-probe")!);
    fireEvent.pointerMove(scene(), { pointerType: "mouse", clientX: p.x, clientY: p.y });
    const tip = screen.getByTestId("city-tip");
    expect(tip).toHaveTextContent("Cart");
    expect(tip).toHaveTextContent("2 features");
    expect(tip).toHaveTextContent("4 test named1 open1 unbacked");
    fireEvent.pointerLeave(scene());
    expect(screen.queryByTestId("city-tip")).toBeNull();
    fireEvent.keyDown(scene(), { key: "Home" });
    fireEvent.click(screen.getByRole("radio", { name: "Areas" }));
    await frame();
    const q = JSON.parse(scene().getAttribute("data-probe")!);
    fireEvent.pointerMove(scene(), { pointerType: "mouse", clientX: q.x, clientY: q.y });
    expect(screen.getByTestId("city-tip")).toHaveTextContent("Shop3 records");
    // Touch does not hover.
    fireEvent.pointerLeave(scene());
    fireEvent.pointerMove(scene(), { pointerType: "touch", clientX: q.x, clientY: q.y });
    expect(screen.queryByTestId("city-tip")).toBeNull();
  });

  it("opens an area or a capability from its name, whole and never cut", async () => {
    withGl();
    const { props } = city();
    size(canvasOf());
    await frame();
    const shop = screen.getByTestId("city-area-shop");
    expect(shop).toHaveTextContent("Shop");
    expect(getComputedStyle(shop.firstElementChild!).textOverflow).not.toBe("ellipsis");
    fireEvent.click(shop);
    expect(props.onOpenDomain).toHaveBeenCalledWith("shop");
    fireEvent.click(screen.getByTestId("city-cap-shop/cart"));
    expect(props.onOpenCapability).toHaveBeenCalledWith("shop", "cart");
    expect(screen.getByTestId("city-cap-shop/cart")).not.toHaveTextContent("…");
  });

  it("marks the record the page has chosen, and drops a choice that left the city", async () => {
    withGl();
    const { rerender, props } = city({ selected: "shop/pay/card" });
    size(canvasOf());
    await frame();
    expect(scene()).toHaveAttribute("data-chosen", "");
    fireEvent.keyDown(scene(), { key: "Enter" });
    await frame();
    const chosen = scene().getAttribute("data-chosen");
    expect(chosen).not.toBe("");
    expect(props.onSelect).toHaveBeenCalledWith(null);
    rerender(
      <div data-motion="reduced">
        <City3D {...props} features={[]} domains={[]} selected={null} />
      </div>,
    );
    await frame();
    expect(scene()).toHaveAttribute("data-chosen", "");
    expect(scene()).toHaveAccessibleName("Product city: 0 areas, 0 capabilities, 0 records");
  });

  it("reads the theme again when it changes, and redraws", async () => {
    const gl = withGl();
    renderEnglish(
      <div data-t-theme="facet" data-t-mode="dark" data-testid="theme">
        <City3D domains={D} features={F} selected={null} fallback={null} />
      </div>,
    );
    size(canvasOf());
    await frame();
    const draws = gl.calls.filter((c) => c === "drawArrays").length;
    await act(async () => {
      screen.getByTestId("theme").setAttribute("data-t-mode", "light");
      await Promise.resolve();
    });
    await frame();
    expect(gl.calls.filter((c) => c === "drawArrays").length).toBeGreaterThan(draws);
  });

  it("flies when motion is allowed, and the flight can be interrupted", async () => {
    withGl();
    renderEnglish(<City3D domains={D} features={F} selected={null} fallback={null} />);
    size(canvasOf());
    await frame();
    fireEvent.click(screen.getByRole("button", { name: "Turn right" }));
    await frame();
    const mid = Number(scene().getAttribute("data-yaw"));
    // The first frame of a flight has not arrived yet.
    expect(mid).toBeGreaterThan(-85);
    fireEvent.pointerDown(scene(), { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(scene(), { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    await frame();
    await frame();
    const stopped = Number(scene().getAttribute("data-yaw"));
    await frame();
    expect(Number(scene().getAttribute("data-yaw"))).toBe(stopped);
  });

  it("gives the context back when it leaves, and falls back when the context is lost", async () => {
    const gl = withGl();
    const { unmount } = city();
    await frame();
    unmount();
    expect(gl.lose).toHaveBeenCalled();
    expect(gl.calls).toContain("deleteProgram");

    withGl();
    city();
    await frame();
    act(() => {
      canvasOf().dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });

  it("still draws in 3D when it is mounted twice, as strict mode does", async () => {
    // A browser's canvas keeps its context: once that context is given back,
    // the same canvas only ever returns it lost.
    const lost = new WeakSet<HTMLCanvasElement>();
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      const fake = fakeGl();
      return new Proxy(fake.gl as object, {
        get: (target, key) => {
          if (key === "isContextLost") return () => lost.has(this);
          if (key === "getExtension") return () => ({ loseContext: () => lost.add(this) });
          return Reflect.get(target, key);
        },
      }) as RenderingContext;
    });
    renderEnglish(
      <StrictMode>
        <City3D
          domains={D}
          features={F}
          selected={null}
          fallback={<p data-testid="fallback">plan</p>}
        />
      </StrictMode>,
    );
    await frame();
    expect(screen.queryByTestId("fallback")).toBeNull();
    expect(scene().querySelectorAll("canvas")).toHaveLength(1);
    expect(lost.has(canvasOf())).toBe(false);
  });

  it("falls back when the program does not link", () => {
    const fake = fakeGl();
    const broken = new Proxy(fake.gl as object, {
      get: (target, key) =>
        key === "getProgramParameter" ? () => false : Reflect.get(target, key),
    });
    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => broken as RenderingContext);
    city();
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });
});
