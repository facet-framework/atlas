import {
  Button,
  Chip,
  Field,
  SearchField,
  EmptyState,
  Finding,
  Skeleton,
  Pagination,
  Breadcrumbs,
  Toast,
  Icon,
} from "@facet-tools/ui";

import { useText, type FacetText } from "../text";
import { InlineMd, KeyValues, PathRef, RecordRef } from "./frame";
import type { ReactNode } from "react";
import type {
  GlossaryGroup,
  GlossaryTerm,
  GlossaryTermDetail,
  TermProposal,
  TermProposalErrors,
} from "./model";

export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export type ProposalState = {
  values: TermProposal;
  errors: TermProposalErrors;
  status: "idle" | "sending" | "sent" | "failed";
  /** Branch and pull request once sent. */
  result?: { branch: string; pr: string };
  failure?: string;
};

export type GlossaryPageProps = {
  /** `undeclared`: the project declares no glossary — nothing to count, not zero terms. */
  state: "ready" | "empty" | "undeclared" | "loading";
  mode?: "list" | "term" | "propose";
  terms: GlossaryTerm[];
  letters: { letter: string; count: number }[];
  letter?: string | null;
  query: string;
  page: number;
  pageSize: number;
  total: number;
  categories: string[];
  category?: string | null;
  detail?: GlossaryTermDetail | null;
  proposal?: ProposalState | null;
  mobile?: boolean;
  onLetter?: (l: string | null) => void;
  onQuery?: (q: string) => void;
  onCategory?: (c: string | null) => void;
  onPage?: (p: number) => void;
  onOpen?: (term: string) => void;
  onClose?: () => void;
  onPropose?: () => void;
  /** Why a term cannot be proposed right now; the propose buttons then show it, disabled. */
  proposeDisabledReason?: string;
  onProposalChange?: (patch: Partial<TermProposal>) => void;
  onSubmit?: () => void;
  onOpenRecord?: (id: string) => void;
  /** The categories as the host computed them, in its order. Given, the list is
   * drawn under these headings instead of A–Z; `null` or absent keeps A–Z. */

  groups?: GlossaryGroup[] | null;
  /** Ids of collapsed categories; a filter opens every category holding a hit. */
  collapsed?: readonly string[];
  onToggleGroup?: (id: string) => void;
  /** Renders a term's definition in its detail, e.g. with links to other terms. */
  renderProse?: (text: string) => ReactNode;
};

