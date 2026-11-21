import { tx } from "../../../frontend/src/i18n";
import type { SearchSource } from "../../../frontend/src/plugin/search";
import { withoutStatus, statusLabel } from "./labels";
import type { AdrModel } from "./model/model";

/** The model the search reads — the one from the load that started last. */

export class Inventory {
  private model: AdrModel | null = null;
  private started = 0;
  private applied = 0;

  /** Marks the start of a load; hand the ticket back to `set`. */
  begin(): number {
    this.started += 1;
    return this.started;
  }

  apply(model: AdrModel, ticket = this.begin()): void {
    if (ticket < this.applied) return;
    this.applied = ticket;
    this.model = model;
  }

  get current(): AdrModel | null {
    return this.model;
  }
}

/** The search source over the store; `open` receives the entry's path. */
export function adrSearch(
  inventory: Inventory,
  open: (path: string) => void,
): SearchSource {
  return {
    label: tx("ui.adr-src.search-decisions"),
    singular: tx("ui.adr-src.search-decision"),
    glyph: "◇",
    tone: "ink",
    hits: () => {
      const model = inventory.current;
      if (!model || model.entries.length === 0) return null;
      return model.entries.map((e) => ({
        title: e.number
          ? `${e.number} ${e.title ?? e.slug}`
          : (e.title ?? e.slug),
        sub: e.concerns ?? e.slug,
        tag: e.status
          ? statusLabel(e.status)
          : (e.statusRaw ?? withoutStatus()),
        open: () => open(e.path),
      }));
    },
  };
}
