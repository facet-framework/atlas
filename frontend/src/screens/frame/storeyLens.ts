import type { FacetText } from "../text";
import type { FeatureView } from "./model";

export const STOREY_LENSES = ["tests", "fixes", "deviations"] as const;
export type StoreyLens = (typeof STOREY_LENSES)[number];
export type CountLens = Exclude<StoreyLens, "tests">;

export const STOREY_LENS_LABEL = "ui.screens-frame.storeylens-storeys-show";
export const STOREY_LENS_NAMES = {
  tests: "ui.screens-frame.storeylens-test-coverage",
  fixes: "ui.screens-frame.storeylens-bug-fixes",
  deviations: "ui.screens-frame.storeylens-deviations",
} as const;
export const NOT_MEASURED = "ui.screens-frame.storeylens-not-measured";

export function storeyLensOptions(t: FacetText["t"]) {
  return STOREY_LENSES.map((value) => ({ value, label: t(STOREY_LENS_NAMES[value]) }));
}

export const STOREY_COLOURS = [
  "--t-storey-fixes-zero",
  "--t-storey-fixes-low",
  "--t-storey-fixes-medium",
  "--t-storey-fixes-high",
  "--t-storey-fixes-peak",
  "--t-storey-deviations-none",
  "--t-storey-deviations-present",
  "--t-storey-unmeasured",
] as const;

export const UNMEASURED_COLOUR = STOREY_COLOURS.length - 1;

const FIX_STEPS = [1, 3, 8, 20];

export function storeyCount(feature: FeatureView, lens: CountLens): number | null {
  return (lens === "fixes" ? feature.fixCount : feature.deviationCount) ?? null;
}

// @facet: registry/coverage/product-city
// @facet-role: related
export function storeyColour(feature: FeatureView, lens: CountLens): number {
  const count = storeyCount(feature, lens);
  if (count == null) return UNMEASURED_COLOUR;
  if (lens === "deviations") return count > 0 ? 6 : 5;
  return FIX_STEPS.filter((min) => count >= min).length;
}

export function storeyFill(feature: FeatureView, lens: CountLens): string {
  return `var(${STOREY_COLOURS[storeyColour(feature, lens)]})`;
}

export function storeyCountText(text: FacetText, count: number | null): string {
  return count == null ? text.t(NOT_MEASURED) : text.number(count);
}

export function storeyTotalText(text: FacetText, lens: CountLens, count: number): string {
  return text.plural(
    lens === "fixes"
      ? "ui.screens-frame.storeylens-count-fixes"
      : "ui.screens-frame.storeylens-count-deviations",
    count,
  );
}

export function storeyLabel(feature: FeatureView, lens: CountLens, text: FacetText): string {
  const count = storeyCount(feature, lens);
  return `${feature.id}: ${count == null ? text.t(NOT_MEASURED) : storeyTotalText(text, lens, count)}`;
}
