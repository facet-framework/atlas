import aliases from "../../internal/wiki/locales/de.json";
/**
 * The wiki's model — what the host sends, in the shape the surface reads.
 *
 * The host delivers pages **unparsed**, for the same reason it delivers
 * records unparsed: the reader carries its own front-matter reader and its
 * own model, and a second one alongside would give the project two answers
 * to what a page says. What the host *does* own is the **address** — the
 * leading `wiki:` keeps a path with two slashes from being read as a record
 * id (the specification), and that rule belongs in one place, not two.
 *
 * Three axes order a page (the specification), and the model keeps them apart: the
 * **area** comes from the path and so cannot disagree with it. The
 * **category** comes from the front matter and is closed, because it drives
 * the display. **Tags** are free and drive nothing.
 *
 * What never happens: smoothing over. A declared area with no page stays in
 * the list, an undeclared folder keeps its pages, a page with no category is
 * not filed under "other". Each of these states is a maintenance signal, and
 * a model that clears them away takes from every surface above it the
 * ability to show them.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */

import {
  parseYaml,
  type YamlValue,
} from "../../../../frontend/src/plugin/components";
import type { WikiSource } from "../source";
import { WikiAddress } from "./address";
import { parseFront, splitFront, type WikiFront } from "./headers";

// `WikiSource` — the raw, unparsed shape the host sends — stays in the core:
// it is part of the official `PluginData`/`PluginCorpus` interface every
// plugin sees over `atlas.data.wiki`, "deliberately narrow" (`plugin/host.ts`).
// Re-exported here so nothing outside this module has to know it moved.
export type { WikiSource };

/** An area: declared and filled, declared and empty, or not declared at all. */
export type WikiAreaState = "ok" | "empty" | "undeclared";

export type WikiArea = {
  id: string;
  /**
   * The title from `wiki.yaml` — `null` for a folder nobody declared. Not
   * the folder name: there is no title, and setting one would claim somebody
   * named this area. The surface shows the folder name in mono instead, and
   * that looks different.
   */
  title: string | null;
  purpose: string | null;
  /** The optional bridge: this area *is* this taxonomy domain (the specification). */
  domain: string | null;
  state: WikiAreaState;
};

export type WikiCategory = {
  id: string;
  title: string;
  purpose: string | null;
};

export type WikiPage = {
  /** Path under `wiki/` — the page's id, because there is no stored one. */
  path: string;
  /** The address, as the host computed it. */
  address: string;
  area: string;
  /** The group between area and page, empty for a page directly in the area. */
  group: string;
  slug: string;
  /** The title — or, if there is none, the slug. `titled` says which. */
  title: string;
  titled: boolean;
  summary: string;
  front: WikiFront;
  body: string;
  raw: string;
  tags: string[];
  records: string[];
  isIndex: boolean;
  /** the specification — read and shown, but flagged. */
  tooDeep: boolean;
};

export type WikiModel = {
  initialization?: WikiSource["initialization"];
  gitError?: string;
  /** Whether the project has a wiki at all. */
  present: boolean;

  unversioned: boolean;
  dir: string;
  areas: WikiArea[];
  categories: WikiCategory[];
  pages: WikiPage[];
  /** Why `wiki.yaml` could not be read — `null` if it is missing or valid. */
  configError: string | null;
  byAddress: (address: string) => WikiPage | undefined;
  byPath: (path: string) => WikiPage | undefined;
  inArea: (id: string) => WikiPage[];
  category: (id: string) => WikiCategory | null;
  /** Pages nobody categorised — visible, not cleared away. */
  uncategorised: WikiPage[];
  /** Pages naming a category absent from wiki.yaml; never silently reassigned. */
  undeclaredCategories: WikiPage[];
  /** Pages whose state nobody explained — neither `status` nor `reviewed`. */
  unexplained: WikiPage[];
};

function asRecord(value: YamlValue): Record<string, YamlValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, YamlValue>)
    : {};
}

function asText(value: YamlValue): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The order of a page list: `order` first, then the title.
 *
 * Pages without `order` stand after, not before: `order` is the statement
 * "the reading sequence matters here", and a page that does not carry it
 * does not belong at the front of a sequence it has no place in.
 */
function byOrder(a: WikiPage, b: WikiPage): number {
  const oa = a.front.order ?? Number.MAX_SAFE_INTEGER;
  const ob = b.front.order ?? Number.MAX_SAFE_INTEGER;
  return oa - ob || a.title.localeCompare(b.title, "de");
}

