/** A plugin contributes a palette of the FACET design system — what is
 * checked, what it turns into, and where it arrives. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PluginHost, type AtlasApi } from "./host";
import {
  adoptConstructedSheet,
  drawnPalette,
  isColour,
  isPluginThemeId,
  isShadow,
  PALETTE_TOKENS,
  THEME_TOKENS,
  themeId,
  themeSheetCSS,
  ThemeRegistry,
  type PluginTheme,
} from "./themes";

const THEME: PluginTheme = {
  label: "Ocean",
  light: { "--t-ground": "#e6f4f1", "--t-ink": "#0b2a33" },
  dark: { "--t-ground": "#06222a", "--t-ink": "#d8f1f5" },
};

/** A base standing in for FACET's measured palette: one value per token, named by mode. */
const BASE = (mode: string) =>
  Object.fromEntries(PALETTE_TOKENS.map((t) => [t, `base-${mode}${t.replace("--t-", "-")}`]));

function cssOf(result: ReturnType<typeof themeSheetCSS>): string {
  if ("refused" in result) throw new Error(`refused: ${result.refused}`);
  return result.css;
}

/** The declarations of the rule whose selector ends in the given mode. */
function block(css: string, mode: "light" | "dark"): Record<string, string> {
  const rule = css.split("\n").find((r) => r.includes(`[data-t-mode="${mode}"]{`));
  if (!rule) throw new Error(`no ${mode} rule`);
  const body = rule.slice(rule.indexOf("{") + 1, rule.lastIndexOf("}"));
  return Object.fromEntries(
    body.split(";").map((d) => [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1)]),
  );
}

const NAV = {
  go: () => {},
  open: () => {},
  openScenario: () => {},
  openArea: () => {},
  closeArea: () => {},
  openSheet: () => {},
  openCatalogue: () => {},
  setRole: () => {},
};

describe("the tokens a plugin may set", () => {
  // The list has to be the design system's own, or it is a second description
  // of the same thing and the two drift.
  it("are tokens every palette block of the FACET design system sets", () => {
    const css = readFileSync(
      join(__dirname, "../../node_modules/@facet-tools/ui/dist/styles.css"),
      "utf8",
    );
    const blocks = [
      ...css.matchAll(/\[data-t-theme="([a-z]+)"\]\[data-t-mode="([a-z]+)"\]\s*\{([^}]*)\}/g),
    ];
    // The precondition: the file really carries the four palettes.
    expect(blocks.map((b) => `${b[1]}/${b[2]}`).sort()).toEqual([
      "facet/dark",
      "facet/light",
      "paper/dark",
      "paper/light",
    ]);
    for (const [, , , body] of blocks) {
      const declared = [...body.matchAll(/(--t-[a-z0-9-]+)\s*:/g)].map((m) => m[1]).sort();
      expect([...PALETTE_TOKENS].sort()).toEqual(declared);
    }
    expect(THEME_TOKENS.length).toBeGreaterThan(20);
  });
});

