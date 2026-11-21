/** The words the ADR plugin shows for values of its own model — a count, a
 * status — through the reader's translation layer, in one place so the rail,
 * the front page and the reader cannot each spell a status differently. */

import { tx } from "../../../frontend/src/i18n";
import type { AdrStatus } from "./model/headers";

/** "1 decision" / "3 decisions". */
export function count(n: number): string {
  return tx(I18N_LABELS[`${n === 1 ? "one" : "other"}`], { count: n });
}

/** The label of a known status. */
export function statusLabel(status: AdrStatus): string {
  switch (status) {
    case "proposed":
      return tx("ui.adr-src.labels-proposed");
    case "accepted":
      return tx("ui.adr-src.labels-accepted");
    case "superseded":
      return tx("ui.adr-src.labels-superseded");
    case "rejected":
      return tx("ui.adr-src.labels-rejected");
  }
}

/** What an entry whose file names no status known to the plugin shows. */
export function withoutStatus(): string {
  return tx("ui.adr-src.labels-status-not-stated");
}

// Explicit keys let computed lookups follow source moves.
const I18N_LABELS: Record<string, string> = {
  one: "ui.adr-src.labels-count-decisions-one",
  other: "ui.adr-src.labels-count-decisions-other",
};
