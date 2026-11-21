import { tx } from "@/i18n";
import {
  STATE_LABEL,
  type DerivedFeature,
  type DerivedGlossaryGroup,
  type DerivedModel,
} from "../derive";

/** What a tile gets to compute over. */

export type CatalogueSource = { v: DerivedModel };

/** The draft's four groups, in its order. */
export const GROUPS = ["Registry", "Evidence", "Code", "Context"] as const;
export type CatalogueSection = (typeof GROUPS)[number];

/** The label a group is drawn with. */

export function groupLabel(g: string): string {
  if (g === "Evidence") return tx("ui.contents.catalogue-tests-findings");
  if (g === "Context") return tx("ui.contents.catalogue-context");
  return g;
}

/** What a tile shows as its counter. */

export type CatalogueCount =
  | { kind: "numericValue"; n: number; of?: number }
  | { kind: "word"; text: string }
  | { kind: "unknown"; why: string };

export const numericValue = (n: number, of?: number): CatalogueCount => ({
  kind: "numericValue",
  n,
  of,
});
export const word = (text: string): CatalogueCount => ({ kind: "word", text });
export const unknown = (why: string): CatalogueCount => ({ kind: "unknown", why });

/** An entry in the list on the left — mono title, two lines of description, status tag. */
export type CatalogueItem = {
  id: string;
  /** The row's mono title. */
  t: string;
  /** The two-line description below it. */
  s?: string;
  /** The status tag on the right. */
  tag?: string;
  /** The tag's colour: `bad` deadline red, `ok` green, `warn` plan yellow. */
  cls?: "bad" | "ok" | "warn" | "dev";
  /** The group this row belongs to — only on grouped lists (the glossary). */

  group?: string | null;
  /** The object itself, which the detail column draws. */
  raw: unknown;
};

/** A group in the list on the left — heading, state, terms below it. */

export type CatalogueGroup = {
  /** The key for `S.catalogue.closed`. `__none` for the nameless group. */
  key: string;
  /** The heading, or `null` for the groups that have no declared one. */
  title: string | null;
  /** The id, where it is shown in place of a heading. */
  id: string;
  purpose: string | null;
  state: "ok" | "empty" | "undeclared" | "none";
};

/** A content kind's groups, or `null` where it does not group. */

export function catalogueGroups(def: CatalogueDef, q: CatalogueSource): CatalogueGroup[] | null {
  return def.grouped?.(q) ?? null;
}

/** The key under which a group remembers whether it is folded away. */
export const NONE_KEY = "__none";

export type CatalogueDef = {
  /** The group in the grid. */
  g: CatalogueSection;
  /** The tile's and the breadcrumb's label — verbatim from the draft. */
  label: string;
  /** The sentence below the label — verbatim from the draft. */
  desc: string;
  count: (q: CatalogueSource) => CatalogueCount;
  /** Whether the counter stands in deadline red. */
  bad?: (q: CatalogueSource) => boolean;
  items: (q: CatalogueSource) => CatalogueItem[];
  /** The groups the list on the left stands under — absent on every kind of
   * content that does not group. */

  grouped?: (q: CatalogueSource) => CatalogueGroup[] | null;
};

/** The last segment of an id. */
const short = (id: string): string => id.split("/").pop() ?? id;
/** A record id's `domain/capability` — the level of the taxonomy tile. */
export const capOf = (id: string): string => id.split("/").slice(0, 2).join("/");

/** The guide band per record, the specification — as in the draft. */
export const BAND_MAX = 9;

/** The knowledge block's five questions, in the draft's order. */
export const knowSlots = (): string[] => [
  tx("ui.contents.catalogue-prerequisite"),
  tx("ui.contents.catalogue-not"),
  tx("ui.contents.catalogue-getting-started"),
  tx("ui.contents.catalogue-typical-mistakes"),
  tx("ui.contents.catalogue-success-signal"),
];

/** A test file and the promises it names. */
export type CatalogueTest = {
  file: string;
  proves: { f: DerivedFeature; s: DerivedFeature["scen"][number] }[];
};

/** Test files, descending by the number of promises they name. */