describe("what a theme turns into", () => {
  it("writes one rule per version under the plugin's palette value", () => {
    const css = cssOf(themeSheetCSS("probe", "ocean", THEME, BASE));

    expect(css.split("\n")).toHaveLength(2);
    expect(css).toContain('[data-t-theme="probe:ocean"][data-t-mode="light"]{');
    expect(css).toContain('[data-t-theme="probe:ocean"][data-t-mode="dark"]{');
    expect(block(css, "light")["--t-ground"]).toBe("#e6f4f1");
    expect(block(css, "dark")["--t-ground"]).toBe("#06222a");
    expect(block(css, "light")["color-scheme"]).toBe("light");
    expect(block(css, "dark")["color-scheme"]).toBe("dark");
  });

  it("applies plugin chart series colours in both palette modes", () => {
    const series = {
      "--t-series-1": "#112233",
      "--t-series-2": "#223344",
      "--t-series-3": "#334455",
      "--t-series-4": "#445566",
    };
    const css = cssOf(themeSheetCSS("probe", "ocean", { light: series, dark: series }, BASE));

    expect(block(css, "light")).toMatchObject(series);
    expect(block(css, "dark")).toMatchObject(series);
  });

  // A partial theme is the normal case: the rest is FACET's, measured, so a
  // card or the root carrying the value draws a whole palette.
  it("fills every token it does not set from the base of the same version", () => {
    const css = cssOf(themeSheetCSS("probe", "ocean", THEME, BASE));
    const light = block(css, "light");
    const dark = block(css, "dark");

    for (const token of PALETTE_TOKENS) {
      expect(light[token]).toBeDefined();
      expect(dark[token]).toBeDefined();
    }
    expect(light["--t-surface"]).toBe("base-light-surface");
    expect(dark["--t-surface"]).toBe("base-dark-surface");
    expect(css).not.toContain("undefined");
  });

  it("brings the tones computed from a colour along with it, per version", () => {
    const css = cssOf(
      themeSheetCSS(
        "probe",
        "ocean",
        { light: { "--t-signal": "#ff0000" }, dark: { "--t-signal": "#00ff00" } },
        BASE,
      ),
    );

    expect(block(css, "light")["--t-signal-wash"]).toBe(
      "color-mix(in srgb,#ff0000 10%,transparent)",
    );
    expect(block(css, "dark")["--t-signal-wash"]).toBe(
      "color-mix(in srgb,#00ff00 14%,transparent)",
    );
    expect(block(css, "light")["--t-glow"]).toContain("#ff0000");
    // A tone the plugin did not compute from stays the base's.
    expect(block(css, "light")["--t-ok-wash"]).toBe("base-light-ok-wash");
  });

  it("keeps a tone the plugin set itself", () => {
    const css = cssOf(
      themeSheetCSS(
        "probe",
        "ocean",
        {
          light: { "--t-signal": "#ff0000", "--t-signal-wash": "#ffeeee" },
          dark: { "--t-signal": "#00ff00" },
        },
        BASE,
      ),
    );
    expect(block(css, "light")["--t-signal-wash"]).toBe("#ffeeee");
  });
});

describe("what is refused", () => {
  it("refuses a token the design system does not define", () => {
    const out = themeSheetCSS(
      "probe",
      "ocean",
      { light: { "--t-font": "#fff" } as never, dark: { "--t-ink": "#000" } },
      BASE,
    );
    expect(out).toEqual({ refused: "--t-font is not a token this host defines" });
  });

  it("refuses a value that is not a colour, and one that is not a shadow", () => {
    for (const bad of ["url(https://x.test/a)", "var(--t-ink)", "red;}body{color:red", ""]) {
      const out = themeSheetCSS(
        "probe",
        "ocean",
        { light: { "--t-ink": bad }, dark: { "--t-ink": "#000" } },
        BASE,
      );
      expect("refused" in out && out.refused).toBe("the value of --t-ink is not a colour");
    }
    const shadow = themeSheetCSS(
      "probe",
      "ocean",
      { light: { "--t-shadow-1": "0 1px url(x)" }, dark: { "--t-ink": "#000" } },
      BASE,
    );
    expect("refused" in shadow && shadow.refused).toBe("the value of --t-shadow-1 is not a shadow");
  });

  it("takes the colour and shadow forms a theme is actually written in", () => {
    for (const ok of [
      "#fff",
      "#11223344",
      "rebeccapurple",
      "rgba(0, 0, 0, 0.4)",
      "oklch(70% 0.1 200)",
    ])
      expect(isColour(ok)).toBe(true);
    for (const ok of [
      "none",
      "0 1px 2px rgba(0, 0, 0, 0.4)",
      "0 8px 24px -8px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.35)",
      "inset 0 0 0 1px #123456",
    ])
      expect(isShadow(ok)).toBe(true);
  });

  it("refuses a side that sets nothing, a missing side and a name that is not a name", () => {
    expect(themeSheetCSS("probe", "ocean", { light: {}, dark: THEME.dark }, BASE)).toEqual({
      refused: "the light side sets no token",
    });
    expect(
      themeSheetCSS("probe", "ocean", { light: THEME.light } as unknown as PluginTheme, BASE),
    ).toEqual({ refused: "a theme needs a light and a dark side" });
    expect(themeSheetCSS("probe", "Ocean", THEME, BASE)).toEqual({
      refused: "theme name Ocean is not a name",
    });
  });

  // A base value comes from a stylesheet, but it still goes into a rule.
  it("leaves out a base value that could end the rule", () => {
    const css = cssOf(
      themeSheetCSS("probe", "ocean", THEME, () => ({ "--t-surface": "red}body{color:red" })),
    );
    expect(css).not.toContain("body{");
  });
});

