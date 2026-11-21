import { useRef, type ReactNode } from "react";
import {
  Button,
  Chip,
  Field,
  SearchField,
  Segment,
  Switch,
  EmptyState,
  Icon,
  type IconName,
} from "@facet-tools/ui";

import { useText } from "../text";
import type { TextKey } from "../text";
import { KeyValues } from "./frame";
import type { GrantItem, PluginRow, SettingsSectionKey } from "./model";

/** The settings sections. `label` and `sub` are dictionary keys; a `null` label
 * is a product or technical name that reads the same in both languages. */

export const SETTINGS_SECTIONS: {
  key: SettingsSectionKey;
  label: TextKey | null;
  name?: string;
  icon: IconName;
  sub: TextKey;
}[] = [
  {
    key: "appearance",
    label: "ui.screens-contents.settings-appearance",
    icon: "theme",
    sub: "ui.screens-contents.settings-palette-mode-density-motion",
  },
  {
    key: "language",
    label: "ui.screens-contents.settings-language",
    icon: "globe",
    sub: "ui.screens-contents.settings-interface-contents-dates",
  },
  {
    key: "history",
    label: "ui.screens-contents.settings-history-storage",
    icon: "history",
    sub: "ui.screens-contents.settings-places-sessions-browser-state",
  },
  {
    key: "ai",
    label: "ui.screens-contents.settings-atlas-ai",
    icon: "spark",
    sub: "ui.screens-contents.settings-sign-model-tools",
  },
  {
    key: "git-provider",
    label: "ui.screens-contents.settings-git-provider",
    icon: "branch",
    sub: "ui.screens-contents.settings-remote-links-pull-requests",
  },
  {
    key: "plugins",
    label: null,
    name: "Plugins",
    icon: "plug",
    sub: "ui.screens-contents.settings-installed-checksum-grants",
  },
  {
    key: "genui",
    label: null,
    name: "Generative UI",
    icon: "grid",
    sub: "ui.screens-contents.settings-views-answers",
  },
];

/** The visible name of a settings section in the active language. */
export function sectionLabel(
  s: (typeof SETTINGS_SECTIONS)[number] | undefined,
  t: (key: TextKey) => string,
): string | undefined {
  if (!s) return undefined;
  return s.label ? t(s.label) : s.name;
}

/** A page an app adds to the settings, e.g. one a plugin contributes. */
export type SettingsExtraSection = {
  key: string;
  name: string;
  sub: string;
  /** Not opened yet: the entry carries the new-page dot until it is. */
  fresh?: boolean;
};

export type SettingsPageProps = {
  /** A section's key, or the key of one of `pluginSections`. */
  active: SettingsSectionKey | (string & {});
  mobile?: boolean;
  /** Mobile: the section is open (detail) instead of the list. */
  detailOpen?: boolean;
  query: string;
  /** Sections matching the query; `null` = no search. An empty list renders the no-result state. */
  results?: readonly (SettingsSectionKey | (string & {}))[] | null;
  /** Pages beside the built-in sections, listed in their own group "Plugins". */
  pluginSections?: readonly SettingsExtraSection[];
  onPluginSection?: (key: string) => void;
  badges?: Partial<Record<SettingsSectionKey, { label: string; tone?: "warn" | "bad" | "ok" }>>;
  onQuery?: (q: string) => void;
  onSection?: (key: SettingsSectionKey) => void;
  onBack?: () => void;
  children?: ReactNode;
};

