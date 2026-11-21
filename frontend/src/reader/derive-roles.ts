/** What the role views on the Overview show beyond the facet-ui role bodies:
 * the briefs a newcomer can pick up, the defects the records declare, the
 * newest records, the drift baseline, the team portfolio and the raw
 * register for an agent. */

import type { AtlasModel } from "@/model";
import { openKnowledge, type DerivedFeature, type DerivedModel } from "@/derive";

/** First contributions -------------------------------------------------------------- */

/** One unproven promise whose record says what would unblock it. */
export type Opening = {
  record: string;
  scenario: string;
  /** `domain/capability`, or the record id when it is not three segments. */
  capability: string;
  /** The promise's Then sentence; empty when the scenario has none. */
  then: string;
  /** The owner's brief, never empty. */
  brief: string;
  /** Why the promise is unbacked, when somebody said. */
  reason: string;
};

export type Openings = {
  openings: Opening[];
  /** Unbacked promises whose record does not say what would unblock them: counted, not listed. */
  undescribed: number;
};

function capabilityOf(id: string): string {
  const parts = id.split("/");
  return parts.length === 3 ? `${parts[0]}/${parts[1]}` : id;
}

function featureOpenings(f: DerivedFeature): { listed: Opening[]; undescribed: number } {
  const listed: Opening[] = [];
  let undescribed = 0;
  for (const s of f.scen) {
    // A promise a test proves is no work, even if an old brief is still there.
    if (s.evidence !== "un") continue;
    const brief = (s.raw.backing.unblockedBy ?? "").trim();
    if (!brief) {
      undescribed++;
      continue;
    }
    listed.push({
      record: f.id,
      scenario: s.id,
      capability: capabilityOf(f.id),
      then: s.then,
      brief,
      reason: (s.raw.backing.reason ?? "").trim(),
    });
  }
  return { listed, undescribed };
}

/** The first contributions: unbacked promises with an `unblocked_by` brief,
 * ordered by capability name (the same order on every load, never by size),
 * then in record order. Promises without a brief are only counted. */

export function openingsOf(features: readonly DerivedFeature[]): Openings {
  const openings: Opening[] = [];
  let undescribed = 0;
  for (const f of features) {
    const r = featureOpenings(f);
    openings.push(...r.listed);
    undescribed += r.undescribed;
  }
  // Stable sort: equal capabilities keep the record order they came in.
  openings.sort((a, b) =>
    a.capability === b.capability ? 0 : a.capability < b.capability ? -1 : 1,
  );
  return { openings, undescribed };
}

/** Leadership ------------------------------------------------------------------------ */

/** A defect a record declares (`deviation`), in the record's own words. */
export type DeclaredDefect = {
  record: string;
  scenario: string;
  then: string;
  reason: string;
  confirmedBy: string;
  trackedAs: string;
};

/** Every declared defect, area by area and scenario by scenario, as the
 * register orders them. */

export function declaredDefects(features: readonly DerivedFeature[]): DeclaredDefect[] {
  return features.flatMap((f) =>
    f.scen
      .filter((s) => s.deviation)
      .map((s) => ({
        record: f.id,
        scenario: s.id,
        then: s.then,
        reason: (s.deviation?.reason ?? "").trim(),
        confirmedBy: (s.deviation?.confirmedBy ?? "").trim(),
        trackedAs: (s.deviation?.trackedAs ?? "").trim(),
      })),
  );
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/;

/** A real calendar date, alone or followed by "T" and a time; "2026-02-30" is none. */
function isIsoDay(value: string): boolean {
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

/** Records by creation date, newest first. Only an ISO date counts, compared
 * on its first ten characters: the schema has no pattern for `created_at`,
 * and "9.10.2026" would sort above every real date as a string. An unreadable
 * date is left out, never guessed. */

export function newestRecords(
  features: readonly { id: string; createdAt: string | null }[],
): { id: string; created: string }[] {
  return features
    .filter((f) => f.createdAt && isIsoDay(f.createdAt))
    .map((f) => ({ id: f.id, created: f.createdAt!.slice(0, 10) }))
    .sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id));
}

/** Developer ------------------------------------------------------------------------- */

/** The commit the drift comparison ran against, as the scan reports it. */
export type DriftBaseline = {
  ref?: string;
  kind?: "head" | "accepted" | "explicit";
  commit?: string;
  status?: "ok" | "no-baseline" | "unavailable" | "no-repository";
  acceptedAt?: string;
  outcome?: string;
};

/** One lost implementation reference (`facet.ReferenceChange`). */
export type ReferenceChange = {
  kind: "deleted" | "renamed" | "anchor-removed";
  id: string;
  path: string;
  evidence: "baseline" | "private-sidecar";
  surviving: number;
};

export type DriftComparison = {
  /** One line per source repository, or one for the registry; empty when the scan names none. */
  baselines: { repository: string | null; baseline: DriftBaseline }[];
  /** Whether every comparison could be made; an undetermined one is never quiet. */
  determined: boolean;
  /** References lost since the baseline: deleted files and removed anchors. */
  lost: ReferenceChange[];
};

/** What the drift list was compared against, and what got lost on the way. */