/** Builds the model from what the host sent. */
export function buildWiki(source: WikiSource | null | undefined): WikiModel {
  if (!source) return empty(false, "");
  if (source.initialization)
    return {
      ...empty(false, source.dir),
      initialization: source.initialization,
    };

  let config: Record<string, YamlValue> = {};
  let configError: string | null = null;
  if (source.config && source.config.trim()) {
    try {
      config = asRecord(parseYaml(source.config));
    } catch (caught) {
      // A `wiki.yaml` that fails to read is something other than none: the
      // former says somebody meant to declare something. Showing both as
      // "nothing declared" would hide the error.
      configError = caught instanceof Error ? caught.message : String(caught);
    }
  }

  const rawDepth = Object.hasOwn(config, "depth")
    ? config.depth
    : config[aliases.fields.depth];
  const depthLimit = typeof rawDepth === "number" ? rawDepth : 2;

  const pages: WikiPage[] = Object.keys(source.pages)
    .filter((path) => path.endsWith(".md"))
    .sort()
    .map((path) => {
      const raw = source.pages[path];
      const { front: head, body } = splitFront(raw);
      const front = parseFront(head);
      const segments = path.replace(/\.md$/, "").split("/");
      const isIndex =
        segments[segments.length - 1] === "index" && segments.length > 1;
      const own = isIndex ? segments.slice(0, -1) : segments;
      const slug = own[own.length - 1];
      return {
        path,
        // If the address is missing, the reader does not recompute it: it
        // belongs to the host (the specification), and a second derivation here would be
        // exactly the second answer the field is meant to avoid. The path
        // stands for itself instead.
        address: source.addresses[path] ?? WikiAddress(path),
        area: own[0] ?? "",
        group: own.slice(1, -1).join("/"),
        slug,
        title: front.title ?? path,
        titled: Boolean(front.title),
        summary: front.summary ?? "",
        front,
        body,
        raw,
        tags: front.tags ?? [],
        records: front.records ?? [],
        isIndex,
        // Area, group, page are two levels under the area; anything above
        // that is the warning from the specification.
        tooDeep: path.split("/").length - 1 > depthLimit,
      };
    });

  const declaredAreas = asRecord(
    Object.hasOwn(config, "areas")
      ? config.areas
      : config[aliases.fields.areas],
  );
  const declaredIds = Object.keys(declaredAreas);
  const folders = [...new Set(pages.map((p) => p.area).filter(Boolean))];

  const areas: WikiArea[] = [
    // The declared order, not the alphabetical one: it is the project's own
    // statement about what to read first.
    ...declaredIds.map((id) => {
      const entry = asRecord(declaredAreas[id]);
      return {
        id,
        title: asText(entry.title) ?? id,
        purpose: asText(entry.purpose),
        domain: asText(entry.domain),
        state: pages.some((p) => p.area === id)
          ? ("ok" as const)
          : ("empty" as const),
      };
    }),
    ...folders
      .filter((id) => !declaredIds.includes(id))
      .sort()
      .map((id) => ({
        id,
        title: null,
        purpose: null,
        domain: null,
        state: "undeclared" as const,
      })),
  ];

  const rawCategories = Object.hasOwn(config, "categories")
    ? config.categories
    : config[aliases.fields.categories];
  const categoryList = Array.isArray(rawCategories) ? rawCategories : [];
  const categories: WikiCategory[] = categoryList
    .map((entry) => {
      const row = asRecord(entry);
      const id = asText(row.id);
      return id
        ? { id, title: asText(row.title) ?? id, purpose: asText(row.purpose) }
        : null;
    })
    .filter((row): row is WikiCategory => row !== null);

  return {
    present: true,
    gitError: source.gitError,
    unversioned: source.unversioned === true,
    dir: source.dir,
    areas,
    categories,
    pages,
    configError,
    byAddress: (address) => pages.find((p) => p.address === address),
    byPath: (path) => pages.find((p) => p.path === path),
    inArea: (id) => pages.filter((p) => p.area === id).sort(byOrder),
    category: (id) => categories.find((c) => c.id === id) ?? null,
    uncategorised: pages.filter((p) => !p.front.category),
    undeclaredCategories: pages.filter(
      (p) =>
        Boolean(p.front.category) &&
        !categories.some((c) => c.id === p.front.category),
    ),
    // Neither `status` nor `reviewed`: only once both are missing has nobody
    // really said anything about the state. A date without a word is a
    // confirmation, and that counts.
    unexplained: pages.filter((p) => !p.front.status && !p.front.reviewed),
  };
}

function empty(present: boolean, dir: string): WikiModel {
  return {
    present,
    // Without a source, nothing is measured, and `false` here means "not
    // measured" rather than "versioned". It hides a line instead of
    // asserting one — the direction this surface errs in when it does not know.
    unversioned: false,
    dir,
    areas: [],
    categories: [],
    pages: [],
    configError: null,
    byAddress: () => undefined,
    byPath: () => undefined,
    inArea: () => [],
    category: () => null,
    uncategorised: [],
    undeclaredCategories: [],
    unexplained: [],
  };
}
