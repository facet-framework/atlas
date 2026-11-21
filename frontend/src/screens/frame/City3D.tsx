import { reducedMotion } from "@facet-tools/ui";
/** The product city in WebGL: districts, buildings of storeys, and one window
 * per scenario. Frames are drawn on demand only — input, a camera flight, a
 * resize, a theme change or new data — and the context is given back when the
 * city leaves the page. Without WebGL the caller's `fallback` stands in. */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useText } from "../text";
import { Button, IconButton, Segment } from "@facet-tools/ui";
import { ratioPercent } from "../../share";

import { pctText } from "./charts";
import { createRenderer, type Renderer } from "./gl3d";
import type { DomainView, FeatureView, ScenarioState } from "./model";
import {
  VIEW,
  between,
  buildWorld,
  BUILDING_NAME_DROP,
  DISTRICT_NAME_DROP,
  farDistance,
  countStates,
  homeDistance,
  homeCamera,
  labelsOf,
  levelOf,
  meshOf,
  orbit,
  paletteOf,
  pan,
  pathOf,
  pick,
  placeAtCentre,
  probeFloor,
  project,
  shareOf,
  viewOfPlace,
  viewProjection,
  windowColour,
  windowSpots,
  zoomAt,
  type Camera,
  type Level,
  type Palette,
  type Place,
  type Spot,
  type World,
} from "./scene3d";

const STATE_NAME: Record<string, string> = {
  open: "ui.screens-frame.city3d-open",
  proven: "ui.screens-frame.city3d-test-named",
  unbacked: "ui.screens-frame.city3d-unbacked",
};

const STATE_WINDOWS: Record<string, string> = {
  open: "ui.screens-frame.city3d-count-open",
  proven: "ui.screens-frame.city3d-count-test-named",
  unbacked: "ui.screens-frame.city3d-count-unbacked",
};

export type City3DProps = {
  domains: DomainView[];
  features: FeatureView[];
  /** The chosen record, if any: its storey is marked. */
  selected: string | null;
  onSelect?: (id: string | null) => void;
  onOpenDomain?: (id: string) => void;
  onOpenCapability?: (domain: string, capability: string) => void;
  /** Drawn instead of the scene when the browser offers no WebGL. */
  fallback: ReactNode;
};

/** A press that moves less than this many pixels is a click. */
const CLICK_SLOP = 5;
const BUTTON_ZOOM = 1 / 0.75;
const KEY_ZOOM = 1 / 0.82;
const WHEEL_ZOOM = 0.0012;
const FLIGHT_MS = 700;
const TURN = Math.PI / 4;
const STATES: ScenarioState[] = ["proven", "open", "unbacked"];

type Overlay = {
  level: Level;
  yaw: number;
  zoom: number;
  districts: Spot[];
  buildings: Spot[];
  probe: string;
};

const EMPTY: Overlay = { level: "mid", yaw: 0, zoom: 1, districts: [], buildings: [], probe: "" };

/** Which districts and buildings carry the choice: the chosen place, or the chosen record's. */
function chosenOf(world: World, place: Place | null, selected: string | null) {
  const floor = selected ? world.floors.find((f) => f.feature.id === selected) : undefined;
  if (floor) return { district: floor.district, building: floor.building, floor: floor.index };
  if (!place) return { district: -1, building: -1, floor: -1 };
  if (place.kind === "district") return { district: place.index, building: -1, floor: -1 };
  if (place.kind === "building")
    return { district: world.buildings[place.index].district, building: place.index, floor: -1 };
  const f = world.floors[place.index];
  return { district: f.district, building: f.building, floor: f.index };
}

