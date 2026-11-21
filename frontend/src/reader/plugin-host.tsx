/** The plugin host of an Atlas session. */

import {
  useEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { EmptyState, Icon, ListRow } from "@facet-tools/ui";

import { PluginHost, type PlacePublic, type SlotName } from "@/plugin/host";
import type { DerivedModel } from "@/derive";
import Slot from "@/plugin/Slot";
import { OFFICIAL_PLUGINS } from "@/plugin/official";
import {
  fetchInstalledPlugins,
  fetchPluginCapabilities,
  resolveInstalledPlugins,
  type PluginCapabilities,
} from "@/plugin/installed";
import type { CatalogueCount, CatalogueSource } from "@/contents/catalogue";
import type { RegisteredTile } from "@/plugin/tiles";
import type { PageContext } from "./context";
import { href } from "./route";
import { failureText, PluginDraw, PluginGuard, safeCall } from "./plugin-guard";

/** The ids of the plugins this reader ships. */
const BUNDLED = OFFICIAL_PLUGINS.map((p) => p.id);

const sessions = new WeakMap<typeof fetch, Promise<PluginCapabilities>>();

const failures = new WeakMap<PluginHost, Map<string, string>>();

/** Bundled plugins whose entry threw, kept with the host they failed in. */
function failuresOf(host: PluginHost): Map<string, string> {
  let failed = failures.get(host);
  if (!failed) {
    failed = new Map();
    failures.set(host, failed);
  }
  return failed;
}

/** One capability claim per browser document, for the bundled plugins and
 * every verified installed one. */

// @facet: customization/execution/plugin-calls
// @facet-role: primary
export function documentPluginSession(): Promise<PluginCapabilities> {
  const fetcher = globalThis.fetch;
  if (!fetcher) return Promise.resolve({});
  let session = sessions.get(fetcher);
  if (!session) {
    session = fetchInstalledPlugins(fetcher).then((listing) =>
      fetchPluginCapabilities(
        [...BUNDLED, ...listing.filter((p) => p.verification === "ok").map((p) => p.id)],
        fetcher,
      ),
    );
    sessions.set(fetcher, session);
  }
  return session;
}

/** What the container hands the host: where a plugin's verbs lead. Read at
 * the moment a verb runs, so both must stay valid for the whole session — a
 * state setter and a function that looks up the current `go` (as Atlas
 * passes them); the host keeps the first ones it is given. */

export type HostTargets = {
  go: (path: string) => void;
  setRole: (role: string) => void;
};

/** The host plus what the reader's surfaces read from it. */
export type ReaderPlugins = {
  host: PluginHost;
  /** True until the installed plugins were listed and loaded. */
  loading: boolean;
  /** The ids the reader switched off that name a plugin of this reader, in no order. */
  off: readonly string[];
  /** The switched-off ids whose plugin already ran in this document: the host
   * has no `unload`, so what its entry started (timers, listeners, an imported
   * module) keeps running until the page is loaded again. */

  offFromNextLoad: readonly string[];
  /** Installed plugins that were not loaded, by id, with the reason. */
  refused: Readonly<Record<string, string>>;
  /** What a tile computes over: the same corpus every surface reads. */
  source: CatalogueSource;
  /** A slot's plugins drawn at a place, or null where no plugin asked for it. */
  slot: (name: SlotName, place: Partial<PlacePublic>) => ReactNode;
};

/** Where a plugin area is addressed: its plugin's first area at
 * `/p/<plugin>/<address>`, any further area under its own name at
 * `/p/<area>/<address>` — the two forms `areaOf` reads back. */

function areaHref(host: PluginHost, area: string, address: string): string | null {
  const owner = host.areas.ownerOf(area);
  if (!owner) return null;
  const segment = host.areas.namesOf(owner)[0] === area ? owner : area;
  return href({ area: "plugin", plugin: segment, rest: address });
}

/** The navigation a plugin's verbs narrow, leading to the reader's addresses. */

export function readerNav(host: PluginHost, targets: HostTargets) {
  const go = (path: string) => targets.go(path);
  const record = (id: string, section?: string) => href({ area: "record", id, section });
  return {
    go: (depth: number, fid?: string | null, sid?: string | null) => {
      if (depth === 0 || !fid) return go(href({ area: "overview" }));
      go(record(fid, depth >= 2 && sid ? sid : undefined));
    },
    open: (fid: string) => go(record(fid)),
    openScenario: (fid: string, sid: string) => go(record(fid, sid)),
    openArea: (area: string, arg: string | null = null) => {
      const place = host.areas.open(area, arg);
      // No plugin has this name: opening nothing is the honest answer.
      if (!place) return;
      const address = host.areas.placeOf(place);
      const to = areaHref(host, area, typeof address === "string" ? address : (arg ?? ""));
      if (to) go(to);
    },
    closeArea: () => go(href({ area: "overview" })),
    openSheet: (_kind: string, term: string | null = null) =>
      go(href({ area: "glossary", term: term ?? undefined })),
    openCatalogue: (kind: string | null = null) =>
      go(href({ area: "contents", kind: kind ?? undefined })),
    setRole: (role: string) => targets.setRole(role),
  };
}

/** The session's host: built once per language (a plugin registers its labels
 * in the language active when it loaded), the bundled plugins loaded in the
 * render that built it, the installed ones once the capability is known.
 * A plugin the reader switched off is neither loaded nor imported. */

// @facet: customization/contributions/session-host
// @facet-role: primary
export function useReaderPlugins({
  sections,
  derived,
  language,
  targets,
  role,
  off = [],
}: {
  derived: DerivedModel;
  sections?: Readonly<Record<string, unknown>>;
  language: string;
  targets: HostTargets;
  role: string;
  /** Ids of the plugins the reader switched off: none of them is loaded. */
  off?: readonly string[];
}): ReaderPlugins {
  // The targets are read when a verb runs and stay valid for the session
  // (a state setter and a lookup of the current `go`), so the first ones serve.
  const [first] = useState(targets);
  // A set, not a sequence: the order the reader switched them off in changes
  // nothing, and the catalogue keeps deciding the order of the running ones.
  const offKey = [...new Set(off)].sort().join("\n");
  // `language` and the switched-off set are the reasons to rebuild, not values
  // the host reads: a plugin that ran has registered its commands, areas and
  // themes, and the host has no `unload`, so off means a fresh host.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const host = useMemo(() => new PluginHost(), [language, offKey]);
  const nav = useMemo(() => readerNav(host, first), [host, first]);
  const failed = failuresOf(host);
  const offIds = offKey ? offKey.split("\n") : [];
  // Set during render: an area draws in this same pass and reads the corpus.
  host.setCorpus({ v: derived, sections });
  for (const p of OFFICIAL_PLUGINS)
    if (!offIds.includes(p.id))
      safeCall(
        () => host.load(p.id, p.entry, nav as never),
        false,
        (cause) => failed.set(p.id, `Plugin failed to load: ${failureText(cause)}`),
      );
  // Loading until the installed plugins of this host have been settled.
  const [settled, setSettled] = useState<PluginHost | null>(null);
  const [refused, setRefused] = useState<Record<string, string>>({});
  // The ids `/api/plugins` listed, so a switched-off id is known to name one.
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    // Read from the host's own key: a new set of switched-off ids is a new host.
    const switchedOff = offKey ? offKey.split("\n") : [];
    void (async () => {
      const capabilities: PluginCapabilities = await documentPluginSession().catch(() => ({}));
      host.setCapabilities(capabilities);
      // An installed plugin with a bundled id is shadowed by the bundled one.
      const all = await fetchInstalledPlugins();
      if (alive) setInstalledIds(all.map((p) => p.id));
      const listing = all.filter((p) => !BUNDLED.includes(p.id));
      const next: Record<string, string> = {};
      // Verification refuses first: the session never claims for such a
      // plugin, so its own reason is the one to show, not a missing session.
      for (const p of listing)
        if (p.verification !== "ok")
          next[p.id] = `Plugin unavailable: not-loaded (${p.verification})`;
      const verified = listing.filter((p) => p.verification === "ok");
      // No module is imported for a plugin the session gave no capability.
      for (const p of verified) if (!capabilities[p.id]) next[p.id] = "Plugin session unavailable";
      // A plugin the reader switched off is not imported at all.
      const allowed = verified.filter((p) => capabilities[p.id] && !switchedOff.includes(p.id));
      if (allowed.length) {
        const { loaded, states } = await resolveInstalledPlugins(allowed, new Set(BUNDLED));
        if (!alive) return;
        // One entry that throws is that plugin's failure; the others still load.
        for (const p of loaded)
          safeCall(
            () => host.load(p.id, p.entry, nav as never),
            false,
            (cause) => (next[p.id] = `Plugin failed to load: ${failureText(cause)}`),
          );
        for (const state of states)
          if (state.status !== "loaded")
            next[state.listing.id] = `Plugin unavailable: ${state.status} (${state.reason})`;
      }
      if (alive) setRefused(next);
    })()
      .catch(() => undefined)
      .finally(() => alive && setSettled(host));
    return () => {
      alive = false;
    };
    // `offKey` built `host`: a new set is a new host, so `host` covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, nav]);
  // Ids that still name a plugin of this reader; a remembered id of a plugin
  // that is unavailable takes nothing with it.
  const offKnown = offIds.filter((id) => BUNDLED.includes(id) || installedIds.includes(id));
  // Every plugin any host of this document loaded. A fresh host stops drawing
  // a switched-off plugin, but code its entry started is not taken back.
  const [ran] = useState(() => new Set<string>());
  for (const id of host.loadedIds) ran.add(id);
  // A plugin switched off forgets which of its places were seen, so switching
  // it on again marks them new.
  useEffect(() => {
    if (offKey) host.seen.forget(offKey.split("\n"));
  }, [host, offKey]);
  // The corpus moved: a plugin listening for `facets.changed` hears the ids.
  useEffect(() => {
    host.announce(
      "facets.changed",
      derived.M.map((m) => m.id),
    );
  }, [host, derived]);
  // Late contributions (settings, tiles, search, roles, modes, commands) redraw what reads them.
  useSyncExternalStore(host.subscribe, host.version, host.version);
  useSyncExternalStore(host.slots.subscribe, host.slots.version, host.slots.version);
  useSyncExternalStore(host.seen.subscribe, host.seen.version, host.seen.version);
  // A command registered or taken back after the first paint redraws the slash list.
  const [, commandsMoved] = useReducer((n: number) => n + 1, 0);
  useEffect(() => host.commands.subscribe(commandsMoved), [host]);
  return {
    host,
    loading: settled !== host,
    off: offKnown,
    offFromNextLoad: offKnown.filter((id) => ran.has(id)),
    refused: failed.size ? { ...Object.fromEntries(failed), ...refused } : refused,
    source: { v: derived },
    slot: (name, at) => {
      if (!host.slots.for(name, role).length) return null;
      // @facet: customization/contributions/plugin-context
      // @facet-role: primary
      const place: PlacePublic = {
        depth: at.depth ?? 0,
        fid: at.fid ?? null,
        sid: at.sid ?? null,
        role,
        area: at.area ?? null,
      };
      return (
        <div className="t-plugin-slot" data-testid={`plugin-slot-${name}`}>
          <PluginGuard plugin={`slot ${name}`} fallback={null}>
            <Slot host={host} name={name} place={place} />
          </PluginGuard>
        </div>
      );
    },
  };
}

/** The area a `/p/<segment>` names: a plugin's first area, or an area by its own name. */
export function areaOf(host: PluginHost, segment: string): { plugin: string; area: string } | null {
  const own = host.areas.namesOf(segment)[0];
  if (own) return { plugin: segment, area: own };
  const owner = host.areas.ownerOf(segment);
  return owner ? { plugin: owner, area: segment } : null;
}

/** A plugin's area at its address. */

// @facet: customization/contributions/installed-areas
// @facet-role: primary
export function PluginAreaPlace({
  ctx,
  plugin: segment,
  rest,
  missing,
}: {
  ctx: PageContext;
  plugin: string;
  rest: string;
  missing: ReactNode;
}) {
  const plugins = ctx.plugins;
  const found = plugins ? areaOf(plugins.host, segment) : null;
  const [saved, save] = ctx.slot<{ rest: string | null; area: string; state: unknown }>(
    `p:${found?.plugin ?? segment}`,
    { rest: null, area: "", state: undefined },
  );
  if (!plugins || !found) {
    if (plugins?.loading) return <div className="t-page" aria-busy="true" />;
    const reason = plugins?.refused[segment];
    return reason ? (
      <div className="t-page">
        <p role="alert">{reason}</p>
      </div>
    ) : (
      missing
    );
  }
  const { host } = plugins;
  const place =
    saved.rest === rest && saved.area === found.area
      ? { name: found.area, state: saved.state }
      : safeCall(() => host.areas.open(found.area, rest || null), null);
  if (!place) return missing;
  const onState = (next: unknown) => {
    const address = host.areas.placeOf({ name: found.area, state: next });
    const named = typeof address === "string" && address !== rest;
    // Kept under the address it will stand at, so the redraw there finds it
    // instead of opening the area afresh from the address.
    save({ rest: named ? address : rest, area: found.area, state: next });
    if (!named) return;
    // Under the segment the address already carries: the plugin, or a further area's own name.
    const to = href({ area: "plugin", plugin: segment, rest: address });
    if (to === window.location.pathname) return;
    // Through the container, so the history's current place, the chat's
    // context and everything else reading the address follow it.
    if (ctx.replace) ctx.replace(to);
    else window.history.replaceState(window.history.state, "", to + window.location.hash);
  };
  return (
    <PluginDraw
      key={found.plugin}
      plugin={found.plugin}
      draw={() =>
        host.areas.render(place, {
          setState: onState,
          place: { depth: 0, fid: null, sid: null, role: ctx.role, area: found.area },
        })
      }
    />
  );
}

/** What a tile whose count threw shows: unmeasured, never zero. */
export const UNMEASURED: CatalogueCount = { kind: "unknown", why: "—" };

/** A tile's figure as the hub draws it: an unmeasured count is a dash, never zero. */
export function tileFigure(count: CatalogueCount): {
  count: number | null;
  finding?: string;
  unit: string;
} {
  if (count.kind === "numericValue")
    return { count: count.n, unit: count.of != null ? `/ ${count.of}` : "" };
  if (count.kind === "word") return { count: null, finding: count.text, unit: "" };
  return { count: null, finding: count.why, unit: "" };
}

/** A plugin tile's page: its list, and the entry the reader picked drawn by the
 * plugin's own detail. */

export function PluginTilePlace({ ctx, tile }: { ctx: PageContext; tile: RegisteredTile }) {
  const [s, set] = ctx.slot(`tile:${tile.id}`, { picked: null as string | null });
  const source = ctx.plugins?.source ?? { v: ctx.derived };
  const items = safeCall(() => tile.items(source), []);
  const picked = items.find((i) => i.id === s.picked) ?? null;
  return (
    <div className="t-page t-stack" style={{ gap: 16 }} data-testid={`plugin-tile-${tile.id}`}>
      <h1 className="t-h1">{tile.label}</h1>
      <p className="t-muted">{tile.desc}</p>
      {items.length ? (
        <div className="t-stack" role="list" aria-label={tile.label}>
          {items.map((i) => (
            <ListRow
              key={i.id}
              lead={<Icon name="plug" size={14} />}
              title={<span className="t-mono">{i.t}</span>}
              sub={i.s}
              trail={i.tag}
              onClick={() => set({ picked: i.id })}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          plain
          icon="plug"
          title={tile.label}
          body={tileFigure(safeCall(() => tile.count(source), UNMEASURED)).finding}
        />
      )}
      {picked ? (
        <section data-testid="plugin-tile-detail">
          <PluginDraw plugin={tile.plugin} draw={() => tile.detail(picked.raw)} />
        </section>
      ) : null}
    </div>
  );
}
