import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Product code uses current reader names in addresses, identifiers, i18n keys,
 * storage keys, test ids and records. */

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
const SKIPPED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "assets",
  "schema",
]);
const SOURCE = /\.(?:[cm]?[jt]sx?|json|css|md|ya?ml|html|go|sh|feature)$/;

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

const WORD = new RegExp("\\bv[23]\\b|V[23](?![0-9])|v[23](?=[A-Z_])|atlas[0-9]+", "g");

const found: Record<string, string[]> = {};
for (const file of scanned) {
  const words = (
    file +
    "\n" +
    readFileSync(join(REPO, file), "utf8")
      .replace(/gopkg\.in\/yaml\.v[0-9]+/g, "")
      .replace(/github\.com\/JohannesKaufmann\/html-to-markdown\/v[2]/g, "")
      .replace(/\/(?:wiki\/)?api\/v[2](?=\/)/g, "")
      .replace(
        file.startsWith("plugins/wiki/sidecar/confluence/") ? /(^\s*\/\/.*)\bv[2]\b/gm : /$a/,
        "$1",
      )
  ).match(WORD);
  if (words) found[file] = [...words].sort();
}

describe("the reader's name", () => {
  it("scans product source, scripts, fixtures and source filenames", () => {
    expect(scanned.length).toBeGreaterThan(300);
    expect(scanned).toContain("frontend/src/reader/Atlas.tsx");
    expect(scanned).toContain("plugins/adr/src/entry.tsx");
  });
  it("detects labels, keys, paths and identifier suffixes", () => {
    for (const number of [2, 3]) {
      const label = "v" + number;
      for (const value of [
        label,
        "/" + label + "/records",
        "facet.atlas." + label + ".theme",
        "Atlas" + label.toUpperCase(),
        label + "Model",
      ])
        expect(value.match(WORD)).not.toBeNull();
    }
    expect('<path d="M0 0 V 3" />'.match(WORD)).toBeNull();
  });
  it("forbids internal reader version names everywhere", () => {
    expect(found).toEqual({});
  });
});
