/** Processes in Atlas: the bridge from what the BPMN plugin's sidecar
 * answers (`bpmn.diagram`, a drawing model) to the props of the Atlas process
 * views (`views.Process*`). */

import type * as views from "../views/Processes";
import type { BpmnDocument, Diagram, Edge, Label, Shape } from "../model";

/** What the views print where a figure was not measured. */
export const UNMEASURED = "—";

/** A figure that is a count, or the honest absence of one. */
export type Measured = number | typeof UNMEASURED;

export type ProcessGraph = {
  /** Start events, in drawing order. */
  starts: string[];
  /** Outgoing sequence flows per element id. */
  out: Record<string, { edge: string; to: string }[]>;
};

export type MappedDiagram = {
  id: string;
  name: string;
  diagram: views.ProcessDiagram;
  /** Elements as the outline counts them: no pools, lanes or groups. */
  elements: number;
  metrics: {
    elements: number;
    flows: number;
    lanes: number;
    paths: number | null;
    longest: number | null;
  };
  findings: views.ProcessFinding[];
  graph: ProcessGraph;
};

export type MappedProcess = {
  file: string;
  name: string;
  diagrams: MappedDiagram[];
  /** Everything the sidecar warned about in this file. */
  warnings: string[];
};

/** Slack, in diagram units, within which a waypoint counts as touching a shape. */
const TOUCH = 2;

const isFrame = (s: Shape) => s.form === "lane" || s.kind === "lane";
const isPool = (s: { kind: string }) => s.kind === "participant";
/** A group frames elements for the reader; it is neither a flow node nor the end of a flow. */
const isGroup = (s: Shape) => s.form === "group" || s.kind === "group";
/** Pools, lanes and groups hold other elements and are never counted as one. */
const isContainer = (s: Shape) => isFrame(s) || isPool(s) || isGroup(s);

/** The sidecar's label box as the canvas takes it; absent when the sidecar placed none. */
function labelBox(l: Label | undefined): views.BpmnLabel | undefined {
  if (!l) return undefined;
  return {
    x: l.x,
    y: l.y,
    w: l.w,
    h: l.h,
    lines: l.lines,
    ...(l.vertical ? { vertical: true } : {}),
    ...(l.align ? { align: l.align } : {}),
  };
}

/** Drops the keys the sidecar left out, so an absent field stays absent in the props. */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as T;
}

function touches(s: Shape, p: { x: number; y: number }): boolean {
  const inside =
    p.x >= s.x - TOUCH &&
    p.x <= s.x + s.w + TOUCH &&
    p.y >= s.y - TOUCH &&
    p.y <= s.y + s.h + TOUCH;
  if (!inside) return false;
  const nearEdge =
    Math.min(Math.abs(p.x - s.x), Math.abs(p.x - (s.x + s.w))) <= TOUCH ||
    Math.min(Math.abs(p.y - s.y), Math.abs(p.y - (s.y + s.h))) <= TOUCH;
  return nearEdge;
}

/** The shape an edge's end touches: the smallest one whose outline passes
 * through the waypoint. The sidecar does not name an edge's source and target,
 * so this is measured from the geometry or left undefined. Lanes and pools are
 * containers, never the end of a flow: a waypoint on a pool's border alone
 * leaves the end unresolved, so the figures that depend on it read unmeasured. */

function endShape(
  shapes: Shape[],
  p: { x: number; y: number },
): string | undefined {
  let best: Shape | undefined;
  for (const s of shapes) {
    if (isContainer(s) || !touches(s, p)) continue;
    if (!best || s.w * s.h < best.w * best.h) best = s;
  }
  return best?.element;
}

function mapEdge(shapes: Shape[], e: Edge): views.BpmnEdge {
  const first = e.points[0];
  const last = e.points[e.points.length - 1];
  return defined({
    id: e.element,
    kind: e.kind,
    label: e.name,
    points: e.points.map((p) => [p.x, p.y] as [number, number]),
    from: first ? endShape(shapes, first) : undefined,
    to: last ? endShape(shapes, last) : undefined,
    stroke: e.stroke,
    start: e.start,
    end: e.end,
    labelBox: labelBox(e.label),
  });
}

const MAX_PATHS = 500;

/** The most nodes the path count may visit in total. Branching without an end
 * event (or a cycle feeding gateways) grows the walk exponentially, and
 * `MAX_PATHS` only bounds walks that reach an end event; this bounds them all. */

export const STEP_BUDGET = 100_000;

