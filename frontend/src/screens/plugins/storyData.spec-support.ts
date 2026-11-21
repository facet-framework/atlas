import { knownStatus } from "../../../../plugins/adr/src/model/headers";
/** Maps the story fixtures to the view props of group D. Stories and tests use
 * the same mapping, so what a story shows is what a test asserts. */

import {
  registry,
  makeAdrs,
  makeChatSessions,
  ANSWER_MD,
  PEOPLE,
  type FixtureBpmn,
} from "../../fixtures/index";
import type { AdrDetail, AdrItem, AdrStatus } from "../../../../plugins/adr/src/views/Adr";
import type {
  BpmnEdge,
  BpmnShape,
  ProcessDiagram,
  ProcessFinding,
  ProcessSummary,
  ProcessWalk,
} from "../../../../plugins/bpmn/src/views/Processes";
import type { ChatSessionVM, ChatTurnVM, SlashCommand } from "./Chat";
import type { PaletteGroup } from "./Palette";
import type { MotionRow } from "./Motion";
import type { DiffLine } from "./shared";

/** Lifecycle badges in the palette story. Palette badges are content the app passes in,
 * so the story carries them in the language of its other German content. */

const STORY_LIFECYCLE: Record<string, string> = {
  active: "active",
  planned: "planned",
  deprecated: "deprecated",
  retired: "retired",
};

export const SAMPLE_DIFF: DiffLine[] = [
  { kind: "hunk", text: "@@ -12,7 +12,9 @@ ## In Go" },
  {
    kind: "same",
    text: "1. Place the comment directly above the function.",
    old: 12,
    new: 12,
  },
  { kind: "del", text: "2. Name a role where appropriate.", old: 13 },
  {
    kind: "add",
    text: "2. Name a role: `@facet-role: entry`, `guard` or `render`.",
    new: 13,
  },
  { kind: "add", text: "3. Run `facet lint` locally before committing.", new: 14 },
  { kind: "same", text: "", old: 14, new: 15 },
  { kind: "same", text: "```go", old: 15, new: 16 },
  { kind: "hunk", text: "@@ -31,4 +33,5 @@ ## Common errors" },
  {
    kind: "same",
    text: "- Anchors in generated code are overwritten on the next run.",
    old: 31,
    new: 33,
  },
  { kind: "add", text: "- A typo in the ID causes lint to report an orphan anchor.", new: 34 },
];
const feature = (id: string) => registry.features.find((f) => f.id === id);
const richFeatures = registry.features.filter((f) => f.scenarios.length >= 3 && f.summary);

/** ADR ------------------------------------------------------------------------- */

export const adrs480: AdrItem[] = makeAdrs(480);

/** Sorts the ADR list the way the table header says. */
export function sortAdrs(items: AdrItem[], key: string, dir: "asc" | "desc"): AdrItem[] {
  const val = (a: AdrItem): string | number =>
    key === "number" || key === "refs"
      ? a[key]
      : key === "sup"
        ? (a.supersededBy ?? 0)
        : key === "authors"
          ? (a.authors ?? []).join(", ")
          : String(a[key as "title" | "status" | "date" | "area"]);
  const sign = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return (typeof x === "number" ? x - (y as number) : x.localeCompare(String(y), "de")) * sign;
  });
}

export function adrCounts(items: AdrItem[]): Record<AdrStatus, number> {
  const c: Record<AdrStatus, number> = {
    proposed: 0,
    accepted: 0,
    superseded: 0,
    rejected: 0,
    unknown: 0,
  };
  for (const a of items) c[a.status]++;
  return c;
}

export function normalizeStatus(raw: string): AdrStatus {
  return knownStatus(raw) ?? "unknown";
}

