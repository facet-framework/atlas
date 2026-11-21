/** Atlas: the FACET design system surface over the registry model. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AtlasModel } from "@/model";
import { AppShell } from "@facet-tools/ui";
import { MobileTabBar, MoreSheet, NavBar, RoleMenu, TopBar, type NavItem } from "@/chrome";
import { useSurfaceText as useText, type FacetText } from "@/screens/text";
import { frame, plugins as pluginPages } from "@/screens";
import type { AdrView } from "@/screens/frame/model";
import { derive, type DerivedGlossaryGroup } from "@/derive";
import type { SourceViewSummary } from "@/chrome/source-view";
import { href, navKey, type Addressing, type Route } from "./route";
import { canBack, canForward, listing, type Place } from "./history";
import { useT, ReaderText } from "./text";
import { useAtlas } from "./useAtlas";
import { renderPage } from "./pages";
import { CRUMB_CLOSED, makeSlot, type CrumbState, type PageContext } from "./context";
import { domainViews, driftShareOf, featureViews, recordRows } from "./derive-reader";
import { contentFacts, contentKinds as contentKindsOf } from "./derive-contents";
import { usePluginsOff } from "./shared-settings";
import { testReportReader, useHostInfo, type HostReaders } from "./host";
import { ChatSurface, chatPlaceOf, useChat } from "./chat";
import { exportScreen, postScreen, screenRoot, type Screen } from "./screen";
import { usePreferences, useReducedMotion } from "./preferences";
import { Palette, resolvePick } from "./palette";
import { kindOfNavKey, navKeyOfKind, PINNABLE, pinnedNav, usePinned } from "./pinned";
import { OFFICIAL_PLUGINS } from "@/plugin/official";
import type { PluginHost } from "@/plugin/host";
import { drawnPalette } from "@/plugin/themes";
import { areaOf, useReaderPlugins } from "./plugin-host";
import { settingsPlace } from "./pages/settings";
import { offeredRole, useCloseOnOutsidePress, useReaderRole } from "./reader-role";
import { sharePercent } from "../share";

function isDecisionViews(value: unknown): value is AdrView[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as AdrView).file === "string" &&
        typeof (item as AdrView).title === "string" &&
        typeof (item as AdrView).status === "string" &&
        typeof (item as AdrView).date === "string" &&
        Array.isArray((item as AdrView).refs) &&
        (item as AdrView).refs.every((ref) => typeof ref === "string"),
    )
  );
}

/** The seven readers the Overview page is weighted for, named in the language of `tt`. */
export function rolesFor(tt: FacetText["t"]) {
  return frame.OVERVIEW_ROLE_KEYS.map((key) => ({
    key,
    name: tt(`shell.role.${key}.name`),
    purpose: tt(`shell.role.${key}.purpose`),
  }));
}

/** The navigation, named in the language of `tt`: the core's places, then one
 * entry for each bundled plugin whose area the session's host carries. */

export function navFor(tt: FacetText["t"], host?: PluginHost): NavItem[] {
  return [
    { key: "overview", label: tt("shell.nav.item.overview"), icon: "home" },
    { key: "product", label: tt("shell.nav.item.product"), icon: "buildings" },
    { key: "records", label: tt("shell.nav.item.records"), icon: "document" },
    { key: "contents", label: tt("shell.nav.item.contents"), icon: "contents" },
    { key: "glossary", label: tt("shell.nav.item.glossary"), icon: "book" },
    ...OFFICIAL_PLUGINS.flatMap((p) =>
      p.nav && (!host || host.areas.namesOf(p.id).length)
        ? [{ key: p.id, label: tt(p.nav.label), icon: p.nav.icon, plugin: true }]
        : [],
    ),
  ];
}

const PATH_OF: Record<string, string> = {
  overview: href({ area: "overview" }),
  product: href({ area: "product" }),
  records: href({ area: "records" }),
  contents: href({ area: "contents" }),
  glossary: href({ area: "glossary" }),
  ask: href({ area: "ask" }),
  settings: href({ area: "settings" }),
};

