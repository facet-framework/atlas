import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { TextKey } from "../text";
import { useText } from "../text";
import {
  Icon,
  Badge,
  Button,
  IconButton,
  Segment,
  ListRow,
  Meter,
  Skeleton,
  DataTable,
  Pagination,
  type Column,
  type SortDir,
  Sheet,
} from "@facet-tools/ui";

import { Mosaic, Ring, pct, pctText, shareFill } from "./charts";
import { City3D } from "./City3D";
import { STOREY_NONE, StoreyLegend } from "./StoreyLegend";
import {
  NOT_MEASURED,
  STOREY_LENS_LABEL,
  STOREY_LENS_NAMES,
  storeyCount,
  storeyCountText,
  storeyFill,
  storeyLensOptions,
  storeyLabel,
  storeyTotalText,
  type CountLens,
  type StoreyLens,
} from "./storeyLens";
import {
  ZOOM_IN_MAX,
  ZOOM_OUT_MAX,
  iso,
  layoutCity,
  panView,
  quad,
  squarify,
  turnCity,
  wrapLabel,
  zoomView,
  type Building,
  type CityLayout,
  type ViewBox,
} from "./city";
import type { DomainView, FeatureView } from "./model";
import { LIFECYCLE } from "./parts";

export type ProductView = "city" | "treemap" | "list";

export type ProductPageProps = {
  domains: DomainView[];
  features: FeatureView[];
  view: ProductView;
  state?: "ready" | "loading";
  selected?: string | null;
  /** Creation dates the slider steps through; `index` is the shown moment. */
  time?: { dates: string[]; index: number };
  mobile?: boolean;
  /** List view. */
  page?: number;
  pageSize?: number;
  sort?: { key: string; dir: SortDir };
  onView?: (v: ProductView) => void;
  onSelect?: (id: string | null) => void;
  onOpenRecord?: (id: string) => void;
  onOpenDomain?: (id: string) => void;
  onOpenCapability?: (domain: string, capability: string) => void;
  onTime?: (index: number) => void;
  onPage?: (page: number) => void;
  onSort?: (key: string) => void;
  /** The city's least height in pixels; absent follows the window. */
  cityHeight?: number | null;
  /** `hover`: the city names only the place under the pointer and the chosen one. */
  cityNames?: "always" | "hover";
  cityLabels?: "tag" | "pin" | "map";
  /** Switches the names of every map view between always shown and shown on hover. */
  onCityNames?: (names: "always" | "hover") => void;
  storeyLens?: StoreyLens;
  onStoreyLens?: (lens: StoreyLens) => void;
  storeyContentsHref?: (lens: CountLens) => string;
  onOpenStoreyContents?: (href: string) => void;
};

/** "Treemap" is the same word in every language, so it carries no text key. */
const VIEWS: { value: ProductView; label: TextKey | null; icon: "map" | "grid" | "table" }[] = [
  { value: "city", label: "ui.screens-frame.productpage-city", icon: "map" },
  { value: "treemap", label: null, icon: "grid" },
  { value: "list", label: "ui.screens-frame.productpage-list", icon: "table" },
];

/** Features that existed at the slider's moment; undated ones only appear at the end. */
export function visibleAt(features: FeatureView[], time?: { dates: string[]; index: number }) {
  if (!time || time.index >= time.dates.length - 1) return features;
  const at = time.dates[time.index];
  return features.filter((f) => f.createdAt != null && f.createdAt <= at);
}

// @facet: registry/coverage/product-city
// @facet-role: related
function countAt(feature: FeatureView, day?: string): FeatureView {
  if (!day || !feature.fixCommits) return feature;
  const fixCommits = feature.fixCommits.filter(({ date }) => date && date <= day);
  return { ...feature, fixCommits, fixCount: fixCommits.length };
}

