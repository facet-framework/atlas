/** The tile set registry: one set per role, three generated and three measured. */

import { buildModel, type RawRecord, type YamlValue } from "@/model";
import { derive } from "../derive";
import { ROLE_LIST } from "../roles";
import { genLabelFor, genRegisteredRoles, genTilesFor, type GenTile } from "./tiles";
// Side effect: registers every core role's set.
import "./tiles/index";

function rec(
  id: string,
  over: Partial<{
    dependsOn: string[];
    dependedOnBy: string[];
    created: string;
    knowledge: Record<string, YamlValue>;
    driftFile: string;
    unbacked: number;
  }> = {},
): RawRecord {
  const scenarios = over.unbacked
    ? Array.from({ length: over.unbacked }, (_, i) => ({
        id: `s${i}`,
        statement: "Given a\nWhen b\nThen c",
      }))
    : [{ id: "s0", statement: "Given a\nWhen b\nThen c" }];
  return {
    path: `docs/facets/${id}.yaml`,
    raw: "",
    doc: {
      id,
      lifecycle: "active",
      intent: { summary: `Record ${id}` },
      contract: { scenarios },
      ...(over.knowledge ? { knowledge: over.knowledge } : {}),
      lineage: {
        owner: { team: "t" },
        created_at: over.created ?? "2026-01-01",
        ...(over.dependsOn ? { depends_on: over.dependsOn } : {}),
        ...(over.dependedOnBy ? { depended_on_by: over.dependedOnBy } : {}),
      },
    },
  };
}

const RAWS: RawRecord[] = [
  rec("core/registry/cli", {
    dependedOnBy: ["core/atlas/reader", "core/atlas/companion"],
    created: "2026-01-01",
  }),
  rec("core/atlas/reader", { dependsOn: ["core/registry/cli"], created: "2026-02-01" }),
  rec("core/atlas/companion", { dependsOn: ["core/registry/cli"], created: "2026-03-01" }),
  rec("infra/drift/cli", { created: "2026-04-01" }),
  rec("infra/defect/ledger", { created: "2026-05-01" }),
  rec("navigation/lint/orphans", {
    created: "2026-06-01",
    knowledge: {
      prerequisite_knowledge: { question: "q", answer: "a" },
    },
  }),
];

const v = derive(
  buildModel(
    { name: "tiles" },
    RAWS.map((r) => r.path),
    RAWS,
  ),
);
const nav = { open: jest.fn() };

describe("every core role carries a registered set", () => {
  it("registers all seven core roles — derived from ROLE_LIST, not as a literal", () => {
    const registriert = genRegisteredRoles().sort();
    const expected = ROLE_LIST.map((r) => r.key).sort();
    expect(registriert).toEqual(expected);
  });

  it.each(ROLE_LIST.map((r) => r.key))("role '%s' yields tiles against a real model", (role) => {
    const tiles = genTilesFor(role, v, nav);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.filter((tile) => tile.kind === "generated")).toHaveLength(3);
    expect(tiles.filter((tile) => tile.kind === "measured")).toHaveLength(3);
  });
});

function split(tiles: GenTile[]) {
  return {
    generated: tiles.filter((t) => t.kind === "generated"),
    measured: tiles.filter((t) => t.kind === "measured"),
  };
}