/** How a place is named in `‹ ›`'s list; fixed words are resolved when the list is drawn. */
export function placeOf(route: Route, path: string, at: number = Date.now()): Place {
  switch (route.area) {
    case "overview":
      return { path, label: "Overview", name: { id: "overview" }, kind: "overviewPage", at };
    case "product":
      return { path, label: "Product", name: { id: "product" }, kind: "area", at };
    case "records":
      return { path, label: "Records", name: { id: "records" }, kind: "area", at };
    case "domain":
      return {
        path,
        label: `Area ${route.domain}`,
        name: { id: "area", arg: route.domain },
        kind: "overview",
        at,
      };
    case "capability":
      return {
        path,
        label: `Capability ${route.capability}`,
        name: { id: "capability", arg: route.capability },
        kind: "overview",
        sub: route.domain,
        at,
      };
    case "record": {
      const parts = route.id.split("/");
      return {
        path,
        label: parts[parts.length - 1],
        kind: "record",
        sub: parts.slice(0, -1).join("/"),
        at,
      };
    }
    case "contents":
      return {
        path,
        label: route.kind ? `Contents · ${route.kind}` : "Contents",
        name: { id: "contents", arg: route.kind },
        kind: "content",
        at,
      };
    case "glossary":
      return route.term
        ? { path, label: route.term, kind: "content", at }
        : { path, label: "Glossary", name: { id: "glossary" }, kind: "content", at };
    case "settings":
      return {
        path,
        label: "Settings",
        name: { id: "settings" },
        kind: "settings",
        sub: route.section,
        at,
      };
    case "plugin":
      return { path, label: route.plugin, kind: "plugin", sub: route.rest || undefined, at };
    case "ask":
      return { path, label: "Ask Atlas", name: { id: "ask" }, kind: "content", at };
    case "unknown":
      return { path, label: path, kind: "overviewPage", at };
  }
}

export type AtlasProps = {
  model: AtlasModel;
  glossaryGroups?: DerivedGlossaryGroup[];
  pluginSections?: Readonly<Record<string, unknown>>;
  /** Host readers; `null` asks nothing (tests). */
  readers?: HostReaders | null;
  /** The chat stream; tests pass a fake, the reader uses `EventSource`. */
  openStream?: Parameters<typeof useChat>[0]["open"];
  /** Hands the page's content to the host before a question and returns its
   * id. The reader posts to the host; with a fake stream (tests) there is no
   * host to post to, so none is sent unless a test passes its own. */

  sendScreen?: (shot: Screen) => Promise<string | null>;

  /** The named source view the corpus was resolved through, as the host sent it. */
  sourceView?: SourceViewSummary;
  /** Read the repository again; absent where nothing can reread it (tests, a snapshot). */
  onReread?: () => void;
  /** Where the reader keeps its address: the path (default) or the fragment. */
  addressing?: Addressing;
};

/** True when a key goes into a text field rather than to the reader's shortcuts. */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}

/** ⌥← / ⌥→ (Alt+arrow) step through `‹ ›` like the arrows do; inside a text
 * field they stay the field's own word jumps. */

export function historyKey(e: KeyboardEvent): "back" | "forward" | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typing(e.target)) return null;
  if (e.key === "ArrowLeft") return "back";
  if (e.key === "ArrowRight") return "forward";
  return null;
}

function copyText(text: string) {
  try {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  } catch {
    /** no clipboard in this context */
  }
}

/** Atlas in the Atlas language: Atlas speaks it, and a language change redraws the surface. */

// @facet: workspace/navigation/shell
// @facet-role: primary
export default function Atlas(props: AtlasProps) {
  return (
    <ReaderText>
      <AtlasSurface {...props} />
    </ReaderText>
  );
}

/** The shell around every place. At phone width the tab bar, the compact top
 * bar and the More sheet together reach everything the desktop bars offer.
 * The AppShell it draws carries the document's tooltip, so every `title` in
 * the reader reaches the keyboard; while the palette is open the shell is modal. */

