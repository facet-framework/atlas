import assert from "node:assert/strict";
import test from "node:test";
import { untranslatedJsx } from "./i18n-source.mjs";

test("rejects visible literals, conditional labels and interpolated accessible labels", () => {
  const source =
    '<><p>Untranslated</p><button title={active ? "Close" : `Open ${id}`}>{active ? "open" : "closed"}</button><input placeholder="Search" /></>';
  const findings = untranslatedJsx(source);
  assert.deepEqual(
    findings.map(({ text }) => text),
    ["Untranslated", "Close", "Open", "open", "closed", "Search"],
  );
});

test("keeps translated calls, project content and executable code outside the prose check", () => {
  const source =
    '<><p>{t("label")}{record.title}{active ? t("on") : tx("off")}</p><code>{`facet show ${id}`}</code><button title={record.description} /></>';
  assert.deepEqual(untranslatedJsx(source), []);
});

test("reports the source line without treating conditional identifiers as prose", () => {
  assert.deepEqual(untranslatedJsx('<p>\n{kind === "feature" ? "Feature" : title}\n</p>'), [
    { line: 2, text: "Feature" },
  ]);
});
