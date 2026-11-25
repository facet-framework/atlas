/** Settings share browser state — palette and mode on the container's theme, language on the shared
 * i18n choice, history on the `‹ ›` store, Atlas AI on the companion state.
 * Generative UI uses shared browser settings.
 * Density, motion, the history limit, restoring the last place and keeping
 * chat sessions act on this reader's own choices (`preferences`), which the
 * shell, the history and the chat read.
 * Sections without a source in this reader say so instead of showing values. */

import { PluginDraw } from "../plugin-guard";
import { useEffect, useState } from "react";
import { EmptyState, Select, Switch } from "@facet-tools/ui";

import { useSurfaceText as useText, type FacetText } from "@/screens/text";
import { contents } from "@/screens";
import i18n, { addCustomLanguage, customLanguages } from "@/i18n";
import { OFFICIAL_PLUGINS } from "@/plugin/official";
import { ROLE_LIST } from "@/roles";
import { STORAGE_KEY } from "@/state";
import { GEN_STORAGE_KEY } from "@/generative/storage";
import { SEEN_KEY, placeKey } from "@/plugin/seen";
import type { PageContext } from "../context";
import type { T } from "../text";
import { FOCUS_KEY, THEME_KEY } from "../useAtlas";
import type { HostInfo } from "../host";
import type { SourceViewSummary } from "@/chrome/source-view";
import { SourceViewSection } from "@/chrome/source-view-section";
import { modelLabel, modelName } from "../chat";
import { href } from "../route";
import { HISTORY_KEY } from "../history";
import { forgetSessions } from "../chat";
import { reloadDocument } from "../reload";
import {
  CITY_HEIGHTS,
  CITY_LABELS,
  HISTORY_LIMIT_MAX,
  HISTORY_LIMIT_MIN,
  PREFERENCES_KEY,
  parseHistoryLimit,
  usePreferences,
  writePreferences,
  type Preferences,
} from "../preferences";
import {
  readShared,
  saveShared,
  withRole,
  type SharedSettings,
  type SharedWriteRefusal,
} from "../shared-settings";

type Section = contents.SettingsSectionKey;

/** The address prefix of a plugin's settings page: `/settings/plugin-<id>`. */

export const PLUGIN_SECTION = "plugin-";

/** The place key a plugin's settings page is remembered under once seen, the
 * key `<plugin>:settings.<page id>`. */

export function settingsPlace(page: { plugin: string; id: string }): string {
  return placeKey(page.plugin, `settings.${page.id}`);
}
const KEYS = contents.SETTINGS_SECTIONS.map((s) => s.key);

export function isSection(s: string | undefined): s is Section {
  return !!s && (KEYS as string[]).includes(s);
}

/** Sections whose label, subtitle or search words contain the query; `null`
 * without a query. The words are what a reader would type for a section
 * rather than its title — for the plugins, the names of the plugins. */

export function searchSections(
  query: string,
  tt: FacetText["t"],
  words: Partial<Record<Section, readonly string[]>> = {},
): Section[] | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return contents.SETTINGS_SECTIONS.filter(
    (s) =>
      (contents.sectionLabel(s, tt) ?? "").toLowerCase().includes(q) ||
      tt(s.sub).toLowerCase().includes(q) ||
      (words[s.key] ?? []).some((w) => w.toLowerCase().includes(q)),
  ).map((s) => s.key);
}

type StoredKind = {
  label: string;
  /** What is in the key now, counted from the stored value; absent when it cannot be read. */
  contents?: (v: unknown, raw: string) => string | undefined;
};

const lengthOf = (v: unknown): number | undefined =>
  Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : undefined;

