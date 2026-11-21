import type { BpmnDocument, Edge, Shape } from "../model";
import datenweg from "./testdata/bpmn-diagram-data-flow.json";
import order from "./testdata/bpmn-diagram-order.json";
import syntaxError from "./testdata/bpmn-error-syntax.json";
import {
  STEP_BUDGET,
  UNMEASURED,
  describeUnreadable,
  mapProcess,
  summarize,
  walkAt,
  walkPath,
} from "./model";
import { inEnglish } from "../../../shared/language.spec-support";

inEnglish();

// Both documents are real `bpmn.diagram` answers of the repository's own BPMN
// files, captured by running the sidecar (see testdata/README in the commit).
const DATENWEG = datenweg as unknown as BpmnDocument;
const ORDER = order as unknown as BpmnDocument;

describe("mapProcess on the repository's own datenweg diagram", () => {
  const p = mapProcess("docs/bpmn/bpmn-plugin-datenweg.bpmn", DATENWEG);
  const d = p.diagrams[0];

  it("keeps the fixture honest: three pools, one diagram, no warnings", () => {
    expect(DATENWEG.diagrams).toHaveLength(1);
    expect(
      DATENWEG.diagrams[0].shapes.filter((s) => s.kind === "participant"),
    ).toHaveLength(3);
    expect(DATENWEG.warnings).toEqual([]);
  });

  it("takes names, element ids and the bounds from the sidecar unchanged", () => {
    expect(p.name).toBe("BPMN plugin data flow");
    expect(d.diagram.shapes.find((s) => s.id === "P_Leser")).toMatchObject({
      kind: "participant",
      label: "Atlas (Browser)",
    });
    expect(d.diagram.box).toEqual(DATENWEG.diagrams[0].bounds);
  });

  it("assigns each element to the pool whose area holds it", () => {
    const lane = (id: string) =>
      d.diagram.shapes.find((s) => s.id === id)?.lane;
    expect(lane("T_Lesen")).toBe("P_Leser");
    expect(lane("T_Parsen")).toBe("P_Sidecar");
    expect(lane("P_Leser")).toBeUndefined();
  });

  it("resolves each flow's ends from where its waypoints touch shapes", () => {
    const ends = (id: string) => {
      const e = d.diagram.edges.find((x) => x.id === id);
      return [e?.from, e?.to];
    };
    expect(ends("F1")).toEqual(["S_Wahl", "T_Lesen"]);
    expect(ends("F_Fehler")).toEqual(["G_Ok", "T_Fehler"]);
    expect(ends("MF_Call")).toEqual(["T_Vermitteln", "T_Parsen"]);
  });

  it("leaves an end undefined when no shape's outline passes through the waypoint", () => {
    const moved: BpmnDocument = JSON.parse(
      JSON.stringify(DATENWEG),
    ) as BpmnDocument;
    const flow = moved.diagrams[0].edges.find((e) => e.element === "F1");
    if (!flow) throw new Error("fixture lacks F1");
    flow.points[flow.points.length - 1] = { x: 5000, y: 5000 };
    const e = mapProcess("x.bpmn", moved).diagrams[0].diagram.edges.find(
      (x) => x.id === "F1",
    );
    expect(e?.from).toBe("S_Wahl");
    expect(e?.to).toBeUndefined();
  });

  it("passes the sidecar's drawing vocabulary for shapes and flows unchanged", () => {
    const src = DATENWEG.diagrams[0];
    const shape = (id: string) => d.diagram.shapes.find((s) => s.id === id);
    const edge = (id: string) => d.diagram.edges.find((e) => e.id === id);
    const pool = src.shapes.find((s) => s.element === "P_Leser");
    expect(shape("P_Leser")).toMatchObject({
      form: "pool",
      labelBox: pool?.label,
    });
    expect(shape("P_Leser")?.labelBox?.vertical).toBe(true);
    expect(shape("T_Lesen")).toMatchObject({
      form: "roundrect",
      symbol: "user",
    });
    expect(shape("E_Fertig")).toMatchObject({
      form: "circle",
      border: "thick",
      filled: true,
    });
    expect(shape("TA_Host")?.form).toBe("bracket");
    // A field the sidecar left out stays absent instead of arriving as undefined or a default.
    expect(Object.keys(shape("T_Uebergeben") ?? {})).not.toContain("symbol");
    expect(edge("MF_Read")).toMatchObject({
      kind: "messageFlow",
      stroke: "dashed",
      start: "circle",
      end: "open-arrow",
      labelBox: src.edges.find((e) => e.element === "MF_Read")?.label,
    });
    expect(edge("F_Fehler")).toMatchObject({
      stroke: "solid",
      start: "slash",
      end: "arrow",
    });
    expect(edge("A_Host")).toMatchObject({
      kind: "association",
      stroke: "dotted",
    });
    expect(Object.keys(edge("A_Host") ?? {})).not.toContain("end");
  });

  it("counts elements, flows and swim lanes from the drawing", () => {
    expect(d.metrics.elements).toBe(12);
    expect(d.metrics.flows).toBe(15);
    expect(d.metrics.lanes).toBe(3);
  });

  it("measures the paths from start to end event and the longest one", () => {
    expect(d.metrics.paths).toBe(2);
    expect(d.metrics.longest).toBe(6);
  });

  it("reports paths and longest as unmeasured when a sequence flow has an unresolved end", () => {
    const moved: BpmnDocument = JSON.parse(
      JSON.stringify(DATENWEG),
    ) as BpmnDocument;
    const flow = moved.diagrams[0].edges.find((e) => e.element === "F2");
    if (!flow) throw new Error("fixture lacks F2");
    flow.points[0] = { x: 5000, y: 5000 };
    const m = mapProcess("x.bpmn", moved).diagrams[0].metrics;
    expect(m.paths).toBeNull();
    expect(m.longest).toBeNull();
  });

  it("summarizes the file for the gallery with the unmeasured mark where nothing was measured", () => {
    const s = summarize(p);
    expect(s).toMatchObject({
      file: "docs/bpmn/bpmn-plugin-datenweg.bpmn",
      shapes: 12,
      edges: 15,
      lanes: 3,
      warnings: 0,
      records: null,
      updatedAt: UNMEASURED,
    });
    expect(s.thumb).toBe(d.diagram);
  });
});

