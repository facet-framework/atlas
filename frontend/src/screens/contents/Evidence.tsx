import { useState } from "react";
import {
  Button,
  Chip,
  IconButton,
  EmptyState,
  DataTable,
  Pagination,
  type SortDir,
  Icon,
  BarChart,
  Pyramid,
  ShareBar,
} from "@facet-tools/ui";
import { DriftMark } from "@/chrome";
import { useText, type FacetText } from "../text";
import type { TextKey } from "../text";
import { DetailCard, originOf, type CardOrigin } from "./detail";
import { KindFrame, MiniStat, PathRef, RecordRef, short } from "./frame";
import { sharePercent } from "../../share";
import type {
  Deviation,
  DriftItem,
  FixCommit,
  TestFileRow,
  TestKind,
  TestRunner,
  ViewDef,
} from "./model";

/** Tests ------------------------------------------------------------------- */

export type TestsView = "pyramid" | "file-tree" | "table";

export type TestsPageProps = {
  view: TestsView;
  kinds: { kind: TestKind; tests: number; files: number; promises: number }[];
  runners: TestRunner[];
  /** Files for the tree and the current table page. */
  files: TestFileRow[];
  page: number;
  pageSize: number;
  total: number;
  sort?: { key: string; dir: SortDir };
  kind?: TestKind | null;
  expanded?: string[];
  mobile?: boolean;
  onView?: (v: TestsView) => void;
  onKind?: (k: string) => void;
  onToggle?: (dir: string) => void;
  onSort?: (key: string) => void;
  onPage?: (p: number) => void;
  onOpenFile?: (path: string) => void;
};

const TS_VIEWS: (ViewDef<TestsView> & { label: TextKey })[] = [
  { value: "pyramid", label: "ui.screens-contents.evidence-pyramid", icon: "layers" },
  { value: "file-tree", label: "ui.screens-contents.evidence-file-tree", icon: "tree" },
  { value: "table", label: "ui.screens-contents.evidence-table", icon: "table" },
];

const dirOf = (p: string) => p.split("/").slice(0, -1).join("/") || ".";

