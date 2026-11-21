/**
 * The wiki in Atlas, drawn with the FACET design system.
 *
 * The plugin's one entry, entered by the host: the area, the
 * catalogue tile, the search, the command, a settings page and the
 * conversation mode "edit wiki", reached only through `atlas`. The pages come
 * from `(atlas.data.section() as WikiSource | null)`; creating the first page runs this plugin's own flow
 * over `repo.*` on the broker, under this plugin's grant.
 *
 * @facet: customization/contributions/plugin-pages
 * @facet-role: related
 *
 * @facet: customization/documents/write-actions
 * @facet-role: primary
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, ListRow } from "@facet-tools/ui";
import {
  PluginHead,
  SettingsSection,
  useText,
} from "../../../frontend/src/plugin/components";
import * as views from "./views/Wiki";
import { tx } from "../../../frontend/src/i18n";
import type { AtlasApi } from "../../../frontend/src/plugin/host";
import type { WikiSource } from "./source";
import { CallProvider } from "./bus";
import ConfluenceLive from "./confluence/ConfluenceLive";
import { ConfluenceSide } from "./confluence/side";
import { ConfluenceMark } from "./confluence/badge";
import { wikiTile } from "./catalog-tile";
import { buildWiki, type WikiModel } from "./model/model";
import { wikiSearch } from "./search";
import { VerbsProvider } from "./verbs";
import Create from "./wiki/Create";
import { Article, type ArticleMode } from "./wiki/Article";
import Front from "./wiki/Front";
import { monoText } from "./wiki/mono";
import type { Corpus } from "./wiki/citations";

/** The area this plugin registers; the host addresses it under the plugin's id. */
export const AREA = "wiki";

const WIKI_STATUS: Record<string, views.WikiStatus> = {
  draft: "draft",
  maintained: "maintained",
  reviewed: "reviewed",
  outdated: "outdated",
};

/**
 * A page's state. The wiki's front-matter reader drops a value it does not
 * know, so the raw `status:` line is read here: an unknown value is shown as
 * written, and a page without one is "unknown", never a draft nobody chose.
 */
export function wikiStatusOf(page: {
  front: { status?: string };
  raw: string;
}): {
  status: views.WikiStatus;
  rawStatus?: string;
} {
  const known = WIKI_STATUS[page.front.status ?? ""];
  if (known) return { status: known };
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(page.raw)?.[1] ?? "";
  const raw = /^status:[ \t]*(.*)$/m
    .exec(head)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return raw ? { status: "unknown", rawStatus: raw } : { status: "unknown" };
}

/**
 * The pages offered beside an address that names none: those whose title or
 * path contains what was asked, so "/wiki doppelt" with two such pages lists
 * both; the first pages of the wiki only when nothing contains it.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */
export function nearestPages<P extends { title: string; path: string }>(
  pages: readonly P[],
  asked: string,
  limit = 5,
): P[] {
  const needle = asked.trim().toLowerCase();
  const matching = needle
    ? pages.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          p.path.toLowerCase().includes(needle),
      )
    : [];
  return (matching.length ? matching : pages).slice(0, limit);
}

