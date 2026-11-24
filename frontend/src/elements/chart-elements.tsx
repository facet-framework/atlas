import { DateHistogram, RingMeter, useText as useUiText } from "@facet-tools/ui";
import type { DateHistogramProps } from "@facet-tools/ui";
import { useText } from "../component-text";

export type CoverageRingProps = {
  value: number;
  total: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
};

export function CoverageRing({ value, total, size, strokeWidth, label }: CoverageRingProps) {
  const { t } = useText();
  const valueText = t("elements.coverageRing.label", { value, total });
  return (
    <RingMeter
      value={total ? value / total : null}
      valueText={valueText}
      label={label ?? valueText}
      tone={value >= total ? "ok" : "signal"}
      size={size}
      stroke={strokeWidth}
    />
  );
}

export type TimelineProps = Pick<
  DateHistogramProps,
  "events" | "unit" | "bucket" | "height" | "empty"
>;

export function Timeline(props: TimelineProps) {
  const { t } = useUiText();
  return <DateHistogram {...props} label={props.unit ?? t("primitives.histogram.unit")} />;
}
