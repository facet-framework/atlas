/** Group C places: the contents hub, every kind page and the glossary. */

import { useEffect, useMemo } from "react";
import { useSurfaceText as useText } from "@/screens/text";
import { contents, records } from "@/screens";
import * as D from "../derive-contents";
import type { PageContext } from "../context";
import { href } from "../route";
import { tileFigure, UNMEASURED } from "../plugin-host";
import { safeCall } from "../plugin-guard";
import { knowledgePrompt } from "../knowledge-ask";
import { anchoredPaths, RECORD_SLOTS } from "../derive-reader";
import { proseRenderer } from "../prose";
import { SHAPES_KIND, ShapesPage } from "./shapes";
import { runTime } from "@/time";

const PAGE = 25;
const toggle = <T,>(cur: T | undefined, v: T) => (cur === v ? undefined : v);
const sortNext = (s: { key: string; dir: "asc" | "desc" } | undefined, key: string) => ({
  key,
  dir: s?.key === key && s.dir === "asc" ? ("desc" as const) : ("asc" as const),
});
const pageOf = <T,>(list: T[], page: number, size = PAGE) => {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { slice: list.slice((p - 1) * size, p * size), page: p };
};

export const KIND_KEYS = new Set([
  "promises",
  "knowledge",
  "operations",
  "provenance",
  "taxonomy",
  "calibration",
  "tests",
  "deviations",
  "drift",
  "fixed",
  "anchor",
  "files",
  "rules",
  SHAPES_KIND,
  "cycles",
  "read-errors",
  "decisions",
]);

/** The time of day the run read the repository; `undefined` when the scan carries none. */
function readAt(scannedAt: unknown, language: string): string | undefined {
  return runTime(scannedAt, language);
}

