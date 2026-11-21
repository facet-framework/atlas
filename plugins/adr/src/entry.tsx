/** The decisions plugin in Atlas, drawn with the FACET design system. */

import { useEffect, useState } from "react";
import { Button, EmptyState, Icon, ListRow } from "@facet-tools/ui";
import {
  NotFoundPage,
  SettingsSection,
  markdownHeadings,
  useText,
} from "../../../frontend/src/plugin/components";
import * as views from "./views/Adr";
import { tx } from "../../../frontend/src/i18n";
import type { AtlasApi } from "../../../frontend/src/plugin/host";
import { defuseLinks } from "../../shared/defuse-links";
import { DirectorySettings } from "../../shared/DirectorySettings";
import { knownStatus, type AdrStatus } from "./model/headers";
import { loadModel } from "./model/load";
import {
  entryAddress,
  matchEntries,
  type AdrEntry,
  type AdrModel,
} from "./model/model";
import { adrSearch, Inventory } from "./search";

/** The area this plugin registers; the host addresses it under the plugin's id. */
export const AREA = "decisions";

/** The model's English status values mapped to
 * the views' status ids. The view ids are identifiers, not stored text; their
 * rename is a separate change across the plugin and the reader. */

const ADR_STATUS: Record<AdrStatus, views.AdrStatus> = {
  proposed: "proposed",
  accepted: "accepted",
  superseded: "superseded",
  rejected: "rejected",
};

/** An entry as `adrItem` takes it. `status` is a string rather than the model's
 * type because a caller may still hand over a German status word; it is read
 * the way the head parser reads one. */

export type AdrItemInput = Omit<AdrEntry, "status"> & { status?: string };

export function adrItem(e: AdrItemInput, refs: number): views.AdrItem {
  const status = e.status ? knownStatus(e.status) : undefined;
  return {
    number: Number(e.number) || 0,
    title: e.title ?? e.slug,
    status: status ? ADR_STATUS[status] : "unknown",
    date: e.date ?? "—",
    // The ADR head carries no authors: unknown, which is not "nobody".
    authors: null,
    area: e.concerns ?? "",
    refs,
    file: e.path,
  };
}

export function adrCounts(
  items: views.AdrItem[],
): Record<views.AdrStatus, number> {
  const out = {
    proposed: 0,
    accepted: 0,
    superseded: 0,
    rejected: 0,
    unknown: 0,
  };
  for (const i of items) out[i.status] += 1;
  return out;
}

/** Splits an ADR's own head off its text: the `# title` line, the
 * `**Key:** value` lines below it and the `---` that closes them. Status and
 * date stand in the reader's header already, so the facts leave them out; the
 * other lines keep their key and their value as written. */

