import { de as componentDe } from "../component-text/de";
import { en as componentEn } from "../component-text/en";
/** Every literal translation key resolves and follows the caller-derived naming rule. */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import de from "./locales/de.json";
import en from "./locales/en.json";

const SRC = join(__dirname, "..");
const ROOT = join(SRC, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (["node_modules", "locales", "dist"].includes(name)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") || name.endsWith(".tsx") ? [path] : [];
  });
}

/** Collect literal hook and render-helper calls through the parser, so examples
 * in comments do not become phantom callers. The naming script also checks
 * constants and the explicit maps behind computed lookups. */

function askedFor(): { key: string; file: string; call: string }[] {
  const out: { key: string; file: string; call: string }[] = [];
  for (const file of [...sources(SRC), ...sources(join(ROOT, "plugins"))]) {
    // Specs and the data only specs read (`.spec-support`) name keys as test input.
    if (/\.spec(-support)?\.tsx?$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        /^(tx|t)$/.test(node.expression.text)
      ) {
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key))
          out.push({ key: key.text, file: relative(ROOT, file), call: node.expression.text });
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return out;
}

/** Resolves a dotted key the way i18next does: one level per dot. */
function resolve(bundle: unknown, key: string): string | undefined {
  let node: unknown = bundle;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    const object = node as Record<string, unknown>;
    const value = object[part];
    // English and German cardinal plurals require both forms. i18next resolves
    // the unsuffixed source key with count, although that key need not be stored.
    node =
      value ??
      (typeof object[part + "-one"] === "string" && typeof object[part + "-other"] === "string"
        ? object[part + "-other"]
        : undefined);
  }
  return typeof node === "string" ? node : undefined;
}

describe("every tx key resolves", () => {
  const keys = askedFor();

  it("finds keys to check at all", () => {
    // A scan that matched nothing would make every case below pass for the
    // worst possible reason.
    expect(keys.length).toBeGreaterThan(100);
  });

  it("checks both hook and render-helper translation calls", () => {
    expect(new Set(keys.map((key) => key.call))).toEqual(new Set(["t", "tx"]));
  });
  it("includes labels from the official plugins", () => {
    expect(keys.some((key) => key.file.startsWith("plugins/adr/"))).toBe(true);
    expect(keys.some((key) => key.file.startsWith("plugins/bpmn/"))).toBe(true);
  });

  it("resolves in German", () => {
    const missing = keys.filter(
      ({ key }) =>
        (key.startsWith("ui.")
          ? resolve(de, key)
          : componentDe[key as keyof typeof componentDe]) === undefined,
    );

    expect(missing.map(({ key, file }) => `${file}: ${key}`)).toEqual([]);
  });

  it("resolves in English", () => {
    const missing = keys.filter(
      ({ key }) =>
        (key.startsWith("ui.")
          ? resolve(en, key)
          : componentEn[key as keyof typeof componentEn]) === undefined,
    );

    expect(missing.map(({ key, file }) => `${file}: ${key}`)).toEqual([]);
  });

  it("derives keys from current English callers and text", () => {
    expect(() =>
      execFileSync(process.execPath, [join(ROOT, "frontend/scripts/i18n-keys.mjs"), "--check"], {
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("limits text to six meaningful words unless names collide, within 80 characters", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ["--test", join(ROOT, "frontend/scripts/i18n-keys.test.mjs")],
        { stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("stores exactly three hyphenated English key segments", () => {
    const walk = (node: unknown, prefix = ""): string[] =>
      typeof node === "string"
        ? [prefix]
        : Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
            walk(value, prefix ? `${prefix}.${key}` : key),
          );
    for (const locale of [en, de])
      expect(
        walk(locale).filter(
          (key) =>
            key.length > 80 ||
            !/^ui\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key),
        ),
      ).toEqual([]);
  });

  it("stores no key flat, which is how a dotted key stops resolving", () => {
    const flat: string[] = [];
    const walk = (node: unknown, prefix: string) => {
      if (typeof node !== "object" || node === null) return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k.includes(".")) flat.push(`${prefix}${k}`);
        walk(v, `${prefix}${k}.`);
      }
    };
    walk(de, "");
    walk(en, "");

    expect(flat).toEqual([]);
  });
});
