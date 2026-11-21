import { readFileSync, readdirSync, statSync } from "node:fs";
import { WITHHELD_VERBS } from "./verbs";
import { dirname, join, resolve, sep } from "node:path";

/** The milestone's claim, made mechanical — in both directions. */

/** The reader's own source: `frontend/src`. */
const SRC = join(__dirname, "..");
const PLUGINS = join(SRC, "..", "..", "plugins");

function tsFilesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // Dependencies are outside the plugin-source audit. Prune before stat:
    // optional platform packages may legitimately be dangling symlinks.
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      tsFilesUnder(p, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Every non-spec source file of the reader. A `*.spec-support.ts(x)` file is
 * what the page specs render with (generated ADR and process content, the
 * registry snapshot, the frame around a page) and counts as a spec: the case
 * "lets only specs read spec support" below holds it to that. */

function coreFiles(): string[] {
  return tsFilesUnder(SRC).filter((p) => !/\.spec(-support)?\.tsx?$/.test(p));
}

describe("plugin boundaries", () => {
  it("lets only specs read spec support", () => {
    const support = tsFilesUnder(SRC).filter((p) => /\.spec-support\.tsx?$/.test(p));
    // The precondition: the exemption above covers a file that exists.
    expect(support.length).toBeGreaterThan(0);
    const readers = coreFiles().filter((p) =>
      /from\s+"[^"]*\.spec-support"/.test(readFileSync(p, "utf8")),
    );
    expect(readers.map((p) => p.slice(SRC.length + 1))).toEqual([]);
  });

  it("imports no plugin's internals outside the bundled catalogue", () => {
    const core = coreFiles();
    // Precondition: the reader is part of the scanned tree, so an empty result is not
    // the result of looking at an empty tree.
    expect(core.some((p) => p.includes(`${join("src", "reader")}/`))).toBe(true);
    const offenders = core.filter((file) =>
      [...readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s+)"(\.[^"]+)"/g)].some(
        ([, target]) => resolve(dirname(file), target).startsWith(PLUGINS + sep),
      ),
    );
    expect(offenders.map((p) => p.slice(SRC.length + 1))).toEqual(["plugin/official.ts"]);
  });
});

describe("the plugin reaches the host only through atlas", () => {
  /** Every module the plugin tree reaches inside `frontend/src/`. */
  function coreImports(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const p of tsFilesUnder(PLUGINS)) {
      if (p.includes("/node_modules/")) continue;
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/from "(?:\.\.\/)+frontend\/src\/([\w/.-]+)"/g)) {
        // The label layer is shared with every plugin by design and was never
        // part of this budget.
        if (m[1] === "i18n" || m[1].startsWith("i18n/")) continue;
        counts[m[1]] = (counts[m[1]] ?? 0) + 1;
      }
    }
    return counts;
  }

  it("calls no verb the rights list withholds", () => {
    const withheld = new RegExp(`\\.(${Object.keys(WITHHELD_VERBS).join("|")})\\s*\\(`);
    const hits: string[] = [];
    for (const p of tsFilesUnder(PLUGINS)) {
      if (p.includes("/node_modules/")) continue;
      const src = readFileSync(p, "utf8");
      // The verbs WITHHELD_VERBS names, called on anything. `openSheet` is the
      // one that mattered: `Reference.tsx` used it to show a glossary entry, and
      // with it held the key to the companion — the reader's own conversation.

      for (const line of src.split("\n")) {
        if (/^\s*(\/\/|\*)/.test(line)) continue;
        if (withheld.test(line)) {
          hits.push(`${p.slice(PLUGINS.length + 1)}: ${line.trim().slice(0, 60)}`);
        }
      }
    }

    // The precondition: the tree was read at all.
    expect(tsFilesUnder(PLUGINS).length).toBeGreaterThan(20);
    expect(hits).toEqual([]);
  });

  it("takes its verbs from atlas and not from the core's context", () => {
    const imports = coreImports();

    // `useNav` in a plugin component is the whole of Nav — fifteen verbs,
    // including the withheld ones. What is left are the spec fixtures that
    // still render a core component; those are counted below, not here.
    const users = tsFilesUnder(PLUGINS).filter((p) => {
      if (p.includes("/node_modules/") || /\.spec\.tsx?$/.test(p)) return false;
      // Code lines only. This file's own prose names `useNav()` to say what
      // was removed, and a check that counted that would count its own
      // explanation.
      return readFileSync(p, "utf8")
        .split("\n")
        .some((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && line.includes("useNav("));
    });

    expect(users.map((p) => p.slice(PLUGINS.length + 1))).toEqual([]);
    expect(Object.keys(imports).length).toBeGreaterThan(0);
  });

  it("imports only the shared URL validator from the reader model", () => {
    const imports = coreImports();
    const internals = Object.fromEntries(
      Object.entries(imports).filter(([mod]) => !mod.startsWith("plugin/")),
    );

    // An exact map, not an upper bound. Whoever closes one of these holes
    // edits this line, and the diff then says how much was closed — an
    // upper bound would let progress pass unrecorded and a new hole hide
    // under an old allowance.
    expect(internals).toEqual({ "model/markdown": 1 });
  });
});
