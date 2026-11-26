import { useText } from "../text";
import type { FeatureView } from "./model";
import {
  NOT_MEASURED,
  STOREY_COLOURS,
  UNMEASURED_COLOUR,
  storeyCount,
  type CountLens,
} from "./storeyLens";

export const STOREY_NONE = "ui.screens-frame.storeylegend-none";

export function StoreyLegend({ features, lens }: { features: FeatureView[]; lens: CountLens }) {
  const { t } = useText();
  const steps: [number, string][] =
    lens === "fixes"
      ? [
          [0, "0"],
          [1, "1–2"],
          [2, "3–7"],
          [3, "8–19"],
          [4, "20+"],
        ]
      : [
          [5, t(STOREY_NONE)],
          [6, t("ui.screens-frame.storeylegend-deviations")],
        ];
  if (features.some((feature) => storeyCount(feature, lens) == null)) {
    steps.push([UNMEASURED_COLOUR, t(NOT_MEASURED)]);
  }
  return (
    <div
      className="t-a-legend t-meta"
      data-testid="storey-legend"
      aria-label={t("ui.screens-frame.storeylegend-storey-legend")}
    >
      {steps.map(([colour, label]) => (
        <span key={colour} className="t-row" style={{ gap: 6 }}>
          <span
            className="t-a-legend__swatch"
            style={{ background: `var(${STOREY_COLOURS[colour]})` }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