// @facet: registry/catalogue/contents-catalogue
// @facet-role: primary
export function HubPlace({ ctx }: { ctx: PageContext }) {
  const { t: tt } = useText();
  const facts = useMemo(() => D.contentFacts(ctx.model, ctx.derived), [ctx.model, ctx.derived]);
  const kinds = useMemo(() => D.contentKinds(facts, ctx.t, tt), [facts, ctx.t, tt]);
  // A group crumb asked for its group: bring the section into view once.
  const [hub, setHub] = ctx.slot<HubState>("contents:hub", {});
  const group = hub.group;
  useEffect(() => {
    if (!group) return;
    document.getElementById(contents.hubGroupId(group))?.scrollIntoView?.({ block: "start" });
    setHub({ group: undefined });
    // `setHub` is a fresh function on every render; the group alone decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);
  return (
    <contents.ContentsHub
      state="ready"
      kinds={kinds}
      headline={D.hubHeadline(ctx.model, facts, kinds.length, tt)}
      pinned={ctx.pinned as contents.ContentKindKey[]}
      onPin={ctx.pin}
      onOpen={(key, view) => {
        if (view) ctx.slot(`contents:${key}`, {})[1]({ view });
        ctx.go(
          key === "glossary" ? href({ area: "glossary" }) : href({ area: "contents", kind: key }),
        );
      }}
      plugins={pluginTiles(ctx)}
      onOpenPlugin={(key) => ctx.go(href({ area: "contents", kind: key }))}
      readAt={readAt(ctx.model.scan.scannedAt, ctx.language)}
      onReread={ctx.reread}
    />
  );
}

/** The tiles plugins contributed, with the figure each computes over the corpus. */

export function pluginTiles(ctx: PageContext): contents.PluginKindTile[] {
  const plugins = ctx.plugins;
  if (!plugins) return [];
  return plugins.host.tiles.list().map((tile) => ({
    key: tile.id,
    label: tile.label,
    icon: "plug",
    desc: tile.desc,
    // A count that throws is that tile's own failure: it reads unmeasured.
    ...tileFigure(safeCall(() => tile.count(plugins.source), UNMEASURED)),
  }));
}

/** The hub's slot: the group a kind page's group crumb asked to be shown. */
type HubState = { group?: contents.ContentGroup };

/** A kind page's crumbs lead to their places: "Contents" to the hub, the group
 * to its section on the hub. */

// @facet: registry/catalogue/contents
// @facet-role: primary
// @facet: workspace/navigation/path
// @facet-role: primary
export function KindPlace({ ctx, kind }: { ctx: PageContext; kind: string }) {
  const toHub = (key: string) => {
    const group = HUB_GROUPS.find((g) => g === key);
    ctx.slot<HubState>("contents:hub", {})[1]({ group });
    ctx.go(href({ area: "contents" }));
  };
  return (
    <contents.ContentsCrumbContext.Provider value={toHub}>
      <KindBody ctx={ctx} kind={kind} />
    </contents.ContentsCrumbContext.Provider>
  );
}

const HUB_GROUPS: readonly contents.ContentGroup[] = ["Registry", "Evidence", "Code", "Context"];

function KindBody({ ctx, kind }: { ctx: PageContext; kind: string }) {
  const open = (id: string) => ctx.go(href({ area: "record", id }));
  switch (kind) {
    case "promises":
      return <PromisesKind ctx={ctx} open={open} />;
    case "knowledge":
      return <KnowledgeKind ctx={ctx} open={open} />;
    case "operations": {
      const entries = D.opsEntries(ctx.model);
      return (
        <contents.OperationsPage
          state={entries.length ? "ready" : "empty"}
          entries={entries}
          records={new Set(entries.map((e) => e.recordId)).size}
          onOpenRecord={open}
        />
      );
    }
    case "provenance": {
      const [s, set] = ctx.slot<{ view: contents.ProvenanceView; day?: string }>(
        "contents:provenance",
        { view: "team" },
      );
      const p = D.provenance(ctx.model, ctx.language);
      return (
        <contents.ProvenancePage
          view={s.view}
          {...p}
          selectedDay={p.days.find((d) => d.date === s.day) ?? null}
          onView={(view) => set({ view })}
          onPickDay={(day) => set({ day })}
          onOpenRecord={open}
          onTeam={() => ctx.go(href({ area: "records" }))}
        />
      );
    }
    case "taxonomy": {
      const [s, set] = ctx.slot<{
        view: contents.TaxonomyView;
        expanded: string[];
        selected: string | null;
      }>("contents:taxonomy", { view: "tree", expanded: [], selected: null });
      return (
        <contents.TaxonomyPage
          view={s.view}
          domains={D.taxonomyDomains(ctx.model, ctx.domains)}
          expanded={s.expanded}
          selected={s.selected}
          mobile={ctx.mobile}
          onView={(view) => set({ view })}
          onToggle={(id) =>
            set({
              expanded: s.expanded.includes(id)
                ? s.expanded.filter((x) => x !== id)
                : [...s.expanded, id],
            })
          }
          onSelect={(selected) => set({ selected })}
          onOpenOverview={(id) => {
            const [domain, capability] = id.split("/");
            ctx.go(
              capability
                ? href({ area: "capability", domain, capability })
                : href({ area: "domain", domain }),
            );
          }}
        />
      );
    }
    case "calibration": {
      const [s, set] = ctx.slot<{ view: contents.CalibrationView; metric?: string }>(
        "contents:calibration",
        { view: "bands" },
      );
      const c = D.calibration(ctx.model, D.taxonomyDomains(ctx.model, ctx.domains), ctx.t);
      return (
        <contents.CalibrationPage
          view={s.view}
          metrics={c.metrics}
          outliers={c.outliers}
          metric={s.metric}
          onView={(view) => set({ view })}
          onMetric={(metric) => set({ metric })}
          onOpenRecord={(id) =>
            ctx.model.byId[id]
              ? open(id)
              : ctx.go(
                  id.includes("/")
                    ? href({
                        area: "capability",
                        domain: id.split("/")[0],
                        capability: id.split("/")[1],
                      })
                    : href({ area: "domain", domain: id }),
                )
          }
        />
      );
    }
    case "tests":
      return <TestsKind ctx={ctx} />;
    case "deviations": {
      const items = D.deviations(ctx.model);
      return (
        <contents.DeviationsPage
          state={items.length ? "ready" : "empty"}
          items={items}
          promises={ctx.model.allScn.length}
          onOpenRecord={open}
        />
      );
    }
    case "drift": {
      const [s, set] = ctx.slot<{ view: contents.DriftView }>("contents:driftStrength", {
        view: "record",
      });
      const items = D.driftItems(ctx.model);
      return (
        <contents.DriftPage
          view={s.view}
          state={items.length ? "ready" : "empty"}
          items={items}
          recordTotal={ctx.features.length}
          now={new Date().toISOString()}
          onView={(view) => set({ view })}
          onOpenRecord={open}
          onReview={open}
        />
      );
    }
    case "fixed": {
      const [s, set] = ctx.slot<{ view: contents.FixedView; domain: string | null }>(
        "contents:fixed",
        { view: "timeline", domain: null },
      );
      return (
        <contents.FixedPage
          view={s.view}
          commits={D.fixCommits(ctx.model)}
          domain={s.domain}
          onView={(view) => set({ view })}
          onDomain={(d) => set({ domain: s.domain === d ? null : d })}
          mobile={ctx.mobile}
          onOpenRecord={open}
          onCopy={ctx.copy}
        />
      );
    }
    case "anchor":
      return <AnchorsKind ctx={ctx} open={open} />;
    case "files": {
      const [s, set] = ctx.slot<{ view: contents.FilesView; expanded: string[] }>(
        "contents:files",
        { view: "tree", expanded: [] },
      );
      const shares = D.dirShares(ctx.model);
      const anchored = anchoredPaths(ctx.model);
      const scan = ctx.model.scan;
      const files =
        scan.files ?? (shares ? scan.anchoredFiles!.length + scan.unanchoredFiles!.length : null);
      return (
        <contents.FilesPage
          view={s.view}
          scan={{
            // A figure the scan did not report stays null: the page shows "—", never 0.
            files,
            anchored: anchored.length,
            unanchored: files == null ? null : files - anchored.length,
            // The scan reports its line total as `totalLoc`; without it, "—".
            loc: typeof scan.totalLoc === "number" ? scan.totalLoc : null,
          }}
          tree={D.fileTree(anchored, shares)}
          expanded={s.expanded}
          gaps={D.fileGaps(ctx.model, shares)}
          onView={(view) => set({ view })}
          onToggle={(p) =>
            set({
              expanded: s.expanded.includes(p)
                ? s.expanded.filter((x) => x !== p)
                : [...s.expanded, p],
            })
          }
        />
      );
    }
    case "rules": {
      const [s, set] = ctx.slot<{ selected: string | null }>("contents:rules", { selected: null });
      const items = D.rules(ctx.model);
      return (
        <contents.RulesPage
          state={items.length ? "ready" : "empty"}
          items={items}
          records={ctx.model.features.length}
          selected={s.selected}
          onSelect={(id) => set({ selected: s.selected === id ? null : id })}
          onOpenRecord={open}
        />
      );
    }
    case SHAPES_KIND:
      return <ShapesPage ctx={ctx} />;
    case "cycles":
      return <contents.CyclesPage nodes={D.cycleNodes(ctx.model)} onOpenRecord={open} />;
    case "read-errors":
      return <contents.UnreadPage items={D.unreadRecords(ctx.model)} />;
    case "decisions":
      return (
        <contents.DecisionsPage
          items={D.decisionTargets(ctx.model)}
          onOpenDecision={(target) => ctx.go(href({ area: "plugin", plugin: "adr", rest: target }))}
          onOpenRecord={open}
        />
      );
    default:
      return null;
  }
}

function PromisesKind({ ctx, open }: { ctx: PageContext; open: (id: string) => void }) {
  const [s, set] = ctx.slot<{
    view: contents.PromisesView;
    query: string;
    filter: D.PromiseFilter;
    page: number;
    selected: string | null;
  }>("contents:promises", { view: "list", query: "", filter: {}, page: 1, selected: null });
  const all = D.promiseItems(ctx.derived);
  const base = s.view === "open" ? all.filter((i) => i.state !== "proven") : all;
  const hits = D.filterPromises(base, s.query, s.filter);
  const { slice, page } = pageOf(hits, s.page);
  return (
    <contents.PromisesPage
      view={s.view}
      state={hits.length || !all.length ? "ready" : "filtered-empty"}
      totals={D.promiseTotals(all, ctx.derived.M.length)}
      items={slice}
      records={D.promiseRecords(ctx.derived)}
      page={page}
      pageSize={PAGE}
      total={hits.length}
      query={s.query}
      facets={D.promiseFacets(all, s.filter, ctx.t)}
      selected={all.find((i) => i.key === s.selected) ?? null}
      mobile={ctx.mobile}
      onView={(view) => set({ view, page: 1 })}
      onQuery={(query) => set({ query, page: 1 })}
      onFacet={(key) => {
        const [k, v] = key.split(":");
        set({
          filter:
            k === "state"
              ? { ...s.filter, state: toggle(s.filter.state, v as contents.PromiseState) }
              : { ...s.filter, domain: toggle(s.filter.domain, v) },
          page: 1,
        });
      }}
      onReset={() => set({ query: "", filter: {}, page: 1 })}
      onPage={(p) => set({ page: p })}
      onSelect={(selected) => set({ selected })}
      onOpenRecord={open}
    />
  );
}

function KnowledgeKind({ ctx, open }: { ctx: PageContext; open: (id: string) => void }) {
  const { t: tt } = useText();
  const [s, set] = ctx.slot<{ view: contents.KnowledgeView; page: number; slot?: number }>(
    "contents:knowledge",
    { view: "matrix", page: 1 },
  );
  const rows = D.knowledgeRows(ctx.model, ctx.t);
  const { perSlot, totals } = D.knowledgeTotals(rows);
  const shown =
    s.view === "open"
      ? rows.filter((r) =>
          s.slot == null ? r.slots.some((x) => x == null) : r.slots[s.slot] == null,
        )
      : rows;
  const { slice, page } = pageOf(shown, s.page);
  return (
    <contents.KnowledgePage
      view={s.view}
      slots={D.knowledgeLabels(tt)}
      questions={RECORD_SLOTS.map((k) => tt(records.KNOWLEDGE_TEXT[k].question))}
      rows={slice}
      totals={totals}
      openPerSlot={perSlot}
      page={page}
      pageSize={PAGE}
      total={shown.length}
      slot={s.slot}
      mobile={ctx.mobile}
      onView={(view) => set({ view, page: 1 })}
      onPage={(p) => set({ page: p })}
      onSlot={(i) => set({ slot: s.slot === i ? undefined : i, page: 1 })}
      onOpenRecord={open}
      onAnswer={(id, slot) => ctx.ask(knowledgePrompt(ctx.t, tt, id, slot))}
    />
  );
}

function TestsKind({ ctx }: { ctx: PageContext }) {
  const [s, set] = ctx.slot<{
    view: contents.TestsView;
    page: number;
    sort?: { key: string; dir: "asc" | "desc" };
    kind: contents.TestKind | null;
    expanded: string[];
  }>("contents:tests", { view: "pyramid", page: 1, kind: null, expanded: [] });
  const files = D.testFiles(ctx.model);
  const filtered = s.kind ? files.filter((f) => f.kind === s.kind) : files;
  const sorted = s.sort
    ? [...filtered].sort((a, b) => {
        const x = a[s.sort!.key as keyof typeof a];
        const y = b[s.sort!.key as keyof typeof b];
        const c =
          typeof x === "number" && typeof y === "number"
            ? x - y
            : String(x).localeCompare(String(y));
        return s.sort!.dir === "asc" ? c : -c;
      })
    : filtered;
  const paged = pageOf(sorted, s.page);
  return (
    <contents.TestsPage
      view={s.view}
      kinds={D.testKinds(files)}
      // The reader receives no runner configuration; `facet test` reports are not read here.
      runners={[]}
      files={s.view === "table" ? paged.slice : filtered}
      page={paged.page}
      pageSize={PAGE}
      total={filtered.length}
      sort={s.sort}
      kind={s.kind}
      expanded={s.expanded}
      mobile={ctx.mobile}
      onView={(view) => set({ view, page: 1 })}
      onKind={(k) => set({ kind: s.kind === k ? null : (k as contents.TestKind), page: 1 })}
      onToggle={(d) =>
        set({
          expanded: s.expanded.includes(d) ? s.expanded.filter((x) => x !== d) : [...s.expanded, d],
        })
      }
      onSort={(key) => set({ sort: sortNext(s.sort, key), page: 1 })}
      onPage={(page) => set({ page })}
    />
  );
}

function AnchorsKind({ ctx, open }: { ctx: PageContext; open: (id: string) => void }) {
  const [s, set] = ctx.slot<{
    view: contents.AnchorsView;
    query: string;
    page: number;
    sort?: { key: string; dir: "asc" | "desc" };
    dir: string | null;
    role: string | null;
  }>("contents:anchor", { view: "treemap", query: "", page: 1, dir: null, role: null });
  // The orphaned anchors stand in the table too, so the Overview's orphan row finds its own.
  const all = [...D.anchorRows(ctx.model), ...D.orphanRows(ctx.model)];
  const q = s.query.trim().toLowerCase();
  let rows = all.filter(
    (a) =>
      (!s.dir || D.dirKey(a.path) === s.dir) &&
      (!s.role || a.role === s.role) &&
      (!q || a.path.toLowerCase().includes(q) || a.recordId.toLowerCase().includes(q)),
  );
  if (s.sort) {
    const { key, dir } = s.sort;
    rows = [...rows].sort((a, b) => {
      const x = a[key as keyof typeof a];
      const y = b[key as keyof typeof b];
      const c =
        typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return dir === "asc" ? c : -c;
    });
  }
  const paged = pageOf(rows, s.page);
  return (
    <contents.AnchorsPage
      view={s.view}
      dirs={D.anchorDirs(all)}
      roles={D.anchorRoles(all)}
      rows={paged.slice}
      page={paged.page}
      pageSize={PAGE}
      total={rows.length}
      query={s.query}
      sort={s.sort}
      selectedDir={s.dir}
      mobile={ctx.mobile}
      onView={(view) => set({ view })}
      onDir={(d) => set({ dir: s.dir === d ? null : d, page: 1, view: "table" })}
      onQuery={(query) => set({ query, page: 1 })}
      onSort={(key) => set({ sort: sortNext(s.sort, key) })}
      onPage={(page) => set({ page })}
      onRole={(role) => set({ role: s.role === role ? null : role, page: 1 })}
      onOpenRecord={open}
    />
  );
}

/** The glossary page and a term's detail: grouped by the host's categories,
 * each other declared term in a definition linked, an unused term said as such. */

// @facet: registry/catalogue/reference-lookup
// @facet-role: primary
// @facet: customization/documents/write-actions
// @facet-role: primary
export function GlossaryPlace({ ctx, term }: { ctx: PageContext; term?: string }) {
  const [s, set] = ctx.slot<{
    letter: string | null;
    query: string;
    category: string | null;
    page: number;
    collapsed: string[];
  }>("glossary", { letter: null, query: "", category: null, page: 1, collapsed: [] });
  const all = D.glossaryTerms(ctx.derived);
  const q = s.query.trim().toLowerCase();
  const hits = all.filter(
    (t) =>
      (!s.letter || t.term.charAt(0).toUpperCase() === s.letter) &&
      (!s.category || t.category === s.category) &&
      (!q || t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q)),
  );
  // Grouped by category, the list is one page: a page break would cut a group in two.
  const groups = D.glossaryGroups(ctx.derived, hits);
  const size = groups ? Math.max(1, hits.length) : 60;
  const paged = pageOf(hits, s.page, size);
  const detail = term ? D.glossaryDetail(ctx.derived, term) : null;
  // Every other declared term in a definition links; the term itself does not.
  const index = ctx.derived.glossary?.index.filter((x) => x !== term) ?? [];
  const prose = useMemo(
    () =>
      proseRenderer(
        ctx.derived.glossary
          ? {
              index,
              onTerm: (to) => ctx.go(href({ area: "glossary", term: to })),
              title: (to) => to,
            }
          : null,
      ),
    // `index` follows `term` and the glossary; `ctx.go` is stable for the place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.derived.glossary, term],
  );
  // No surface writes the glossary: the host has no
  // glossary write tool.
  // The button therefore stays disabled and names that reason.
  return (
    <>
      <contents.GlossaryPage
        state={!ctx.derived.glossary ? "undeclared" : all.length ? "ready" : "empty"}
        mode={detail ? "term" : "list"}
        terms={paged.slice}
        letters={D.lettersOf(all)}
        letter={s.letter}
        query={s.query}
        page={paged.page}
        pageSize={size}
        total={hits.length}
        categories={[...new Set(all.map((t) => t.category).filter(Boolean))]}
        category={s.category}
        detail={detail}
        groups={groups}
        collapsed={s.collapsed}
        onToggleGroup={(id) =>
          set({
            collapsed: s.collapsed.includes(id)
              ? s.collapsed.filter((x) => x !== id)
              : [...s.collapsed, id],
          })
        }
        renderProse={prose}
        mobile={ctx.mobile}
        onLetter={(letter) => set({ letter, page: 1 })}
        onQuery={(query) => set({ query, page: 1 })}
        onCategory={(category) => set({ category, page: 1 })}
        onPage={(page) => set({ page })}
        onOpen={(t) => ctx.go(href({ area: "glossary", term: t }))}
        onClose={() => ctx.go(href({ area: "glossary" }))}
        onOpenRecord={(id) => ctx.go(href({ area: "record", id }))}
      />
    </>
  );
}
