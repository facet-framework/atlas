/** The reviewer's bench on the Overview: five counts, the tree from capability
 * through feature to the single promise with its five measures, filtered by
 * evidence and readership through all three levels, and the three kinds of
 * gap kept apart. */

import { Badge, Chip, ListRow, Pagination, Section, Stat } from "@facet-tools/ui";
import { useText } from "@/chrome";
import type { ScenarioAudience } from "@/model";
import { keepAud, keepScen, short, type DerivedFeature, type DerivedScenario } from "@/derive";
import type { AudFilter, ScenFilter } from "@/state";
import type { PageContext } from "../context";
import { href } from "../route";
import { failedCount, shortSha, useTestReport, type TestReport } from "../test-report";

const CATS_PAGE = 8;
const FEATURES_PAGE = 6;
const PROMISES_PAGE = 8;
const GAP_PAGE = 6;

type BenchState = {
  evidence: ScenFilter;
  audience: AudFilter;
  cats: number;
  /** Open categories and features; `null` until the reader folds one. */
  openCats: string[] | null;
  openFeatures: string[];
  /** Page of each open category's features and each open feature's promises. */
  pages: Record<string, number>;
  gaps: Record<"tests" | "docs" | "none", number>;
};

const INITIAL: BenchState = {
  evidence: "all",
  audience: "all",
  cats: 1,
  openCats: null,
  openFeatures: [],
  pages: {},
  gaps: { tests: 1, docs: 1, none: 1 },
};

const EVIDENCE: readonly ScenFilter[] = ["all", "open", "unbacked", "proven", "dev"];
const AUDIENCES: readonly AudFilter[] = ["all", "product", "engineering"];

const slice = <R,>(rows: readonly R[], page: number, size: number) =>
  rows.slice((page - 1) * size, page * size);

function Pager({
  ctx,
  page,
  size,
  total,
  onPage,
}: {
  ctx: PageContext;
  page: number;
  size: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= size) return null;
  return (
    <Pagination
      page={Math.min(page, Math.ceil(total / size))}
      pageSize={size}
      total={total}
      pageSizes={[size]}
      compact={ctx.mobile}
      onPage={onPage}
    />
  );
}

/** What a feature row says about its proof; no degree of proof without a promise. */
function verdict(
  f: DerivedFeature,
  t: PageContext["t"],
): { text: string; tone?: "ok" | "warn" | "bad" } {
  if (f.claims === 0) return { text: t("ui.reader-pages.bench-no-promise") };
  if (f.proven === 0) return { text: t("ui.reader-pages.bench-no-test-linked"), tone: "bad" };
  if (f.open)
    return {
      text: t("ui.reader-pages.bench-count-without-test", { count: f.open }),
      tone: "warn",
    };
  return { text: t("ui.reader-pages.bench-complete"), tone: "ok" };
}

/** Why the bench shows no failing-test figure, or what the fresh figure was measured on. */
function reportNote(report: TestReport | null, t: PageContext["t"]): string {
  if (!report) return t("ui.reader-pages.bench-reading-report");
  switch (report.state) {
    case "fresh":
      return t("ui.reader-pages.bench-passed-passed-unmeasured-unmeasured-commit-sha", {
        passed: report.passed ?? 0,
        unmeasured: report.unmeasured ?? 0,
        sha: shortSha(report.reportHead),
      });
    case "unreadable":
      return t(
        I18N_LABELS[`unreadable-${REASONS.has(report.reason ?? "") ? report.reason : "io"}`],
      );
    case "unmeasured":
      return t("ui.reader-pages.bench-report-has-no-measured-file");
    default:
      return STATES.has(report.state)
        ? t(I18N_LABELS[`${report.state}`])
        : t("ui.reader-pages.bench-no-report-facet-ui-test-report");
  }
}

const STATES = new Set([
  "none",
  "no-entry",
  "no-head",
  "no-git",
  "stale",
  "dirty",
  "ambiguous",
  "tree-changed",
]);
const REASONS = new Set([
  "not-regular",
  "too-large",
  "permission",
  "not-json",
  "wrong-shape",
  "io",
]);

/** The failing tests of the judged report: a number only from a fresh one,
 * a dash with its reason in words otherwise — never a 0 for "not measured". */