/** Glossary: terms explained once, A–Z, with detail and a proposal form. */
export function GlossaryPage(p: GlossaryPageProps) {
  const { t, number } = useText();
  const mode = p.mode ?? "list";
  const fixed = p.terms.filter((term) => term.status === "settled").length;
  // Somebody filtering wants the hit, not the heading it is behind.
  const filtering = Boolean(p.query.trim() || p.letter || p.category);
  const groups = ALPHABET.map((l) => ({
    l,
    list: p.terms.filter((term) => term.term[0]?.toUpperCase() === l),
  })).filter((g) => g.list.length);
  const side =
    mode === "term" && p.detail ? (
      <TermDetail
        detail={p.detail}
        renderProse={p.renderProse}
        onClose={p.onClose}
        onOpen={p.onOpen}
        onOpenRecord={p.onOpenRecord}
      />
    ) : mode === "propose" && p.proposal ? (
      <ProposalForm
        proposal={p.proposal}
        categories={p.categories}
        onChange={p.onProposalChange}
        onSubmit={p.onSubmit}
        onCancel={p.onClose}
      />
    ) : null;

  if (p.mobile && side) {
    return (
      <div className="t-page t-c-gloss" data-testid="glossary-page">
        <Breadcrumbs
          crumbs={[
            {
              key: "g",
              label: `‹ ${t("ui.screens-contents.glossary-glossary")}`,
              onClick: p.onClose,
            },
            {
              key: "t",
              label:
                mode === "term" ? p.detail?.term : t("ui.screens-contents.glossary-propose-term"),
            },
          ]}
        />
        <div className="t-anim-rise">{side}</div>
      </div>
    );
  }

  return (
    <div className="t-page t-c-gloss" data-testid="glossary-page">
      {p.state === "ready" || p.state === "loading" ? (
        <Finding
          eyebrow={t("ui.screens-contents.glossary-glossary")}
          figure={p.state === "ready" ? number(p.total) : "—"}
          sentence={
            p.state === "loading"
              ? t("ui.screens-contents.glossary-reading-terms")
              : t("ui.screens-contents.glossary-count-domain-terms-explained-once", {
                  count: p.total,
                })
          }
          lead={
            p.state === "ready"
              ? `${p.total > p.terms.length ? `${t("ui.screens-contents.glossary-count-page", { count: p.terms.length })} · ` : ""}${t("ui.screens-contents.glossary-count-proposed-awaiting-agreement", { count: p.terms.length - fixed })}`
              : undefined
          }
          aside={
            p.onPropose ? (
              <Button
                variant="primary"
                icon="plus"
                onClick={p.onPropose}
                disabledReason={p.proposeDisabledReason}
              >
                {t("ui.screens-contents.glossary-propose-term")}
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {p.state === "empty" || p.state === "undeclared" ? (
        <EmptyState
          icon="book"
          title={t(
            p.state === "undeclared"
              ? "ui.screens-contents.glossary-no-glossary-declared"
              : "ui.screens-contents.glossary-no-term-yet",
          )}
          action={
            p.onPropose ? (
              <Button
                variant="primary"
                icon="plus"
                onClick={p.onPropose}
                disabledReason={p.proposeDisabledReason}
              >
                {t("ui.screens-contents.glossary-propose-first-term")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="t-c-gloss__bar">
            <div className="t-c-gloss__search">
              <SearchField
                label={t("ui.screens-contents.glossary-search-glossary")}
                value={p.query}
                placeholder={t("ui.screens-contents.glossary-term-synonym-definition")}
                onChange={p.onQuery}
              />
            </div>
            <div className="t-row t-row--wrap" style={{ gap: 6 }}>
              <Chip pressed={!p.category} onClick={() => p.onCategory?.(null)}>
                {t("ui.screens-contents.glossary-all")}
              </Chip>
              {p.categories.map((c) => (
                <Chip key={c} pressed={p.category === c} onClick={() => p.onCategory?.(c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </div>
          <nav className="t-c-az" aria-label={t("ui.screens-contents.glossary-letters")}>
            {ALPHABET.map((l) => {
              const n = p.letters.find((x) => x.letter === l)?.count ?? 0;
              return (
                <button
                  key={l}
                  type="button"
                  className="t-c-az__l"
                  disabled={!n}
                  aria-pressed={p.letter === l}
                  aria-label={t("ui.screens-contents.glossary-letter-count-terms", {
                    letter: l,
                    count: n,
                  })}
                  onClick={() => p.onLetter?.(p.letter === l ? null : l)}
                >
                  {l}
                </button>
              );
            })}
          </nav>
          <div className={side ? "t-c-kind__body t-c-kind__body--aside" : "t-c-kind__body"}>
            <div className="t-stack" style={{ gap: 20 }}>
              {p.state === "loading"
                ? Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="t-stack" style={{ gap: 6 }}>
                      <Skeleton width={`${20 + ((i * 13) % 20)}%`} height={16} />
                      <Skeleton width={`${50 + ((i * 17) % 40)}%`} height={12} />
                    </div>
                  ))
                : p.groups
                  ? p.groups
                      .filter((g) => !filtering || g.terms.length)
                      .map((g) => (
                        <CategorySection
                          key={g.id || "\u0000none"}
                          group={g}
                          open={filtering || !p.collapsed?.includes(g.id)}
                          onToggle={filtering ? undefined : p.onToggleGroup}
                          current={p.detail?.term}
                          onOpen={p.onOpen}
                        />
                      ))
                  : groups.map((g) => (
                      <section
                        key={g.l}
                        aria-label={t("ui.screens-contents.glossary-letter-letter", {
                          letter: g.l,
                        })}
                        className="t-c-gloss__group"
                      >
                        <h2 className="t-c-gloss__letter">{g.l}</h2>
                        <ul className="t-c-plain">
                          {g.list.map((term) => (
                            <TermRow
                              key={term.term}
                              term={term}
                              current={p.detail?.term === term.term}
                              onOpen={p.onOpen}
                            />
                          ))}
                        </ul>
                      </section>
                    ))}
              {p.state === "ready" ? (
                <Pagination
                  page={p.page}
                  pageSize={p.pageSize}
                  total={p.total}
                  onPage={p.onPage}
                  compact={p.mobile}
                />
              ) : null}
            </div>
            {side ? (
              <aside className="t-c-kind__aside t-raised t-pad t-c-aside">{side}</aside>
            ) : null}
          </div>
        </>
      )}
      {p.proposal?.status === "sent" && p.proposal.result ? (
        <div className="t-c-toastwrap">
          <Toast
            tone="ok"
            action={
              <Button size="small" variant="quiet" icon="external">
                {t("ui.screens-contents.glossary-open")}
              </Button>
            }
          >
            {t("ui.screens-contents.glossary-proposed-pr", { pr: p.proposal.result.pr })}{" "}
            <span className="t-mono">{p.proposal.result.branch}</span>
          </Toast>
        </div>
      ) : null}
    </div>
  );
}

/** One term in the list: name, definition, category and how many records use it. */
function TermRow({
  term,
  current,
  onOpen,
}: {
  term: GlossaryTerm;
  current: boolean;
  onOpen?: (t: string) => void;
}) {
  const { t, plural } = useText();
  return (
    <li>
      <button
        type="button"
        className="t-c-term"
        aria-current={current || undefined}
        onClick={() => onOpen?.(term.term)}
      >
        <span className="t-c-term__name">
          {term.term}
          {term.status === "proposed" ? (
            <span className="t-badge t-badge--plan">
              {t("ui.screens-contents.glossary-proposed")}
            </span>
          ) : null}
        </span>
        <span className="t-c-term__def t-clamp-2">
          <InlineMd text={term.definition} />
        </span>
        <span className="t-c-term__meta t-meta">
          {term.category ? `${term.category} · ` : ""}
          {term.aliases.length
            ? `${t("ui.screens-contents.glossary-also-aliases", { aliases: term.aliases.join(", ") })} · `
            : ""}
          {plural("ui.screens-contents.glossary-count-records", term.records)}
        </span>
      </button>
    </li>
  );
}

/** One category of a grouped glossary. A declared category names its title; one
 * a term names without a declaration shows its id as an error; the terms that
 * name none stand under their own heading, never under an invented name. */

function CategorySection({
  group: g,
  open,
  onToggle,
  current,
  onOpen,
}: {
  group: GlossaryGroup;
  open: boolean;
  onToggle?: (id: string) => void;
  current?: string;
  onOpen?: (t: string) => void;
}) {
  const { t, number } = useText();
  const name =
    g.state === "none"
      ? t("ui.screens-contents.glossary-no-category-assigned-nobody")
      : g.state === "undeclared"
        ? g.id
        : (g.title ?? g.id);
  const title = (
    <>
      <span
        className={g.state === "undeclared" ? "t-mono t-bad" : undefined}
        data-testid="glossary-category-name"
      >
        {name}
      </span>
      <span className="t-meta" data-testid="glossary-category-count">
        {number(g.total)}
      </span>
    </>
  );
  const body = `glossary-category-${g.id || "none"}`;
  return (
    <section
      className={g.state === "none" ? "t-c-gloss__cat t-c-gloss__cat--none" : "t-c-gloss__cat"}
      aria-label={name}
      data-testid="glossary-category"
      data-state={g.state}
    >
      <h2 className="t-c-gloss__cathead">
        {onToggle && g.terms.length ? (
          <button
            type="button"
            className="t-c-gloss__toggle"
            aria-expanded={open}
            aria-controls={body}
            aria-label={t(
              open
                ? "ui.screens-contents.glossary-collapse-group"
                : "ui.screens-contents.glossary-expand-group",
              { group: name },
            )}
            onClick={() => onToggle(g.id)}
          >
            <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
            {title}
          </button>
        ) : (
          title
        )}
      </h2>
      {g.state === "undeclared" ? (
        <p className="t-c-small t-bad" data-testid="glossary-category-undeclared">
          {t("ui.screens-contents.glossary-category-not-declared")}
        </p>
      ) : g.state === "empty" ? (
        <p className="t-c-small t-muted" data-testid="glossary-category-empty">
          {t("ui.screens-contents.glossary-declared-no-term-names")}
        </p>
      ) : g.purpose ? (
        <p className="t-c-small t-ink2">{g.purpose}</p>
      ) : null}
      {open && g.terms.length ? (
        <ul className="t-c-plain" id={body}>
          {g.terms.map((term) => (
            <TermRow key={term.term} term={term} current={current === term.term} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function TermDetail({
  detail: d,
  renderProse,
  onClose,
  onOpen,
  onOpenRecord,
}: {
  detail: GlossaryTermDetail;
  renderProse?: (text: string) => ReactNode;
  onClose?: () => void;
  onOpen?: (t: string) => void;
  onOpenRecord?: (id: string) => void;
}) {
  const { t, number } = useText();
  return (
    <article className="t-stack t-c-termdetail" data-testid="term-detail" aria-label={d.term}>
      <header className="t-row">
        {d.categoryState === "undeclared" ? (
          <span className="t-eyebrow" data-testid="term-category" data-state="undeclared">
            <span className="t-mono t-bad">{d.category}</span> ·{" "}
            {t("ui.screens-contents.glossary-category-not-declared")}
          </span>
        ) : d.categoryState === "unassigned" ? (
          <span className="t-eyebrow" data-testid="term-category" data-state="unassigned">
            {t("ui.screens-contents.glossary-no-category-assigned-nobody")}
          </span>
        ) : d.category ? (
          <span className="t-eyebrow" data-testid="term-category" data-state="declared">
            {d.category}
          </span>
        ) : null}
        <span className="t-spacer" />
        <Button size="small" variant="quiet" icon="edit">
          {t("ui.screens-contents.glossary-propose-change")}
        </Button>
        <Button
          size="small"
          variant="quiet"
          icon="close"
          aria-label={t("ui.screens-contents.glossary-close")}
          onClick={onClose}
        />
      </header>
      <h2 className="t-h1">{d.term}</h2>
      <p className="t-lead" data-testid="term-definition">
        {renderProse ? renderProse(d.definition) : <InlineMd text={d.definition} />}
      </p>
      <KeyValues
        items={[
          [
            "Status",
            d.status === "settled" ? (
              <span className="t-ok" key="s">
                {t("ui.screens-contents.glossary-settled")}
              </span>
            ) : (
              <span className="t-plan" key="s">
                {t("ui.screens-contents.glossary-proposed")}
              </span>
            ),
          ],
          [
            t("ui.screens-contents.glossary-synonyms"),
            d.aliases.length ? d.aliases.join(", ") : "—",
          ],
          [t("ui.screens-contents.glossary-english"), d.translation ?? "—"],
          ["Records", number(d.records)],
        ]}
      />
      {d.related.length ? (
        <div className="t-stack" style={{ gap: 6 }}>
          <span className="t-label">{t("ui.screens-contents.glossary-related")}</span>
          <div className="t-row t-row--wrap" style={{ gap: 4 }}>
            {d.related.map((r) => (
              <Chip key={r} icon="book" onClick={() => onOpen?.(r)}>
                {r}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
      <div className="t-stack" style={{ gap: 6 }}>
        <span className="t-label">{t("ui.screens-contents.glossary-records-use-term")}</span>
        {d.recordIds.length ? (
          <ul className="t-c-plain t-stack" style={{ gap: 2 }}>
            {d.recordIds.map((id) => (
              <li key={id}>
                <RecordRef id={id} onOpen={onOpenRecord} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-c-small t-muted" data-testid="term-unused">
            {t("ui.screens-contents.glossary-no-record-uses-term")}
          </p>
        )}
      </div>
      <div className="t-stack" style={{ gap: 6 }}>
        <span className="t-label">{t("ui.screens-contents.glossary-occurrences-text")}</span>
        <ul className="t-c-plain t-stack" style={{ gap: 8 }}>
          {d.occurrences.map((o) => (
            <li key={`${o.path}:${o.line}`} className="t-sunken t-c-occ">
              <PathRef path={o.path} line={o.line} />
              <span className="t-c-small t-ink2">
                {t("ui.screens-contents.glossary-text", { text: o.excerpt })}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="t-stack" style={{ gap: 6 }}>
        <span className="t-label">{t("ui.screens-contents.glossary-history")}</span>
        <ol className="t-c-plain t-c-hist">
          {d.history.map((h) => (
            <li key={h.date + h.change} className="t-row t-c-small">
              <span className="t-meta">{h.date}</span>
              <span>{h.who}</span>
              <span className="t-muted t-ellipsis">{h.change}</span>
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}

function ProposalForm({
  proposal,
  categories,
  onChange,
  onSubmit,
  onCancel,
}: {
  proposal: ProposalState;
  categories: string[];
  onChange?: (patch: Partial<TermProposal>) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
}) {
  const { t } = useText();
  const { values: v, errors: e, status } = proposal;
  const sending = status === "sending";
  return (
    <form
      className="t-stack t-c-form"
      aria-label={t("ui.screens-contents.glossary-propose-term")}
      data-testid="term-proposal"
      onSubmit={(ev) => {
        ev.preventDefault();
        onSubmit?.();
      }}
    >
      <header className="t-row">
        <span className="t-h2">{t("ui.screens-contents.glossary-propose-term")}</span>
        <span className="t-spacer" />
        <Button
          size="small"
          variant="quiet"
          icon="close"
          aria-label={t("ui.screens-contents.glossary-cancel")}
          onClick={onCancel}
        />
      </header>
      <Field
        label={t("ui.screens-contents.glossary-term")}
        error={e.term}
        hint={t("ui.screens-contents.glossary-singular-appears-text")}
      >
        {(id) => (
          <input
            id={id}
            className="t-input"
            value={v.term}
            aria-invalid={!!e.term || undefined}
            disabled={sending}
            onChange={(ev) => onChange?.({ term: ev.target.value })}
          />
        )}
      </Field>
      <Field
        label="Definition"
        error={e.definition}
        hint={t("ui.screens-contents.glossary-count-max-characters-least-min", {
          count: v.definition.length,
          max: 280,
          min: 20,
        })}
      >
        {(id) => (
          <textarea
            id={id}
            className="t-textarea"
            rows={4}
            value={v.definition}
            aria-invalid={!!e.definition || undefined}
            disabled={sending}
            onChange={(ev) => onChange?.({ definition: ev.target.value })}
          />
        )}
      </Field>
      <div className="t-c-form__two">
        <Field label={t("ui.screens-contents.glossary-category")} error={e.category}>
          {(id) => (
            <select
              id={id}
              className="t-select"
              value={v.category}
              disabled={sending}
              onChange={(ev) => onChange?.({ category: ev.target.value })}
            >
              <option value="">{t("ui.screens-contents.glossary-choose")}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={t("ui.screens-contents.glossary-synonyms")}
          hint={t("ui.screens-contents.glossary-separated-commas")}
        >
          {(id) => (
            <input
              id={id}
              className="t-input"
              value={v.aliases}
              disabled={sending}
              onChange={(ev) => onChange?.({ aliases: ev.target.value })}
            />
          )}
        </Field>
      </div>
      <div className="t-stack" style={{ gap: 6 }}>
        <span className="t-field__label">{t("ui.screens-contents.glossary-records-use")}</span>
        <div className="t-row t-row--wrap" style={{ gap: 4 }}>
          {v.records.map((r) => (
            <Chip
              key={r}
              mono
              onRemove={() => onChange?.({ records: v.records.filter((x) => x !== r) })}
            >
              {r.split("/").pop()}
            </Chip>
          ))}
          {v.records.length === 0 ? (
            <span className="t-meta">{t("ui.screens-contents.glossary-none")}</span>
          ) : null}
        </div>
        {e.records ? <span className="t-field__error">{e.records}</span> : null}
      </div>
      {status === "failed" ? (
        <div className="t-c-alert" role="alert">
          <Icon name="error" size={16} />
          <span>
            {proposal.failure ?? t("ui.screens-contents.glossary-proposal-could-not-created")}
          </span>
        </div>
      ) : null}
      <footer className="t-row t-c-form__foot">
        <span className="t-meta">
          {t("ui.screens-contents.glossary-becomes-branch-pull-request")}
        </span>
        <span className="t-spacer" />
        <Button variant="quiet" onClick={onCancel} disabled={sending}>
          {t("ui.screens-contents.glossary-cancel")}
        </Button>
        <Button
          variant="primary"
          type="submit"
          icon={sending ? "refresh" : "pr"}
          disabled={sending}
        >
          {sending
            ? t("ui.screens-contents.glossary-proposing")
            : status === "failed"
              ? t("ui.screens-contents.glossary-propose-again")
              : t("ui.screens-contents.glossary-propose")}
        </Button>
      </footer>
    </form>
  );
}

/** Validation of a term proposal, shared by stories and app. The messages come
 * in the language of `t` (from `useText()`). */

export function validateProposal(
  v: TermProposal,
  existing: string[],
  t: FacetText["t"],
): TermProposalErrors {
  const e: TermProposalErrors = {};
  const term = v.term.trim();
  if (!term) e.term = t("ui.screens-contents.glossary-term-missing");
  else if (existing.some((x) => x.toLowerCase() === term.toLowerCase()))
    e.term = t("ui.screens-contents.glossary-term-already-glossary", { term });
  if (v.definition.trim().length < 20)
    e.definition = t("ui.screens-contents.glossary-definition-needs-least-min-characters", {
      min: 20,
    });
  else if (v.definition.length > 280)
    e.definition = t("ui.screens-contents.glossary-most-max-characters", { max: 280 });
  if (!v.category) e.category = t("ui.screens-contents.glossary-choose-category");
  return e;
}