describe("the pattern 3 generated + 3 measured — checked for 'newcomer' and two more roles", () => {
  it.each(["newcomer", "dev", "review"] as const)(
    "role '%s' has exactly three generated and three measured tiles",
    (role) => {
      const { generated, measured } = split(genTilesFor(role, v, nav));
      expect(generated).toHaveLength(3);
      expect(measured).toHaveLength(3);
    },
  );

  it("every generated tile carries a context, a task without number-taboo words and no number in its title", () => {
    for (const role of ROLE_LIST.map((r) => r.key)) {
      const { generated } = split(genTilesFor(role, v, nav));
      for (const tile of generated) {
        expect(tile.ctx.length).toBeGreaterThan(0);
        expect(tile.request.length).toBeGreaterThan(0);
        expect(tile.title).not.toMatch(/\d/);
      }
    }
  });

  it("every measured tile carries a basis and a body", () => {
    for (const role of ROLE_LIST.map((r) => r.key)) {
      const { measured } = split(genTilesFor(role, v, nav));
      for (const tile of measured) {
        expect(tile.basis.length).toBeGreaterThan(0);
        expect(tile.body).toBeTruthy();
      }
    }
  });

  it("tile ids are unique per role — no two tiles share a key", () => {
    for (const role of ROLE_LIST.map((r) => r.key)) {
      const ids = genTilesFor(role, v, nav).map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("genLabelFor", () => {
  it("names the label the role registered", () => {
    expect(genLabelFor("newcomer")).toBe("Context");
  });
});

// Mutation: wire any tile to a different measure -> its literal record ordering differs.
it("binds every generated tile to its role's distinct corpus measure", () => {
  const ids = v.M.map((f) => f.id);
  const depIndices = [[1, 2, 3, 4, 5], [5], [1, 5], [1], [1, 5, 3], [1, 3, 4]];
  const usedIndices = [[], [0, 2, 3, 4, 5], [0], [0, 4, 5], [0, 5], [0, 1, 2, 4]];
  const anchors = [6, 3, 4, 1, 5, 2],
    drift = [0, 1, 4, 0, 2, 0],
    grade = [1, 0, 0.5, null, 0.25, 0.75],
    unbacked = [0, 1, 0, 4, 2, 3];
  const features = v.M.map((f, i) => ({
    ...f,
    deps: depIndices[i].map((j) => ids[j]),
    usedBy: usedIndices[i].map((j) => ids[j]),
    anchorsN: anchors[i],
    driftN: drift[i],
    grade: grade[i],
    unbacked: unbacked[i],
    hasKnow: [true, false, true, false, true, true][i],
    obs: [0, 3, 5].includes(i) ? { slos: [], alerts: [], checks: [] } : null,
  }));
  const measured = {
    ...v,
    M: features,
    byId: Object.fromEntries(features.map((f) => [f.id, f])),
    teams: [
      ["large", [features[2], features[4], features[3], features[5]]],
      ["small", [features[0], features[1]]],
    ],
  } as typeof v;
  const reach = [1, 5, 3, 4, 2, 0],
    connected = [5, 1, 0, 4, 3, 2],
    worst = [1, 4, 2, 5, 0];
  const expected: Record<string, Record<string, number[]>> = {
    newcomer: { core: reach, users: connected, distinctive: [5, 0, 4, 3, 2, 1] },
    leadership: { status: reach, "largest-backlog": worst, "next-step": worst },
    dev: { "drift-reason": [2, 4, 1], "next-action": [3, 5, 4, 1], risk: reach },
    review: { "largest-gap": worst, "what-to-check": [3, 5, 4, 1], pattern: [1, 4, 2, 5, 0, 3] },
    author: {
      "up-next": [1, 2, 3, 4, 0, 5],
      "knowledge-question": [1, 3],
      "operational-gap": [1, 2, 4],
    },
    owner: { "team-responsibility": [2, 4, 3, 5], dependencies: connected, reach: reach },
    agent: { connections: reach, "most-anchored": [0, 4, 2, 1, 5, 3], "entry-point": reach },
  };
  for (const role of ROLE_LIST.map((r) => r.key)) {
    const actual = Object.fromEntries(
      genTilesFor(role, measured, nav)
        .filter((t) => t.kind === "generated")
        .map((t) => [t.id, t.ctx]),
    );
    expect(actual).toEqual(
      Object.fromEntries(
        Object.entries(expected[role]).map(([id, indices]) => [id, indices.map((i) => ids[i])]),
      ),
    );
  }
});

it("keeps every generated context nonempty when role-specific gap measures are absent", () => {
  const features = v.M.map((f) => ({
    ...f,
    grade: null,
    unbacked: 0,
    driftN: 0,
    hasKnow: true,
    obs: { slos: [], alerts: [], checks: [] },
  }));
  const measured = {
    ...v,
    M: features,
    byId: Object.fromEntries(features.map((f) => [f.id, f])),
    teams: [],
  };
  for (const role of ROLE_LIST.map((r) => r.key)) {
    const tiles = genTilesFor(role, measured, nav).filter((t) => t.kind === "generated");
    expect(tiles).toHaveLength(3);
    for (const tile of tiles)
      expect({ tile: `${role}/${tile.id}`, nonempty: tile.ctx.length > 0 }).toMatchObject({
        nonempty: true,
      });
  }
});

it("offers no generated section for a corpus with no records", () => {
  const empty = derive(buildModel({}, [], []));
  for (const role of ROLE_LIST.map((r) => r.key))
    expect(genTilesFor(role, empty, nav).length).toBe(0);
});