/** Settings: a list of sections beside the open section; on mobile list → detail. */
export function SettingsPage(p: SettingsPageProps) {
  const { t } = useText();
  const visible = p.results
    ? SETTINGS_SECTIONS.filter((s) => p.results?.includes(s.key))
    : SETTINGS_SECTIONS;
  const noResults = p.results != null && p.results.length === 0;
  const current = SETTINGS_SECTIONS.find((s) => s.key === p.active);
  const extra = (p.pluginSections ?? []).filter((s) => !p.results || p.results.includes(s.key));
  const currentExtra = p.pluginSections?.find((s) => s.key === p.active);
  const nav = (
    <nav className="t-c-set__nav" aria-label={t("ui.screens-contents.settings-settings")}>
      <SearchField
        label={t("ui.screens-contents.settings-search-settings")}
        value={p.query}
        placeholder={t("ui.screens-contents.settings-find-setting")}
        onChange={p.onQuery}
      />
      {noResults ? (
        <div data-testid="settings-no-results">
          <EmptyState
            plain
            icon="search"
            title={t("ui.screens-contents.settings-no-setting-query", { query: p.query })}
            body={t("ui.screens-contents.settings-search-covers-names-descriptions-values")}
            action={
              <>
                <Button size="small" icon="close" onClick={() => p.onQuery?.("")}>
                  {t("ui.screens-contents.settings-clear-search")}
                </Button>
                {["Theme", t("ui.screens-contents.settings-language"), "Plugins"].map((s) => (
                  <Chip key={s} onClick={() => p.onQuery?.(s)}>
                    {s}
                  </Chip>
                ))}
              </>
            }
          />
        </div>
      ) : (
        <ul className="t-c-plain t-c-set__list">
          {visible.map((s) => {
            const b = p.badges?.[s.key];
            return (
              <li key={s.key}>
                <button
                  type="button"
                  className="t-c-set__item"
                  aria-current={!p.mobile && s.key === p.active ? "page" : undefined}
                  onClick={() => p.onSection?.(s.key)}
                >
                  <span className="t-c-tile__icon">
                    <Icon name={s.icon} size={16} />
                  </span>
                  <span className="t-stack" style={{ gap: 0, flex: 1, minWidth: 0 }}>
                    <span>{sectionLabel(s, t)}</span>
                    <span className="t-c-small t-muted t-ellipsis">{t(s.sub)}</span>
                  </span>
                  {b ? (
                    <span className={`t-badge${b.tone ? ` t-badge--${b.tone}` : ""}`}>
                      {b.label}
                    </span>
                  ) : null}
                  {p.mobile ? <Icon name="chevronRight" size={14} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!noResults && extra.length ? (
        <div className="t-stack" style={{ gap: 4 }} data-testid="settings-plugin-sections">
          <span className="t-menu-label">{t("ui.screens-contents.settings-plugins-label")}</span>
          <ul className="t-c-plain t-c-set__list">
            {extra.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className="t-c-set__item"
                  aria-current={!p.mobile && s.key === p.active ? "page" : undefined}
                  onClick={() => p.onPluginSection?.(s.key)}
                >
                  <span className="t-c-tile__icon">
                    <Icon name="plug" size={16} />
                  </span>
                  <span className="t-stack" style={{ gap: 0, flex: 1, minWidth: 0 }}>
                    <span>{s.name}</span>
                    <span className="t-c-small t-muted t-ellipsis">{s.sub}</span>
                  </span>
                  {s.fresh ? (
                    <span
                      className="t-d-glow"
                      role="img"
                      aria-label={t("ui.screens-contents.settings-new-settings-page")}
                      data-testid={`settings-fresh-${s.key}`}
                    />
                  ) : null}
                  {p.mobile ? <Icon name="chevronRight" size={14} /> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
  if (p.mobile) {
    return (
      <div className="t-page t-c-set t-c-set--mobile" data-testid="settings-page">
        {p.detailOpen ? (
          <>
            <button type="button" className="t-c-back" onClick={p.onBack}>
              <Icon name="back" size={14} /> {t("ui.screens-contents.settings-settings")}
            </button>
            <div className="t-anim-rise">{p.children}</div>
          </>
        ) : (
          <>
            <h1 className="t-h1">{t("ui.screens-contents.settings-settings")}</h1>
            {nav}
          </>
        )}
      </div>
    );
  }
  return (
    <div className="t-page t-c-set" data-testid="settings-page">
      <div className="t-c-set__layout">
        <div className="t-stack">
          <h1 className="t-h1">{t("ui.screens-contents.settings-settings")}</h1>
          {nav}
        </div>
        <div
          className="t-c-set__main t-anim-rise"
          aria-label={currentExtra?.name ?? sectionLabel(current, t)}
        >
          {noResults ? null : p.children}
        </div>
      </div>
    </div>
  );
}

/** Shared section parts ---------------------------------------------------------- */

export function SettingsSection({
  title,
  sub,
  children,
  actions,
}: {
  title: string;
  sub?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="t-c-set__section" aria-label={title}>
      <header className="t-row t-row--wrap">
        <div className="t-stack" style={{ gap: 2, flex: 1 }}>
          <h2 className="t-h2">{title}</h2>
          {sub ? <span className="t-c-small t-muted">{sub}</span> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** One setting: label and description on the left, control on the right. */
export function SettingRow({
  label,
  desc,
  control,
  stacked,
}: {
  label: ReactNode;
  desc?: ReactNode;
  control: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={stacked ? "t-c-setrow t-c-setrow--stacked" : "t-c-setrow"}>
      <div className="t-stack" style={{ gap: 2, minWidth: 0 }}>
        <span className="t-c-setrow__label">{label}</span>
        {desc ? <span className="t-c-small t-muted">{desc}</span> : null}
      </div>
      <div className="t-c-setrow__control">{control}</div>
    </div>
  );
}

function Group({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="t-surface t-c-setgroup">
      {title ? <div className="t-c-setgroup__title t-label">{title}</div> : null}
      {children}
    </div>
  );
}

function Command({
  text,
  label,
  onCopy,
}: {
  text: string;
  label?: string;
  onCopy?: (t: string) => void;
}) {
  const { t } = useText();
  return (
    <div className="t-c-cmd">
      <code className="t-mono">$ {text}</code>
      <Button
        size="small"
        variant="quiet"
        icon="copy"
        aria-label={label ?? t("ui.screens-contents.settings-copy-command")}
        onClick={() => onCopy?.(text)}
      />
    </div>
  );
}

/** Appearance -------------------------------------------------------------------- */

export type Appearance = {
  /** FACET, Paper, or a plugin's theme as `<plugin>:<name>`. */
  theme: string;
  mode: "dark" | "light";
  followSystem: boolean;
  density: "compact" | "normal" | "spacious";
  /** System follows `prefers-reduced-motion`; reduced holds whatever the system says. */
  motion: "system" | "reduced";
  /** Focus mode: what has neither pointer nor focus blurs. Absent where the app has none. */
  focus?: boolean;
};

/** A palette a plugin contributed: its `data-t-theme` value and the name it gave. */
export type PluginPalette = { id: string; label: string };

/** Built-in palette names are translated when the cards are rendered. */
const PALETTES: { theme: Appearance["theme"]; mode: Appearance["mode"]; name: string }[] = [
  { theme: "facet", mode: "dark", name: "FACET" },
  { theme: "facet", mode: "light", name: "FACET" },
  { theme: "paper", mode: "dark", name: "Paper" },
  { theme: "paper", mode: "light", name: "Paper" },
];
const MODE_LABEL: Record<Appearance["mode"], TextKey> = {
  dark: "ui.screens-contents.settings-dark",
  light: "ui.screens-contents.settings-light",
};

/** A live preview: the palette is applied to a nested scope, so all four render at once. */
function PalettePreview({ theme, mode }: { theme: string; mode: string }) {
  return (
    <span className="t-c-palette" data-t-theme={theme} data-t-mode={mode} aria-hidden="true">
      <span className="t-c-palette__bar">
        <span className="t-c-palette__logo" />
        <span className="t-c-palette__line" style={{ width: "34%" }} />
        <span className="t-c-palette__pill" />
      </span>
      <span className="t-c-palette__body">
        <span className="t-c-palette__big">94</span>
        <span className="t-c-palette__card">
          <span className="t-c-palette__line" style={{ width: "70%" }} />
          <span className="t-c-palette__meter">
            <span />
          </span>
          <span className="t-c-palette__dots">
            <i style={{ background: "var(--t-ok)" }} />
            <i style={{ background: "var(--t-warn)" }} />
            <i style={{ background: "var(--t-plan)" }} />
            <i style={{ background: "var(--t-bad)" }} />
          </span>
        </span>
      </span>
    </span>
  );
}

export function ThemeSection({
  value,
  onChange,
  pluginPalettes = [],
}: {
  value: Appearance;
  onChange?: (patch: Partial<Appearance>) => void;
  /** Palettes the loaded plugins contributed, each offered in both versions after FACET and Paper. */
  pluginPalettes?: readonly PluginPalette[];
}) {
  const { t } = useText();
  const cards = [
    ...PALETTES,
    ...pluginPalettes.flatMap((p) =>
      (["dark", "light"] as const).map((mode) => ({ theme: p.id, mode, name: p.label })),
    ),
  ];
  return (
    <SettingsSection
      title={t("ui.screens-contents.settings-appearance")}
      sub={t("ui.screens-contents.settings-applies-browser")}
    >
      <div
        className="t-c-palettes"
        role="radiogroup"
        aria-label={t("ui.screens-contents.settings-palette")}
        data-testid="theme-palettes"
      >
        {cards.map((pl) => {
          const on = pl.theme === value.theme && pl.mode === value.mode;
          return (
            <button
              key={`${pl.theme}-${pl.mode}`}
              type="button"
              role="radio"
              aria-checked={on}
              className="t-c-palette-opt"
              data-testid={`theme-card-${pl.theme}-${pl.mode}`}
              onClick={() => onChange?.({ theme: pl.theme, mode: pl.mode })}
            >
              <PalettePreview theme={pl.theme} mode={pl.mode} />
              <span className="t-row">
                <span className="t-c-radio" aria-hidden="true" data-on={on || undefined} />
                <span>
                  {pl.theme === "paper" ? t("ui.screens-contents.settings-paper") : pl.name} ·{" "}
                  {t(MODE_LABEL[pl.mode])}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <Group>
        <SettingRow
          label={t("ui.screens-contents.settings-follow-system")}
          desc={t("ui.screens-contents.settings-light-dark-switch-operating-system")}
          control={
            <Switch
              label={t("ui.screens-contents.settings-follow-system")}
              checked={value.followSystem}
              onChange={(v) => onChange?.({ followSystem: v })}
            />
          }
        />
        {value.focus != null ? (
          <SettingRow
            label={t("ui.screens-contents.settings-focus-mode")}
            desc={t("ui.screens-contents.settings-wide-page-larger-type-what-has")}
            control={
              <Switch
                label={t("ui.screens-contents.settings-focus-mode")}
                checked={value.focus}
                onChange={(v) => onChange?.({ focus: v })}
              />
            }
          />
        ) : null}
        <SettingRow
          label={t("ui.screens-contents.settings-density")}
          control={
            <Segment
              label={t("ui.screens-contents.settings-density")}
              value={value.density}
              options={[
                { value: "compact", label: t("ui.screens-contents.settings-compact") },
                { value: "normal", label: "Normal" },
                { value: "spacious", label: t("ui.screens-contents.settings-wide") },
              ]}
              onChange={(v) => onChange?.({ density: v })}
            />
          }
        />
        <SettingRow
          label={t("ui.screens-contents.settings-motion")}
          desc={t("ui.screens-contents.settings-reduced-no-animation")}
          control={
            <Segment
              label={t("ui.screens-contents.settings-motion")}
              value={value.motion}
              options={[
                { value: "system", label: "System" },
                { value: "reduced", label: t("ui.screens-contents.settings-reduced") },
              ]}
              onChange={(v) => onChange?.({ motion: v })}
            />
          }
        />
      </Group>
    </SettingsSection>
  );
}

/** Language ---------------------------------------------------------------------- */

export type LanguageSettings = {
  /** The interface language's tag: a built-in one or one added from a file. */
  ui: string;
  content: "record" | "de" | "en";
  dates: "relative" | "absolute";
  week: "monday" | "sunday";
};

/** The built-in interface languages, each named in itself. */
export const BUILT_IN_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: "de", label: "German" },
  { value: "en", label: "English" },
];

export function LanguageSection({
  value,
  sample,
  onChange,
  languages = BUILT_IN_LANGUAGES,
  onAddFile,
  refused,
}: {
  value: LanguageSettings;
  sample: { relative: string; absolute: string; number: string };
  onChange?: (patch: Partial<LanguageSettings>) => void;
  /** The interface languages to choose from, each named in itself. */
  languages?: readonly { value: string; label: string }[];
  /** A picked language file; without it there is no add button. */
  onAddFile?: (file: File) => void;
  /** The name of the last file that was refused; `null` when none was. */
  refused?: string | null;
}) {
  const { t } = useText();
  const picker = useRef<HTMLInputElement>(null);
  return (
    <SettingsSection
      title={t("ui.screens-contents.settings-language")}
      sub={t("ui.screens-contents.settings-records-keep-their-own-language-when")}
    >
      <Group>
        <SettingRow
          label={t("ui.screens-contents.settings-interface-language")}
          control={
            <span className="t-row t-row--wrap" style={{ gap: 8, justifyContent: "flex-end" }}>
              <Segment
                label={t("ui.screens-contents.settings-interface-language")}
                value={value.ui}
                options={languages.map((l) => ({ value: l.value, label: l.label }))}
                onChange={(v) => onChange?.({ ui: v })}
              />
              {onAddFile ? (
                <>
                  <Button
                    size="small"
                    icon="upload"
                    data-testid="language-add"
                    onClick={() => picker.current?.click()}
                  >
                    {t("ui.screens-contents.settings-add-language")}
                  </Button>
                  <input
                    ref={picker}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    aria-label={t("ui.screens-contents.settings-language-file")}
                    data-testid="language-file"
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0];
                      // Cleared at once, so the same file can be picked again.
                      e.currentTarget.value = "";
                      if (file) onAddFile(file);
                    }}
                  />
                </>
              ) : null}
            </span>
          }
        />
        {refused ? (
          <p className="t-c-alert" role="alert" data-testid="language-refused">
            {t("ui.screens-contents.settings-not-language-file-name", { name: refused })}
          </p>
        ) : null}
        <SettingRow
          label={t("ui.screens-contents.settings-contents")}
          desc={t("ui.screens-contents.settings-promises-knowledge-summaries")}
          control={
            <Segment
              label={t("ui.screens-contents.settings-content-language")}
              value={value.content}
              options={[
                { value: "record", label: t("ui.screens-contents.settings-record") },
                { value: "de", label: t("ui.screens-contents.settings-german") },
                { value: "en", label: t("ui.screens-contents.settings-english") },
              ]}
              onChange={(v) => onChange?.({ content: v })}
            />
          }
        />
        <SettingRow
          label={t("ui.screens-contents.settings-dates")}
          control={
            <Segment
              label={t("ui.screens-contents.settings-dates")}
              value={value.dates}
              options={[
                {
                  value: "relative",
                  label: t("ui.screens-contents.settings-count-days-ago", { count: 3 }),
                },
                { value: "absolute", label: t("ui.screens-contents.settings-11-10-2026") },
              ]}
              onChange={(v) => onChange?.({ dates: v })}
            />
          }
        />
        <SettingRow
          label={t("ui.screens-contents.settings-week-starts")}
          control={
            <Segment
              label={t("ui.screens-contents.settings-week-starts")}
              value={value.week}
              options={[
                { value: "monday", label: t("ui.screens-contents.settings-monday") },
                { value: "sunday", label: t("ui.screens-contents.settings-sunday") },
              ]}
              onChange={(v) => onChange?.({ week: v })}
            />
          }
        />
      </Group>
      <Group title={t("ui.screens-contents.settings-preview")}>
        <div className="t-c-preview" data-testid="language-preview">
          <span>
            {t("ui.screens-contents.settings-drift")}{" "}
            <span className="t-mono">
              {t("ui.screens-contents.settings-internal-facet-config-go")}
            </span>
          </span>
          <span className="t-meta">
            {value.dates === "relative" ? sample.relative : sample.absolute}
          </span>
          <span className="t-num">
            {t("ui.screens-contents.settings-lines-lines", { lines: sample.number })}
          </span>
        </div>
      </Group>
    </SettingsSection>
  );
}

/** History & storage --------------------------------------------------------------- */

export type StorageSettings = {
  historyLimit: string;
  historyCount: number;
  keepChat: boolean;
  restoreLast: boolean;
  items: StorageItem[];
  error?: string;
};

/** One key in the browser storage: what it holds, in words the reader knows. */
export type StorageItem = {
  key: string;
  /** What the key stores ("History", "Palette and mode"); the key itself when unknown. */
  label: string;
  bytes: number;
  entries: number;
  /** What is in it now ("4 places"); without it the entry count stands. */
  contents?: string;
};

export function StorageSection({
  value,
  onChange,
  onClear,
}: {
  value: StorageSettings;
  onChange?: (patch: Partial<StorageSettings>) => void;
  onClear?: (key: string) => void;
}) {
  const { t, plural, number, locale } = useText();
  const oneDecimal = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const kb = (bytes: number) => `${oneDecimal.format(bytes / 1024)} KB`;
  const total = value.items.reduce((a, i) => a + i.bytes, 0);
  return (
    <SettingsSection title={t("ui.screens-contents.settings-history-storage")}>
      <Group>
        <SettingRow
          label={t("ui.screens-contents.settings-places-history")}
          desc={t("ui.screens-contents.settings-count-most-limit-saved", {
            count: value.historyCount,
            limit: value.historyLimit || "—",
          })}
          control={
            <Field label={t("ui.screens-contents.settings-maximum")} error={value.error}>
              {(id) => (
                <input
                  id={id}
                  className="t-input t-c-num-input"
                  inputMode="numeric"
                  value={value.historyLimit}
                  aria-invalid={!!value.error || undefined}
                  onChange={(e) => onChange?.({ historyLimit: e.target.value })}
                />
              )}
            </Field>
          }
        />
        <SettingRow
          label={t("ui.screens-contents.settings-restore-last-opened-place")}
          control={
            <Switch
              label={t("ui.screens-contents.settings-restore-place")}
              checked={value.restoreLast}
              onChange={(v) => onChange?.({ restoreLast: v })}
            />
          }
        />
        <SettingRow
          label={t("ui.screens-contents.settings-keep-chat-sessions")}
          desc={t("ui.screens-contents.settings-off-sessions-end-tab")}
          control={
            <Switch
              label={t("ui.screens-contents.settings-keep-chat-sessions")}
              checked={value.keepChat}
              onChange={(v) => onChange?.({ keepChat: v })}
            />
          }
        />
      </Group>
      <Group title={t("ui.screens-contents.settings-saved-browser-size", { size: kb(total) })}>
        <ul className="t-c-plain" data-testid="storage-items">
          {value.items.map((i) => {
            const contents =
              i.contents ?? plural("ui.screens-contents.settings-count-entries", i.entries);
            return (
              <li key={i.key} className="t-c-setrow" data-testid="storage-item">
                <div className="t-stack" style={{ gap: 2, minWidth: 0 }}>
                  <span className="t-c-setrow__label t-wrap">{i.label}</span>
                  <span className="t-row t-row--wrap" style={{ gap: 6 }}>
                    <span className="t-badge t-badge--plain" data-testid="storage-item-contents">
                      {contents}
                    </span>
                    <span className="t-meta t-wrap">
                      {kb(i.bytes)} · <span className="t-mono">{i.key}</span>
                    </span>
                  </span>
                </div>
                <Button
                  size="small"
                  variant="quiet"
                  icon="trash"
                  aria-label={t("ui.screens-contents.settings-clear-what-contents", {
                    what: i.label,
                    contents,
                  })}
                  onClick={() => onClear?.(i.key)}
                >
                  {t("ui.screens-contents.settings-clear")}
                </Button>
              </li>
            );
          })}
        </ul>
      </Group>
      <div className="t-row">
        <span className="t-spacer" />
        <Button
          variant="danger"
          icon="trash"
          disabled={!value.items.length}
          onClick={() => onClear?.("*")}
        >
          {t("ui.screens-contents.settings-clear-all-count-size", {
            count: number(value.items.length),
            size: kb(total),
          })}
        </Button>
      </div>
    </SettingsSection>
  );
}

/** Atlas AI ------------------------------------------------------------------------- */

export type AiSettings = {
  state: "ready" | "signed-out";
  account?: string;
  model: string;
  models: string[];
  mode: "read" | "explain";
  /** `fixed`: the binary sets this tool's state and nothing in the reader moves it;
   * `false` names a tool whose state a grant or the project changes; absent is unmeasured. */

  tools: { name: string; allowed: boolean; fixed?: boolean }[];
  lastCheck: string;
  /** How the host starts the companion apart from the project's session
   * configuration: the flag it passes and what that leaves out, as the host
   * reports them. Absent: the host reported nothing, so nothing is said. */

  isolation?: { flag: string; drops: string[] };
};

const ISOLATION_DROP: Record<string, TextKey> = {
  hooks: "ui.screens-contents.settings-hooks",
  plugins: "ui.screens-contents.settings-plugins",
  mcp: "ui.screens-contents.settings-mcp-servers",
  instructions: "ui.screens-contents.settings-claude-md",
};

export function AiSection({
  value,
  onChange,
  onCheck,
  onCopy,
}: {
  value: AiSettings;
  onChange?: (patch: Partial<AiSettings>) => void;
  onCheck?: () => void;
  onCopy?: (t: string) => void;
}) {
  const { t } = useText();
  const signedOut = value.state === "signed-out";
  return (
    <SettingsSection
      title={t("ui.screens-contents.settings-atlas-ai")}
      sub={t("ui.screens-contents.settings-ask-atlas-uses-claude-credentials")}
      actions={
        onCheck ? (
          <Button size="small" icon="refresh" onClick={onCheck}>
            {t("ui.screens-contents.settings-check-again")}
          </Button>
        ) : undefined
      }
    >
      {signedOut ? (
        <div className="t-c-banner t-c-banner--warn" role="status" data-testid="ai-signed-out">
          <Icon name="lock" size={18} />
          <div className="t-stack" style={{ gap: 6, flex: 1 }}>
            <span className="t-h3">{t("ui.screens-contents.settings-not-signed")}</span>
            <span className="t-c-small">
              {t("ui.screens-contents.settings-sign-host-s-terminal-then-check")}
            </span>
            <Command text="claude login" onCopy={onCopy} />
            <span className="t-meta">
              {t("ui.screens-contents.settings-last-checked-when", { when: value.lastCheck })}
            </span>
          </div>
        </div>
      ) : (
        <div className="t-c-banner t-c-banner--ok" role="status" data-testid="ai-ready">
          <Icon name="check" size={18} />
          <div className="t-stack" style={{ gap: 2, flex: 1 }}>
            <span className="t-h3">{t("ui.screens-contents.settings-signed")}</span>
            <span className="t-meta">
              {value.account} ·{" "}
              {t("ui.screens-contents.settings-checked-when", { when: value.lastCheck })}
            </span>
          </div>
        </div>
      )}
      <fieldset className="t-c-fieldset" disabled={signedOut}>
        {/** Without `onChange` nothing here is a choice: the model stands as the host
         *             reports it, and no control offers what nothing would carry out. */}
        {onChange ? (
          <Group>
            <SettingRow
              label={t("ui.screens-contents.settings-model")}
              control={
                <select
                  className="t-select"
                  aria-label={t("ui.screens-contents.settings-model")}
                  value={value.model}
                  onChange={(e) => onChange({ model: e.target.value })}
                >
                  {value.models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              }
            />
            <SettingRow
              label={t("ui.screens-contents.settings-default-mode")}
              control={
                <Segment
                  label={t("ui.screens-contents.settings-default-mode")}
                  value={value.mode}
                  options={[
                    { value: "read", label: t("ui.screens-contents.settings-read") },
                    { value: "explain", label: t("ui.screens-contents.settings-explain") },
                  ]}
                  onChange={(v) => onChange({ mode: v })}
                />
              }
            />
          </Group>
        ) : (
          <Group>
            <SettingRow
              label={t("ui.screens-contents.settings-model")}
              control={
                <span className="t-mono" data-testid="ai-model">
                  {value.model || "—"}
                </span>
              }
            />
          </Group>
        )}
        <Group title={t("ui.screens-contents.settings-agent-tools")}>
          <ul className="t-c-plain t-c-tools">
            {value.tools.map((tool) => (
              <li key={tool.name} className="t-row">
                <Icon
                  name={tool.allowed ? "check" : "lock"}
                  size={14}
                  className={tool.allowed ? "t-ok" : "t-muted"}
                />
                <span className="t-mono">{tool.name}</span>
                <span className="t-spacer" />
                <span className={tool.allowed ? "t-badge t-badge--ok" : "t-badge t-badge--plain"}>
                  {tool.allowed
                    ? t("ui.screens-contents.settings-allowed")
                    : t("ui.screens-contents.settings-blocked")}
                </span>
                {tool.fixed == null ? (
                  <span
                    className="t-meta t-c-tools__change"
                    title={t("ui.screens-contents.settings-not-measured")}
                    data-testid="ai-tool-change"
                  >
                    —
                  </span>
                ) : (
                  <span
                    className="t-meta t-c-tools__change"
                    data-testid="ai-tool-change"
                    data-fixed={tool.fixed || undefined}
                  >
                    <Icon name={tool.fixed ? "lock" : "edit"} size={12} />
                    {tool.fixed
                      ? t("ui.screens-contents.settings-settled")
                      : t("ui.screens-contents.settings-changeable")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Group>
        {value.isolation ? (
          <Group title={t("ui.screens-contents.settings-session-configuration")}>
            <p className="t-c-small" data-testid="ai-isolation">
              <span className="t-mono">{value.isolation.flag}</span>{" "}
              {t("ui.screens-contents.settings-agent-starts-without-drops", {
                drops: value.isolation.drops
                  .map((d) => (ISOLATION_DROP[d] ? t(ISOLATION_DROP[d]) : d))
                  .join(", "),
              })}
            </p>
          </Group>
        ) : null}
      </fieldset>
    </SettingsSection>
  );
}

/** Git provider -------------------------------------------------------------------- */

export type GitProviderSettings = {
  /** `unanswered`: no answer about the repository is in hand, so nothing is claimed about it. */
  state: "ok" | "no-remote" | "unanswered";
  remote: string;
  provider: "github" | "gitlab" | "gitea" | "other";
  branch: string;
  branchPrefix: string;
  prDraft: boolean;
  codeLinks: boolean;
  manualUrl: string;
  error?: string;
};

export function GitProviderSection({
  value,
  onChange,
  onCopy,
  onTest,
}: {
  value: GitProviderSettings;
  onChange?: (patch: Partial<GitProviderSettings>) => void;
  onCopy?: (t: string) => void;
  onTest?: () => void;
}) {
  const { t } = useText();
  const none = value.state === "no-remote";
  if (value.state === "unanswered")
    return (
      <SettingsSection
        title={t("ui.screens-contents.settings-git-provider")}
        sub={t("ui.screens-contents.settings-where-links-into-repository-pull-requests")}
      >
        <div data-testid="git-provider-unanswered">
          <EmptyState
            icon="info"
            title={t("ui.screens-contents.settings-no-answer-host")}
            body={value.error ? <span className="t-mono">{value.error}</span> : undefined}
          />
        </div>
      </SettingsSection>
    );
  return (
    <SettingsSection
      title={t("ui.screens-contents.settings-git-provider")}
      sub={t("ui.screens-contents.settings-where-links-into-repository-pull-requests")}
    >
      {none ? (
        <div
          className="t-c-banner t-c-banner--warn"
          role="status"
          data-testid="git-provider-no-remote"
        >
          <Icon name="warning" size={18} />
          <div className="t-stack" style={{ gap: 6, flex: 1 }}>
            <span className="t-h3">{t("ui.screens-contents.settings-no-remote-set")}</span>
            <span className="t-c-small">
              {t("ui.screens-contents.settings-without-remote-there-no-code-links")}
            </span>
            <Command text="git remote add origin <url>" onCopy={onCopy} />
          </div>
        </div>
      ) : (
        <Group title={t("ui.screens-contents.settings-detected")}>
          <KeyValues
            items={[
              [
                "Remote",
                <span className="t-mono" key="r">
                  {value.remote}
                </span>,
              ],
              ["Git provider", value.provider],
              [
                "Branch",
                <span className="t-mono" key="b">
                  {value.branch}
                </span>,
              ],
            ]}
          />
        </Group>
      )}
      <Group>
        {none ? (
          <SettingRow
            stacked
            label={t("ui.screens-contents.settings-base-url-hand")}
            desc={t("ui.screens-contents.settings-only-links-proposals-need-real-remote")}
            control={
              <Field label={t("ui.screens-contents.settings-base-url")} error={value.error}>
                {(id) => (
                  <input
                    id={id}
                    className="t-input"
                    placeholder={t("ui.screens-contents.settings-https-github-com-owner-repo")}
                    value={value.manualUrl}
                    aria-invalid={!!value.error || undefined}
                    onChange={(e) => onChange?.({ manualUrl: e.target.value })}
                  />
                )}
              </Field>
            }
          />
        ) : null}
        <SettingRow
          label="Git provider"
          control={
            <Segment
              label="Git provider"
              value={value.provider}
              options={[
                { value: "github", label: "GitHub" },
                { value: "gitlab", label: "GitLab" },
                { value: "gitea", label: "Gitea" },
                { value: "other", label: t("ui.screens-contents.settings-other") },
              ]}
              onChange={(v) => onChange?.({ provider: v })}
            />
          }
        />
        <SettingRow
          label={t("ui.screens-contents.settings-prefix-proposal-branches")}
          control={
            <input
              className="t-input t-mono"
              aria-label={t("ui.screens-contents.settings-prefix-proposal-branches")}
              value={value.branchPrefix}
              disabled={none}
              onChange={(e) => onChange?.({ branchPrefix: e.target.value })}
            />
          }
        />
        <SettingRow
          label={t("ui.screens-contents.settings-pull-requests-drafts")}
          control={
            <Switch
              label={t("ui.screens-contents.settings-draft")}
              disabled={none}
              checked={value.prDraft}
              onChange={(v) => onChange?.({ prDraft: v })}
            />
          }
        />
        <SettingRow
          label={t("ui.screens-contents.settings-link-code-references")}
          control={
            <Switch
              label={t("ui.screens-contents.settings-link-code-references")}
              checked={value.codeLinks}
              onChange={(v) => onChange?.({ codeLinks: v })}
            />
          }
        />
      </Group>
      <div className="t-row">
        <span className="t-spacer" />
        <Button icon="link" onClick={onTest} disabled={none && !value.manualUrl}>
          {t("ui.screens-contents.settings-test-link")}
        </Button>
      </div>
    </SettingsSection>
  );
}

/** Plugins -------------------------------------------------------------------------- */

const VERIFY: Record<PluginRow["verification"], { label: TextKey; tone: string }> = {
  ok: { label: "ui.screens-contents.settings-checksum-ok", tone: "t-badge--ok" },
  mismatch: { label: "ui.screens-contents.settings-checksum-differs", tone: "t-badge--bad" },
  missing: { label: "ui.screens-contents.settings-without-checksum", tone: "t-badge--warn" },
};

const SOURCE: Record<PluginRow["source"], TextKey> = {
  bundled: "ui.screens-contents.settings-bundled",
  installed: "ui.screens-contents.settings-installed",
  development: "ui.screens-contents.settings-development",
};

const GRANT_GROUP: Record<GrantItem["group"], TextKey> = {
  Tools: "ui.screens-contents.settings-tools",
  Environment: "ui.screens-contents.settings-environment",
  "Agent tools": "ui.screens-contents.settings-agent-tools",
};

const GRANT_RISK: Record<NonNullable<GrantItem["risk"]>, TextKey> = {
  writes: "ui.screens-contents.settings-writes",
  reads: "ui.screens-contents.settings-reads",
  network: "ui.screens-contents.settings-network",
};

const GRANT_STATE: Record<GrantItem["state"], TextKey> = {
  granted: "ui.screens-contents.settings-granted",
  open: "ui.screens-contents.settings-open",
  refuses: "ui.screens-contents.settings-denied",
};

export function PluginsSection({
  plugins,
  onOpen,
  onToggle,
  onCopy,
  onReload,
}: {
  plugins: PluginRow[];
  onOpen?: (id: string) => void;
  onToggle?: (id: string, on: boolean) => void;
  onCopy?: (t: string) => void;
  /** Loads the document again, offered on a row with `reload`. */
  onReload?: () => void;
}) {
  const { t } = useText();
  return (
    <SettingsSection
      title={t("ui.screens-contents.settings-plugins-label")}
      sub={t("ui.screens-contents.settings-count-plugins-switched", {
        count: plugins.length,
        on: plugins.filter((p) => p.enabled).length,
      })}
    >
      <ul
        className="t-c-plain t-stack"
        style={{ gap: 8 }}
        aria-label={t("ui.screens-contents.settings-plugins-label")}
      >
        {plugins.map((pl) => (
          <li key={pl.id} className="t-surface t-c-plugin">
            <span className="t-c-tile__icon">
              <Icon name="plug" size={16} />
            </span>
            <div className="t-stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
              <div className="t-row t-row--wrap">
                <button type="button" className="t-c-linkish t-h3" onClick={() => onOpen?.(pl.id)}>
                  {pl.name}
                </button>
                <span className="t-meta">
                  {pl.id} · {pl.version}
                </span>
              </div>
              <span className="t-c-small t-muted">{pl.desc}</span>
              {pl.reason ? (
                <span className="t-c-small" data-testid={`plugin-reason-${pl.id}`}>
                  {pl.reason}
                </span>
              ) : null}
              {pl.themeRefusals?.map((r) => (
                <span
                  key={r.name}
                  className="t-c-small"
                  data-testid={`plugin-theme-refused-${pl.id}`}
                >
                  {t("ui.screens-contents.settings-theme-name-refused-reason", {
                    name: r.name,
                    reason: r.reason,
                  })}
                </span>
              ))}
              {pl.reload && onReload ? (
                <div className="t-row" data-testid={`plugin-reload-${pl.id}`}>
                  <Button variant="quiet" size="small" onClick={onReload}>
                    {t("ui.screens-contents.settings-reload-now")}
                  </Button>
                </div>
              ) : null}
              <div className="t-row t-row--wrap" style={{ gap: 6 }}>
                <span className="t-badge t-badge--plain">{t(SOURCE[pl.source])}</span>
                <span className={`t-badge ${VERIFY[pl.verification].tone}`}>
                  {t(VERIFY[pl.verification].label)}
                </span>
                {pl.open ? (
                  <span className="t-badge t-badge--warn">
                    {t("ui.screens-contents.settings-count-grants-open", { count: pl.open })}
                  </span>
                ) : null}
              </div>
              {pl.source !== "bundled" ? (
                <div className="t-stack" style={{ gap: 4 }} data-testid={`plugin-remove-${pl.id}`}>
                  <span className="t-c-small t-muted">
                    {t("ui.screens-contents.settings-remove-terminal")}
                  </span>
                  <Command text={`facet plugin remove ${pl.id}`} onCopy={onCopy} />
                </div>
              ) : null}
            </div>
            {pl.switchable === false ? null : (
              <Switch
                label={t("ui.screens-contents.settings-switch-name", { name: pl.name })}
                checked={pl.enabled}
                onChange={(v) => onToggle?.(pl.id, v)}
              />
            )}
          </li>
        ))}
      </ul>
      <Group title={t("ui.screens-contents.settings-install")}>
        <div className="t-stack" style={{ gap: 8, padding: "4px 16px 12px" }}>
          <Command text="facet plugin add github:facet-framework/<plugin>@<tag>" onCopy={onCopy} />
          <span className="t-c-small t-muted">
            {t("ui.screens-contents.settings-install-grant-terminal")}
          </span>
        </div>
      </Group>
    </SettingsSection>
  );
}

export type PluginManifest = {
  entry: string;
  sidecars: { name: string; sha256: string }[];
  installedAt: string;
  path: string;
};

function GrantTable({
  items,
  decide,
  onDecide,
}: {
  items: GrantItem[];
  decide?: Record<string, "grant" | "deny" | undefined>;
  onDecide?: (key: string, d: "grant" | "deny") => void;
}) {
  const { t } = useText();
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <div className="t-stack" style={{ gap: 12 }}>
      {groups.map((g) => (
        <Group key={g} title={t(GRANT_GROUP[g])}>
          <ul className="t-c-plain">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <li key={i.key} className="t-c-grant" data-testid={`grant-${i.key}`}>
                  <div className="t-stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="t-row t-row--wrap">
                      <span className="t-mono">{i.name}</span>
                      {i.risk ? (
                        <span
                          className={`t-badge ${i.risk === "reads" ? "t-badge--plain" : "t-badge--warn"}`}
                        >
                          {t(GRANT_RISK[i.risk])}
                        </span>
                      ) : null}
                    </span>
                    <span className="t-c-small t-muted">{i.why}</span>
                    <span className="t-meta">
                      {t("ui.screens-contents.settings-via-via", { via: i.via })}
                    </span>
                  </div>
                  {onDecide ? (
                    <Segment
                      label={t("ui.screens-contents.settings-decide-name", { name: i.name })}
                      value={decide?.[i.key] ?? ("" as "grant")}
                      options={[
                        {
                          value: "grant",
                          label: t("ui.screens-contents.settings-grant"),
                          icon: "check",
                        },
                        {
                          value: "deny",
                          label: t("ui.screens-contents.settings-deny"),
                          icon: "close",
                        },
                      ]}
                      onChange={(v) => onDecide(i.key, v)}
                    />
                  ) : (
                    <span
                      className={`t-badge ${i.state === "granted" ? "t-badge--ok" : i.state === "open" ? "t-badge--warn" : "t-badge--bad"}`}
                    >
                      {t(GRANT_STATE[i.state])}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </Group>
      ))}
    </div>
  );
}

export function PluginDetailSection({
  plugin,
  manifest,
  grants,
  onBack,
  onCopy,
  onOpenGrant,
}: {
  plugin: PluginRow;
  manifest: PluginManifest;
  grants: GrantItem[];
  onBack?: () => void;
  onCopy?: (t: string) => void;
  onOpenGrant?: () => void;
}) {
  const { t } = useText();
  const open = grants.filter((g) => g.state === "open").length;
  return (
    <SettingsSection
      title={plugin.name}
      sub={`${plugin.id} · ${plugin.version} · ${t(SOURCE[plugin.source])}`}
      actions={
        <Button size="small" variant="quiet" icon="back" onClick={onBack}>
          {t("ui.screens-contents.settings-all-plugins")}
        </Button>
      }
    >
      <p className="t-c-small t-ink2">{plugin.desc}</p>
      <Group title={t("ui.screens-contents.settings-package")}>
        <KeyValues
          items={[
            [
              t("ui.screens-contents.settings-entry"),
              <span className="t-mono" key="e">
                {manifest.entry}
              </span>,
            ],
            [
              t("ui.screens-contents.settings-location"),
              <span className="t-mono" key="p">
                {manifest.path}
              </span>,
            ],
            [t("ui.screens-contents.settings-installed-plugindetailsection"), manifest.installedAt],
            [
              t("ui.screens-contents.settings-verification"),
              <span key="v" className={`t-badge ${VERIFY[plugin.verification].tone}`}>
                {t(VERIFY[plugin.verification].label)}
              </span>,
            ],
            ...manifest.sidecars.map((s): [ReactNode, ReactNode] => [
              `Sidecar ${s.name}`,
              <span className="t-mono t-c-small" key={s.name} title={s.sha256}>
                {t("ui.screens-contents.settings-sha256")}
                {/** i18n-spacing: joined */}
                {s.sha256.slice(0, 16)}…
              </span>,
            ]),
          ]}
        />
      </Group>
      <div className="t-row t-row--wrap">
        <span className="t-h3">{t("ui.screens-contents.settings-requested-granted")}</span>
        <span className="t-meta">
          {t("ui.screens-contents.settings-granted-granted-open-open", {
            granted: grants.length - open,
            open,
          })}
        </span>
      </div>
      <GrantTable items={grants} />
      {open ? (
        <div className="t-c-banner t-c-banner--warn" role="status" data-testid="plugin-open-grants">
          <Icon name="lock" size={18} />
          <div className="t-stack" style={{ gap: 6, flex: 1 }}>
            <span className="t-h3">
              {t("ui.screens-contents.settings-count-grants-open", { count: open })}
            </span>
            <span className="t-c-small">
              {t("ui.screens-contents.settings-granting-asks-terminal-group-group")}
            </span>
            <Command text={`facet plugin grant ${plugin.id}`} onCopy={onCopy} />
            <span>
              <Button size="small" icon="external" onClick={onOpenGrant}>
                {t("ui.screens-contents.settings-open-grant-page")}
              </Button>
            </span>
          </div>
        </div>
      ) : null}
      <Group title={t("ui.screens-contents.settings-remove")}>
        <div style={{ padding: "4px 16px 12px" }}>
          <Command text={`facet plugin remove ${plugin.id}`} onCopy={onCopy} />
        </div>
      </Group>
    </SettingsSection>
  );
}

/** The grant page (ADR 0006, stage 2): its own origin, opened through a one-time
 * link from the terminal. Each requested item is granted or denied on its own. */

export function PluginGrantSection({
  plugin,
  items,
  decisions,
  token,
  onDecide,
  onConfirm,
  onCancel,
}: {
  plugin: PluginRow;
  items: GrantItem[];
  decisions: Record<string, "grant" | "deny" | undefined>;
  token: { valid: boolean; until: string; origin: string };
  onDecide?: (key: string, d: "grant" | "deny") => void;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const { t } = useText();
  const decided = items.filter((i) => decisions[i.key]).length;
  const granted = items.filter((i) => decisions[i.key] === "grant").length;
  return (
    <SettingsSection
      title={t("ui.screens-contents.settings-grant-name", { name: plugin.name })}
      sub={t("ui.screens-contents.settings-id-version-requests-count-permissions", {
        id: plugin.id,
        version: plugin.version,
        count: items.length,
      })}
    >
      <div
        className={token.valid ? "t-c-banner t-c-banner--ok" : "t-c-banner t-c-banner--warn"}
        role="status"
        data-testid="grant-token"
      >
        <Icon name={token.valid ? "lock" : "warning"} size={18} />
        <div className="t-stack" style={{ gap: 2, flex: 1 }}>
          <span className="t-h3">
            {token.valid
              ? t("ui.screens-contents.settings-opened-through-link-terminal")
              : t("ui.screens-contents.settings-open-link-terminal")}
          </span>
          <span className="t-meta">
            {token.origin} ·{" "}
            {token.valid
              ? t("ui.screens-contents.settings-valid-until-until", { until: token.until })
              : t("ui.screens-contents.settings-no-one-time-token")}
          </span>
        </div>
      </div>
      {token.valid ? (
        <>
          <GrantTable items={items} decide={decisions} onDecide={onDecide} />
          <div className="t-c-grantfoot t-raised">
            <span className="t-c-small">
              {t("ui.screens-contents.settings-decided-total-decided-granted-granted", {
                decided,
                total: items.length,
                granted,
              })}
            </span>
            <span className="t-spacer" />
            <Button variant="quiet" onClick={onCancel}>
              {t("ui.screens-contents.settings-cancel")}
            </Button>
            <Button
              variant="primary"
              icon="check"
              disabled={decided < items.length}
              onClick={onConfirm}
            >
              {t("ui.screens-contents.settings-save-decision")}
            </Button>
          </div>
        </>
      ) : (
        <GrantTable items={items} />
      )}
    </SettingsSection>
  );
}

/** Generative UI --------------------------------------------------------------------- */

export type GenUiSettings = {
  enabled: boolean;
  scope: "components" | "free";
  surfaces: { key: string; label: string; desc: string; on: boolean }[];
  maxBlocks: string;
  error?: string;
};

export function GenUiSection({
  value,
  onChange,
}: {
  value: GenUiSettings;
  onChange?: (patch: Partial<GenUiSettings>) => void;
}) {
  const { t } = useText();
  return (
    <SettingsSection
      title={t("ui.screens-contents.settings-generative-ui")}
      sub={t("ui.screens-contents.settings-answers-may-show-views-built-facet")}
    >
      <Group>
        <SettingRow
          label={t("ui.screens-contents.settings-views-answers")}
          control={
            <Switch
              label={t("ui.screens-contents.settings-views-answers")}
              checked={value.enabled}
              onChange={(v) => onChange?.({ enabled: v })}
            />
          }
        />
        <SettingRow
          label={t("ui.screens-contents.settings-what-built")}
          desc={t("ui.screens-contents.settings-free-means-own-markup-inside-closed")}
          control={
            <Segment
              label={t("ui.screens-contents.settings-what-built")}
              value={value.scope}
              options={[
                { value: "components", label: t("ui.screens-contents.settings-blocks-only") },
                { value: "free", label: t("ui.screens-contents.settings-free") },
              ]}
              onChange={(v) => onChange?.({ scope: v })}
            />
          }
        />
        <SettingRow
          label={t("ui.screens-contents.settings-most-blocks-per-answer")}
          control={
            <Field label={t("ui.screens-contents.settings-count")} error={value.error}>
              {(id) => (
                <input
                  id={id}
                  className="t-input t-c-num-input"
                  inputMode="numeric"
                  value={value.maxBlocks}
                  disabled={!value.enabled}
                  aria-invalid={!!value.error || undefined}
                  onChange={(e) => onChange?.({ maxBlocks: e.target.value })}
                />
              )}
            </Field>
          }
        />
      </Group>
      <Group title={t("ui.screens-contents.settings-where")}>
        {value.surfaces.map((s) => (
          <SettingRow
            key={s.key}
            label={s.label}
            desc={s.desc}
            control={
              <Switch
                label={s.label}
                disabled={!value.enabled}
                checked={value.enabled && s.on}
                onChange={(v) =>
                  onChange?.({
                    surfaces: value.surfaces.map((x) => (x.key === s.key ? { ...x, on: v } : x)),
                  })
                }
              />
            }
          />
        ))}
      </Group>
    </SettingsSection>
  );
}
