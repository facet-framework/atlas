#!/usr/bin/env node
/** Maintain catalogue keys from their callers and English text; --check validates without writing. */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = process.env.I18N_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const localeDir = resolve(root, "frontend/src/i18n/locales");
const check = process.argv.includes("--check");
export const slug = (text) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00df/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const flatten = (node, prefix = "", out = new Map()) => {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else flatten(value, path, out);
  }
  return out;
};
const files = (folder) =>
  readdirSync(folder).flatMap((name) => {
    if (["node_modules", "dist", ".next", "coverage", "locales"].includes(name)) return [];
    const file = resolve(folder, name);
    return statSync(file).isDirectory() ? files(file) : [file];
  });
const sources = [
  ...files(resolve(root, "frontend/src")),
  ...files(resolve(root, "plugins")),
].filter((f) => /\.[cm]?[jt]sx?$/.test(f));
const locales = new Map(
  readdirSync(localeDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f, flatten(JSON.parse(readFileSync(resolve(localeDir, f), "utf8")))]),
);
const english = locales.get("en.json");
const baseKey = (key) => {
  const base = key.replace(/[-_](one|other)$/, "");
  return base !== key &&
    ((english.has(`${base}-one`) && english.has(`${base}-other`)) ||
      (english.has(`${base}_one`) && english.has(`${base}_other`)))
    ? base
    : key;
};
const collisionRoles = {
  "ui.screens-contents.data-spec-support-glossary": "contents-label",
  "ui.screens-records.recorddetailspage-count-open": "open-count",
  "ui.screens-records.recorddetailspage-open-count": "open-total",
};
const owners = new Map();
const roles = new Map();
const sourceData = sources.map((file) => {
  const originalSource = readFileSync(file, "utf8");
  let source = originalSource;
  const input = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const computed = [];
  const labels = new Map();
  const discover = (node) => {
    if (
      ts.isTemplateExpression(node) &&
      /^ui\./.test(node.head.text) &&
      !ts.isElementAccessExpression(node.parent)
    ) {
      const matches = [...english.keys()].filter((key) => key.startsWith(node.head.text));
      if (!matches.length)
        throw new Error(`${relative(root, file)}: computed key has no catalogue entries`);
      const prefix = node.head.text.slice(0, node.head.text.lastIndexOf("-") + 1);
      for (const key of matches) labels.set(key.slice(prefix.length), key);
      computed.push({
        start: node.getStart(input),
        end: node.end,
        text:
          "`" +
          node
            .getText(input)
            .slice(1)
            .replace(node.head.text.slice(0, node.head.text.lastIndexOf("-") + 1), ""),
      });
    }
    ts.forEachChild(node, discover);
  };
  discover(input);
  for (const node of computed.reverse())
    source = source.slice(0, node.start) + `I18N_LABELS[${node.text}]` + source.slice(node.end);
  if (labels.size)
    source += `\n// Explicit keys let computed lookups follow source moves.\nconst I18N_LABELS: Record<string, string> = ${JSON.stringify(Object.fromEntries(labels), null, 2)};\n`;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const literals = [];
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
    ) {
      const old =
        english.has(node.text) ||
        english.has(`${node.text}-other`) ||
        english.has(`${node.text}_other`)
          ? node.text
          : undefined;
      if (!old && /^ui\.[a-z0-9-]+\.[a-z0-9_-]+$/.test(node.text) && !/\.(spec|test)\./.test(file))
        throw new Error(`${relative(root, file)}: unknown translation key ${node.text}`);
      if (old) {
        let context = node.parent;
        while (
          context &&
          !ts.isPropertyAssignment(context) &&
          !ts.isVariableDeclaration(context) &&
          !ts.isFunctionDeclaration(context)
        )
          context = context.parent;
        if (context?.name) roles.set(old, slug(context.name.getText(tree)));
        literals.push({ start: node.getStart(tree), end: node.end, old, text: node.text });
        if (!/\.(spec|test)\./.test(file)) {
          const list = owners.get(old) ?? [];
          list.push(file);
          owners.set(old, list);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { file, originalSource, source, literals };
});
const areaFor = (file) =>
  slug(
    dirname(
      relative(
        resolve(root, relative(root, file).startsWith("plugins/") ? "plugins" : "frontend/src"),
        file,
      ),
    ),
  );
const filenameFor = (file) => slug(basename(file).replace(/\.[^.]+$/, ""));
// Articles, conjunctions and common prepositions add no identifying content.
const stopWords = new Set(
  "a an the and or but of in on at to for from by with as is are be it this that".split(" "),
);
const allTextWords = (value) =>
  slug(
    value
      .replace(
        /\{\{v([0-3])\}\}/g,
        (_, index) => ["first-value", "second-value", "third-value", "fourth-value"][Number(index)],
      )
      .replace(/[{}]/g, " "),
  )
    .split("-")
    .filter(Boolean);
const textWords = (value) => {
  const words = allTextWords(value);
  const meaningful = words.filter((word) => !stopWords.has(word));
  return meaningful.length ? meaningful : words.length ? words : ["label"];
};
const mapping = new Map();
const used = new Map();
const missing = [];
for (const [old, text] of english) {
  const base = baseKey(old);
  const candidates = owners.get(old) ?? owners.get(base) ?? [];
  if (!candidates.length) {
    missing.push(old);
    continue;
  }

  const caller = [...new Set(candidates)].sort()[0] ?? resolve(root, "frontend/src/i18n/index.ts");
  if (!candidates.length) missing.push(old);
  const plural = base !== old ? old.match(/[-_](one|other)$/)?.[1] : undefined;
  const value = plural ? (english.get(`${base}-other`) ?? english.get(`${base}_other`)) : text;
  const words = textWords(value);
  const prefixFor = (file) => `ui.${areaFor(file) || "root"}.${filenameFor(file)}-`;
  const prefix = prefixFor(caller);
  // All callers share the slug; reserve enough room for the longest caller and plural.
  const budget =
    80 -
    Math.max(...[caller, ...candidates].map((file) => prefixFor(file).length)) -
    (plural ? "-other".length : 0);
  const fit = (count, role = "") => {
    const tail = role ? `-${role}` : "";
    const selected = words.slice(0, count);
    while (selected.length && selected.join("-").length + tail.length > budget) selected.pop();
    if (!selected.length) throw new Error(`No whole text word fits within 80 characters: ${old}`);
    return prefix + selected.join("-") + tail + (plural ? `-${plural}` : "");
  };
  const collides = (key) =>
    used.has(key) &&
    (!candidates.length ||
      [...locales.values()].some((entries) => entries.get(old) !== entries.get(used.get(key))));
  let key = fit(6);
  if (collides(key)) {
    // Further text words are permitted only when the six-word name collides.
    for (let count = 7; count <= words.length && collides(key); count++) {
      const extended = fit(count);
      if (extended === key) break;
      key = extended;
    }
    if (collides(key)) {
      const originalStem = prefix + allTextWords(value).join("-");
      const shortStem = plural ? fit(6).replace(/-(one|other)$/, "") : fit(6);
      const existingStem = [originalStem, shortStem].find((stem) => base.startsWith(stem + "-"));
      const existingRole = existingStem ? base.slice(existingStem.length + 1) : "";
      const role =
        collisionRoles[old] ||
        existingRole ||
        roles.get(old) ||
        (/[?？]/.test(text)
          ? "question"
          : /…|\.\.\./.test(text)
            ? "progress"
            : /[!:]/.test(text)
              ? "label"
              : "text");
      key = fit(6, role);
      if (collides(key))
        throw new Error(
          `Collision requires an English role: ${old} and ${used.get(key)} -> ${key}`,
        );
    }
  }
  used.set(key, old);
  mapping.set(old, key);
}
console.log(
  `${missing.length} retained catalogue entries have no caller outside specs; their keys stay unchanged.`,
);
for (const [old, key] of mapping) {
  const base = baseKey(old);
  if (base !== old) mapping.set(base, key.replace(/[-_](one|other)$/, ""));
}
if ([...used.keys()].some((key) => key.includes("TEMP"))) process.exit(1);
// A key shared across source files becomes one key per caller. Constants remain
// owned by their definition, so computed t(key) calls need no string guessing.
const perFile = new Map();
const destinations = new Map();
for (const old of english.keys()) {
  const canonical = mapping.get(old);
  if (!canonical) continue;
  const base = baseKey(old);
  const callers = [...new Set(owners.get(old) ?? owners.get(base) ?? [])].sort();
  const first = callers[0];
  if (!first) throw new Error(`Referenced key has no owning source: ${old}`);
  const prefix = `ui.${areaFor(first) || "root"}.${filenameFor(first)}-`;
  const suffix = canonical.slice(prefix.length);
  const targets = new Set([canonical]);
  for (const file of callers) {
    const target = `ui.${areaFor(file) || "root"}.${filenameFor(file)}-${suffix}`;
    if (
      used.has(target) &&
      used.get(target) !== old &&
      [...locales.values()].some((entries) => entries.get(old) !== entries.get(used.get(target)))
    )
      throw new Error(`Shared caller collision: ${target}`);
    used.set(target, old);
    targets.add(target);
    perFile.set(`${file}:${old}`, target);
    if (base !== old) perFile.set(`${file}:${base}`, target.replace(/[-_](one|other)$/, ""));
  }
  destinations.set(old, targets);
}
let failures = 0;
for (const { file, originalSource, source, literals } of sourceData) {
  let output = source;
  for (const item of literals.reverse()) {
    const key = perFile.get(`${file}:${item.old}`) ?? mapping.get(item.old);
    output = output.slice(0, item.start) + JSON.stringify(key) + output.slice(item.end);
  }
  if (output !== originalSource) {
    if (check) {
      console.error(`${relative(root, file)}: keys do not match current caller and English text`);
      failures++;
    } else writeFileSync(file, output);
  }
}
if (!check) {
  for (const [name, entries] of locales) {
    const output = { ui: {} };
    for (const [old, value] of entries) {
      const targets = destinations.get(old);
      if (!targets) continue;
      for (const key of targets) {
        const [, area, leaf] = key.split(".");
        (output.ui[area] ??= {})[leaf] = value;
      }
    }
    writeFileSync(resolve(localeDir, name), JSON.stringify(output, null, 2) + "\n");
  }
  // References in records, ledgers and browser contracts use the same mapping.
  for (const file of [
    ...files(resolve(root, "docs")),
    ...files(resolve(root, "frontend/scripts")),
  ]) {
    if (!/\.(json|yaml|yml|md|mjs)$/.test(file) || file === fileURLToPath(import.meta.url))
      continue;
    const source = readFileSync(file, "utf8");
    const output = source.replace(/ui\.[a-z0-9-]+\.[a-z0-9_-]+/g, (key) => mapping.get(key) ?? key);
    if (output !== source) writeFileSync(file, output);
  }
}
console.log(`${english.size} English catalogue leaves checked against their callers.`);
if (check && missing.length) {
  for (const key of missing) console.error(`unreferenced translation key: ${key}`);
  failures += missing.length;
}
if (failures) process.exitCode = 1;