describe("mapProcess on the repository's own order diagram", () => {
  const p = mapProcess(
    "plugins/bpmn/sidecar/diagram/testdata/order.bpmn",
    ORDER,
  );
  const d = p.diagrams[0];

  it("keeps the fixture honest: it carries lanes and the sidecar's own warning", () => {
    expect(ORDER.diagrams[0].shapes.some((s) => s.kind === "lane")).toBe(true);
    expect(ORDER.warnings).toHaveLength(1);
  });

  it("passes lanes as lane shapes and counts them as lanes, not as elements", () => {
    const lanes = d.diagram.shapes.filter((s) => s.kind === "lane");
    expect(lanes.map((s) => s.id)).toEqual(["Lane_Sales", "Lane_Warehouse"]);
    expect(lanes.every((s) => s.form === "lane")).toBe(true);
    const frames = ORDER.diagrams[0].shapes.filter(
      (s) => s.kind === "lane" || s.kind === "participant",
    );
    expect(d.metrics.lanes).toBe(frames.length);
    expect(d.metrics.elements).toBe(
      ORDER.diagrams[0].shapes.length - frames.length,
    );
    expect(summarize(p).shapes).toBe(d.metrics.elements);
  });

  it("passes the sidecar's markers, symbols and borders to the canvas", () => {
    const shape = (id: string) => d.diagram.shapes.find((s) => s.id === id);
    expect(shape("Task_Check")).toMatchObject({
      symbol: "user",
      markers: ["sequential"],
    });
    expect(shape("Sub_Reorder")?.markers).toEqual(["collapsed"]);
    expect(shape("BE_Timer")).toMatchObject({
      form: "circle",
      border: "double",
      symbol: "timer",
    });
    expect(shape("DS_Stock")?.form).toBe("datastore");
  });

  it("turns the sidecar's warning into a finding without inventing an element", () => {
    expect(d.findings).toEqual([
      { key: "w1", severity: "warning", text: ORDER.warnings[0] },
    ]);
    expect(summarize(p).warnings).toBe(1);
  });

  it("lets a warning that names a shape of this diagram select that shape", () => {
    const shape = ORDER.diagrams[0].shapes.find((s) => s.kind === "userTask");
    const doc: BpmnDocument = {
      ...ORDER,
      warnings: [`${shape?.id}: drawn twice`],
    };
    const f = mapProcess("x.bpmn", doc).diagrams[0].findings;
    expect(f).toEqual([
      {
        key: "w1",
        severity: "warning",
        text: `${shape?.id}: drawn twice`,
        element: shape?.element,
      },
    ]);
  });
});