function FailingTests({ ctx }: { ctx: PageContext }) {
  const { t } = ctx;
  const { number: nf } = useText();
  const reader = ctx.readTestReport ?? null;
  const report = useTestReport(reader);
  const failing = failedCount(report);
  // Without a reader nothing is ever asked: that is unmeasured, not a read in progress.
  const state = reader ? (report?.state ?? "pending") : "unasked";
  return (
    <div data-testid="bench-test-report" data-test-report-state={state}>
      <Stat
        value={
          failing === null ? (
            <span
              role="img"
              aria-label={t("ui.reader-pages.bench-not-measured")}
              data-testid="bench-test-report-n"
            >
              —
            </span>
          ) : (
            <span data-testid="bench-test-report-n">{nf(failing)}</span>
          )
        }
        tone={failing ? "bad" : failing === 0 ? "ok" : undefined}
        label={
          <span className="t-stack" style={{ gap: 2 }}>
            <span>{t("ui.reader-pages.bench-failing-tests", { count: failing ?? 2 })}</span>
            <span className="t-meta t-wrap" data-testid="bench-test-report-note">
              {reader ? reportNote(report, t) : t("ui.reader-pages.bench-not-measured")}
            </span>
          </span>
        }
      />
    </div>
  );
}

/** The five measures of one promise, each only from what the record says: a
 * dash where it says nothing, never a 0 or a default audience. Drift is not
 * among them; it measures the feature. */

function Measures({ s, t }: { s: DerivedScenario; t: PageContext["t"] }) {
  const anchors = s.raw.implementedBy;
  const audience: Record<ScenarioAudience, string> = {
    product: t("ui.reader-pages.bench-product"),
    engineering: t("ui.reader-pages.bench-engineering"),
  };
  const rows: [string, string, string][] = [
    ["tests", t("ui.reader-pages.bench-tests"), s.tests.length ? String(s.tests.length) : "—"],
    [
      "evidence",
      t("ui.reader-pages.bench-evidence"),
      s.evidence === "ok"
        ? t("ui.reader-pages.bench-linked")
        : s.evidence === "un"
          ? t("ui.reader-pages.bench-unbacked-rows")
          : t("ui.reader-pages.bench-open-rows"),
    ],
    [
      "anchor",
      t("ui.reader-pages.bench-anchor"),
      anchors.length
        ? `${anchors[0].path}:${anchors[0].line}${anchors.length > 1 ? ` +${anchors.length - 1}` : ""}`
        : // A registry that never writes `@facet-proves:` has not said which
          // anchor redeems a promise: "not declared", not "has none".
          s.raw.anchorsAdopted
          ? "—"
          : t("ui.reader-pages.bench-not-declared"),
    ],
    ["audience", t("ui.reader-pages.bench-readership"), s.audience ? audience[s.audience] : "—"],
    [
      "deviation",
      t("ui.reader-pages.bench-deviation"),
      s.deviation ? t("ui.reader-pages.bench-declared") : "—",
    ],
  ];
  return (
    <span
      className="t-row t-row--wrap t-meta"
      style={{ gap: "2px 12px" }}
      data-testid="bench-measures"
    >
      {rows.map(([key, label, value]) => (
        <span key={key} className="t-wrap" data-testid={`bench-measure-${key}`}>
          {label} <span className="t-mono">{value}</span>
        </span>
      ))}
    </span>
  );
}