// @facet: customization/contributions/plugin-slot-glow
// @facet-role: primary
// @facet: workspace/controls/tooltip
// @facet-role: primary
// @facet: workspace/navigation/path-bar
// @facet-role: primary
// @facet: workspace/navigation/mobile
// @facet-role: primary
// @facet: workspace/navigation/top-bar
// @facet-role: primary
function AtlasSurface({
  model,
  glossaryGroups,
  pluginSections,
  readers,
  openStream,
  sendScreen,
  sourceView,
  onReread,
  addressing,
}: AtlasProps) {
  const derived = useMemo(() => derive(model, glossaryGroups), [model, glossaryGroups]);
  const features = useMemo(() => featureViews(model, derived), [model, derived]);
  const domains = useMemo(() => domainViews(model), [model]);
  const rows = useMemo(() => recordRows(features), [features]);
  const { t, language } = useT();
  const { t: tt } = useText();
  // The catalogue's kinds by name, for the palette to find them.
  const contentKinds = useMemo(
    () =>
      contentKindsOf(contentFacts(model, derived), t, tt).map((k) => ({
        key: k.key,
        label: k.label,
      })),
    [model, derived, t, tt],
  );
  const place = useCallback((route: Route, path: string) => placeOf(route, path), []);
  const app = useAtlas(place, addressing);
  const { density } = usePreferences();
  const reducedMotion = useReducedMotion();
  const roles = useMemo(() => rolesFor(tt), [tt]);
  const { pinned, pin } = usePinned(PINNABLE);
  const [chosenRole, setRole] = useReaderRole();
  // Plugin verbs lead through the container's own `go`, defined further down.
  const goLater = useRef<(to: string) => void>(() => undefined);
  const pluginsOff = usePluginsOff();
  const plugins = useReaderPlugins({
    sections: pluginSections,
    derived,
    language,
    role: chosenRole,
    targets: { go: (to) => goLater.current(to), setRole },
    off: pluginsOff,
  });
  const pluginHost = plugins.host;
  // The palette drawn: a plugin's theme only while a loaded plugin contributes
  // it, FACET otherwise; the stored choice stays, so it returns with the plugin.

  const drawn = drawnPalette(app.theme.theme, (id) => pluginHost.themes.has(id));
  const shownTheme = useMemo(() => ({ ...app.theme, theme: drawn }), [app.theme, drawn]);
  // Pinned content kinds follow the glossary, before the plugin areas.
  const nav = useMemo(() => {
    const base = navFor(tt, pluginHost);
    const at = base.findIndex((n) => n.key === "glossary") + 1;
    return [...base.slice(0, at), ...pinnedNav(pinned, tt), ...base.slice(at)];
  }, [tt, pinned, pluginHost]);
  const { info: host } = useHostInfo(readers);
  // One reader identity per readers object, or the bench's interval restarts on every render.
  const reportReader = useMemo(() => testReportReader(readers), [readers]);
  // What the chat may tell the agent the reader has open. A chip the reader
  // removed stays removed on this page and comes back on the next one.
  const chatPlace = useMemo(() => chatPlaceOf(app.route, tt), [app.route, tt]);
  const [removed, setRemoved] = useState<{ path: string; keys: string[] }>({
    path: "",
    keys: [],
  });
  const chatContext = chatPlace.context.filter(
    (c) => removed.path !== app.path || !removed.keys.includes(c.key),
  );
  // The page as the reader sees it when they send, read from the live shell.
  // It goes with the context chip: where no chip is shown (the full chat) or
  // the reader removed it, the page is not sent either.
  const appPath = app.path;
  const withPage = chatContext.length > 0;
  const screen = useCallback(
    () => (withPage ? { markdown: exportScreen(screenRoot()), page: appPath } : null),
    [appPath, withPage],
  );
  const chat = useChat({
    derived,
    agent: host.agent,
    open: openStream,
    context: chatContext.map((c) => c.key),
    screen,
    postScreen: sendScreen ?? (openStream ? undefined : postScreen),
    modes: pluginHost.chatModes.list(),
  });
  const [menu, setMenu] = useState<null | "history" | "role" | "more" | "palette">(null);
  const [ui, setUi] = useState<Record<string, object>>({});
  // The open breadcrumb list of each place, by path. A visit forgets the
  // target's list, so it opens closed; `‹ ›`, the history list and the
  // browser's own back and forward go through `app` and find it as it was.
  const [crumbAt, setCrumbAt] = useState<Record<string, CrumbState>>({});
  const appGo = app.go;
  const go = useCallback(
    (to: string) => {
      setCrumbAt((c) => {
        if (!(to in c)) return c;
        const next = { ...c };
        delete next[to];
        return next;
      });
      appGo(to);
    },
    [appGo],
  );
  useEffect(() => {
    goLater.current = go;
  }, [go]);
  const crumbHere = crumbAt[app.path] ?? CRUMB_CLOSED;
  const setCrumbHere = (patch: Partial<CrumbState>) =>
    setCrumbAt((c) => ({ ...c, [app.path]: { ...(c[app.path] ?? CRUMB_CLOSED), ...patch } }));
  const crumb: PageContext["crumb"] = {
    ...crumbHere,
    toggle: (key) => setCrumbHere(crumbHere.open === key ? CRUMB_CLOSED : { open: key, query: "" }),
    setQuery: (query) => setCrumbHere({ query }),
    close: () => setCrumbHere(CRUMB_CLOSED),
  };
  const toggle = (m: "history" | "role" | "more" | "palette") =>
    setMenu((open) => (open === m ? null : m));
  const closeRole = useCallback(() => setMenu((open) => (open === "role" ? null : open)), []);
  useCloseOnOutsidePress(menu === "role", closeRole);
  const pick = (key: string) => {
    setMenu(null);
    if (key === "ask") {
      chat.setSize("full");
      return;
    }
    const kind = kindOfNavKey(key);
    if (kind) return go(href({ area: "contents", kind }));
    go(PATH_OF[key] ?? href({ area: "plugin", plugin: key, rest: "" }));
  };

  // Atlas scrolls the document; the mark releases the window-high page (globals.css).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.atlas = "reader";
    return () => {
      delete root.dataset.atlas;
    };
  }, []);

  // The palette on the root, as theme-init.js put it there before the first
  // paint: a choice made now holds for the boot screen of the next visit too.
  const { theme: palette, mode } = shownTheme;
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-t-theme", palette);
    root.setAttribute("data-t-mode", mode);
  }, [palette, mode]);

  // Ctrl K / Cmd K opens the palette, Esc closes what is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMenu((m) => (m === "palette" ? null : "palette"));
      } else if (e.key === "Escape") {
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // "/" outside a field opens the chat with the command list, as typing a
  // slash into its field does.

  const { setDraft, setSize: sizeChat } = chat;
  const chatSize = chat.size;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable)
        return;
      e.preventDefault();
      setMenu(null);
      setDraft("/");
      if (chatSize === "pill") sizeChat("dock");
      // The field exists once the dock has drawn.
      setTimeout(() => {
        const field = document.querySelector<HTMLTextAreaElement>(
          pluginPages.COMPOSER_FIELD_SELECTOR,
        );
        field?.focus();
        field?.setSelectionRange(1, 1);
      }, 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setDraft, sizeChat, chatSize]);

  const { back: stepBack, forward: stepForward } = app;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = historyKey(e);
      if (!step) return;
      e.preventDefault();
      if (step === "back") stepBack();
      else stepForward();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepBack, stepForward]);

  // The chat's own address opens it full size.
  const onAsk = app.route.area === "ask";
  const { setSize } = chat;
  useEffect(() => {
    if (onAsk) setSize("full");
  }, [onAsk, setSize]);

  const slot = useMemo(() => makeSlot(ui, setUi), [ui]);
  const proven = sharePercent(model.scnProven, model.scnTotal);
  const current = navKey(app.route);
  // A pinned kind's page lights its own entry rather than Contents.
  const navCurrent =
    app.route.area === "contents" && app.route.kind && pinned.includes(app.route.kind)
      ? navKeyOfKind(app.route.kind)
      : current;
  const darkNext = app.theme.mode === "light";
  // The plugins' roles stand after the core's own seven.

  const allRoles = [
    ...roles,
    ...pluginHost.roles.list().map((r) => ({ key: r.id, name: r.label, purpose: r.purpose })),
  ];
  const role = offeredRole(chosenRole, allRoles);
  const roleName = allRoles.find((r) => r.key === role)?.name ?? role;
  // The area the reader is in, for a slot's place; null outside a plugin.
  const areaHere =
    app.route.area === "plugin" ? (areaOf(pluginHost, app.route.plugin)?.area ?? null) : null;
  const actions = plugins.slot("header.action", { area: areaHere });
  // A plugin's settings page nobody has opened yet puts a dot on the gear.

  const settingsFresh = pluginHost.settings
    .list()
    .some((p) => pluginHost.seen.isNew(settingsPlace(p)));
  // The logo's offset is the share of records with drift; no comparison is not measured.
  const driftShare = useMemo(() => driftShareOf(model, features.length), [model, features]);

  const ctx: PageContext = {
    model,
    derived,
    features,
    domains,
    rows,
    role,
    t,
    language,
    go,
    replace: app.replace,
    back: app.back,
    mobile: app.mobile,
    slot,
    crumb,
    overview: {
      project: { name: host.repo?.name, branch: host.repo?.branch, commit: host.repo?.commit },
      history: host.repo?.history,
      historyWindow: host.repo?.historyWindow,
      historyExhausted: host.repo?.historyExhausted,
      historyTruncated: host.repo?.historyTruncated,
      shallow: host.repo?.shallow,
      decisions: pluginHost.publishedValue("decisions", isDecisionViews) ?? [],
      tools: host.tools,
    },
    theme: shownTheme,
    setTheme: app.setTheme,
    focus: app.focus,
    setFocus: app.setFocus,
    ask: (q) => {
      if (q) chat.ask(q);
      else chat.setSize("dock");
    },
    openPalette: () => setMenu("palette"),
    copy: copyText,
    pinned,
    pin,
    readTestReport: reportReader,
    plugins,
    reread: onReread,
  };

  const command = (c: string) => {
    switch (c) {
      case "theme":
        return app.setTheme({ ...app.theme, mode: darkNext ? "dark" : "light" });
      case "palette":
        return app.setTheme({
          ...app.theme,
          theme: app.theme.theme === "facet" ? "paper" : "facet",
        });
      case "chat":
        return chat.setSize("dock");
      case "clear-history":
        return app.clear();
    }
  };

  return (
    <AppShell
      mobile={app.mobile}
      // The design system's type names its own two palettes; a plugin's theme
      // is a further value its adopted stylesheet answers.
      theme={shownTheme as { theme: "facet" | "paper"; mode: typeof shownTheme.mode }}
      focus={app.focus}
      density={density}
      reducedMotion={reducedMotion}
      // The palette is modal: the bars, the page and the chat are inert behind it.
      modal={menu === "palette"}
      top={
        <TopBar
          compact={app.mobile}
          canBack={canBack(app.history)}
          canForward={canForward(app.history)}
          historyOpen={menu === "history"}
          history={{
            entries: listing(app.history, t),
            onPick: (key) => {
              setMenu(null);
              app.jump(Number(key));
            },
            onClear: app.clear,
          }}
          stats={{
            features: model.features.length,
            provenPct: proven,
            drift: driftShare == null ? null : (model.scan.drift ?? []).length,
            driftShare,
          }}
          actions={actions ?? undefined}
          roleName={roleName}
          roleOpen={menu === "role"}
          roleMenu={
            <RoleMenu
              roles={allRoles}
              current={role}
              onPick={(k) => {
                setRole(k);
                setMenu(null);
              }}
            />
          }
          theme={
            darkNext
              ? { label: tt("shell.theme.dark"), icon: "moon" }
              : { label: tt("shell.theme.light"), icon: "sun" }
          }
          onBack={app.back}
          onForward={app.forward}
          onHistory={() => toggle("history")}
          onCommand={() => toggle("palette")}
          onRole={() => toggle("role")}
          onTheme={() => app.setTheme({ ...app.theme, mode: darkNext ? "dark" : "light" })}
          onSettings={() => pick("settings")}
          settingsFresh={settingsFresh}
          onHome={() => pick("overview")}
          onMenu={() => toggle("more")}
        />
      }
      nav={
        <NavBar items={nav.map((n) => ({ ...n, current: n.key === navCurrent }))} onPick={pick} />
      }
      tabbar={
        <MobileTabBar
          onPick={(k) => (k === "more" ? toggle("more") : pick(k))}
          items={[
            { key: "overview", label: nav[0].label, icon: "home", current: current === "overview" },
            {
              key: "product",
              label: nav[1].label,
              icon: "buildings",
              current: current === "product",
            },
            {
              key: "records",
              label: nav[2].label,
              icon: "document",
              current: current === "records",
            },
            {
              key: "ask",
              label: tt("shell.tab.ask"),
              icon: "chat",
              current: chat.size === "full",
            },
            {
              key: "more",
              label: tt("shell.tab.more"),
              icon: "menu",
              current: !["overview", "product", "records", "ask"].includes(current),
            },
          ]}
        />
      }
      overlay={
        <>
          {/** The compact top bar drops role, theme and settings; on a phone the
           *               sheet is the only way to reach them, so it carries all three. */}
          <MoreSheet
            open={menu === "more"}
            items={nav}
            roleName={roleName}
            roles={allRoles}
            currentRole={role}
            actions={actions ?? undefined}
            theme={
              darkNext
                ? { label: tt("shell.theme.dark"), icon: "moon" }
                : { label: tt("shell.theme.light"), icon: "sun" }
            }
            onPick={pick}
            onRole={(k) => {
              setRole(k);
              setMenu(null);
            }}
            onTheme={() => app.setTheme({ ...app.theme, mode: darkNext ? "dark" : "light" })}
            onSettings={() => pick("settings")}
            settingsFresh={settingsFresh}
            onClose={() => setMenu(null)}
          />
          <Palette
            open={menu === "palette"}
            model={model}
            domains={domains}
            recent={app.history.places.slice(-8).reverse()}
            sources={pluginHost.search.list()}
            mobile={app.mobile}
            onClose={() => setMenu(null)}
            onAsk={(q) => {
              setMenu(null);
              if (q) chat.ask(q);
              else chat.setSize("dock");
            }}
            contentKinds={contentKinds}
            onPick={(key) => {
              setMenu(null);
              const r = resolvePick(key);
              if (!r) return;
              if ("go" in r) go(r.go);
              else if ("role" in r) setRole(r.role);
              else command(r.command);
            }}
          />
        </>
      }
      chat={
        <ChatSurface
          chat={chat}
          agent={host.agent}
          mobile={app.mobile}
          roleName={roleName}
          context={chatContext}
          starters={chatPlace.starters}
          plugins={{
            commands: pluginHost.commands.list(),
            modes: pluginHost.chatModes.list(),
          }}
          onRemoveContext={(key) =>
            setRemoved((r) => ({
              path: app.path,
              keys: r.path === app.path ? [...r.keys, key] : [key],
            }))
          }
          onSource={(s) => {
            if (s.kind === "record") go(href({ area: "record", id: s.ref }));
          }}
        />
      }
    >
      {renderPage(app.route, ctx, {
        host,
        history: { count: app.history.places.length, clear: app.clear },
        path: app.path,
        sourceView,
      })}
    </AppShell>
  );
}