type Node = { id: string; kind: string };
const BOX = 40;
function drawn(
  nodes: Node[],
  flows: [string, string][],
  extra: Shape[] = [],
): BpmnDocument {
  const at = new Map(
    nodes.map((n, i) => [
      n.id,
      { x: (i % 50) * 100, y: Math.floor(i / 50) * 100 },
    ]),
  );
  const shapes: Shape[] = nodes.map((n) => {
    const p = at.get(n.id)!;
    return {
      id: `${n.id}_di`,
      element: n.id,
      kind: n.kind,
      name: n.id,
      form: "rect",
      border: "single",
      x: p.x,
      y: p.y,
      w: BOX,
      h: BOX,
    };
  });
  const edges: Edge[] = flows.map(([from, to], i) => {
    const a = at.get(from)!;
    const b = at.get(to)!;
    return {
      id: `F${i}_di`,
      element: `F${i}`,
      kind: "sequenceFlow",
      name: "",
      stroke: "solid",
      points: [
        { x: a.x + BOX, y: a.y + BOX / 2 },
        { x: b.x, y: b.y + BOX / 2 },
      ],
    };
  });
  return {
    id: "hand",
    name: "Hand",
    diagrams: [
      {
        id: "D",
        name: "D",
        bounds: { x: 0, y: 0, w: 5000, h: 5000 },
        shapes: [...extra, ...shapes],
        edges,
      },
    ],
    warnings: [],
  };
}
const metricsOf = (doc: BpmnDocument) =>
  mapProcess("hand.bpmn", doc).diagrams[0].metrics;

/** A chain of `n` XOR diamonds: each gateway splits into two tasks that join at the next one. */
function diamonds(n: number, end: Node): BpmnDocument {
  const nodes: Node[] = [{ id: "S", kind: "startEvent" }];
  const flows: [string, string][] = [["S", "G0"]];
  for (let i = 0; i < n; i++) {
    nodes.push(
      { id: `G${i}`, kind: "exclusiveGateway" },
      { id: `A${i}`, kind: "task" },
      { id: `B${i}`, kind: "task" },
    );
    flows.push(
      [`G${i}`, `A${i}`],
      [`G${i}`, `B${i}`],
      [`A${i}`, `G${i + 1}`],
      [`B${i}`, `G${i + 1}`],
    );
  }
  nodes.push({ id: `G${n}`, kind: "exclusiveGateway" }, end);
  flows.push([`G${n}`, end.id]);
  return drawn(nodes, flows);
}