/** The keys this reader writes, and what each one holds. */
function storedKinds(t: T): Record<string, StoredKind> {
  const count = (key: string) => (n: number | undefined) =>
    n == null ? undefined : t(key, { count: n });
  return {
    [HISTORY_KEY]: {
      label: t("ui.reader-pages.settings-history-places"),
      contents: (v) =>
        count("ui.reader-pages.settings-count-places")(
          lengthOf((v as { places?: unknown })?.places),
        ),
    },
    [STORAGE_KEY]: {
      label: t("ui.reader-pages.settings-chat-sessions-settings"),
      contents: (v) =>
        count("ui.reader-pages.settings-count-chat-sessions")(
          lengthOf((v as { conversations?: unknown })?.conversations),
        ),
    },
    [GEN_STORAGE_KEY]: {
      label: t("ui.reader-pages.settings-generated-tiles"),
      contents: (v) => count("ui.reader-pages.settings-count-tiles")(lengthOf(v)),
    },
    [THEME_KEY]: {
      label: t("ui.reader-pages.settings-palette-mode"),
      contents: (v) => {
        const p = v as { theme?: unknown; mode?: unknown } | null;
        return typeof p?.theme === "string" && typeof p.mode === "string"
          ? `${p.theme} · ${p.mode}`
          : undefined;
      },
    },
    [FOCUS_KEY]: {
      label: t("ui.reader-pages.settings-focus-mode"),
      contents: (_v, raw) => (raw === "on" ? t("ui.reader-pages.settings-on") : undefined),
    },
    "facet-atlas-language": {
      label: t("ui.reader-pages.settings-interface-language"),
      contents: (_v, raw) => raw || undefined,
    },
    "facet-atlas-languages": {
      label: t("ui.reader-pages.settings-imported-languages"),
      contents: (v) => count("ui.reader-pages.settings-count-languages")(lengthOf(v)),
    },
    [PREFERENCES_KEY]: {
      label: t("ui.reader-pages.settings-atlas-settings"),
    },
    [SEEN_KEY]: {
      label: t("ui.reader-pages.settings-plugins-already-seen"),
      contents: (v) => count("ui.reader-pages.settings-count-plugins")(lengthOf(v)),
    },
  };
}

/** The browser storage this reader keeps, measured key by key. With `t`, each
 * known key is named by what it holds and how much of it is there; an unknown
 * key keeps its own name. */