export function catalogueTests(v: DerivedModel): CatalogueTest[] {
  const map = new Map<string, CatalogueTest>();
  v.M.forEach((f) =>
    f.scen.forEach((s) =>
      s.tests.forEach((file) => {
        const entry = map.get(file) ?? { file, proves: [] };
        entry.proves.push({ f, s });
        map.set(file, entry);
      }),
    ),
  );
  return [...map.values()].sort((a, b) => b.proves.length - a.proves.length);
}

/** An anchor in the source — with its record, or orphaned without one. */
export type CatalogueAnchor =
  | { id: string; f: DerivedFeature; a: DerivedFeature["anchors"][number]; o?: undefined }
  | { id: string; o: DerivedModel["orphans"][number]; f?: undefined; a?: undefined };

export function catalogueAnchors(v: DerivedModel): CatalogueAnchor[] {
  return [
    ...v.M.flatMap((f) => f.anchors.map((a) => ({ id: `${a.path}:${a.line}`, f, a }))),
    ...v.orphans.map((o) => ({ id: `${o.path}:${o.line}`, o })),
  ];
}

/** A file that was read — with anchors, or without a record. */
export type CatalogueFile = {
  path: string;
  anchors: { f: DerivedFeature; a: DerivedFeature["anchors"][number] }[];
  recs: DerivedFeature[];
  /** When the file changed without its record following. */
  drift: string | null;
  /** Lines — `null` where the scan sent this file without a number. */
  loc: number | null;
  /** Whether no record describes the file (the specification, not an error). */
  un?: boolean;
};

export function catalogueFiles(v: DerivedModel): CatalogueFile[] {
  const map = new Map<string, CatalogueFile>();
  v.M.forEach((f) =>
    f.anchors.forEach((a) => {
      const e = map.get(a.path) ?? {
        path: a.path,
        anchors: [],
        recs: [],
        drift: null,
        loc: null,
      };
      e.anchors.push({ f, a });
      if (!e.recs.includes(f)) e.recs.push(f);
      const d = f.drift.find((x) => x.path === a.path);
      if (d) e.drift = d.changedAt;
      map.set(a.path, e);
    }),
  );
  // An anchored file's lines stand in the scan's file list — where the
  // unanchored ones have theirs too. Where the list is missing it stays
  // `null`: the file was read, nobody sent its length along.
  const anchoredLoc = new Map(
    (v.model.scan.anchoredFiles ?? []).map((file) => [file.path, file.loc] as const),
  );
  map.forEach((e) => (e.loc = anchoredLoc.get(e.path) ?? null));

  return [
    ...[...map.values()].sort((a, b) => a.path.localeCompare(b.path)),
    ...v.unanchored.map((u) => ({
      path: u.path,
      anchors: [],
      recs: [],
      drift: null,
      loc: typeof u.loc === "number" ? u.loc : null,
      un: true,
    })),
  ];
}

/** Drift: every anchored file that changed without its record. */
export const catalogueDrift = (
  v: DerivedModel,
): { f: DerivedFeature; d: DerivedFeature["drift"][number] }[] =>
  v.M.flatMap((f) => f.drift.map((d) => ({ f, d })));

/** The "scenarios per record" series from the host's calibration. */

export function scenarioBand(v: DerivedModel) {
  return v.model.calibration?.metrics.find((m) => m.name === "scenarios per record") ?? null;
}

/** The group a term stands in — as the key the list files it under. */

function groupOf(groups: DerivedGlossaryGroup[] | null | undefined, term: string): string | null {
  const group = groups?.find((g) => g.terms.includes(term));
  if (!group) return null;
  return group.id === "" ? NONE_KEY : group.id;
}

/** A promise's row in a `kv` list — title, Then sentence, state of proof. */
const scenItem = (f: DerivedFeature, s: DerivedFeature["scen"][number]): CatalogueItem => ({
  id: `${f.id}#${s.id}`,
  t: s.id,
  s: `${short(f.id)} — Then ${s.then}`,
  raw: { f, s },
});

/** The kinds of content, in the draft's order. */

