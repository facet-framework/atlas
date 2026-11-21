import i18n, { tx } from "@/i18n";

import { createElement } from "react";
import { num as formatNumber, type DerivedFeature, type DerivedModel } from "../derive";
import type { MeasuredGenTile } from "./tiles";
import { runTime } from "@/time";
import { sharePercent } from "@/share";

const LANG: Record<string, string> = {
  go: "Go",
  sh: "Shell",
  tf: "Terraform",
  yml: "YAML",
  yaml: "YAML",
  js: "JavaScript",
  ts: "TypeScript",
  tsx: "TypeScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  md: "Markdown",
  json: "JSON",
  py: "Python",
  css: "CSS",
  scss: "CSS",
  html: "HTML",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  swift: "Swift",
  sql: "SQL",
  toml: "TOML",
  bash: "Shell",
  zsh: "Shell",
};

/** How many languages the tile names by row before folding the rest into one line. */
const STACK_ROWS = 5;

/** The languages of every anchored file, by extension — the design's own
 * reading. Not exported: only `techStackTile` below reads it, and nothing
 * outside this file has needed it since. */

function languagesFromAnchors(v: DerivedModel): [string, number][] {
  const counter: Record<string, number> = {};
  for (const f of v.M) {
    for (const a of f.anchors) {
      const name = a.path.split("/").pop() ?? "";
      const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
      const language = /\.github\/workflows\//.test(a.path)
        ? "GitHub Actions"
        : (LANG[ext] ?? (ext ? `.${ext}` : name || tx("ui.generative.measured-no-extension")));
      counter[language] = (counter[language] ?? 0) + 1;
    }
  }
  return Object.entries(counter).sort((a, b) => b[1] - a[1]);
}

function scanTime(v: DerivedModel): string {
  return runTime(v.scan.scannedAt, i18n.resolvedLanguage ?? "en") ?? "—";
}

/** The tech stack as rows: the top languages with their anchor count and
 * share, the rest folded into one line, and how much of the code is under an
 * anchor as a share — "8 of 120 lines" in raw digits said nothing a reader
 * could weigh. */

function stackBody(v: DerivedModel, langs: [string, number][]) {
  const total = langs.reduce((sum, [, n]) => sum + n, 0);
  const shown = langs.slice(0, STACK_ROWS);
  const rest = langs.slice(STACK_ROWS);
  const restN = rest.reduce((sum, [, n]) => sum + n, 0);
  const pct = (n: number) =>
    tx("ui.generative.measured-value", { value: sharePercent(n, total) ?? 0 });
  const row = (key: string, label: string, n: number) =>
    createElement(
      "div",
      { className: "gen-stack-row", key, "data-testid": "gen-stack-row" },
      createElement("span", { className: "nm" }, label),
      createElement(
        "span",
        { className: "bar", "aria-hidden": "true" },
        createElement("i", { style: { width: pct(n).replace(" ", "") } }),
      ),
      createElement("span", { className: "n t-mono" }, `${n} · ${pct(n)}`),
    );
  const loc = v.scan.loc;
  const anchored = v.scan.anchoredLoc;
  return createElement(
    "div",
    { className: "gen-stack" },
    shown.map(([language, n]) => row(language, language, n)),
    rest.length
      ? row("rest", tx("ui.generative.measured-count-more", { count: rest.length }), restN)
      : null,
    anchored !== null && loc !== null && loc > 0
      ? createElement(
          "p",
          { className: "gen-l", "data-testid": "gen-stack-coverage" },
          tx("ui.generative.measured-percent-code-anchored-total-lines-files", {
            percent: sharePercent(anchored, loc) ?? 0,
            anchored: formatNumber(anchored),
            total: formatNumber(loc),
          }),
        )
      : null,
  );
}

/** tx("tiles.stack") — anchored files by language, ranked, plus the anchored share of the code. */
export function techStackTile(v: DerivedModel): MeasuredGenTile {
  const langs = languagesFromAnchors(v);
  return {
    id: "m:stack",
    kind: "measured",
    title: tx("ui.generative.measured-what-technology-stack"),
    basis: tx("ui.generative.measured-anchors-file-extensions-scan-time", { time: scanTime(v) }),
    // Ranked rows with a share bar instead of one chip per language: a
    // registry with a dozen extensions drew a chip row that ran out of the
    // tile and said nothing about which language carries the product.
    body: langs.length
      ? stackBody(v, langs)
      : createElement(
          "p",
          { className: "gen-l" },
          tx("ui.generative.measured-no-record-has-anchor-code"),
        ),
  };
}

function displayDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(i18n.resolvedLanguage ?? "en", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

function rows(list: DerivedFeature[], nav: { open: (fid: string) => void }) {
  return createElement(
    "div",
    { className: "gen-list" },
    list.map((f) =>
      createElement(
        "button",
        {
          key: f.id,
          type: "button",
          onClick: () => nav.open(f.id),
          "data-testid": `gen-row-${f.id}`,
        },
        createElement(
          "span",
          { className: "nm", "data-testid": "gen-row-name" },
          f.id.split("/").pop(),
        ),
        f.life === "planned"
          ? createElement("span", { className: "lf t-mono" }, tx("ui.generative.measured-planned"))
          : null,
        createElement(
          "span",
          { className: "dt t-mono", "data-testid": "gen-row-date" },
          displayDate(f.created),
        ),
      ),
    ),
  );
}

/** Whether a value is a real calendar date, as "YYYY-MM-DD" alone or followed by
 * a time ("T…"). The shape is not enough: "2026-13-45" and "2026-02-30" match
 * it, and "2026-10-21junk" starts with it. The date is parsed and must give
 * back the same year, month and day. */

function isoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) return false;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
  );
}

/** The `n` most recently created records, newest first. */

export function newestRecords(v: DerivedModel, n: number): DerivedFeature[] {
  // Only an ISO date counts, and it is compared on its first ten characters:
  // the schema has no pattern for `created_at`, and "9.10.2026" would sort above
  // every real date as a string. Unreadable is treated like missing, never guessed.
  const day = (f: DerivedFeature) => f.created.slice(0, 10);
  return [...v.M]
    .filter((f) => isoDay(f.created))
    .sort((a, b) => day(b).localeCompare(day(a)))
    .slice(0, n);
}

/** tx("tiles.newest") — the four most recently created records, by `created`. */
export function newestTile(v: DerivedModel, nav: { open: (fid: string) => void }): MeasuredGenTile {
  return {
    id: "m:newest",
    kind: "measured",
    title: tx("ui.generative.measured-what-newest"),
    basis: tx("ui.generative.measured-created-descending"),
    body: rows(newestRecords(v, 4), nav),
  };
}

/** tx("tiles.oldest") — the four oldest, by `created`. */
export function oldestTile(v: DerivedModel, nav: { open: (fid: string) => void }): MeasuredGenTile {
  const byDate = [...v.M]
    .filter((f) => f.created)
    .sort((a, b) => a.created.localeCompare(b.created));
  return {
    id: "m:oldest",
    kind: "measured",
    title: tx("ui.generative.measured-what-oldest"),
    basis: tx("ui.generative.measured-created-ascending"),
    body: rows(byDate.slice(0, 4), nav),
  };
}

/** tx("tiles.drift") — drift rows, dev's own measure. */
export function driftTile(v: DerivedModel, nav: { open: (fid: string) => void }): MeasuredGenTile {
  const drifted = v.M.filter((f) => f.driftN > 0).sort((a, b) => b.driftN - a.driftN);
  return {
    id: "m:drift",
    kind: "measured",
    title: tx("ui.generative.measured-where-has-code-changed-without-its"),
    basis: tx("ui.generative.measured-field-count-total-records-scan-time", {
      field: "driftN",
      count: v.TOT.driftFeatures,
      total: v.M.length,
      time: scanTime(v),
    }),
    body: drifted.length
      ? rows(drifted.slice(0, 4), nav)
      : createElement(
          "p",
          { className: "gen-l" },
          tx("ui.generative.measured-no-record-behind-its-code"),
        ),
  };
}

/** tx("tiles.testGaps") — worst-proven records, review's own measure. */
export function proofGapTile(
  v: DerivedModel,
  nav: { open: (fid: string) => void },
): MeasuredGenTile {
  const gaps = v.M.filter((f) => f.unbacked > 0).sort((a, b) => b.unbacked - a.unbacked);
  return {
    id: "m:proof",
    kind: "measured",
    title: tx("ui.generative.measured-where-largest-test-linkage-gaps"),
    basis: tx("ui.generative.measured-field-count-commitments-total-scan-time", {
      field: "unbacked",
      count: v.TOT.unbacked,
      time: scanTime(v),
    }),
    body: gaps.length
      ? rows(gaps.slice(0, 4), nav)
      : createElement(
          "p",
          { className: "gen-l" },
          tx("ui.generative.measured-no-commitment-lacks-test-reference"),
        ),
  };
}

/** tx("tiles.knowledgeGaps") — records with no `knowledge` answer at all. */
export function knowledgeGapTile(
  v: DerivedModel,
  nav: { open: (fid: string) => void },
): MeasuredGenTile {
  const empty = v.M.filter((f) => !f.hasKnow);
  return {
    id: "m:knowledge",
    kind: "measured",
    title: tx("ui.generative.measured-which-knowledge-sections-empty"),
    basis: tx("ui.generative.measured-field-count-total-records-scan-time", {
      field: "knowledge",
      count: empty.length,
      total: v.M.length,
      time: scanTime(v),
    }),
    body: empty.length
      ? rows(empty.slice(0, 4), nav)
      : createElement(
          "p",
          { className: "gen-l" },
          tx("ui.generative.measured-every-record-has-populated-knowledge-sections"),
        ),
  };
}

