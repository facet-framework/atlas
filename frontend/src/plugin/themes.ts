/** A plugin's theme: a palette of the FACET design system, chosen in the
 * reader beside FACET and Paper. */

/** The palette tokens of the FACET design system a plugin may set. Every
 * palette block of facet-ui's tokens.css sets each of them (themes.spec reads
 * the file and compares), so a name here is one the design system answers. */

export const THEME_TOKENS = [
  "--t-ground",
  "--t-ground-2",
  "--t-surface",
  "--t-raised",
  "--t-float",
  "--t-sunken",
  "--t-line",
  "--t-line-strong",
  "--t-ink",
  "--t-ink-2",
  "--t-muted",
  "--t-faint",
  "--t-signal",
  "--t-signal-ink",
  "--t-signal-wash",
  "--t-ok",
  "--t-ok-wash",
  "--t-warn",
  "--t-warn-wash",
  "--t-plan",
  "--t-plan-wash",
  "--t-bad",
  "--t-bad-wash",
  "--t-series-1",
  "--t-series-2",
  "--t-series-3",
  "--t-series-4",
  "--t-scrim",
  "--t-shadow-1",
  "--t-shadow-2",
  "--t-shadow-3",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

/** Palette tokens a plugin does not set itself: gradients the host computes
 * from a colour (`--t-glow`) or takes from the base (`--t-dots`). They still
 * belong to a palette, so the base supplies them. */

const BASE_ONLY = ["--t-glow", "--t-dots"] as const;

/** Every token a palette block carries: what the base is measured for. */
export const PALETTE_TOKENS: readonly string[] = [...THEME_TOKENS, ...BASE_ONLY];

/** The two versions of a palette, as `data-t-mode` names them. */
export type ThemeMode = "light" | "dark";

/** A plugin's theme: the design-system tokens it sets for each version. Both
 * versions are required; light and dark are one switch in this reader. */

export type PluginTheme = {
  /** The name the theme choice shows; the theme's own name when absent. */
  label?: string;
  light: Readonly<Partial<Record<ThemeToken, string>>>;
  dark: Readonly<Partial<Record<ThemeToken, string>>>;
};

/** Colours, not expressions. */

export function isColour(value: string): boolean {
  const v = value.trim();
  if (v === "" || v.length > 64) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return true;
  if (/^[a-z]+$/i.test(v)) return true;
  return /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-z%.,\s/+-]*\)$/i.test(v);
}

/** A shadow list: per layer an optional `inset`, two to four lengths and a
 * colour from the grammar above. `none` is a shadow too. */

export function isShadow(value: string): boolean {
  const v = value.trim();
  if (v === "none") return true;
  if (v === "" || v.length > 240) return false;
  // Split on commas outside a colour function's parentheses.
  const layers: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "(") depth++;
    else if (v[i] === ")") depth--;
    else if (v[i] === "," && depth === 0) {
      layers.push(v.slice(start, i));
      start = i + 1;
    }
  }
  layers.push(v.slice(start));
  const length = /^-?(\d+(\.\d+)?|\.\d+)(px)?$/;
  return layers.every((layer) => {
    const m = /^\s*(inset\s+)?((?:-?[\d.]+(?:px)?\s+){1,3}-?[\d.]+(?:px)?)\s+(.+?)\s*$/.exec(layer);
    if (!m) return false;
    return (
      m[2]
        .trim()
        .split(/\s+/)
        .every((n) => length.test(n)) && isColour(m[3])
    );
  });
}

/** The palette value a plugin's theme is chosen by: the plugin's id, a colon,
 * the theme's name. The id keeps two plugins from colliding, and a reader
 * looking at `data-t-theme` can see whose theme is on. */

export function themeId(plugin: string, name: string): string {
  return `${plugin}:${name}`;
}

/** Whether a palette value names a plugin's theme (as opposed to FACET or Paper). */
export function isPluginThemeId(value: string): boolean {
  return /^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$/.test(value);
}