export function adrFront(body: string): {
  facts: [string, string][];
  markdown: string;
} {
  const lines = body.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (/^#\s+/.test(lines[i] ?? "")) i++;
  const afterTitle = i;
  const facts: [string, string][] = [];
  while (i < lines.length) {
    if (!lines[i].trim()) {
      i++;
      continue;
    }
    const m = /^\*\*([^*]+?):\*\*\s*(.*)$/.exec(lines[i]);
    if (!m) break;
    facts.push([m[1].trim(), m[2].trim()]);
    i++;
  }
  if (!facts.length)
    return { facts, markdown: lines.slice(afterTitle).join("\n") };
  if (/^---+\s*$/.test(lines[i] ?? "")) i++;
  return {
    facts: facts.filter(([k]) => !/^(status|date)$/i.test(k)),
    markdown: lines.slice(i).join("\n"),
  };
}

/** The records that name a decision: every decision target that resolves to
 * this entry and to no other. A target that fits two decisions (a shared
 * number) is counted for neither, rather than for the first one listed. */

export function decisionRefs(
  model: AdrModel,
  targets: { target: string; recordIds: string[] }[],
  entry: AdrEntry,
): string[] {
  const ids = new Set<string>();
  for (const t of targets) {
    const m = matchEntries(model, t.target);
    if (m.length === 1 && m[0] === entry)
      for (const id of t.recordIds) ids.add(id);
  }
  return [...ids];
}

/** The heading id the address names after `#`, or null. */
function addressAnchor(): string | null {
  const h = window.location.hash.slice(1);
  if (!h) return null;
  try {
    return decodeURIComponent(h);
  } catch {
    return h;
  }
}

/** Phone width, measured the way the host measures it. */
export function useMobile(): boolean {
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

/** What the area keeps: the address it shows and the reader's filters. */
export type DecisionsState = {
  path: string | null;
  view: views.AdrView;
  query: string;
  status: views.AdrStatus | null;
  page: number;
  settings: boolean;
};

export function decisionsState(path: string | null): DecisionsState {
  return {
    path,
    view: "timeline",
    query: "",
    status: null,
    page: 1,
    settings: false,
  };
}

type Load =
  | { state: "loading" }
  | { state: "ready"; data: AdrModel }
  | { state: "error"; reason: string };

/** The decisions, loaded once per plugin load and shared by the area and the search. */
export class Decisions {
  private pending: Promise<AdrModel> | null = null;
  readonly store = new Inventory();
  constructor(private readonly call: AtlasApi["bus"]["call"]) {}
  load(): Promise<AdrModel> {
    if (!this.pending) {
      const ticket = this.store.begin();
      this.pending = loadModel(this.call).then(
        (model) => {
          this.store.apply(model, ticket);
          return model;
        },
        (e: unknown) => {
          this.pending = null;
          throw e;
        },
      );
    }
    return this.pending;
  }
}

/** The decisions area: the overview filtered by text and status, one decision
 * at its repository path, and a file the host refused with the host's reason. */

// @facet: customization/documents/write-actions
// @facet-role: related
// @facet: customization/documents/adr-reading
// @facet-role: primary
export function DecisionsPage({
  atlas,
  decisions,
  state,
  setState,
}: {
  atlas: AtlasApi;
  decisions: Decisions;
  state: DecisionsState;
  setState: (next: DecisionsState) => void;
}) {
  const s = state;
  const set = (patch: Partial<DecisionsState>) => setState({ ...s, ...patch });
  const rest = s.path ?? "";
  const mobile = useMobile();
  const { t: tt } = useText();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // The section an address names opens; following the contents rewrites the address.
  const [anchor, setAnchor] = useState<string | null>(addressAnchor);
  useEffect(() => {
    const onHash = () => setAnchor(addressAnchor());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (anchor && load.state === "ready")
      document.getElementById(anchor)?.scrollIntoView?.();
  }, [anchor, load.state, rest]);
  useEffect(() => {
    let alive = true;
    decisions.load().then(
      (data) => alive && setLoad({ state: "ready", data }),
      (e: unknown) => {
        if (alive)
          setLoad({
            state: "error",
            reason: e instanceof Error ? e.message : String(e),
          });
      },
    );
    return () => {
      alive = false;
    };
  }, [decisions]);
  const model = load.state === "ready" ? load.data : null;
  const found = rest && model ? matchEntries(model, rest) : null;
  const canonical =
    found?.length === 1 && model ? entryAddress(model, found[0]) : null;
  useEffect(() => {
    if (canonical && canonical !== rest) setState({ ...s, path: canonical });
  }, [canonical, rest, s, setState]);
  const open = (address: string | null) => atlas.verbs.openArea(AREA, address);
  const targets = atlas.data.v.model.decisionTargets;
  const byId = atlas.data.v.model.byId;
  if (load.state === "error")
    return (
      <div className="t-page">
        <EmptyState
          icon="scales"
          title={tx("ui.adr-src.entry-decisions-cannot-read")}
          body={load.reason}
        />
      </div>
    );
  const dir = model?.directory ?? "docs/adr";
  if (s.settings)
    return (
      <div className="t-page" data-testid="adr-settings">
        <Button
          variant="quiet"
          icon="back"
          onClick={() => set({ settings: false })}
        >
          {tx("ui.adr-src.entry-back-decisions")}
        </Button>
        <DirectorySettings kind="adr" />
      </div>
    );
  const refsOf = (e: AdrEntry) =>
    model ? decisionRefs(model, targets, e) : [];
  const items = (model?.entries ?? []).map((e) => adrItem(e, refsOf(e).length));
  if (rest && model) {
    // A record may cite a document outside the decision directory as a decision.
    const home = dir.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!found?.length && rest.includes("/") && !rest.startsWith(`${home}/`))
      return (
        <div className="t-page" data-testid="adr-outside">
          <EmptyState
            icon="scales"
            title={
              <span className="t-wrap">
                {tx("ui.adr-src.entry-path-not-decision-directory-dir", {
                  path: rest,
                  dir: home,
                })}
              </span>
            }
            action={
              <div className="t-stack">
                {(targets.find((t) => t.target === rest)?.recordIds ?? []).map(
                  (id) => (
                    <ListRow
                      key={id}
                      lead={<Icon name="document" size={14} />}
                      title={<span className="t-wrap">{id}</span>}
                      onClick={() => atlas.verbs.open(id)}
                    />
                  ),
                )}
              </div>
            }
          />
        </div>
      );
    if (!found?.length)
      return (
        <NotFoundPage
          path={window.location.pathname}
          kind={tx("ui.adr-src.entry-decision")}
          suggestions={[]}
          onOpen={(id) => atlas.verbs.open(id)}
          onHome={() => atlas.verbs.go(0)}
          onBack={() => open(null)}
        />
      );
    if (found.length > 1)
      return (
        <div className="t-page" data-testid="adr-ambiguous">
          <EmptyState
            icon="scales"
            title={
              <span className="t-wrap">
                {tx("ui.adr-src.entry-several-decisions-match-address", {
                  address: rest,
                })}
              </span>
            }
            action={
              <div className="t-stack">
                {found.map((x) => (
                  <ListRow
                    key={x.path}
                    lead={<Icon name="scales" size={14} />}
                    title={
                      <>
                        {x.title ??
                          [x.number, x.slug].filter(Boolean).join(" ")}
                        {/** The path as a second line of the title: a sub line is clamped. */}
                        <span
                          className="t-wrap t-mono t-meta"
                          style={{ display: "block" }}
                        >
                          {entryAddress(model, x)}
                        </span>
                      </>
                    }
                    onClick={() => open(entryAddress(model, x))}
                  />
                ))}
              </div>
            }
          />
        </div>
      );
    const e = found[0];
    // A file the host would not hand out stays on its own entry, with the host's reason.
    if (e.errorState !== null)
      return (
        <div className="t-page t-stack" data-testid="adr-unreadable">
          <Button
            variant="quiet"
            size="small"
            icon="back"
            onClick={() => open(null)}
          >
            {tt("ui.adr-src.entry-decisions")}
          </Button>
          <EmptyState
            tone="error"
            icon="error"
            title={tt("ui.adr-src.entry-file-not-readable")}
            body={
              <span className="t-wrap">
                <span className="t-mono">{e.path}</span> · {e.errorState}
              </span>
            }
          />
        </div>
      );
    const item = adrItem(e, 0);
    const front = adrFront(defuseLinks(e.body));
    return (
      <views.AdrReader
        adr={{
          number: item.number,
          title: item.title,
          status: item.status,
          rawStatus: e.statusRaw ?? "—",
          date: item.date,
          file: e.path,
          authors: item.authors,
        }}
        markdown={front.markdown}
        facts={front.facts}
        anchor={anchor}
        toc={markdownHeadings(front.markdown)
          .filter((h) => h.level <= 2)
          .map(({ id, label }) => ({ id, label }))}
        onLink={(to) => {
          if (!to.startsWith("#")) return;
          window.history.replaceState(window.history.state, "", to);
          setAnchor(to.slice(1));
        }}
        records={refsOf(e).map((id) => ({
          id,
          summary: byId[id]?.summary ?? "",
          lifecycle: byId[id]?.lifecycle ?? "—",
        }))}
        mobile={mobile}
        onBack={() => open(null)}
        onOpenRecord={(id) => atlas.verbs.open(id)}
      />
    );
  }
  const q = s.query.trim().toLowerCase();
  const hits = items.filter(
    (i) =>
      (!s.status || i.status === s.status) &&
      (!q ||
        i.title.toLowerCase().includes(q) ||
        i.file.toLowerCase().includes(q)),
  );
  return (
    <views.AdrCollection
      state={
        load.state === "loading"
          ? "loading"
          : !items.length
            ? "empty"
            : hits.length
              ? "ready"
              : "filtered-empty"
      }
      view={s.view}
      items={hits.slice((s.page - 1) * 25, s.page * 25)}
      total={hits.length}
      counts={adrCounts(items)}
      page={s.page}
      pageSize={25}
      query={s.query}
      activeStatus={s.status}
      directory={dir}
      mobile={mobile}
      onView={(view) => set({ view })}
      onQuery={(query) => set({ query, page: 1 })}
      onStatus={(st) =>
        set({
          status: s.status === st ? null : (st as views.AdrStatus),
          page: 1,
        })
      }
      onPage={(page) => set({ page })}
      onOpen={(n, file) => {
        // Two decisions may share a number: the file decides, the number only without one.
        const e = model?.entries.find((x) =>
          file ? x.path === file : Number(x.number) === n,
        );
        if (model && e) open(entryAddress(model, e));
      }}
      onReset={() => set({ query: "", status: null, page: 1 })}
      onSettings={() => set({ settings: true })}
    />
  );
}

// @facet: customization/documents/adr-plugin
// @facet-role: primary
// @facet: customization/contributions/plugin-pages
// @facet-role: primary
export default function adrEntry(atlas: AtlasApi): void {
  const decisions = new Decisions(atlas.bus.call);
  const publish = (model: AdrModel) =>
    atlas.data.publish(
      "decisions",
      model.entries
        .map((entry) => ({
          file: entryAddress(model, entry),
          title: (entry.title ?? entry.slug).replace(
            /^ADR\s+\d+\s+[—-]\s+/i,
            "",
          ),
          status: entry.status ?? entry.statusRaw ?? "—",
          date: entry.date ?? "—",
          refs: decisionRefs(model, atlas.data.v.model.decisionTargets, entry),
        }))
        .filter((entry) => entry.refs.length > 0),
    );
  // Loaded once here so the search finds decisions before the area was ever opened.
  decisions
    .load()
    .then(publish)
    .catch(() => {});
  atlas.bus.on("facets.changed", () => {
    const model = decisions.store.current;
    if (model) publish(model);
  });
  atlas.search.register(
    "decisions",
    adrSearch(decisions.store, (path) => atlas.verbs.openArea(AREA, path)),
  );
  atlas.areas.register(
    AREA,
    ({ state, setState }) => (
      <DecisionsPage
        atlas={atlas}
        decisions={decisions}
        state={state as DecisionsState}
        setState={setState}
      />
    ),
    {
      initial: (arg) => decisionsState(arg),
      place: (state) => (state as DecisionsState).path,
    },
  );
  atlas.settings.register({
    id: "adr",
    group: "Plugins",
    title: tx("ui.adr-src.entry-decisions"),
    subtitle: tx("ui.adr-src.entry-architecture-decisions"),
    keywords: tx("ui.adr-src.entry-adr-decision-records-architecture-docs"),
    render: () => (
      <SettingsSection title={tx("ui.adr-src.entry-architecture-decisions")}>
        <DirectorySettings kind="adr" />
      </SettingsSection>
    ),
  });
  atlas.commands.register({
    command: "/adr",
    argument: tx("ui.adr-src.entry-number-title"),
    purpose: tx("ui.adr-src.entry-open-decision"),
    group: tx("ui.adr-src.entry-decisions"),
    run: (argument) => atlas.verbs.openArea(AREA, argument.trim() || null),
  });
}
