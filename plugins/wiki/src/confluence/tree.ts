/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

import { tx } from "../../../../frontend/src/i18n";
import type { Side, Mapping } from "./mapping";

/** A wiki area, as the host reports it. */
export type Area = {
  id: string;
  /** `null` for a folder nobody declared — no substitute title. */
  title: string | null;
  state: "ok" | "empty" | "undeclared";
  /** `null` means "not counted" and is something other than `0`. */
  pages: number | null;
};

/** What an area row shows. Every field is already decided. */
export type AreaRow = {
  title: string | null;
  folder: string;
  /** Whether the row is set in mono — the honest state of an undeclared folder. */
  mono: boolean;
  countLabel: string;
};

export function areaRow(b: Area): AreaRow {
  return {
    title: b.state === "undeclared" ? null : b.title,
    folder: `${b.id}/`,
    mono: b.state === "undeclared",
    countLabel: countLabel(b),
  };
}

/**
 * The count on an area row.
 *
 * Three answers, deliberately different: `null` is "not counted", a declared
 * zero is "empty" (somebody created the area and has not written anything
 * into it yet), and everything else is a number with its plural form. A
 * single branch for the first two would have printed "empty" in the place
 * where nobody counted — and that is a claim about the content.
 */
function countLabel(b: Area): string {
  if (b.pages === null) return tx("ui.wiki-src-confluence.tree-not-counted");
  if (b.pages === 0) {
    return b.state === "undeclared"
      ? tx("ui.wiki-src-confluence.tree-no-page")
      : tx("ui.wiki-src-confluence.tree-empty");
  }
  return tx("ui.wiki-src-confluence.tree-count-pages", { count: b.pages });
}

/** A ghost row: what the first run will create in this place. */
export type Ghost = {
  /** The number of the mapping it belongs to. */
  n: number;
  title: string;
  /** Why it is there — "parent page · created", "new area · undeclared". */
  reason: string;
  /** Whether the run creates this row and nothing corresponds to it before. */
  created: boolean;
  /** Whether it carries the ✕ — only at the root of a group. */
  removable: boolean;
  depth: number;
};

/** What a source will create on the far side, as one root row. */
function root(m: Mapping, sourceId: string, areas: Area[]): Ghost {
  if (m.side === "wiki") {
    const b = areas.find((x) => x.id === sourceId);
    return {
      n: m.n,
      title: b?.title ?? sourceId,
      // A parent page in Confluence comes from the area; it does not exist
      // there and is created. That is stated on the row, because the design
      // draws created parents dashed.
      reason: tx("ui.wiki-src-confluence.tree-parent-page-created"),
      created: true,
      removable: true,
      depth: 0,
    };
  }
  return {
    n: m.n,
    title: sourceId,
    // the specification: a new area stays undeclared until wiki.yaml names it.
    // Keeping quiet about it would be a promise nobody gave.
    reason: tx(
      "ui.wiki-src-confluence.tree-new-area-undeclared-until-wiki-yaml",
    ),
    created: true,
    removable: true,
    depth: 0,
  };
}

/**
 * The ghost rows **on** a row — "onto this page and below".
 *
 * `page` is the tree being drawn in; what is searched for are the mappings
 * that were dragged from the *other* side onto this row.
 */
export function ghostsAt(
  side: Side,
  id: string,
  maps: Mapping[],
  areas: Area[],
): Ghost[] {
  return maps
    .filter(
      (m) => m.side !== side && m.target.kind === "onto" && m.target.id === id,
    )
    .flatMap((m) => m.ids.map((sourceId) => root(m, sourceId, areas)));
}

/**
 * The ghost rows **in** a gap — "create new here".
 *
 * Parent and predecessor must both match: a gap is a place, not a node, and
 * two gaps under the same parent are different places. The comparison uses
 * `?? ""` because the root gap has both empty and `undefined === ""` would
 * otherwise not match.
 */
export function ghostsIn(
  side: Side,
  parent: string,
  after: string,
  maps: Mapping[],
  areas: Area[],
): Ghost[] {
  return maps
    .filter(
      (m) =>
        m.side !== side &&
        m.target.kind === "new" &&
        (m.target.parent ?? "") === (parent ?? "") &&
        (m.target.after ?? "") === (after ?? ""),
    )
    .flatMap((m) => m.ids.map((sourceId) => root(m, sourceId, areas)));
}