// @facet: registry/coverage/product-city
// @facet-role: primary
export function ProductPage(props: ProductPageProps) {
  const {
    domains,
    view,
    state = "ready",
    time,
    mobile,
    selected,
    onView,
    onTime,
    onSelect,
    storeyLens = "tests",
  } = props;
  const { t, plural } = useText();
  const known = props.features.filter((f) => domains.some((d) => d.id === f.domain));
  // The last stop is the present: every fix counts there, dated or not.
  const day = time && time.index < time.dates.length - 1 ? time.dates[time.index] : undefined;
  const features = visibleAt(known, time).map((feature) => countAt(feature, day));
  const sel = selected ? (features.find((f) => f.id === selected) ?? null) : null;
  const loading = state === "loading";
  const rank = !sel && !mobile && !loading && view !== "list" && storeyLens !== "tests";
  const early = !!time && time.index < time.dates.length - 1;
  const range = useRef<HTMLInputElement>(null);

  // Headline figures count every record, so they agree with the top bar and the
  // overview page; a record outside the taxonomy is named, not dropped.
  const headline = (all: FeatureView[]) => {
    const featureCount = all.filter((f) => f.type === "feature").length;
    const assumptionCount = all.length - featureCount;
    const scen = all.reduce((a, f) => a + f.scenarios, 0);
    const proven = all.reduce((a, f) => a + f.proven, 0);
    return {
      title: `${plural("ui.screens-frame.productpage-count-features", featureCount)}${
        assumptionCount
          ? ` ${plural("ui.screens-frame.productpage-count-assumptions", assumptionCount)}`
          : ""
      }`,
      lead: `${t("ui.screens-frame.productpage-domains-areas-test-names-share-scenarios", {
        domains: domains.length,
        share: pctText(pct(proven, scen), t),
        scenarios: scen,
      })}${view === "list" ? ` ${t("ui.screens-frame.productpage-sorted-share-named-test-most-open")}` : ""}`,
    };
  };
  const shown = headline(visibleAt(props.features, time));
  // While the slider is back in time, the heading keeps the room of today's
  // heading: a shorter count must not pull the city and the slider upwards.
  const today = early ? headline(props.features) : null;

  return (
    <div
      className="t-page t-a-product"
      data-testid="product"
      data-view={view}
      style={
        props.cityHeight
          ? ({ "--t-a-city-min": `${props.cityHeight}px` } as CSSProperties)
          : undefined
      }
    >
      <header className="t-a-product__head">
        <div className="t-stack" style={{ gap: 6 }}>
          <span className="t-eyebrow">
            {early
              ? t("ui.screens-frame.productpage-product-date", {
                  date: time!.dates[time!.index],
                })
              : t("ui.screens-frame.productpage-product")}
          </span>
          <h1 className="t-h1 t-steady">
            {loading ? (
              t("ui.screens-frame.productpage-records")
            ) : (
              <Steady shown={shown.title} reserve={today?.title} />
            )}
          </h1>
          <p className="t-lead t-steady">
            {loading ? (
              t("ui.screens-frame.productpage-atlas-reading-registry")
            ) : (
              <Steady shown={shown.lead} reserve={today?.lead} />
            )}
          </p>
        </div>
        <div className="t-a-product__tools">
          <Segment
            label={t("ui.screens-frame.productpage-view")}
            value={view}
            options={VIEWS.map((v) => ({ ...v, label: v.label ? t(v.label) : "Treemap" }))}
            onChange={onView}
          />
          {view !== "list" ? (
            <div className="t-a-storey-control" data-testid="storey-lens">
              <span className="t-meta">{t(STOREY_LENS_LABEL)}</span>
              <Segment
                label={t(STOREY_LENS_LABEL)}
                value={storeyLens}
                options={storeyLensOptions(t)}
                onChange={props.onStoreyLens}
              />
            </div>
          ) : null}
          {view !== "list" && props.onCityNames ? (
            <IconButton
              icon="eye"
              label={t("ui.screens-frame.productpage-names-only-hover")}
              pressed={props.cityNames === "hover"}
              data-testid="names-on-hover"
              onClick={() => props.onCityNames?.(props.cityNames === "hover" ? "always" : "hover")}
            />
          ) : null}
        </div>
      </header>

      {/** The selection is a column of its own beside the city, the time and the
       * strip: a long selection lengthens the page and narrows what stands
       * beside it, and never lies over it. */}
      <div
        className="t-a-product__stage"
        data-testid="product-stage"
        data-selected={sel && !mobile ? "true" : undefined}
        data-ranked={rank || undefined}
      >
        <div className="t-a-product__main" data-testid="product-main">
          <div className="t-a-product__body" data-names={props.cityNames ?? "always"}>
            <div className="t-a-product__canvas">
              {loading ? (
                <CitySkeleton />
              ) : view === "city" ? (
                <City3D
                  domains={domains}
                  features={features}
                  selected={sel?.id ?? null}
                  onSelect={onSelect}
                  onOpenDomain={props.onOpenDomain}
                  onOpenCapability={props.onOpenCapability}
                  names={props.cityNames}
                  labels={props.cityLabels}
                  lens={storeyLens}
                  fallback={
                    <>
                      <City
                        domains={domains}
                        features={features}
                        selected={sel?.id ?? null}
                        onSelect={onSelect}
                        onOpenDomain={props.onOpenDomain}
                        lens={storeyLens}
                      />
                      {storeyLens === "tests" ? (
                        <Legend view="city" />
                      ) : (
                        <StoreyLegend features={features} lens={storeyLens} />
                      )}
                    </>
                  }
                />
              ) : view === "treemap" ? (
                <Treemap
                  domains={domains}
                  features={features}
                  selected={sel?.id ?? null}
                  onSelect={onSelect}
                  lens={storeyLens}
                />
              ) : (
                <FeatureTable {...props} features={features} />
              )}
              {!loading && view === "treemap" ? (
                storeyLens === "tests" ? (
                  <Legend view={view} />
                ) : (
                  <StoreyLegend features={features} lens={storeyLens} />
                )
              ) : null}
            </div>
          </div>

          {time ? (
            <div className="t-a-time t-surface" data-testid="time">
              <Icon name="clock" size={16} />
              <label className="t-a-time__label" htmlFor="t-a-time-range">
                {t("ui.screens-frame.productpage-time")}
              </label>
              <input
                ref={range}
                id="t-a-time-range"
                className="t-a-time__range"
                type="range"
                min={0}
                max={time.dates.length - 1}
                value={time.index}
                aria-valuetext={time.dates[time.index]}
                onChange={(e) => onTime?.(Number(e.target.value))}
              />
              <span className="t-mono t-a-time__date">{time.dates[time.index]}</span>
              <span className="t-meta t-hide-mobile t-steady">
                <Steady
                  shown={t("ui.screens-frame.productpage-shown-total-records", {
                    shown: features.length,
                    total: known.length,
                  })}
                  reserve={t("ui.screens-frame.productpage-shown-total-records", {
                    shown: known.length,
                    total: known.length,
                  })}
                />
              </span>
              {/** "Today" keeps its place at today, only unseen, so the rail never changes length. */}
              <Button
                size="small"
                variant="quiet"
                icon="forward"
                className="t-a-time__today"
                data-idle={early ? undefined : "true"}
                aria-hidden={early ? undefined : true}
                tabIndex={early ? undefined : -1}
                onClick={() => {
                  onTime?.(time.dates.length - 1);
                  // The button leaves with the click; the slider keeps the focus.
                  range.current?.focus();
                }}
              >
                {t("ui.screens-frame.productpage-today")}
              </Button>
            </div>
          ) : null}

          {!loading ? (
            <DistrictStrip
              domains={domains}
              features={features}
              onOpenDomain={props.onOpenDomain}
            />
          ) : null}
        </div>
        {sel && !mobile ? (
          <aside
            className="t-raised t-a-product__aside t-anim-rise"
            aria-label={t("ui.screens-frame.productpage-selection")}
          >
            <Selection f={sel} {...props} />
          </aside>
        ) : rank ? (
          <StoreyRanking {...props} features={features} lens={storeyLens} />
        ) : null}
      </div>

      {mobile ? (
        <Sheet
          open={!!sel}
          side="bottom"
          title={sel?.slug ?? ""}
          meta={sel?.id}
          onClose={() => onSelect?.(null)}
        >
          {sel ? <Selection f={sel} {...props} bare /> : null}
        </Sheet>
      ) : null}
    </div>
  );
}

