/** Group A places: Overview, Product, Area, Capability and the page for a place
 * that does not exist. */

import { PluginDraw } from "../plugin-guard";
import { frame } from "@/screens";
import {
  RECORDS_DEFAULT,
  capabilityData,
  creationDates,
  domainData,
  filtersFromSearch,
  overviewModel,
  nearestRecords,
  type RecordsQuery,
} from "../derive-reader";
import type { PageContext } from "../context";
import { usePreferences, writePreferences } from "../preferences";
import { driftComparison } from "../derive-roles";
import { OverviewGenerative } from "../generative";
import { href, type Route } from "../route";
import { RoleSections } from "./roles";

const CONTENT_KINDS = new Set([
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
  "data-shapes",
]);

/** Where a page's relative target (`domain/x`, `driftStrength`, `records?owner=none`,
 * `adr/file.md`) leads. Records filters travel through the container's slot,
 * because a place's address carries no query. */

export function targetPath(target: string, ctx: Pick<PageContext, "slot">): string {
  const [head, search = ""] = target.split("?");
  const parts = head.split("/").filter(Boolean);
  const first = parts[0] ?? "";
  if (first === "records") {
    const [q, set] = ctx.slot<RecordsQuery>("records", RECORDS_DEFAULT);
    set({ filters: { ...filtersFromSearch(search) }, page: 1, query: q.query });
    return href({ area: "records" });
  }
  if (first === "product") return href({ area: "product" });
  if (first === "domain" && parts[1])
    return parts[2]
      ? href({ area: "capability", domain: parts[1], capability: parts[2] })
      : href({ area: "domain", domain: parts[1] });
  if (first === "adr")
    return href({ area: "plugin", plugin: "adr", rest: parts.slice(1).join("/") });
  if (first === "glossary") return href({ area: "glossary" });
  if (first === "ask") return href({ area: "ask" });
  if (CONTENT_KINDS.has(first)) return href({ area: "contents", kind: first });
  return href({ area: "unknown", path: `/${head}` });
}

const record = (id: string) => href({ area: "record", id });

/** The host's read endpoints an agent can fetch more from, as `internal/ui`
 * registers them; the purposes are Atlas words. */

export function hostEndpoints(t: PageContext["t"]): frame.EndpointView[] {
  return [
    {
      method: "GET",
      path: "/api/corpus",
      purpose: t("ui.reader-pages.frame-every-record-streamed"),
    },
    {
      method: "GET",
      path: "/api/rag",
      purpose: t("ui.reader-pages.frame-search-records-code"),
    },
    {
      method: "GET",
      path: "/api/repo/state",
      purpose: t("ui.reader-pages.frame-branch-working-tree"),
    },
    { method: "GET", path: "/api/plugins", purpose: t("ui.reader-pages.frame-installed-plugins") },
    {
      method: "POST",
      path: "/api/plugin/call",
      purpose: t("ui.reader-pages.frame-granted-plugin-tools-only"),
    },
    {
      method: "GET",
      path: "/api/companion/state",
      purpose: t("ui.reader-pages.frame-companion-its-models"),
    },
    { method: "GET", path: "/api/mcp/tools", purpose: t("ui.reader-pages.frame-mcp-tools") },
  ];
}

/** The MCP server's own tool names with what Atlas knows about each: the
 * retrieval tool answers only once an index was built. `null` stays `null`. */

export function toolViews(
  tools: frame.OverviewModel["tools"],
  t: PageContext["t"],
): frame.OverviewModel["tools"] {
  return (
    tools?.map((tool) =>
      tool.name === "rag_query"
        ? { ...tool, purpose: t("ui.reader-pages.frame-needs-index-facet-rag-index") }
        : tool,
    ) ?? null
  );
}

/** The Overview, weighted for the chosen reader. A role a plugin contributed
 * draws the plugin's own overview, and plugins' `surface.section` stands below. */

