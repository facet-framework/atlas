import { tx } from "@/i18n";
/** Describe the settings navigation, search terms. */

// @facet: workspace/settings/settings-navigation
// @facet-role: primary
/** The groups, in the order of the design. */
export const GROUPS = ["General", "Integrations", "Data"] as const;
export type Group = (typeof GROUPS)[number];

export type PageId =
  "themes" | "language" | "agent" | "git-provider" | "plugins" | "generative" | "history";

export type Page = {
  g: Group;
  /** The id. */

  id: string;
  /** The label in the sidebar and in the page header. */
  t: string;
  /** The second line below it. */
  d: string;
  /** What else may be searched for. */

  kw: string;
};

export const PAGES: (Page & { id: PageId })[] = [
  {
    g: "General",
    id: "themes",
    get t() {
      return tx("ui.settings.page-tree-themes");
    },
    get d() {
      return tx("ui.settings.page-tree-light-dark-tool-palettes");
    },
    get kw() {
      return tx("ui.settings.page-tree-theme-dark-light-colour-scheme-color");
    },
  },
  {
    // Language selection and custom translation files share this settings page.
    g: "General",
    id: "language",
    get t() {
      return tx("ui.settings.page-tree-language");
    },
    get d() {
      return tx("ui.settings.page-tree-german-english-your-own-translation-file");
    },
    get kw() {
      return tx("ui.settings.page-tree-language-english-german-locale-translation-localisation");
    },
  },
  {
    g: "Integrations",
    id: "agent",
    get t() {
      return tx("ui.settings.page-tree-atlas-ai");
    },
    get d() {
      return tx("ui.settings.page-tree-provider-model-tools");
    },
    // Keep hooks searchable so readers can find the session isolation explanation.
    get kw() {
      return tx("ui.settings.page-tree-companion-provider-model-agent-settings-assistant");
    },
  },
  {
    g: "Integrations",
    id: "git-provider",
    get t() {
      return tx("ui.settings.page-tree-git-provider");
    },
    get d() {
      return tx("ui.settings.page-tree-branches-pull-requests");
    },
    get kw() {
      return tx("ui.settings.page-tree-github-gitlab-pr-merge-request-remote");
    },
  },
  {
    g: "Integrations",
    id: "plugins",
    get t() {
      return tx("ui.settings.page-tree-plugins");
    },
    get d() {
      return tx("ui.settings.page-tree-bundled-running-extensions");
    },
    get kw() {
      return tx("ui.settings.page-tree-plugin-extension-catalogue-catalog-switch");
    },
  },
  {
    g: "Integrations",
    id: "generative",
    get t() {
      return tx("ui.settings.page-tree-generative-ui");
    },
    get d() {
      return tx("ui.settings.page-tree-generated-tiles-each-role");
    },
    get kw() {
      return tx("ui.settings.page-tree-generative-ai-model-prose-tile-classification");
    },
  },
  {
    g: "Data",
    id: "history",
    get t() {
      return tx("ui.settings.page-tree-history-storage");
    },
    get d() {
      return tx("ui.settings.page-tree-browser-state");
    },
    get kw() {
      return tx("ui.settings.page-tree-localstorage-reset-clear-delete-storage-history");
    },
  },
];

/** The page the surface opens on when nobody has picked one. */
export const FIRST: PageId = "themes";

const IDS = new Set<string>(PAGES.map((s) => s.id));

/** The ids the core itself occupies. */

export const CORE_PAGE_IDS: ReadonlySet<string> = IDS;

export function resolvePage(value: unknown, contributed: ReadonlySet<string> = EMPTY): string {
  if (IDS.has(value as string)) return value as PageId;
  // An id a loaded plugin has registered is valid. The set is passed in and
  // not held here: the host knows which plugins are running, and a module
  // with its own copy would get it wrong as soon as someone switches one off.

  return contributed.has(value as string) ? (value as string) : FIRST;
}

const EMPTY: ReadonlySet<string> = new Set<string>();

/** The pages that match a search, in their groups. */

export function search(q: string, contributed: readonly Page[] = []): { g: Group; rows: Page[] }[] {
  const needle = q.toLowerCase().trim();
  // A space in the query must not lose against a keyword field in which the
  // two words are written together.
  const flat = needle.replace(/\s+/g, "");
  // The core first, the contributed pages after it. Within a group that is
  // the order in which they stand in the list — and the core's order is the
  // design's, which must not change because someone switches a plugin on.
  const all = contributed.length === 0 ? PAGES : [...PAGES, ...contributed];
  return GROUPS.map((g) => ({
    g,
    rows: all.filter((s) => {
      if (s.g !== g) return false;
      if (!needle) return true;
      const haystack = `${s.t} ${s.d} ${s.kw}`.toLowerCase();
      return haystack.includes(needle) || haystack.replace(/\s+/g, "").includes(flat);
    }),
  })).filter((group) => group.rows.length > 0);
}

/** A page by its id. */
export function pageOf(id: string): Page {
  // `resolvePage` has already brought every id to a valid one; the fallback
  // here is the second seam and not an expected path.
  return PAGES.find((s) => s.id === id) ?? PAGES[0];
}

/** Translate group headings without changing the stable extension group IDs. */
export function groupLabel(group: Group): string {
  switch (group) {
    case "General":
      return tx("ui.settings.page-tree-general");
    case "Integrations":
      return tx("ui.settings.page-tree-integrations");
    case "Data":
      return tx("ui.settings.page-tree-data");
  }
}
