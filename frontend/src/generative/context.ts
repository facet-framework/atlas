/** Contexts for the generated tiles — which records go into a model's prompt,
 * and the hash that says whether they have moved since a cached run. */

import type { DerivedFeature, DerivedModel } from "../derive";

/** The top N features by how much else depends on them, same ordering `Newcomer.tsx` uses. */
export function topByReach(v: DerivedModel, n: number): DerivedFeature[] {
  return [...v.M]
    .sort((a, b) => b.usedBy.length - a.usedBy.length || b.anchorsN - a.anchorsN)
    .slice(0, n);
}

/** Features whose anchored files changed without their record — `Dev.tsx`'s own list. */
export function drifted(v: DerivedModel, n: number): DerivedFeature[] {
  return v.M.filter((f) => f.driftN > 0)
    .sort((a, b) => b.driftN - a.driftN)
    .slice(0, n);
}

/** Features with the most promises nobody has proven — worst grade first, undefined grade excluded. */
export function worstGraded(v: DerivedModel, n: number): DerivedFeature[] {
  return v.M.filter((f) => f.grade !== null)
    .sort((a, b) => (a.grade as number) - (b.grade as number))
    .slice(0, n);
}

/** Features with scenarios nobody has backed with evidence — most unbacked first. */
export function mostUnbacked(v: DerivedModel, n: number): DerivedFeature[] {
  return v.M.filter((f) => f.unbacked > 0)
    .sort((a, b) => b.unbacked - a.unbacked)
    .slice(0, n);
}

/** How many of a record's four author-owned fields stand filled —
 * `Author.tsx`'s own measure, recomputed here so this module does not import
 * a role component. */

function authorFilled(f: DerivedFeature): number {
  return (
    Number(f.hasKnow) + Number(f.obs !== null) + Number(f.fixes.length > 0) + Number(f.anchorsN > 0)
  );
}

/** The emptiest records by the author's own four fields — `Author.tsx`'s own sort. */
export function emptiestRecords(v: DerivedModel, n: number): DerivedFeature[] {
  return [...v.M].sort((a, b) => authorFilled(a) - authorFilled(b)).slice(0, n);
}

/** Records with no `knowledge` answer at all. */
export function withoutKnowledge(v: DerivedModel, n: number): DerivedFeature[] {
  return v.M.filter((f) => !f.hasKnow).slice(0, n);
}

/** Records with no observation block. */
export function withoutObservation(v: DerivedModel, n: number): DerivedFeature[] {
  return v.M.filter((f) => f.obs === null).slice(0, n);
}

/** Records with the most other records depending on them, weighted by their own dependency count too. */
export function mostConnected(v: DerivedModel, n: number): DerivedFeature[] {
  return [...v.M]
    .sort((a, b) => b.usedBy.length + b.deps.length - (a.usedBy.length + a.deps.length))
    .slice(0, n);
}

/** The team with the most records, and a handful of its own — for a role
 * asking "who carries what" (owner.asks[0]/[1]) rather than a role asking
 * what a feature does. */

export function largestTeam(
  v: DerivedModel,
  n: number,
): { team: string; features: DerivedFeature[] } | null {
  const sorted = [...v.teams].sort((a, b) => b[1].length - a[1].length);
  if (!sorted.length) return null;
  const [team, features] = sorted[0];
  return { team, features: features.slice(0, n) };
}

/** Features with the most anchors — the agent role's own reading of "densely anchored". */
export function mostAnchored(v: DerivedModel, n: number): DerivedFeature[] {
  return [...v.M].sort((a, b) => b.anchorsN - a.anchorsN).slice(0, n);
}

/** A hash over a context's record ids and summary lengths. */

export function hashContext(v: DerivedModel, ids: readonly string[]): string {
  return ids.map((id) => `${id}:${v.byId[id]?.summary.length ?? "—"}`).join("|");
}
