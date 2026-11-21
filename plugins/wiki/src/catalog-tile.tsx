/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */

import { tx } from "@/i18n";
import {
  CatalogueFacts as FactsView,
  Header as Header,
  Reading as Reading,
  type TileDef,
  unknown as unmeasured,
  numericValue as countValue,
} from "../../../frontend/src/plugin/components";
import { buildWiki, type WikiModel, type WikiPage } from "./model/model";
import type { WikiSource } from "./source";

/** The `raw` every list row carries and the detail column reads. */
type WikiRow = { p: WikiPage; wiki: WikiModel };

/**
 * Opens the wiki at an address — `verbs.openArea("wiki", address)`, handed
 * in by the caller rather than read via `useVerben()`: the detail column
 * renders in the content catalogue, outside the `VerbenProvider` that only
 * the open wiki area itself wraps.
 */
type OpenWiki = (address: string) => void;

/** The detail column for a selected wiki page. */
function wikiTileDetail(openWiki: OpenWiki) {
  return function WikiTileDetail(raw: unknown) {
    const { p, wiki } = raw as WikiRow;
    const area = wiki.areas.find((a) => a.id === p.area);
    const category = p.front.category ? wiki.category(p.front.category) : null;
    return (
      <WikiDetailBody
        p={p}
        area={area}
        category={category}
        openWiki={openWiki}
      />
    );
  };
}

function WikiDetailBody({
  p,
  area,
  category,
  openWiki,
}: {
  p: WikiPage;
  area: WikiModel["areas"][number] | undefined;
  category: ReturnType<WikiModel["category"]>;
  openWiki: OpenWiki;
}) {
  return (
    <>
      <Header
        id={
          <>
            {tx("ui.wiki-src.catalog-tile-wiki")} <b>{p.address}</b>
          </>
        }
        lead={p.summary}
      />
      <FactsView
        rows={[
          [
            tx("ui.wiki-src.catalog-tile-area"),
            area?.state === "undeclared" || !area?.title ? (
              <>
                <span className="t-mono">{p.area}</span>{" "}
                {tx("ui.wiki-src.catalog-tile-not-declared")}
              </>
            ) : (
              area.title
            ),
            area?.state === "undeclared" ? "bad" : undefined,
          ],
          [
            tx("ui.wiki-src.catalog-tile-category"),
            p.front.category
              ? (category?.title ?? p.front.category)
              : tx("ui.wiki-src.catalog-tile-classified-nobody"),
          ],
          [
            tx("ui.wiki-src.catalog-tile-state"),
            p.front.status ??
              tx("ui.wiki-src.catalog-tile-not-declared-wikidetailbody"),
            p.front.status ? undefined : "warn",
          ],
          [
            tx("ui.wiki-src.catalog-tile-confirmed"),
            p.front.reviewed || tx("ui.wiki-src.catalog-tile-never"),
          ],
          ["Records", p.records.length ? p.records.join(" · ") : "—"],
        ]}
      />
      <Reading>
        {tx("ui.wiki-src.catalog-tile-page-not-record-can-name-records")}
      </Reading>
      <div className="kact">
        <button
          type="button"
          className="t-btn t-btn--small"
          onClick={() => openWiki(p.address)}
        >
          {tx("ui.wiki-src.catalog-tile-open-wiki")}
        </button>
      </div>
    </>
  );
}

/**
 * Builds the tile definition the way `atlas.tiles.register` expects it.
 *
 * A factory, not a constant: `openWiki` comes from `atlas.verbs` and is not
 * fixed until registration time.
 */
export function wikiTile(
  openWiki: OpenWiki,
  source: () => WikiSource | null | undefined,
): TileDef {
  return {
    group: "Context",
    label: "Wiki",
    get desc() {
      return tx(
        "ui.wiki-src.catalog-tile-pages-people-have-written-areas-categories",
      );
    },
    // No wiki is a different thing from an empty one: nobody created the
    // first, somebody created the second and wrote nothing into it. A `0`
    // for the first case would claim there is one.
    count: () => {
      const w = buildWiki(source());
      if (w.initialization)
        return unmeasured(tx("ui.wiki-src.catalog-tile-not-initialised"));
      if (w.gitError)
        return unmeasured(
          tx("ui.wiki-src.catalog-tile-git-state-not-readable"),
        );
      return w.present
        ? countValue(w.pages.length)
        : unmeasured(tx("ui.wiki-src.catalog-tile-not-created"));
    },
    bad: () => {
      const w = buildWiki(source());
      return Boolean(
        w.present && (w.uncategorised.length || w.undeclaredCategories.length),
      );
    },
    items: () => {
      const w = buildWiki(source());
      return w.pages.map((p) => ({
        id: p.address,
        t: p.title,
        s: p.summary,
        tag: p.front.category ?? tx("ui.wiki-src.catalog-tile-no-category"),
        cls:
          p.front.category && w.category(p.front.category)
            ? undefined
            : ("bad" as const),
        raw: { p, wiki: w } satisfies WikiRow,
      }));
    },
    detail: wikiTileDetail(openWiki),
  };
}