describe("whose theme it is", () => {
  it("carries the plugin's id, so two plugins cannot collide", () => {
    expect(themeId("probe", "ocean")).toBe("probe:ocean");
    expect(themeId("other", "ocean")).not.toBe(themeId("probe", "ocean"));
    expect(cssOf(themeSheetCSS("other", "ocean", THEME, BASE))).toContain(
      '[data-t-theme="other:ocean"]',
    );
    expect(isPluginThemeId("probe:ocean")).toBe(true);
    expect(isPluginThemeId("facet")).toBe(false);
    expect(isPluginThemeId('probe:ocean"]')).toBe(false);
  });
});

describe("the palette the reader draws", () => {
  it("draws a plugin's theme only while it is contributed, and FACET otherwise", () => {
    const has = (id: string) => id === "probe:ocean";
    expect(drawnPalette("probe:ocean", has)).toBe("probe:ocean");
    expect(drawnPalette("gone:ocean", has)).toBe("facet");
    expect(drawnPalette("paper", has)).toBe("paper");
    expect(drawnPalette("vscode", has)).toBe("facet");
  });
});

describe("where it arrives", () => {
  it("is handed to a plugin under its own id, and jsdom's refusal names it", () => {
    const host = new PluginHost();
    let refused = "";
    const styles = document.querySelectorAll("style").length;

    host.load(
      "concepts",
      (atlas: AtlasApi) => {
        const out = atlas.theme.contribute("ocean", THEME);
        if ("refused" in out) refused = out.refused;
      },
      NAV,
    );

    // jsdom cannot adopt a constructed stylesheet: the refusal is the evidence
    // that the call reached the real adopter, and its prefix that the host
    // bound the id it loaded the plugin under.
    expect(refused).toBe("concepts:ocean: this browser cannot adopt a constructed stylesheet");
    expect(document.querySelectorAll("style")).toHaveLength(styles);
    expect(host.themes.list()).toEqual([]);
    expect(host.themes.refusedFor("concepts")).toEqual([
      { name: "ocean", reason: "this browser cannot adopt a constructed stylesheet" },
    ]);
    expect(adoptConstructedSheet("[data-x]{color:red}")).toBe(
      "this browser cannot adopt a constructed stylesheet",
    );
  });

  it("lists an adopted theme with its label until its handle takes it back", () => {
    const seen: string[] = [];
    let changes = 0;
    const themes = new ThemeRegistry(
      () => changes++,
      (css) => {
        seen.push(css);
        return () => seen.push("removed");
      },
      BASE,
    );

    const out = themes.contribute("probe", "ocean", THEME);
    if ("refused" in out) throw new Error(out.refused);
    expect(out.theme).toBe("probe:ocean");
    expect(seen[0]).toContain('[data-t-theme="probe:ocean"]');
    expect(themes.list()).toEqual([
      { id: "probe:ocean", plugin: "probe", name: "ocean", label: "Ocean" },
    ]);
    expect(themes.has("probe:ocean")).toBe(true);

    out.remove();
    expect(seen).toContain("removed");
    expect(themes.list()).toEqual([]);
    expect(changes).toBe(2);
  });

  it("keeps a refusal per plugin, so the plugins list can say why", () => {
    const themes = new ThemeRegistry(undefined, () => () => {}, BASE);
    const invalid = themes.contribute("probe", "invalid", {
      light: { bg: "#fff" },
      dark: { bg: "#000" },
    } as unknown as PluginTheme);
    expect("refused" in invalid && invalid.refused).toMatch(/^probe:invalid: bg is not a token/);
    expect(themes.refused()).toEqual({
      probe: [{ name: "invalid", reason: expect.stringMatching(/is not a token/) }],
    });

    themes.contribute("probe", "ocean", THEME);
    const twice = themes.contribute("probe", "ocean", THEME);
    expect("refused" in twice && twice.refused).toBe(
      "probe:ocean: this plugin already contributed a theme of that name",
    );
    expect(themes.list()).toHaveLength(1);
  });

  it("names the theme by its name when no label is given", () => {
    const themes = new ThemeRegistry(undefined, () => () => {}, BASE);
    themes.contribute("probe", "ocean", { light: THEME.light, dark: THEME.dark });
    expect(themes.list()[0].label).toBe("ocean");
  });
});