export function adrDetail(i = 0): {
  adr: AdrDetail;
  markdown: string;
  toc: { id: string; label: string }[];
  records: { id: string; summary: string; lifecycle: string }[];
} {
  const a = registry.adrs[i];
  const number = Number(/(\d{4})/.exec(a.file)?.[1] ?? i + 1);
  const toc = [...a.text.matchAll(/^##\s+(.*)$/gm)].map((m, j) => ({ id: `s${j}`, label: m[1] }));
  return {
    adr: {
      number,
      title: a.title.replace(/^ADR[- ]\d{4}\s+—\s+/, ""),
      status: normalizeStatus(a.status),
      rawStatus: a.status,
      date: a.date,
      file: a.file,
      authors: [PEOPLE[0].name],
      supersededBy: i === 0 ? undefined : undefined,
      supersedes:
        i > 0
          ? {
              number: number - 1,
              title: registry.adrs[i - 1].title.replace(/^ADR[- ]\d{4}\s+—\s+/, ""),
            }
          : undefined,
    },
    markdown: a.text,
    toc,
    records: a.refs.map((id) => {
      const f = feature(id);
      return { id, summary: f?.summary ?? "", lifecycle: f?.lifecycle ?? "—" };
    }),
  };
}

/** The real ADRs as one supersession chain (0001 → 0002 → …), as ADR 0002 names it. */
export function adrChain(upTo = 3) {
  return registry.adrs.slice(0, upTo).map((a, i) => {
    const d = adrDetail(i).adr;
    return {
      number: d.number,
      title: d.title,
      status: i < upTo - 1 ? ("superseded" as const) : d.status,
      date: a.date,
    };
  });
}

/** BPMN ------------------------------------------------------------------------ */

function nearest(shapes: BpmnShape[], [x, y]: [number, number]): string | undefined {
  let best: string | undefined;
  let dist = Infinity;
  for (const s of shapes) {
    if (s.kind === "participant") continue;
    const dx = Math.max(s.x - x, 0, x - (s.x + s.w));
    const dy = Math.max(s.y - y, 0, y - (s.y + s.h));
    const d = dx + dy;
    if (d < dist) {
      dist = d;
      best = s.id;
    }
  }
  return best;
}

export function diagramFrom(src: FixtureBpmn): ProcessDiagram {
  const shapes: BpmnShape[] = src.shapes.map(([kind, label, x, y, w, h], i) => ({
    id: `el-${i + 1}`,
    kind,
    label,
    x,
    y,
    w,
    h,
  }));
  const pools = shapes.filter((s) => s.kind === "participant");
  for (const s of shapes) {
    if (s.kind === "participant") continue;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    s.lane = pools.find((p) => cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h)?.id;
  }
  const edges: BpmnEdge[] = src.edges.map(([kind, label, pts], i) => ({
    id: `fl-${i + 1}`,
    kind,
    label,
    points: pts,
    from: nearest(shapes, pts[0]),
    to: nearest(shapes, pts[pts.length - 1]),
  }));
  const xs = shapes.flatMap((s) => [s.x, s.x + s.w]);
  const ys = shapes.flatMap((s) => [s.y, s.y + s.h]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { shapes, edges, box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y } };
}

export const diagram = diagramFrom(registry.bpmn[0]);

/** One BPMN file with several diagrams: the collaboration plus two processes. */
export const diagramById: Record<string, ProcessDiagram> = {
  d1: diagram,
  d2: synthDiagram(5),
  d3: synthDiagram(8),
};
const elementCount = (d: ProcessDiagram) => d.shapes.filter((x) => x.kind !== "participant").length;
export const diagramTabs = [
  { id: "d1", name: "Datenweg (Zusammenarbeit)", elements: elementCount(diagramById.d1) },
  { id: "d2", name: "Sidecar-Call", elements: elementCount(diagramById.d2) },
  { id: "d3", name: "Error path", elements: elementCount(diagramById.d3) },
];

/** Findings of the real diagram; the gallery and the workspace both show this count. */
const PROCESS_FINDING_COUNT = 4;

const PROCESS_NAMES = [
  "BPMN plugin data flow",
  "Create a record",
  "Release-Kandidat approve",
  "Plugin install",
  "Explain a glossary term",
  "Read a test result",
  "Drift report",
  "Approval of a Tool",
  "Commit-Gate",
  "Atlas start",
  "Sidecar aufrufen",
  "Scenario prove",
];

/** A plausible small process for the gallery: lanes, a start, a chain of tasks
 * with an optional gateway that splits and joins, an end. Varies with `i`. */

export function synthDiagram(i: number): ProcessDiagram {
  const lanes = 1 + (i % 3);
  const tasks = 3 + ((i * 5) % 6);
  const gw = i % 2 === 0 ? 1 + (i % Math.max(1, tasks - 1)) : -1;
  const laneH = 150;
  const shapes: BpmnShape[] = [];
  const edges: BpmnEdge[] = [];
  const width = 160 + (tasks + 2) * 140;
  for (let l = 0; l < lanes; l++)
    shapes.push({
      id: `p${l}`,
      kind: "participant",
      label: `Lane ${l + 1}`,
      x: 0,
      y: l * laneH,
      w: width,
      h: laneH,
    });
  // Work moves down the lanes in blocks, the way a hand-off between roles reads.
  const laneOf = (k: number) => Math.min(lanes - 1, Math.floor((k * lanes) / (tasks + 2)));
  const node = (id: string, kind: string, k: number, w: number, h: number, dy = 0) => {
    const l = laneOf(k);
    const s: BpmnShape = {
      id,
      kind,
      label: id,
      x: 60 + k * 140,
      y: l * laneH + (laneH - h) / 2 + dy,
      w,
      h,
      lane: `p${l}`,
    };
    shapes.push(s);
    return s;
  };
  const route = (a: BpmnShape, b: BpmnShape): [number, number][] => {
    const ay = a.y + a.h / 2;
    const by = b.y + b.h / 2;
    const mx = (a.x + a.w + b.x) / 2;
    return ay === by
      ? [
          [a.x + a.w, ay],
          [b.x, by],
        ]
      : [
          [a.x + a.w, ay],
          [mx, ay],
          [mx, by],
          [b.x, by],
        ];
  };
  let prev = node("s", "startEvent", 0, 36, 36);
  const link = (a: BpmnShape, b: BpmnShape) =>
    edges.push({
      id: `e${edges.length}`,
      kind: "sequenceFlow",
      label: "",
      from: a.id,
      to: b.id,
      points: route(a, b),
    });
  let alt: BpmnShape | null = null;
  const next = (n: BpmnShape) => {
    link(prev, n);
    if (alt) link(alt, n);
    alt = null;
    prev = n;
  };
  for (let k = 1; k <= tasks; k++) {
    if (k === gw) {
      next(node(`g${k}`, "exclusiveGateway", k, 50, 50));
      continue;
    }
    const t = node(`t${k}`, "task", k, 110, 56);
    if (prev.kind === "exclusiveGateway") {
      const a: BpmnShape = { ...t, id: `a${k}`, y: t.y + 64 };
      shapes.push(a);
      link(prev, a);
      edges[edges.length - 1].label = "no";
      link(prev, t);
      edges[edges.length - 1].label = "yes";
      alt = a;
      prev = t;
      continue;
    }
    next(t);
  }
  next(node("end", "endEvent", tasks + 1, 36, 36));
  return { shapes, edges, box: { x: 0, y: 0, w: width, h: lanes * laneH } };
}

export const processes: ProcessSummary[] = Array.from({ length: 36 }, (_, i) => {
  const name =
    PROCESS_NAMES[i % PROCESS_NAMES.length] +
    (i >= PROCESS_NAMES.length ? ` · ${Math.floor(i / PROCESS_NAMES.length) + 1}` : "");
  const thumb: ProcessDiagram = i === 0 ? diagram : synthDiagram(i);
  const lanes = thumb.shapes.filter((s) => s.kind === "participant").length;
  return {
    file:
      i === 0
        ? registry.bpmn[0].file
        : `docs/bpmn/${name.toLowerCase().replace(/[^a-z\u00e4\u00f6\u00fc\u00df0-9]+/g, "-")}.bpmn`,
    name,
    shapes: thumb.shapes.length - lanes,
    edges: thumb.edges.length,
    lanes,
    warnings: i === 0 ? PROCESS_FINDING_COUNT : [0, 2, 0, 1, 0, 0, 3][i % 7],
    records: (i * 3) % 7,
    updatedAt: `2026-${String(10 - (i % 9)).padStart(2, "0")}-${String(1 + ((i * 7) % 27)).padStart(2, "0")}`,
    thumb,
  };
});

/** The main path from start to end, choosing the first branch at each gateway. */
export function walkPath(
  d: ProcessDiagram,
  choose: Record<string, number> = {},
): { nodes: string[]; edges: string[] } {
  const start = d.shapes.find((s) => s.kind === "startEvent");
  const nodes: string[] = [];
  const edges: string[] = [];
  let cur = start?.id;
  while (cur && !nodes.includes(cur)) {
    nodes.push(cur);
    const out = d.edges.filter((e) => e.from === cur && e.kind === "sequenceFlow");
    const pick = out[choose[cur] ?? 0];
    if (!pick) break;
    edges.push(pick.id);
    cur = pick.to;
  }
  return { nodes, edges };
}

export function walkAt(d: ProcessDiagram, step: number, atGateway = false): ProcessWalk {
  const path = walkPath(d);
  const label = (id: string) => d.shapes.find((s) => s.id === id);
  const visited = path.nodes.slice(0, step);
  const current = visited[visited.length - 1];
  const gw = label(current);
  const choices =
    atGateway && gw?.kind === "exclusiveGateway"
      ? d.edges
          .filter((e) => e.from === current && e.kind === "sequenceFlow")
          .map((e) => ({
            edge: e.id,
            label: e.label || "otherwise",
            target: label(e.to as string)?.label ?? "—",
          }))
      : undefined;
  return {
    step,
    total: path.nodes.length,
    visited,
    edges: path.edges.slice(0, step - 1),
    current,
    choices,
    log: visited.map((id) => ({ id, label: label(id)?.label ?? id, kind: label(id)?.kind ?? "" })),
  };
}

export const processFindings: ProcessFinding[] = [
  { key: "f1", severity: "warning", text: "Annotation without text", element: "el-13" },
  { key: "f2", severity: "warning", text: "Annotation without text", element: "el-15" },
  {
    key: "f3",
    severity: "info",
    text: "Unnamed message flow between host and sidecar",
    element: "el-12",
  },
  {
    key: "f4",
    severity: "error",
    text: "Gateway “drawn?” has no default flow",
    element: "el-7",
  },
];

export const processLinks: Record<string, { id: string; summary: string }[]> = {
  "el-6": richFeatures.slice(0, 2).map((f) => ({ id: f.id, summary: f.summary })),
  "el-7": richFeatures.slice(2, 3).map((f) => ({ id: f.id, summary: f.summary })),
  "el-12": richFeatures.slice(3, 5).map((f) => ({ id: f.id, summary: f.summary })),
};

export const processDocs: Record<string, string> = {
  "el-6": "The reader passes file text to the sidecar through bus.call. Atlas does not parse XML.",
  "el-7":
    "Yes, if the sidecar returned a drawing model; otherwise the reader shows the file error.",
};

/** Chat ------------------------------------------------------------------------ */

export const chatSessions = makeChatSessions(24);

const SESSION_TITLES = [
  "What is missing from the ADR plugin",
  "Commit gate and strict lint",
  "Which features have open drift",
  "Summarize first steps for new readers",
  "Where are sidecar checksums measured",
  "Which scenarios are unproven",
  "Explain anchors in Go",
  "Why the BPMN plugin loads no file",
  "Difference between planned and active",
  "Which records does ADR 0002 name",
  "How does a plugin get permissions",
  "Drift after the latest release",
  "Explain local changes",
  "What exactly does facet plugin add do",
  "Which hooks run in the cloud",
  "Glossary: promise and scenario",
  "Who owns navigation/atlas",
  "Which tests prove the commit gate",
  "Explain a glossary term",
  "Check release candidate rc.4",
  "What does drift mean in the overview",
  "Which decisions are superseded",
  "Sidecar call without a grant",
  "How Atlas reads .facetrc.yaml",
];

export const CURRENT_SESSION = 1;

export function sessionsVM(): ChatSessionVM[] {
  return chatSessions.map((s, i) => ({
    id: s.id,
    title: SESSION_TITLES[i % SESSION_TITLES.length],
    when: i < 3 ? ["4 min ago", "1 h ago", "yesterday"][i] : s.updatedAt,
    rounds: i === CURRENT_SESSION ? 1 : 1 + ((i * 3) % 7),
    mode: "Ask" as const,
    pinned: s.pinned,
    continuation: (["continued", "restarted", "open"] as const)[i % 3],
    running: i === 0,
  }));
}

export const SOURCES = [
  {
    kind: "record" as const,
    ref: "lists/permissions/admin",
    title: "Commit-Gate",
    excerpt: "Compares lint errors in an ordinary staged commit with HEAD",
  },
  {
    kind: "file" as const,
    ref: "scripts/commit-gate.sh",
    line: 41,
    title: "Shell-Getting started",
    excerpt: 'exec facet hook commit-gate "$@"',
  },
  {
    kind: "file" as const,
    ref: "internal/facet/config.go",
    line: 212,
    title: "Strict dependencies",
    excerpt: 'os.Getenv("FACET_STRICT_DEPS")',
  },
  { kind: "adr" as const, ref: "docs/adr/0002-sync-conflicts.md", title: "ADR 0002" },
  {
    kind: "file" as const,
    ref: "docs/operations/working-with-lint.md",
    title: "Working with lint",
  },
];

export const STEPS_DONE = [
  { label: "Searched records", detail: "„commit gate“ · 4 Hits", state: "done" as const, ms: 38 },
  {
    label: "Record read",
    detail: "lists/permissions/admin",
    state: "done" as const,
    ms: 12,
  },
  {
    label: "File read",
    detail: "scripts/commit-gate.sh",
    lines: "1–64",
    state: "done" as const,
    ms: 9,
  },
  { label: "Searched code", detail: "FACET_STRICT_DEPS", state: "done" as const, ms: 140 },
  {
    label: "File read",
    detail: "internal/facet/config.go",
    lines: "198–231",
    state: "done" as const,
    ms: 11,
  },
];

const SHORT_MD = `The commit gate compares staged lint errors with \`HEAD\`. New errors reject the commit; existing errors are accepted.

- Runs as a \`PreToolUse\` hook on \`Bash\`.
- A first commit has no allowance.`;

export function turns(
  kind: "answer" | "rich" | "streaming" | "cut" | "failed" | "stopped",
): ChatTurnVM[] {
  const first: ChatTurnVM = {
    id: "t1",
    question: "What does the commit gate check?",
    at: "14:02",
    context: ["lists/permissions"],
    answer: {
      markdown: SHORT_MD,
      state: "done",
      steps: STEPS_DONE.slice(0, 3),
      sources: SOURCES.slice(0, 2),
      model: "Opus 5.5",
      seconds: 14,
    },
  };
  const q = "How does the commit gate work, and how do I run strict lint?";
  switch (kind) {
    case "answer":
      return [first];
    case "rich":
      return [
        {
          id: "t2",
          question: q,
          at: "14:05",
          answer: {
            markdown: ANSWER_MD,
            state: "done",
            steps: STEPS_DONE,
            sources: SOURCES,
            model: "Opus 5.5",
            seconds: 31,
          },
        },
      ];
    case "streaming":
      return [
        first,
        {
          id: "t2",
          question: q,
          at: "14:05",
          answer: {
            markdown: ANSWER_MD.split("\n\n").slice(0, 2).join("\n\n"),
            state: "streaming",
            steps: [
              ...STEPS_DONE.slice(0, 4),
              {
                label: "Read file",
                detail: "internal/facet/config.go",
                lines: "198–231",
                state: "running",
              },
            ],
            sources: [],
            seconds: 9,
          },
        },
      ];
    case "cut":
      return [
        first,
        {
          id: "t2",
          question: q,
          at: "14:05",
          answer: {
            markdown: ANSWER_MD.split("\n\n").slice(0, 3).join("\n\n"),
            state: "cut",
            steps: STEPS_DONE.slice(0, 4),
            sources: SOURCES.slice(0, 2),
          },
        },
      ];
    case "stopped":
      return [
        first,
        {
          id: "t2",
          question: q,
          at: "14:05",
          answer: {
            markdown: ANSWER_MD.split("\n\n")[0],
            state: "stopped",
            steps: STEPS_DONE.slice(0, 2),
            sources: [],
            seconds: 6,
          },
        },
      ];
    default:
      return [
        first,
        {
          id: "t2",
          question: q,
          at: "14:05",
          answer: {
            markdown: "",
            state: "failed",
            steps: [
              ...STEPS_DONE.slice(0, 2),
              { label: "Read file", detail: "internal/facet/config.go", state: "failed" },
            ],
            sources: [],
            error: "Claude Code did not respond within 120 s (host timeout).",
          },
        },
      ];
  }
}

export const SLASH: SlashCommand[] = [
  { cmd: "/record", label: "Attach a record as context", hint: "Id" },
  { cmd: "/domain", label: "Attach an area as context", hint: "Domain" },
  { cmd: "/new", label: "Start a new conversation", hint: "Ctrl N" },
  { cmd: "/model", label: "Choose the model", hint: "Haiku · Sonnet · Opus" },
  { cmd: "/copy", label: "Copy the last answer as Markdown", hint: "" },
];

export const SUGGESTIONS = [
  "Which features have open drift?",
  "What changed after the latest release?",
  "Which scenarios are unproven?",
  "Where are sidecar checksums measured?",
];

/** Palette --------------------------------------------------------------------- */

export function paletteHits(query: string, per = 4): PaletteGroup[] {
  const q = query.toLowerCase();
  const recs = registry.features.filter((f) => f.id.includes(q));
  const doms = registry.domains
    .flatMap((d) => [d.id, ...d.capabilities.map((c) => `${d.id}/${c.id}`)])
    .filter((x) => x.includes(q));
  const adrs = adrs480.filter((a) => a.title.toLowerCase().includes(q));
  const groups: PaletteGroup[] = [
    {
      key: "records",
      label: "Records",
      total: recs.length,
      of: registry.features.length,
      items: recs.slice(0, per).map((f) => ({
        key: f.id,
        icon: "document",
        title: f.id,
        mono: true,
        sub: f.summary,
        badge: STORY_LIFECYCLE[f.lifecycle] ?? f.lifecycle,
      })),
    },
    {
      key: "areas",
      label: "Areas & capabilities",
      total: doms.length,
      items: doms.slice(0, per).map((d) => ({ key: d, icon: "tree", title: d, mono: true })),
    },
    {
      key: "adr",
      label: "Decisions",
      total: adrs.length,
      of: adrs480.length,
      items: adrs.slice(0, per).map((a) => ({
        key: `adr-${a.number}`,
        icon: "scales",
        title: a.title,
        sub: `ADR ${a.number} · ${a.status}`,
      })),
    },
  ];
  return groups.filter((g) => g.total);
}

export const PALETTE_RECENT: PaletteGroup[] = [
  {
    key: "recent",
    label: "Recently visited",
    items: [
      {
        key: "h1",
        icon: "document",
        title: "workspace/board/column",
        mono: true,
        sub: "Record · 14:08",
      },
      {
        key: "h2",
        icon: "tree",
        title: "workspace/board",
        mono: true,
        sub: "Capability · 14:06",
      },
      { key: "h4", icon: "scales", title: "Decisions", sub: "Plugin · 480 ADRs" },
      {
        key: "h5",
        icon: "document",
        title: "lists/permissions/admin",
        mono: true,
        sub: "Record · 13:58",
      },
    ],
  },
  {
    key: "goto",
    label: "Go to",
    items: [
      { key: "overview", icon: "home", title: "Overview", hint: "G L" },
      { key: "records", icon: "document", title: "Records", hint: "G R" },
      { key: "ask", icon: "spark", title: "Ask Atlas", hint: "?" },
    ],
  },
];

export const PALETTE_COMMANDS: PaletteGroup[] = [
  {
    key: "cmd",
    label: "commands",
    items: [
      {
        key: "theme",
        icon: "theme",
        title: "Theme switch",
        sub: "facet · paper · dark · light",
        hint: "Ctrl ⇧ L",
      },
      {
        key: "role",
        icon: "person",
        title: "Change role",
        sub: "Developer",
        hint: "Ctrl ⇧ R",
      },
      { key: "copy", icon: "link", title: "Copy a link to this place", hint: "Ctrl ⇧ C" },
      { key: "hist", icon: "history", title: "Clear history" },
      { key: "chat", icon: "chat", title: "New conversation", hint: "Ctrl N" },
    ],
  },
  {
    key: "plugin",
    label: "Plugin-Commands",
    items: [
      {
        key: "adr-new",
        icon: "scales",
        title: "Decisions: New decision",
        badge: "ADR",
      },
      { key: "bpmn-walk", icon: "flow", title: "Processes: Walkthrough start", badge: "BPMN" },
    ],
  },
];

/** Motion ---------------------------------------------------------------------- */

const toMotionRow = (f: (typeof richFeatures)[number]): MotionRow => ({
  id: f.id,
  summary: f.summary,
  lifecycle: f.lifecycle,
  proven: f.provenCount,
  scenarios: f.scenarioCount,
  anchors: f.anchorCount,
});

export const motionRows: MotionRow[] = richFeatures.slice(0, 7).map(toMotionRow);
/** Ten distinct records for the stagger demo, which caps at eight steps. */
export const staggerRows: MotionRow[] = richFeatures.slice(0, 10).map(toMotionRow);

/** Every shape the BPMN sidecar can name ------------------------------------------- */

const sh = (
  id: string,
  kind: string,
  label: string,
  [x, y, w, h]: [number, number, number, number],
  more: Partial<BpmnShape> = {},
): BpmnShape => ({ id, kind, label, x, y, w, h, ...more });

const ev = (x: number, y: number): [number, number, number, number] => [x, y, 36, 36];
const gw = (x: number, y: number): [number, number, number, number] => [x, y, 50, 50];
const act = (x: number, y: number): [number, number, number, number] => [x, y, 100, 60];

/** A diagram in the sidecar's drawing vocabulary that uses each outline,
 * border, symbol and marker once: two pools, two lanes, an open and a closed
 * subprocess, a boundary event, every gateway, data, a group, an annotation,
 * and sequence, default, conditional and message flows plus an association. */

export const shapeGallery: ProcessDiagram = {
  box: { x: 40, y: 20, w: 1140, h: 580 },
  shapes: [
    sh("P1", "participant", "Shop", [40, 20, 1140, 380], {
      form: "pool",
      labelBox: { x: 46, y: 20, w: 16, h: 380, lines: ["Shop"], vertical: true },
    }),
    sh("L1", "lane", "Sales", [68, 20, 1112, 180], { form: "lane", lane: "P1" }),
    sh("L2", "lane", "Warehouse", [68, 200, 1112, 200], { form: "lane", lane: "P1" }),
    sh("P2", "participant", "Carrier", [40, 430, 1140, 170], {
      form: "pool",
      markers: ["parallel"],
    }),
    sh("S1", "startEvent", "Order received", ev(110, 92), {
      form: "circle",
      border: "single",
      symbol: "message",
      lane: "P1",
      labelBox: { x: 88, y: 132, w: 80, h: 26, lines: ["Order", "received"] },
    }),
    sh("T1", "userTask", "Check order", act(180, 80), {
      form: "roundrect",
      border: "single",
      symbol: "user",
      markers: ["loop"],
      lane: "P1",
    }),
    sh("G1", "parallelGateway", "", gw(310, 85), {
      form: "diamond",
      border: "single",
      symbol: "parallel",
      lane: "P1",
    }),
    sh("SP1", "subProcess", "Pack", [400, 40, 300, 140], {
      form: "roundrect",
      border: "single",
      lane: "P1",
    }),
    sh("T2", "serviceTask", "Reserve stock", act(430, 80), {
      form: "roundrect",
      border: "single",
      symbol: "service",
      markers: ["parallel"],
      lane: "P1",
    }),
    sh("E0", "endEvent", "Packed", ev(600, 92), {
      form: "circle",
      border: "thick",
      filled: true,
      lane: "P1",
    }),
    sh("B1", "boundaryEvent", "Late", ev(680, 162), {
      form: "circle",
      border: "double",
      dashed: true,
      symbol: "timer",
      lane: "P1",
    }),
    sh("C1", "subProcess", "Ship", act(760, 80), {
      form: "roundrect",
      border: "single",
      markers: ["collapsed"],
      lane: "P1",
    }),
    sh("CA", "callActivity", "Invoice", act(900, 80), {
      form: "roundrect",
      border: "thick",
      markers: ["collapsed"],
      lane: "P1",
    }),
    sh("E1", "endEvent", "Done", ev(1050, 92), {
      form: "circle",
      border: "thick",
      symbol: "terminate",
      filled: true,
      lane: "P1",
    }),
    sh("IC", "intermediateCatchEvent", "Payment in", ev(110, 282), {
      form: "circle",
      border: "double",
      symbol: "message",
      lane: "P1",
    }),
    sh("IT", "intermediateThrowEvent", "Notify", ev(180, 282), {
      form: "circle",
      border: "double",
      symbol: "signal",
      filled: true,
      lane: "P1",
    }),
    sh("EG", "eventBasedGateway", "", gw(250, 275), {
      form: "diamond",
      border: "single",
      symbol: "event-based",
      lane: "P1",
    }),
    sh("XG", "exclusiveGateway", "In stock?", gw(330, 275), {
      form: "diamond",
      border: "single",
      symbol: "exclusive",
      lane: "P1",
    }),
    sh("IG", "inclusiveGateway", "", gw(410, 275), {
      form: "diamond",
      border: "single",
      symbol: "inclusive",
      lane: "P1",
    }),
    sh("GR", "group", "Fulfilment", [560, 250, 420, 110], { form: "group", border: "dashed" }),
    sh("ST", "sendTask", "Send label", act(580, 270), {
      form: "roundrect",
      border: "single",
      symbol: "send",
      markers: ["sequential"],
      lane: "P1",
    }),
    sh("RT", "receiveTask", "Await pickup", act(710, 270), {
      form: "roundrect",
      border: "single",
      symbol: "receive",
      markers: ["compensation"],
      lane: "P1",
    }),
    sh("TX", "transaction", "Charge", act(840, 270), {
      form: "roundrect",
      border: "double",
      markers: ["collapsed"],
      lane: "P1",
    }),
    sh("DO", "dataObjectReference", "Orders", [1000, 250, 36, 50], {
      form: "document",
      border: "single",
      collection: true,
      lane: "P1",
    }),
    sh("DS", "dataStoreReference", "Stock", [1080, 250, 50, 50], {
      form: "datastore",
      border: "single",
      lane: "P1",
    }),
    sh("TA", "textAnnotation", "Signed by the customer", [990, 340, 170, 40], {
      form: "bracket",
      border: "single",
      lane: "P1",
      labelBox: {
        x: 990,
        y: 340,
        w: 170,
        h: 40,
        lines: ["Signed by the customer"],
        align: "left",
      },
    }),
    sh("MT", "manualTask", "Load truck", act(180, 490), {
      form: "roundrect",
      border: "single",
      symbol: "manual",
      lane: "P2",
    }),
    sh("BR", "businessRuleTask", "Pick route", act(330, 490), {
      form: "roundrect",
      border: "single",
      symbol: "business-rule",
      lane: "P2",
    }),
    sh("AH", "adHocSubProcess", "Handle damage", act(480, 490), {
      form: "roundrect",
      border: "single",
      markers: ["adhoc", "collapsed"],
      lane: "P2",
    }),
    sh("SC", "scriptTask", "Print manifest", act(630, 490), {
      form: "roundrect",
      border: "single",
      symbol: "script",
      lane: "P2",
    }),
    sh("TM", "intermediateCatchEvent", "Pickup window", ev(790, 502), {
      form: "circle",
      border: "double",
      symbol: "timer",
      lane: "P2",
    }),
  ],
  edges: [
    {
      id: "F1",
      kind: "sequenceFlow",
      label: "",
      from: "S1",
      to: "T1",
      points: [
        [146, 110],
        [180, 110],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F2",
      kind: "sequenceFlow",
      label: "",
      from: "T1",
      to: "G1",
      points: [
        [280, 110],
        [310, 110],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F3",
      kind: "sequenceFlow",
      label: "",
      from: "G1",
      to: "SP1",
      points: [
        [360, 110],
        [400, 110],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F4",
      kind: "sequenceFlow",
      label: "",
      from: "T2",
      to: "E0",
      points: [
        [530, 110],
        [600, 110],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F5",
      kind: "sequenceFlow",
      label: "late",
      from: "B1",
      to: "C1",
      points: [
        [698, 198],
        [698, 215],
        [810, 215],
        [810, 140],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F6",
      kind: "sequenceFlow",
      label: "",
      from: "SP1",
      to: "C1",
      points: [
        [700, 110],
        [760, 110],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F7",
      kind: "sequenceFlow",
      label: "",
      from: "C1",
      to: "CA",
      points: [
        [860, 110],
        [900, 110],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F8",
      kind: "sequenceFlow",
      label: "",
      from: "CA",
      to: "E1",
      points: [
        [1000, 110],
        [1050, 110],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F9",
      kind: "sequenceFlow",
      label: "",
      from: "IC",
      to: "IT",
      points: [
        [146, 300],
        [180, 300],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F10",
      kind: "sequenceFlow",
      label: "",
      from: "IT",
      to: "EG",
      points: [
        [216, 300],
        [250, 300],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F11",
      kind: "sequenceFlow",
      label: "",
      from: "EG",
      to: "XG",
      points: [
        [300, 300],
        [330, 300],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F12",
      kind: "sequenceFlow",
      label: "yes",
      from: "XG",
      to: "IG",
      points: [
        [380, 300],
        [410, 300],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F13",
      kind: "sequenceFlow",
      label: "no",
      from: "XG",
      to: "ST",
      points: [
        [355, 325],
        [355, 380],
        [630, 380],
        [630, 330],
      ],
      stroke: "solid",
      start: "slash",
      end: "arrow",
    },
    {
      id: "F14",
      kind: "sequenceFlow",
      label: "",
      from: "IG",
      to: "ST",
      points: [
        [460, 300],
        [580, 300],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F15",
      kind: "sequenceFlow",
      label: "",
      from: "ST",
      to: "RT",
      points: [
        [680, 300],
        [710, 300],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F16",
      kind: "sequenceFlow",
      label: "paid",
      from: "RT",
      to: "TX",
      points: [
        [810, 300],
        [840, 300],
      ],
      stroke: "solid",
      start: "diamond",
      end: "arrow",
    },
    {
      id: "D1",
      kind: "dataOutputAssociation",
      label: "",
      from: "TX",
      to: "DO",
      points: [
        [940, 290],
        [1000, 280],
      ],
      stroke: "dotted",
      end: "open-arrow",
    },
    {
      id: "A1",
      kind: "association",
      label: "",
      from: "TA",
      to: "DO",
      points: [
        [1000, 340],
        [1018, 300],
      ],
      stroke: "dotted",
    },
    {
      id: "M1",
      kind: "messageFlow",
      label: "pickup order",
      from: "ST",
      to: "MT",
      points: [
        [630, 330],
        [630, 420],
        [230, 420],
        [230, 490],
      ],
      stroke: "dashed",
      start: "circle",
      end: "open-arrow",
      labelBox: { x: 380, y: 404, w: 90, h: 14, lines: ["pickup order"] },
    },
    {
      id: "F17",
      kind: "sequenceFlow",
      label: "",
      from: "MT",
      to: "BR",
      points: [
        [280, 520],
        [330, 520],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F18",
      kind: "sequenceFlow",
      label: "",
      from: "BR",
      to: "AH",
      points: [
        [430, 520],
        [480, 520],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F19",
      kind: "sequenceFlow",
      label: "",
      from: "AH",
      to: "SC",
      points: [
        [580, 520],
        [630, 520],
      ],
      stroke: "solid",
      end: "arrow",
    },
    {
      id: "F20",
      kind: "sequenceFlow",
      label: "",
      from: "SC",
      to: "TM",
      points: [
        [730, 520],
        [790, 520],
      ],
      stroke: "solid",
      end: "arrow",
    },
  ],
};