export function driftComparison(model: AtlasModel): DriftComparison {
  const raw = model.scan as {
    driftBaseline?: DriftBaseline;
    driftRepositories?: { path: string; baseline: DriftBaseline }[];
    referenceChanges?: ReferenceChange[];
  };
  const repositories = raw.driftRepositories ?? [];
  const baselines = repositories.length
    ? repositories.map((r) => ({ repository: r.path, baseline: r.baseline }))
    : raw.driftBaseline
      ? [{ repository: null, baseline: raw.driftBaseline }]
      : [];
  const ok = (b: DriftBaseline) => !b.status || b.status === "ok";
  return {
    baselines,
    determined: baselines.every((b) => ok(b.baseline)),
    // A rename that carried its anchor along lost nothing.
    lost: (raw.referenceChanges ?? []).filter((r) => r.kind !== "renamed"),
  };
}

/** A scan timestamp rearranged, never interpreted: no time zone arithmetic and
 * no relative wording. A missing stamp is a dash. */

export function stampLabel(iso: string | undefined): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec((iso ?? "").trim());
  if (!parts) return (iso ?? "").trim() || "—";
  return `${parts[1]}-${parts[2]}-${parts[3]} ${parts[4]}:${parts[5]}`;
}

/** Ownership ------------------------------------------------------------------------- */

export type PortfolioFeature = {
  id: string;
  drift: number;
  knowledgeOpen: number;
  dependents: number;
  claims: number;
  proven: number;
};

export type TeamPortfolio = {
  /** The team id, or `null` for the records without an owner. */
  team: string | null;
  features: PortfolioFeature[];
  claims: number;
  proven: number;
  drifted: number;
  asking: number;
};

/** Every feature in its team's group, the most depended-on first. Teams in
 * name order, the records without an owner last. */

