import { color } from "@facet-tools/ui/tokens";
/** The seven FACET facets of a record, in schema order. */
export const FACETS = [
  "intent",
  "contract",
  "verification",
  "observation",
  "knowledge",
  "lineage",
  "anchors",
] as const;

export type Facet = (typeof FACETS)[number];

/**
 * English plain-text labels — schema jargon stays in the raw source. For the
 * active language use `facetLabel` from `@/model`.
 */
export const FACET_LABEL: Record<Facet, string> = {
  intent: "Purpose",
  contract: "Promise",
  verification: "Test coverage",
  observation: "Operations",
  knowledge: "Knowledge",
  lineage: "Origin",
  anchors: "Entry points in code",
};

/** Test levels from `verification.*_tests`. */
export const TEST_KINDS = ["unit", "property", "integration", "e2e"] as const;

export type TestKind = (typeof TEST_KINDS)[number];

/** English test-level labels; `testKindLabel` from `@/model` follows the active language. */
export const TEST_KIND_LABEL: Record<string, string> = {
  unit: "Unit",
  property: "Property",
  integration: "Integration",
  e2e: "End-to-end",
};

/** English record-kind words; `recordKindLabel` from `@/model` follows the active language. */
export const KIND_WORD: Record<string, string> = {
  feature: "Feature",
  policy: "Policy",
  assumption: "Assumption",
  entity: "Data object",
};

/** English lifecycle words; `lifecycleLabel` from `@/model` follows the active language. */
export const LIFECYCLE_LABEL: Record<string, string> = {
  active: "active",
  planned: "planned",
  deprecated: "deprecated",
  draft: "draft",
};

/** Lifecycle colour: active carries ink, planned ochre, deprecated muted. */
export function lifecycleColor(lifecycle: string | undefined): string {
  if (lifecycle === "active") return color.ink;
  if (lifecycle === "planned") return color.plan;
  if (lifecycle === "deprecated") return color.faint;
  return color.dim;
}

/**
 * Heat level of a cell in the defect register: four opacities of the same
 * signal colour, graded against the largest count in the registry.
 *
 * Relative and not absolute, because there is no threshold that holds for two
 * repositories — three fixes are the peak in a registry whose maximum is three
 * and a footnote in one whose maximum is forty. So the scale shows where
 * something stands relative to the rest, and the number in the cell says how
 * many there are: the colour never carries the statement alone.
 *
 * `0` is not a level but the surface beneath. A value nobody has collected is
 * not one either — for that the caller asks `present`.
 */
export function heatSurface(count: number, max: number): string {
  if (count <= 0 || max <= 0) return "transparent";
  const ratio = count / max;
  if (ratio <= 0.25) return color.heat1;
  if (ratio <= 0.5) return color.heat2;
  if (ratio <= 0.75) return color.heat3;
  return color.heat4;
}

/** The four states every FACET component handles. */
export type Status = "ready" | "loading" | "empty" | "error";
