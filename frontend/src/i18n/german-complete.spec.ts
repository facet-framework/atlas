/** German mode must not show English words that merely fell back to the
 * source language. */

import de from "./locales/de.json";
import en from "./locales/en.json";

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

/** Values that may be identical in both languages, grouped by why. */
const SAME_IN_BOTH: ReadonlyMap<string, string> = new Map<string, string>([
  // Wiki and Confluence names, actions and Git terminology.
  ["Atlas → Confluence", "wiki terminology"],
  ["Atlas ↔ Confluence", "wiki terminology"],
  ["Confluence", "wiki terminology"],
  ["Confluence → Atlas", "wiki terminology"],
  ["Import ·", "wiki terminology"],
  ["Wiki", "wiki terminology"],
  ["Atlassian Confluence", "wiki terminology"],
  ["wiki:", "wiki terminology"],
  ["Commit", "wiki terminology"],
  ["Team", "wiki terminology"],
  ["Commit {{sha}}", "wiki terminology"],
  // Product and vendor names.
  ...["ATLAS", "Atlas", "Claude Code", "Facet", "OpenAI Codex", "claude", "codex", "facet"].map(
    (v): [string, string] => [v, "product name"],
  ),
  // Language names are written in their own language on purpose.
  ...["English"].map((v): [string, string] => [v, "a language is named in itself"]),
  // Technical terms the German reader uses as they are.
  ...[
    "Code",
    "CODE",
    "Filter",
    "Host",
    "MCP",
    "Plugin",
    "Plugins",
    "Remote",
    "Token",
    "YAML",
    "Theme",
    "Themes",
    "Generative UI",
    "Companion",
    "Registry",
    "Branch:",
    "Worktree:",
  ].map((v): [string, string] => [v, "technical term"]),
  // Record vocabulary the German reader already works with.
  ...[
    "Record",
    "Records",
    "Owner",
    "Intent",
    "Agent",
    "Engineering",
    "Capability",
    "Portfolio",
    "unbacked",
    "Teams",
    "TEAM",
    "Tests",
    "SLOs",
    "IDs",
  ].map((v): [string, string] => [v, "record vocabulary"]),
  // Gherkin keywords and record field names, shown as they are written in the YAML.
  ...[
    "Given",
    "When",
    "Then",
    "active",
    "anchors",
    "calibrate",
    "knowledge",
    "knowledge ·",
    "lifecycle ·",
    "lineage",
    "mono",
    "observation",
    "proves",
    "proves:",
    "scan",
    "team ·",
    "verification",
    "drift:",
    "audience: {{v0}}",
    "backing.state: unbacked",
    "backing.state: unbacked{{v0}}",
    "defects.excluded",
    "corpus.",
  ].map((v): [string, string] => [v, "record field or command name"]),
  // Commands, paths, endpoints and file names.
  ...[
    ".facetrc.yaml",
    "@facet:",
    "@facet: {{id}}",
    "GET /api/corpus",
    "application/json",
    "facet drift",
    "facet lint",
    "git diff --",
    "glossary.yaml",
    "forges: ·",
    ": gitlab · in",
    "⌘K",
  ].map((v): [string, string] => [v, "command, path or endpoint"]),
  // Spelled the same in German.
  ...["Normal", "Status", "Revision:", "Test:", "in", "n", "{{n}}×"].map((v): [string, string] => [
    v,
    "same word in German",
  ]),
  // Fragments made of placeholders and punctuation only.
  ...[
    "{{claims}} · {{anchors}} · {{knowledge}}",
    "{{knowledge}} · {{observation}} · {{fixes}}",
    "“.",
  ].map((v): [string, string] => [v, "no words to translate"]),
  // Allowed product terms in German page translations.
  ["Treemap", "technical term"],
  ["A–Z", "an alphabet range"],
  ["{{count}} unbacked", "FACET term (backing.state), untranslated in Atlas"],
  ["Hash", "technical term"],
  ["Ticket", "same word"],
  ["CLAUDE.md", "a file name"],
  // Texts the pages drew as literals in both languages before they moved.
  ...[
    "docs/facets/glossary.yaml",
    "docs/facets/policies/",
    "internal/facet/config.go",
    "https://github.com/owner/repo",
    "Records · navigation/atlas",
    "prefers-reduced-motion: reduce",
  ].map((v): [string, string] => [v, "a path, an address or a media query"]),
  ...["deviation:", "observation:", "owner:", "sha256:"].map((v): [string, string] => [
    v,
    "a record field name",
  ]),
  ...["Esc", "K"].map((v): [string, string] => [v, "a key on the keyboard"]),
  ...["ms", "s", "{{ms}} ms"].map((v): [string, string] => [v, "a unit"]),
  ...["×", "· n", "— Records", "facet {{version}}"].map((v): [string, string] => [
    v,
    "a sign, a symbol or a product name",
  ]),
  ...["contract.business_rules", "intent.decision_records", "DMN"].map((v): [string, string] => [
    v,
    "a record field name or a standard's name",
  ]),
  ["Fixes in {{record}}", "FACET term (fixes), as both languages drew it"],
  ["docs/facets/features/{{id}}.yaml", "a path"],
  ["EN:", "a language code"],
  ["Outline", "a term of the record page's layout, as both languages drew it"],
  ["Band", "same word"],
  ["· Median", "same word"],
  ["Median", "same word"],
  ["Palette", "same word"],
  ["Test", "same word"],
]);

describe("the German locale is complete", () => {
  const english = leaves(en as Tree);
  const german = leaves(de as Tree);

  it("read both locale files before judging anything", () => {
    expect(english.size).toBeGreaterThan(1000);
    expect(german.size).toBe(english.size);
  });

  it("carries no English value that is a verbatim copy of the source", () => {
    const copies = [...english]
      .filter(([key, value]) => german.get(key) === value && !SAME_IN_BOTH.has(value))
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);

    expect(copies).toEqual([]);
  });

  it("keeps the source language English: no umlaut in en.json", () => {
    const umlauts = [...english]
      .filter(([, value]) => /[\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df]/.test(value))
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);

    expect(umlauts).toEqual([]);
  });
});