/** Tones the design system computes from a colour: a plugin that sets the
 * colour and not the tone gets the tone mixed from it, per version, in the
 * shares FACET's own palette uses. Otherwise the selection would keep
 * glowing in the base palette's colour. */

const DERIVED: readonly (readonly [ThemeToken, ThemeToken, number, number])[] = [
  // [tone, colour it is mixed from, share in light, share in dark]
  ["--t-signal-wash", "--t-signal", 10, 14],
  ["--t-ok-wash", "--t-ok", 10, 14],
  ["--t-warn-wash", "--t-warn", 10, 14],
  ["--t-plan-wash", "--t-plan", 12, 14],
  ["--t-bad-wash", "--t-bad", 10, 14],
];

/** The base palette of one version, token by token. */
export type ThemeBase = (mode: ThemeMode) => Readonly<Record<string, string>>;

/** FACET's palette as the stylesheet in this document draws it, measured on a
 * detached probe: the tokens a plugin theme does not set come from here, so
 * the design system's own file stays the one place they are written. */

export function measureBase(mode: ThemeMode): Record<string, string> {
  const doc = globalThis.document;
  if (!doc) return {};
  const probe = doc.createElement("span");
  probe.setAttribute("data-t-theme", "facet");
  probe.setAttribute("data-t-mode", mode);
  probe.hidden = true;
  (doc.body ?? doc.documentElement).appendChild(probe);
  const style = getComputedStyle(probe);
  const out: Record<string, string> = {};
  for (const token of PALETTE_TOKENS) {
    const value = style.getPropertyValue(token).trim();
    if (value) out[token] = value;
  }
  probe.remove();
  return out;
}

/** The declarations of one version: base, then derived tones, then what the plugin set. */
function versionBlock(
  given: Readonly<Record<string, string>>,
  base: Readonly<Record<string, string>>,
  mode: ThemeMode,
): string {
  // A base value goes into a rule too: nothing that could end it.
  const values: Record<string, string> = Object.fromEntries(
    Object.entries(base).filter(
      ([token, value]) => PALETTE_TOKENS.includes(token) && !/[{};<>\\]/.test(value),
    ),
  );
  for (const [tone, from, light, dark] of DERIVED)
    if (given[from] && !given[tone])
      values[tone] =
        `color-mix(in srgb,${given[from]} ${mode === "light" ? light : dark}%,transparent)`;
  if (given["--t-signal"])
    values["--t-glow"] =
      `radial-gradient(1200px 600px at 20% -10%,color-mix(in srgb,${given["--t-signal"]} ${mode === "light" ? 7 : 8}%,transparent),transparent 60%)`;
  Object.assign(values, given);
  return [
    ...Object.entries(values).map(([token, value]) => `${token}:${value}`),
    `color-scheme:${mode === "light" ? "light" : "dark"}`,
  ].join(";");
}

const NAME = /^[a-z][a-z0-9-]{0,31}$/;

/** The stylesheet text for a plugin's theme, or the reason there is none. */

export function themeSheetCSS(
  plugin: string,
  name: string,
  theme: PluginTheme,
  base: ThemeBase = measureBase,
): { css: string } | { refused: string } {
  if (!NAME.test(plugin)) return { refused: `plugin id ${plugin} is not a name` };
  if (!NAME.test(name)) return { refused: `theme name ${name} is not a name` };
  if (!theme || typeof theme !== "object" || !theme.light || !theme.dark)
    return { refused: "a theme needs a light and a dark side" };

  for (const [side, tokens] of [
    ["light", theme.light],
    ["dark", theme.dark],
  ] as const) {
    const names = Object.keys(tokens);
    if (names.length === 0) return { refused: `the ${side} side sets no token` };
    for (const token of names) {
      if (!(THEME_TOKENS as readonly string[]).includes(token)) {
        return { refused: `${token} is not a token this host defines` };
      }
      const value = String((tokens as Record<string, unknown>)[token]);
      const ok = /^--t-shadow-/.test(token) ? isShadow(value) : isColour(value);
      if (!ok)
        return {
          refused: `the value of ${token} is not a ${/shadow/.test(token) ? "shadow" : "colour"}`,
        };
    }
  }

  const selector = `[data-t-theme="${themeId(plugin, name)}"]`;
  return {
    css: [
      `${selector}[data-t-mode="light"]{${versionBlock(theme.light, base("light"), "light")}}`,
      `${selector}[data-t-mode="dark"]{${versionBlock(theme.dark, base("dark"), "dark")}}`,
    ].join("\n"),
  };
}

