import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Product code uses the FACET design-system name in imports and labels. */

const REPO = join(__dirname, "..", "..");

/** The trees scanned, relative to the repository root. */
const TREES = [
  "frontend/src",
  "frontend/scripts",
  "plugins",
  "backend/server",
  "scripts",
  "backend/cmd",
  "backend/internal",
  "docs",
  ".github",
];

/** Built output and installed packages are not sources. */
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", ".next", "coverage", "assets"]);
const SOURCE = /\.(?:[cm]?[jt]sx?|json|css|md|ya?ml|html|go|sh)$/;

/** Every word that contains the title, case-insensitive. */
const WORD = new RegExp("[A-Za-z]*" + ["tie", "fe"].join("") + "[A-Za-z]*", "gi");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIPPED_DIRS.has(name) ? [] : walk(path);
    return SOURCE.test(name) ? [path] : [];
  });
}

const scanned = TREES.filter((tree) => existsSync(join(REPO, tree)))
  .flatMap((tree) => walk(join(REPO, tree)))
  .map((path) => relative(REPO, path).split(sep).join("/"));

const found: Record<string, string[]> = {};
for (const file of scanned) {
  const words = (
    file +
    "\n" +
    readFileSync(join(REPO, file), "utf8").replace(
      file.endsWith("/locales/de.json") ? /"[^"\n]*depth[^"\n]*": "[^"]+"/g : /$a/,
      "",
    )
  ).match(WORD);
  if (words) found[file] = [...words].sort();
}

describe("the design system's name", () => {
  it("scans product source and scripts", () => {
    expect(scanned.length).toBeGreaterThan(250);
    expect(scanned).toContain("frontend/src/i18n/locales/de.json");
  });
  it("forbids the internal design-system name everywhere", () => {
    expect(found).toEqual({});
  });
});