describe("the path count on hand-made diagrams", () => {
  it("counts the paths of a normal diagram", () => {
    const m = metricsOf(diamonds(2, { id: "E", kind: "endEvent" }));
    // S, G0, A0|B0, G1, A1|B1, G2, E: four paths of seven nodes each.
    expect(m.paths).toBe(4);
    expect(m.longest).toBe(7);
  });

  it("counts the way out of a cycle and not the loop itself", () => {
    const doc = drawn(
      [
        { id: "S", kind: "startEvent" },
        { id: "T", kind: "task" },
        { id: "G", kind: "exclusiveGateway" },
        { id: "E", kind: "endEvent" },
      ],
      [
        ["S", "T"],
        ["T", "G"],
        ["G", "T"],
        ["G", "E"],
      ],
    );
    expect(metricsOf(doc)).toMatchObject({ paths: 1, longest: 4 });
  });

  it("reports a diagram without an end event as unmeasured, not as zero paths", () => {
    const doc = drawn(
      [
        { id: "S", kind: "startEvent" },
        { id: "T", kind: "task" },
        { id: "G", kind: "exclusiveGateway" },
      ],
      [
        ["S", "T"],
        ["T", "G"],
        ["G", "T"],
      ],
    );
    expect(metricsOf(doc)).toMatchObject({ paths: null, longest: null });
  });

  it("reports a walk that stops at a node other than an end event as unmeasured", () => {
    const doc = drawn(
      [
        { id: "S", kind: "startEvent" },
        { id: "G", kind: "exclusiveGateway" },
        { id: "T", kind: "task" },
        { id: "E", kind: "endEvent" },
      ],
      [
        ["S", "G"],
        ["G", "T"],
        ["G", "E"],
      ],
    );
    expect(metricsOf(doc)).toMatchObject({ paths: null, longest: null });
  });

  it("gives up on a 30-diamond chain within the step budget and reports it unmeasured", () => {
    expect(2 ** 30).toBeGreaterThan(STEP_BUDGET);
    const doc = diamonds(30, { id: "T", kind: "task" });
    const back = doc.diagrams[0].edges[doc.diagrams[0].edges.length - 1];
    const t = doc.diagrams[0].shapes.find((x) => x.element === "T")!;
    const g0 = doc.diagrams[0].shapes.find((x) => x.element === "G0")!;
    doc.diagrams[0].edges.push({
      ...back,
      id: "Back_di",
      element: "Back",
      points: [
        { x: t.x + BOX, y: t.y + BOX / 2 },
        { x: g0.x, y: g0.y + BOX / 2 },
      ],
    });
    const t0 = Date.now();
    const m = metricsOf(doc);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(m).toMatchObject({ paths: null, longest: null });
  });

  it("reports more paths than it may count as unmeasured", () => {
    // 2^10 = 1024 paths, all reaching the end event: over MAX_PATHS (500).
    const m = metricsOf(diamonds(10, { id: "E", kind: "endEvent" }));
    expect(m).toMatchObject({ paths: null, longest: null });
    // The precondition: below the cap, the same chain is counted.
    expect(metricsOf(diamonds(8, { id: "E", kind: "endEvent" })).paths).toBe(
      256,
    );
  });

  it("leaves a flow end on a pool's border unresolved, so the figures read unmeasured", () => {
    const doc = drawn(
      [
        { id: "S", kind: "startEvent" },
        { id: "E", kind: "endEvent" },
      ],
      [["S", "E"]],
      [
        {
          id: "P_di",
          element: "P",
          kind: "participant",
          name: "Pool",
          form: "pool",
          border: "single",
          x: -20,
          y: -20,
          w: 400,
          h: 200,
        },
      ],
    );
    // The precondition: with both ends on their shapes the diagram is counted.
    expect(metricsOf(doc).paths).toBe(1);
    const flow = doc.diagrams[0].edges[0];
    flow.points[1] = { x: 380, y: 80 };
    const d = mapProcess("hand.bpmn", doc).diagrams[0];
    expect(d.diagram.edges[0].to).toBeUndefined();
    expect(d.metrics).toMatchObject({ paths: null, longest: null });
  });
});

describe("a group around two tasks", () => {
  const group: Shape = {
    id: "Grp_di",
    element: "Grp",
    kind: "group",
    name: "Group",
    form: "group",
    border: "dashed",
    x: -10,
    y: -10,
    w: 160,
    h: 60,
  };
  const withGroup = () =>
    drawn(
      [
        { id: "A", kind: "task" },
        { id: "B", kind: "task" },
      ],
      [["A", "B"]],
      [group],
    );

  it("keeps the group out of the element count and leaves a flow end on its border unresolved", () => {
    const doc = withGroup();
    // The precondition: the group is drawn around both tasks, and the flow's
    // ends sit on the tasks.
    expect(doc.diagrams[0].shapes.map((s) => s.element)).toEqual([
      "Grp",
      "A",
      "B",
    ]);
    const before = mapProcess("hand.bpmn", doc).diagrams[0];
    expect([before.diagram.edges[0].from, before.diagram.edges[0].to]).toEqual([
      "A",
      "B",
    ]);
    expect(before.elements).toBe(2);
    expect(before.metrics.elements).toBe(2);
    expect(before.metrics.lanes).toBe(0);
    // The end moves onto the group's right border, 10 units clear of task B.
    doc.diagrams[0].edges[0].points[1] = { x: 150, y: 20 };
    const after = mapProcess("hand.bpmn", doc).diagrams[0];
    expect(after.diagram.edges[0].from).toBe("A");
    expect(after.diagram.edges[0].to).toBeUndefined();
  });
});