/** Phone width, measured the way the host measures it. */
function useMobile(): boolean {
  const query = "(max-width: 767px)";
  const [mobile, setMobile] = useState(
    () => window.matchMedia?.(query).matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    const on = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  return mobile;
}

/** What the area keeps: the page it shows, the rail's filters and what the page shows. */
export type WikiState = {
  page: string | null;
  query: string;
  view: views.WikiRailView;
  closed: string[];
  creating: boolean;
  /** The page read, edited or its history; a new page always opens read. */
  mode: ArticleMode;
};

export function wikiState(page: string | null): WikiState {
  return {
    page,
    query: "",
    view: "tree",
    closed: [],
    creating: false,
    mode: "read",
  };
}

type RailPage = WikiModel["pages"][number];

/**
 * The rail's groups. The tree follows the areas in the order `wiki.yaml`
 * declares them, keeps a declared area without a page and names an
 * undeclared folder as such; the categories view offers only categories a
 * page carries, the undeclared ones a page names, and the pages nobody
 * categorised; the recent view orders by the reviewed date the pages state.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */
export function railGroups(
  model: WikiModel,
  pages: RailPage[],
  view: views.WikiRailView,
  filtered: boolean,
  closed: string[],
  current: string | undefined,
): views.WikiRailGroup[] {
  const row = (p: RailPage): views.WikiRailPage => ({
    path: p.path,
    title: p.title,
    ...wikiStatusOf(p),
    current: p.path === current,
  });
  const group = (
    key: string,
    label: string,
    list: RailPage[],
  ): views.WikiRailGroup => ({
    key,
    label,
    count: list.length,
    open: !closed.includes(key),
    pages: list.map(row),
  });
  if (view === "categories") {
    const used = model.categories.filter((c) =>
      pages.some((p) => p.front.category === c.id),
    );
    const undeclared = [
      ...new Set(
        pages
          .map((p) => p.front.category)
          .filter((k): k is string => !!k && !model.category(k)),
      ),
    ];
    const none = pages.filter((p) => !p.front.category);
    return [
      ...used.map((c) =>
        group(
          `catalogue:${c.id}`,
          c.title,
          pages.filter((p) => p.front.category === c.id),
        ),
      ),
      ...undeclared.map((k) =>
        group(
          `catalogue:${k}`,
          `${k} · ${tx("ui.wiki-src.entry-not-declared")}`,
          pages.filter((p) => p.front.category === k),
        ),
      ),
      ...(none.length
        ? [group("catalogue:", tx("ui.wiki-src.entry-no-category"), none)]
        : []),
    ];
  }
  if (view === "recent") {
    const dated = [...pages].sort((a, b) =>
      (b.front.reviewed ?? "").localeCompare(a.front.reviewed ?? ""),
    );
    return [group("recent", tx("ui.wiki-src.entry-all"), dated)];
  }
  return model.areas
    .filter((a) => !filtered || pages.some((p) => p.area === a.id))
    .map((a) => {
      const list = pages.filter((p) => p.area === a.id);
      const label =
        a.state === "undeclared"
          ? `${a.id} · ${tx("ui.wiki-src.entry-area-not-declared")}`
          : a.state === "empty"
            ? `${a.title ?? a.id} · ${tx("ui.wiki-src.entry-declared-no-page-yet")}`
            : (a.title ?? a.id);
      return group(a.id, label, list);
    });
}

/**
 * The wiki area: the host's state of the wiki first (a Git failure, a checkout
 * nobody initialized, no wiki at all), then the rail beside the generated
 * overview or one page.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */
export function WikiPage({
  atlas,
  state,
  setState,
}: {
  atlas: AtlasApi;
  state: WikiState;
  setState: (next: WikiState) => void;
}) {
  const s = state;
  const set = (patch: Partial<WikiState>) => setState({ ...s, ...patch });
  const rest = s.page ?? "";
  const mobile = useMobile();
  const [railOpen, setRailOpen] = useState(false);
  const { t: tt } = useText();
  const wiki: WikiSource | null = atlas.data.section() as WikiSource | null;
  const v = atlas.data.v;
  const model = useMemo(() => buildWiki(wiki), [wiki]);
  const k = useMemo<Corpus>(() => ({ v, wiki: model }), [v, model]);
  const openPage = (path: string | null) => atlas.verbs.openArea(AREA, path);
  // The plugin's own parts name a page by its `wiki:` address; the area by its path.
  const openAddress = (address: string) =>
    openPage(model.byAddress(address)?.path ?? address);
  // The page's way: the wiki, its area and its group each lead to their first
  // page, and the area unfolds in the rail. A group is named by its index
  // page's title, and by its folder where it has none.
  const wikiCrumbs = (p: RailPage) => {
    const area = model.areas.find((a) => a.id === p.area);
    const inArea = model.pages.filter((x) => x.area === p.area);
    const inGroup = inArea.filter((x) => x.group === p.group);
    const index = inGroup.find((x) => /(^|\/)index\.md$/.test(x.path));
    const unfold = () => s.closed.filter((key) => key !== p.area);
    const go = (target: RailPage | undefined) => {
      set({ closed: unfold() });
      if (target) openPage(target.path);
    };
    return [
      {
        key: "wiki",
        label: tt("shell.nav.item.wiki"),
        onClick: () => openPage(null),
      },
      ...(p.area
        ? [
            {
              key: "area",
              label: area?.title ?? p.area,
              onClick: () => go(inArea[0]),
            },
          ]
        : []),
      ...(p.group
        ? [
            {
              key: "group",
              label: index?.title ?? p.group,
              onClick: () => go(inGroup[0]),
            },
          ]
        : []),
    ];
  };
  const mount = (node: ReactNode) => (
    <VerbsProvider verbs={atlas.verbs}>
      <CallProvider call={atlas.bus.call}>{node}</CallProvider>
    </VerbsProvider>
  );
  if (model.gitError && model.pages.length === 0)
    return (
      <div
        className="t-page t-stack"
        style={{ gap: 20 }}
        data-testid="wiki-git-error"
      >
        <PluginHead icon="book" title="Wiki" count="—" />
        <EmptyState
          tone="error"
          icon="error"
          title={tx("ui.wiki-src.entry-wiki-repository-could-not-read")}
          body={<span className="t-mono t-wrap">{model.gitError}</span>}
        />
      </div>
    );
  if (model.initialization)
    return (
      <div
        className="t-page t-stack"
        style={{ gap: 20 }}
        data-testid="wiki-initialization"
      >
        <PluginHead icon="book" title="Wiki" count="—" />
        <EmptyState
          icon="book"
          title={tx("ui.wiki-src.entry-wiki-sub-repository-not-initialised")}
          body={
            <span className="t-stack" style={{ gap: 8 }}>
              <span>
                {monoText(
                  "ui.wiki-src.entry-checkout-path-recorded-git-index-missing",
                  { path: model.initialization.path },
                  ["path"],
                )}
              </span>
              <code className="t-mono t-wrap">
                {model.initialization.command}
              </code>
            </span>
          }
        />
      </div>
    );
  if (!model.present) {
    if (s.creating)
      return (
        <div className="t-page" data-testid="wiki-create">
          <CallProvider call={atlas.bus.call}>
            <Create
              dir={model.dir || wiki?.dir || ""}
              onCancel={() => set({ creating: false })}
            />
          </CallProvider>
        </div>
      );
    return (
      <views.WikiEmpty
        directory={model.dir || wiki?.dir || "docs/wiki"}
        onCreate={() => set({ creating: true })}
      />
    );
  }
  // Atlas creates only the first page; for a further one the buttons name where to write it.
  const noFurtherPage = tx(
    "ui.wiki-src.entry-write-further-pages-wiki-directory-facet",
  );
  const q = s.query.trim().toLowerCase();
  const pages = model.pages.filter(
    (p) =>
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.body.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase() === q),
  );
  const page = rest
    ? (model.byPath(rest) ??
      model.pages.find((p) => p.address === rest) ??
      model.pages.find((p) => p.path.endsWith(rest)))
    : undefined;
  const rail = (
    <views.WikiRail
      total={model.pages.length}
      query={s.query}
      view={s.view}
      groups={railGroups(model, pages, s.view, !!q, s.closed, page?.path)}
      hits={q ? pages.length : undefined}
      onQuery={(query) => set({ query })}
      onView={(view) => set({ view })}
      onToggle={(key) =>
        set({
          closed: s.closed.includes(key)
            ? s.closed.filter((x) => x !== key)
            : [...s.closed, key],
        })
      }
      onSelect={(path) => {
        setRailOpen(false);
        openPage(path);
      }}
      createDisabledReason={noFurtherPage}
    />
  );
  // What the host measured about the wiki itself stands above every view of it.
  const notes = (
    <>
      {model.unversioned ? (
        <p className="t-meta" data-testid="wiki-unversioned">
          {tx("ui.wiki-src.entry-count-pages", { count: model.pages.length })} ·{" "}
          <span
            title={tx("ui.wiki-src.entry-dir-not-versioned-git", {
              dir: model.dir,
            })}
          >
            {tx("ui.wiki-src.entry-local-wiki-without-git-versioning")}
          </span>
        </p>
      ) : null}
      {model.gitError ? (
        <p
          className="t-bad t-mono t-wrap"
          role="alert"
          data-testid="wiki-git-error"
        >
          {tx("ui.wiki-src.entry-wiki-repository-could-not-read-reason", {
            reason: model.gitError,
          })}
        </p>
      ) : null}
      {model.configError ? (
        <p className="t-bad" role="alert">
          {monoText(
            "ui.wiki-src.entry-file-could-not-read-reason-until",
            { file: "wiki.yaml", reason: model.configError },
            ["file"],
          )}
        </p>
      ) : null}
    </>
  );
  return mount(
    <views.WikiWorkspace
      rail={rail}
      mobile={mobile}
      railOpen={railOpen}
      onRail={() => setRailOpen(!railOpen)}
    >
      {notes}
      {page ? (
        <Article
          w={model}
          p={page}
          status={wikiStatusOf(page)}
          k={k}
          mode={s.mode}
          crumbs={wikiCrumbs(page)}
          onMode={(mode) => set({ mode })}
          onFilter={(tag) => set({ query: tag, view: "tree" })}
          onOpen={openAddress}
          onOpenRecord={(id) => atlas.verbs.open(id)}
        />
      ) : rest ? (
        <views.WikiMissing
          path={rest}
          nearest={nearestPages(model.pages, rest).map((p) => ({
            path: p.path,
            title: p.title,
          }))}
          createDisabledReason={noFurtherPage}
          onOpen={(path) => openPage(path)}
        />
      ) : (
        <Front w={model} k={k} onOpen={openAddress} />
      )}
    </views.WikiWorkspace>,
  );
}

