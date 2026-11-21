import type { ReactNode } from "react";
import {
  Icon,
  Badge,
  Button,
  Chip,
  IconButton,
  SearchField,
  Tabs,
  EmptyState,
  Stat,
  Collection,
  CollectionToolbar,
  DataTable,
  Pagination,
  type CollectionState,
  Sheet,
} from "@facet-tools/ui";
import type { TextKey } from "../../../../frontend/src/plugin/components";
import { useText } from "../../../../frontend/src/plugin/components";
import {
  Facts,
  PluginHead,
  noop,
} from "../../../../frontend/src/plugin/components";
import {
  EdgeDefs,
  PlacedLabel,
  ElementGlyph,
  ShapeGlyph,
  edgeStyle,
  formOf,
  isContainer,
  isTask,
  markerUrl,
} from "./bpmnGlyphs";

/** View model ------------------------------------------------------------------- */

/** A label the sidecar already placed: its box and the lines inside it. */
export type BpmnLabel = {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  /** Pool and lane names run bottom to top. */
  vertical?: boolean;
  align?: "left" | "center";
};

/** One drawn element. The optional fields are the BPMN sidecar's drawing
 * vocabulary (`plugins/bpmn/sidecar/diagram/model.go`); without them
 * the canvas derives the look from `kind`, as it always did. */

export type BpmnShape = {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lane?: string;
  /** Outline: roundrect, circle, diamond, document, datastore, bracket, group, pool, lane, rect. */
  form?: string;
  /** single, thick (end events, call activities), double (intermediate and boundary events, transactions), dashed, dotted (event subprocesses). */
  border?: string;
  /** Non-interrupting event: the rings are dashed. */
  dashed?: boolean;
  /** Task type, event trigger or gateway marker ("user", "timer", "parallel" …); "" = none. */
  symbol?: string;
  /** The symbol is drawn solid (a throwing event). */
  filled?: boolean;
  /** Bottom-edge markers left to right: loop, parallel, sequential, compensation, adhoc, collapsed. */
  markers?: string[];
  /** A data object standing for a collection. */
  collection?: boolean;
  /** Where the label goes, already broken into lines. */
  labelBox?: BpmnLabel;
};
export type BpmnEdge = {
  id: string;
  kind: string;
  label: string;
  points: [number, number][];
  from?: string;
  to?: string;
  /** solid, dashed (message flows), dotted (associations). */
  stroke?: string;
  /** Line ends: arrow, open-arrow, circle, diamond, slash; "" = none. */
  start?: string;
  end?: string;
  labelBox?: BpmnLabel;
};
export type ProcessDiagram = {
  shapes: BpmnShape[];
  edges: BpmnEdge[];
  box: { x: number; y: number; w: number; h: number };
};

export type ProcessFinding = {
  key: string;
  severity: "error" | "warning" | "info";
  text: string;
  element?: string;
};

export type ProcessWalk = {
  step: number;
  total: number;
  visited: string[];
  edges: string[];
  current: string;
  /** Branches offered at a gateway. */
  choices?: { edge: string; label: string; target: string }[];
  log: { id: string; label: string; kind: string }[];
};

const KIND_KEY: Record<string, TextKey> = {
  participant: "ui.bpmn-src-views.processes-participant",
  lane: "ui.bpmn-src-views.processes-lane",
  endEvent: "ui.bpmn-src-views.processes-end",
  intermediateCatchEvent:
    "ui.bpmn-src-views.processes-intermediate-event-catching",
  intermediateThrowEvent:
    "ui.bpmn-src-views.processes-intermediate-event-throwing",
  boundaryEvent: "ui.bpmn-src-views.processes-boundary-event",
  manualTask: "ui.bpmn-src-views.processes-manual-task",
  businessRuleTask: "ui.bpmn-src-views.processes-business-rule-task",
  sendTask: "ui.bpmn-src-views.processes-send-task",
  receiveTask: "ui.bpmn-src-views.processes-receive-task",
  subProcess: "ui.bpmn-src-views.processes-subprocess",
  adHocSubProcess: "ui.bpmn-src-views.processes-ad-hoc-subprocess",
  transaction: "ui.bpmn-src-views.processes-transaction",
  callActivity: "ui.bpmn-src-views.processes-call-activity",
  parallelGateway: "ui.bpmn-src-views.processes-parallel-gateway",
  inclusiveGateway: "ui.bpmn-src-views.processes-inclusive-gateway",
  eventBasedGateway: "ui.bpmn-src-views.processes-event-based-gateway",
  complexGateway: "ui.bpmn-src-views.processes-complex-gateway",
  dataObjectReference: "ui.bpmn-src-views.processes-data-object",
  dataStoreReference: "ui.bpmn-src-views.processes-data-store",
  group: "ui.bpmn-src-views.processes-group",
  task: "ui.bpmn-src-views.processes-task",
  userTask: "ui.bpmn-src-views.processes-user-task",
  serviceTask: "ui.bpmn-src-views.processes-service-task",
  scriptTask: "ui.bpmn-src-views.processes-script-task",
  exclusiveGateway: "ui.bpmn-src-views.processes-exclusive-gateway",
  textAnnotation: "ui.bpmn-src-views.processes-annotation",
  sequenceFlow: "ui.bpmn-src-views.processes-sequence-flow",
  messageFlow: "ui.bpmn-src-views.processes-message-flow",
  association: "ui.bpmn-src-views.processes-association",
};