export function storageItems(store: Storage | null, t?: T): contents.StorageItem[] {
  if (!store) return [];
  const kinds = t ? storedKinds(t) : {};
  const out: contents.StorageItem[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !/^(facet|atlas)/i.test(key)) continue;
      const raw = store.getItem(key) ?? "";
      let entries = 1;
      let value: unknown = raw;
      try {
        value = JSON.parse(raw) as unknown;
        if (Array.isArray(value)) entries = value.length;
        else if (
          value &&
          typeof value === "object" &&
          Array.isArray((value as { places?: unknown[] }).places)
        )
          entries = (value as { places: unknown[] }).places.length;
      } catch {
        /** a plain string is one entry */
      }
      const kind = kinds[key];
      const item: contents.StorageItem = {
        key,
        label: kind?.label ?? key,
        bytes: new Blob([raw]).size,
        entries,
      };
      const what = kind?.contents?.(value, raw);
      if (what) item.contents = what;
      out.push(item);
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** Whether a reset of `keys` took place, read back from the storage rather
 * than assumed: every key is absent, except the history, which keeps at most
 * the place the reader stands on. Without a storage nothing was reset. */

export function resetHeld(keys: string[], store: Pick<Storage, "getItem"> | null): boolean {
  if (!store) return false;
  try {
    return keys.every((k) => {
      const raw = store.getItem(k);
      if (raw === null) return true;
      if (k !== HISTORY_KEY) return false;
      const places = (JSON.parse(raw) as { places?: unknown }).places;
      return Array.isArray(places) && places.length <= 1;
    });
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The companion state as the AI section shows it: the account and the tools as
 * the host reports them, and no control the host never receives. */

// @facet: assistance/preferences/ai-notes
// @facet-role: primary
export function aiSettings(host: HostInfo, mode: "read" | "explain"): contents.AiSettings {
  const a = host.agent as
    | (NonNullable<HostInfo["agent"]> & {
        allowedTools?: unknown;
        blockedTools?: unknown;
        fixedTools?: unknown;
        isolation?: { flag?: unknown; drops?: unknown };
      })
    | null;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  // A host that does not name its fixed tools leaves the question unmeasured.
  const fixed = Array.isArray(a?.fixedTools) ? list(a.fixedTools) : null;
  // The isolation is stated only as the host reports it: flag and what it drops.
  const iso = a?.isolation;
  const isolation =
    iso && typeof iso.flag === "string" && iso.flag && list(iso.drops).length
      ? { flag: iso.flag, drops: list(iso.drops) }
      : undefined;
  return {
    ...(isolation ? { isolation } : {}),
    state: a?.auth.loggedIn ? "ready" : "signed-out",
    account: a?.auth.email,
    model: modelLabel(a),
    models: a?.models.map(modelName) ?? [],
    mode,
    tools: [
      ...list(a?.allowedTools).map((name) => ({ name, allowed: true })),
      ...list(a?.blockedTools).map((name) => ({ name, allowed: false })),
    ].map((tool) => (fixed ? { ...tool, fixed: fixed.includes(tool.name) } : tool)),
    lastCheck: host.agentCheckedAt ? host.agentCheckedAt.slice(11, 16) : "—",
  };
}

/** The version of the palette the operating system asks for. */
function systemMode(): "light" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** The interface languages: the built-in ones, then each one added from a file,
 * built-in names follow the interface language. A custom file supplies its own name. */

export function interfaceLanguages(): { value: string; label: string }[] {
  const added = customLanguages();
  const named = (code: string, name: string) => added.find((c) => c.code === code)?.name ?? name;
  return [
    ...contents.BUILT_IN_LANGUAGES.map((l) => ({
      value: l.value,
      label: named(
        l.value,
        l.value === "de"
          ? i18n.t("ui.reader-pages.settings-german")
          : i18n.t("ui.reader-pages.settings-english"),
      ),
    })),
    ...added
      .filter((c) => !contents.BUILT_IN_LANGUAGES.some((l) => l.value === c.code))
      .map((c) => ({ value: c.code, label: c.name })),
  ];
}

/** Reads a picked language file and makes it the active language. `false` when
 * the file is not one — unreadable, not JSON, or not carrying every label —
 * and then nothing of it is loaded. */

// @facet: customization/languages/language-switch
// @facet-role: primary
export async function addLanguageFile(file: Blob): Promise<boolean> {
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
    await addCustomLanguage(JSON.parse(text) as unknown);
    return true;
  } catch {
    return false;
  }
}

/** "3 minutes ago" in `language`, for the date preview; an unknown tag reads as English. */
function relativeMinutes(language: string): string {
  try {
    return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(-3, "minute");
  } catch {
    return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-3, "minute");
  }
}

/** The sentence that names why a shared setting was not stored. */
const REFUSAL_TEXT: Record<SharedWriteRefusal, string> = {
  "no-storage": "ui.reader-pages.settings-not-saved-browser-offers-atlas-no",
  refused: "ui.reader-pages.settings-not-saved-browser-refused-store-choice",
  unreadable: "ui.reader-pages.settings-not-saved-stored-atlas-state-facet",
};

const PROVIDERS = ["github", "gitlab", "gitea"] as const;

/** The Git provider section from the host's answer. Without an answer in hand —
 * pending, refused, or no way to the host — nothing is claimed about the
 * repository: "no remote" would be a finding about a machine nobody looked at. */

export function gitProviderSettings(host: HostInfo): contents.GitProviderSettings {
  const r = host.repo;
  const forge = (r?.forge ?? "").toLowerCase();
  return {
    state: !r ? "unanswered" : r.remote ? "ok" : "no-remote",
    remote: r?.remote ?? "",
    provider: (PROVIDERS as readonly string[]).includes(forge)
      ? (forge as contents.GitProviderSettings["provider"])
      : "other",
    branch: r?.branch ?? "—",
    branchPrefix: "",
    prDraft: false,
    codeLinks: !!r?.remote,
    manualUrl: "",
    error: host.repoError ?? r?.gitError,
  };
}

/** The plugins page's rows: the bundled catalogue, then what `/api/plugins`
 * listed. A row has a switch only when its plugin loads here; one that did
 * not names why, from `refused` (the host's own reason). */

// @facet: customization/contributions/plugin-settings
// @facet-role: primary
export function pluginRows(
  host: HostInfo,
  off: readonly string[],
  tt: FacetText["t"],
  refused: Readonly<Record<string, string>> = {},
  themeRefused: Readonly<Record<string, readonly contents.ThemeRefusal[]>> = {},
): contents.PluginRow[] {
  const bundledIds = OFFICIAL_PLUGINS.map((p) => p.id);
  const bundled = OFFICIAL_PLUGINS.map((p) => ({
    id: p.id,
    name: p.nav ? tt(p.nav.label) : p.id,
    version: tt("ui.reader-pages.settings-bundled"),
    source: "bundled" as const,
    enabled: !off.includes(p.id),
    verification: "ok" as const,
    open: 0,
    desc: "",
    themeRefusals: themeRefused[p.id],
  }));
  const installed = (host.installed ?? []).map((p) => {
    // Loaded here, or loadable: verified, not refused by the session, and not
    // shadowed by a bundled plugin with the same id.
    const loads = p.verification === "ok" && !refused[p.id] && !bundledIds.includes(p.id);
    const reason =
      refused[p.id] ??
      (bundledIds.includes(p.id)
        ? "Plugin unavailable: blocked (bundled-id-collision)"
        : p.verification !== "ok"
          ? `Plugin unavailable: not-loaded (${p.verification})`
          : undefined);
    return {
      id: p.id,
      name: p.name,
      version: p.version,
      source: p.dev ? ("development" as const) : ("installed" as const),
      enabled: loads && !off.includes(p.id),
      verification:
        p.verification === "ok"
          ? ("ok" as const)
          : p.verification === "checksum-mismatch"
            ? ("mismatch" as const)
            : ("missing" as const),
      open: 0,
      desc: p.where ?? "",
      switchable: loads,
      reason: loads ? undefined : reason,
      themeRefusals: themeRefused[p.id],
    };
  });
  return [...bundled, ...installed];
}

// @facet: workspace/settings/settings-page
// @facet-role: primary
// @facet: workspace/controls/switch
// @facet-role: primary
export function SettingsPlace({
  ctx,
  section,
  host,
  history,
  sourceView,
}: {
  ctx: PageContext;
  section?: string;
  host: HostInfo;
  history: { count: number; clear: () => void };
  sourceView?: SourceViewSummary;
}) {
  // A plugin's settings page is addressed as `plugin-<page id>`.
  const pluginPages = ctx.plugins?.host.settings.list() ?? [];
  const pluginPage = section?.startsWith(PLUGIN_SECTION)
    ? (ctx.plugins?.host.settings.find(section.slice(PLUGIN_SECTION.length)) ?? null)
    : null;
  const active: Section = isSection(section) ? section : "appearance";
  // Opening a plugin's page is having seen it: its dot goes out, here and on the gear.
  const seen = ctx.plugins?.host.seen;
  useEffect(() => {
    if (pluginPage && seen) seen.mark(settingsPlace(pluginPage));
  }, [pluginPage, seen]);
  const [s, set] = ctx.slot("settings", {
    query: "",
    /** The maximum as typed; `null` shows the stored one. */
    limitDraft: null as string | null,
    aiMode: "read" as "read" | "explain",
    content: "record" as contents.LanguageSettings["content"],
    dates: "absolute" as contents.LanguageSettings["dates"],
    week: "monday" as contents.LanguageSettings["week"],
    tick: 0,
    /** What the last reset did, as the storage reads after it; null before one. */
    reset: null as "done" | "refused" | null,
    /** The name of the last language file that was refused; null when none was. */
    languageRefused: null as string | null,
  });
  const go = (key: Section) => ctx.go(href({ area: "settings", section: key }));
  const { t: tt } = useText();
  // A plugin that ran and was switched off since says so on its own row: its
  // drawing is absent, the code it started runs until the page loads again.
  const offFromNextLoad = ctx.plugins?.offFromNextLoad ?? [];
  const rows = pluginRows(
    host,
    ctx.plugins?.off ?? [],
    tt,
    ctx.plugins?.refused,
    ctx.plugins?.host.themes.refused(),
  ).map((row) =>
    offFromNextLoad.includes(row.id)
      ? { ...row, reason: ctx.t("ui.reader-pages.settings-off-next-load"), reload: true }
      : row,
  );
  const [shared, setShared] = useState<SharedSettings>(() => readShared());
  // A switch moves only when the choice was stored: a switch that reads "on"
  // while nothing was saved would hold for this page and be gone on reload.
  const [refused, setRefused] = useState<{ section: Section; reason: SharedWriteRefusal } | null>(
    null,
  );
  const prefs = usePreferences();
  // Like a shared setting, a control moves only when the choice was stored.
  const prefer = (patch: Partial<Preferences>): boolean => {
    if (!writePreferences(patch)) {
      setRefused({ section: active, reason: safeStorage() ? "refused" : "no-storage" });
      return false;
    }
    setRefused(null);
    return true;
  };
  const share = (patch: Partial<SharedSettings>) => {
    const reason = saveShared(patch);
    if (reason) {
      setRefused({ section: active, reason });
      return;
    }
    setRefused(null);
    setShared((prev) => ({ ...prev, ...patch }));
  };
  const refusal =
    refused && refused.section === active ? (
      <p className="t-c-alert" role="alert" data-testid="settings-write-refused">
        {ctx.t(REFUSAL_TEXT[refused.reason])}
      </p>
    ) : null;
  const ui = ctx.language === "en" ? "en" : "de";
  const now = new Date();

  let body;
  switch (active) {
    case "appearance":
      body = (
        <>
          {refusal}
          <contents.ThemeSection
            value={{
              theme: ctx.theme.theme,
              mode: ctx.theme.mode,
              followSystem: ctx.theme.system === true,
              density: prefs.density,
              motion: prefs.motion,
              focus: ctx.focus,
            }}
            pluginPalettes={ctx.plugins?.host.themes.list() ?? []}
            onChange={(patch) => {
              if (patch.theme || patch.mode)
                // A card names palette and version: choosing one is a choice, not following.
                ctx.setTheme({
                  theme: patch.theme ?? ctx.theme.theme,
                  mode: patch.mode ?? ctx.theme.mode,
                });
              if (patch.followSystem != null)
                ctx.setTheme({
                  ...ctx.theme,
                  mode: patch.followSystem ? systemMode() : ctx.theme.mode,
                  system: patch.followSystem,
                });
              if (patch.density) prefer({ density: patch.density });
              if (patch.motion) prefer({ motion: patch.motion });
              if (patch.focus != null) ctx.setFocus(patch.focus);
            }}
          />
          <div className="t-surface t-c-setgroup" data-testid="city-settings">
            <contents.SettingRow
              label={ctx.t("ui.reader-pages.settings-product-city-height")}
              desc={ctx.t("ui.reader-pages.settings-least-height-3d-city-product-page")}
              control={
                <Select
                  aria-label={ctx.t("ui.reader-pages.settings-product-city-height")}
                  data-testid="city-height"
                  value={prefs.cityHeight == null ? "window" : String(prefs.cityHeight)}
                  options={[
                    { value: "window", label: ctx.t("ui.reader-pages.settings-follows-window") },
                    ...CITY_HEIGHTS.map((h) => ({
                      value: String(h),
                      label: ctx.t("ui.reader-pages.settings-px-pixels", { px: h }),
                    })),
                  ]}
                  onValueChange={(v) =>
                    prefer({
                      cityHeight:
                        v === "window" ? null : (CITY_HEIGHTS.find((h) => String(h) === v) ?? null),
                    })
                  }
                />
              }
            />
            <contents.SettingRow
              label={ctx.t("ui.reader-pages.settings-city-name-style")}
              desc={ctx.t("ui.reader-pages.settings-how-product-city-draws-names-areas")}
              control={
                <Select
                  aria-label={ctx.t("ui.reader-pages.settings-city-name-style")}
                  data-testid="city-labels"
                  value={prefs.cityLabels}
                  options={[
                    { value: "tag", label: ctx.t("ui.reader-pages.settings-tag-foundation") },
                    { value: "pin", label: ctx.t("ui.reader-pages.settings-pin-roof") },
                    { value: "map", label: ctx.t("ui.reader-pages.settings-map-lettering") },
                  ]}
                  onValueChange={(v) =>
                    prefer({ cityLabels: CITY_LABELS.find((l) => l === v) ?? "tag" })
                  }
                />
              }
            />
            <contents.SettingRow
              label={ctx.t("ui.reader-pages.settings-names-only-hover")}
              desc={ctx.t("ui.reader-pages.settings-city-names-area-building-under-pointer")}
              control={
                <Switch
                  label={ctx.t("ui.reader-pages.settings-names-only-hover")}
                  checked={prefs.cityNames === "hover"}
                  onChange={(on) => prefer({ cityNames: on ? "hover" : "always" })}
                />
              }
            />
          </div>
        </>
      );
      break;
    case "language":
      body = (
        <contents.LanguageSection
          value={{ ui: ctx.language, content: s.content, dates: s.dates, week: s.week }}
          sample={{
            relative: relativeMinutes(ctx.language),
            absolute: now.toLocaleString(ui === "en" ? "en-GB" : "de-DE"),
            number: (1234.5).toLocaleString(ui === "en" ? "en-GB" : "de-DE"),
          }}
          languages={interfaceLanguages()}
          refused={s.languageRefused}
          onAddFile={(file) => {
            void addLanguageFile(file).then((ok) =>
              set({ languageRefused: ok ? null : file.name }),
            );
          }}
          onChange={(patch) => {
            if (patch.ui) void i18n.changeLanguage(patch.ui);
            const { ui: _ui, ...rest } = patch;
            void _ui;
            set(rest);
          }}
        />
      );
      break;
    case "history": {
      const typed = s.limitDraft;
      const invalid = typed != null && parseHistoryLimit(typed) == null;
      body = (
        <>
          {refusal}
          {s.reset === "done" ? (
            <p className="t-c-banner t-c-banner--ok" role="status" data-testid="storage-reset">
              {ctx.t("ui.reader-pages.settings-reset-completed")}
            </p>
          ) : s.reset === "refused" ? (
            <p className="t-c-alert" role="alert" data-testid="storage-reset">
              {ctx.t("ui.reader-pages.settings-not-reset-browser-refused-remove-stored")}
            </p>
          ) : null}
          <contents.StorageSection
            value={{
              historyLimit: typed ?? String(prefs.historyLimit),
              historyCount: history.count,
              keepChat: prefs.keepChat,
              restoreLast: prefs.restoreLast,
              items: storageItems(safeStorage(), ctx.t),
              error: invalid
                ? ctx.t("ui.reader-pages.settings-whole-number-min-max", {
                    min: HISTORY_LIMIT_MIN,
                    max: HISTORY_LIMIT_MAX,
                  })
                : undefined,
            }}
            onChange={(patch) => {
              if (patch.historyLimit != null) {
                const n = parseHistoryLimit(patch.historyLimit);
                // A valid maximum is stored as typed; the field keeps the text until it is one.
                if (n != null && prefer({ historyLimit: n })) set({ limitDraft: null });
                else set({ limitDraft: patch.historyLimit });
              }
              if (patch.restoreLast != null) prefer({ restoreLast: patch.restoreLast });
              if (patch.keepChat != null && prefer({ keepChat: patch.keepChat })) {
                // Off ends the stored sessions now; the open ones stay for this page.
                if (!patch.keepChat) forgetSessions();
                set({ tick: s.tick + 1 });
              }
            }}
            onClear={(key) => {
              // "*" is every key the list shows; the history keeps the place the reader is on.
              const keys = key === "*" ? storageItems(safeStorage()).map((i) => i.key) : [key];
              for (const k of keys) {
                if (k === HISTORY_KEY) history.clear();
                else if (k === FOCUS_KEY) ctx.setFocus(false);
                else {
                  try {
                    safeStorage()?.removeItem(k);
                  } catch {
                    /** measured below: the key is still there */
                  }
                }
              }
              set({ tick: s.tick + 1, reset: resetHeld(keys, safeStorage()) ? "done" : "refused" });
            }}
          />
        </>
      );
      break;
    }
    case "ai":
      body = host.agent ? (
        // The companion's model, tools and sign-in as the host reports them: the
        // host takes none of them from the browser, so none is offered as a choice.
        <contents.AiSection value={aiSettings(host, s.aiMode)} onCopy={ctx.copy} />
      ) : (
        <EmptyState
          icon="spark"
          title={ctx.t("ui.reader-pages.settings-atlas-ai-not-responding")}
          body={ctx.t("ui.reader-pages.settings-host-returned-no-companion-state-api")}
        />
      );
      // How the chat scrolls is a choice of this browser, with or without a companion.
      body = (
        <>
          {body}
          {/** i18n-spacing: joined */}
          {refusal}
          <div className="t-surface t-c-setgroup" data-testid="chat-follow">
            <contents.SettingRow
              label={ctx.t("ui.reader-pages.settings-scroll-along-while-answering")}
              desc={ctx.t("ui.reader-pages.settings-view-follows-end-answer-instead-keeping")}
              control={
                <Switch
                  label={ctx.t("ui.reader-pages.settings-scroll-along-while-answering")}
                  checked={prefs.followAnswer}
                  onChange={(on) => prefer({ followAnswer: on })}
                />
              }
            />
          </div>
        </>
      );
      break;
    case "git-provider":
      body = (
        <>
          <contents.GitProviderSection value={gitProviderSettings(host)} onCopy={ctx.copy} />
          <SourceViewSection view={sourceView} t={ctx.t} />
        </>
      );
      break;
    case "plugins":
      body = (
        <>
          {refusal}
          <contents.PluginsSection
            plugins={rows}
            onOpen={(id) => ctx.go(href({ area: "plugin", plugin: id, rest: "" }))}
            onToggle={(id, on) =>
              share({
                pluginsOff: on
                  ? shared.pluginsOff.filter((x) => x !== id)
                  : [...new Set([...shared.pluginsOff, id])],
              })
            }
            onCopy={ctx.copy}
            onReload={reloadDocument}
          />
        </>
      );
      break;
    case "genui":
      body = (
        <contents.SettingsSection
          title={ctx.t("ui.reader-pages.settings-generative-ui")}
          sub={ctx.t("ui.reader-pages.settings-switchable-per-role-tiles-appear-overview")}
        >
          {refusal}
          <div className="t-surface t-c-setgroup" data-testid="genui-roles">
            {ROLE_LIST.map((role) => (
              <contents.SettingRow
                key={role.key}
                label={role.label}
                desc={role.purpose}
                control={
                  <Switch
                    label={role.label}
                    checked={shared.generativeOn.includes(role.key)}
                    onChange={(on) =>
                      share({ generativeOn: withRole(shared.generativeOn, role.key, on) })
                    }
                  />
                }
              />
            ))}
          </div>
          <p className="t-c-small t-muted">
            {ctx.t("ui.reader-pages.settings-every-generated-tile-model-call-time")}
          </p>
        </contents.SettingsSection>
      );
      break;

    default:
      body = (
        <EmptyState icon="info" title={ctx.t("ui.reader-pages.settings-not-connected-atlas-yet")} />
      );
  }
  if (pluginPage)
    body = (
      <div data-testid={`settings-plugin-${pluginPage.id}`}>
        <PluginDraw
          plugin={pluginPage.plugin}
          draw={() =>
            pluginPage.render({
              place: { depth: 0, fid: null, sid: null, role: ctx.role, area: null },
            })
          }
        />
      </div>
    );
  const q = s.query.trim().toLowerCase();
  const pluginResults = q
    ? pluginPages
        .filter((p) =>
          [p.title, p.subtitle, p.keywords ?? ""].some((x) => x.toLowerCase().includes(q)),
        )
        .map((p) => `${PLUGIN_SECTION}${p.id}`)
    : [];
  const results = searchSections(s.query, tt, {
    plugins: [
      ...rows.flatMap((r) => [r.name, r.id]),
      ...ctx
        .t("ui.reader-pages.settings-plugin-plugins-extension-extensions-switch-off")
        .split(" "),
    ],
  });

  return (
    <contents.SettingsPage
      active={pluginPage ? `${PLUGIN_SECTION}${pluginPage.id}` : active}
      mobile={ctx.mobile}
      detailOpen={isSection(section) || !!pluginPage}
      query={s.query}
      results={results ? [...results, ...pluginResults] : null}
      pluginSections={pluginPages.map((p) => ({
        key: `${PLUGIN_SECTION}${p.id}`,
        name: p.title,
        sub: p.subtitle,
        fresh: !!seen?.isNew(settingsPlace(p)) && p !== pluginPage,
      }))}
      onPluginSection={(key) => ctx.go(href({ area: "settings", section: key }))}
      onQuery={(query) => set({ query })}
      onSection={go}
      onBack={() => ctx.go(href({ area: "settings" }))}
    >
      {body}
    </contents.SettingsPage>
  );
}