export function City3D(props: City3DProps) {
  const { domains, features, selected, fallback } = props;
  const { t, plural } = useText();
  const world = useMemo(() => buildWorld(domains, features), [domains, features]);
  const probe = useMemo(() => probeFloor(world), [world]);
  const [failed, setFailed] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [hover, setHover] = useState<{ place: Place; x: number; y: number } | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(EMPTY);
  const [said, setSaid] = useState("");
  const listId = useId();
  const keysId = useId();

  const scene = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const renderer = useRef<Renderer | null>(null);
  const camera = useRef<Camera | null>(null);
  const home = useRef(100);
  // Where the storeys give way to blocks; beyond the tallest tower's view.
  const farAt = useRef(115);
  /** True until the reader moves the camera: until then the city keeps fitting its frame. */
  const resting = useRef(true);
  const flight = useRef<{ from: Camera; to: Camera; start: number } | null>(null);
  const raf = useRef(0);
  const palette = useRef<Palette | null>(null);
  const lastOverlay = useRef("");

  // What the next frame reads; refreshed on every render.
  const live = useRef({ world, place, selected, hover, probe, props });
  useLayoutEffect(() => {
    live.current = { world, place, selected, hover, probe, props };
  });

  const draw = useCallback(() => {
    const cv = canvas.current;
    const r = renderer.current;
    if (!cv || !r) return;
    const { world: w, place: p, selected: s, hover: h, probe: pr } = live.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, cv.clientWidth);
    const ch = Math.max(1, cv.clientHeight);
    const bw = Math.max(1, Math.round(cw * dpr));
    const bh = Math.max(1, Math.round(ch * dpr));
    if (cv.width !== bw || cv.height !== bh) {
      cv.width = bw;
      cv.height = bh;
    }
    const aspect = cw / ch;
    home.current = homeDistance(w, aspect);
    farAt.current = farDistance(w, aspect);
    if (!camera.current || (resting.current && !flight.current))
      camera.current = homeCamera(home.current);
    const f = flight.current;
    if (f) {
      const k = Math.min(1, (performance.now() - f.start) / FLIGHT_MS);
      camera.current = between(f.from, f.to, k);
      if (k >= 1) flight.current = null;
    }
    const c = camera.current;
    const level = levelOf(c.dist, farAt.current);
    if (!palette.current) {
      const style = getComputedStyle(cv);
      palette.current = paletteOf((name) => style.getPropertyValue(name));
    }
    const chosen = chosenOf(w, p && placeExists(w, p) ? p : null, s);
    const matrix = viewProjection(c, aspect);
    r.draw(
      {
        matrix,
        palette: palette.current,
        far: level === "far",
        focus: [c.tx, c.ty, c.tz],
        fog: c.dist,
        building: level === "far" ? -1 : chosen.building,
        floor: chosen.floor,
        district: chosen.district,
        hover:
          h && h.place.kind !== "district" && placeExists(w, h.place)
            ? placeBuilding(w, h.place)
            : -1,
      },
      bw,
      bh,
    );
    // The test hook: where a click lands on the probe storey's building at
    // this level, what it chooses, and where its windows are on the screen.
    let probeText = "";
    if (pr !== null) {
      const floor = w.floors[pr];
      const b = w.buildings[floor.building];
      const d = w.districts[floor.district];
      let point: [number, number, number] = [b.cx, b.top, b.cz];
      let target: Place = { kind: "building", index: b.index };
      let windows: { x: number; y: number; state: ScenarioState; rgb: number[] }[] = [];
      if (level === "far") {
        point = [(d.x0 + d.x1) / 2, d.height, (d.z0 + d.z1) / 2];
        target = { kind: "district", index: d.index };
      } else if (level === "near") {
        const spots = windowSpots(w, c, pr);
        windows = spots
          .filter((x) => x.visible)
          .map((x) => {
            const q = project(matrix, x.point, cw, ch) ?? [-1, -1];
            return {
              x: Math.round(q[0]),
              y: Math.round(q[1]),
              state: x.state,
              rgb: windowColour(palette.current!, x.state),
            };
          });
        const middle = spots.filter((x) => x.visible)[Math.floor(spots.length / 2)] ?? spots[0];
        if (middle) {
          point = middle.point;
          target = { kind: "floor", index: pr };
        }
      }
      const q = project(matrix, point, cw, ch);
      // Whether the top of the tallest tower is in the picture.
      const tallest = w.buildings.reduce<(typeof w.buildings)[number] | null>(
        (best, x) => (!best || x.top > best.top ? x : best),
        null,
      );
      const peak = tallest ? project(matrix, [tallest.cx, tallest.top, tallest.cz], cw, ch) : null;
      if (q)
        probeText = JSON.stringify({
          path: pathOf(w, target),
          x: Math.round(q[0]),
          y: Math.round(q[1]),
          windows,
          tcompletetInView:
            !!peak && peak[0] >= 0 && peak[0] <= cw && peak[1] >= 0 && peak[1] <= ch,
        });
    }
    const labels = labelsOf(w, c, farAt.current, cw, ch, chosen);
    const next: Overlay = {
      level,
      yaw: Math.round((c.yaw * 180) / Math.PI),
      zoom: Math.round((home.current / c.dist) * 100) / 100,
      ...labels,
      probe: probeText,
    };
    const sig = JSON.stringify(next);
    if (sig !== lastOverlay.current) {
      lastOverlay.current = sig;
      setOverlay(next);
    }
  }, []);

  const request = useCallback(() => {
    if (raf.current) return;
    const tick = () => {
      raf.current = 0;
      draw();
      // A flight asks for its next frame; a camera at rest asks for none.
      if (flight.current) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [draw]);

  useEffect(() => {
    const host = scene.current;
    if (!host) return;
    const cv = document.createElement("canvas");
    cv.className = "t-a-city3d__canvas";
    cv.setAttribute("aria-hidden", "true");
    host.prepend(cv);
    canvas.current = cv;
    const r = createRenderer(cv);
    if (!r) {
      cv.remove();
      canvas.current = null;
      // Whether WebGL exists is known only once the canvas is in the page.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
    renderer.current = r;
    const lost = (e: Event) => {
      e.preventDefault();
      r.dispose();
      renderer.current = null;
      setFailed(true);
    };
    cv.addEventListener("webglcontextlost", lost);
    return () => {
      cv.removeEventListener("webglcontextlost", lost);
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
      r.dispose();
      renderer.current = null;
      cv.remove();
      canvas.current = null;
    };
  }, []);

  // New data: new triangles. The camera stays where the reader left it.
  useEffect(() => {
    renderer.current?.setMeshes(meshOf(world, false), meshOf(world, true));
    lastOverlay.current = "";
    request();
  }, [world, request]);

  // Drop a choice missing from this city.
  const shown = place && placeExists(world, place) ? place : null;

  useEffect(() => {
    request();
  }, [shown, selected, hover, request]);

  // Size and theme.
  useEffect(() => {
    const el = scene.current;
    if (!el) return;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => request()) : null;
    ro?.observe(el);
    const root = el.closest("[data-t-theme]") ?? document.documentElement;
    const mo =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            palette.current = null;
            request();
          })
        : null;
    mo?.observe(root, {
      attributes: true,
      attributeFilter: ["data-t-theme", "data-t-mode", "class"],
    });
    return () => {
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [request]);

  /** Camera moves ------------------------------------------------------------------------- */

  const current = () => camera.current ?? homeCamera(home.current);
  const move = useCallback(
    (next: Camera) => {
      flight.current = null;
      resting.current = false;
      camera.current = next;
      request();
    },
    [request],
  );
  const fly = useCallback(
    (goal: Partial<Camera>, rest = false) => {
      const from = camera.current ?? homeCamera(home.current);
      const to = { ...from, ...goal };
      resting.current = rest;
      if (reducedMotion()) {
        flight.current = null;
        camera.current = to;
      } else flight.current = { from, to, start: performance.now() };
      request();
    },
    [request],
  );
  const goHome = () => {
    setPlace(null);
    fly(homeCamera(home.current), true);
    setSaid(
      t("ui.screens-frame.city3d-product-city-areas-areas-capabilities-capabilities", sums(world)),
    );
  };

  const choose = (p: Place | null) => {
    const w = world;
    setPlace(p);
    if (!p) {
      if (selected) props.onSelect?.(null);
      setSaid("");
      return;
    }
    if (p.kind === "floor") props.onSelect?.(w.floors[p.index].feature.id);
    else if (selected) props.onSelect?.(null);
    setSaid(pathOf(w, p));
    fly(viewOfPlace(w, p));
  };

  /** Pointer position as −1..1 of the view, y up. */
  const normal = (clientX: number, clientY: number) => {
    const r = (canvas.current ?? scene.current)!.getBoundingClientRect();
    const w = r.width || 1;
    const h = r.height || 1;
    return {
      nx: ((clientX - r.left) / w) * 2 - 1,
      ny: 1 - ((clientY - r.top) / h) * 2,
      aspect: w / h,
      x: clientX - r.left,
      y: clientY - r.top,
    };
  };
  const pickAt = (clientX: number, clientY: number) => {
    const n = normal(clientX, clientY);
    return pick(world, current(), farAt.current, n.nx, n.ny, n.aspect);
  };

  // The wheel zooms towards the pointer. React adds wheel listeners as
  // passive, and a passive listener cannot keep the page from scrolling.
  useEffect(() => {
    const el = scene.current;
    if (!el || failed) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const n = normal(e.clientX, e.clientY);
      const c = camera.current ?? homeCamera(home.current);
      move(zoomAt(c, Math.exp(-e.deltaY * WHEEL_ZOOM), n.nx, n.ny, n.aspect, live.current.world));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [failed, move]);

  const pointers = useRef(new Map<number, [number, number]>());
  const drag = useRef<{ moved: number; pan: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    scene.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    drag.current = { moved: 0, pan: e.shiftKey || e.button === 2 || e.button === 1 };
    flight.current = null;
    setHover(null);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) {
      if (e.pointerType !== "mouse") return;
      const p = pickAt(e.clientX, e.clientY);
      const n = normal(e.clientX, e.clientY);
      setHover((h) =>
        !p
          ? null
          : h &&
              h.place.kind === p.kind &&
              h.place.index === p.index &&
              Math.abs(h.x - n.x) < 8 &&
              Math.abs(h.y - n.y) < 8
            ? h
            : { place: p, x: n.x, y: n.y },
      );
      return;
    }
    const dx = e.clientX - last[0];
    const dy = e.clientY - last[1];
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (drag.current) drag.current.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.current && drag.current.moved < CLICK_SLOP) return;
    const c = current();
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(last[0] - other[0], last[1] - other[1]);
      const after = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (before > 0 && after > 0) {
        const n = normal((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        move(zoomAt(c, after / before, n.nx, n.ny, n.aspect, world));
      }
    } else if (drag.current?.pan || e.shiftKey) move(pan(c, dx, dy, world));
    else move(orbit(c, dx, dy));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const count = pointers.current.size;
    pointers.current.delete(e.pointerId);
    if (count === 1 && drag.current && drag.current.moved < CLICK_SLOP && e.type === "pointerup")
      choose(pickAt(e.clientX, e.clientY));
    if (!pointers.current.size) drag.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const c = current();
    const k = e.key;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (arrows[k] && e.shiftKey) move(pan(c, -arrows[k][0] * 60, -arrows[k][1] * 60, world));
    else if (arrows[k]) move(orbit(c, arrows[k][0] * 30, arrows[k][1] * 24));
    else if (k === "+" || k === "=") move({ ...c, dist: clampDist(c.dist / KEY_ZOOM) });
    else if (k === "-" || k === "_") move({ ...c, dist: clampDist(c.dist * KEY_ZOOM) });
    else if (k === "0" || k === "Home") goHome();
    else if (k === "Enter") choose(placeAtCentre(world, c, farAt.current));
    else if (k === "Escape") choose(null);
    else return;
    e.preventDefault();
  };

  const zoomBy = (factor: number) => {
    const c = current();
    move({ ...c, dist: clampDist(c.dist / factor) });
  };
  const level = overlay.level;
  const toLevel = (l: Level) =>
    fly({
      dist: l === "far" ? farAt.current * 1.2 : l === "mid" ? home.current : 38,
    });

  if (failed) return <>{fallback}</>;

  const chosen = chosenOf(world, shown, selected);
  const placed = { districts: overlay.districts, buildings: overlay.buildings };
  const s = sums(world);
  const hovered = hover && placeExists(world, hover.place) ? hover : null;
  return (
    <>
      <div className="t-a-citymap t-a-city3d" data-testid="city-map">
        {/** The scene is one focusable group that takes the pointer and the keys
         * itself: a canvas has no parts a reader could tab to. What it draws is
         * in the list below, and its names are buttons of their own. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          ref={scene}
          className="t-a-city3d__scene"
          role="group"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          aria-roledescription={t("ui.screens-frame.city3d-3d-city")}
          aria-label={t(
            "ui.screens-frame.city3d-product-city-areas-areas-capabilities-capabilities",
            s,
          )}
          aria-describedby={keysId}
          data-testid="city"
          data-level={level}
          data-yaw={overlay.yaw}
          data-zoom={overlay.zoom.toFixed(2)}
          data-chosen={shown ? pathOf(world, shown) : ""}
          data-probe={overlay.probe}
          data-hover={hovered ? "true" : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={onKeyDown}
        />

        <div className="t-a-city3d__labels">
          {placed.districts.map(({ index, x, y }) => {
            const d = world.districts[index];
            if (!d) return null;
            return (
              <button
                key={`d-${d.id}`}
                type="button"
                className="t-a-city3d__label t-a-city3d__label--district"
                data-chosen={chosen.district === index || undefined}
                data-testid={`city-area-${d.id}`}
                style={{ left: x, top: y + DISTRICT_NAME_DROP }}
                onClick={() => props.onOpenDomain?.(d.id)}
              >
                <span className="t-wrap">{d.title}</span>
                <span className="t-mono t-meta">{pctText(share100(d), t)}</span>
              </button>
            );
          })}
          {placed.buildings.map(({ index, x, y }) => {
            const b = world.buildings[index];
            if (!b) return null;
            return (
              <button
                key={`b-${b.key}`}
                type="button"
                className="t-a-city3d__label"
                data-chosen={chosen.building === index || undefined}
                data-testid={`city-cap-${b.key}`}
                style={{ left: x, top: y + BUILDING_NAME_DROP }}
                onClick={() => props.onOpenCapability?.(b.domain, b.capability)}
              >
                <span className="t-wrap">{b.title}</span>
                <span className="t-mono t-meta">
                  {plural("ui.screens-frame.city3d-count-features", b.floors.length)}
                </span>
              </button>
            );
          })}
        </div>

        {hovered ? (
          <div
            className="t-a-city3d__tip t-raised"
            aria-hidden="true"
            data-testid="city-tip"
            style={{ left: hovered.x, top: hovered.y }}
          >
            <Tip world={world} place={hovered.place} />
          </div>
        ) : null}

        <div className="t-a-city3d__top">
          <Segment
            label={t("ui.screens-frame.city3d-detail")}
            value={level}
            options={[
              { value: "far" as Level, label: t("ui.screens-frame.city3d-areas") },
              { value: "mid" as Level, label: t("ui.screens-frame.city3d-capabilities") },
              { value: "near" as Level, label: t("ui.screens-frame.city3d-records") },
            ]}
            onChange={toLevel}
          />
        </div>

        <div className="t-a-city3d__tools">
          <span className="t-a-city3d__compass" aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              style={{ transform: `rotate(${overlay.yaw}deg)` }}
            >
              <path d="M12 2.5l3.2 9.5H8.8z" className="t-a-city3d__north" />
              <path d="M12 21.5l-3.2-9.5h6.4z" className="t-a-city3d__south" />
            </svg>
          </span>
          <div
            className="t-a-city3d__bar t-raised"
            role="toolbar"
            aria-label={t("ui.screens-frame.city3d-map-controls")}
          >
            <IconButton
              icon="zoomIn"
              label={t("ui.screens-frame.city3d-zoom")}
              size="small"
              data-testid="city-zoom-in"
              onClick={() => zoomBy(BUTTON_ZOOM)}
            />
            <IconButton
              icon="zoomOut"
              label={t("ui.screens-frame.city3d-zoom-out")}
              size="small"
              data-testid="city-zoom-out"
              onClick={() => zoomBy(1 / BUTTON_ZOOM)}
            />
            <IconButton
              icon="rotateLeft"
              label={t("ui.screens-frame.city3d-turn-left")}
              size="small"
              data-testid="city-turn-left"
              onClick={() => fly({ yaw: current().yaw + TURN })}
            />
            <IconButton
              icon="rotateRight"
              label={t("ui.screens-frame.city3d-turn-right")}
              size="small"
              data-testid="city-turn-right"
              onClick={() => fly({ yaw: current().yaw - TURN })}
            />
          </div>
          <Button size="small" icon="fit" data-testid="city-fit" onClick={goHome}>
            {t("ui.screens-frame.city3d-reset")}
          </Button>
        </div>

        <p id={keysId} className="t-sr">
          {t("ui.screens-frame.city3d-drag-turn-shift-drag-right-drag")}
        </p>
        <div className="t-sr" data-testid="city-list" id={listId}>
          <ul aria-label={t("ui.screens-frame.city3d-city")}>
            {world.districts.map((d) => (
              <li key={d.id}>
                {`${d.title}: ${plural("ui.screens-frame.city3d-count-capabilities", d.buildings.length)}, ${plural(
                  "ui.screens-frame.city3d-count-records",
                  d.records,
                )}, ${t("ui.screens-frame.city3d-share-test-named", { share: pctText(share100(d), t) })}`}
                <ul>
                  {d.buildings.map((bi) => {
                    const b = world.buildings[bi];
                    return (
                      <li key={b.key}>
                        {`${b.title}: ${plural("ui.screens-frame.city3d-count-features", b.floors.length)}${stateCounts(
                          world,
                          b.floors,
                          plural,
                        )}`}
                        {b.floors.length ? (
                          <ul>
                            {b.floors.map((fi) => {
                              const f = world.floors[fi];
                              return (
                                <li key={f.feature.id}>
                                  {`${f.feature.id}: ${
                                    f.windows.length
                                      ? f.windows.map((x) => t(STATE_NAME[x])).join(", ")
                                      : t("ui.screens-frame.city3d-no-scenarios")
                                  }`}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
        <p className="t-sr" aria-live="polite">
          {said}
        </p>
      </div>
      <div
        className="t-a-legend t-meta"
        aria-label={t("ui.screens-frame.city3d-legend")}
        data-testid="city-legend"
      >
        {STATES.map((st) => (
          <span key={st} className="t-row" style={{ gap: 6 }}>
            <span className="t-a-city3d__pane" data-state={st} /> {t(STATE_NAME[st])}
          </span>
        ))}
        <span className="t-row" style={{ gap: 6 }}>
          <span className="t-a-city3d__hatch" data-kind="planned" />{" "}
          {t("ui.screens-frame.city3d-planned")}
        </span>
        <span className="t-row" style={{ gap: 6 }}>
          <span className="t-a-city3d__hatch" data-kind="deprecated" />{" "}
          {t("ui.screens-frame.city3d-deprecated")}
        </span>
        <span>{t("ui.screens-frame.city3d-storey-feature-window-scenario")}</span>
      </div>
    </>
  );
}

/** What the pointer rests on: a building's storeys and the states of its windows. */
function Tip({ world, place }: { world: World; place: Place }) {
  const { plural } = useText();
  if (place.kind === "district") {
    const d = world.districts[place.index];
    return (
      <>
        <strong className="t-wrap">{d.title}</strong>
        <span className="t-meta">{plural("ui.screens-frame.city3d-count-records", d.records)}</span>
      </>
    );
  }
  const floor = place.kind === "floor" ? world.floors[place.index] : null;
  const b = world.buildings[floor ? floor.building : place.index];
  const windows = floor ? floor.windows : b.floors.flatMap((fi) => world.floors[fi].windows);
  const c = countStates(windows);
  return (
    <>
      <strong className="t-wrap">{floor ? floor.feature.id : b.title}</strong>
      {floor ? null : (
        <span className="t-meta">
          {plural("ui.screens-frame.city3d-count-features", b.floors.length)}
        </span>
      )}
      <span className="t-a-city3d__states">
        {STATES.filter((s) => c[s]).map((s) => (
          <span key={s} className="t-meta" data-state={s}>
            <i aria-hidden="true" />
            {plural(STATE_WINDOWS[s], c[s])}
          </span>
        ))}
      </span>
    </>
  );
}

function placeExists(world: World, p: Place) {
  if (p.kind === "district") return !!world.districts[p.index];
  if (p.kind === "building") return !!world.buildings[p.index];
  return !!world.floors[p.index];
}

function placeBuilding(world: World, p: Place) {
  return p.kind === "building" ? p.index : p.kind === "floor" ? world.floors[p.index].building : -1;
}

function clampDist(d: number) {
  return Math.max(VIEW.minDist, Math.min(VIEW.maxDist, d));
}

function share100(x: { scenarios: number; proven: number }) {
  return x.scenarios ? ratioPercent(shareOf(x)) : null;
}

function sums(world: World) {
  return {
    areas: world.districts.length,
    capabilities: world.buildings.length,
    records: world.floors.length,
  };
}

function stateCounts(world: World, floors: number[], plural: ReturnType<typeof useText>["plural"]) {
  const c = countStates(floors.flatMap((fi) => world.floors[fi].windows));
  const parts = STATES.filter((s) => c[s]).map((s) => plural(STATE_WINDOWS[s], c[s]));
  return parts.length ? `, ${parts.join(", ")}` : "";
}