/** The name of a BPMN element kind in the active language; "Start" reads the same in both. */
export function useKindLabel() {
  const { t } = useText();
  return (kind: string) =>
    KIND_KEY[kind] ? t(KIND_KEY[kind]) : kind === "startEvent" ? "Start" : kind;
}

const SEVERITY_KEY: Record<ProcessFinding["severity"], TextKey> = {
  error: "ui.bpmn-src-views.processes-error",
  warning: "ui.bpmn-src-views.processes-warning",
  info: "ui.bpmn-src-views.processes-note",
};

export type CanvasProps = {
  diagram: ProcessDiagram;
  selected?: string | null;
  walk?: ProcessWalk | null;
  thumb?: boolean;
  label: string;
  onSelect?: (id: string) => void;
};

/** The diagram as SVG. Selection sharpens one element and its flows, the rest
 * recedes. Containers (pools, lanes, groups, open subprocesses) are drawn
 * first and never recede, so their contents stay readable on top of them;
 * boundary events come last, because they sit on an activity's border. */

export function ProcessCanvas({
  diagram,
  selected,
  walk,
  thumb,
  label,
  onSelect = noop,
}: CanvasProps) {
  const { t } = useText();
  const kindLabel = useKindLabel();
  const { box } = diagram;
  const pad = 20;
  const related = new Set<string>();
  if (selected) {
    related.add(selected);
    for (const e of diagram.edges) {
      if (e.from === selected || e.to === selected) {
        related.add(e.id);
        if (e.from) related.add(e.from);
        if (e.to) related.add(e.to);
      }
    }
  }
  const containers = new Set(
    diagram.shapes.filter(isContainer).map((s) => s.id),
  );
  const state = (id: string): string | undefined => {
    const keep = containers.has(id) ? undefined : "dim";
    if (walk) {
      if (walk.current === id) return "current";
      if (walk.visited.includes(id) || walk.edges.includes(id))
        return "visited";
      return keep;
    }
    if (selected) {
      if (id === selected) return "focus";
      if (related.has(id)) return "related";
      return keep;
    }
    return undefined;
  };
  const area = (s: BpmnShape) => s.w * s.h;
  const rank = (s: BpmnShape) => {
    const f = formOf(s);
    return f === "pool" ? 0 : f === "lane" ? 1 : f === "group" ? 3 : 2;
  };
  // Larger containers first, so a nested subprocess draws on top of its parent.
  const back = diagram.shapes
    .filter((s) => containers.has(s.id))
    .sort((a, b) => rank(a) - rank(b) || area(b) - area(a));
  const front = diagram.shapes
    .filter((s) => !containers.has(s.id))
    .sort(
      (a, b) =>
        Number(a.kind === "boundaryEvent") - Number(b.kind === "boundaryEvent"),
    );
  const named = (s: BpmnShape) =>
    `${kindLabel(s.kind)}: ${s.label || t("ui.bpmn-src-views.processes-unnamed")}`;
  const element = (s: BpmnShape) => {
    const f = formOf(s);
    // Pools, lanes and groups frame other elements; only flow elements are picked.
    const frame = f === "pool" || f === "lane" || f === "group";
    return (
      <g
        key={s.id}
        className="t-d-bpmn__el"
        data-state={state(s.id)}
        data-form={f}
        data-kind={s.kind}
        data-testid={thumb ? undefined : `shape-${s.id}`}
        role={thumb ? undefined : frame ? "group" : "button"}
        tabIndex={thumb || frame ? undefined : 0}
        aria-label={thumb ? undefined : named(s)}
        onClick={thumb || frame ? undefined : () => onSelect(s.id)}
      >
        <ShapeGlyph s={s} thumb={thumb} />
      </g>
    );
  };
  return (
    <svg
      className="t-d-bpmn"
      data-thumb={thumb || undefined}
      viewBox={`${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
    >
      <EdgeDefs />
      {back.map(element)}
      {diagram.edges.map((e) => {
        const style = edgeStyle(e);
        return (
          <g
            key={e.id}
            className="t-d-bpmn__edge"
            data-kind={e.kind}
            data-stroke={style.stroke}
            data-start={style.start || undefined}
            data-end={style.end || undefined}
            data-state={state(e.id)}
            data-testid={thumb ? undefined : `edge-${e.id}`}
          >
            <polyline
              points={e.points.map((p) => p.join(",")).join(" ")}
              markerStart={markerUrl(style.start)}
              markerEnd={markerUrl(style.end)}
            />
            {!e.label || thumb ? null : e.labelBox ? (
              <PlacedLabel box={e.labelBox} className="t-d-bpmn__edgetext" />
            ) : (
              <text
                x={
                  (e.points[Math.min(1, e.points.length - 1)][0] +
                    e.points[e.points.length - 1][0]) /
                  2
                }
                y={e.points[e.points.length - 1][1] - 6}
                textAnchor="middle"
                className="t-d-bpmn__edgetext"
              >
                {e.label}
              </text>
            )}
          </g>
        );
      })}
      {front.map(element)}
    </svg>
  );
}

/** Collection --------------------------------------------------------------------- */

export type ProcessSummary = {
  file: string;
  name: string;
  shapes: number;
  edges: number;
  lanes: number;
  warnings: number;
  /** `null` when nobody measured which records a process touches — never zero. */
  records: number | null;
  updatedAt: string;
  thumb: ProcessDiagram;
};

export type ProcessCollectionProps = {
  state: CollectionState;
  view: "gallery" | "table";
  items: ProcessSummary[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  withWarnings: number;
  mobile?: boolean;
  onView?: (v: "gallery" | "table") => void;
  onQuery?: (q: string) => void;
  onOpen?: (file: string) => void;
  onPage?: (p: number) => void;
  onReset?: () => void;
};

export function ProcessCollection({
  state,
  view,
  items,
  total,
  page,
  pageSize,
  query,
  withWarnings,
  mobile,
  onView = noop,
  onQuery = noop,
  onOpen = noop,
  onPage = noop,
  onReset = noop,
}: ProcessCollectionProps) {
  const { t, plural, number } = useText();
  return (
    <div className="t-page t-stack" style={{ gap: 20 }}>
      <PluginHead
        icon="flow"
        title={t("ui.bpmn-src-views.processes-processes")}
        count={number(total)}
        sentence={
          total
            ? t(
                "ui.bpmn-src-views.processes-total-files-have-parser-findings",
                {
                  with: withWarnings,
                  total,
                },
              )
            : t("ui.bpmn-src-views.processes-no-bpmn-file-repository-yet")
        }
      />
      <Collection
        state={state}
        toolbar={
          state === "empty" ? null : (
            <CollectionToolbar<"gallery" | "table">
              query={query}
              queryLabel={t("ui.bpmn-src-views.processes-search-processes")}
              placeholder={t("ui.bpmn-src-views.processes-name-file")}
              facets={[
                {
                  key: "warn",
                  label: t("ui.bpmn-src-views.processes-findings"),
                  count: withWarnings,
                },
                {
                  key: "records",
                  label: t("ui.bpmn-src-views.processes-records"),
                },
              ]}
              views={[
                {
                  value: "gallery",
                  label: t("ui.bpmn-src-views.processes-gallery"),
                  icon: "grid",
                },
                {
                  value: "table",
                  label: t("ui.bpmn-src-views.processes-table"),
                  icon: "table",
                },
              ]}
              view={view}
              sortLabel="Name"
              onQuery={onQuery}
              onView={onView}
              onReset={onReset}
            />
          )
        }
        empty={{
          icon: "flow",
          title: t("ui.bpmn-src-views.processes-no-process"),
          body: (
            <>
              {t("ui.bpmn-src-views.processes-atlas-finds-no")}
              <span className="t-mono">.bpmn</span>
              {t("ui.bpmn-src-views.processes-file-put-one-under")}
              <span className="t-mono">docs/bpmn/</span>
              {t(
                "ui.bpmn-src-views.processes-camunda-bpmn-io-signavio-write-format",
              )}
            </>
          ),
          action: (
            <Button icon="external" onClick={onReset}>
              {t("ui.bpmn-src-views.processes-view-sample-file")}
            </Button>
          ),
        }}
        filteredEmpty={{ query, onReset }}
        pagination={
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            compact={mobile}
            onPage={onPage}
          />
        }
      >
        {view === "gallery" || mobile ? (
          <div className="t-d-gallery t-stagger">
            {items.map((p) => (
              <button
                key={p.file}
                type="button"
                className="t-d-procard t-interactive"
                onClick={() => onOpen(p.file)}
              >
                <span className="t-d-procard__thumb">
                  <ProcessCanvas
                    diagram={p.thumb}
                    thumb
                    label={t("ui.bpmn-src-views.processes-thumbnail-name", {
                      name: p.name,
                    })}
                  />
                </span>
                <span className="t-d-procard__name t-wrap">{p.name}</span>
                <span className="t-mono t-meta t-wrap">{p.file}</span>
                <span
                  className="t-row t-row--wrap t-meta t-d-procard__meta"
                  style={{ gap: 10 }}
                >
                  <span>
                    {plural(
                      "ui.bpmn-src-views.processes-count-shapes",
                      p.shapes,
                    )}
                  </span>
                  <span>
                    {plural("ui.bpmn-src-views.processes-count-flows", p.edges)}
                  </span>
                  <span>
                    {plural("ui.bpmn-src-views.processes-count-lanes", p.lanes)}
                  </span>
                  {p.warnings ? (
                    <Badge tone="warn">
                      {plural(
                        "ui.bpmn-src-views.processes-count-findings",
                        p.warnings,
                      )}
                    </Badge>
                  ) : (
                    <Badge tone="ok">
                      {t("ui.bpmn-src-views.processes-clean")}
                    </Badge>
                  )}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <DataTable<ProcessSummary>
            label={t("ui.bpmn-src-views.processes-processes")}
            rows={items}
            rowKey={(p) => p.file}
            onRowClick={(p) => onOpen(p.file)}
            sort={{ key: "name", dir: "asc" }}
            columns={[
              {
                key: "name",
                label: t("ui.bpmn-src-views.processes-process"),
                sortable: true,
                render: (p) => (
                  <span className="t-row" style={{ gap: 10 }}>
                    <span className="t-d-minithumb">
                      <ProcessCanvas
                        diagram={p.thumb}
                        thumb
                        label={t("ui.bpmn-src-views.processes-thumbnail-name", {
                          name: p.name,
                        })}
                      />
                    </span>
                    <span className="t-stack" style={{ gap: 0 }}>
                      <span>{p.name}</span>
                      <span className="t-mono t-meta">{p.file}</span>
                    </span>
                  </span>
                ),
              },
              {
                key: "shapes",
                label: t("ui.bpmn-src-views.processes-shapes"),
                numeric: true,
                sortable: true,
                render: (p) => p.shapes,
              },
              {
                key: "edges",
                label: t("ui.bpmn-src-views.processes-flows"),
                numeric: true,
                sortable: true,
                render: (p) => p.edges,
              },
              {
                key: "lanes",
                label: t("ui.bpmn-src-views.processes-lanes"),
                numeric: true,
                render: (p) => p.lanes,
              },
              {
                key: "warnings",
                label: t("ui.bpmn-src-views.processes-findings-label"),
                numeric: true,
                sortable: true,
                render: (p) =>
                  p.warnings ? (
                    <span className="t-warn">{p.warnings}</span>
                  ) : (
                    "0"
                  ),
              },
              {
                key: "records",
                label: "Records",
                numeric: true,
                render: (p) => p.records ?? "—",
              },
              {
                key: "updatedAt",
                label: t("ui.bpmn-src-views.processes-changed"),
                sortable: true,
                render: (p) => <span className="t-mono">{p.updatedAt}</span>,
              },
            ]}
          />
        )}
      </Collection>
    </div>
  );
}

/** Workspace -------------------------------------------------------------------- */

export type ProcessMetrics = {
  elements: number;
  flows: number;
  lanes: number;
  /** `null` when the flows do not resolve to a countable path. */
  paths: number | null;
  longest: number | null;
};

export type ProcessWorkspaceProps = {
  name: string;
  file: string;
  diagram: ProcessDiagram;
  metrics: ProcessMetrics;
  selected?: string | null;
  walk?: ProcessWalk | null;
  panel: "detail" | "walkthrough";
  findings: ProcessFinding[];
  findingsOpen?: boolean;
  outlineQuery: string;
  zoom: number;
  /** Visible part of the diagram, for the minimap. */
  viewport?: { x: number; y: number; w: number; h: number };
  linked: Record<string, { id: string; summary: string }[]>;
  docs?: Record<string, string>;
  /** Diagrams in this file; a switcher appears from two on. */
  diagrams?: { id: string; name: string; elements: number }[];
  activeDiagram?: string;
  mobile?: boolean;
  outlineOpen?: boolean;
  onDiagram?: (id: string) => void;
  onSelect?: (id: string | null) => void;
  onPanel?: (p: "detail" | "walkthrough") => void;
  onZoom?: (dir: "in" | "out" | "fit") => void;
  onOutlineQuery?: (q: string) => void;
  onOutline?: () => void;
  onFindings?: () => void;
  onWalk?: (
    action: "start" | "next" | "back" | "stop" | "choose",
    edge?: string,
  ) => void;
  onOpenRecord?: (id: string) => void;
  onBack?: () => void;
};

function Outline({
  diagram,
  query,
  selected,
  onQuery,
  onSelect,
}: {
  diagram: ProcessDiagram;
  query: string;
  selected?: string | null;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useText();
  const kindLabel = useKindLabel();
  const q = query.trim().toLowerCase();
  // An unnamed element is listed, and found, by the name of its kind.
  const nameOf = (s: BpmnShape) => s.label || kindLabel(s.kind);
  const pools = diagram.shapes.filter((s) => s.kind === "participant");
  const groups: [string, (k: string) => boolean][] = [
    ["Start", (k) => k === "startEvent"],
    [t("ui.bpmn-src-views.processes-tasks"), isTask],
    ["Gateways", (k) => /gateway/i.test(k)],
    [t("ui.bpmn-src-views.processes-end"), (k) => k === "endEvent"],
    [
      t("ui.bpmn-src-views.processes-annotations"),
      (k) => k === "textAnnotation",
    ],
  ];
  return (
    <nav
      className="t-d-outline"
      aria-label={t("ui.bpmn-src-views.processes-outline")}
    >
      <SearchField
        label={t("ui.bpmn-src-views.processes-search-elements")}
        value={query}
        placeholder="Element …"
        onChange={onQuery}
      />
      {pools.map((p) => {
        const inPool = diagram.shapes.filter(
          (s) => s.lane === p.id && (!q || nameOf(s).toLowerCase().includes(q)),
        );
        return (
          <section key={p.id} className="t-d-outline__pool">
            <span className="t-label t-row" style={{ gap: 6 }}>
              <Icon name="layers" size={12} /> {p.label}
            </span>
            {groups.map(([label, test]) => {
              const els = inPool.filter((s) => test(s.kind));
              if (!els.length) return null;
              return (
                <div key={label} className="t-d-outline__group">
                  <span className="t-meta">
                    {label} · {els.length}
                  </span>
                  {els.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="t-d-outline__el"
                      aria-pressed={selected === s.id}
                      onClick={() => onSelect(s.id)}
                    >
                      <ElementGlyph s={s} />
                      <span className="t-wrap">
                        {s.label || <em className="t-muted">{nameOf(s)}</em>}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}
    </nav>
  );
}

function Detail({
  diagram,
  selected,
  linked,
  docs,
  onSelect,
  onOpenRecord,
}: {
  diagram: ProcessDiagram;
  selected?: string | null;
  linked: ProcessWorkspaceProps["linked"];
  docs?: Record<string, string>;
  onSelect: (id: string | null) => void;
  onOpenRecord: (id: string) => void;
}) {
  const { t } = useText();
  const kindLabel = useKindLabel();
  const s = diagram.shapes.find((x) => x.id === selected);
  if (!s) {
    return (
      <EmptyState
        plain
        icon="info"
        title={t("ui.bpmn-src-views.processes-no-element-selected")}
        body={t(
          "ui.bpmn-src-views.processes-click-shape-shows-type-lane-flows",
        )}
      />
    );
  }
  const byId = (id?: string) => diagram.shapes.find((x) => x.id === id);
  const incoming = diagram.edges.filter((e) => e.to === s.id);
  const outgoing = diagram.edges.filter((e) => e.from === s.id);
  const lane = byId(s.lane);
  const recs = linked[s.id] ?? [];
  const flow = (e: BpmnEdge, other?: BpmnShape) => (
    <button
      key={e.id}
      type="button"
      className="t-d-flow"
      onClick={() => onSelect(other?.id ?? null)}
    >
      <span className="t-d-flow__kind" data-kind={e.kind}>
        {kindLabel(e.kind)}
      </span>
      <span className="t-wrap">{other?.label || "—"}</span>
      {e.label ? <Badge plain>{e.label}</Badge> : null}
    </button>
  );
  return (
    <div
      className="t-stack t-anim-rise"
      style={{ gap: 14 }}
      data-testid="process-detail"
    >
      <div className="t-stack" style={{ gap: 4 }}>
        <span className="t-eyebrow">{kindLabel(s.kind)}</span>
        <span className="t-h2">
          {s.label || (
            <em className="t-muted">
              {t("ui.bpmn-src-views.processes-unnamed")}
            </em>
          )}
        </span>
      </div>
      <Facts
        rows={[
          [t("ui.bpmn-src-views.processes-lane"), lane?.label ?? "—"],
          [
            "Id",
            <span key="i" className="t-mono">
              {s.id}
            </span>,
          ],
          [
            "Position",
            <span
              key="p"
              className="t-mono"
            >{`${s.x}, ${s.y} · ${s.w}×${s.h}`}</span>,
          ],
        ]}
      />
      <div className="t-stack" style={{ gap: 6 }}>
        <span className="t-label">
          {t("ui.bpmn-src-views.processes-incoming-count", {
            count: incoming.length,
          })}
        </span>
        {incoming.length ? (
          incoming.map((e) => flow(e, byId(e.from)))
        ) : (
          <span className="t-meta">
            {t("ui.bpmn-src-views.processes-none-start-point")}
          </span>
        )}
      </div>
      <div className="t-stack" style={{ gap: 6 }}>
        <span className="t-label">
          {t("ui.bpmn-src-views.processes-outgoing-count", {
            count: outgoing.length,
          })}
        </span>
        {outgoing.length ? (
          outgoing.map((e) => flow(e, byId(e.to)))
        ) : (
          <span className="t-meta">
            {t("ui.bpmn-src-views.processes-none-end-point")}
          </span>
        )}
      </div>
      {docs?.[s.id] ? (
        <div className="t-stack" style={{ gap: 6 }}>
          <span className="t-label">
            {t("ui.bpmn-src-views.processes-documentation")}
          </span>
          <p className="t-ink2">{docs[s.id]}</p>
        </div>
      ) : null}
      <div className="t-stack" style={{ gap: 6 }}>
        <span className="t-label">
          {t("ui.bpmn-src-views.processes-linked-records-count", {
            count: recs.length,
          })}
        </span>
        {recs.length ? (
          recs.map((r) => (
            <button
              key={r.id}
              type="button"
              className="t-d-recordlink"
              onClick={() => onOpenRecord(r.id)}
            >
              <span className="t-mono t-wrap">{r.id}</span>
              <span className="t-meta t-clamp-2">{r.summary}</span>
            </button>
          ))
        ) : (
          <span className="t-meta">
            {t("ui.bpmn-src-views.processes-no-record-names-element")}
          </span>
        )}
      </div>
    </div>
  );
}

function Walkthrough({
  walk,
  onWalk,
}: {
  walk?: ProcessWalk | null;
  onWalk: NonNullable<ProcessWorkspaceProps["onWalk"]>;
}) {
  const { t } = useText();
  const kindLabel = useKindLabel();
  if (!walk) {
    return (
      <EmptyState
        plain
        icon="play"
        title={t("ui.bpmn-src-views.processes-walkthrough")}
        body={t("ui.bpmn-src-views.processes-step-step-start-end-gateway-you")}
        action={
          <Button variant="primary" icon="play" onClick={() => onWalk("start")}>
            {t("ui.bpmn-src-views.processes-begin-start")}
          </Button>
        }
      />
    );
  }
  return (
    <div className="t-stack" style={{ gap: 12 }} data-testid="process-walk">
      <div className="t-row t-row--between">
        <span className="t-h3">
          {t("ui.bpmn-src-views.processes-step-step", { step: walk.step })}
          <span className="t-muted">
            {t("ui.bpmn-src-views.processes-total", { total: walk.total })}
          </span>
        </span>
        <div className="t-row" style={{ gap: 4 }}>
          <IconButton
            icon="back"
            label={t("ui.bpmn-src-views.processes-step-back")}
            size="small"
            disabled={walk.step <= 1}
            onClick={() => onWalk("back")}
          />
          <IconButton
            icon="step"
            label={t("ui.bpmn-src-views.processes-next-step")}
            size="small"
            disabled={!!walk.choices?.length || walk.step >= walk.total}
            onClick={() => onWalk("next")}
          />
          <IconButton
            icon="stop"
            label={t("ui.bpmn-src-views.processes-end-walkthrough")}
            size="small"
            onClick={() => onWalk("stop")}
          />
        </div>
      </div>
      <div className="t-d-walkbar" aria-hidden="true">
        <span style={{ width: `${(walk.step / walk.total) * 100}%` }} />
      </div>
      <ol className="t-d-walklog">
        {walk.log.map((l, i) => (
          <li key={l.id} data-current={l.id === walk.current || undefined}>
            <span className="t-d-walklog__n t-mono">{i + 1}</span>
            <span className="t-stack" style={{ gap: 0 }}>
              <span>{l.label}</span>
              <span className="t-meta">{kindLabel(l.kind)}</span>
            </span>
          </li>
        ))}
      </ol>
      {walk.choices?.length ? (
        <div
          className="t-d-choice"
          role="group"
          aria-label={t("ui.bpmn-src-views.processes-choose-branch")}
        >
          <span className="t-label">
            {t("ui.bpmn-src-views.processes-choose-branch")}
          </span>
          {walk.choices.map((c) => (
            <Button
              key={c.edge}
              icon="branch"
              onClick={() => onWalk("choose", c.edge)}
            >
              {c.label} → {c.target}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Findings({
  findings,
  open,
  onToggle,
  onSelect,
}: {
  findings: ProcessFinding[];
  open?: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useText();
  const errors = findings.filter((f) => f.severity === "error").length;
  return (
    <section
      className="t-d-pfind"
      data-open={open || undefined}
      aria-label={t("ui.bpmn-src-views.processes-parser-findings")}
    >
      <button
        type="button"
        className="t-d-pfind__head"
        aria-expanded={!!open}
        onClick={onToggle}
      >
        <Icon name={findings.length ? "warning" : "check"} size={14} />
        <span>{t("ui.bpmn-src-views.processes-parser-findings")}</span>
        <Badge tone={errors ? "bad" : findings.length ? "warn" : "ok"}>
          {findings.length}
        </Badge>
        <span className="t-spacer" />
        <Icon name={open ? "chevronDown" : "up"} size={14} />
      </button>
      {open ? (
        <ul className="t-d-pfind__list">
          {findings.map((f) => (
            <li key={f.key} data-severity={f.severity}>
              <Badge
                tone={
                  f.severity === "error"
                    ? "bad"
                    : f.severity === "warning"
                      ? "warn"
                      : "neutral"
                }
              >
                {t(SEVERITY_KEY[f.severity])}
              </Badge>
              <span>{f.text}</span>
              <span className="t-spacer" />
              {f.element ? (
                <Button
                  size="small"
                  variant="quiet"
                  icon="eye"
                  onClick={() => onSelect(f.element as string)}
                >
                  {t("ui.bpmn-src-views.processes-show")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Minimap({
  diagram,
  viewport,
}: {
  diagram: ProcessDiagram;
  viewport: { x: number; y: number; w: number; h: number };
}) {
  const { t } = useText();
  const { box } = diagram;
  return (
    <svg
      className="t-d-minimap"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      role="img"
      aria-label={t("ui.bpmn-src-views.processes-minimap")}
    >
      {diagram.shapes.map((s) => (
        <rect
          key={s.id}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={s.kind === "participant" ? 4 : 2}
          data-kind={s.kind}
        />
      ))}
      <rect
        className="t-d-minimap__view"
        x={viewport.x}
        y={viewport.y}
        width={viewport.w}
        height={viewport.h}
      />
    </svg>
  );
}

export function ProcessWorkspace({
  name,
  file,
  diagram,
  metrics,
  selected,
  walk,
  panel,
  findings,
  findingsOpen,
  outlineQuery,
  zoom,
  viewport,
  linked,
  docs,
  diagrams = [],
  activeDiagram,
  mobile,
  outlineOpen,
  onDiagram = noop,
  onSelect = noop,
  onPanel = noop,
  onZoom = noop,
  onOutlineQuery = noop,
  onOutline = noop,
  onFindings = noop,
  onWalk = noop,
  onOpenRecord = noop,
  onBack = noop,
}: ProcessWorkspaceProps) {
  const { t, plural, number } = useText();
  const side: ReactNode = (
    <>
      <Tabs<"detail" | "walkthrough">
        label={t("ui.bpmn-src-views.processes-sidebar")}
        value={panel}
        onChange={onPanel}
        items={[
          { value: "detail", label: "Element" },
          {
            value: "walkthrough",
            label: t("ui.bpmn-src-views.processes-walkthrough"),
            count: walk ? `${walk.step}/${walk.total}` : undefined,
          },
        ]}
      />
      {panel === "detail" ? (
        <Detail
          diagram={diagram}
          selected={selected}
          linked={linked}
          docs={docs}
          onSelect={onSelect}
          onOpenRecord={onOpenRecord}
        />
      ) : (
        <Walkthrough walk={walk} onWalk={onWalk} />
      )}
    </>
  );
  const outline = (
    <Outline
      diagram={diagram}
      query={outlineQuery}
      selected={selected}
      onQuery={onOutlineQuery}
      onSelect={onSelect}
    />
  );
  const stats = [
    {
      key: "elements",
      value: number(metrics.elements),
      label: t("ui.bpmn-src-views.processes-elements"),
    },
    {
      key: "flows",
      value: number(metrics.flows),
      label: t("ui.bpmn-src-views.processes-flows"),
    },
    {
      key: "lanes",
      value: number(metrics.lanes),
      label: t("ui.bpmn-src-views.processes-lanes"),
    },
    {
      key: "paths",
      value: metrics.paths == null ? "—" : number(metrics.paths),
      label: t("ui.bpmn-src-views.processes-paths-start-end"),
    },
    {
      key: "longest",
      value: metrics.longest == null ? "—" : number(metrics.longest),
      label: t("ui.bpmn-src-views.processes-longest-path"),
    },
  ];
  // On a phone the zoom buttons sit in the sticky bar above the canvas: floating over the canvas they
  // were covered by the element sheet and scrolled away with a small diagram. Pinch alone is not enough.
  const zoomBar = (
    <div
      className="t-d-proc__zoom"
      role="toolbar"
      aria-label="Zoom"
      data-compact={mobile || undefined}
    >
      <IconButton
        icon="zoomOut"
        label={t("ui.bpmn-src-views.processes-zoom-out")}
        size="small"
        onClick={() => onZoom("out")}
      />
      <span className="t-mono t-meta" data-testid="zoom">
        {t("ui.bpmn-src-views.processes-value", { value: zoom })}
      </span>
      <IconButton
        icon="zoomIn"
        label={t("ui.bpmn-src-views.processes-zoom")}
        size="small"
        onClick={() => onZoom("in")}
      />
      <IconButton
        icon="fit"
        label={t("ui.bpmn-src-views.processes-fit")}
        size="small"
        onClick={() => onZoom("fit")}
      />
    </div>
  );
  return (
    <div className="t-d-proc" data-mobile={mobile || undefined}>
      <header className="t-d-proc__top">
        <IconButton
          icon="back"
          label={t("ui.bpmn-src-views.processes-all-processes")}
          onClick={onBack}
        />
        <div className="t-stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="t-h3 t-wrap">{name}</span>
          <span className="t-mono t-meta t-wrap">{file}</span>
        </div>
        <span className="t-spacer" />
        {mobile ? null : (
          <div className="t-d-proc__stats">
            <Stat
              value={metrics.elements}
              label={t("ui.bpmn-src-views.processes-elements")}
            />
            <Stat
              value={metrics.flows}
              label={t("ui.bpmn-src-views.processes-flows")}
            />
            <Stat
              value={metrics.lanes}
              label={t("ui.bpmn-src-views.processes-lanes")}
            />
            <Stat
              value={metrics.paths ?? "—"}
              label={t("ui.bpmn-src-views.processes-paths-start-end")}
            />
            <Stat
              value={metrics.longest ?? "—"}
              label={t("ui.bpmn-src-views.processes-longest-path")}
            />
          </div>
        )}
        <Button
          variant={walk ? "default" : "primary"}
          icon={walk ? "stop" : "play"}
          onClick={() => onWalk(walk ? "stop" : "start")}
        >
          {walk
            ? t("ui.bpmn-src-views.processes-end-walkthrough")
            : t("ui.bpmn-src-views.processes-walkthrough")}
        </Button>
      </header>
      {diagrams.length > 1 ? (
        <nav
          className="t-d-chipbar t-d-proc__diagrams"
          aria-label={t("ui.bpmn-src-views.processes-diagrams-file")}
        >
          <span className="t-label">
            {plural(
              "ui.bpmn-src-views.processes-count-diagrams",
              diagrams.length,
            )}
          </span>
          {diagrams.map((d) => (
            <Chip
              key={d.id}
              icon="flow"
              pressed={d.id === activeDiagram}
              count={d.elements}
              onClick={() => onDiagram(d.id)}
            >
              {d.name}
            </Chip>
          ))}
        </nav>
      ) : null}
      {mobile ? (
        <div className="t-d-mobilebar t-d-proc__mobilebar">
          <Button size="small" icon="tree" onClick={onOutline}>
            {t("ui.bpmn-src-views.processes-outline")}
          </Button>
          {zoomBar}
          <ul className="t-d-proc__mstats" data-testid="process-mobile-stats">
            {stats.map((s) => (
              <li key={s.key}>
                <span className="t-mono">{s.value}</span> {s.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="t-d-proc__body">
        {mobile ? null : <aside className="t-d-proc__left">{outline}</aside>}
        <div className="t-d-proc__canvas" data-zoom={zoom}>
          <div
            className="t-d-proc__stage"
            style={{ transform: `scale(${zoom / 100})` }}
          >
            <ProcessCanvas
              diagram={diagram}
              selected={selected}
              walk={walk}
              label={t("ui.bpmn-src-views.processes-diagram-name", { name })}
              onSelect={onSelect}
            />
          </div>
          {mobile ? null : zoomBar}
          {viewport && !mobile ? (
            <div className="t-d-proc__mini">
              <Minimap diagram={diagram} viewport={viewport} />
            </div>
          ) : null}
        </div>
        {mobile ? null : <aside className="t-d-proc__right">{side}</aside>}
      </div>
      <Findings
        findings={findings}
        open={findingsOpen}
        onToggle={onFindings}
        onSelect={(id) => onSelect(id)}
      />
      {mobile ? (
        <>
          <Sheet
            open={!!outlineOpen}
            side="bottom"
            title={t("ui.bpmn-src-views.processes-outline")}
            onClose={onOutline}
          >
            {outline}
          </Sheet>
          <Sheet
            open={!!selected || !!walk}
            side="bottom"
            title={
              walk ? t("ui.bpmn-src-views.processes-walkthrough") : "Element"
            }
            onClose={() => (walk ? onWalk("stop") : onSelect(null))}
            modal={false}
          >
            {side}
          </Sheet>
        </>
      ) : null}
    </div>
  );
}

/** The file exists but the parser could not read it. */
export function ProcessUnreadable({
  file,
  error,
  line,
  excerpt,
  onBack = noop,
  onRetry = noop,
}: {
  file: string;
  error: string;
  line: number;
  excerpt: { n: number; text: string }[];
  onBack?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useText();
  return (
    <div className="t-page t-stack" style={{ gap: 20 }}>
      <PluginHead
        icon="flow"
        title={t("ui.bpmn-src-views.processes-file-not-readable")}
        sentence={<span className="t-mono">{file}</span>}
        actions={
          <>
            <Button variant="quiet" icon="back" onClick={onBack}>
              {t("ui.bpmn-src-views.processes-all-processes")}
            </Button>
            <Button variant="primary" icon="refresh" onClick={onRetry}>
              {t("ui.bpmn-src-views.processes-read-again")}
            </Button>
          </>
        }
      />
      <div className="t-d-banner" data-tone="bad" role="alert">
        <Icon name="error" size={18} />
        <div className="t-stack" style={{ gap: 2 }}>
          <strong>
            {t("ui.bpmn-src-views.processes-bpmn-sidecar-rejected-file")}
          </strong>
          <span>
            {t("ui.bpmn-src-views.processes-error-line-line", { error, line })}
          </span>
          <span className="t-meta">
            {t(
              "ui.bpmn-src-views.processes-other-processes-not-affected-repair-file",
            )}
          </span>
        </div>
      </div>
      <pre
        className="t-d-excerpt"
        aria-label={t("ui.bpmn-src-views.processes-excerpt")}
      >
        {excerpt.map((l) => (
          <span key={l.n} data-bad={l.n === line || undefined}>
            <span className="t-d-excerpt__n">{l.n}</span>
            {l.text}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}