/** tx("tiles.teams") — the largest team, by record count. */
export function teamsTile(v: DerivedModel): MeasuredGenTile {
  const sorted = [...v.teams].sort((a, b) => b[1].length - a[1].length);
  return {
    id: "m:teams",
    kind: "measured",
    title: tx("ui.generative.measured-which-team-owns-most-records"),
    basis: tx("ui.generative.measured-lineage-owner-team-count-teams-scan", {
      count: v.teams.length,
      time: scanTime(v),
    }),
    body: sorted.length
      ? createElement(
          "div",
          { className: "gen-chips" },
          sorted
            .slice(0, 6)
            .map(([team, list]) =>
              createElement(
                "span",
                { className: "t-chip", key: team || "—" },
                createElement("b", null, team || tx("ui.generative.measured-no-team")),
                `${list.length} ${list.length === 1 ? "Record" : "Records"}`,
              ),
            ),
        )
      : createElement(
          "p",
          { className: "gen-l" },
          tx("ui.generative.measured-no-record-names-team"),
        ),
  };
}

/** tx("tiles.defects") — declared defects, leadership's own measure. */
export function errorTile(v: DerivedModel, nav: { open: (fid: string) => void }): MeasuredGenTile {
  const affected = v.M.filter((f) => f.devs > 0);
  return {
    id: "m:errors",
    kind: "measured",
    title: tx("ui.generative.measured-what-declared-defect"),
    basis: tx("ui.generative.measured-field-count-commitments-total-scan-time", {
      field: "deviation",
      count: v.TOT.devs,
      time: scanTime(v),
    }),
    body: affected.length
      ? rows(affected.slice(0, 4), nav)
      : createElement(
          "p",
          { className: "gen-l" },
          tx("ui.generative.measured-no-record-declares-commitment-defect"),
        ),
  };
}

/** tx("tiles.observationGaps") — records with no `observation` block, author's own measure. */
export function observationGapTile(
  v: DerivedModel,
  nav: { open: (fid: string) => void },
): MeasuredGenTile {
  const empty = v.M.filter((f) => f.obs === null);
  return {
    id: "m:obs",
    kind: "measured",
    title: tx("ui.generative.measured-which-records-lack-operational-documentation"),
    basis: tx("ui.generative.measured-field-count-total-records-scan-time", {
      field: "observation",
      count: empty.length,
      total: v.M.length,
      time: scanTime(v),
    }),
    body: empty.length
      ? rows(empty.slice(0, 4), nav)
      : createElement(
          "p",
          { className: "gen-l" },
          tx("ui.generative.measured-every-record-has-operational-documentation"),
        ),
  };
}

/** tx("tiles.mostAnchored") — most anchors, the agent role's own measure. */
export function densestAnchorTile(
  v: DerivedModel,
  nav: { open: (fid: string) => void },
): MeasuredGenTile {
  const dense = [...v.M].filter((f) => f.anchorsN > 0).sort((a, b) => b.anchorsN - a.anchorsN);
  return {
    id: "m:dense",
    kind: "measured",
    title: tx("ui.generative.measured-which-records-have-most-anchors"),
    basis: tx("ui.generative.measured-anchorsn-descending-scan-time", { time: scanTime(v) }),
    body: dense.length
      ? rows(dense.slice(0, 4), nav)
      : createElement(
          "p",
          { className: "gen-l" },
          tx("ui.generative.measured-no-record-has-anchor"),
        ),
  };
}

/** tx("tiles.orphanAnchors") — orphan anchors, the agent role's own measure. */
export function orphanedAnchorTile(v: DerivedModel): MeasuredGenTile {
  return {
    id: "m:orphans",
    kind: "measured",
    title: tx("ui.generative.measured-which-anchors-have-no-record"),
    basis: tx("ui.generative.measured-orphananchors-count-scan-time", {
      count: v.orphans.length,
      time: scanTime(v),
    }),
    body: v.orphans.length
      ? createElement(
          "div",
          { className: "gen-list" },
          v.orphans
            .slice(0, 4)
            .map((o) =>
              createElement(
                "span",
                { key: `${o.path}:${o.line}`, className: "nm t-mono" },
                `${o.path}:${o.line}`,
              ),
            ),
        )
      : createElement(
          "p",
          { className: "gen-l" },
          tx("ui.generative.measured-every-anchor-resolves-record"),
        ),
  };
}
