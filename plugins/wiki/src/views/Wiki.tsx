import { useState, type ReactNode } from "react";
import {
  Icon,
  Badge,
  Button,
  Chip,
  Dot,
  Field,
  IconButton,
  SearchField,
  Segment,
  Switch,
  type Tone,
  EmptyState,
  Distribution,
  Section,
  DataTable,
  Pagination,
  sortRows,
  type SortDir,
  type SortValue,
  Breadcrumbs,
  Sheet,
} from "@facet-tools/ui";
import {
  Bars,
  Diff,
  Facts,
  Markdown,
  PluginHead,
  Steps,
  noop,
  useLifecycleLabel,
  type DiffLine,
} from "../../../../frontend/src/plugin/components";
import type { TextKey } from "../../../../frontend/src/plugin/components";
import { useText } from "../../../../frontend/src/plugin/components";

/* Shared vocabulary ----------------------------------------------------------- */

/**
 * Page state from the front matter. `unknown` is a value outside the known
 * three; the page then carries the raw value (`rawStatus`) and shows it, so a
 * typo in the front matter is visible instead of being read as a draft.
 */
export type WikiStatus =
  "draft" | "maintained" | "reviewed" | "outdated" | "unknown";
export type ConfluenceSync =
  "synced" | "local-newer" | "remote-newer" | "disconnected" | "conflict";

const STATUS_TONE: Record<WikiStatus, Tone> = {
  draft: "plan",
  maintained: "ok",
  reviewed: "ok",
  outdated: "warn",
  unknown: "neutral",
};
const SYNC_TONE: Record<ConfluenceSync, Tone> = {
  synced: "ok",
  "local-newer": "signal",
  "remote-newer": "plan",
  disconnected: "neutral",
  conflict: "bad",
};

/** Dictionary keys of the page and sync states; the ids stay as stored in front matter. */
const STATUS_KEY: Record<WikiStatus, TextKey> = {
  draft: "ui.wiki-src-views.wiki-draft",
  maintained: "ui.wiki-src-views.wiki-maintained",
  reviewed: "ui.wiki-src-views.wiki-reviewed",
  outdated: "ui.wiki-src-views.wiki-outdated",
  unknown: "ui.wiki-src-views.wiki-unknown",
};
const SYNC_KEY: Record<ConfluenceSync, TextKey> = {
  synced: "ui.wiki-src-views.wiki-sync",
  "local-newer": "ui.wiki-src-views.wiki-newer-locally",
  "remote-newer": "ui.wiki-src-views.wiki-newer-remotely",
  disconnected: "ui.wiki-src-views.wiki-not-connected",
  conflict: "ui.wiki-src-views.wiki-conflict",
};

/** Visible names of wiki page states and Confluence sync states. */
export function useWikiLabels() {
  const { t } = useText();
  return {
    /** The raw value is shown for an unknown state; known states ignore it. */
    status: (s: WikiStatus, raw?: string) =>
      s === "unknown" && raw
        ? t("ui.wiki-src-views.wiki-unknown-value", { value: raw })
        : t(STATUS_KEY[s]),
    sync: (s: ConfluenceSync) => t(SYNC_KEY[s]),
  };
}

export function WikiStatusBadge({
  status,
  raw,
}: {
  status: WikiStatus;
  raw?: string;
}) {
  const labels = useWikiLabels();
  return <Badge tone={STATUS_TONE[status]}>{labels.status(status, raw)}</Badge>;
}

export function SyncBadge({ sync }: { sync: ConfluenceSync }) {
  const labels = useWikiLabels();
  return (
    <span className="t-row t-meta" style={{ gap: 6 }}>
      <Dot tone={SYNC_TONE[sync]} open={sync === "disconnected"} />
      {labels.sync(sync)}
    </span>
  );
}

/* Rail: the page tree ------------------------------------------------------- */

export type WikiRailPage = {
  path: string;
  title: string;
  status: WikiStatus;
  /** The front-matter value when `status` is `unknown`. */
  rawStatus?: string;
  current?: boolean;
};
export type WikiRailGroup = {
  key: string;
  label: string;
  count: number;
  open: boolean;
  pages: WikiRailPage[];
  more?: number;
};
export type WikiRailView = "tree" | "categories" | "recent";

export type WikiRailProps = {
  total: number;
  query: string;
  view: WikiRailView;
  groups: WikiRailGroup[];
  /** Pages matching the query; absent without a query. */
  hits?: number;
  onQuery?: (q: string) => void;
  onView?: (v: WikiRailView) => void;
  onToggle?: (key: string) => void;
  onSelect?: (path: string) => void;
  onCreate?: () => void;
  /** Why a page cannot be created right now; the create button then shows it, disabled. */
  createDisabledReason?: string;
};

