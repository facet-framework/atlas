import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("shortens text, removes unreferenced keys, preserves plurals and replays unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-key-names-"));
  try {
    const locale = join(root, "frontend/src/i18n/locales");
    for (const directory of [
      locale,
      join(root, "plugins"),
      join(root, "frontend/scripts"),
      join(root, "docs"),
    ])
      mkdirSync(directory, { recursive: true });
    const values = {
      unused: "Unused label",
      duplicate: "Unused label",
      first: "The quick brown fox jumps over a quiet meadow beyond sunset",
      second: "The quick brown fox jumps over a quiet meadow before sunrise",
      question: "Open?",
      action: "Open!",
      "count-one": "One record",
      "count-other": "{{count}} records",
      length:
        "Extraordinary documentation interoperability configuration verification expectations continue forever",
    };
    for (const name of ["en", "de"])
      writeFileSync(join(locale, `${name}.json`), JSON.stringify({ ui: { old: values } }));
    const caller = join(root, "frontend/src/labels.ts");
    writeFileSync(
      caller,
      Object.keys(values)
        .filter((key) => !["unused", "duplicate"].includes(key))
        .map((key) => `tx("ui.old.${key}");`)
        .join("\n"),
    );
    const script = fileURLToPath(new URL("./i18n-keys.mjs", import.meta.url));
    const run = (...args) =>
      execFileSync(process.execPath, [script, ...args], {
        env: { ...process.env, I18N_ROOT: root },
        stdio: "pipe",
      });
    assert.throws(() => run("--check"), /Command failed/);
    run();
    const english = readFileSync(join(locale, "en.json"), "utf8");
    const labels = JSON.parse(english).ui.root;
    assert.equal(labels["labels-quick-brown-fox-jumps-over-quiet"], values.first);
    assert.equal(labels["labels-quick-brown-fox-jumps-over-quiet-meadow"], values.second);
    assert.equal(labels["labels-open"], values.question);
    assert.equal(labels["labels-open-label"], values.action);
    assert.equal(labels["labels-count-records-one"], values["count-one"]);
    assert.equal(labels["labels-count-records-other"], values["count-other"]);
    assert.ok(Object.keys(labels).every((key) => `ui.root.${key}`.length <= 80));
    assert.equal(JSON.parse(english).ui.old, undefined);
    assert.equal(Object.values(labels).length, Object.keys(values).length - 2);
    const sources = readFileSync(caller, "utf8");
    run("--check");
    run();
    assert.equal(readFileSync(join(locale, "en.json"), "utf8"), english);
    assert.equal(readFileSync(caller, "utf8"), sources);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