/** Text that keeps the room of a reserve: both share one grid cell, the reserve
 * unseen, so the box is as large as the larger of the two. */

function Steady({ shown, reserve }: { shown: string; reserve?: string | null }) {
  return (
    <>
      <span>{shown}</span>
      {reserve != null && reserve !== shown ? (
        <span className="t-steady__reserve" aria-hidden="true">
          {reserve}
        </span>
      ) : null}
    </>
  );
}

/** City ---------------------------------------------------------------------------------------------- */

const UNIT = 16;

function onKey(e: KeyboardEvent, run: () => void) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    run();
  }
}

/** Drawing units of one world unit. */
function viewOf(city: CityLayout): ViewBox {
  const { minX, minY, maxX, maxY } = city.bounds;
  const pad = 2.2;
  return {
    x: (minX - pad) * UNIT,
    y: (minY - pad) * UNIT,
    w: (maxX - minX + pad * 2) * UNIT,
    h: (maxY - minY + pad * 2) * UNIT,
  };
}

/** A drag shorter than this many pixels is a click. */
const DRAG_SLOP = 4;
const KEY_PAN = 0.08;
const BUTTON_ZOOM = 1.4;

/** The product city as a map: the wheel, a pinch and the + − buttons zoom
 * towards the pointer, dragging or the arrow keys move it, the turn buttons
 * show it from another side, and "fit" brings the whole city back. */

