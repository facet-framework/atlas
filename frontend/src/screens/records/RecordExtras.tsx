/** The parts of the record page that read a record's own declarations beyond
 * its promises: an Outline's example cases, the business rules and the
 * decisions it rests on, a dependency cycle it sits on, and the lookup panel
 * that shows a term or a referenced record beside the page. */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Badge, Button, Chip, Sheet, Icon, IconButton } from "@facet-tools/ui";

import { useText } from "../text";
import { LIFECYCLE, type GwtStep, type Lifecycle } from "./model";
import { StepList, cx, splitParams } from "./parts";

/** One `examples` block of a Scenario Outline, columns inherited where it declares none. */
export type RecordExamples = { name: string; columns: string[]; rows: string[][] };

/** A business rule a scenario is a case of, with the line saying what it fixes. */
export type RecordCaseOf = { id: string; states: string };

/** `contract.business_rules[]` as the record writes it (the specification). */
export type RecordBusinessRule = {
  id: string;
  kind: "table" | "formula";
  states: string;
  /** Path of the model the rule points at (a DMN file); empty when the record names none. */
  model: string;
  element: string;
  /** The author's claim on a table; `null` on a formula or where nothing is claimed. */
  completeness: "claimed" | "not-claimed" | null;
  /** Scenario ids the rule names as cases; `declared` says whether the record has them. */
  cases: { id: string; declared: boolean }[];
};

/** A target of `intent.decision_records`. */
export type RecordDecision = { target: string };

export type LookupTarget =
  | {
      kind: "term";
      term: string;
      definition: string;
      /** `null`: the project groups no terms, so no category line is drawn. */
      category: { label: string; declared: boolean } | "unassigned" | null;
      renderings: string[];
      records: string[];
    }
  | {
      kind: "record";
      id: string;
      recordKind: string;
      lifecycle?: Lifecycle;
      summary: string;
      referredBy: string[];
    }
  | { kind: "missing"; what: "term" | "record"; id: string };

/** One case of an Outline: a row of one examples block, as column → value. */
export type ExampleCase = { block: string; values: Record<string, string> };

/** Every row of every block, in record order. A row shorter than its
 * columns leaves the missing columns out rather than inventing a value. */
export function casesOf(blocks: RecordExamples[]): ExampleCase[] {
  return blocks.flatMap((b) =>
    b.rows.map((row) => ({
      block: b.name,
      values: Object.fromEntries(
        b.columns.flatMap((c, i) => (i < row.length ? [[c, row[i]] as const] : [])),
      ),
    })),
  );
}

/** Steps through an Outline's cases: which case of how many, the block it
 * belongs to, the values of columns no step names, and a switch for the
 * table of every case. */