// @facet: registry/perspectives/author-knowledge
// @facet-role: primary
// @facet: registry/perspectives/newcomer-entry
// @facet-role: primary
export function OverviewPlace({ ctx }: { ctx: PageContext }) {
  const [s, set] = ctx.slot("overview", { driftPage: 1 });
  const base = overviewModel(ctx.model, ctx.derived, ctx.overview, ctx.features);
  const model = {
    ...base,
    endpoints: hostEndpoints(ctx.t),
    tools: toolViews(base.tools, ctx.t),
    // An empty drift list from a comparison that could not be made is not
    // "no drift": it is unmeasured, and the page says so instead of calm.
    driftMeasured:
      base.driftMeasured && (base.drift.length > 0 || driftComparison(ctx.model).determined),
  };
  // A role a plugin contributed brings its own overview.
  const pluginRole = ctx.plugins?.host.roles.find(ctx.role) ?? null;
  const section = ctx.plugins?.slot("surface.section", {}) ?? null;
  if (pluginRole)
    return (
      <>
        <div className="t-page" data-testid="plugin-role-overview">
          <PluginDraw
            plugin={pluginRole.plugin}
            draw={() =>
              pluginRole.render({
                place: { depth: 0, fid: null, sid: null, role: ctx.role, area: null },
              })
            }
          />
        </div>
        {section}
      </>
    );
  const reader: frame.OverviewRole = frame.OVERVIEW_ROLE_KEYS.find((r) => r === ctx.role) ?? "dev";
  const page = (
    <frame.OverviewPage
      {...{ reader }}
      model={model}
      mobile={ctx.mobile}
      driftPage={s.driftPage}
      onDriftPage={(driftPage) => set({ driftPage })}
      onNavigate={(t) => ctx.go(targetPath(t, ctx))}
      onOpenRecord={(id) => ctx.go(record(id))}
      onAsk={(q) => ctx.ask(q)}
      onCopy={ctx.copy}
      generative={
        <>
          <OverviewGenerative ctx={ctx} />
          <RoleSections ctx={ctx} place="lead" />
        </>
      }
    />
  );
  return (
    <>
      {page}
      <div className="t-page overview-tail" data-testid="overview-role-tail">
        <RoleSections ctx={ctx} place="tail" />
      </div>
      {section ? <div className="t-page">{section}</div> : null}
    </>
  );
}

type ProductState = {
  view: frame.ProductView;
  selected: string | null;
  time: number | null;
  page: number;
  sort: { key: string; dir: "asc" | "desc" };
};

/** The product page: the city as a map, the treemap and the list. */

// @facet: registry/coverage/product-city
// @facet-role: primary
export function ProductPlace({ ctx }: { ctx: PageContext }) {
  const [s, set] = ctx.slot<ProductState>("product", {
    view: "city",
    selected: null,
    time: null,
    page: 1,
    sort: { key: "proven", dir: "asc" },
  });
  const dates = creationDates(ctx.features);
  const time = dates.length > 1 ? { dates, index: s.time ?? dates.length - 1 } : undefined;
  const prefs = usePreferences();
  return (
    <frame.ProductPage
      cityHeight={prefs.cityHeight}
      cityNames={prefs.cityNames}
      cityLabels={prefs.cityLabels}
      onCityNames={(cityNames) => writePreferences({ cityNames })}
      domains={ctx.domains}
      features={ctx.features}
      view={s.view}
      selected={s.selected}
      time={time}
      mobile={ctx.mobile}
      page={s.page}
      pageSize={25}
      sort={s.sort}
      onView={(view) => set({ view })}
      onSelect={(selected) => set({ selected })}
      onTime={(t) => set({ time: t })}
      onPage={(page) => set({ page })}
      onSort={(key) =>
        set({
          sort: { key, dir: s.sort.key === key && s.sort.dir === "asc" ? "desc" : "asc" },
          page: 1,
        })
      }
      onOpenRecord={(id) => ctx.go(record(id))}
      onOpenDomain={(domain) => ctx.go(href({ area: "domain", domain }))}
      onOpenCapability={(domain, capability) =>
        ctx.go(href({ area: "capability", domain, capability }))
      }
    />
  );
}