/** Tests: the test pyramid, the files with the promises they name, and the runners. */
export function TestsPage(p: TestsPageProps) {
  const { t, plural, number } = useText();
  const tests = p.kinds.reduce((a, k) => a + k.tests, 0);
  const files = p.kinds.reduce((a, k) => a + k.files, 0);
  const unit = p.kinds.find((k) => k.kind === "Unit")?.tests ?? 0;
  const dirs = [...new Set(p.files.map((f) => dirOf(f.path)))];
  return (
    <KindFrame
      groupId="Evidence"
      testId="tests-page"
      kindLabel="Tests"
      group={t("ui.screens-contents.evidence-tests-findings")}
      figure={number(tests)}
      sentence={plural(
        "ui.screens-contents.evidence-tests-tests-count-files-name-promises",
        files,
        {
          tests,
        },
      )}
      // No declared test, no denominator: a share of nothing is left out, never 0 %.
      lead={
        tests
          ? t("ui.screens-contents.evidence-share-them-unit-tests", {
              share: sharePercent(unit, tests) ?? 0,
            })
          : undefined
      }
      stats={p.kinds.map((k) => (
        <MiniStat key={k.kind} label={k.kind} value={k.tests} />
      ))}
      views={TS_VIEWS.map((v) => ({ ...v, label: t(v.label) }))}
      view={p.view}
      onView={p.onView}
    >
      {p.view === "pyramid" ? (
        <div className="t-c-split" data-testid="tests-pyramid">
          <div className="t-surface t-pad t-stack">
            <Pyramid
              label={t("ui.screens-contents.evidence-test-pyramid")}
              selected={p.kind}
              onPick={p.onKind}
              layers={["E2E", "Integration", "Unit"].map((k) => {
                const row = p.kinds.find((x) => x.kind === k);
                return {
                  key: k,
                  label: k,
                  value: row?.tests ?? 0,
                  meta: `${plural(
                    "ui.screens-contents.evidence-count-files",
                    row?.files ?? 0,
                  )} · ${plural(
                    "ui.screens-contents.evidence-count-promises",
                    row?.promises ?? 0,
                  )}`,
                };
              })}
            />
          </div>
          <div className="t-stack">
            <span className="t-label">{t("ui.screens-contents.evidence-runners")}</span>
            <ul
              className="t-c-plain t-stack"
              style={{ gap: 8 }}
              aria-label={t("ui.screens-contents.evidence-runners")}
            >
              {p.runners.map((r) => (
                <li key={r.id} className="t-raised t-c-runner">
                  <div className="t-row">
                    <Icon name="play" size={14} />
                    <span className="t-mono">{r.id}</span>
                    <span className="t-spacer" />
                    <span className="t-badge t-badge--plain">{r.report}</span>
                  </div>
                  <code className="t-c-code t-wrap" title={r.command}>
                    {r.cwd ? `${r.cwd} $ ` : "$ "}
                    {r.command}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : p.view === "file-tree" ? (
        <ul
          className="t-c-tree t-c-ttree"
          role="tree"
          aria-label={t("ui.screens-contents.evidence-tests-tests-count-files-name-promises")}
          data-testid="tests-tree"
        >
          {dirs.map((d) => {
            const list = p.files.filter((f) => dirOf(f.path) === d);
            const open = p.expanded?.includes(d) ?? false;
            const prom = list.reduce((a, f) => a + f.promises, 0);
            return (
              <li key={d} role="treeitem" aria-expanded={open} aria-selected={false}>
                <button
                  type="button"
                  className="t-c-tree__row t-c-tree__row--domain"
                  onClick={() => p.onToggle?.(d)}
                >
                  <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
                  <Icon name="folder" size={14} />
                  <span className="t-c-tree__name t-mono">{d}/</span>
                  <ShareBar
                    label={t("ui.screens-contents.evidence-dir-kinds", { dir: d })}
                    parts={(["Unit", "Integration", "E2E"] as const).map((k, i) => ({
                      key: k,
                      value: list.filter((f) => f.kind === k).length,
                      tone: (["signal", "plan", "ok"] as const)[i],
                    }))}
                  />
                  <span className="t-meta t-hide-mobile">
                    {t("ui.screens-contents.evidence-count-files", { count: list.length })}
                  </span>
                  <span className="t-num t-c-tree__n">{number(prom)}</span>
                </button>
                {open ? (
                  <ul role="group" className="t-c-tree__children">
                    {list.map((f) => (
                      <li key={f.path} role="treeitem" aria-selected={false}>
                        <button
                          type="button"
                          className="t-c-tree__row"
                          onClick={() => p.onOpenFile?.(f.path)}
                        >
                          <span className="t-c-tree__indent" aria-hidden="true" />
                          <span className="t-c-tree__name t-mono t-c-small">
                            {f.path.split("/").pop()}
                          </span>
                          <span className="t-badge t-badge--plain t-c-ttree__kind">{f.kind}</span>
                          <span className="t-meta t-hide-mobile">
                            {f.tests}{" "}
                            {f.tests === 1
                              ? t("ui.screens-contents.evidence-test")
                              : t("ui.screens-contents.evidence-tests")}{" "}
                            ·{" "}
                            {plural("ui.screens-contents.evidence-count-records", f.records.length)}
                          </span>
                          <span className="t-num t-c-tree__n">{f.promises}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="t-stack" data-testid="tests-table">
          <DataTable
            label={t("ui.screens-contents.evidence-tests-tests-count-files-name-promises")}
            rows={p.files}
            rowKey={(f) => f.path}
            sort={p.sort}
            onSort={p.onSort}
            onRowClick={(f) => p.onOpenFile?.(f.path)}
            columns={[
              {
                key: "path",
                label: t("ui.screens-contents.evidence-file"),
                sortable: true,
                render: (f) => <PathRef path={f.path} />,
              },
              {
                key: "kind",
                label: t("ui.screens-contents.evidence-kind"),
                sortable: true,
                render: (f) => <span className="t-badge t-badge--plain">{f.kind}</span>,
              },
              {
                key: "tests",
                label: "Tests",
                numeric: true,
                sortable: true,
                render: (f) => f.tests,
              },
              {
                key: "promises",
                label: t("ui.screens-contents.evidence-promises"),
                numeric: true,
                sortable: true,
                render: (f) => f.promises,
              },
              {
                key: "records",
                label: "Records",
                hideOnMobile: true,
                render: (f) => (
                  <span className="t-meta t-wrap" title={f.records.join(", ")}>
                    {f.records.slice(0, 2).map(short).join(", ")}
                    {f.records.length > 2 ? ` +${f.records.length - 2}` : ""}
                  </span>
                ),
              },
            ]}
          />
          <Pagination
            page={p.page}
            pageSize={p.pageSize}
            total={p.total}
            onPage={p.onPage}
            compact={p.mobile}
          />
        </div>
      )}
    </KindFrame>
  );
}

/** Deviations --------------------------------------------------------------- */

export type DeviationsPageProps = {
  state: "ready" | "empty";
  items: Deviation[];
  promises: number;
  onOpenRecord?: (id: string) => void;
  /** Next step from the empty protocol: the promises themselves. */
  onOpenPromises?: () => void;
};

/** Deviations: behaviour the code demonstrably shows and nobody wants — a protocol, not a requirement. */
export function DeviationsPage({
  state,
  items,
  promises,
  onOpenRecord,
  onOpenPromises,
}: DeviationsPageProps) {
  const { t, plural, number } = useText();
  const unconfirmed = items.filter((i) => !i.confirmedBy).length;
  return (
    <KindFrame
      groupId="Evidence"
      testId="deviations-page"
      kindLabel={t("ui.screens-contents.evidence-deviations")}
      group={t("ui.screens-contents.evidence-tests-findings")}
      figure={state === "empty" ? number(0) : number(items.length)}
      of={number(promises)}
      tone={state === "empty" ? "ok" : "bad"}
      sentence={
        state === "empty"
          ? t("ui.screens-contents.evidence-no-promise-deviates")
          : plural(
              "ui.screens-contents.evidence-count-promises-show-behaviour-nobody-wants",
              items.length,
            )
      }
      lead={
        state === "empty"
          ? undefined
          : t("ui.screens-contents.evidence-count-them-without-confirmation", {
              count: unconfirmed,
            })
      }
    >
      {state === "empty" ? (
        <EmptyState
          icon="check"
          title={t("ui.screens-contents.evidence-no-behaviour-protocol")}
          body={
            <>
              {t("ui.screens-contents.evidence-deviation-recorded")}
              <code className="t-mono">{t("ui.screens-contents.evidence-deviation")}</code>
              {t("ui.screens-contents.evidence-scenario")}
            </>
          }
          action={
            <Button variant="primary" icon="shield" onClick={onOpenPromises}>
              {t("ui.screens-contents.evidence-view-promises")}
            </Button>
          }
        />
      ) : (
        <ul
          className="t-c-plain t-stack t-stagger"
          style={{ gap: 12 }}
          aria-label={t("ui.screens-contents.evidence-deviations")}
        >
          {items.map((d) => (
            <li key={d.key} className="t-surface t-c-dev">
              <div className="t-c-dev__mark" aria-hidden="true">
                ≠
              </div>
              <div className="t-stack" style={{ gap: 6 }}>
                <div className="t-row t-row--wrap">
                  <RecordRef id={d.recordId} onOpen={onOpenRecord} />
                  <span className="t-meta">{d.scenarioId}</span>
                </div>
                <p className="t-c-dev__then">
                  <span className="t-label">
                    {t("ui.screens-contents.evidence-then-observed")}{" "}
                  </span>
                  {d.then}
                </p>
                <p className="t-c-small t-ink2">{d.reason}</p>
              </div>
              <div className="t-c-dev__side">
                {d.confirmedBy ? (
                  <span className="t-badge t-badge--plain">
                    <Icon name="person" size={12} /> {d.confirmedBy}
                  </span>
                ) : (
                  <span className="t-badge t-badge--warn">
                    {t("ui.screens-contents.evidence-not-confirmed")}
                  </span>
                )}
                {d.since == null ? (
                  <span
                    className="t-meta"
                    title={t("ui.screens-contents.evidence-not-measured")}
                    data-testid="deviation-since-unmeasured"
                  >
                    {t("ui.screens-contents.evidence-since-date", { date: "—" })}
                  </span>
                ) : (
                  <span className="t-meta">
                    {t("ui.screens-contents.evidence-since-date", { date: d.since })}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </KindFrame>
  );
}

/** Drift --------------------------------------------------------------------- */

export type DriftView = "record" | "timeline";

export type DriftPageProps = {
  view: DriftView;
  state: "ready" | "empty";
  items: DriftItem[];
  /** Reference date (ISO) for ages. */
  now: string;
  onView?: (v: DriftView) => void;
  onOpenRecord?: (id: string) => void;
  onReview?: (id: string) => void;
  /** Next step from the empty state: compare again against the merge base. */
  onRecheck?: () => void;
  /** How many records the registry holds. With it, the drift mark beside the
   * figure is offset by the share of records with drift; without it, no mark. */

  recordTotal?: number;
};

const D_VIEWS: (ViewDef<DriftView> & { label: TextKey })[] = [
  { value: "record", label: "ui.screens-contents.evidence-record", icon: "document" },
  { value: "timeline", label: "ui.screens-contents.evidence-timeline", icon: "timeline" },
];

export const ageDays = (now: string, at: string) =>
  Math.max(0, Math.round((Date.parse(now) - Date.parse(at)) / 86_400_000));

/** An age in days as a word: today, yesterday, or n days ago, in the language of `t`. */
export const ageWord = (d: number, t: FacetText["t"]) =>
  d === 0
    ? t("ui.screens-contents.evidence-today")
    : d === 1
      ? t("ui.screens-contents.evidence-yesterday")
      : t("ui.screens-contents.evidence-count-days-ago", { count: d });

/** Drift: code that changed without its record following. */
export function DriftPage(p: DriftPageProps) {
  const { t, plural, number } = useText();
  const records = [...new Set(p.items.map((i) => i.recordId))];
  const days = [...new Set(p.items.map((i) => i.changedAt.slice(0, 10)))].sort().reverse();
  const oldest = p.items.length ? Math.max(...p.items.map((i) => ageDays(p.now, i.changedAt))) : 0;
  return (
    <KindFrame
      groupId="Evidence"
      testId="drift-page"
      kindLabel={t("ui.screens-contents.evidence-drift")}
      group={t("ui.screens-contents.evidence-tests-findings")}
      figure={p.state === "empty" ? number(0) : number(p.items.length)}
      mark={
        p.recordTotal ? (
          <DriftMark share={p.state === "empty" ? 0 : records.length / p.recordTotal} />
        ) : undefined
      }
      tone={p.state === "empty" ? "ok" : "warn"}
      sentence={
        p.state === "empty"
          ? t("ui.screens-contents.evidence-every-record-has-followed-its-code")
          : plural(
              "ui.screens-contents.evidence-count-files-changed-after-their-record",
              p.items.length,
            )
      }
      lead={
        p.state === "empty"
          ? undefined
          : t("ui.screens-contents.evidence-count-records-affected-oldest-drift-age", {
              count: records.length,
              age: ageWord(oldest, t),
            })
      }
      stats={
        p.state === "empty" ? undefined : (
          <>
            <MiniStat
              label={t("ui.screens-contents.evidence-files")}
              value={p.items.length}
              tone="warn"
            />
            <MiniStat label="Records" value={records.length} />
            <MiniStat
              label={t("ui.screens-contents.evidence-oldest-drift")}
              value={ageWord(oldest, t)}
            />
          </>
        )
      }
      views={p.state === "empty" ? undefined : D_VIEWS.map((v) => ({ ...v, label: t(v.label) }))}
      view={p.view}
      onView={p.onView}
    >
      {p.state === "empty" ? (
        <EmptyState
          icon="check"
          title={t("ui.screens-contents.evidence-no-drift")}
          body={t("ui.screens-contents.evidence-since-last-comparison-every-record-follows")}
          action={
            <Button variant="primary" icon="refresh" onClick={p.onRecheck}>
              {t("ui.screens-contents.evidence-compare-again")}
            </Button>
          }
        />
      ) : p.view === "record" ? (
        <div className="t-stack t-stagger" style={{ gap: 12 }} data-testid="drift-by-record">
          {records.map((rid) => {
            const list = p.items.filter((i) => i.recordId === rid);
            return (
              <section key={rid} className="t-surface t-c-group" aria-label={rid}>
                <header className="t-c-group__head">
                  <Icon name="offsetBlocks" size={16} className="t-warn" />
                  <RecordRef id={rid} onOpen={p.onOpenRecord} />
                  <span className="t-spacer" />
                  <span className="t-meta">
                    {plural("ui.screens-contents.evidence-count-files", list.length)}
                  </span>
                  <Button
                    size="small"
                    variant="quiet"
                    icon="check"
                    onClick={() => p.onReview?.(rid)}
                  >
                    {t("ui.screens-contents.evidence-reconcile")}
                  </Button>
                </header>
                <ul className="t-c-plain">
                  {list.map((i) => (
                    <li key={i.path} className="t-c-driftrow">
                      <PathRef path={i.path} />
                      <span className="t-meta">{i.changedAt.slice(0, 16).replace("T", " ")}</span>
                      <span className="t-badge t-badge--warn">
                        {ageWord(ageDays(p.now, i.changedAt), t)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <ol
          className="t-c-timeline t-c-timeline--grid"
          aria-label={t("ui.screens-contents.evidence-timeline")}
          data-testid="drift-timeline"
        >
          {days.map((d) => {
            const list = p.items.filter((i) => i.changedAt.startsWith(d));
            return (
              <li key={d} className="t-c-timeline__day">
                <span className="t-c-timeline__node" aria-hidden="true" />
                <div className="t-c-timeline__date">
                  <span className="t-mono">{d}</span>
                  <span className="t-meta">{ageWord(ageDays(p.now, `${d}T12:00:00Z`), t)}</span>
                </div>
                <ul className="t-c-plain t-stack t-c-timeline__items" style={{ gap: 6 }}>
                  {list.map((i) => (
                    <li key={i.recordId + i.path} className="t-raised t-c-timeline__item">
                      <PathRef path={i.path} />
                      <span className="t-row t-c-small">
                        <span className="t-meta">{i.changedAt.slice(11, 16)}</span>
                        <RecordRef id={i.recordId} onOpen={p.onOpenRecord} />
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </KindFrame>
  );
}

/** Fixed ----------------------------------------------------------------------- */

export type FixedView = "timeline" | "domain";

export type FixedPageProps = {
  view: FixedView;
  commits: FixCommit[];
  domain?: string | null;
  mobile?: boolean;
  onView?: (v: FixedView) => void;
  onDomain?: (d: string) => void;
  onOpenRecord?: (id: string) => void;
  /** Copy text (the full commit hash) to the clipboard. */
  onCopy?: (text: string) => void;
};

const F_VIEWS: (ViewDef<FixedView> & { label: TextKey })[] = [
  { value: "timeline", label: "ui.screens-contents.evidence-timeline-fixedpage", icon: "timeline" },
  { value: "domain", label: "ui.screens-contents.evidence-area", icon: "layers" },
];

/** The abbreviated hash, as `git log --oneline` prints it. */
export const shortSha = (sha: string) => sha.slice(0, 7);

function FixRow({
  c,
  open,
  onOpen,
  onOpenRecord,
  onCopy,
}: {
  c: FixCommit;
  open: boolean;
  onOpen: (origin?: CardOrigin) => void;
  onOpenRecord?: (id: string) => void;
  onCopy?: (text: string) => void;
}) {
  const { t } = useText();
  return (
    <li className="t-c-fix" data-testid={`fix-${c.sha}`}>
      <span className="t-c-fix__hash">
        <span className="t-c-fix__sha t-mono" title={c.sha}>
          {shortSha(c.sha)}
        </span>
        {onCopy ? (
          <IconButton
            icon="copy"
            size="small"
            label={t("ui.screens-contents.evidence-copy-full-hash")}
            onClick={() => onCopy(c.sha)}
          />
        ) : null}
      </span>
      <div className="t-stack" style={{ gap: 4, minWidth: 0 }}>
        <button
          type="button"
          className="t-c-fix__open"
          aria-haspopup="dialog"
          aria-expanded={open || undefined}
          onClick={(e) => onOpen(originOf(e.currentTarget))}
        >
          {c.scope ? <span className="t-badge t-badge--plain">{c.scope}</span> : null}{" "}
          <span className="t-c-fix__subject t-wrap">{c.subject}</span>
        </button>
        <span className="t-row t-row--wrap" style={{ gap: 4 }}>
          {c.records.slice(0, 3).map((r) => (
            <Chip key={r} mono onClick={() => onOpenRecord?.(r)}>
              {short(r)}
            </Chip>
          ))}
          {c.records.length > 3 ? <span className="t-meta">+{c.records.length - 3}</span> : null}
        </span>
      </div>
      <span className="t-meta t-hide-mobile">{c.date}</span>
    </li>
  );
}

/** What one fix commit says: hash, date, message, ticket, records and files, as far as reported. */
function FixDetail({
  c,
  origin,
  mobile,
  onClose,
  onOpenRecord,
  onCopy,
}: {
  c: FixCommit;
  origin?: CardOrigin;
  mobile?: boolean;
  onClose: () => void;
  onOpenRecord?: (id: string) => void;
  onCopy?: (text: string) => void;
}) {
  const { t } = useText();
  const unmeasured = (
    <span className="t-muted" title={t("ui.screens-contents.evidence-not-measured")}>
      — {t("ui.screens-contents.evidence-not-measured")}
    </span>
  );
  return (
    <DetailCard
      testId="fix-detail"
      label={`${shortSha(c.sha)} · ${c.subject}`}
      eyebrow={c.scope ?? undefined}
      title={c.subject}
      meta={`${shortSha(c.sha)} · ${c.date}`}
      origin={origin}
      mobile={mobile}
      onClose={onClose}
    >
      <dl className="t-c-dcard__facts">
        <dt>{t("ui.screens-contents.evidence-hash")}</dt>
        <dd className="t-row" style={{ gap: 6 }}>
          <span className="t-mono t-wrap">{c.sha}</span>
          {onCopy ? (
            <IconButton
              icon="copy"
              size="small"
              label={t("ui.screens-contents.evidence-copy-full-hash")}
              onClick={() => onCopy(c.sha)}
            />
          ) : null}
        </dd>
        <dt>{t("ui.screens-contents.evidence-date")}</dt>
        <dd>{c.date || unmeasured}</dd>
        <dt>{t("ui.screens-contents.evidence-message")}</dt>
        <dd>{c.subject || unmeasured}</dd>
        <dt>{t("ui.screens-contents.evidence-ticket")}</dt>
        <dd>{c.ticket ? <span className="t-mono">{c.ticket}</span> : unmeasured}</dd>
        <dt>{t("ui.screens-contents.evidence-recorded")}</dt>
        <dd>{c.recordedBy ? c.recordedBy : unmeasured}</dd>
        <dt>{t("ui.screens-contents.evidence-records")}</dt>
        <dd>
          <span className="t-row t-row--wrap" style={{ gap: 4 }}>
            {c.records.map((r) => (
              <Chip key={r} mono onClick={() => onOpenRecord?.(r)}>
                {r}
              </Chip>
            ))}
          </span>
        </dd>
        <dt>{t("ui.screens-contents.evidence-files")}</dt>
        <dd>
          {c.files?.length ? (
            <ul className="t-c-plain t-stack" style={{ gap: 2 }}>
              {c.files.map((f) => (
                <li key={f} className="t-mono t-wrap">
                  {f}
                </li>
              ))}
            </ul>
          ) : (
            unmeasured
          )}
        </dd>
      </dl>
    </DetailCard>
  );
}

/** Fixed defects: bug-fix commits, attributed to records through their anchors. */
export function FixedPage(p: FixedPageProps) {
  const { t, number } = useText();
  const monthNames = t("ui.screens-contents.evidence-january-february-march-april-may-june").split(
    " ",
  );
  const months = [...new Set(p.commits.map((c) => c.date.slice(0, 7)))].sort().reverse();
  const domains = [...new Set(p.commits.map((c) => c.domain))];
  const byDomain = domains
    .map((d) => ({ d, n: p.commits.filter((c) => c.domain === d).length }))
    .sort((a, b) => b.n - a.n);
  const active = p.domain ?? byDomain[0]?.d;
  const [detail, setDetail] = useState<{ sha: string; origin?: CardOrigin } | null>(null);
  const shown = detail ? p.commits.find((c) => c.sha === detail.sha) : undefined;
  const row = (c: FixCommit) => (
    <FixRow
      key={c.sha}
      c={c}
      open={detail?.sha === c.sha}
      onOpen={(origin) => setDetail({ sha: c.sha, origin })}
      onOpenRecord={p.onOpenRecord}
      onCopy={p.onCopy}
    />
  );
  return (
    <KindFrame
      groupId="Evidence"
      testId="fixed-page"
      kindLabel={t("ui.screens-contents.evidence-fixed")}
      group={t("ui.screens-contents.evidence-tests-findings")}
      figure={number(p.commits.length)}
      sentence={t("ui.screens-contents.evidence-count-bug-fixes-hit-anchored-code", {
        count: p.commits.length,
      })}
      lead={t("ui.screens-contents.evidence-months-months-areas-areas-last-last", {
        months: months.length,
        areas: domains.length,
        last: p.commits[0]?.date ?? "—",
      })}
      views={F_VIEWS.map((v) => ({ ...v, label: t(v.label) }))}
      view={p.view}
      onView={p.onView}
    >
      {p.view === "timeline" ? (
        <ol
          className="t-c-timeline"
          aria-label={t("ui.screens-contents.evidence-timeline-fixedpage")}
          data-testid="fixed-timeline"
        >
          {months.map((m) => {
            const list = p.commits.filter((c) => c.date.startsWith(m));
            return (
              <li key={m} className="t-c-timeline__day">
                <span className="t-c-timeline__node" aria-hidden="true" />
                <div className="t-c-timeline__date">
                  <span>
                    {monthNames[Number(m.slice(5)) - 1]} {m.slice(0, 4)}
                  </span>
                  <span className="t-meta">
                    {t("ui.screens-contents.evidence-count-fixes", { count: list.length })}
                  </span>
                </div>
                <ul className="t-c-plain t-surface t-c-fixlist">{list.map(row)}</ul>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="t-c-split t-c-split--narrow" data-testid="fixed-by-domain">
          <div className="t-surface t-pad">
            <BarChart
              label={t("ui.screens-contents.evidence-fixes-per-area")}
              onPick={p.onDomain}
              bars={byDomain.map((b) => ({
                key: b.d,
                label: <span className="t-mono">{b.d}</span>,
                value: b.n,
                tone: b.d === active ? "warn" : "signal",
              }))}
            />
          </div>
          <section
            className="t-stack"
            aria-label={t("ui.screens-contents.evidence-fixes-record", { record: active })}
          >
            <div className="t-row">
              <span className="t-h3 t-mono">{active}</span>
              <span className="t-meta">
                {t("ui.screens-contents.evidence-count-fixes", {
                  count: p.commits.filter((c) => c.domain === active).length,
                })}
              </span>
            </div>
            <ul className="t-c-plain t-surface t-c-fixlist">
              {p.commits.filter((c) => c.domain === active).map(row)}
            </ul>
          </section>
        </div>
      )}
      {shown ? (
        <FixDetail
          c={shown}
          origin={detail?.origin}
          mobile={p.mobile}
          onClose={() => setDetail(null)}
          onOpenRecord={(id) => {
            setDetail(null);
            p.onOpenRecord?.(id);
          }}
          onCopy={p.onCopy}
        />
      ) : null}
    </KindFrame>
  );
}