/** The Confluence setup's area, addressed `/p/confluence-einrichten`. */
export const CONFLUENCE_AREA = "confluence-setup";

/**
 * The settings page: where the wiki lives, what the host read of it, and the
 * door to the Confluence setup.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */
function WikiSettings({ atlas }: { atlas: AtlasApi }) {
  const wiki = atlas.data.section() as WikiSource | null;
  const model = buildWiki(wiki);
  return (
    <SettingsSection
      title="Wiki"
      sub={tx("ui.wiki-src.entry-pages-beside-registry")}
    >
      <div className="t-stack" data-testid="wiki-settings">
        <ListRow
          title={tx("ui.wiki-src.entry-directory")}
          trail={
            <span className="t-mono">
              {model.dir || wiki?.dir || "docs/wiki"}
            </span>
          }
        />
        <ListRow
          title={tx("ui.wiki-src.entry-pages")}
          trail={
            model.present
              ? String(model.pages.length)
              : tx("ui.wiki-src.entry-no-wiki-project")
          }
        />
        {wiki?.unversioned ? (
          <ListRow title={tx("ui.wiki-src.entry-not-versioned")} trail="git" />
        ) : null}
        <ListRow
          title={tx("ui.wiki-src.entry-set-up-confluence")}
          trail={<ConfluenceMark />}
          onClick={() => atlas.verbs.openArea(CONFLUENCE_AREA)}
        />
      </div>
    </SettingsSection>
  );
}