export function adoptConstructedSheet(css: string): (() => void) | string {
  const doc = globalThis.document;
  if (!doc) return "there is no document";
  if (typeof CSSStyleSheet === "undefined" || !("replaceSync" in CSSStyleSheet.prototype)) {
    return "this browser cannot adopt a constructed stylesheet";
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  return () => {
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
  };
}

/** What a plugin gets back: its theme's palette value and the way to take it away, or the reason. */
export type ThemeHandle = { theme: string; remove: () => void } | { refused: string };

/** A theme the reader can choose. */
export type ContributedTheme = {
  /** The `data-t-theme` value: `<plugin>:<name>`. */
  id: string;
  plugin: string;
  name: string;
  /** What the theme choice shows. */
  label: string;
};

/** A theme the host refused, kept so the plugins list can say why. */
export type ThemeRefusal = { name: string; reason: string };

/** The themes plugins contributed to one host, and the ones it refused. */

// @facet: customization/themes/plugin-themes
// @facet-role: primary
export class ThemeRegistry {
  private readonly themes = new Map<string, ContributedTheme>();
  private readonly refusals = new Map<string, ThemeRefusal[]>();

  constructor(
    private readonly changed: () => void = () => {},
    private readonly adopt: (css: string) => (() => void) | string = adoptConstructedSheet,
    private readonly base: ThemeBase = measureBase,
  ) {}

  contribute(plugin: string, name: string, theme: PluginTheme): ThemeHandle {
    const refuse = (reason: string): ThemeHandle => {
      this.refusals.set(plugin, [...(this.refusals.get(plugin) ?? []), { name, reason }]);
      this.changed();
      // The refusal names the theme: a plugin with two themes is told which
      // one did not take, and a test can see which id the host bound.
      return { refused: `${themeId(plugin, name)}: ${reason}` };
    };
    const id = themeId(plugin, name);
    if (this.themes.has(id)) return refuse("this plugin already contributed a theme of that name");
    const built = themeSheetCSS(plugin, name, theme, this.base);
    if ("refused" in built) return refuse(built.refused);
    const undo = this.adopt(built.css);
    if (typeof undo === "string") return refuse(undo);
    const label =
      typeof theme.label === "string" && theme.label.trim()
        ? theme.label.trim().slice(0, 40)
        : name;
    this.themes.set(id, { id, plugin, name, label });
    this.changed();
    return {
      theme: id,
      remove: () => {
        if (!this.themes.delete(id)) return;
        undo();
        this.changed();
      },
    };
  }

  /** The contributed themes, in the order they arrived. */
  list(): readonly ContributedTheme[] {
    return [...this.themes.values()];
  }

  has(id: string): boolean {
    return this.themes.has(id);
  }

  /** The themes refused from one plugin, with the reason. */
  refusedFor(plugin: string): readonly ThemeRefusal[] {
    return this.refusals.get(plugin) ?? [];
  }

  /** Every plugin with a refused theme. */
  refused(): Readonly<Record<string, readonly ThemeRefusal[]>> {
    return Object.fromEntries(this.refusals);
  }
}

/** The palette the reader draws for a stored choice: FACET and Paper as they
 * are, a plugin's theme while a loaded plugin contributes it, FACET for
 * anything else — a plugin switched off or gone, or not loaded yet. */

// @facet: customization/themes/theme-palette
// @facet-role: primary
export function drawnPalette(stored: string, contributed: (id: string) => boolean): string {
  if (stored === "facet" || stored === "paper") return stored;
  return isPluginThemeId(stored) && contributed(stored) ? stored : "facet";
}