function City({
  domains,
  features,
  selected,
  onSelect,
  onOpenDomain,
  lens,
}: {
  lens: StoreyLens;
  domains: DomainView[];
  features: FeatureView[];
  selected: string | null;
  onSelect?: (id: string | null) => void;
  onOpenDomain?: (id: string) => void;
}) {
  const { t } = useText();
  const [quarter, setQuarter] = useState(0);
  const laid = useMemo(() => layoutCity(domains, features), [domains, features]);
  const city = useMemo(() => turnCity(laid, quarter), [laid, quarter]);
  const base = useMemo(() => viewOf(city), [city]);
  const svg = useRef<SVGSVGElement>(null);
  const baseRef = useRef(base);
  useEffect(() => {
    baseRef.current = base;
  }, [base]);
  // The view belongs to one city: a new city (another time, another turn)
  // starts whole, without an effect that resets it after the fact.
  const [held, setHeld] = useState({ key: base, view: base });
  const view = held.key === base ? held.view : base;
  const update = useCallback(
    (next: (v: ViewBox, b: ViewBox) => ViewBox) =>
      setHeld((s) => {
        const b = baseRef.current;
        return { key: b, view: next(s.key === b ? s.view : b, b) };
      }),
    [],
  );

  /** Client pixels to drawing units, through the element's own transform. */
  const toDrawing = useCallback((clientX: number, clientY: number): [number, number] => {
    const el = svg.current;
    const m = el?.getScreenCTM?.();
    if (!el || !m) return [0, 0];
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }, []);

  // The wheel zooms. React registers wheel listeners as passive, and a passive
  // listener cannot keep the page from scrolling, so this one is added by hand.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = toDrawing(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0015);
      update((v, b) => zoomView(v, factor, at, b));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [toDrawing, update]);

  // Pointers: one drags, two pinch. A drag must not also count as a click.
  const pointers = useRef(new Map<number, [number, number]>());
  const drag = useRef({ moved: false, start: [0, 0] as [number, number] });
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size === 1) drag.current = { moved: false, start: [e.clientX, e.clientY] };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    const now: [number, number] = [e.clientX, e.clientY];
    if (pointers.current.size === 1) {
      const [sx, sy] = drag.current.start;
      if (!drag.current.moved && Math.hypot(now[0] - sx, now[1] - sy) < DRAG_SLOP) return;
      if (!drag.current.moved) {
        drag.current.moved = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      const a = toDrawing(last[0], last[1]);
      const b = toDrawing(now[0], now[1]);
      update((v, w) => panView(v, a[0] - b[0], a[1] - b[1], w));
    } else if (pointers.current.size === 2) {
      drag.current.moved = true;
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(last[0] - other[0], last[1] - other[1]);
      const after = Math.hypot(now[0] - other[0], now[1] - other[1]);
      if (before > 0 && after > 0) {
        const at = toDrawing((now[0] + other[0]) / 2, (now[1] + other[1]) / 2);
        update((v, b) => zoomView(v, after / before, at, b));
      }
    }
    pointers.current.set(e.pointerId, now);
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const zoomBy = (factor: number) =>
    update((v, b) => zoomView(v, factor, [v.x + v.w / 2, v.y + v.h / 2], b));
  const panBy = (fx: number, fy: number) => update((v, b) => panView(v, v.w * fx, v.h * fy, b));
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_PAN, 0],
      ArrowRight: [KEY_PAN, 0],
      ArrowUp: [0, -KEY_PAN],
      ArrowDown: [0, KEY_PAN],
    };
    if (moves[e.key]) panBy(...moves[e.key]);
    else if (e.key === "+" || e.key === "=") zoomBy(BUTTON_ZOOM);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / BUTTON_ZOOM);
    else if (e.key === "0") update((_, b) => b);
    else return;
    e.preventDefault();
  };

  const zoom = base.w / view.w;
  return (
    <div className="t-a-citymap">
      <svg
        ref={svg}
        className="t-a-city"
        viewBox={[view.x, view.y, view.w, view.h].map((v) => v.toFixed(1)).join(" ")}
        role="group"
        tabIndex={0}
        aria-label={t("ui.screens-frame.productpage-product-city-count-records", {
          count: features.length,
        })}
        aria-describedby="t-a-city-keys"
        data-testid="city"
        data-zoom={zoom.toFixed(2)}
        data-turn={quarter}
        data-dim={selected ? "true" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={(e) => {
          const at = toDrawing(e.clientX, e.clientY);
          update((v, b) => zoomView(v, 2, at, b));
        }}
        onClickCapture={(e) => {
          // The click that ends a drag is not a choice.
          if (drag.current.moved) {
            e.stopPropagation();
            drag.current.moved = false;
          }
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect?.(null);
        }}
      >
        {city.districts.map((d) => (
          <g key={d.key} className="t-a-city__district">
            <polygon
              points={quad(
                [
                  [d.x, d.y, 0],
                  [d.x + d.w, d.y, 0],
                  [d.x + d.w, d.y + d.d, 0],
                  [d.x, d.y + d.d, 0],
                ],
                UNIT,
              )}
            />
          </g>
        ))}
        {city.blocks.map((b) => {
          const [lx, ly] = iso(b.x + 0.3, b.y + b.d);
          const tx = lx * UNIT;
          const ty = ly * UNIT + 11;
          const lines = wrapLabel(b.label, (b.w * UNIT) / 5.6);
          return (
            <g key={b.key} className="t-a-city__block">
              <polygon
                points={quad(
                  [
                    [b.x, b.y, 0],
                    [b.x + b.w, b.y, 0],
                    [b.x + b.w, b.y + b.d, 0],
                    [b.x, b.y + b.d, 0],
                  ],
                  UNIT,
                )}
              />
              <text
                x={tx}
                y={ty}
                className="t-a-city__cap"
                transform={`rotate(30 ${tx} ${ty})`}
                data-testid={`city-cap-${b.key}`}
              >
                {lines.map((line, i) => (
                  <tspan key={i} x={tx} dy={i ? 10 : 0}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
        {city.buildings.map((b) => (
          <Tower
            key={b.feature.id}
            b={b}
            lens={lens}
            selected={selected === b.feature.id}
            onSelect={onSelect}
          />
        ))}
        {city.districts.map((d) => {
          const [lx, ly] = iso(d.x + 0.6, d.y + d.d);
          const tx = lx * UNIT;
          const ty = ly * UNIT + 20;
          return (
            <text
              key={d.key}
              x={tx}
              y={ty}
              className="t-a-city__label"
              transform={`rotate(30 ${tx} ${ty})`}
              role="link"
              tabIndex={0}
              onClick={() => onOpenDomain?.(d.domain)}
              onKeyDown={(e) => onKey(e, () => onOpenDomain?.(d.domain))}
            >
              {d.label}
            </text>
          );
        })}
      </svg>
      <div
        className="t-a-citymap__tools t-raised"
        role="toolbar"
        aria-label={t("ui.screens-frame.productpage-map-controls")}
      >
        <IconButton
          icon="zoomIn"
          label={t("ui.screens-frame.productpage-zoom")}
          size="small"
          data-testid="city-zoom-in"
          disabled={zoom >= ZOOM_IN_MAX - 0.01}
          onClick={() => zoomBy(BUTTON_ZOOM)}
        />
        <IconButton
          icon="zoomOut"
          label={t("ui.screens-frame.productpage-zoom-out")}
          size="small"
          data-testid="city-zoom-out"
          disabled={zoom <= 1 / ZOOM_OUT_MAX + 0.01}
          onClick={() => zoomBy(1 / BUTTON_ZOOM)}
        />
        <IconButton
          icon="rotateLeft"
          label={t("ui.screens-frame.productpage-turn-left")}
          size="small"
          data-testid="city-turn-left"
          onClick={() => setQuarter((q) => (q + 3) % 4)}
        />
        <IconButton
          icon="rotateRight"
          label={t("ui.screens-frame.productpage-turn-right")}
          size="small"
          data-testid="city-turn-right"
          onClick={() => setQuarter((q) => (q + 1) % 4)}
        />
        <IconButton
          icon="fit"
          label={t("ui.screens-frame.productpage-show-whole-city")}
          size="small"
          data-testid="city-fit"
          onClick={() => update((_, b) => b)}
        />
      </div>
      <p id="t-a-city-keys" className="t-sr">
        {t("ui.screens-frame.productpage-drag-turn-shift-drag-right-drag")}
      </p>
    </div>
  );
}

function Tower({
  b,
  lens,
  selected,
  onSelect,
}: {
  b: Building;
  lens: StoreyLens;
  selected: boolean;
  onSelect?: (id: string | null) => void;
}) {
  const text = useText();
  const { t } = text;
  const { x, y, w, h, feature: f } = b;
  const p = pct(f.proven, f.scenarios);
  const fill =
    lens !== "tests"
      ? storeyFill(f, lens)
      : f.lifecycle === "planned"
        ? "var(--t-plan-wash)"
        : shareFill(p);
  const top = quad(
    [
      [x, y, h],
      [x + w, y, h],
      [x + w, y + w, h],
      [x, y + w, h],
    ],
    UNIT,
  );
  const left = quad(
    [
      [x, y + w, 0],
      [x + w, y + w, 0],
      [x + w, y + w, h],
      [x, y + w, h],
    ],
    UNIT,
  );
  const right = quad(
    [
      [x + w, y, 0],
      [x + w, y + w, 0],
      [x + w, y + w, h],
      [x + w, y, h],
    ],
    UNIT,
  );
  const [mx, my] = iso(x + w / 2, y + w / 2, h);
  return (
    <g
      className="t-a-tower"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={
        lens !== "tests"
          ? storeyLabel(f, lens, text)
          : t(
              f.drift
                ? "ui.screens-frame.productpage-id-scenarios-scenarios-share-test-named"
                : "ui.screens-frame.productpage-id-scenarios-scenarios-share-test-named-tower",
              {
                id: f.id,
                scenarios: f.scenarios,
                share: pctText(p, t),
              },
            )
      }
      data-planned={(lens === "tests" && f.lifecycle === "planned") || undefined}
      data-selected={selected || undefined}
      data-testid={`tower-${f.id}`}
      onClick={() => onSelect?.(selected ? null : f.id)}
      onKeyDown={(e) => onKey(e, () => onSelect?.(selected ? null : f.id))}
      style={{ ["--t-a-fill" as string]: fill }}
    >
      <polygon points={right} className="t-a-tower__r" />
      <polygon points={left} className="t-a-tower__l" />
      <polygon points={top} className="t-a-tower__t" />
      {f.drift ? <circle cx={mx * UNIT} cy={my * UNIT} r="3" className="t-a-tower__drift" /> : null}
      <title>{lens === "tests" ? f.id : storeyLabel(f, lens, text)}</title>
    </g>
  );
}

function CitySkeleton() {
  const { t } = useText();
  return (
    <div className="t-a-city-skel" aria-busy="true" data-testid="city-loading">
      <svg
        viewBox="-200 -20 400 220"
        className="t-a-city"
        role="img"
        aria-label={t("ui.screens-frame.productpage-city-loading")}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const x = (i % 3) * 9;
          const y = Math.floor(i / 3) * 9;
          return (
            <polygon
              key={i}
              className="t-a-city__skel"
              style={{ animationDelay: `${i * 120}ms` }}
              points={quad(
                [
                  [x, y, 0],
                  [x + 7, y, 0],
                  [x + 7, y + 7, 0],
                  [x, y + 7, 0],
                ],
                10,
              )}
            />
          );
        })}
      </svg>
      <div className="t-row" style={{ gap: 12, justifyContent: "center" }}>
        <Skeleton width={120} height={10} />
        <Skeleton width={80} height={10} />
      </div>
    </div>
  );
}

function Legend({ view }: { view: "city" | "treemap" }) {
  const { t } = useText();
  return (
    <div className="t-a-legend t-meta" aria-label={t("ui.screens-frame.productpage-legend")}>
      <span className="t-row" style={{ gap: 6 }}>
        <span className="t-a-legend__ramp" /> {t("ui.screens-frame.productpage-test-named-50-100")}
      </span>
      <span className="t-row" style={{ gap: 6 }}>
        <span className="t-a-legend__plan" /> {t("ui.screens-frame.productpage-planned")}
      </span>
      <span className="t-row" style={{ gap: 6 }}>
        <span className="t-dot t-dot--warn" /> {t("ui.screens-frame.productpage-drift")}
      </span>
      <span data-testid="product-legend-size">
        {t(
          view === "treemap"
            ? "ui.screens-frame.productpage-area-scenarios"
            : "ui.screens-frame.productpage-height-scenarios",
        )}
      </span>
    </div>
  );
}

/** A capability's name in its treemap cell, bottom-aligned and wrapped. A name
 * that does not fit the cell whole is left out; the cell's records still name
 * it in their own titles. */

function CapLabel({
  title,
  rect,
}: {
  title: string;
  rect: { x: number; y: number; w: number; h: number };
}) {
  if (rect.w <= 60) return null;
  const width = (rect.w - 10) / 6.2;
  const lines = wrapLabel(title, width);
  // A cell too small for the whole name shows none of it rather than a part.
  if (lines.length * 12 + 14 > rect.h || lines.some((l) => l.length > width)) return null;
  const x = rect.x + 6;
  const y = rect.y + rect.h - 6 - (lines.length - 1) * 12;
  return (
    <text x={x} y={y} className="t-a-treemap__cap-label">
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i ? 12 : 0}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/** Treemap ----------------------------------------------------------------------------------------------- */

function Treemap({
  lens,
  domains,
  features,
  selected,
  onSelect,
}: {
  lens: StoreyLens;
  domains: DomainView[];
  features: FeatureView[];
  selected: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const text = useText();
  const { t, number: nf } = text;
  const W = 1200;
  const H = 620;
  const weight = (f: FeatureView) => Math.max(1, f.scenarios);
  const doms = domains
    .map((d) => ({ d, fs: features.filter((f) => f.domain === d.id) }))
    .filter((x) => x.fs.length);
  const dRects = squarify(
    doms.map((x) => x.fs.reduce((a, f) => a + weight(f), 0)),
    { x: 0, y: 0, w: W, h: H },
  );
  return (
    <svg
      className="t-a-treemap"
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label={t("ui.screens-frame.productpage-treemap-scenarios")}
      data-testid="treemap"
      data-dim={selected ? "true" : undefined}
    >
      {doms.map(({ d, fs }, di) => {
        const r = dRects[di];
        const inner = {
          x: r.x + 3,
          y: r.y + 22,
          w: Math.max(0, r.w - 6),
          h: Math.max(0, r.h - 25),
        };
        const caps = d.capabilities
          .map((c) => ({ c, fs: fs.filter((f) => f.capability === c.id) }))
          .filter((x) => x.fs.length);
        const cRects = squarify(
          caps.map((x) => x.fs.reduce((a, f) => a + weight(f), 0)),
          inner,
        );
        return (
          <g key={d.id}>
            <rect
              x={r.x + 1}
              y={r.y + 1}
              width={Math.max(0, r.w - 2)}
              height={Math.max(0, r.h - 2)}
              rx="8"
              className="t-a-treemap__domain"
            />
            <text x={r.x + 10} y={r.y + 16} className="t-a-treemap__label">
              {d.title} · {nf(fs.length)}
            </text>
            {caps.map(({ c, fs: cfs }, ci) => {
              const cr = cRects[ci];
              const fRects = squarify(cfs.map(weight), {
                x: cr.x + 2,
                y: cr.y + 2,
                w: Math.max(0, cr.w - 4),
                h: Math.max(0, cr.h - 4),
              });
              return (
                <g key={c.id}>
                  <rect
                    x={cr.x}
                    y={cr.y}
                    width={cr.w}
                    height={cr.h}
                    rx="5"
                    className="t-a-treemap__cap"
                  />
                  {cfs.map((f, fi) => {
                    const fr = fRects[fi];
                    const p = pct(f.proven, f.scenarios);
                    return (
                      <rect
                        key={f.id}
                        x={fr.x + 0.5}
                        y={fr.y + 0.5}
                        width={Math.max(0, fr.w - 1)}
                        height={Math.max(0, fr.h - 1)}
                        rx="2"
                        role="button"
                        tabIndex={0}
                        aria-pressed={selected === f.id}
                        aria-label={
                          lens !== "tests"
                            ? storeyLabel(f, lens, text)
                            : t("ui.screens-frame.productpage-id-share-test-named", {
                                id: f.id,
                                share: pctText(p, t),
                              })
                        }
                        className="t-a-treemap__cell"
                        data-selected={selected === f.id || undefined}
                        style={{
                          fill:
                            lens !== "tests"
                              ? storeyFill(f, lens)
                              : f.lifecycle === "planned"
                                ? "var(--t-plan-wash)"
                                : shareFill(p),
                        }}
                        onClick={() => onSelect?.(selected === f.id ? null : f.id)}
                        onKeyDown={(e) =>
                          onKey(e, () => onSelect?.(selected === f.id ? null : f.id))
                        }
                      >
                        <title>{lens === "tests" ? f.id : storeyLabel(f, lens, text)}</title>
                      </rect>
                    );
                  })}
                  <CapLabel title={c.title} rect={cr} />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** List -------------------------------------------------------------------------------------------------- */

const LIFE_RANK = { active: 0, planned: 1, deprecated: 2 } as const;

/** Sorted by one column; equal values fall back to the id so the order never looks random. */
function sorted(features: FeatureView[], sort?: { key: string; dir: SortDir }) {
  if (!sort) return features;
  const val = (f: FeatureView): string | number => {
    switch (sort.key) {
      case "proven":
        return f.scenarios ? f.proven / f.scenarios : -1;
      case "scenarios":
        return f.scenarios;
      case "anchors":
        return f.anchors;
      case "drift":
        return f.drift;
      case "lifecycle":
        return LIFE_RANK[f.lifecycle];
      default:
        return f.id;
    }
  };
  return [...features].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const r = x < y ? -1 : x > y ? 1 : 0;
    if (r !== 0) return sort.dir === "asc" ? r : -r;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function FeatureTable({
  features,
  page = 1,
  pageSize = 25,
  sort,
  mobile,
  onPage,
  onSort,
  onSelect,
  selected,
}: ProductPageProps) {
  const { t, number: nf } = useText();
  const rows = sorted(features, sort).slice((page - 1) * pageSize, page * pageSize);
  const cols: Column<FeatureView>[] = [
    {
      key: "id",
      label: "Record",
      sortable: true,
      render: (f) => (
        <span className="t-stack" style={{ gap: 2 }}>
          <span className="t-mono">{f.slug}</span>
          <span className="t-meta">
            {f.domain}/{f.capability}
          </span>
        </span>
      ),
    },
    {
      key: "scenarios",
      label: t("ui.screens-frame.productpage-scenarios"),
      numeric: true,
      sortable: true,
      render: (f) => nf(f.scenarios),
    },
    {
      key: "proven",
      label: t("ui.screens-frame.productpage-test-named"),
      sortable: true,
      width: 180,
      render: (f) => (
        <span className="t-row" style={{ gap: 8 }}>
          <span style={{ width: 90 }} className="t-hide-mobile">
            <Meter
              value={f.scenarios ? f.proven / f.scenarios : null}
              thin
              tone={f.proven === f.scenarios ? "ok" : "warn"}
              label={t("ui.screens-frame.productpage-title-test-named", {
                title: f.slug,
              })}
            />
          </span>
          <span className="t-num">{pctText(pct(f.proven, f.scenarios), t)}</span>
        </span>
      ),
    },
    {
      key: "anchors",
      label: t("ui.screens-frame.productpage-anchors"),
      numeric: true,
      sortable: true,
      hideOnMobile: true,
      render: (f) => nf(f.anchors),
    },
    {
      key: "drift",
      label: t("ui.screens-frame.productpage-drift"),
      numeric: true,
      sortable: true,
      render: (f) =>
        f.drift ? <Badge tone="warn">{f.drift}</Badge> : <span className="t-muted">—</span>,
    },
    {
      key: "lifecycle",
      label: t("ui.screens-frame.productpage-lifecycle"),
      sortable: true,
      hideOnMobile: true,
      render: (f) => (
        <Badge
          tone={f.lifecycle === "active" ? "ok" : f.lifecycle === "planned" ? "plan" : "neutral"}
        >
          {t(LIFECYCLE[f.lifecycle])}
        </Badge>
      ),
    },
  ];
  return (
    <div className="t-stack" style={{ gap: 4 }} data-testid="product-list">
      <DataTable
        label={t("ui.screens-frame.productpage-records-product")}
        columns={cols}
        rows={rows}
        rowKey={(f) => f.id}
        sort={sort}
        onSort={onSort}
        onRowClick={(f) => onSelect?.(selected === f.id ? null : f.id)}
        dense
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={features.length}
        compact={mobile}
        onPage={onPage}
      />
    </div>
  );
}

/** Selection ----------------------------------------------------------------------------------------------- */

function StoreyRanking({
  lens,
  features,
  onSelect,
  storeyContentsHref,
  onOpenStoreyContents,
}: ProductPageProps & { lens: CountLens }) {
  const text = useText();
  const { t, plural, number } = text;
  const heading = t(
    lens === "fixes"
      ? "ui.screens-frame.productpage-most-bug-fixes"
      : "ui.screens-frame.productpage-most-deviations",
  );
  const counts = features.flatMap((feature) => {
    const count = storeyCount(feature, lens);
    return count == null ? [] : [{ feature, count }];
  });
  const affected = counts
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count || a.feature.id.localeCompare(b.feature.id));
  const total =
    lens === "fixes"
      ? new Set(
          counts.flatMap(({ feature }) => feature.fixCommits?.map(({ commit }) => commit) ?? []),
        ).size
      : counts.reduce((sum, row) => sum + row.count, 0);
  const href = storeyContentsHref?.(lens);
  return (
    <aside
      className="t-raised t-a-product__aside t-stack t-a-storey-ranking"
      aria-label={heading}
      data-testid="storey-ranking"
    >
      <h2 className="t-h3">{heading}</h2>
      <p className="t-meta" data-testid="storey-total">
        {affected.length
          ? storeyTotalText(text, lens, total)
          : t(features.length && !counts.length ? NOT_MEASURED : STOREY_NONE)}
      </p>
      <ol className="t-a-storey-ranking__rows">
        {affected.slice(0, 8).map(({ feature, count }) => (
          <li key={feature.id}>
            <button
              type="button"
              className="t-a-storey-ranking__row"
              onClick={() => onSelect?.(feature.id)}
            >
              <span className="t-mono t-wrap">{feature.id}</span>
              <span className="t-num">{number(count)}</span>
              <span className="t-a-storey-ranking__bar" aria-hidden="true">
                <span
                  style={{
                    width: `${(100 * count) / affected[0].count}%`,
                    background: storeyFill(feature, lens),
                  }}
                />
              </span>
            </button>
          </li>
        ))}
      </ol>
      {href && affected.length ? (
        <a
          className="t-a-link"
          href={href}
          onClick={(event) => {
            if (
              !onOpenStoreyContents ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onOpenStoreyContents(href);
          }}
        >
          {plural("ui.screens-frame.productpage-all-count-records", affected.length)}
        </a>
      ) : null}
    </aside>
  );
}

function Selection({
  f,
  bare,
  onOpenRecord,
  onOpenCapability,
  onSelect,
}: ProductPageProps & { f: FeatureView; bare?: boolean }) {
  const text = useText();
  const { t, plural, number: nf } = text;
  const p = pct(f.proven, f.scenarios);
  return (
    <div className="t-stack t-a-sel" style={{ gap: 14 }} data-testid="selection">
      {!bare ? (
        <div className="t-row t-row--between">
          <span className="t-eyebrow">{t("ui.screens-frame.productpage-selection")}</span>
          <Button
            size="small"
            variant="quiet"
            icon="close"
            aria-label={t("ui.screens-frame.productpage-clear-selection")}
            onClick={() => onSelect?.(null)}
          />
        </div>
      ) : null}
      {!bare ? <span className="t-h3 t-mono">{f.slug}</span> : null}
      <span className="t-muted t-clamp-3">{f.summary}</span>
      <div className="t-row" style={{ gap: 14 }}>
        <Ring value={p} size={64} label={t("ui.screens-frame.productpage-test-named-selection")} />
        <div className="t-stack" style={{ gap: 6 }}>
          <span>
            {t("ui.screens-frame.productpage-proven-scenarios-scenarios-test-named", {
              proven: f.proven,
              scenarios: f.scenarios,
            })}
          </span>
          <Mosaic
            cells={f.mosaic ?? Array.from({ length: f.scenarios }, (_, i) => i < f.proven)}
            label={t("ui.screens-frame.productpage-promises")}
          />
        </div>
      </div>
      <dl className="t-a-kv">
        <dt>{t("ui.screens-frame.productpage-area")}</dt>
        <dd>
          <button
            type="button"
            className="t-a-link"
            onClick={() => onOpenCapability?.(f.domain, f.capability)}
          >
            {f.domain} / {f.capability}
          </button>
        </dd>
        <dt>{t("ui.screens-frame.productpage-anchors")}</dt>
        <dd>{nf(f.anchors)}</dd>
        <dt>{t("ui.screens-frame.productpage-tests")}</dt>
        <dd>{nf(f.tests)}</dd>
        <dt>{t(STOREY_LENS_NAMES.fixes)}</dt>
        <dd data-testid="selected-fix-count">{storeyCountText(text, storeyCount(f, "fixes"))}</dd>
        <dt>{t(STOREY_LENS_NAMES.deviations)}</dt>
        <dd data-testid="selected-deviation-count">
          {storeyCountText(text, storeyCount(f, "deviations"))}
        </dd>
        <dt>{t("ui.screens-frame.productpage-drift")}</dt>
        <dd className={f.drift ? "t-warn" : undefined}>
          {f.drift
            ? plural("ui.screens-frame.productpage-count-files", f.drift)
            : t("ui.screens-frame.productpage-none")}
        </dd>
        <dt>{t("ui.screens-frame.productpage-knowledge-open")}</dt>
        <dd>{t("ui.screens-frame.productpage-count-5", { count: f.knowledgeOpen })}</dd>
        <dt>{t("ui.screens-frame.productpage-created")}</dt>
        <dd>{f.createdAt ?? "—"}</dd>
      </dl>
      <Button variant="primary" iconAfter="forward" onClick={() => onOpenRecord?.(f.id)}>
        {t("ui.screens-frame.productpage-open-record")}
      </Button>
    </div>
  );
}

function DistrictStrip({
  domains,
  features,
  onOpenDomain,
}: {
  domains: DomainView[];
  features: FeatureView[];
  onOpenDomain?: (id: string) => void;
}) {
  const { t, plural } = useText();
  return (
    <div
      className="t-a-strip t-stagger"
      role="list"
      aria-label={t("ui.screens-frame.productpage-areas")}
      data-testid="district-strip"
    >
      {domains.map((d) => {
        const fs = features.filter((f) => f.domain === d.id);
        const s = fs.reduce((a, f) => a + f.scenarios, 0);
        const p = fs.reduce((a, f) => a + f.proven, 0);
        return (
          <div role="listitem" key={d.id}>
            <ListRow
              lead={<Ring value={pct(p, s)} size={36} label={d.title} />}
              title={d.title}
              sub={`${plural("ui.screens-frame.productpage-count-records", fs.length)} · ${plural(
                "ui.screens-frame.productpage-count-capabilities",
                d.capabilities.length,
              )}`}
              trail={<Icon name="chevronRight" size={14} />}
              onClick={() => onOpenDomain?.(d.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
