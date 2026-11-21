/** The command palette (Ctrl K): records, domains and capabilities, places,
 * roles and commands, matched against one query. `/` narrows to commands,
 * `#` to ids, `?` turns the query into a question for Atlas. */

import { useEffect, useRef, useState } from "react";
import { useSurfaceText as useText, type FacetText } from "@/screens/text";
import { contents, frame, plugins } from "@/screens";
import type { AtlasModel } from "@/model";
import { short } from "@/derive";
import type { DomainView } from "./derive-reader";
import { listedRecords } from "./derive-reader";
import { href } from "./route";
import { placeLabel, type Place } from "./history";
import { useT, type T } from "./text";
import type { RegisteredSearchSource } from "@/plugin/search";
import { safeCall } from "./plugin-guard";
import { searchSections } from "./pages/settings";

/** The palette's groups from the search sources plugins contributed: each
 * source one group, its hits filtered by the query, a pick running the hit's
 * own action. */

export function pluginGroups(
  query: string,
  sources: readonly RegisteredSearchSource[],
): { groups: plugins.PaletteGroup[]; picks: Map<string, () => void> } {
  const picks = new Map<string, () => void>();
  const groups: plugins.PaletteGroup[] = [];
  // A command (/), a question (?) or an id (#) is not a plugin's to answer.
  if (/^[/?#]/.test(query)) return { groups, picks };
  const q = query.trim().toLowerCase();
  for (const source of sources) {
    // A source that throws, or a hit without the text the palette reads,
    // costs that source's group or that hit, not the palette.
    const hits = safeCall(() => source.hits() ?? [], []).filter(
      (h) =>
        !!h &&
        typeof h.title === "string" &&
        (!q ||
          h.title.toLowerCase().includes(q) ||
          (typeof h.sub === "string" && h.sub.toLowerCase().includes(q))),
    );
    if (!hits.length) continue;
    const items = hits.slice(0, LIMIT).map((h, i) => {
      const key = `plugin:${source.kind}:${i}`;
      // Running the hit is the plugin's code too: a throw stays its own.
      picks.set(key, () => safeCall(() => h.open(), undefined));
      return { key, icon: "plug" as const, glyph: source.glyph, title: h.title, sub: h.sub ?? "" };
    });
    groups.push({
      key: `plugin:${source.kind}`,
      label: source.label,
      kind: source.singular,
      total: hits.length,
      items,
    });
  }
  return { groups, picks };
}

const LIMIT = 6;

type Icon = plugins.PaletteItem["icon"];
type UiT = FacetText["t"];

const placesFor = (tt: UiT): { key: string; title: string; icon: Icon }[] => [
  { key: href({ area: "overview" }), title: tt("shell.nav.item.overview"), icon: "home" },
  { key: href({ area: "product" }), title: tt("shell.nav.item.product"), icon: "buildings" },
  { key: href({ area: "records" }), title: tt("shell.nav.item.records"), icon: "document" },
  { key: href({ area: "contents" }), title: tt("shell.nav.item.contents"), icon: "contents" },
  { key: href({ area: "glossary" }), title: tt("shell.nav.item.glossary"), icon: "book" },
  { key: href({ area: "settings" }), title: tt("shell.top.settings"), icon: "settings" },
];

export const commandsFor = (t: T): { key: string; title: string; icon: Icon }[] => [
  { key: "theme", title: t("ui.reader.palette-switch-between-light-dark"), icon: "theme" },
  { key: "palette", title: t("ui.reader.palette-switch-palette-facet-paper"), icon: "theme" },
  { key: "chat", title: t("ui.reader.palette-open-ask-atlas"), icon: "chat" },
  { key: "clear-history", title: t("ui.reader.palette-clear-history"), icon: "history" },
];

const has = (text: string, q: string) => text.toLowerCase().includes(q);

/** What the palette finds beyond the model: the named content kinds of the catalogue. */
export type PaletteExtras = {
  contentKinds?: readonly { key: string; label: string }[];
};

/** The first line of a summary, cut to fit a row's second line. */
const firstLine = (text: string) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 96 ? `${line.slice(0, 95)}…` : line;
};

/** The kinds the palette finds once something is typed, beyond records, areas,
 * places, roles and commands: where an id stands in the code, what no record
 * describes, glossary terms, content kinds and settings pages. Each is its
 * own group, so a hit also says what kind of thing it is. */

function lookupGroups(
  q: string,
  model: AtlasModel,
  t: T,
  tt: UiT,
  extras: PaletteExtras,
): [string, string, plugins.PaletteItem[]][] {
  const anchors = model.anchorPairs
    .filter((a) => has(a.path, q) || has(a.id, q) || has(a.excerpt ?? "", q))
    .map((a) => ({
      key: `anc:${a.id}:${a.path}:${a.line}`,
      icon: "anchor" as const,
      title: `${a.path}:${a.line}`,
      sub: a.id,
      mono: true,
    }));
  const orphans = (model.scan.orphanAnchors ?? [])
    .filter((o) => has(o.path, q) || has(o.id, q))
    .map((o) => ({
      key: `orphan:${o.path}:${o.line}:${o.id}`,
      icon: "warning" as const,
      title: `${o.path}:${o.line}`,
      sub: t("ui.reader.palette-anchor-without-record-id", { id: o.id }),
      mono: true,
    }));
  const files = (model.scan.unanchoredFiles ?? [])
    .filter((f) => has(f.path, q))
    .map((f) => ({
      key: `file:${f.path}`,
      icon: "file" as const,
      title: f.path,
      sub: t("ui.reader.palette-file-without-record"),
      mono: true,
    }));
  const terms = (model.glossary?.terms ?? [])
    .filter((g) => has(g.term, q) || has(g.definition, q))
    .map((g) => ({
      key: `term:${g.term}`,
      icon: "book" as const,
      title: g.term,
      sub: firstLine(g.definition),
    }));
  const kinds = (extras.contentKinds ?? [])
    .filter((k) => has(k.label, q) || has(k.key, q))
    .map((k) => ({ key: `kind:${k.key}`, icon: "contents" as const, title: k.label }));
  const sections = (searchSections(q, tt) ?? []).map((key) => ({
    key: `set:${key}`,
    icon: "settings" as const,
    title:
      contents.sectionLabel(
        contents.SETTINGS_SECTIONS.find((s) => s.key === key),
        tt,
      ) ?? key,
  }));
  return [
    ["anchors", t("ui.reader.palette-anchors"), anchors],
    ["unrecorded", t("ui.reader.palette-without-record"), [...orphans, ...files]],
    ["terms", t("ui.reader.palette-glossary"), terms],
    ["kinds", t("ui.reader.palette-contents"), kinds],
    ["settings", t("ui.reader.palette-settings"), sections],
  ];
}

/** Groups and their hits for one query. `limit` caps the rows each group lists;
 * its `total` still counts every hit. */

export function paletteGroups(
  query: string,
  model: AtlasModel,
  domains: DomainView[],
  recent: Place[],
  t: T,
  tt: UiT,
  extras: PaletteExtras = {},
  limit: number = LIMIT,
): { groups: plugins.PaletteGroup[]; total: number } {
  const prefix = query.charAt(0);
  const q = query
    .replace(/^[/?#]/, "")
    .trim()
    .toLowerCase();
  if (prefix === "?") return { groups: [], total: 0 };
  const groups: plugins.PaletteGroup[] = [];
  const push = (key: string, label: string, items: plugins.PaletteItem[]) => {
    if (items.length)
      groups.push({ key, label, kind: label, total: items.length, items: items.slice(0, limit) });
  };
  if (prefix !== "/") {
    push(
      "records",
      t("ui.reader.palette-records"),
      listedRecords(model)
        .filter((r) => !q || has(r.id, q) || (prefix !== "#" && has(r.summary, q)))
        .map((r) => ({
          key: `rec:${r.id}`,
          icon: "document",
          title: short(r.id),
          // A hit found by its summary shows the summary, so the row says why it is there.
          sub: q && !has(r.id, q) ? firstLine(r.summary) : r.id,
          mono: true,
          // Promises with a declared test, of all: a claim, not a run.
          badge: r.scenarios.length
            ? t("ui.reader.palette-proven-total-test", {
                proven: r.proven,
                total: r.scenarios.length,
              })
            : undefined,
        })),
    );
  }
  if (prefix === "#") return { groups, total: groups.reduce((a, g) => a + (g.total ?? 0), 0) };
  if (q && prefix !== "/")
    for (const [key, label, items] of lookupGroups(q, model, t, tt, extras))
      push(key, label, items);
  if (prefix !== "/") {
    const areas: plugins.PaletteItem[] = [];
    for (const d of domains) {
      if (!q || has(d.id, q) || has(d.title, q))
        areas.push({ key: `dom:${d.id}`, icon: "buildings", title: d.title, sub: d.id });
      for (const c of d.capabilities)
        if (!q || has(c.id, q) || has(c.title, q))
          areas.push({
            key: `cap:${d.id}/${c.id}`,
            icon: "layers",
            title: c.title,
            sub: `${d.id}/${c.id}`,
          });
    }
    push("areas", t("ui.reader.palette-areas-capabilities"), areas);
    push(
      "places",
      t("ui.reader.palette-go"),
      placesFor(tt)
        .filter((p) => !q || has(p.title, q))
        .map((p) => ({
          key: `go:${p.key}`,
          icon: p.icon,
          title: p.title,
        })),
    );
    push(
      "roles",
      t("ui.reader.palette-roles"),
      frame.OVERVIEW_ROLE_KEYS.map((key) => ({
        key,
        name: tt(`shell.role.${key}.name`),
        purpose: tt(`shell.role.${key}.purpose`),
      }))
        .filter((r) => !q || has(r.name, q))
        .map((r) => ({
          key: `role:${r.key}`,
          icon: "person",
          title: r.name,
          sub: r.purpose,
        })),
    );
  }
  push(
    "commands",
    t("ui.reader.palette-commands"),
    commandsFor(t)
      .filter((c) => !q || has(c.title, q))
      .map((c) => ({
        key: `cmd:${c.key}`,
        icon: c.icon,
        title: c.title,
      })),
  );
  if (!q && prefix !== "/")
    push(
      "recent",
      t("ui.reader.palette-recently-visited"),
      recent.map((p) => ({
        key: `go:${p.path}`,
        icon: "history",
        title: placeLabel(p, t),
        sub: tt(`shell.history.kind.${p.kind}`),
      })),
    );
  return { groups, total: groups.reduce((a, g) => a + (g.total ?? 0), 0) };
}

/** Where a picked key leads: a path, or a command / role for the container. */
export function resolvePick(
  key: string,
): { go: string } | { command: string } | { role: string } | null {
  const i = key.indexOf(":");
  const kind = key.slice(0, i);
  const rest = key.slice(i + 1);
  switch (kind) {
    case "rec":
      return { go: href({ area: "record", id: rest }) };
    case "anc":
      // `anc:<record id>:<path>:<line>`; a record id carries no colon.
      return { go: href({ area: "record", id: rest.split(":")[0] }) };
    case "orphan":
      return { go: href({ area: "contents", kind: "anchor" }) };
    case "file":
      return { go: href({ area: "contents", kind: "files" }) };
    case "term":
      return { go: href({ area: "glossary", term: rest }) };
    case "kind":
      return { go: href({ area: "contents", kind: rest }) };
    case "set":
      return { go: href({ area: "settings", section: rest }) };
    case "dom":
      return { go: href({ area: "domain", domain: rest }) };
    case "cap": {
      const [domain, capability] = rest.split("/");
      return { go: href({ area: "capability", domain, capability }) };
    }
    case "go":
      return { go: rest };
    case "cmd":
      return { command: rest };
    case "role":
      return { role: rest };
    default:
      return null;
  }
}

/** Rows a narrowed kind lists at first, and adds each time the list is scrolled to its end. */
export const PAGE = 25;

/** The next kind Tab (or Shift-Tab) narrows to: all kinds, then each in turn, in a ring. */
export function nextKind(kinds: readonly string[], current: string | null, backwards: boolean) {
  const ring: (string | null)[] = [null, ...kinds];
  const at = Math.max(0, ring.indexOf(current));
  const step = backwards ? ring.length - 1 : 1;
  return ring[(at + step) % ring.length];
}

/** The palette. A chosen kind (Tab, Shift-Tab, or a group's "show all") lists
 * only that kind, whole, loading on as the list is scrolled to its end; the
 * query stays. The arrow keys walk the hits in a ring. */

// @facet: workspace/navigation/visible-depth
// @facet-role: primary
// @facet: workspace/search/palette
// @facet-role: primary
export function Palette({
  open,
  model,
  domains,
  recent,
  mobile,
  onPick,
  onAsk,
  onShowAll,
  onClose,
  sources = [],
  contentKinds,
}: {
  /** The search sources plugins contributed. */
  sources?: readonly RegisteredSearchSource[];
  /** The catalogue's content kinds, by key and name. */
  contentKinds?: PaletteExtras["contentKinds"];
  open: boolean;
  model: AtlasModel;
  domains: DomainView[];
  recent: Place[];
  mobile: boolean;
  onPick: (key: string) => void;
  onAsk: (q: string) => void;
  /** Told which group the reader narrowed to through its "show all". */
  onShowAll?: (group: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const { t: tt } = useText();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [kind, setKind] = useState<{ key: string; label: string } | null>(null);
  const [shown, setShown] = useState(PAGE);
  const box = useRef<HTMLDivElement>(null);
  // The palette is a pure view; focusing its field on open is the container's job.
  useEffect(() => {
    if (open) box.current?.querySelector("input")?.focus();
  }, [open]);
  const extras = { contentKinds };
  const core = paletteGroups(query, model, domains, recent, t, tt, extras);
  const contributed = pluginGroups(query, sources);
  const all = [...core.groups, ...contributed.groups];
  // Narrowed, the chosen kind lists `shown` rows of all its hits.
  const narrowed = kind
    ? (paletteGroups(query, model, domains, recent, t, tt, extras, shown).groups.find(
        (g) => g.key === kind.key,
      ) ?? contributed.groups.find((g) => g.key === kind.key))
    : null;
  const groups: plugins.PaletteGroup[] = kind
    ? [
        narrowed
          ? { ...narrowed, label: t("ui.reader.palette-only-kind", { kind: kind.label }) }
          : // An empty result in a chosen kind names the kind.
            {
              key: kind.key,
              label: t("ui.reader.palette-nothing-found-kind", { kind: kind.label }),
              total: 0,
              items: [],
            },
      ]
    : all;
  const total = groups.reduce((a, g) => a + (g.total ?? 0), 0);
  // A plugin's hit runs its own action; every other key goes to the container.
  const pick = (key: string) => {
    const run = contributed.picks.get(key);
    if (!run) return onPick(key);
    onClose();
    run();
  };
  const keys = groups.flatMap((g) => g.items.map((i) => i.key));
  const activeKey = keys[Math.min(active, keys.length - 1)] ?? null;
  const narrow = (key: string | null) => {
    const label = all.find((g) => g.key === key)?.label;
    setKind(key && label ? { key, label } : null);
    setShown(PAGE);
    setActive(0);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const n = keys.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (n ? (Math.min(a, n - 1) + 1) % n : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (n ? (Math.min(a, n - 1) - 1 + n) % n : 0));
      } else if (e.key === "Tab") {
        e.preventDefault();
        narrow(
          nextKind(
            all.map((g) => g.key),
            kind?.key ?? null,
            e.shiftKey,
          ),
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (query.startsWith("?")) onAsk(query.slice(1).trim());
        else if (activeKey) pick(activeKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Narrowed, the list loads on when the reader scrolls to its end.
  const more = !!narrowed && narrowed.items.length < (narrowed.total ?? 0);
  useEffect(() => {
    if (!open || !more) return;
    const list = box.current?.querySelector<HTMLElement>('[role="listbox"]');
    if (!list) return;
    const onScroll = () => {
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 48) setShown((s) => s + PAGE);
    };
    list.addEventListener("scroll", onScroll);
    return () => list.removeEventListener("scroll", onScroll);
  }, [open, more]);

  if (!open) return null;
  return (
    <div ref={box} style={{ display: "contents" }} data-kind={kind?.key}>
      <plugins.CommandPalette
        query={query}
        groups={groups}
        activeKey={activeKey}
        total={total}
        mobile={mobile}
        onQuery={(q) => {
          setQuery(q);
          setActive(0);
          setShown(PAGE);
        }}
        onSelect={pick}
        onShowAll={(group) => {
          narrow(group);
          onShowAll?.(group);
        }}
        onAsk={onAsk}
        onClose={onClose}
      />
    </div>
  );
}