export function WikiRail({
  total,
  query,
  view,
  groups,
  hits,
  onQuery = noop,
  onView = noop,
  onToggle = noop,
  onSelect = noop,
  onCreate = noop,
  createDisabledReason,
}: WikiRailProps) {
  const { t, number } = useText();
  return (
    <nav
      className="t-d-rail"
      aria-label={t("ui.wiki-src-views.wiki-page-tree")}
    >
      <div className="t-row t-row--between">
        <span className="t-label">
          {t("ui.wiki-src-views.wiki-pages")}{" "}
          <span className="t-mono t-muted">{number(total)}</span>
        </span>
        <IconButton
          icon="plus"
          label={t("ui.wiki-src-views.wiki-create-page")}
          size="small"
          onClick={onCreate}
          disabledReason={createDisabledReason}
        />
      </div>
      <SearchField
        label={t("ui.wiki-src-views.wiki-filter-pages")}
        value={query}
        placeholder={t("ui.wiki-src-views.wiki-title-path-tag")}
        onChange={onQuery}
      />
      {hits != null ? (
        <span className="t-meta" data-testid="wiki-rail-hits">
          {t("ui.wiki-src-views.wiki-hits-total-pages", { hits, total })}
        </span>
      ) : null}
      <Segment<WikiRailView>
        label={t("ui.wiki-src-views.wiki-outline")}
        value={view}
        onChange={onView}
        options={[
          {
            value: "tree",
            label: t("ui.wiki-src-views.wiki-tree"),
            icon: "tree",
          },
          {
            value: "categories",
            label: t("ui.wiki-src-views.wiki-categories"),
            icon: "grid",
          },
          {
            value: "recent",
            label: t("ui.wiki-src-views.wiki-recent"),
            icon: "clock",
          },
        ]}
      />
      <ul
        className="t-d-tree"
        role="tree"
        aria-label={t("ui.wiki-src-views.wiki-wiki-pages")}
      >
        {groups.map((g) => (
          <li
            key={g.key}
            role="treeitem"
            aria-expanded={g.open}
            aria-selected={false}
          >
            <button
              type="button"
              className="t-d-tree__group"
              onClick={() => onToggle(g.key)}
            >
              <Icon name={g.open ? "chevronDown" : "chevronRight"} size={14} />
              <Icon name="folder" size={14} />
              <span className="t-wrap">{g.label}</span>
              <span className="t-spacer" />
              <span className="t-mono t-meta">{number(g.count)}</span>
            </button>
            {g.open ? (
              <ul role="group" className="t-stagger">
                {g.pages.map((p) => (
                  <li key={p.path} role="treeitem" aria-selected={!!p.current}>
                    <button
                      type="button"
                      className="t-d-tree__page"
                      aria-current={p.current ? "page" : undefined}
                      onClick={() => onSelect(p.path)}
                    >
                      <Dot
                        tone={STATUS_TONE[p.status]}
                        open={p.status === "unknown"}
                      />
                      <span className="t-wrap">{p.title}</span>
                    </button>
                  </li>
                ))}
                {g.more ? (
                  <li role="none" className="t-d-tree__more t-meta">
                    {t("ui.wiki-src-views.wiki-count-more", { count: g.more })}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* Workspace frame ----------------------------------------------------------- */

export type WikiWorkspaceProps = {
  rail: ReactNode;
  children: ReactNode;
  mobile?: boolean;
  /** Mobile: the tree opens as a sheet from below. */
  railOpen?: boolean;
  railLabel?: string;
  onRail?: () => void;
};

/** Tree left, page right. On mobile the tree is a sheet behind a button. */
export function WikiWorkspace({
  rail,
  children,
  mobile,
  railOpen,
  railLabel,
  onRail = noop,
}: WikiWorkspaceProps) {
  const { t } = useText();
  const label = railLabel ?? t("ui.wiki-src-views.wiki-page-tree");
  if (mobile) {
    return (
      <div className="t-page t-d-wiki" data-mobile="true">
        <div className="t-d-mobilebar">
          <Button icon="tree" size="small" onClick={onRail}>
            {label}
          </Button>
        </div>
        {children}
        <Sheet open={!!railOpen} side="bottom" title={label} onClose={onRail}>
          {rail}
        </Sheet>
      </div>
    );
  }
  return (
    <div className="t-page t-d-wiki">
      <aside className="t-d-wiki__rail">{rail}</aside>
      <div className="t-d-wiki__main">{children}</div>
    </div>
  );
}

/* Page ---------------------------------------------------------------------- */

export type WikiPageMeta = {
  path: string;
  title: string;
  category: string;
  status: WikiStatus;
  /** The front-matter value when `status` is `unknown`. */
  rawStatus?: string;
  tags: string[];
  /** Absent when the history was not read. */
  updatedAt?: string;
  /** Absent when the history was not read. */
  author?: string;
  words: number;
  /** Absent when the sync state was not checked; "not connected" is a measured state. */
  confluence?: ConfluenceSync;
};

export type WikiLinkedRecord = {
  id: string;
  summary: string;
  lifecycle: string;
  proven: number;
  scenarios: number;
};
export type WikiReference = {
  label: string;
  target: string;
  kind: "record" | "wiki" | "term";
  broken?: boolean;
};
export type WikiFinding = {
  tone: "warn" | "bad" | "plan";
  text: string;
  where?: string;
};
export type WikiEmbed = {
  record: string;
  scenarios: { text: string; proven: boolean }[];
};

export type WikiArticleProps = {
  page: WikiPageMeta;
  /**
   * The places above the page, outermost first; the page's title follows as
   * the current segment. A plain string is a segment that leads nowhere.
   */
  crumbs: (string | { key?: string; label: string; onClick?: () => void })[];
  markdown: string;
  toc: { id: string; label: string; level: number }[];
  records: WikiLinkedRecord[];
  backlinks: { path: string; title: string }[];
  outlinks: WikiReference[];
  embed?: WikiEmbed;
  findings?: WikiFinding[];
  /** Words written per month over the last year, oldest first. */
  activity?: number[];
  /** Why the file could not be read; the page then shows only what is certain. */
  readError?: string | null;
  mobile?: boolean;
  onEdit?: () => void;
  onHistory?: () => void;
  onAsk?: () => void;
  onOpenRecord?: (id: string) => void;
  onLink?: (href: string) => void;
  onCopyCode?: (code: string) => void;
};

export function WikiArticle({
  page,
  crumbs,
  markdown,
  toc,
  records,
  backlinks,
  outlinks,
  embed,
  findings = [],
  activity,
  readError,
  mobile,
  onEdit = noop,
  onHistory = noop,
  onAsk = noop,
  onOpenRecord = noop,
  onLink = noop,
  onCopyCode = noop,
}: WikiArticleProps) {
  const { t } = useText();
  const lifecycleLabel = useLifecycleLabel();
  const labels = useWikiLabels();
  const minutes = Math.max(1, Math.round(page.words / 220));
  const refKind = (kind: WikiReference["kind"]) =>
    kind === "term"
      ? t("ui.wiki-src-views.wiki-term")
      : kind === "record"
        ? "Record"
        : "Wiki";
  return (
    <article className="t-d-article t-anim-focus" aria-label={page.title}>
      <Breadcrumbs
        crumbs={[
          ...crumbs.map((c, i) =>
            typeof c === "string"
              ? { key: `${i}`, label: c }
              : { key: c.key ?? `${i}`, label: c.label, onClick: c.onClick },
          ),
          { key: "page", label: page.title },
        ]}
      />
      <header className="t-d-article__head">
        <div className="t-row t-row--wrap" style={{ gap: 8 }}>
          <WikiStatusBadge status={page.status} raw={page.rawStatus} />
          <Badge plain>{page.category}</Badge>
          {page.confluence ? <SyncBadge sync={page.confluence} /> : null}
        </div>
        <h1 className="t-d-article__title">{page.title}</h1>
        <p className="t-meta">
          <span className="t-mono">{page.path}</span>
          {/* Parts that were not read are left out with their separator. */}
          {[
            page.author,
            page.updatedAt
              ? t("ui.wiki-src-views.wiki-changed-date", {
                  date: page.updatedAt,
                })
              : null,
            t("ui.wiki-src-views.wiki-words-words-minutes-min", {
              words: page.words,
              minutes,
            }),
          ]
            .filter(Boolean)
            .map((part) => ` · ${part}`)
            .join("")}
        </p>
        <div className="t-row t-row--wrap" style={{ gap: 8 }}>
          <Button variant="primary" icon="edit" onClick={onEdit}>
            {t("ui.wiki-src-views.wiki-edit")}
          </Button>
          <Button icon="history" onClick={onHistory}>
            {t("ui.wiki-src-views.wiki-history")}
          </Button>
          <Button variant="quiet" icon="spark" onClick={onAsk}>
            {t("ui.wiki-src-views.wiki-ask-atlas")}
          </Button>
        </div>
      </header>

      {findings.length ? (
        <section
          className="t-d-findings"
          aria-label={t("ui.wiki-src-views.wiki-reviewer-findings")}
        >
          <span className="t-label">
            {t("ui.wiki-src-views.wiki-reviewer-findings-count", {
              count: findings.length,
            })}
          </span>
          <ul>
            {findings.map((f, i) => (
              <li key={i} className="t-row" style={{ gap: 8 }}>
                <Icon
                  name={f.tone === "bad" ? "error" : "warning"}
                  size={14}
                  className={`t-${f.tone}`}
                />
                <span>{f.text}</span>
                {f.where ? (
                  <span className="t-mono t-meta">{f.where}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mobile && toc.length ? (
        <nav
          className="t-d-chipbar"
          aria-label={t("ui.wiki-src-views.wiki-contents")}
        >
          {toc.map((entry) => (
            <Chip key={entry.id} onClick={() => onLink(`#${entry.id}`)}>
              {entry.label}
            </Chip>
          ))}
        </nav>
      ) : null}

      <div className="t-d-article__grid">
        <div className="t-d-article__body">
          {readError ? (
            <EmptyState
              tone="error"
              icon="error"
              title={t("ui.wiki-src-views.wiki-page-not-readable")}
              body={
                <>
                  <span className="t-mono">{page.path}</span> · {readError}
                </>
              }
              action={
                <Button icon="edit" onClick={onEdit}>
                  {t("ui.wiki-src-views.wiki-open-source-text")}
                </Button>
              }
            />
          ) : (
            <Markdown
              source={markdown}
              onLink={onLink}
              onCopyCode={onCopyCode}
            />
          )}
          {embed && !readError ? (
            <figure
              className="t-d-embed"
              aria-label={t("ui.wiki-src-views.wiki-embedded-record", {
                record: embed.record,
              })}
            >
              <figcaption className="t-row t-row--between">
                <span className="t-row" style={{ gap: 6 }}>
                  <Icon name="check" size={14} />
                  <span className="t-label">
                    {t("ui.wiki-src-views.wiki-promises")}
                  </span>
                  <button
                    type="button"
                    className="t-d-linkbtn t-mono"
                    onClick={() => onOpenRecord(embed.record)}
                  >
                    {embed.record}
                  </button>
                </span>
                <span className="t-meta">
                  {t("ui.wiki-src-views.wiki-proven-total-test-named", {
                    proven: embed.scenarios.filter((s) => s.proven).length,
                    total: embed.scenarios.length,
                  })}
                </span>
              </figcaption>
              <ol className="t-d-embed__list">
                {embed.scenarios.map((s, i) => (
                  <li key={i} data-proven={s.proven}>
                    <Dot tone={s.proven ? "ok" : "warn"} open={!s.proven} />
                    <span>{s.text}</span>
                  </li>
                ))}
              </ol>
            </figure>
          ) : null}
        </div>
        <aside className="t-d-article__side">
          {!mobile && toc.length ? (
            <nav
              className="t-d-toc"
              aria-label={t("ui.wiki-src-views.wiki-contents")}
            >
              <span className="t-label">
                {t("ui.wiki-src-views.wiki-contents")}
              </span>
              {toc.map((entry) => (
                <a
                  key={entry.id}
                  href={`#${entry.id}`}
                  data-level={entry.level}
                  onClick={(e) => {
                    e.preventDefault();
                    onLink(`#${entry.id}`);
                  }}
                >
                  {entry.label}
                </a>
              ))}
            </nav>
          ) : null}
          <section
            className="t-d-card"
            aria-label={t("ui.wiki-src-views.wiki-linked-records")}
          >
            <span className="t-label">
              {t("ui.wiki-src-views.wiki-linked-records-count", {
                count: records.length,
              })}
            </span>
            {records.map((r) => (
              <button
                key={r.id}
                type="button"
                className="t-d-recordlink"
                onClick={() => onOpenRecord(r.id)}
              >
                <span className="t-mono t-wrap">{r.id}</span>
                <span className="t-meta t-clamp-2">
                  {r.summary || t("ui.wiki-src-views.wiki-no-summary")}
                </span>
                <span className="t-row" style={{ gap: 6 }}>
                  <Badge plain>{lifecycleLabel(r.lifecycle)}</Badge>
                  <span className="t-meta">
                    {t(
                      "ui.wiki-src-views.wiki-proven-total-test-named-wikiarticle",
                      {
                        proven: r.proven,
                        total: r.scenarios,
                      },
                    )}
                  </span>
                </span>
              </button>
            ))}
          </section>
          <section className="t-d-card" aria-label="Front-Matter">
            <span className="t-label">Front-Matter</span>
            <Facts
              rows={[
                ["Status", labels.status(page.status, page.rawStatus)],
                [t("ui.wiki-src-views.wiki-category"), page.category],
                [
                  "Tags",
                  <span
                    key="t"
                    className="t-row t-row--wrap"
                    style={{ gap: 4 }}
                  >
                    {page.tags.length ? (
                      page.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
                    ) : (
                      <span className="t-muted">
                        {t("ui.wiki-src-views.wiki-none")}
                      </span>
                    )}
                  </span>,
                ],
                [
                  "Confluence",
                  page.confluence ? (
                    labels.sync(page.confluence)
                  ) : (
                    <span
                      key="c"
                      title={t("ui.wiki-src-views.wiki-not-checked")}
                      data-testid="wiki-sync-unmeasured"
                    >
                      —
                    </span>
                  ),
                ],
              ]}
            />
            {activity ? (
              <div className="t-row t-row--between">
                <span className="t-meta">
                  {t("ui.wiki-src-views.wiki-changes-12-months")}
                </span>
                <Bars
                  values={activity}
                  label={t("ui.wiki-src-views.wiki-changes-last-twelve-months")}
                />
              </div>
            ) : null}
          </section>
          <section
            className="t-d-card"
            aria-label={t("ui.wiki-src-views.wiki-references")}
          >
            <span className="t-label">
              {t("ui.wiki-src-views.wiki-references-here-count", {
                count: backlinks.length,
              })}
            </span>
            {backlinks.map((b) => (
              <button
                key={b.path}
                type="button"
                className="t-d-linkbtn"
                onClick={() => onLink(b.path)}
              >
                <Icon name="back" size={12} /> {b.title}
              </button>
            ))}
            <span className="t-label" style={{ marginTop: 8 }}>
              {t("ui.wiki-src-views.wiki-references-here-count-wikiarticle", {
                count: outlinks.length,
              })}
            </span>
            {outlinks.map((o) => (
              <button
                key={o.target}
                type="button"
                className="t-d-linkbtn"
                data-broken={o.broken || undefined}
                onClick={() => onLink(o.target)}
              >
                <Icon name={o.broken ? "warning" : "forward"} size={12} />{" "}
                {o.label}
                <span className="t-meta">
                  {" "}
                  ·{" "}
                  {o.broken
                    ? t("ui.wiki-src-views.wiki-target-missing")
                    : refKind(o.kind)}
                </span>
              </button>
            ))}
          </section>
        </aside>
      </div>
    </article>
  );
}

/* Create --------------------------------------------------------------------- */

export type WikiCreateProps = {
  title: string;
  titleError?: string;
  location: string;
  locations: string[];
  category: string;
  categories: string[];
  tags: string[];
  records: string[];
  text: string;
  /** Branch the page is proposed on, derived from the title. */
  branch: string;
  worktree: "clean" | "changed" | "no-git";
  mobile?: boolean;
  preview?: boolean;
  onChange?: (field: string, value: string) => void;
  onRemoveTag?: (tag: string) => void;
  onRemoveRecord?: (id: string) => void;
  onAddRecord?: () => void;
  onPreview?: (on: boolean) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
};

export function WikiCreateForm({
  title,
  titleError,
  location,
  locations,
  category,
  categories,
  tags,
  records,
  text,
  branch,
  worktree,
  mobile,
  preview,
  onChange = noop,
  onRemoveTag = noop,
  onRemoveRecord = noop,
  onAddRecord = noop,
  onPreview = noop,
  onSubmit = noop,
  onCancel = noop,
}: WikiCreateProps) {
  const { t } = useText();
  const worktreeKey: Record<WikiCreateProps["worktree"], TextKey> = {
    clean: "ui.wiki-src-views.wiki-clean",
    changed: "ui.wiki-src-views.wiki-changed",
    "no-git": "ui.wiki-src-views.wiki-without-git",
  };
  const showText = !mobile || !preview;
  const showPreview = !mobile || preview;
  return (
    <form
      className="t-d-form t-anim-rise"
      aria-label={t("ui.wiki-src-views.wiki-create-page")}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <PluginHead
        icon="plus"
        title={t("ui.wiki-src-views.wiki-create-page")}
        sentence={
          <>
            {t("ui.wiki-src-views.wiki-proposed-branch")}
            <span className="t-mono">{branch}</span>
            {t("ui.wiki-src-views.wiki-label")}
          </>
        }
      />
      <div className="t-d-form__grid">
        <Field
          label={t("ui.wiki-src-views.wiki-title")}
          error={titleError}
          hint={
            titleError
              ? undefined
              : t("ui.wiki-src-views.wiki-only-thing-required")
          }
        >
          {(id) => (
            <input
              id={id}
              className="t-input"
              value={title}
              aria-invalid={!!titleError}
              onChange={(e) => onChange("title", e.target.value)}
            />
          )}
        </Field>
        <Field label={t("ui.wiki-src-views.wiki-place-tree")}>
          {(id) => (
            <select
              id={id}
              className="t-select"
              value={location}
              onChange={(e) => onChange("location", e.target.value)}
            >
              {locations.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("ui.wiki-src-views.wiki-category")}>
          {(id) => (
            <select
              id={id}
              className="t-select"
              value={category}
              onChange={(e) => onChange("category", e.target.value)}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
        <div className="t-field">
          <span className="t-field__label">Tags</span>
          <div className="t-row t-row--wrap" style={{ gap: 6 }}>
            {tags.map((tag) => (
              <Chip key={tag} onRemove={() => onRemoveTag(tag)}>
                {tag}
              </Chip>
            ))}
            <input
              className="t-input t-d-inline-input"
              aria-label={t("ui.wiki-src-views.wiki-add-tag")}
              placeholder="Tag …"
              onChange={(e) => onChange("tag", e.target.value)}
            />
          </div>
        </div>
        <div className="t-field t-d-form__wide">
          <span className="t-field__label">
            {t("ui.wiki-src-views.wiki-linked-records")}
          </span>
          <div className="t-row t-row--wrap" style={{ gap: 6 }}>
            {records.map((r) => (
              <Chip key={r} mono icon="file" onRemove={() => onRemoveRecord(r)}>
                {r}
              </Chip>
            ))}
            <Button
              size="small"
              variant="quiet"
              icon="plus"
              onClick={onAddRecord}
            >
              {t("ui.wiki-src-views.wiki-link-record")}
            </Button>
          </div>
        </div>
      </div>
      {mobile ? (
        <Segment<"text" | "preview">
          label={t("ui.wiki-src-views.wiki-view")}
          value={preview ? "preview" : "text"}
          onChange={(v) => onPreview(v === "preview")}
          options={[
            { value: "text", label: "Text" },
            { value: "preview", label: t("ui.wiki-src-views.wiki-preview") },
          ]}
        />
      ) : null}
      <div className="t-d-split" data-single={mobile || undefined}>
        {showText ? (
          <label className="t-d-split__pane">
            <span className="t-label">Text · Markdown</span>
            <textarea
              className="t-textarea t-textarea--code t-d-split__text"
              value={text}
              onChange={(e) => onChange("text", e.target.value)}
            />
          </label>
        ) : null}
        {showPreview ? (
          <div
            className="t-d-split__pane t-d-split__preview"
            role="region"
            aria-label={t("ui.wiki-src-views.wiki-preview")}
          >
            <span className="t-label">
              {t("ui.wiki-src-views.wiki-preview")}
            </span>
            <Markdown
              source={`# ${title || t("ui.wiki-src-views.wiki-untitled")}\n\n${text}`}
            />
          </div>
        ) : null}
      </div>
      <footer className="t-d-form__foot">
        <span className="t-row t-meta" style={{ gap: 6 }}>
          <Icon name="branch" size={14} />{" "}
          {t("ui.wiki-src-views.wiki-working-tree-state", {
            state: t(worktreeKey[worktree]),
          })}
        </span>
        <span className="t-spacer" />
        <Button variant="quiet" onClick={onCancel}>
          {t("ui.wiki-src-views.wiki-cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          icon="branch"
          disabled={!!titleError}
        >
          {t("ui.wiki-src-views.wiki-create-propose")}
        </Button>
      </footer>
    </form>
  );
}

/* Edit (split) ----------------------------------------------------------- */

export type WikiEditorMode = "text" | "split" | "preview";

export type WikiEditorProps = {
  title: string;
  path: string;
  text: string;
  mode: WikiEditorMode;
  base: string;
  added: number;
  removed: number;
  diff: DiffLine[];
  diffOpen?: boolean;
  mobile?: boolean;
  onText?: (text: string) => void;
  onMode?: (mode: WikiEditorMode) => void;
  onDiff?: () => void;
  onPropose?: () => void;
  onCancel?: () => void;
};

export function WikiEditor({
  title,
  path,
  text,
  mode,
  base,
  added,
  removed,
  diff,
  diffOpen,
  mobile,
  onText = noop,
  onMode = noop,
  onDiff = noop,
  onPropose = noop,
  onCancel = noop,
}: WikiEditorProps) {
  const { t } = useText();
  const effective = mobile && mode === "split" ? "text" : mode;
  return (
    <section
      className="t-d-editor t-anim-rise"
      aria-label={t("ui.wiki-src-views.wiki-edit-title", { title })}
    >
      <div className="t-d-editor__bar">
        <div className="t-stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="t-h3 t-wrap">{title}</span>
          <span className="t-mono t-meta t-wrap">{path}</span>
        </div>
        <span className="t-spacer" />
        <Segment<WikiEditorMode>
          label={t("ui.wiki-src-views.wiki-view")}
          value={effective}
          onChange={onMode}
          options={[
            { value: "text", label: "Text", icon: "code" },
            ...(mobile
              ? []
              : [
                  {
                    value: "split" as const,
                    label: t("ui.wiki-src-views.wiki-split"),
                    icon: "layers" as const,
                  },
                ]),
            {
              value: "preview",
              label: t("ui.wiki-src-views.wiki-preview"),
              icon: "eye",
            },
          ]}
        />
      </div>
      <div
        className="t-d-split"
        data-single={effective !== "split" || undefined}
      >
        {effective !== "preview" ? (
          <label className="t-d-split__pane">
            <span className="t-label">Markdown</span>
            <textarea
              className="t-textarea t-textarea--code t-d-split__text"
              value={text}
              onChange={(e) => onText(e.target.value)}
            />
          </label>
        ) : null}
        {effective !== "text" ? (
          <div
            className="t-d-split__pane t-d-split__preview"
            role="region"
            aria-label={t("ui.wiki-src-views.wiki-preview")}
          >
            <span className="t-label">
              {t("ui.wiki-src-views.wiki-preview")}
            </span>
            <Markdown source={text} />
          </div>
        ) : null}
      </div>
      <div className="t-d-editor__changes">
        <button
          type="button"
          className="t-d-editor__changes-toggle"
          aria-expanded={!!diffOpen}
          onClick={onDiff}
        >
          <Icon name={diffOpen ? "chevronDown" : "chevronRight"} size={14} />
          <span>{t("ui.wiki-src-views.wiki-changes-against")}</span>
          <span className="t-mono">{base}</span>
          <span className="t-ok t-mono">+{added}</span>
          <span className="t-bad t-mono">−{removed}</span>
        </button>
        {diffOpen ? (
          <Diff lines={diff} label={t("ui.wiki-src-views.wiki-changes")} />
        ) : null}
      </div>
      <footer className="t-d-form__foot">
        <Button variant="quiet" onClick={onCancel}>
          {t("ui.wiki-src-views.wiki-discard")}
        </Button>
        <span className="t-spacer" />
        <Button
          variant="primary"
          icon="pr"
          onClick={onPropose}
          disabled={added + removed === 0}
        >
          {t("ui.wiki-src-views.wiki-propose")}
        </Button>
      </footer>
    </section>
  );
}

/* Propose (branch + PR) -------------------------------------------------- */

export type ProposeState = "form" | "running" | "created" | "failed" | "denied";

export type WikiProposeProps = {
  state: ProposeState;
  branch: string;
  message: string;
  prTitle: string;
  prBody: string;
  target: string;
  files: { path: string; added: number; removed: number }[];
  steps: {
    key: string;
    label: string;
    state: "done" | "running" | "failed" | "todo";
    detail?: string;
  }[];
  pr?: { number: number; url: string; sha: string };
  error?: { step: string; reason: string; hint: string };
  /** The plugin lacks a grant: which tool, and the command that grants it. */
  denied?: { tool: string; command: string };
  mobile?: boolean;
  onCopyCommand?: () => void;
  onChange?: (field: string, value: string) => void;
  onSubmit?: () => void;
  onRetry?: () => void;
  onClose?: () => void;
  onOpenPr?: () => void;
};

export function WikiProposeSheet({
  state,
  branch,
  message,
  prTitle,
  prBody,
  target,
  files,
  steps,
  pr,
  error,
  denied,
  mobile,
  onCopyCommand = noop,
  onChange = noop,
  onSubmit = noop,
  onRetry = noop,
  onClose = noop,
  onOpenPr = noop,
}: WikiProposeProps) {
  const { t, plural } = useText();
  const busy = state === "running";
  const footer =
    state === "created" ? (
      <>
        <Button variant="quiet" onClick={onClose}>
          {t("ui.wiki-src-views.wiki-close")}
        </Button>
        <Button variant="primary" icon="external" onClick={onOpenPr}>
          {t("ui.wiki-src-views.wiki-open-pull-request")}
        </Button>
      </>
    ) : state === "denied" ? (
      <>
        <Button variant="quiet" onClick={onClose}>
          {t("ui.wiki-src-views.wiki-close")}
        </Button>
        <Button variant="primary" icon="pr" disabled>
          {t("ui.wiki-src-views.wiki-create-branch-pr")}
        </Button>
      </>
    ) : state === "failed" ? (
      <>
        <Button variant="quiet" onClick={onClose}>
          {t("ui.wiki-src-views.wiki-keep-branch-later")}
        </Button>
        <Button variant="primary" icon="refresh" onClick={onRetry}>
          {t("ui.wiki-src-views.wiki-try-again")}
        </Button>
      </>
    ) : (
      <>
        <Button variant="quiet" onClick={onClose} disabled={busy}>
          {t("ui.wiki-src-views.wiki-cancel")}
        </Button>
        <Button variant="primary" icon="pr" onClick={onSubmit} disabled={busy}>
          {busy
            ? t("ui.wiki-src-views.wiki-proposing")
            : t("ui.wiki-src-views.wiki-create-branch-pr")}
        </Button>
      </>
    );
  return (
    <Sheet
      open
      side={mobile ? "bottom" : "right"}
      title={t("ui.wiki-src-views.wiki-propose-wikiproposesheet")}
      meta={plural("ui.wiki-src-views.wiki-count-files-target", files.length, {
        target,
      })}
      onClose={onClose}
      footer={footer}
      width={520}
    >
      <div className="t-stack" style={{ gap: 16 }}>
        {state === "created" && pr ? (
          <div className="t-d-banner" data-tone="ok" role="status">
            <Icon name="check" size={18} />
            <div className="t-stack" style={{ gap: 2 }}>
              <strong>
                {t("ui.wiki-src-views.wiki-pull-request-number-created", {
                  number: String(pr.number),
                })}
              </strong>
              <span className="t-meta">
                <span className="t-mono">{branch}</span> · Commit{" "}
                <span className="t-mono">{pr.sha}</span>
              </span>
            </div>
          </div>
        ) : null}
        {state === "failed" && error ? (
          <div className="t-d-banner" data-tone="bad" role="alert">
            <Icon name="error" size={18} />
            <div className="t-stack" style={{ gap: 2 }}>
              <strong>
                {t("ui.wiki-src-views.wiki-stopped-step-step", {
                  step: error.step,
                })}
              </strong>
              <span>{error.reason}</span>
              <span className="t-meta">{error.hint}</span>
            </div>
          </div>
        ) : null}
        {state === "denied" && denied ? (
          <div className="t-d-banner" data-tone="warn" role="alert">
            <Icon name="lock" size={18} />
            <div className="t-stack" style={{ gap: 6, minWidth: 0 }}>
              <strong>
                {t("ui.wiki-src-views.wiki-no-grant-tool", {
                  tool: denied.tool,
                })}
              </strong>
              <span>
                {t("ui.wiki-src-views.wiki-wiki-plugin-may-not-create-branch")}
              </span>
              <span className="t-meta">
                {t("ui.wiki-src-views.wiki-grant-terminal")}
              </span>
              <div className="t-d-cmd">
                <span className="t-mono">$ {denied.command}</span>
                <span className="t-spacer" />
                <IconButton
                  icon="copy"
                  label={t("ui.wiki-src-views.wiki-copy-command")}
                  size="small"
                  onClick={onCopyCommand}
                />
              </div>
            </div>
          </div>
        ) : null}
        {state !== "form" && state !== "denied" ? (
          <Steps label={t("ui.wiki-src-views.wiki-progress")} steps={steps} />
        ) : null}
        <fieldset className="t-d-fieldset" disabled={state !== "form"}>
          <Field label={t("ui.wiki-src-views.wiki-branch")}>
            {(id) => (
              <input
                id={id}
                className="t-input t-mono"
                value={branch}
                onChange={(e) => onChange("branch", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("ui.wiki-src-views.wiki-commit-message")}>
            {(id) => (
              <input
                id={id}
                className="t-input"
                value={message}
                onChange={(e) => onChange("message", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("ui.wiki-src-views.wiki-pr-title")}>
            {(id) => (
              <input
                id={id}
                className="t-input"
                value={prTitle}
                onChange={(e) => onChange("prTitle", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("ui.wiki-src-views.wiki-pr-text")}>
            {(id) => (
              <textarea
                id={id}
                className="t-textarea"
                rows={4}
                value={prBody}
                onChange={(e) => onChange("prBody", e.target.value)}
              />
            )}
          </Field>
        </fieldset>
        <div className="t-stack" style={{ gap: 4 }}>
          <span className="t-label">{t("ui.wiki-src-views.wiki-files")}</span>
          {files.map((f) => (
            <div key={f.path} className="t-row t-d-fileline">
              <Icon name="file" size={14} />
              <span className="t-mono t-wrap">{f.path}</span>
              <span className="t-spacer" />
              <span className="t-ok t-mono">+{f.added}</span>
              <span className="t-bad t-mono">−{f.removed}</span>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/* History ----------------------------------------------------------------- */

export type WikiVersion = {
  sha: string;
  date: string;
  author: string;
  subject: string;
  added: number;
  removed: number;
  current?: boolean;
};

export type WikiHistoryProps = {
  title: string;
  path: string;
  versions: WikiVersion[];
  selected: string;
  diff: DiffLine[];
  mobile?: boolean;
  onSelect?: (sha: string) => void;
  onRestore?: (sha: string) => void;
  onBack?: () => void;
};

export function WikiHistory({
  title,
  path,
  versions,
  selected,
  diff,
  mobile,
  onSelect = noop,
  onRestore = noop,
  onBack = noop,
}: WikiHistoryProps) {
  const { t, plural } = useText();
  const sel = versions.find((v) => v.sha === selected) ?? versions[0];
  return (
    <section
      className="t-d-history t-anim-rise"
      aria-label={t("ui.wiki-src-views.wiki-page-history")}
    >
      <PluginHead
        icon="history"
        title={title}
        count={plural("ui.wiki-src-views.wiki-count-versions", versions.length)}
        sentence={<span className="t-mono">{path}</span>}
        actions={
          <Button variant="quiet" icon="back" onClick={onBack}>
            {t("ui.wiki-src-views.wiki-page")}
          </Button>
        }
      />
      <div className="t-d-history__grid" data-mobile={mobile || undefined}>
        <ol
          className="t-d-timeline"
          aria-label={t("ui.wiki-src-views.wiki-versions")}
        >
          {versions.map((v) => (
            <li key={v.sha}>
              <button
                type="button"
                className="t-d-timeline__item"
                aria-pressed={v.sha === sel.sha}
                onClick={() => onSelect(v.sha)}
              >
                <span className="t-d-timeline__dot" aria-hidden="true" />
                <span className="t-stack" style={{ gap: 2, minWidth: 0 }}>
                  <span className="t-wrap">{v.subject}</span>
                  <span className="t-meta">
                    {v.author} · {v.date} ·{" "}
                    <span className="t-mono">{v.sha}</span>
                    {v.current ? t("ui.wiki-src-views.wiki-current") : ""}
                  </span>
                </span>
                <span className="t-spacer" />
                <span className="t-mono t-meta">
                  <span className="t-ok">+{v.added}</span>{" "}
                  <span className="t-bad">−{v.removed}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="t-stack">
          <div className="t-row t-row--between t-row--wrap">
            <span className="t-h3">
              <span className="t-mono">{sel.sha}</span>
              {t("ui.wiki-src-views.wiki-against-its-predecessor")}
            </span>
            <Button
              size="small"
              icon="refresh"
              disabled={!!sel.current}
              onClick={() => onRestore(sel.sha)}
            >
              {t("ui.wiki-src-views.wiki-propose-version")}
            </Button>
          </div>
          <Diff
            lines={diff}
            label={t("ui.wiki-src-views.wiki-changes-sha", { sha: sel.sha })}
          />
        </div>
      </div>
    </section>
  );
}

/* Empty & missing ---------------------------------------------------------- */

export function WikiEmpty({
  directory,
  onCreate = noop,
  createDisabledReason,
  onImport = noop,
}: {
  directory: string;
  onCreate?: () => void;
  /** Why the first page cannot be created right now. */
  createDisabledReason?: string;
  onImport?: () => void;
}) {
  const { t } = useText();
  return (
    <div
      className="t-page t-stack"
      style={{ gap: 20 }}
      data-testid="wiki-empty"
    >
      <PluginHead icon="book" title="Wiki" count="0" />
      <EmptyState
        icon="book"
        title={t("ui.wiki-src-views.wiki-no-page-yet")}
        body={
          <>
            {t("ui.wiki-src-views.wiki-pages-live-markdown-under")}
            <span className="t-mono">{directory}</span>
            {t("ui.wiki-src-views.wiki-versioned-code")}
          </>
        }
        action={
          <>
            <Button
              variant="primary"
              icon="plus"
              onClick={onCreate}
              disabledReason={createDisabledReason}
            >
              {t("ui.wiki-src-views.wiki-create-first-page")}
            </Button>
            <Button icon="download" onClick={onImport}>
              {t("ui.wiki-src-views.wiki-import-confluence")}
            </Button>
          </>
        }
      />
    </div>
  );
}

export function WikiMissing({
  path,
  nearest,
  onCreate = noop,
  createDisabledReason,
  onOpen = noop,
}: {
  path: string;
  nearest: { path: string; title: string }[];
  onCreate?: () => void;
  /** Why the missing page cannot be created right now. */
  createDisabledReason?: string;
  onOpen?: (path: string) => void;
}) {
  const { t } = useText();
  return (
    <div className="t-stack" style={{ gap: 20 }}>
      <EmptyState
        icon="search"
        title={t("ui.wiki-src-views.wiki-page-not-found")}
        body={
          <>
            {t("ui.wiki-src-views.wiki-there-no-page-under")}
            <span className="t-mono">{path}</span>
            {t("ui.wiki-src-views.wiki-was-moved-renamed-never-created")}
          </>
        }
        action={
          <Button
            variant="primary"
            icon="plus"
            onClick={onCreate}
            disabledReason={createDisabledReason}
          >
            {t("ui.wiki-src-views.wiki-create-page-path")}
          </Button>
        }
      />
      <Section
        title={t("ui.wiki-src-views.wiki-nearest-pages")}
        meta={`${nearest.length}`}
      >
        <div className="t-d-cards">
          {nearest.map((n) => (
            <button
              key={n.path}
              type="button"
              className="t-d-pagecard t-interactive"
              onClick={() => onOpen(n.path)}
            >
              <Icon name="file" size={16} />
              <span>{n.title}</span>
              <span className="t-mono t-meta t-wrap">{n.path}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* Many pages, filtered ------------------------------------------------------ */

export type WikiHit = {
  path: string;
  title: string;
  category: string;
  status: WikiStatus;
  /** The front-matter value when `status` is `unknown`. */
  rawStatus?: string;
  /** Who changed the page last; `null` or absent when the host did not measure it. */
  author?: string | null;
  /** Date of the last change (ISO day); `null` or absent when not measured. */
  updatedAt?: string | null;
  words: number;
  /** Sync state with Confluence; `null` or absent when it was not checked. */
  confluence?: ConfluenceSync | null;
};

type WikiHitSort = {
  key: "title" | "category" | "updatedAt" | "words";
  dir: SortDir;
};

function wikiHitSortValue(hit: WikiHit, key: WikiHitSort["key"]): SortValue {
  return key === "words" ? hit.words : hit[key];
}

/** A value the host did not measure: a dash, with the not-measured wording as its title. */
function WikiUnmeasured() {
  const { t } = useText();
  return (
    <span
      className="t-muted"
      title={t("ui.wiki-src-views.wiki-not-measured")}
      data-testid="wiki-hit-unmeasured"
    >
      —
    </span>
  );
}

export type WikiHitsProps = {
  query: string;
  total: number;
  hits: WikiHit[];
  hitCount: number;
  page: number;
  pageSize: number;
  byCategory: { key: string; label: string; value: number; active?: boolean }[];
  mobile?: boolean;
  /** Initial table order; the header toggles it. Unmeasured values sort last either way. */
  sort?: WikiHitSort;
  onPage?: (p: number) => void;
  onOpen?: (path: string) => void;
  onCategory?: (key: string) => void;
};

export function WikiHits({
  query,
  total,
  hits,
  hitCount,
  page,
  pageSize,
  byCategory,
  mobile,
  sort: initialSort = { key: "updatedAt", dir: "desc" },
  onPage = noop,
  onOpen = noop,
  onCategory = noop,
}: WikiHitsProps) {
  const { t, plural, number } = useText();
  const [sort, setSort] = useState<WikiHitSort>(initialSort);
  const ordered = sortRows(
    hits,
    (h) => wikiHitSortValue(h, sort.key),
    sort.dir,
  );
  const toggleSort = (key: string) =>
    setSort((s) =>
      s.key === key
        ? { key: s.key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: key as WikiHitSort["key"], dir: "asc" },
    );
  return (
    <section
      className="t-stack"
      style={{ gap: 16 }}
      aria-label={t("ui.wiki-src-views.wiki-matches")}
    >
      <PluginHead
        icon="search"
        title={t("ui.wiki-src-views.wiki-query", { query })}
        count={t("ui.wiki-src-views.wiki-hits-total", {
          hits: hitCount,
          total,
        })}
        sentence={plural(
          "ui.wiki-src-views.wiki-count-pages-name-query-their-title",
          hitCount,
          {
            query,
          },
        )}
      />
      <Distribution
        label={t("ui.wiki-src-views.wiki-matches-category")}
        parts={byCategory}
        onPick={onCategory}
      />
      {mobile ? (
        <ul className="t-d-cardlist">
          {ordered.map((h) => (
            <li key={h.path}>
              <button
                type="button"
                className="t-d-mcard"
                onClick={() => onOpen(h.path)}
              >
                <span className="t-row t-row--between">
                  <strong className="t-wrap">{h.title}</strong>
                  <WikiStatusBadge status={h.status} raw={h.rawStatus} />
                </span>
                <span className="t-mono t-meta t-wrap">{h.path}</span>
                <span className="t-meta">
                  {h.category} · {h.author ?? <WikiUnmeasured />} ·{" "}
                  {h.updatedAt ?? <WikiUnmeasured />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <DataTable<WikiHit>
          label={t("ui.wiki-src-views.wiki-wiki-pages")}
          rows={ordered}
          rowKey={(r) => r.path}
          onRowClick={(r) => onOpen(r.path)}
          sort={sort}
          onSort={toggleSort}
          columns={[
            {
              key: "title",
              label: t("ui.wiki-src-views.wiki-page-label"),
              sortable: true,
              render: (r) => (
                <span className="t-stack" style={{ gap: 0 }}>
                  <span>{r.title}</span>
                  <span className="t-mono t-meta">{r.path}</span>
                </span>
              ),
            },
            {
              key: "category",
              label: t("ui.wiki-src-views.wiki-category"),
              sortable: true,
              render: (r) => r.category,
            },
            {
              key: "status",
              label: "Status",
              render: (r) => (
                <WikiStatusBadge status={r.status} raw={r.rawStatus} />
              ),
            },
            {
              key: "confluence",
              label: "Confluence",
              render: (r) =>
                r.confluence ? (
                  <SyncBadge sync={r.confluence} />
                ) : (
                  <WikiUnmeasured />
                ),
            },
            {
              key: "author",
              label: t("ui.wiki-src-views.wiki-last"),
              render: (r) => r.author ?? <WikiUnmeasured />,
            },
            {
              key: "updatedAt",
              label: t("ui.wiki-src-views.wiki-changed-label"),
              sortable: true,
              render: (r) =>
                r.updatedAt == null ? (
                  <WikiUnmeasured />
                ) : (
                  <span className="t-mono">{r.updatedAt}</span>
                ),
            },
            {
              key: "words",
              label: t("ui.wiki-src-views.wiki-words"),
              numeric: true,
              sortable: true,
              render: (r) => number(r.words),
            },
          ]}
        />
      )}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={hitCount}
        compact={mobile}
        onPage={onPage}
      />
    </section>
  );
}

/* Confluence --------------------------------------------------------------- */

export type CheckState = "ok" | "failed" | "running" | "todo";

export type ConfluenceSetupProps = {
  baseUrl: string;
  baseUrlError?: string;
  space: string;
  spaces: { key: string; name: string; pages: number }[];
  tokenVar: string;
  tokenFound: boolean;
  direction: "to Confluence" | "from Confluence" | "both directions";
  importAsPr: boolean;
  checks: { key: string; label: string; state: CheckState; detail?: string }[];
  mobile?: boolean;
  onChange?: (field: string, value: string) => void;
  onImportAsPr?: (on: boolean) => void;
  onCheck?: () => void;
  onSave?: () => void;
};

export function ConfluenceSetup({
  baseUrl,
  baseUrlError,
  space,
  spaces,
  tokenVar,
  tokenFound,
  direction,
  importAsPr,
  checks,
  onChange = noop,
  onImportAsPr = noop,
  onCheck = noop,
  onSave = noop,
}: ConfluenceSetupProps) {
  const { t, plural } = useText();
  const allOk = checks.every((c) => c.state === "ok");
  return (
    <section
      className="t-d-form t-anim-rise"
      aria-label={t("ui.wiki-src-views.wiki-set-up-confluence")}
    >
      <PluginHead
        icon="globe"
        title={t("ui.wiki-src-views.wiki-set-up-confluence")}
        sentence={t(
          "ui.wiki-src-views.wiki-one-space-one-token-environment-one",
        )}
      />
      <div className="t-d-form__grid">
        <Field
          label={t("ui.wiki-src-views.wiki-base-url")}
          error={baseUrlError}
          hint={t("ui.wiki-src-views.wiki-e-g-https-company-atlassian-net")}
        >
          {(id) => (
            <input
              id={id}
              className="t-input t-mono"
              value={baseUrl}
              aria-invalid={!!baseUrlError}
              onChange={(e) => onChange("baseUrl", e.target.value)}
            />
          )}
        </Field>
        <div className="t-field">
          <span className="t-field__label">
            {t("ui.wiki-src-views.wiki-token-environment")}
          </span>
          <div className="t-d-token" data-found={tokenFound}>
            <Icon name={tokenFound ? "lock" : "warning"} size={14} />
            <span className="t-mono">{tokenVar}</span>
            <span className="t-spacer" />
            <span className="t-meta">
              {tokenFound
                ? t("ui.wiki-src-views.wiki-set-never-shown")
                : t("ui.wiki-src-views.wiki-not-set")}
            </span>
          </div>
        </div>
        <div className="t-field t-d-form__wide">
          <span className="t-field__label">
            {t("ui.wiki-src-views.wiki-space")}
          </span>
          <div
            className="t-d-spaces"
            role="radiogroup"
            aria-label={t("ui.wiki-src-views.wiki-space")}
          >
            {spaces.map((s) => (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={s.key === space}
                className="t-d-space"
                onClick={() => onChange("space", s.key)}
              >
                <span className="t-mono t-d-space__key">{s.key}</span>
                <span className="t-wrap">{s.name}</span>
                <span className="t-meta">
                  {plural("ui.wiki-src-views.wiki-count-pages", s.pages)}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="t-field t-d-form__wide">
          <span className="t-field__label">
            {t("ui.wiki-src-views.wiki-direction")}
          </span>
          <Segment<ConfluenceSetupProps["direction"]>
            label={t("ui.wiki-src-views.wiki-direction")}
            value={direction}
            onChange={(v) => onChange("direction", v)}
            options={[
              { value: "to Confluence", label: "Atlas → Confluence" },
              { value: "from Confluence", label: "Confluence → Atlas" },
              {
                value: "both directions",
                label: t("ui.wiki-src-views.wiki-both"),
              },
            ]}
          />
          <Switch
            checked={importAsPr}
            label={t(
              "ui.wiki-src-views.wiki-import-pull-request-instead-directly",
            )}
            onChange={onImportAsPr}
          />
        </div>
      </div>
      <Section
        title={t("ui.wiki-src-views.wiki-check")}
        actions={
          <Button size="small" icon="refresh" onClick={onCheck}>
            {t("ui.wiki-src-views.wiki-check-now")}
          </Button>
        }
      >
        <ul
          className="t-d-checks"
          aria-label={t("ui.wiki-src-views.wiki-check-result")}
        >
          {checks.map((c) => (
            <li key={c.key} data-state={c.state}>
              <span className="t-d-checks__mark" aria-hidden="true">
                <Icon
                  name={
                    c.state === "ok"
                      ? "check"
                      : c.state === "failed"
                        ? "close"
                        : c.state === "running"
                          ? "refresh"
                          : "minus"
                  }
                  size={12}
                />
              </span>
              <span>{c.label}</span>
              <span className="t-spacer" />
              <span className="t-meta">
                {c.detail ??
                  (c.state === "todo"
                    ? t("ui.wiki-src-views.wiki-not-checked-yet")
                    : "")}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <footer className="t-d-form__foot">
        <span className="t-meta">
          {t("ui.wiki-src-views.wiki-saved")}
          <span className="t-mono">.facetrc.yaml</span> →{" "}
          <span className="t-mono">wiki.confluence</span>
        </span>
        <span className="t-spacer" />
        <Button
          variant="primary"
          icon="check"
          disabled={!allOk}
          onClick={onSave}
        >
          {t("ui.wiki-src-views.wiki-save-connection")}
        </Button>
      </footer>
    </section>
  );
}

export type ConfluenceMatch = {
  remote: { id: string; title: string; space: string; updatedAt: string };
  local?: { path: string; title: string };
  how: "automatic" | "manual" | "missing" | "ambiguous";
  candidates?: number;
};

export type ConfluenceMappingProps = {
  matches: ConfluenceMatch[];
  counts: {
    automatic: number;
    manual: number;
    missing: number;
    ambiguous: number;
  };
  filter: ConfluenceMatch["how"] | "all";
  page: number;
  pageSize: number;
  total: number;
  mobile?: boolean;
  onFilter?: (f: ConfluenceMatch["how"] | "all") => void;
  onAssign?: (remoteId: string) => void;
  onPage?: (p: number) => void;
};

const HOW_KEY: Record<ConfluenceMatch["how"] | "all", TextKey> = {
  all: "ui.wiki-src-views.wiki-all",
  automatic: "ui.wiki-src-views.wiki-automatic",
  manual: "ui.wiki-src-views.wiki-manual",
  missing: "ui.wiki-src-views.wiki-missing",
  ambiguous: "ui.wiki-src-views.wiki-ambiguous",
};

const HOW_TONE: Record<ConfluenceMatch["how"], Tone> = {
  automatic: "ok",
  manual: "signal",
  missing: "warn",
  ambiguous: "plan",
};

export function ConfluenceMapping({
  matches,
  counts,
  filter,
  page,
  pageSize,
  total,
  mobile,
  onFilter = noop,
  onAssign = noop,
  onPage = noop,
}: ConfluenceMappingProps) {
  const { t, plural, number } = useText();
  const keys = ["all", "automatic", "manual", "ambiguous", "missing"] as const;
  return (
    <section
      className="t-stack t-anim-rise"
      style={{ gap: 16 }}
      aria-label={t("ui.wiki-src-views.wiki-confluence-mapping")}
    >
      <PluginHead
        icon="link"
        title={t("ui.wiki-src-views.wiki-mapping")}
        count={plural("ui.wiki-src-views.wiki-count-pages", total)}
        sentence={t(
          "ui.wiki-src-views.wiki-missing-confluence-pages-have-no-wiki",
          {
            missing: counts.missing,
            ambiguous: counts.ambiguous,
          },
        )}
      />
      <div
        className="t-row t-row--wrap"
        role="toolbar"
        aria-label={t("ui.wiki-src-views.wiki-filter-mapping")}
      >
        {keys.map((k) => (
          <Chip
            key={k}
            pressed={filter === k}
            count={k === "all" ? number(total) : number(counts[k])}
            onClick={() => onFilter(k)}
          >
            {t(HOW_KEY[k])}
          </Chip>
        ))}
      </div>
      <ul className="t-d-maplist">
        {matches.map((m) => (
          <li
            key={m.remote.id}
            className="t-d-map"
            data-mobile={mobile || undefined}
          >
            <div className="t-d-map__side">
              <span className="t-row" style={{ gap: 6 }}>
                <Icon name="globe" size={14} />
                <span className="t-wrap">{m.remote.title}</span>
              </span>
              <span className="t-meta t-mono">
                {m.remote.space} · {m.remote.id} · {m.remote.updatedAt}
              </span>
            </div>
            <span className="t-d-map__link" data-how={m.how} aria-hidden="true">
              <Icon name={m.how === "missing" ? "minus" : "link"} size={14} />
            </span>
            <div className="t-d-map__side">
              {m.local ? (
                <>
                  <span className="t-row" style={{ gap: 6 }}>
                    <Icon name="file" size={14} />
                    <span className="t-wrap">{m.local.title}</span>
                  </span>
                  <span className="t-meta t-mono t-wrap">{m.local.path}</span>
                </>
              ) : (
                <span className="t-meta">
                  {m.how === "ambiguous"
                    ? t("ui.wiki-src-views.wiki-count-candidates", {
                        count: m.candidates ?? 0,
                      })
                    : t("ui.wiki-src-views.wiki-no-wiki-page")}
                </span>
              )}
            </div>
            <Badge tone={HOW_TONE[m.how]}>{t(HOW_KEY[m.how])}</Badge>
            <Button
              size="small"
              variant={
                m.how === "missing" || m.how === "ambiguous"
                  ? "primary"
                  : "quiet"
              }
              onClick={() => onAssign(m.remote.id)}
            >
              {m.how === "missing"
                ? t("ui.wiki-src-views.wiki-assign")
                : m.how === "ambiguous"
                  ? t("ui.wiki-src-views.wiki-choose")
                  : t("ui.wiki-src-views.wiki-change")}
            </Button>
          </li>
        ))}
      </ul>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={filter === "all" ? total : counts[filter]}
        compact={mobile}
        onPage={onPage}
      />
    </section>
  );
}

export type ConfluenceStatusProps = {
  lastRun: string;
  counts: Record<ConfluenceSync, number>;
  conflicts: {
    path: string;
    title: string;
    local: string;
    remote: string;
    localBy: string;
    remoteBy: string;
  }[];
  /** Pages synchronised per day, last 30 days. */
  daily: number[];
  running?: boolean;
  onSync?: () => void;
  onResolve?: (path: string, keep: "atlas" | "confluence") => void;
  onCompare?: (path: string) => void;
};

export function ConfluenceStatus({
  lastRun,
  counts,
  conflicts,
  daily,
  running,
  onSync = noop,
  onResolve = noop,
  onCompare = noop,
}: ConfluenceStatusProps) {
  const { t, number } = useText();
  const labels = useWikiLabels();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const tones: Record<ConfluenceSync, string> = {
    synced: "var(--t-ok)",
    "local-newer": "var(--t-signal)",
    "remote-newer": "var(--t-plan)",
    disconnected: "var(--t-faint)",
    conflict: "var(--t-bad)",
  };
  return (
    <section
      className="t-stack t-anim-rise"
      style={{ gap: 20 }}
      aria-label={t("ui.wiki-src-views.wiki-confluence-state")}
    >
      <div className="t-d-statushead">
        <div className="t-stack" style={{ gap: 4 }}>
          <span className="t-eyebrow">
            {t("ui.wiki-src-views.wiki-sync-confluence")}
          </span>
          <span className="t-hero-number t-ok" data-testid="sync-figure">
            {number(counts.synced)}
            <small> / {number(total)}</small>
          </span>
          <p className="t-hero-sentence" style={{ fontSize: 20 }}>
            {t(
              "ui.wiki-src-views.wiki-pages-sync-conflicts-conflicts-wait-decision",
              {
                conflicts: counts.conflict,
              },
            )}
          </p>
          <span className="t-meta">
            {t("ui.wiki-src-views.wiki-last-run-when", { when: lastRun })}
          </span>
        </div>
        <div className="t-stack" style={{ gap: 8, alignItems: "flex-end" }}>
          <Bars
            values={daily}
            label={t("ui.wiki-src-views.wiki-synced-pages-per-day-30-days")}
            tone="ok"
          />
          <Button
            variant="primary"
            icon="refresh"
            onClick={onSync}
            disabled={running}
          >
            {running
              ? t("ui.wiki-src-views.wiki-syncing")
              : t("ui.wiki-src-views.wiki-sync-now")}
          </Button>
        </div>
      </div>
      <Distribution
        label={t("ui.wiki-src-views.wiki-pages-sync-state")}
        parts={(Object.keys(counts) as ConfluenceSync[]).map((k) => ({
          key: k,
          label: labels.sync(k),
          value: counts[k],
          tone: tones[k],
        }))}
      />
      <Section
        title={t("ui.wiki-src-views.wiki-conflicts")}
        meta={`${conflicts.length}`}
      >
        <ul className="t-d-conflicts">
          {conflicts.map((c) => (
            <li key={c.path} className="t-d-conflict">
              <div className="t-stack" style={{ gap: 2, minWidth: 0 }}>
                <strong className="t-wrap">{c.title}</strong>
                <span className="t-mono t-meta t-wrap">{c.path}</span>
              </div>
              <div className="t-d-conflict__sides">
                <span>
                  <span className="t-label">Atlas</span> {c.local} · {c.localBy}
                </span>
                <span>
                  <span className="t-label">Confluence</span> {c.remote} ·{" "}
                  {c.remoteBy}
                </span>
              </div>
              <div className="t-row t-row--wrap">
                <Button
                  size="small"
                  variant="quiet"
                  icon="eye"
                  onClick={() => onCompare(c.path)}
                >
                  {t("ui.wiki-src-views.wiki-compare")}
                </Button>
                <Button size="small" onClick={() => onResolve(c.path, "atlas")}>
                  {t("ui.wiki-src-views.wiki-keep-atlas")}
                </Button>
                <Button
                  size="small"
                  onClick={() => onResolve(c.path, "confluence")}
                >
                  {t("ui.wiki-src-views.wiki-take-confluence")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </section>
  );
}
