import { word, panel, cell } from "./presentation.js";
// @facet: customization/documents/dmn-analysis
// @facet-role: related
export function renderReport(h, report) {
  if (!report) return null;
  return h(
    "section",
    { "aria-label": word("Analysis"), style: { display: "grid", gap: 16 } },
    h(
      "h2",
      null,
      word(report.status === "analyzed" ? "Analysis" : "Not analyzed"),
    ),
    h(
      "p",
      null,
      `${report.cells} ${word("input cells")} · ${report.finding_count} ${word("findings")}`,
    ),
    h(
      "details",
      null,
      h("summary", null, word("Source")),
      h(
        "p",
        { style: { overflowWrap: "anywhere", fontFamily: "monospace" } },
        `SHA256: ${report.sha256}`,
      ),
    ),
    ...report.reasons.map((r, i) =>
      h("p", { key: `reason-${i}`, role: "status" }, r),
    ),
    report.truncated &&
      h("p", { role: "status" }, word("Finding details truncated")),
    ...report.findings.map((f, i) =>
      h(
        "article",
        { key: i, style: panel },
        h("h3", { style: { marginBottom: 8 } }, word(f.kind)),
        h("p", null, f.message),
        f.rules?.length ? h("p", null, f.rules.join(", ")) : null,
        f.inputs &&
          h(
            "pre",
            {
              style: {
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                background: "var(--t-sunken, #f5f5f5)",
                padding: 12,
                borderRadius: 6,
                marginTop: 12,
              },
            },
            JSON.stringify(f.inputs, null, 2),
          ),
      ),
    ),
    ...report.cases
      .filter((c) => c.error)
      .map((c, i) =>
        h("p", { key: `case-${i}`, role: "status" }, `${c.id}: ${c.error}`),
      ),
  );
}
export function renderTable(h, decision) {
  const table = decision?.table;
  if (!table) return null;
  const headers = [
    word("Rule"),
    ...table.inputs.map((i) => `${i.expression.text} (${i.values.text})`),
    ...table.outputs.map((o) => o.name),
  ];
  const rows = table.rules.map((r) =>
    h(
      "tr",
      { key: r.id },
      h("th", { scope: "row", style: cell }, r.id),
      ...[...r.inputs, ...r.outputs].map((entry, i) =>
        h("td", { key: i, style: cell }, entry.text),
      ),
    ),
  );
  return h(
    "section",
    { style: panel },
    h("h2", null, decision.name || decision.id),
    h("p", null, table.hit_policy),
    h(
      "div",
      { style: { overflowX: "auto" } },
      h(
        "table",
        { style: { width: "100%", borderCollapse: "collapse", marginTop: 12 } },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            ...headers.map((text, i) =>
              h(
                "th",
                {
                  key: i,
                  scope: "col",
                  style: {
                    ...cell,
                    color: "var(--t-muted, #555)",
                    fontSize: 13,
                  },
                },
                text,
              ),
            ),
          ),
        ),
        h("tbody", null, ...rows),
      ),
    ),
  );
}
