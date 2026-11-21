/** Side sheets the record opens without leaving it: an anchor, a rule, a
 * configuration key, a glossary term. On a phone each is a bottom sheet. */

import type { ReactNode } from "react";
import { Badge, Button, Chip, Sheet, Icon } from "@facet-tools/ui";

import { useText } from "../text";
import { dateText, roleLabel } from "./model";
import { CodeView, cx } from "./parts";

const SEVERITY_NAME: Record<string, string> = {
  error: "ui.screens-records.recordsheets-error",
  warning: "ui.screens-records.recordsheets-warning",
};

const STATUS_NAME: Record<string, string> = {
  proposed: "ui.screens-records.recordsheets-proposed",
  settled: "ui.screens-records.recordsheets-settled",
};

type Base = {
  open: boolean;
  mobile?: boolean;
  onClose?: () => void;
  onOpenRecord?: (id: string) => void;
};

type KeyValue = { k: string; v: ReactNode };

function KeyValues({ rows }: { rows: KeyValue[] }) {
  return (
    <dl className="t-b-kv">
      {rows.map(({ k, v }) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function RecordChips({ ids, onOpen }: { ids: string[]; onOpen?: (id: string) => void }) {
  return (
    <div className="t-row t-row--wrap" style={{ gap: 6 }}>
      {ids.map((id) => (
        <Chip key={id} mono onClick={() => onOpen?.(id)}>
          {id}
        </Chip>
      ))}
    </div>
  );
}

/** Anchor -------------------------------------------------------------------- */

export type AnchorSheetProps = Base & {
  recordId: string;
  path: string;
  line: number;
  anchorRole: string;
  excerpt: { firstLine: number; text: string; lang: "go" | "text" | "yaml" };
  /** Every anchor in the same file, this one included. */
  fileAnchors: { line: number; role: string; recordId: string }[];
  lastCommit?: { date: string; sha: string; subject: string };
  drifted?: boolean;
  onOpenFile?: () => void;
  onCopy?: () => void;
};

export function AnchorSheet(p: AnchorSheetProps) {
  const { t, plural } = useText();
  const others = [
    ...new Set(p.fileAnchors.map((a) => a.recordId).filter((id) => id !== p.recordId)),
  ];
  return (
    <Sheet
      open={p.open}
      side={p.mobile ? "bottom" : "right"}
      width={620}
      title={`${p.path.split("/").pop()}:${p.line}`}
      meta={p.path}
      onClose={p.onClose}
      footer={
        <>
          <Button icon="copy" variant="quiet" onClick={p.onCopy}>
            {t("ui.screens-records.recordsheets-copy-path")}
          </Button>
          <Button icon="external" variant="primary" onClick={p.onOpenFile}>
            {t("ui.screens-records.recordsheets-open-editor")}
          </Button>
        </>
      }
    >
      <div className="t-stack t-b-sheet" style={{ gap: 18 }} data-testid="anchor-sheet">
        <div className="t-row t-row--wrap" style={{ gap: 6 }}>
          <Badge
            tone={
              p.anchorRole === "primary" ? "signal" : p.anchorRole === "config" ? "plan" : "neutral"
            }
          >
            {roleLabel(p.anchorRole, t)}
          </Badge>
          {p.drifted ? (
            <Badge tone="warn">{t("ui.screens-records.recordsheets-drift")}</Badge>
          ) : (
            <Badge tone="ok">{t("ui.screens-records.recordsheets-sync")}</Badge>
          )}
          <span className="t-meta">
            {t("ui.screens-records.recordsheets-carries-id", { id: p.recordId })}
          </span>
        </div>
        <CodeView
          label={t("ui.screens-records.recordsheets-source-anchor")}
          lang={p.excerpt.lang}
          firstLine={p.excerpt.firstLine}
          text={p.excerpt.text}
          mark={[p.line]}
        />
        <div className="t-stack" style={{ gap: 8 }}>
          <span className="t-label">
            {t("ui.screens-records.recordsheets-anchors-file")}{" "}
            <span className="t-meta">{p.fileAnchors.length}</span>
          </span>
          <ul className="t-b-fileanchors">
            {p.fileAnchors.map((a) => (
              <li
                key={`${a.line}-${a.recordId}`}
                className={cx(
                  a.line === p.line && a.recordId === p.recordId && "t-b-fileanchors--current",
                )}
              >
                <span className="t-mono t-meta">:{a.line}</span>
                <button
                  type="button"
                  className="t-b-link t-mono t-wrap"
                  onClick={() => p.onOpenRecord?.(a.recordId)}
                >
                  {a.recordId}
                </button>
                <span className="t-meta">{roleLabel(a.role, t)}</span>
              </li>
            ))}
          </ul>
          {others.length ? (
            <span className="t-meta">
              {plural(
                "ui.screens-records.recordsheets-file-carries-count-more-records",
                others.length,
              )}
            </span>
          ) : null}
        </div>
        {p.lastCommit ? (
          <KeyValues
            rows={[
              {
                k: t("ui.screens-records.recordsheets-last-changed"),
                v: dateText(p.lastCommit.date, t),
              },
              { k: "Commit", v: <span className="t-mono">{p.lastCommit.sha}</span> },
              { k: t("ui.screens-records.recordsheets-message"), v: p.lastCommit.subject },
            ]}
          />
        ) : null}
      </div>
    </Sheet>
  );
}

/** Rule ---------------------------------------------------------------------- */

export type RuleSheetProps = Base & {
  id: string;
  title: string;
  states: string;
  severity: "error" | "warning";
  checkedBy: string;
  appliesTo: { id: string; holds: boolean }[];
  since?: string;
};

export function RuleSheet(p: RuleSheetProps) {
  const { t, plural } = useText();
  const broken = p.appliesTo.filter((a) => !a.holds);
  return (
    <Sheet
      open={p.open}
      side={p.mobile ? "bottom" : "right"}
      title={p.title}
      meta={p.id}
      onClose={p.onClose}
    >
      <div className="t-stack t-b-sheet" style={{ gap: 18 }} data-testid="rule-sheet">
        <blockquote className="t-b-quote">{p.states}</blockquote>
        <KeyValues
          rows={[
            {
              k: t("ui.screens-records.recordsheets-severity"),
              v: (
                <Badge tone={p.severity === "error" ? "bad" : "warn"}>
                  {t(SEVERITY_NAME[p.severity])}
                </Badge>
              ),
            },
            {
              k: t("ui.screens-records.recordsheets-checked"),
              v: <span className="t-mono">{p.checkedBy}</span>,
            },
            {
              k: t("ui.screens-records.recordsheets-force-since"),
              v: dateText(p.since ?? null, t),
            },
            {
              k: t("ui.screens-records.recordsheets-applies"),
              v: plural("ui.screens-records.recordsheets-count-records", p.appliesTo.length),
            },
          ]}
        />
        {broken.length ? (
          <div className="t-stack" style={{ gap: 8 }}>
            <span className="t-label t-bad">
              {t("ui.screens-records.recordsheets-violated")}{" "}
              <span className="t-meta">{broken.length}</span>
            </span>
            <RecordChips ids={broken.map((b) => b.id)} onOpen={p.onOpenRecord} />
          </div>
        ) : (
          <p className="t-b-calm">
            <Icon name="check" size={14} className="t-ok" />{" "}
            {t("ui.screens-records.recordsheets-every-affected-record-holds-rule")}
          </p>
        )}
        <div className="t-stack" style={{ gap: 8 }}>
          <span className="t-label">
            {t("ui.screens-records.recordsheets-affected-records")}{" "}
            <span className="t-meta">{p.appliesTo.length}</span>
          </span>
          <RecordChips
            ids={p.appliesTo.filter((a) => a.holds).map((a) => a.id)}
            onOpen={p.onOpenRecord}
          />
        </div>
      </div>
    </Sheet>
  );
}

/** Configuration ------------------------------------------------------------- */

export type ConfigSheetProps = Base & {
  configKey: string;
  file: string;
  /** Line in the file; `null` when the key is not set there. */
  line: number | null;
  value: string | null;
  defaultValue: string;
  allowed: string[];
  description: string;
  env?: { name: string; effect: string };
  readBy: { path: string; line: number }[];
  records: string[];
  snippet?: { firstLine: number; text: string };
  onCopy?: () => void;
};

export function ConfigSheet(p: ConfigSheetProps) {
  const { t } = useText();
  const set = p.value != null;
  const invalid = set && p.allowed.length > 0 && !p.allowed.includes(p.value!);
  const entryLabel = t(
    set
      ? "ui.screens-records.recordsheets-entry-file"
      : "ui.screens-records.recordsheets-entry-insert",
  );
  return (
    <Sheet
      open={p.open}
      side={p.mobile ? "bottom" : "right"}
      title={p.configKey}
      meta={p.file}
      onClose={p.onClose}
      footer={
        <Button icon="copy" onClick={p.onCopy}>
          {t("ui.screens-records.recordsheets-copy-entry")}
        </Button>
      }
    >
      <div className="t-stack t-b-sheet" style={{ gap: 18 }} data-testid="config-sheet">
        <div className="t-b-config__value">
          <span className="t-label">{t("ui.screens-records.recordsheets-effective-value")}</span>
          <span className={cx("t-b-config__big t-mono", invalid && "t-bad")}>
            {set ? p.value : p.defaultValue}
          </span>
          {invalid ? (
            <Badge tone="bad">
              {t("ui.screens-records.recordsheets-invalid-allowed-values", {
                values: p.allowed.join(", "),
              })}
            </Badge>
          ) : set ? (
            <Badge tone="signal">
              {t("ui.screens-records.recordsheets-set-line-line", { line: String(p.line) })}
            </Badge>
          ) : (
            <Badge plain>{t("ui.screens-records.recordsheets-default-not-set")}</Badge>
          )}
        </div>
        <p className="t-b-config__desc">{p.description}</p>
        <KeyValues
          rows={[
            {
              k: t("ui.screens-records.recordsheets-file"),
              v: <span className="t-mono">{p.file}</span>,
            },
            {
              k: t("ui.screens-records.recordsheets-default"),
              v: <span className="t-mono">{p.defaultValue}</span>,
            },
            {
              k: t("ui.screens-records.recordsheets-allowed"),
              v: p.allowed.length ? (
                <span className="t-mono">{p.allowed.join(" · ")}</span>
              ) : (
                t("ui.screens-records.recordsheets-any-path-repository")
              ),
            },
            ...(p.env
              ? ([
                  {
                    k: t("ui.screens-records.recordsheets-environment"),
                    v: (
                      <span>
                        <span className="t-mono">{p.env.name}</span> — {p.env.effect}
                      </span>
                    ),
                  },
                ] as KeyValue[])
              : []),
          ]}
        />
        {p.snippet ? (
          <div className="t-stack" style={{ gap: 8 }}>
            <span className="t-label">{entryLabel}</span>
            <CodeView
              label={entryLabel}
              lang="yaml"
              firstLine={p.snippet.firstLine}
              text={p.snippet.text}
              mark={p.line ? [p.line] : undefined}
            />
          </div>
        ) : null}
        <div className="t-stack" style={{ gap: 8 }}>
          <span className="t-label">
            {t("ui.screens-records.recordsheets-read")}{" "}
            <span className="t-meta">{p.readBy.length}</span>
          </span>
          <ul className="t-b-fileanchors">
            {p.readBy.map((r) => (
              <li key={`${r.path}:${r.line}`}>
                <Icon name="code" size={12} />
                <span className="t-mono t-wrap">
                  {r.path}:{r.line}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="t-stack" style={{ gap: 8 }}>
          <span className="t-label">{t("ui.screens-records.recordsheets-records")}</span>
          <RecordChips ids={p.records} onOpen={p.onOpenRecord} />
        </div>
      </div>
    </Sheet>
  );
}

/** Term ---------------------------------------------------------------------- */

export type TermSheetProps = Base & {
  term: string;
  definition: string;
  category: string;
  status: "settled" | "proposed";
  aliases: string[];
  /** English counterpart from the glossary, when there is one. */
  translation?: string;
  recordCount: number;
  records: string[];
  related: string[];
  onTerm?: (term: string) => void;
  onPropose?: () => void;
};

export function TermSheet(p: TermSheetProps) {
  const { t, plural } = useText();
  return (
    <Sheet
      open={p.open}
      side={p.mobile ? "bottom" : "right"}
      title={p.term}
      meta={t("ui.screens-records.recordsheets-category-glossary", { category: p.category })}
      onClose={p.onClose}
      footer={
        <Button icon="edit" onClick={p.onPropose}>
          {t("ui.screens-records.recordsheets-propose-change")}
        </Button>
      }
    >
      <div className="t-stack t-b-sheet" style={{ gap: 18 }} data-testid="term-sheet">
        <div className="t-row t-row--wrap" style={{ gap: 6 }}>
          <Badge tone={p.status === "settled" ? "ok" : "plan"}>{t(STATUS_NAME[p.status])}</Badge>
          {p.translation ? (
            <Badge plain>
              {t("ui.screens-records.recordsheets-en")} {p.translation}
            </Badge>
          ) : null}
        </div>
        <p className="t-b-term__def">{p.definition}</p>
        <KeyValues
          rows={[
            {
              k: t("ui.screens-records.recordsheets-also"),
              v: p.aliases.length ? (
                p.aliases.join(", ")
              ) : (
                <span className="t-muted">{t("ui.screens-records.recordsheets-no-synonyms")}</span>
              ),
            },
            {
              k: t("ui.screens-records.recordsheets-occurrences"),
              v: plural("ui.screens-records.recordsheets-count-records", p.recordCount),
            },
          ]}
        />
        {p.related.length ? (
          <div className="t-stack" style={{ gap: 8 }}>
            <span className="t-label">{t("ui.screens-records.recordsheets-related-terms")}</span>
            <div className="t-row t-row--wrap" style={{ gap: 6 }}>
              {p.related.map((term) => (
                <Chip key={term} icon="book" onClick={() => p.onTerm?.(term)}>
                  {term}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
        <div className="t-stack" style={{ gap: 8 }}>
          <span className="t-label">
            {t("ui.screens-records.recordsheets-records-using-term")}{" "}
            <span className="t-meta">
              {t("ui.screens-records.recordsheets-shown-total", {
                shown: p.records.length,
                total: p.recordCount,
              })}
            </span>
          </span>
          <RecordChips ids={p.records} onOpen={p.onOpenRecord} />
        </div>
      </div>
    </Sheet>
  );
}