export function teamPortfolios(features: readonly DerivedFeature[]): TeamPortfolio[] {
  const by = new Map<string | null, DerivedFeature[]>();
  for (const f of features) {
    const team = f.team || null;
    by.set(team, [...(by.get(team) ?? []), f]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([team, list]) => {
      const rows = list
        .map((f) => ({
          id: f.id,
          drift: f.driftN,
          knowledgeOpen: openKnowledge(f.rec).length,
          dependents: f.usedBy.length,
          claims: f.claims,
          proven: f.proven,
        }))
        .sort((a, b) => b.dependents - a.dependents || a.id.localeCompare(b.id));
      return {
        team,
        features: rows,
        claims: rows.reduce((n, f) => n + f.claims, 0),
        proven: rows.reduce((n, f) => n + f.proven, 0),
        drifted: rows.filter((f) => f.drift > 0).length,
        asking: rows.filter((f) => f.knowledgeOpen > 0).length,
      };
    });
}

/** Agent ----------------------------------------------------------------------------- */

/** One record's state as an agent reads it. */
export type RecordState = {
  id: string;
  lifecycle: string;
  proven: number;
  claims: number;
  anchors: number;
  drift: number;
};

/** Every record with its id, state, proofs, anchors and drift, in id order. */

export function recordStates(features: readonly DerivedFeature[]): RecordState[] {
  return features
    .map((f) => ({
      id: f.id,
      lifecycle: f.life,
      proven: f.proven,
      claims: f.claims,
      anchors: f.anchorsN,
      drift: f.driftN,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The scan excerpt as `GET /api/corpus` delivers it. A size the scan did not
 * count is `null`, never 0. `tests.measured` is `null`: this reader runs no
 * test and reads no report, and a 0 would say a run looked and found none.
 * `knowledge.open` counts by the lint's knowledge-gaps rule. */

export function scanExcerpt(v: DerivedModel): Record<string, unknown> {
  // The reader draws an unmeasured name as "—"; a machine reads null.
  const named = (x: string) => (x && x !== "—" ? x : null);
  return {
    registry: named(v.scan.registry),
    root: named(v.scan.root),
    scannedAt: v.scan.scannedAt,
    files: v.scan.files,
    totalLoc: v.scan.loc,
    anchoredLoc: v.scan.anchoredLoc,
    records: v.M.length,
    promises: {
      total: v.TOT.claims,
      named: v.TOT.proven,
      unclaimed: v.TOT.open + v.TOT.unbacked,
      unbacked: v.TOT.unbacked,
    },
    tests: { measured: null },
    knowledge: { open: v.M.reduce((n, f) => n + openKnowledge(f.rec).length, 0) },
    anchors: { total: v.scan.anchors, orphans: v.orphans.length },
    drift: v.M.filter((f) => f.driftN).map((f) => ({
      id: f.id,
      files: f.drift.map((d) => d.path),
    })),
    orphanAnchors: v.orphans.map((o) => ({ path: o.path, line: o.line, id: o.id })),
  };
}

/** Author ---------------------------------------------------------------------------- */

const KNOWLEDGE_ORDER = [
  "prerequisite_knowledge",
  "not_for",
  "discoverability",
  "common_pitfalls",
  "success_signal",
];

/** The record the knowledge template is for: the record with the most open
 * knowledge slots by the lint's rule (ties by id), and those slots in schema
 * order; `null` when no record has one open. */

export function firstKnowledgeGap(
  features: readonly DerivedFeature[],
): { record: string; slots: string[] } | null {
  const open = features
    .map((f) => ({ id: f.id, slots: openKnowledge(f.rec) }))
    .filter((x) => x.slots.length > 0)
    .sort((a, b) => b.slots.length - a.slots.length || a.id.localeCompare(b.id));
  const first = open[0];
  if (!first) return null;
  return {
    record: first.id,
    slots: KNOWLEDGE_ORDER.filter((k) => first.slots.includes(k)),
  };
}

/** Pillars --------------------------------------------------------------------------- */

/** One capability, with how much from elsewhere rests on it. */
export type Pillar = {
  /** `domain/capability`. */
  id: string;
  /** Edges from other capabilities that land on records under it. */
  incoming: number;
  /** Records it holds. */
  records: number;
};

/** What the dependency graph says the product rests on. `measured: false` is
 * not an empty list: where nobody writes `depends_on` there is no graph, and
 * "no core" would be a claim nobody measured. */

export type Pillars =
  | {
      measured: true;
      pillars: Pillar[];
      edges: number;
      /** The most drawn-on capabilities when none reaches the floor; empty otherwise. */
      leaning: Pillar[];
    }
  | { measured: false };

/** The share of all edges a capability must draw to count as a pillar. */
const PILLAR_SHARE = 0.1;
/** How many capabilities a spread-out graph names as the ones it leans on. */
const LEANING = 3;

function capabilityOrNull(id: string): string | null {
  const parts = id.split("/");
  return parts.length === 3 ? `${parts[0]}/${parts[1]}` : null;
}

/** The pillars of the product, read from `depends_on`: counted per capability
 * (a product does not rest on a file), an edge inside one capability left out
 * (that says the capability is connected, not that the product rests on it),
 * and a share of the edges rather than a rank, because a rank returns five
 * whether the fifth is a pillar or noise. Equal weights order by name, so the
 * answer does not change with the input order. */

export function pillarsOf(features: readonly Pick<DerivedFeature, "id" | "deps">[]): Pillars {
  const incoming = new Map<string, number>();
  const records = new Map<string, number>();
  let edges = 0;
  for (const f of features) {
    const cap = capabilityOrNull(f.id);
    if (cap === null) continue;
    records.set(cap, (records.get(cap) ?? 0) + 1);
  }
  for (const f of features) {
    const own = capabilityOrNull(f.id);
    for (const target of f.deps ?? []) {
      const cap = capabilityOrNull(target);
      if (cap === null || cap === own) continue;
      incoming.set(cap, (incoming.get(cap) ?? 0) + 1);
      edges++;
    }
  }
  if (edges === 0) return { measured: false };
  const all = [...incoming]
    .map(([id, n]) => ({ id, incoming: n, records: records.get(id) ?? 0 }))
    .sort((a, b) => b.incoming - a.incoming || a.id.localeCompare(b.id));
  const floor = Math.max(1, Math.ceil(edges * PILLAR_SHARE));
  const pillars = all.filter((p) => p.incoming >= floor);
  return { measured: true, pillars, edges, leaning: pillars.length ? [] : all.slice(0, LEANING) };
}

/** Anchor coverage ----------------------------------------------------------------------- */

/** How the undescribed part is measured: in lines where the run counted them, else in files. */
export type UndescribedMeasure =
  | { unit: "lines"; undescribed: number; total: number }
  | { unit: "files"; undescribed: number }
  | { unit: "none" };

export type AnchorCoverage = {
  /** Anchors whose record does not exist, with their place. */
  orphans: { path: string; line: number; id: string }[];
  /** Files no anchor describes, largest first; `null` when the run sent no file list. */
  undescribed: { path: string; loc: number }[] | null;
  measure: UndescribedMeasure;
};

/** Both ways a project is out of step with its records, kept apart: anchors
 * pointing at no record, and files nobody described. A run that sent no file
 * list is told apart from a stock in which every file is described. */

// @facet: registry/coverage/anchor-coverage
// @facet-role: primary
export function anchorCoverage(model: AtlasModel): AnchorCoverage {
  const scan = model.scan;
  const orphans = [...(scan.orphanAnchors ?? [])]
    .map((o) => ({ path: o.path, line: o.line, id: o.id }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const list = Array.isArray(scan.unanchoredFiles) ? scan.unanchoredFiles : null;
  const undescribed = list
    ? list
        .map((f) => ({ path: f.path, loc: f.loc }))
        .sort((a, b) => b.loc - a.loc || a.path.localeCompare(b.path))
    : null;
  const total = typeof scan.totalLoc === "number" ? scan.totalLoc : null;
  const anchored = typeof scan.anchoredLoc === "number" ? scan.anchoredLoc : null;
  const measure: UndescribedMeasure =
    total !== null && anchored !== null
      ? { unit: "lines", undescribed: Math.max(0, total - anchored), total }
      : undescribed
        ? { unit: "files", undescribed: undescribed.length }
        : { unit: "none" };
  return { orphans, undescribed, measure };
}