// @facet: registry/records/scenario-outline-reading
// @facet-role: related
export function ExampleStepper({
  cases,
  at,
  onAt,
  scenarioId,
  shown,
  open,
  onOpen,
}: {
  cases: ExampleCase[];
  at: number;
  onAt: (i: number) => void;
  scenarioId: string;
  /** Columns a step already shows in place. */
  shown: ReadonlySet<string>;
  /** Whether the table of every case is open below the steps. */
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const { t } = useText();
  const c = cases[at];
  if (!c) return null;
  const rest = Object.entries(c.values).filter(([k]) => !shown.has(k));
  return (
    <div
      className="t-b-cases"
      role="group"
      aria-label={t("ui.screens-records.recordextras-examples")}
      data-testid={`examples-${scenarioId}`}
    >
      <IconButton
        icon="back"
        size="small"
        label={t("ui.screens-records.recordextras-previous-example")}
        disabled={at === 0}
        onClick={() => onAt(at - 1)}
        data-testid="example-previous"
      />
      <span className="t-b-cases__at t-mono" aria-live="polite" data-testid="example-position">
        {t("ui.screens-records.recordextras-example-n-total", { n: at + 1, total: cases.length })}
      </span>
      <IconButton
        icon="forward"
        size="small"
        label={t("ui.screens-records.recordextras-next-example")}
        disabled={at === cases.length - 1}
        onClick={() => onAt(at + 1)}
        data-testid="example-next"
      />
      <IconButton
        icon="table"
        size="small"
        label={t(
          open
            ? "ui.screens-records.recordextras-hide-table-all-examples"
            : "ui.screens-records.recordextras-show-table-all-examples",
        )}
        aria-expanded={open}
        aria-controls={`examples-table-${scenarioId}`}
        onClick={() => onOpen(!open)}
        data-testid="examples-table-toggle"
      />
      {c.block ? (
        <span className="t-b-cases__block" data-testid="example-block">
          {c.block}
        </span>
      ) : null}
      {rest.map(([k, v]) => (
        <span key={k} className="t-b-cases__value" data-testid="example-value">
          <span className="t-muted">{k}</span> <span className="t-mono">{v}</span>
        </span>
      ))}
    </div>
  );
}

/** Every case of an Outline, one table per block under its name. The case the
 * steps show is marked; choosing a row shows that case. */
export function ExampleTable({
  blocks,
  at,
  onAt,
  scenarioId,
}: {
  blocks: RecordExamples[];
  at: number;
  onAt: (i: number) => void;
  scenarioId: string;
}) {
  const { t } = useText();
  // The number of the first case of each block, counted across all blocks.
  const firsts = blocks.map((_, bi) =>
    blocks.slice(0, bi).reduce((n, earlier) => n + earlier.rows.length, 0),
  );
  return (
    <div
      className="t-b-examples"
      id={`examples-table-${scenarioId}`}
      data-testid={`examples-table-${scenarioId}`}
    >
      {blocks.map((b, bi) => {
        const offset = firsts[bi];
        const name = b.name || t("ui.screens-records.recordextras-examples");
        return (
          <div key={bi} className="t-b-examples__block">
            {b.name ? <div className="t-b-examples__name">{b.name}</div> : null}
            <div className="t-table-wrap">
              <table
                className="t-table t-table--dense"
                aria-label={name}
                data-testid="examples-block"
              >
                <thead>
                  <tr>
                    <th scope="col" className="t-b-examples__n">
                      <span>#</span>
                    </th>
                    {b.columns.map((c) => (
                      <th key={c} scope="col">
                        <span className="t-mono">{c}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => {
                    const i = offset + r;
                    return (
                      <tr
                        key={r}
                        data-clickable="true"
                        aria-current={i === at || undefined}
                        className={cx(i === at && "t-b-examples__row--at")}
                        onClick={() => onAt(i)}
                      >
                        <td className="t-b-examples__n">
                          <button
                            type="button"
                            className="t-b-examples__pick"
                            aria-label={t("ui.screens-records.recordextras-show-example-n", {
                              n: i + 1,
                            })}
                            onClick={(e) => {
                              e.stopPropagation();
                              onAt(i);
                            }}
                          >
                            {i + 1}
                          </button>
                        </td>
                        {b.columns.map((c, ci) => (
                          <td key={ci} data-label={c} className="t-mono">
                            {row[ci] ?? ""}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A promise's steps. An Outline's steps carry the values of one case at a
 * time, with the stepper above them and the table of every case on demand. */
export function ScenarioSteps({
  id,
  steps,
  examples,
  render,
}: {
  id: string;
  steps: GwtStep[];
  examples?: RecordExamples[] | null;
  render?: (text: string) => ReactNode;
}) {
  const [at, setAt] = useState(0);
  const [table, setTable] = useState(false);
  if (!examples?.length) return <StepList steps={steps} render={render} />;
  const params = new Set(examples.flatMap((b) => b.columns));
  // Every case of every block; the steps show the first until the reader steps on.
  const cases = casesOf(examples);
  const here = Math.min(at, cases.length - 1);
  const shown = new Set(
    steps.flatMap((st) =>
      splitParams(st.text, params).flatMap((p) => (p.kind === "param" ? [p.name] : [])),
    ),
  );
  return (
    <>
      <ExampleStepper
        cases={cases}
        at={here}
        onAt={setAt}
        scenarioId={id}
        shown={shown}
        open={table}
        onOpen={setTable}
      />
      <StepList steps={steps} params={params} values={cases[here]?.values} render={render} />
      {table ? <ExampleTable blocks={examples} at={here} onAt={setAt} scenarioId={id} /> : null}
    </>
  );
}

/** The rules a scenario is a case of, each with what it fixes. */
export function CaseOfLines({
  cases,
  render,
  onOpen,
}: {
  cases: RecordCaseOf[];
  render: (text: string) => ReactNode;
  onOpen?: (id: string) => void;
}) {
  const { t } = useText();
  return (
    <ul className="t-b-caseof" aria-label={t("ui.screens-records.recordextras-case")}>
      {cases.map((c) => (
        <li key={c.id} data-testid={`case-of-${c.id}`}>
          <Icon name="checklist" size={12} />
          <span className="t-label">{t("ui.screens-records.recordextras-case")}</span>
          <button type="button" className="t-b-link t-mono" onClick={() => onOpen?.(c.id)}>
            {c.id}
          </button>
          {c.states ? <span className="t-b-caseof__states">{render(c.states)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** `contract.business_rules`: an empty list and a missing field are different answers. */
export function BusinessRuleList({
  rules,
  render,
  onOpenScenario,
}: {
  rules: RecordBusinessRule[] | null;
  render: (text: string) => ReactNode;
  onOpenScenario?: (id: string) => void;
}) {
  const { t } = useText();
  if (rules == null)
    return (
      <p className="t-muted" data-testid="business-rules-absent">
        <code className="t-mono">
          {t("ui.screens-records.recordextras-contract-business-rules")}
        </code>{" "}
        · {t("ui.screens-records.recordextras-not-set")}
      </p>
    );
  if (!rules.length)
    return (
      <p className="t-muted" data-testid="business-rules-empty">
        <code className="t-mono">
          {t("ui.screens-records.recordextras-contract-business-rules")}
        </code>{" "}
        · {t("ui.screens-records.recordextras-set-empty")}
      </p>
    );
  return (
    <ol className="t-b-brules">
      {rules.map((r) => (
        <li key={r.id} className="t-b-brule" id={`brule-${r.id}`} data-testid={`brule-${r.id}`}>
          <header className="t-row t-row--wrap" style={{ gap: 8 }}>
            <span className="t-mono t-b-brule__id">{r.id}</span>
            <Badge plain tone={r.kind === "table" ? "plan" : "neutral"}>
              {t(
                r.kind === "table"
                  ? "ui.screens-records.recordextras-table"
                  : "ui.screens-records.recordextras-formula",
              )}
            </Badge>
            {r.completeness ? (
              <Badge plain tone={r.completeness === "claimed" ? "ok" : "neutral"}>
                <span data-testid="brule-completeness">
                  {t(
                    r.completeness === "claimed"
                      ? "ui.screens-records.recordextras-completeness-claimed"
                      : "ui.screens-records.recordextras-completeness-not-claimed",
                  )}
                </span>
              </Badge>
            ) : null}
          </header>
          {r.states ? <p className="t-b-brule__states">{render(r.states)}</p> : null}
          {r.model ? (
            <p className="t-meta t-wrap" data-testid="brule-model">
              <Icon name="table" size={12} />{" "}
              {/\.dmn$/i.test(r.model) ? (
                <Badge plain>{t("ui.screens-records.recordextras-dmn")}</Badge>
              ) : null}{" "}
              <span className="t-mono">{r.model}</span>
              {r.element ? <span className="t-mono"> # {r.element}</span> : null}
            </p>
          ) : null}
          <div className="t-row t-row--wrap" style={{ gap: 6 }}>
            <span className="t-label">{t("ui.screens-records.recordextras-cases")}</span>
            {r.cases.length ? (
              r.cases.map((c) =>
                c.declared ? (
                  <Chip key={c.id} mono icon="shield" onClick={() => onOpenScenario?.(c.id)}>
                    {c.id}
                  </Chip>
                ) : (
                  <span
                    key={c.id}
                    className="t-mono t-meta t-b-brule__ghost"
                    data-testid="brule-case-undeclared"
                    title={t("ui.screens-records.recordextras-record-declares-no-promise-id")}
                  >
                    {c.id}
                  </span>
                ),
              )
            ) : (
              <span className="t-muted" data-testid="brule-no-case">
                {t("ui.screens-records.recordextras-no-promise-named-case")}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** `intent.decision_records`: no count where the field is not there. */
export function DecisionList({
  decisions,
  onOpen,
}: {
  decisions: RecordDecision[] | null;
  onOpen?: (target: string) => void;
}) {
  const { t } = useText();
  return (
    <div className="t-stack" style={{ gap: 6 }} data-testid="record-decisions">
      <span className="t-label">
        {t("ui.screens-records.recordextras-decisions")}{" "}
        {decisions ? (
          <span className="t-meta" data-testid="record-decisions-count">
            {decisions.length}
          </span>
        ) : null}
      </span>
      {decisions == null ? (
        <span className="t-muted" data-testid="record-decisions-absent">
          <code className="t-mono">
            {t("ui.screens-records.recordextras-intent-decision-records")}
          </code>{" "}
          · {t("ui.screens-records.recordextras-not-set")}
        </span>
      ) : !decisions.length ? (
        <span className="t-muted" data-testid="record-decisions-empty">
          {t("ui.screens-records.recordextras-record-names-no-decision")}
        </span>
      ) : (
        <ul className="t-b-decisions">
          {decisions.map((d) => (
            <li key={d.target}>
              <button type="button" className="t-b-rule" onClick={() => onOpen?.(d.target)}>
                <Icon name="scales" size={14} />
                <span className="t-mono t-wrap">{d.target}</span>
                <Icon name="chevronRight" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The lookup's content: a term, a referenced record, or what was not found. */
function LookupBody({
  target,
  render,
  onFollow,
}: {
  target: LookupTarget;
  render: (text: string) => ReactNode;
  onFollow?: (id: string) => void;
}) {
  const { t } = useText();
  const chips = (ids: string[], empty: string) =>
    ids.length ? (
      <div className="t-row t-row--wrap" style={{ gap: 6 }}>
        {ids.map((id) => (
          <Chip key={id} mono onClick={() => onFollow?.(id)}>
            {id}
          </Chip>
        ))}
      </div>
    ) : (
      <span className="t-muted" data-testid="lookup-unused">
        {empty}
      </span>
    );
  if (target.kind === "missing")
    return (
      <p className="t-muted" data-testid="lookup-missing">
        <Icon name="warning" size={14} />{" "}
        {t(
          target.what === "term"
            ? "ui.screens-records.recordextras-glossary-declares-no-such-term"
            : "ui.screens-records.recordextras-registry-declares-no-such-record",
        )}
      </p>
    );
  if (target.kind === "term")
    return (
      <>
        {target.category === "unassigned" ? (
          <span className="t-meta" data-testid="lookup-category">
            {t("ui.screens-records.recordextras-no-category-assigned-nobody")}
          </span>
        ) : target.category ? (
          <span
            className={cx("t-meta", !target.category.declared && "t-mono")}
            data-testid="lookup-category"
          >
            {target.category.label}
            {target.category.declared ? null : (
              <> · {t("ui.screens-records.recordextras-category-not-declared")}</>
            )}
          </span>
        ) : null}
        <p className="t-b-term__def">{render(target.definition)}</p>
        {target.renderings.length ? (
          <p className="t-meta" data-testid="lookup-renderings">
            {target.renderings.join(" · ")}
          </p>
        ) : null}
        <div className="t-stack" style={{ gap: 8 }}>
          <span className="t-label">
            {t("ui.screens-records.recordextras-records-using-term")}{" "}
            <span className="t-meta">{target.records.length}</span>
          </span>
          {chips(target.records, t("ui.screens-records.recordextras-no-record-uses-term"))}
        </div>
      </>
    );
  return (
    <>
      <div className="t-row t-row--wrap" style={{ gap: 6 }}>
        <Badge plain>{target.recordKind}</Badge>
        {target.lifecycle ? (
          <Badge tone={LIFECYCLE[target.lifecycle].tone}>
            {t(LIFECYCLE[target.lifecycle].label)}
          </Badge>
        ) : null}
      </div>
      {target.summary ? (
        <p className="t-b-term__def" data-testid="lookup-summary">
          {render(target.summary)}
        </p>
      ) : (
        <p className="t-muted">{t("ui.screens-records.recordextras-no-summary-record")}</p>
      )}
      <div className="t-stack" style={{ gap: 8 }}>
        <span className="t-label">
          {t("ui.screens-records.recordextras-referred")}{" "}
          <span className="t-meta">{target.referredBy.length}</span>
        </span>
        {chips(target.referredBy, t("ui.screens-records.recordextras-no-feature-refers"))}
      </div>
    </>
  );
}

export type RecordLookupProps = {
  target: LookupTarget;
  mobile?: boolean;
  render?: (text: string) => ReactNode;
  onClose?: () => void;
  /** Follow a record: the lookup closes and that record opens. */
  onFollow?: (id: string) => void;
};

/** A term or a referenced record, looked up beside the record being read: a
 * column next to the page on a wide screen, a bottom sheet on a phone. */

export function RecordLookup({ target, mobile, render, onClose, onFollow }: RecordLookupProps) {
  const { t } = useText();
  const draw = render ?? ((text: string) => text);
  const title = target.kind === "term" ? target.term : target.id;
  const follow =
    target.kind === "record" ? (
      <Button icon="document" variant="primary" onClick={() => onFollow?.(target.id)}>
        {t("ui.screens-records.recordextras-open-record")}
      </Button>
    ) : null;
  const body = (
    <div className="t-stack t-b-sheet" style={{ gap: 16 }}>
      <LookupBody target={target} render={draw} onFollow={onFollow} />
    </div>
  );
  if (mobile) return <PhoneSheet title={title} onClose={onClose} footer={follow} body={body} />;
  return (
    <aside
      className="t-b-lookup t-float t-anim-rise"
      aria-label={t("ui.screens-records.recordextras-lookup-name", { name: title })}
      data-testid="lookup"
    >
      <header className="t-b-lookup__head">
        <Icon name={target.kind === "term" ? "book" : "document"} size={14} />
        <span className={cx("t-h3 t-wrap", target.kind !== "term" && "t-mono")}>{title}</span>
        <span className="t-spacer" />
        <button
          type="button"
          className="t-btn t-btn--quiet t-btn--small t-btn--icon"
          aria-label={t("ui.screens-records.recordextras-close")}
          data-testid="lookup-close"
          onClick={onClose}
        >
          <Icon name="close" size={14} />
        </button>
      </header>
      {body}
      {follow ? <footer className="t-b-lookup__foot">{follow}</footer> : null}
    </aside>
  );
}

/** The lookup on a phone: a bottom sheet rendered into the themed shell, not
 * in place — the record page is animated, and a fixed sheet inside a
 * transformed ancestor would sit under the tab bar instead of over it. */

function PhoneSheet({
  title,
  onClose,
  footer,
  body,
}: {
  title: string;
  onClose?: () => void;
  footer: ReactNode;
  body: ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  useLayoutEffect(() => {
    setHost(anchor.current?.closest("[data-t-theme], .t-app") ?? document.body);
  }, []);
  const sheet = (
    <Sheet open side="bottom" title={title} onClose={onClose} footer={footer ?? undefined}>
      <div data-testid="lookup">{body}</div>
    </Sheet>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {host ? createPortal(sheet, host) : null}
    </>
  );
}