describe("several diagrams in one file", () => {
  // Built from the two real documents: the file's diagrams are theirs, only joined.
  const joined: BpmnDocument = {
    id: "joined",
    name: "",
    diagrams: [...DATENWEG.diagrams, ...ORDER.diagrams],
    warnings: ORDER.warnings,
  };
  const p = mapProcess("docs/bpmn/one-and-two.bpmn", joined);

  it("maps every diagram and names an unnamed file by its stem", () => {
    expect(p.name).toBe("one-and-two");
    expect(p.diagrams.map((d) => d.name)).toEqual(["Datenweg", "Order"]);
  });

  it("shows a file-level warning on each diagram and sums the gallery card", () => {
    expect(p.diagrams.map((d) => d.findings.length)).toEqual([1, 1]);
    expect(summarize(p).shapes).toBe(
      p.diagrams[0].elements + p.diagrams[1].elements,
    );
  });

  it("keeps a warning that names a shape of one diagram off the other", () => {
    const shape = DATENWEG.diagrams[0].shapes[2];
    const q = mapProcess("x.bpmn", {
      ...joined,
      warnings: [`${shape.element}: odd`],
    });
    expect(q.diagrams.map((d) => d.findings.length)).toEqual([1, 0]);
  });
});

describe("a file with no diagram", () => {
  it("maps to no diagram and a gallery card with an empty thumbnail", () => {
    const p = mapProcess("docs/bpmn/empty.bpmn", {
      id: "x",
      name: "Empty",
      diagrams: [],
      warnings: [],
    });
    expect(p.diagrams).toEqual([]);
    expect(summarize(p).thumb.shapes).toEqual([]);
    expect(summarize(p).shapes).toBe(0);
  });
});

describe("the walk-through", () => {
  const d = mapProcess("x.bpmn", ORDER).diagrams[0];

  it("needs a start event; the order diagram has one", () => {
    expect(d.graph.starts).toEqual(["Start_Order"]);
  });

  it("is not running at step 0", () => {
    expect(walkAt(d, { step: 0, choices: {} })).toBeNull();
  });

  it("starts at the start event and stops at the gateway until a branch is chosen", () => {
    const start = walkPath(d, {});
    expect(start.nodes).toEqual(["Start_Order", "Task_Check", "GW_Ok"]);
    expect(start.open).toBe("GW_Ok");
    const asked = walkAt(d, { step: 99, choices: {} });
    expect(asked?.choices?.map((c) => c.edge)).toEqual(["SF_Yes", "SF_No"]);
    const after = walkPath(d, { GW_Ok: "SF_Yes" });
    expect(after.nodes).toEqual([
      "Start_Order",
      "Task_Check",
      "GW_Ok",
      "Task_Ship",
      "End_Done",
    ]);
    expect(after.open).toBeUndefined();
  });

  it("clamps the step to the path and logs the visited elements", () => {
    const w = walkAt(d, { step: 2, choices: {} });
    expect(w?.step).toBe(2);
    expect(w?.total).toBe(3);
    expect(w?.log[0]).toMatchObject({ id: "Start_Order", kind: "startEvent" });
  });
});

describe("describeUnreadable on a real sidecar refusal", () => {
  it("reads the line the parser names and quotes the lines around it", () => {
    expect(syntaxError.error).toContain("line 5");
    const u = describeUnreadable(syntaxError.error, syntaxError.xml);
    expect(u.line).toBe(5);
    expect(u.error).toBe(
      "not a BPMN 2.0 document: XML syntax error on line 5: element <task> closed by </process>",
    );
    expect(u.excerpt.map((l) => l.n)).toEqual([3, 4, 5, 6, 7]);
    expect(u.excerpt.find((l) => l.n === 5)?.text).toBe("  </process>");
  });

  it("names no line, and quotes nothing, when the message has none", () => {
    const u = describeUnreadable(
      "docs/bpmn/a.bpmn: bpmn: not a BPMN 2.0 document: empty document",
      "",
    );
    expect(u.line).toBeUndefined();
    expect(u.excerpt).toEqual([]);
    expect(u.error).toBe("not a BPMN 2.0 document: empty document");
  });

  it("quotes nothing when the file could not even be read", () => {
    expect(describeUnreadable("denied: line 3", null).excerpt).toEqual([]);
  });
});
