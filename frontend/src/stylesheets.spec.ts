import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function balance(css: string): {
  depth: number;
  wentNegative: boolean;
  unopenedComment: boolean;
} {
  let depth = 0;
  let wentNegative = false;
  let unopenedComment = false;
  let i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (css.startsWith("*/", i)) {
      unopenedComment = true;
      i += 2;
      continue;
    }
    const ch = css[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth < 0) wentNegative = true;
    }
    i += 1;
  }
  return { depth, wentNegative, unopenedComment };
}

function stylesheetsUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...stylesheetsUnder(path));
    else if (entry.endsWith(".css")) out.push(path);
  }
  return out;
}

const SRC = __dirname;
// The bundled plugins ship their sheets inside the reader's bundle too.
const PLUGINS = join(SRC, "..", "..", "plugins");

/** The name a sheet is reported under: relative to the reader's source, or the plugins' directory. */
function nameOf(path: string): string {
  return path.startsWith(PLUGINS)
    ? `plugins/${path.slice(PLUGINS.length + 1)}`
    : path.slice(SRC.length + 1);
}

describe("the reader's stylesheets", () => {
  // The instrument first. A balance check that cannot see an unclosed rule is
  // a green run over the defect it was written for, and there is no way to
  // tell those apart from the outside.
  it("sees an unclosed rule, and a stray closing one", () => {
    expect(balance(".a { color: red;\n.b { color: blue; }").depth).toBe(1);
    expect(balance(".a { color: red; }\n}").wentNegative).toBe(true);
    expect(balance(".a { color: red; }").depth).toBe(0);
    // A brace inside a comment is not a brace.
    expect(balance("/* } */ .a { color: red; }").depth).toBe(0);
  });

  it("sees a comment that closes without having opened", () => {
    expect(balance(".a { color: red; }\n * an example note (#42).\n */").unopenedComment).toBe(
      true,
    );
    expect(balance("/* a note */ .a { color: red; }").unopenedComment).toBe(false);
  });

  const sheets = [...stylesheetsUnder(SRC), ...stylesheetsUnder(PLUGINS)];

  // The precondition: without it, "every stylesheet balances" would also be
  // true of no stylesheet at all, which is what a moved directory would look
  // like.
  it("finds the stylesheets it is meant to check", () => {
    expect(sheets.length).toBeGreaterThan(0);
    expect(sheets.map(nameOf)).toEqual(expect.arrayContaining(["app/globals.css"]));
  });

  it.each(sheets.map((path) => [nameOf(path), path]))(
    "%s closes every rule it opens",
    (_name, path) => {
      const { depth, wentNegative, unopenedComment } = balance(readFileSync(path, "utf8"));
      expect(unopenedComment).toBe(false);
      expect(wentNegative).toBe(false);

      expect(depth).toBe(0);
    },
  );
});