/** Paths from start events to end events over sequence flows. `null` when the
 * figure cannot be measured: a flow end is unresolved, there is no start, the
 * count does not finish within `MAX_PATHS` / `STEP_BUDGET`, no walk reaches an
 * end event, or a walk stops at a node that has no outgoing flow and is not an
 * end event. A walk that only loops back to nodes already on it is a cycle,
 * not a path, and is not counted. */

function measurePaths(
  d: views.ProcessDiagram,
  graph: ProcessGraph,
): { paths: number; longest: number } | null {
  const flows = d.edges.filter((e) => e.kind === "sequenceFlow");
  if (flows.some((e) => !e.from || !e.to)) return null;
  if (!graph.starts.length) return null;
  const kind = new Map(d.shapes.map((s) => [s.id, s.kind]));
  let paths = 0;
  let longest = 0;
  let steps = 0;
  let unmeasurable = false;
  const onPath = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (unmeasurable) return;
    steps += 1;
    if (steps > STEP_BUDGET) {
      unmeasurable = true;
      return;
    }
    if (kind.get(id) === "endEvent") {
      paths += 1;
      longest = Math.max(longest, depth);
      if (paths > MAX_PATHS) unmeasurable = true;
      return;
    }
    const out = graph.out[id] ?? [];
    if (!out.length) {
      unmeasurable = true;
      return;
    }
    onPath.add(id);
    for (const o of out) if (!onPath.has(o.to)) walk(o.to, depth + 1);
    onPath.delete(id);
  };
  for (const s of graph.starts) walk(s, 1);
  if (unmeasurable || paths === 0) return null;
  return { paths, longest };
}

/** The part of a warning before the first ": ", the way the sidecar names what it is about. */
function warningSubject(w: string): string | undefined {
  const at = w.indexOf(": ");
  return at > 0 ? w.slice(0, at) : undefined;
}

function mapDiagram(doc: BpmnDocument, d: Diagram): MappedDiagram {
  // Pools and lanes go to the canvas as shapes of their kind, which draws them as containers.
  const shapes = d.shapes;
  const pools = shapes.filter(isPool);
  const mapped: views.BpmnShape[] = shapes.map((s) => {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const pool = isPool(s)
      ? undefined
      : pools
          .filter(
            (p) => cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h,
          )
          .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    return defined({
      id: s.element,
      kind: s.kind,
      label: s.name,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      lane: pool?.element,
      form: s.form,
      border: s.border,
      dashed: s.dashed,
      symbol: s.symbol,
      filled: s.filled,
      markers: s.markers,
      collection: s.collection,
      labelBox: labelBox(s.label),
    });
  });
  const edges = d.edges.map((e) => mapEdge(d.shapes, e));
  const diagram: views.ProcessDiagram = {
    shapes: mapped,
    edges,
    box: { x: d.bounds.x, y: d.bounds.y, w: d.bounds.w, h: d.bounds.h },
  };

  const graph: ProcessGraph = {
    starts: mapped.filter((s) => s.kind === "startEvent").map((s) => s.id),
    out: {},
  };
  for (const e of edges) {
    if (e.kind !== "sequenceFlow" || !e.from || !e.to) continue;
    (graph.out[e.from] ??= []).push({ edge: e.id, to: e.to });
  }

  // A warning belongs to a diagram when it names one of that diagram's shapes
  // or edges (by drawing id or by element id). One that names nothing here,
  // such as a ghost shape, is about the file and is shown on every diagram.
  const mine = new Map<string, string | undefined>();
  for (const s of d.shapes) {
    mine.set(s.id, s.element);
    mine.set(s.element, s.element);
  }
  for (const e of d.edges) {
    mine.set(e.id, undefined);
    mine.set(e.element, undefined);
  }
  const everyone = new Set(
    doc.diagrams.flatMap((x) =>
      [...x.shapes, ...x.edges].flatMap((i) => [i.id, i.element]),
    ),
  );
  const findings: views.ProcessFinding[] = [];
  doc.warnings.forEach((w, i) => {
    const subject = warningSubject(w);
    const here = subject !== undefined && mine.has(subject);
    const elsewhere = subject !== undefined && !here && everyone.has(subject);
    if (elsewhere) return;
    const element = here ? mine.get(subject) : undefined;
    findings.push({
      key: `w${i + 1}`,
      severity: "warning",
      text: w,
      ...(element ? { element } : {}),
    });
  });

  // The sidecar counts nothing itself; containers are not elements.
  const elements = shapes.filter((s) => !isContainer(s)).length;
  const measured = measurePaths(diagram, graph);
  return {
    id: d.id,
    name: d.name,
    diagram,
    elements,
    metrics: {
      elements,
      flows: edges.length,
      lanes: d.shapes.filter((s) => isPool(s) || isFrame(s)).length,
      paths: measured ? measured.paths : null,
      longest: measured ? measured.longest : null,
    },
    findings,
    graph,
  };
}

