/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

import { tx } from "../../../frontend/src/i18n";
import type { WikiSource } from "./source";
import type { SearchSource } from "../../../frontend/src/plugin/search";
import { buildWiki } from "./model/model";

/** The search source for the wiki's pages, reading the corpus through `source`. */
export function wikiSearch(
  source: () => WikiSource | null | undefined,
  openWiki: (address: string) => void,
): SearchSource {
  return {
    label: tx("ui.wiki-src.search-wiki"),
    singular: tx("ui.wiki-src.search-wiki-page"),
    glyph: "¶",
    tone: "surface",
    hits: () => {
      // No wiki in this project is no source, not an empty one: the
      // palette then draws no wiki chip and no "Wiki" in its placeholder.
      const raw = source();
      if (!raw) return null;
      const wiki = buildWiki(raw);
      return wiki.pages.map((p) => {
        const area = wiki.areas.find((a) => a.id === p.area)?.title ?? p.area;
        const category = p.front.category
          ? (wiki.category(p.front.category)?.title ?? p.front.category)
          : null;
        return {
          title: p.title,
          sub: p.summary || p.address,
          tag: category ? `${area} · ${category}` : area,
          open: () => openWiki(p.address),
        };
      });
    },
  };
}
