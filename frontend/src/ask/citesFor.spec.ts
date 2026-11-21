/** Citations are jumps — and a jump that lands confidently somewhere else is
 * worse than none. */

import { buildModel, type RawRecord, type RepoScan } from "@/model";
import { derive } from "../derive";
import { citesFor } from "./cites";

function rec(id: string, path: string): RawRecord {
  return {
    path,
    raw: "",
    doc: {
      id,
      lifecycle: "active",
      intent: { summary: `Record ${id}` },
      lineage: { owner: { team: "t" }, created_at: "2026-01-01" },
    },
  };
}

// `a/b/index` is a prefix of `a/b/indexer` — exactly the trap.
const RAWS = [
  rec("a/b/index", "docs/facets/a/b/index.yaml"),
  rec("a/b/indexer", "docs/facets/a/b/indexer.yaml"),
  rec("c/d/lonely", "docs/facets/c/d/lonely.yaml"),
];

const ANCHORS: RepoScan["anchors"] = {
  "c/d/lonely": [{ path: "src/lonely/run.ts", line: 4, role: "primary" }],
  "a/b/index": [{ path: "src/shared/util.ts", line: 1, role: "related" }],
  "a/b/indexer": [{ path: "src/shared/util.ts", line: 2, role: "related" }],
};

const v = derive(
  buildModel(
    { name: "citations" },
    RAWS.map((r) => r.path),
    RAWS,
    { anchors: ANCHORS },
  ),
);

const cite = (target: string) => citesFor(v, [{ kind: "read", target }]);

describe("citesFor", () => {
  it("does not jump when two ids fit the same path", () => {
    // Contains, as a string, both `a/b/index` and `a/b/indexer`.
    expect(cite("src/a/b/indexer/scan.ts")).toEqual([]);
  });

  it("jumps when exactly one record is the file that was read", () => {
    expect(cite("docs/facets/c/d/lonely.yaml")).toEqual([{ fid: "c/d/lonely", label: "lonely" }]);
  });

  it("jumps through the anchor when exactly one feature anchors the file", () => {
    expect(cite("/repo/src/lonely/run.ts")).toEqual([{ fid: "c/d/lonely", label: "lonely" }]);
  });

  it("does not jump when two features share an anchored file", () => {
    expect(cite("src/shared/util.ts")).toEqual([]);
  });

  it("names every target at most once, even when it was read several times", () => {
    const hits = citesFor(v, [
      { kind: "read", target: "docs/facets/c/d/lonely.yaml" },
      { kind: "grep", target: "src/lonely/run.ts" },
    ]);
    expect(hits).toEqual([{ fid: "c/d/lonely", label: "lonely" }]);
  });

  it("skips steps without a target", () => {
    expect(citesFor(v, [{ kind: "status", target: "" }])).toEqual([]);
  });
});
