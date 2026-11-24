import { useText } from "../text";
import { ratioPercent } from "../../share";

/** English number format. FACET screens format through `useText().number`. */
export const nf = (n: number) => n.toLocaleString("en-US");
/** English percent text. FACET screens use `usePct()`. */
export const pct = (v: number | null) => (v == null ? "—" : `${ratioPercent(v)} %`);

/** A share (0–1, `null` = not measured) as a whole percent in the active language. */
export function usePct() {
  const { t } = useText();
  return (v: number | null) =>
    v == null ? "—" : t("ui.screens-contents.charts-value", { value: ratioPercent(v) });
}
