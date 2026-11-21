/** A tile in the content catalogue a plugin owns, and the core does not know. */

import type { ReactNode } from "react";
import type {
  CatalogueCount,
  CatalogueDef,
  CatalogueSection,
  CatalogueGroup,
  CatalogueItem,
  CatalogueSource,
} from "../contents/catalogue";

export type TileDef = {
  /** Which of the core's groups the tile stands in. */
  group: string;
  /** The tile's and the breadcrumb's label. */
  label: string;
  /** The sentence below the label. */
  desc: string;
  count: (q: CatalogueSource) => CatalogueCount;
  /** Whether the counter stands in deadline red. */
  bad?: (q: CatalogueSource) => boolean;
  items: (q: CatalogueSource) => CatalogueItem[];
  /** Groups the list stands under — absent on a tile that does not group. */
  grouped?: (q: CatalogueSource) => CatalogueGroup[] | null;
  /** Draws the right-hand column for one selected item, by its `raw` value. */
  detail: (raw: unknown) => ReactNode;
};

/** A tile plus the plugin the host knows it belongs to. */
export type RegisteredTile = TileDef & { readonly id: string; readonly plugin: string };

/** The host's side of `atlas.tiles`. */

// @facet: customization/contributions/plugin-tiles
// @facet-role: primary
export class TileRegistry {
  constructor(private readonly changed: () => void = () => {}) {}

  private tiles: RegisteredTile[] = [];

  /** Records that a plugin owns a tile. */

  register(
    plugin: string,
    reserved: ReadonlySet<string>,
    id: string,
    tile: TileDef,
  ): (() => void) | null {
    if (reserved.has(id)) return null;
    if (this.tiles.some((t) => t.id === id)) return null;
    const entry: RegisteredTile = { ...tile, id, plugin };
    this.tiles = [...this.tiles, entry];
    this.changed();
    return () => {
      const at = this.tiles.indexOf(entry);
      if (at >= 0) {
        this.tiles = this.tiles.filter((item) => item !== entry);
        this.changed();
      }
    };
  }

  /** Every contributed tile, in registration order. */
  list(): readonly RegisteredTile[] {
    return this.tiles;
  }

  /** A tile by its id, or null when no plugin contributed one. */
  find(id: string): RegisteredTile | null {
    return this.tiles.find((t) => t.id === id) ?? null;
  }

  /** Whether any plugin contributed this id. */
  has(id: string): boolean {
    return this.tiles.some((t) => t.id === id);
  }

  /** Which plugin owns a tile. For the host's reporting, not for a plugin. */
  ownerOf(id: string): string | null {
    return this.tiles.find((t) => t.id === id)?.plugin ?? null;
  }

  /** How many tiles are contributed. */
  get count(): number {
    return this.tiles.length;
  }
}

/** A contributed group, mapped to one of the core's four — or the group a
 * tile is shown under when it names one the core does not have. */

export const CONTRIBUTED_GROUP = "Context" as const;

export function groupOr(name: string, knows: readonly string[]): CatalogueSection {
  return (knows.includes(name) ? name : CONTRIBUTED_GROUP) as CatalogueSection;
}

/** A contributed tile in the shape the grid and the contents read. */

export function asCatalogueDef(t: RegisteredTile, knows: readonly string[]): CatalogueDef {
  return {
    g: groupOr(t.group, knows),
    label: t.label,
    desc: t.desc,
    count: t.count,
    bad: t.bad,
    items: t.items,
    grouped: t.grouped,
  };
}