/**
 * What the "edit wiki" mode tells the companion. The model reads it, not the
 * reader, so it is English like the rest of the companion's instructions.
 */
export const EDIT_WIKI_PROMPT =
  'The reader chose "Edit wiki". They want a page of the project\'s wiki changed or written. ' +
  "You cannot write files from here. Find the page, or where a new one belongs, and answer with " +
  "its path and the complete new text as Markdown, so the change can be applied as it stands. " +
  "Cite the records and files the text rests on.";

/**
 * The entry point, with the signature ADR-0001 names: it takes `atlas`
 * and returns nothing. The door into the wiki is the host's navigation entry,
 * so no `header.action` is mounted here.
 *
 * @facet: customization/contributions/plugin-pages
 * @facet-role: related
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */
export default function wikiEntry(atlas: AtlasApi): void {
  atlas.tiles.register(
    "wiki",
    wikiTile(
      (address) => atlas.verbs.openArea(AREA, address),
      () => atlas.data.section() as WikiSource | null,
    ),
  );
  atlas.search.register(
    "wiki",
    wikiSearch(
      () => atlas.data.section() as WikiSource | null,
      // A hit names the page by its host address; the reader addresses a page by its
      // path, so the hit lands at the address the page's own links use.
      (address) =>
        atlas.verbs.openArea(
          AREA,
          buildWiki(atlas.data.section() as WikiSource | null).byAddress(
            address,
          )?.path ?? address,
        ),
    ),
  );
  atlas.areas.register(
    AREA,
    ({ state, setState }) => (
      <WikiPage atlas={atlas} state={state as WikiState} setState={setState} />
    ),
    {
      initial: (arg) => wikiState(arg),
      place: (state) => (state as WikiState).page,
    },
  );
  // Confluence setup, opened from the wiki's settings page: an area of its own,
  // so it has an address and the back step returns to the settings.
  atlas.areas.register(CONFLUENCE_AREA, () => (
    <ConfluenceLive onDismiss={() => atlas.verbs.closeArea()} />
  ));
  // The Confluence card: the state line, the check that asks
  // the host, and the door to the setup.
  atlas.settings.register({
    id: "documentation",
    group: "Plugins",
    title: tx("ui.wiki-src.entry-documentation"),
    subtitle: tx("ui.wiki-src.entry-confluence"),
    keywords: tx(
      "ui.wiki-src.entry-confluence-sync-mirror-atlassian-import-origin",
    ),
    render: () => <ConfluenceSide atlas={atlas} />,
  });
  atlas.settings.register({
    id: "wiki",
    group: "Plugins",
    title: "Wiki",
    subtitle: tx("ui.wiki-src.entry-pages-beside-registry"),
    keywords: tx("ui.wiki-src.entry-wiki-pages-docs"),
    render: () => <WikiSettings atlas={atlas} />,
  });
  atlas.chat.mode("wiki", {
    label: tx("ui.wiki-src.entry-edit-wiki"),
    systemPrompt: EDIT_WIKI_PROMPT,
  });
  atlas.commands.register({
    command: "/wiki",
    argument: tx("ui.wiki-src.entry-title-path"),
    purpose: tx("ui.wiki-src.entry-open-wiki-page"),
    group: "Wiki",
    run: (argument) => {
      const arg = argument.trim();
      if (!arg) return atlas.verbs.openArea(AREA, null);
      const source = atlas.data.section() as WikiSource | null;
      const needle = arg.toLowerCase();
      const hits = source
        ? buildWiki(source).pages.filter(
            (p) =>
              p.address.toLowerCase() === needle ||
              p.path.toLowerCase() === needle ||
              p.title.toLowerCase() === needle,
          )
        : [];
      atlas.verbs.openArea(AREA, hits.length === 1 ? hits[0].path : arg);
    },
  });
}
