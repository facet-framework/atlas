#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { untranslatedJsx } from "./i18n-source.mjs";

const directory = join(dirname(fileURLToPath(import.meta.url)), "../src/i18n/locales");
const write = process.argv.includes("--write");
const sourceRoot = join(directory, "../..");

const flatten = (value, prefix = "", result = new Map()) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    result.set(prefix, value);
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, result);
  }
  return result;
};

const set = (target, path, value) => {
  const parts = path.split(".");
  const last = parts.pop();
  let cursor = target;
  for (const part of parts) cursor = cursor[part] ??= {};
  cursor[last] = value;
};

const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
if (!files.includes("en.json")) throw new Error("src/i18n/locales/en.json is required");

const load = async (file) => JSON.parse(await readFile(join(directory, file), "utf8"));
const english = await load("en.json");
const reference = flatten(english);
let failed = false;

const MAX_DEPTH = 3;
const checkDepth = (map, file) => {
  for (const key of map.keys()) {
    const depth = key.split(".").length;
    if (
      key.length > 80 ||
      depth !== MAX_DEPTH ||
      !/^ui\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)
    ) {
      console.error(
        `${file}: key "${key}" must have three hyphenated segments and at most 80 characters (got ${depth} levels, ${key.length} characters)`,
      );
      failed = true;
    }
  }
};
checkDepth(reference, "en.json");

for (const file of files.filter((name) => name !== "en.json")) {
  const translation = await load(file);
  const translated = flatten(translation);
  checkDepth(translated, file);
  const missing = [...reference.keys()].filter((key) => !translated.has(key));
  const extra = [...translated.keys()].filter((key) => !reference.has(key));

  if (write && missing.length) {
    for (const key of missing) set(translation, key, reference.get(key));
    await writeFile(join(directory, file), `${JSON.stringify(translation, null, 2)}\n`);
    console.log(`${file}: copied ${missing.length} new key(s) from en.json`);
  } else if (missing.length) {
    console.error(`${file}: missing ${missing.join(", ")}`);
    failed = true;
  }

  if (extra.length) {
    console.error(`${file}: unknown ${extra.join(", ")}`);
    failed = true;
  }

  const finalCount = translated.size + (write ? missing.length : 0);
  if (finalCount !== reference.size) {
    console.error(`${file}: has ${finalCount} keys; en.json has ${reference.size}`);
    failed = true;
  }
}

const sourceFiles = [];
const collectSources = async (folder) => {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await collectSources(path);
    else if (
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".spec.tsx") &&
      !entry.name.endsWith(".stories.tsx")
    )
      sourceFiles.push(path);
  }
};
await collectSources(sourceRoot);

for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  for (const finding of untranslatedJsx(source, file)) {
    console.error(`${file}:${finding.line}: untranslated JSX text ${JSON.stringify(finding.text)}`);
    failed = true;
  }
}

if (failed) {
  console.error("Run `pnpm i18n:sync` to copy missing English values, then resolve extra keys.");
  process.exitCode = 1;
} else {
  console.log(`${files.length} language files checked; each has ${reference.size} keys.`);
}