// @facet: registry/perspectives/review-bench
// @facet-role: primary
export function Bench({ ctx }: { ctx: PageContext }) {
  const { t } = ctx;
  const { number: nf } = useText();
  const [s, set] = ctx.slot<BenchState>("overview-bench", INITIAL);
  const v = ctx.derived;
  const keep = (x: DerivedScenario) => keepScen(s.evidence, x) && keepAud(s.audience, x);
  const filtering = s.evidence !== "all" || s.audience !== "all";
  const all = v.M.flatMap((f) => f.scen);
  const unclassified = all.filter((x) => x.audience === null).length;
  const noTests = v.M.filter((f) => f.proven === 0);
  const noDocs = v.M.filter((f) => !f.hasKnow);
  const testsMissing = v.M.filter((f) => f.open > 0).sort((a, b) => b.open - a.open);
  const cats = v.cats
    .map(([cat, features]) => {
      const shown = filtering ? features.filter((f) => f.scen.some(keep)) : features;
      return {
        cat,
        features,
        shown,
        matching: shown.reduce((n, f) => n + f.scen.filter(keep).length, 0),
        // Every scenario, deviations included: a selection of deviations is
        // counted against a denominator that holds them.
        scenarios: features.reduce((n, f) => n + f.scen.length, 0),
        open: features.reduce((n, f) => n + f.open, 0),
      };
    })
    .filter((c) => c.shown.length > 0);
  // Until the reader folds anything, the first category the selection keeps stands open.
  const openCats = s.openCats ?? cats.slice(0, 1).map((c) => c.cat);
  const toggle = (list: string[], key: string) =>
    list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
  const evidenceLabel: Record<ScenFilter, string> = {
    all: t("ui.reader-pages.bench-all"),
    open: t("ui.reader-pages.bench-open"),
    unbacked: t("ui.reader-pages.bench-unbacked"),
    proven: t("ui.reader-pages.bench-test"),
    dev: t("ui.reader-pages.bench-deviations"),
  };
  const audienceLabel: Record<AudFilter, string> = {
    all: t("ui.reader-pages.bench-all"),
    product: t("ui.reader-pages.bench-product"),
    engineering: t("ui.reader-pages.bench-engineering"),
  };
  const record = (id: string, section?: string) => href({ area: "record", id, section });

  const gap = (
    key: "tests" | "docs" | "none",
    label: string,
    items: DerivedFeature[],
    value: (f: DerivedFeature) => string,
    empty: string,
  ) => (
    <div className="t-stack" style={{ gap: 6, minWidth: 0 }} data-testid={`bench-gap-${key}`}>
      <span className="t-row t-row--between">
        <span className="t-label">{label}</span>
        <span className="t-meta">{nf(items.length)}</span>
      </span>
      {items.length ? (
        <>
          <div className="t-surface t-a-list" role="list" aria-label={label}>
            {slice(items, s.gaps[key], GAP_PAGE).map((f) => (
              <div key={f.id} role="listitem">
                <ListRow
                  title={<span className="t-mono t-wrap">{short(f.id)}</span>}
                  sub={value(f)}
                  onClick={() => ctx.go(record(f.id))}
                />
              </div>
            ))}
          </div>
          <Pager
            ctx={ctx}
            page={s.gaps[key]}
            size={GAP_PAGE}
            total={items.length}
            onPage={(n) => set({ gaps: { ...s.gaps, [key]: n } })}
          />
        </>
      ) : (
        <p className="t-muted">{empty}</p>
      )}
    </div>
  );

  return (
    <>
      <Section
        title={t("ui.reader-pages.bench-review-bench")}
        meta={t("ui.reader-pages.bench-proven-claims-promises-test", {
          claims: v.TOT.claims,
          proven: v.TOT.proven,
        })}
      >
        <div
          className="t-a-kpis"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
          data-testid="bench-counts"
        >
          <Stat
            value={nf(v.TOT.open)}
            tone={v.TOT.open ? "bad" : "ok"}
            label={t("ui.reader-pages.bench-promises-without-test-link")}
          />
          <Stat
            value={nf(noTests.length)}
            tone={noTests.length ? "bad" : "ok"}
            label={t("ui.reader-pages.bench-records-without-any-test")}
          />
          <Stat
            value={nf(noDocs.length)}
            tone={noDocs.length ? "warn" : "ok"}
            label={t("ui.reader-pages.bench-features-without-documentation")}
          />
          <Stat
            value={nf(v.TOT.unbacked)}
            label={t("ui.reader-pages.bench-deliberately-unbacked")}
          />
          <Stat value={nf(v.TOT.devs)} label={t("ui.reader-pages.bench-declared-deviations")} />
          <FailingTests ctx={ctx} />
        </div>
        <div className="t-stack" style={{ gap: 8 }}>
          <span
            className="t-row t-row--wrap"
            style={{ gap: 4 }}
            role="group"
            aria-label={t("ui.reader-pages.bench-evidence")}
          >
            {EVIDENCE.map((e) => (
              <Chip key={e} pressed={s.evidence === e} onClick={() => set({ evidence: e })}>
                {evidenceLabel[e]}
              </Chip>
            ))}
          </span>
          <span
            className="t-row t-row--wrap"
            style={{ gap: 4 }}
            role="group"
            aria-label={t("ui.reader-pages.bench-readership")}
          >
            {AUDIENCES.map((a) => (
              <Chip key={a} pressed={s.audience === a} onClick={() => set({ audience: a })}>
                {audienceLabel[a]}
              </Chip>
            ))}
            <span className="t-meta" data-testid="bench-unclassified">
              {t("ui.reader-pages.bench-count-total-scenarios-without-readership", {
                count: unclassified,
                total: all.length,
              })}
            </span>
          </span>
        </div>
        {cats.length ? (
          <>
            <div
              className="t-surface t-a-list"
              data-testid="bench-tree"
              role="list"
              aria-label={t("ui.reader-pages.bench-promises-capability-feature")}
            >
              {slice(cats, s.cats, CATS_PAGE).map((c) => {
                const catOpen = openCats.includes(c.cat);
                const featuresPage = s.pages[`cat:${c.cat}`] ?? 1;
                return (
                  <div key={c.cat} role="listitem" data-testid="bench-category">
                    <button
                      type="button"
                      className="t-list-row"
                      aria-expanded={catOpen}
                      onClick={() => set({ openCats: toggle(openCats, c.cat) })}
                    >
                      <span aria-hidden="true">{catOpen ? "▾" : "▸"}</span>
                      <span className="t-list-row__main">
                        <span className="t-list-row__title t-mono t-wrap">{c.cat}</span>
                        <span className="t-list-row__sub" data-testid="bench-category-count">
                          {filtering
                            ? t(
                                "ui.reader-pages.bench-shown-features-features-matching-scenarios-scenarios",
                                {
                                  shown: c.shown.length,
                                  features: c.features.length,
                                  matching: c.matching,
                                  scenarios: c.scenarios,
                                },
                              )
                            : t(
                                "ui.reader-pages.bench-count-features-scenarios-scenarios-open-open",
                                {
                                  count: c.features.length,
                                  scenarios: c.scenarios,
                                  open: c.open,
                                },
                              )}
                        </span>
                      </span>
                      <span />
                    </button>
                    {catOpen ? (
                      <div className="t-stack" style={{ paddingLeft: 16 }}>
                        {slice(c.shown, featuresPage, FEATURES_PAGE).map((f) => {
                          const featOpen = s.openFeatures.includes(f.id);
                          const scen = f.scen.filter(keep);
                          const promisesPage = s.pages[`f:${f.id}`] ?? 1;
                          const state = verdict(f, t);
                          return (
                            <div key={f.id} data-testid="bench-feature">
                              <button
                                type="button"
                                className="t-list-row"
                                aria-expanded={featOpen}
                                onClick={() => set({ openFeatures: toggle(s.openFeatures, f.id) })}
                              >
                                <span aria-hidden="true">{featOpen ? "▾" : "▸"}</span>
                                <span className="t-list-row__main">
                                  <span className="t-list-row__title t-mono t-wrap">
                                    {short(f.id)}
                                  </span>
                                  <span
                                    className="t-list-row__sub"
                                    data-testid="bench-feature-state"
                                  >
                                    {[
                                      state.text,
                                      f.hasKnow
                                        ? ""
                                        : t("ui.reader-pages.bench-documentation-missing"),
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </span>
                                </span>
                                <span className="t-row">
                                  {state.tone ? (
                                    <Badge tone={state.tone} plain>
                                      {f.claims ? `${f.proven}/${f.claims}` : "—"}
                                    </Badge>
                                  ) : null}
                                </span>
                              </button>
                              {featOpen ? (
                                <div className="t-stack" style={{ paddingLeft: 16 }}>
                                  {scen.length ? (
                                    slice(scen, promisesPage, PROMISES_PAGE).map((x) => (
                                      <button
                                        key={x.id}
                                        type="button"
                                        className="t-list-row"
                                        data-testid="bench-promise"
                                        onClick={() => ctx.go(record(f.id, x.id))}
                                      >
                                        <span />
                                        <span className="t-list-row__main" style={{ gap: 4 }}>
                                          <span className="t-list-row__title t-wrap">
                                            {x.then || x.id}{" "}
                                            {x.deviation ? (
                                              <Badge tone="warn">
                                                {t("ui.reader-pages.bench-deviation")}
                                              </Badge>
                                            ) : null}
                                          </span>
                                          <span className="t-list-row__sub t-mono t-wrap">
                                            {x.id}
                                          </span>
                                          <Measures s={x} t={t} />
                                        </span>
                                        <span />
                                      </button>
                                    ))
                                  ) : (
                                    // Features that match nothing are gone already; an
                                    // empty one left standing is a record without a scenario.
                                    <p className="t-muted t-pad" data-testid="bench-no-scenario">
                                      {t("ui.reader-pages.bench-record-holds-no-scenario")}
                                    </p>
                                  )}
                                  <Pager
                                    ctx={ctx}
                                    page={promisesPage}
                                    size={PROMISES_PAGE}
                                    total={scen.length}
                                    onPage={(n) => set({ pages: { ...s.pages, [`f:${f.id}`]: n } })}
                                  />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                        <Pager
                          ctx={ctx}
                          page={featuresPage}
                          size={FEATURES_PAGE}
                          total={c.shown.length}
                          onPage={(n) => set({ pages: { ...s.pages, [`cat:${c.cat}`]: n } })}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <Pager
              ctx={ctx}
              page={s.cats}
              size={CATS_PAGE}
              total={cats.length}
              onPage={(n) => set({ cats: n })}
            />
          </>
        ) : (
          <p className="t-muted" data-testid="bench-empty">
            {s.audience !== "all"
              ? t("ui.reader-pages.bench-no-scenario-assigned-readership")
              : t("ui.reader-pages.bench-no-scenario-matches-selection")}
          </p>
        )}
      </Section>
      <Section
        title={t("ui.reader-pages.bench-where-something-missing")}
        meta={t("ui.reader-pages.bench-three-kinds")}
      >
        <div
          style={{
            display: "grid",
            gap: "var(--t-s-4)",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {gap(
            "tests",
            t("ui.reader-pages.bench-tests-missing"),
            testsMissing,
            (f) =>
              t("ui.reader-pages.bench-open-claims-promises-without-test", {
                open: f.open,
                claims: f.claims,
              }),
            t("ui.reader-pages.bench-every-promise-named-test"),
          )}
          {gap(
            "docs",
            t("ui.reader-pages.bench-documentation-missing-bench"),
            noDocs,
            () => t("ui.reader-pages.bench-knowledge-empty"),
            t("ui.reader-pages.bench-every-feature-has-filled-knowledge-slots"),
          )}
          {gap(
            "none",
            t("ui.reader-pages.bench-record-names-no-test"),
            noTests,
            (f) => t("ui.reader-pages.bench-count-promises-0-tests", { count: f.claims }),
            t("ui.reader-pages.bench-every-record-names-least-one-test"),
          )}
        </div>
      </Section>
    </>
  );
}

// Explicit labels keep computed lookups in the caller-derived key inventory.
const I18N_LABELS: Record<string, string> = {
  label_one: "ui.reader-pages.bench-failing-tests-one",
  label_other: "ui.reader-pages.bench-failing-tests-other",
  unmeasured: "ui.reader-pages.bench-not-measured",
  fresh: "ui.reader-pages.bench-passed-passed-unmeasured-unmeasured-commit-sha",
  pending: "ui.reader-pages.bench-reading-report",
  none: "ui.reader-pages.bench-no-report-facet-ui-test-report",
  "no-entry": "ui.reader-pages.bench-no-report-registry",
  "no-head": "ui.reader-pages.bench-report-names-no-commit-cannot-checked",
  "no-git": "ui.reader-pages.bench-repository-s-head-cannot-read",
  stale: "ui.reader-pages.bench-report-out-date",
  dirty: "ui.reader-pages.bench-report-was-measured-modified-working-tree",
  "unmeasured-state": "ui.reader-pages.bench-report-has-no-measured-file",
  ambiguous: "ui.reader-pages.bench-report-ambiguous-not-read",
  "tree-changed": "ui.reader-pages.bench-working-tree-changed-since-report",
  "unreadable-not-regular": "ui.reader-pages.bench-report-unreadable-not-regular-file",
  "unreadable-too-large": "ui.reader-pages.bench-report-unreadable-too-large",
  "unreadable-permission": "ui.reader-pages.bench-report-unreadable-no-permission-read",
  "unreadable-not-json": "ui.reader-pages.bench-report-unreadable-not-json",
  "unreadable-wrong-shape": "ui.reader-pages.bench-report-unreadable-wrong-shape",
  "unreadable-io": "ui.reader-pages.bench-report-unreadable-read-error",
  label: "ui.reader-pages.bench-failing-tests",
};