export function DomainPlace({ ctx, id }: { ctx: PageContext; id: string }) {
  const data = domainData(ctx.model, ctx.features, ctx.domains, id, ctx.overview.history);
  if (!data)
    return (
      <MissingPlace
        ctx={ctx}
        path={href({ area: "domain", domain: id })}
        kind={ctx.t("ui.reader-pages.frame-area")}
      />
    );
  return (
    <frame.DomainPage
      {...data}
      mobile={ctx.mobile}
      crumbOpen={ctx.crumb.open}
      onToggleCrumb={ctx.crumb.toggle}
      crumbQuery={ctx.crumb.query}
      onCrumbQuery={ctx.crumb.setQuery}
      onCloseCrumb={ctx.crumb.close}
      onNavigate={(t) => ctx.go(targetPath(t, ctx))}
      onOpenDomain={(domain) => ctx.go(href({ area: "domain", domain }))}
      onOpenCapability={(capability) =>
        ctx.go(href({ area: "capability", domain: id, capability }))
      }
      onOpenRecord={(rid) => ctx.go(record(rid))}
    />
  );
}

export function CapabilityPlace({
  ctx,
  domain,
  capability,
}: {
  ctx: PageContext;
  domain: string;
  capability: string;
}) {
  const [s, set] = ctx.slot<{
    view: frame.CapabilityPageView;
    query: string;
    page: number;
    sort: { key: string; dir: "asc" | "desc" };
  }>(`capability:${domain}/${capability}`, {
    view: "field",
    query: "",
    page: 1,
    sort: { key: "proven", dir: "asc" },
  });
  const data = capabilityData(ctx.model, ctx.features, ctx.domains, domain, capability);
  if (!data)
    return (
      <MissingPlace
        ctx={ctx}
        path={href({ area: "capability", domain, capability })}
        kind={ctx.t("ui.reader-pages.frame-capability")}
      />
    );
  return (
    <frame.CapabilityPage
      {...data}
      view={s.view}
      query={s.query}
      sort={s.sort}
      page={s.page}
      mobile={ctx.mobile}
      crumbOpen={ctx.crumb.open}
      onToggleCrumb={ctx.crumb.toggle}
      crumbQuery={ctx.crumb.query}
      onCrumbQuery={ctx.crumb.setQuery}
      onCloseCrumb={ctx.crumb.close}
      onNavigate={(t) => ctx.go(targetPath(t, ctx))}
      onOpenDomain={(d) => ctx.go(href({ area: "domain", domain: d }))}
      onOpenCapability={(d, c) => ctx.go(href({ area: "capability", domain: d, capability: c }))}
      onOpenRecord={(id) => ctx.go(record(id))}
      onView={(view) => set({ view })}
      onQuery={(query) => set({ query, page: 1 })}
      onPage={(page) => set({ page })}
      onSort={(key) =>
        set({ sort: { key, dir: s.sort.key === key && s.sort.dir === "asc" ? "desc" : "asc" } })
      }
    />
  );
}

/** A place that does not exist, with the nearest records by name. `kind` is the word, already translated. */
export function MissingPlace({
  ctx,
  path,
  kind,
}: {
  ctx: PageContext;
  path: string;
  kind?: string;
}) {
  const wanted = path.replace(/^\//, "").split("/").pop() ?? "";
  return (
    <frame.NotFoundPage
      path={path}
      kind={kind ?? ctx.t("ui.reader-pages.frame-place")}
      suggestions={wanted ? nearestRecords(ctx.model, wanted) : []}
      onOpen={(id) => ctx.go(record(id))}
      onHome={() => ctx.go(href({ area: "overview" }))}
      onSearch={ctx.openPalette}
      onBack={ctx.back}
    />
  );
}

export function routeKind(route: Route, t: PageContext["t"]): string {
  return route.area === "record"
    ? t("ui.reader-pages.frame-record")
    : t("ui.reader-pages.frame-place");
}