export const CATALOGUE: Record<string, CatalogueDef> = {
  records: {
    g: "Registry",
    get label() {
      return tx("ui.contents.catalogue-records");
    },
    get desc() {
      return tx("ui.contents.catalogue-one-feature-one-file-intent-promises");
    },
    count: ({ v }) => numericValue(v.M.length),
    items: ({ v }) =>
      v.M.map((f) => ({
        id: f.id,
        t: f.id,
        s: f.summary,
        tag: `${f.proven}/${f.claims}`,
        cls: f.driftN ? ("bad" as const) : undefined,
        raw: f,
      })),
  },
  promises: {
    g: "Registry",
    get label() {
      return tx("ui.contents.catalogue-promises");
    },
    get desc() {
      return tx("ui.contents.catalogue-given-when-then-every-promise-its");
    },
    count: ({ v }) => numericValue(v.TOT.claims),
    items: ({ v }) =>
      v.M.flatMap((f) =>
        f.scen
          .filter((s) => s.state !== "dev")
          .map((s) => ({
            ...scenItem(f, s),
            tag: `${STATE_LABEL[s.state as "ok" | "un" | "no"]}${s.audience ? " · " + s.audience : ""}`,
            cls: STC[s.state as "ok" | "un" | "no"],
          })),
      ),
  },
  knowledge: {
    g: "Registry",
    get label() {
      return tx("ui.contents.catalogue-knowledge");
    },
    get desc() {
      return tx("ui.contents.catalogue-five-knowledge-slots-per-record-where");
    },
    count: ({ v }) => numericValue(v.M.filter((f) => f.hasKnow).length, v.M.length),
    items: ({ v }) =>
      [...v.M]
        .sort((a, b) => (b.hasKnow ? 1 : 0) - (a.hasKnow ? 1 : 0))
        .map((f) => ({
          id: f.id,
          t: f.id,
          s: f.hasKnow ? (f.know[0]?.answer ?? "") : tx("ui.contents.catalogue-slots-empty"),
          tag: f.hasKnow ? tx("ui.contents.catalogue-filled") : tx("ui.contents.catalogue-empty"),
          cls: f.hasKnow ? ("ok" as const) : ("warn" as const),
          raw: f,
        })),
  },
  operations: {
    g: "Registry",
    get label() {
      return tx("ui.contents.catalogue-operation");
    },
    get desc() {
      return tx("ui.contents.catalogue-slos-alerts-standing-checks-observation-block");
    },
    count: ({ v }) => numericValue(v.M.filter((f) => f.obs).length, v.M.length),
    items: ({ v }) =>
      [...v.M]
        .sort((a, b) => (b.obs ? 1 : 0) - (a.obs ? 1 : 0))
        .map((f) => ({
          id: f.id,
          t: f.id,
          s: f.obs
            ? tx("ui.contents.catalogue-slos-slos-alerts-alerts-checks-checks", {
                slos: f.obs.slos.length,
                alerts: f.obs.alerts.length,
                checks: f.obs.checks.length,
              })
            : tx("ui.contents.catalogue-no-observation-block"),
          tag: f.obs ? tx("ui.contents.catalogue-promised") : tx("ui.contents.catalogue-open"),
          cls: f.obs ? ("ok" as const) : ("warn" as const),
          raw: f,
        })),
  },
  provenance: {
    g: "Registry",
    get label() {
      return tx("ui.contents.catalogue-origin");
    },
    get desc() {
      return tx("ui.contents.catalogue-what-record-needs-who-needs-which");
    },
    count: ({ v }) => numericValue(v.M.length),
    items: ({ v }) =>
      [...v.M]
        .sort((a, b) => b.usedBy.length - a.usedBy.length)
        .map((f) => ({
          id: f.id,
          t: f.id,
          s: tx("ui.contents.catalogue-supports-carries-needs-needs", {
            carries: f.usedBy.length,
            needs: f.deps.filter((d) => d !== "—").length,
          }),
          tag: f.team,
          raw: f,
        })),
  },
  taxonomy: {
    g: "Registry",
    get label() {
      return tx("ui.contents.catalogue-taxonomy");
    },
    get desc() {
      return tx("ui.contents.catalogue-domains-capabilities-ids-drawn");
    },
    count: ({ v }) => numericValue(v.cats.length),
    items: ({ v }) =>
      v.cats.map(([id, list]) => ({
        id,
        t: id,
        s: tx("ui.contents.catalogue-n-records", { n: list.length }),
        tag: id.split("/")[0],
        raw: { id, list },
      })),
  },
  calibration: {
    g: "Registry",
    get label() {
      return tx("ui.contents.catalogue-calibration");
    },
    get desc() {
      return tx("ui.contents.catalogue-whether-registry-follows-its-calibration-bands");
    },
    count: ({ v }) => {
      const band = scenarioBand(v);
      if (!band) return unknown(tx("ui.contents.catalogue-not-calibrated"));
      return band.above ? numericValue(band.above) : word(tx("ui.contents.catalogue-within-band"));
    },
    bad: ({ v }) => (scenarioBand(v)?.above ?? 0) > 0,
    items: () => [{ id: "cal", t: "facet calibrate", raw: 1 }],
  },
  tests: {
    g: "Evidence",
    get label() {
      return tx("ui.contents.catalogue-tests");
    },
    get desc() {
      return tx("ui.contents.catalogue-test-files-promises-they-name");
    },
    count: ({ v }) => numericValue(catalogueTests(v).length),
    items: ({ v }) =>
      catalogueTests(v).map((t) => ({
        id: t.file,
        t: t.file,
        s: tx("ui.contents.catalogue-n-promises-records-records", {
          n: t.proves.length,
          records: new Set(t.proves.map((p) => p.f.id)).size,
        }),
        tag: `${t.proves.length}`,
        raw: t,
      })),
  },
  deviations: {
    g: "Evidence",
    get label() {
      return tx("ui.contents.catalogue-deviations");
    },
    get desc() {
      return tx("ui.contents.catalogue-behaviour-code-demonstrably-shows-nobody-wants");
    },
    count: ({ v }) => numericValue(v.TOT.devs),
    bad: ({ v }) => v.TOT.devs > 0,
    items: ({ v }) =>
      v.M.flatMap((f) =>
        f.scen
          .filter((s) => s.state === "dev")
          .map((s) => ({
            ...scenItem(f, s),
            s: `${short(f.id)} — ${s.deviation?.reason ?? ""}`,
            tag: s.deviation?.confirmedBy ?? tx("ui.contents.catalogue-not-recorded"),
            cls: "dev" as const,
          })),
      ),
  },
  drift: {
    g: "Evidence",
    get label() {
      return tx("ui.contents.catalogue-drift");
    },
    get desc() {
      return tx("ui.contents.catalogue-anchored-files-changed-without-record-following");
    },
    count: ({ v }) => numericValue(v.TOT.drift),
    bad: ({ v }) => v.TOT.drift > 0,
    items: ({ v }) =>
      catalogueDrift(v).map(({ f, d }) => ({
        id: `${f.id}#${d.path}`,
        t: d.path,
        s: `${short(f.id)} · ${d.changedAt}`,
        tag: tx("ui.contents.catalogue-drift"),
        cls: "bad" as const,
        raw: { f, d },
      })),
  },
  fixed: {
    g: "Evidence",
    get label() {
      return tx("ui.contents.catalogue-fixed");
    },
    get desc() {
      return tx("ui.contents.catalogue-bugfix-commits-attributed-records-through-their");
    },
    count: ({ v }) => numericValue(v.allFixes.length),
    items: ({ v }) =>
      v.allFixes.map(({ f, x }) => ({
        id: x.commit,
        t: x.subject,
        s: `${short(f.id)} · ${x.files[0] ?? ""}`,
        tag: x.date,
        raw: { f, x },
      })),
  },
  anchor: {
    g: "Code",
    get label() {
      return tx("ui.contents.catalogue-anchors");
    },
    get desc() {
      return tx("ui.contents.catalogue-every-facet-tag-source-line-points");
    },
    count: ({ v }) => numericValue(catalogueAnchors(v).length),
    items: ({ v }) =>
      catalogueAnchors(v).map((x) => ({
        id: x.id,
        t: x.id,
        s: x.o
          ? tx("ui.contents.catalogue-facet-id-no-record", { id: x.o.id })
          : `${short(x.f.id)} · ${x.a.excerpt ?? ""}`,
        tag: x.o ? tx("ui.contents.catalogue-orphaned") : x.a.role,
        cls: x.o ? ("bad" as const) : x.a.role === "primary" ? ("ok" as const) : undefined,
        raw: x,
      })),
  },
  files: {
    g: "Code",
    get label() {
      return tx("ui.contents.catalogue-files");
    },
    get desc() {
      return tx("ui.contents.catalogue-what-scan-read-anchors-without");
    },
    count: ({ v }) => numericValue(catalogueFiles(v).length),
    items: ({ v }) =>
      catalogueFiles(v).map((e) => ({
        id: e.path,
        t: e.path,
        s: e.un
          ? e.loc === null
            ? tx("ui.contents.catalogue-no-record")
            : tx("ui.contents.catalogue-n-lines-no-record", { n: e.loc })
          : tx("ui.contents.catalogue-n-anchors-records", {
              n: e.anchors.length,
              records: e.recs.map((f) => short(f.id)).join(", "),
            }),
        tag: e.un
          ? tx("ui.contents.catalogue-without-record")
          : e.drift
            ? tx("ui.contents.catalogue-drift")
            : tx("ui.contents.catalogue-anchored"),
        cls: e.un ? ("warn" as const) : e.drift ? ("bad" as const) : ("ok" as const),
        raw: e,
      })),
  },
  rules: {
    g: "Context",
    get label() {
      return tx("ui.contents.catalogue-rules");
    },
    get desc() {
      return tx("ui.contents.catalogue-policies-apply-records");
    },
    count: ({ v }) => numericValue(v.policies.length),
    items: ({ v }) =>
      v.policies.map((r) => ({
        id: r.id,
        t: r.id,
        s: r.summary,
        tag: r.lifecycle,
        raw: { r, kind: "policy" },
      })),
  },
  assumptions: {
    g: "Context",
    get label() {
      return tx("ui.contents.catalogue-assumptions");
    },
    get desc() {
      return tx("ui.contents.catalogue-what-counts-given-until-somebody-disproves");
    },
    count: ({ v }) => numericValue(v.assumptions.length),
    items: ({ v }) =>
      v.assumptions.map((r) => ({
        id: r.id,
        t: r.id,
        s: r.summary,
        tag: r.lifecycle,
        raw: { r, kind: "assumption" },
      })),
  },
  "data-shapes": {
    g: "Context",
    get label() {
      return tx("ui.contents.catalogue-data-forms");
    },
    get desc() {
      return tx("ui.contents.catalogue-entities-records-name");
    },
    count: ({ v }) => numericValue(v.entities.length),
    items: ({ v }) =>
      v.entities.map((r) => ({
        id: r.id,
        t: r.id,
        s: r.summary,
        tag: r.lifecycle,
        raw: { r, kind: "data" },
      })),
  },
  teams: {
    g: "Context",
    get label() {
      return tx("ui.contents.catalogue-teams");
    },
    get desc() {
      return tx("ui.contents.catalogue-owners-their-share-records-promises-drift");
    },
    count: ({ v }) => numericValue(v.teams.length),
    items: ({ v }) =>
      v.teams.map(([name, list]) => ({
        id: name,
        t: name,
        s: tx("ui.contents.catalogue-records-records-claims-promises", {
          records: list.length,
          claims: list.reduce((a, f) => a + f.claims, 0),
        }),
        tag: tx("ui.contents.catalogue-n-drift", { n: list.filter((f) => f.driftN).length }),
        cls: list.some((f) => f.driftN) ? ("bad" as const) : undefined,
        raw: { name, list },
      })),
  },
  glossary: {
    g: "Context",
    get label() {
      return tx("ui.contents.catalogue-glossary");
    },
    get desc() {
      return tx("ui.contents.catalogue-technical-terms-explained-once-where-each");
    },
    // Without a declared glossary there is nothing to count — and a zero
    // would mean the project has one with no term in it. That is the opposite
    // of what is the case (the specification).
    count: ({ v }) =>
      v.glossary
        ? numericValue(v.glossary.terms.length)
        : unknown(tx("ui.contents.catalogue-not-declared")),
    items: ({ v }) =>
      (v.glossary?.terms ?? []).map((g) => ({
        id: g.term,
        t: g.term,
        s: g.definition.split("\n")[0],
        tag: `${(v.glossary?.usedBy[g.term] ?? []).length}×`,
        // From the groups and not from the term: the data layer does not

        // would be a second place for the same assignment. `null` is the
        // answer for a term no group names — which is every term for as long
        // as nobody has grouped.
        group: groupOf(v.glossary?.groups, g.term),
        raw: g,
      })),
    // Read and not computed: `Grouped()` in the host decided the order and
    // `derive` passes it through. What happens here is purely the translation
    // into what the list draws — above all the `state`, which keeps the
    // draft's four states apart.
    grouped: ({ v }) =>
      v.glossary?.groups?.map((g) => ({
        key: g.id === "" ? NONE_KEY : g.id,
        id: g.id,
        // The nameless group gets its sentence only here, in the surface.
        // The host leaves it empty on purpose: a name given there would be
        // the name in every surface at once — and "Other" is absence with
        // a heading (the specification).
        title:
          g.id === ""
            ? tx("ui.contents.catalogue-no-category")
            : g.declared
              ? (g.title ?? null)
              : null,
        purpose: g.purpose ?? null,
        state: g.id === "" ? "none" : !g.declared ? "undeclared" : g.terms.length ? "ok" : "empty",
      })) ?? null,
  },

  decisions: {
    g: "Context",
    get label() {
      return tx("ui.contents.catalogue-decisions");
    },
    get desc() {
      return tx("ui.contents.catalogue-documents-records-refer-how-often");
    },
    count: ({ v }) => numericValue(v.model.decisionTargets.length),
    items: ({ v }) =>
      v.model.decisionTargets.map((d) => ({
        id: d.target,
        t: d.target,
        s: tx(
          d.count === 1
            ? "ui.contents.catalogue-n-record-refers"
            : "ui.contents.catalogue-n-records-refer",
          { n: d.count },
        ),
        tag: `${d.count}×`,
        raw: d,
      })),
  },
  configuration: {
    g: "Context",
    get label() {
      return tx("ui.contents.catalogue-configuration");
    },
    get desc() {
      return tx("ui.contents.catalogue-facetrc-yaml-run-read");
    },
    count: () => word(".facetrc"),
    items: () => [{ id: "rc", t: ".facetrc.yaml", raw: 1 }],
  },
  // `cyclic` is the host's Kahn remainder: nodes on a cycle or downstream,
  // including declared IDs for which no record was read. It is not a cycle count.

  cycles: {
    g: "Registry",
    get label() {
      return tx("ui.contents.catalogue-affected-cycles");
    },
    get desc() {
      return tx("ui.contents.catalogue-nodes-cycle-behind-one-not-number");
    },
    count: ({ v }) => numericValue(v.model.cyclic.length),
    bad: ({ v }) => v.model.cyclic.length > 0,
    items: ({ v }) =>
      v.model.cyclic.map((id) => ({
        id,
        t: id,
        s: v.byId[id]?.summary ?? tx("ui.contents.catalogue-no-record-read-id"),
        tag: tx("ui.contents.catalogue-node"),
        cls: "bad" as const,
        raw: id,
      })),
  },

  validation: {
    g: "Context",
    get label() {
      return tx("ui.contents.catalogue-validation");
    },
    get desc() {
      return tx("ui.contents.catalogue-files-run-could-not-read-they");
    },
    count: ({ v }) => numericValue(v.model.corpusErrors.length),
    bad: ({ v }) => v.model.corpusErrors.length > 0,
    items: ({ v }) =>
      v.model.corpusErrors.map((e) => ({
        id: e.path,
        t: e.path,
        s: e.line
          ? tx("ui.contents.catalogue-line-line-message", { line: e.line, message: e.message })
          : e.message,
        tag: tx("ui.contents.catalogue-not-read"),
        cls: "bad" as const,
        raw: e,
      })),
  },
  run: {
    g: "Context",
    get label() {
      return tx("ui.contents.catalogue-run");
    },
    get desc() {
      return tx("ui.contents.catalogue-scan-when-over-what-which-counters");
    },
    // The draft shows the run's time of day. A host that sends none has
    // none — then the answer stands there and not "00:00".
    count: ({ v }) =>
      v.scan.scannedAt
        ? word(`${v.scan.scannedAt.slice(11, 16)}`)
        : unknown(tx("ui.contents.catalogue-no-time-reported")),
    items: () => [{ id: "scan", t: "corpus.scan", raw: 1 }],
  },
};

/** The draft's colour classes per state of proof. */
export const STC: Record<"ok" | "un" | "no", "ok" | "warn" | "bad"> = {
  ok: "ok",
  un: "warn",
  no: "bad",
};

/** The tile ids the core itself holds. */

export const CORE_CATALOGUE_IDS: ReadonlySet<string> = new Set(Object.keys(CATALOGUE));
