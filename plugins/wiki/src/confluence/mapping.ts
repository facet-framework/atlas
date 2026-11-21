/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */

/** Which tree. The wiki on the left, Confluence on the right. */
export type Side = "wiki" | "conf";

/**
 * The selection on **one** side — never on both.
 *
 * A selection on both sides would be a pair, and a pair is already a
 * mapping. The design keeps the two explicitly apart: you select on one side
 * and map by dragging. That is why a choice on the other side replaces the
 * existing one instead of adding to it.
 */
export type Selection = { side: Side; ids: string[] } | null;

/**
 * Where a package was dropped.
 *
 * `on` is an existing row — the pages land beneath it. `new` is the gap
 * between two rows; `parent` is the node the gap lies in (empty for the
 * root), `after` the row before it (empty for "at the very top"). Both are
 * needed: without `parent` the preview would not know in which branch the
 * ghost rows appear; without `after`, not at which position within it.
 */
export type Target =
  { kind: "onto"; id: string } | { kind: "new"; parent: string; after: string };

/** A draft mapping that has not run and establishes no connection. */
export type Mapping = {
  /** The number shown on the rows on both sides. */
  n: number;
  /** Which side it was dragged from — that sets the direction. */
  side: Side;
  /** The package's source rows. */
  ids: string[];
  target: Target;
};

/**
 * An **existing** connection, as the host read it from `.mirror.json` and
 * the pages' header lines.
 *
 * `source` is the file this was read from. It is here so the surface can name
 * the origin instead of asserting a badge — a connection that only appears
 * as a colour is a claim without a location.
 */
export type Connection = {
  /** The wiki area. */
  area: string;
  /** The counterpart in Confluence — a space key or `KEY/<id>`. */
  target: string;
  /**
   * Who wins. `ursprung`: the wiki pushes out. `kopie`: the area came from
   * Confluence and Confluence rules. `open`: imported and nobody has
   * decided — the state from the specification, and a real third one, not a gap.
   */
  kind: "origin" | "copy" | "open";
  evidence: string;
};

/** Whether this row can still be selected at all. */
export function selectable(
  side: Side,
  id: string,
  maps: Mapping[],
  conns: Connection[],
): boolean {
  if (numberOf(side, id, maps) !== null) return false;
  return !connectionOf(side, id, conns);
}

/** The connection attached to this row — searched for on both sides. */
export function connectionOf(
  side: Side,
  id: string,
  conns: Connection[],
): Connection | null {
  const match = conns.find((c) => (side === "wiki" ? c.area : c.target) === id);
  return match ?? null;
}

export function select(
  previous: Selection,
  side: Side,
  id: string,
  maps: Mapping[],
  conns: Connection[],
): Selection {
  if (!selectable(side, id, maps, conns)) return previous;
  if (!previous || previous.side !== side) return { side, ids: [id] };
  if (previous.ids.includes(id)) {
    const rest = previous.ids.filter((x) => x !== id);
    return rest.length ? { side, ids: rest } : null;
  }
  return side === "wiki"
    ? { side, ids: [...previous.ids, id] }
    : { side, ids: [id] };
}

/**
 * Drop the package.
 *
 * A drop on its own side is not a mapping but a slipped pointer — it is
 * discarded and not reported as "invalid", because the user never meant it.
 * A drop on a row that already carries a number is discarded too: two
 * numbers on one row would be two answers to the question of where it
 * belongs.
 */
export function mapSelection(
  maps: Mapping[],
  sel: Selection,
  target: Target,
  droppedOn?: Side,
): Mapping[] {
  if (!sel) return maps;
  if (droppedOn && droppedOn === sel.side) return maps;
  const opposite: Side = sel.side === "wiki" ? "conf" : "wiki";
  if (target.kind === "onto" && numberOf(opposite, target.id, maps) !== null)
    return maps;
  return [
    ...maps,
    { n: maps.length + 1, side: sel.side, ids: [...sel.ids], target },
  ];
}

/**
 * Release a mapping — and renumber the rest.
 *
 * Renumbered because the number is a **position in the list** and not an
 * identifier: if ② stayed after releasing ①, the screen would show a list
 * that starts at two.
 */
export function release(maps: Mapping[], n: number): Mapping[] {
  return maps.filter((m) => m.n !== n).map((m, i) => ({ ...m, n: i + 1 }));
}

/**
 * The number on this row — on the source side as on the target side.
 *
 * That is the visible 1:1: the same number stands on the left at the chosen
 * areas and on the right at the row they were dragged onto. A gap carries
 * none, because no row stands at a gap — there the number appears at the
 * root of the ghost rows.
 */
export function numberOf(
  side: Side,
  id: string,
  maps: Mapping[],
): number | null {
  for (const m of maps) {
    if (m.side === side && m.ids.includes(id)) return m.n;
    if (m.side !== side && m.target.kind === "onto" && m.target.id === id)
      return m.n;
  }
  return null;
}