/** A file name without directory and extension, for a file that names nothing itself. */
export function fileStem(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.bpmn$/i, "");
}

export function mapProcess(path: string, doc: BpmnDocument): MappedProcess {
  return {
    file: path,
    name: doc.name || fileStem(path),
    diagrams: doc.diagrams.map((d) => mapDiagram(doc, d)),
    warnings: doc.warnings,
  };
}

const NO_DIAGRAM: views.ProcessDiagram = {
  shapes: [],
  edges: [],
  box: { x: 0, y: 0, w: 0, h: 0 },
};

/** The gallery card of a file. The first diagram is the thumbnail. The sidecar
 * and the host give neither a modification time nor a link from a process to
 * records, so `updatedAt` is unmeasured and `records` is 0: the model has no
 * process-to-record relation to count. */

export function summarize(p: MappedProcess): views.ProcessSummary {
  const first = p.diagrams[0];
  return {
    file: p.file,
    name: p.name,
    shapes: p.diagrams.reduce((n, d) => n + d.elements, 0),
    edges: p.diagrams.reduce((n, d) => n + d.metrics.flows, 0),
    lanes: p.diagrams.reduce((n, d) => n + d.metrics.lanes, 0),
    warnings: p.warnings.length,
    // The model carries no link from a process to its records: unmeasured, not zero.
    records: null,
    updatedAt: UNMEASURED,
    thumb: first?.diagram ?? NO_DIAGRAM,
  };
}

/** Walk-through ----------------------------------------------------------------------------- */

export type WalkState = { step: number; choices: Record<string, string> };

/** The nodes and flows the walk has reached, following the reader's choices at gateways. */
export function walkPath(
  m: MappedDiagram,
  choices: Record<string, string>,
): { nodes: string[]; edges: string[]; open?: string } {
  const nodes: string[] = [];
  const edges: string[] = [];
  let cur: string | undefined = m.graph.starts[0];
  while (cur && !nodes.includes(cur)) {
    nodes.push(cur);
    const out: { edge: string; to: string }[] = m.graph.out[cur] ?? [];
    if (out.length > 1 && !choices[cur]) return { nodes, edges, open: cur };
    const pick: { edge: string; to: string } | undefined =
      out.length > 1
        ? out.find((o) => o.edge === choices[cur as string])
        : out[0];
    if (!pick) break;
    edges.push(pick.edge);
    cur = pick.to;
  }
  return { nodes, edges };
}

/** The walk the views show at `state.step`, or `null` while no walk is running. */
export function walkAt(
  m: MappedDiagram,
  state: WalkState,
): views.ProcessWalk | null {
  if (state.step < 1) return null;
  const path = walkPath(m, state.choices);
  if (!path.nodes.length) return null;
  const step = Math.min(state.step, path.nodes.length);
  const visited = path.nodes.slice(0, step);
  const current = visited[visited.length - 1];
  const byId = new Map(m.diagram.shapes.map((s) => [s.id, s]));
  const choices =
    path.open && path.open === current
      ? (m.graph.out[current] ?? []).map((o) => ({
          edge: o.edge,
          label: m.diagram.edges.find((e) => e.id === o.edge)?.label ?? "",
          target: byId.get(o.to)?.label || o.to,
        }))
      : undefined;
  return {
    step,
    total: path.nodes.length,
    visited,
    edges: path.edges.slice(0, step - 1),
    current,
    choices,
    log: visited.map((id) => ({
      id,
      label: byId.get(id)?.label || id,
      kind: byId.get(id)?.kind ?? "",
    })),
  };
}

/** Unreadable files ------------------------------------------------------------------------- */

export type Unreadable = {
  error: string;
  /** The line the parser stopped at, when its message names one. */
  line?: number;
  excerpt: { n: number; text: string }[];
};

/** What the unreadable-file view needs: the parser's own message, the line it
 * names (if it names one) and the lines around it from the text that was read. */

export function describeUnreadable(
  error: string,
  xml: string | null,
): Unreadable {
  const named = /\bline (\d+)\b/.exec(error);
  const line = named ? Number(named[1]) : undefined;
  const lines = xml === null ? [] : xml.split(/\r?\n/);
  const excerpt =
    line === undefined
      ? []
      : lines
          .map((text, i) => ({ n: i + 1, text }))
          .filter((l) => Math.abs(l.n - line) <= 2);
  return {
    error: error.replace(/^(?:\S+\.bpmn: )?(?:bpmn: )?/, ""),
    line,
    excerpt,
  };
}
