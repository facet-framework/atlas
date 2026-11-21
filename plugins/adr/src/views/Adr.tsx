import {
  Icon,
  Badge,
  Button,
  Chip,
  Dot,
  Field,
  IconButton,
  type Tone,
  Distribution,
  EmptyState,
  Collection,
  CollectionToolbar,
  DataTable,
  Pagination,
  type CollectionState,
  Sheet,
} from "@facet-tools/ui";
import { useText } from "../../../../frontend/src/plugin/components";
import type { TextKey } from "../../../../frontend/src/plugin/components";
import {
  Facts,
  Inline,
  Markdown,
  PluginHead,
  noop,
  useLifecycleLabel,
} from "../../../../frontend/src/plugin/components";
import { sharePercent } from "../../../../frontend/src/plugin/share";

/** Above this many words an ADR's H1 and H2 sections fold. */
export const ADR_FOLD_WORDS = 500;

export type AdrStatus =
  "proposed" | "accepted" | "superseded" | "rejected" | "unknown";

export const ADR_STATUSES: AdrStatus[] = [
  "proposed",
  "accepted",
  "superseded",
  "rejected",
  "unknown",
];
const TONE: Record<AdrStatus, Tone> = {
  proposed: "plan",
  accepted: "ok",
  superseded: "neutral",
  rejected: "bad",
  unknown: "warn",
};
const COLOR: Record<AdrStatus, string> = {
  proposed: "var(--t-plan)",
  accepted: "var(--t-ok)",
  superseded: "var(--t-faint)",
  rejected: "var(--t-bad)",
  unknown: "var(--t-warn)",
};

/** Dictionary key of each status; the ids stay as stored in the ADR header. */
const STATUS_KEY: Record<AdrStatus, TextKey> = {
  proposed: "ui.adr-src-views.adr-proposed",
  accepted: "ui.adr-src-views.adr-accepted",
  superseded: "ui.adr-src-views.adr-superseded",
  rejected: "ui.adr-src-views.adr-rejected",
  unknown: "ui.adr-src-views.adr-unknown",
};

/** The visible name of a status in the active language. */
export function useAdrStatusLabel() {
  const { t } = useText();
  return (s: AdrStatus) => t(STATUS_KEY[s]);
}

export function AdrStatusBadge({ status }: { status: AdrStatus }) {
  const label = useAdrStatusLabel();
  return <Badge tone={TONE[status]}>{label(status)}</Badge>;
}

/** Authors of a decision. Unknown (`null`) shows a dash and says so; an empty
 * list says that the decision names nobody — the two are different findings. */

export function AdrAuthors({ authors }: { authors: string[] | null }) {
  const { t } = useText();
  if (authors == null)
    return (
      <span
        className="t-muted"
        title={t("ui.adr-src-views.adr-authors-unknown")}
        data-testid="adr-authors-unknown"
      >
        —
      </span>
    );
  if (!authors.length)
    return (
      <span className="t-muted" data-testid="adr-authors-none">
        {t("ui.adr-src-views.adr-no-author-named")}
      </span>
    );
  return <span>{authors.join(", ")}</span>;
}

export type AdrItem = {
  number: number;
  title: string;
  status: AdrStatus;
  date: string;
  /** `null` = the file names no author field (unknown); `[]` = it names none. */
  authors: string[] | null;
  area: string;
  supersededBy?: number;
  refs: number;
  file: string;
};

export type AdrView = "timeline" | "board" | "table";
export type AdrSortKey =
  "number" | "title" | "status" | "date" | "area" | "authors" | "refs" | "sup";

/** Cards a board column shows before it links to the filtered list. */
export const BOARD_CAP = 12;

export type AdrCollectionProps = {
  state: CollectionState;
  view: AdrView;
  items: AdrItem[];
  total: number;
  counts: Record<AdrStatus, number>;
  page: number;
  pageSize: number;
  query: string;
  activeStatus?: AdrStatus | null;
  directory: string;
  /** Table sort; the rows arrive already sorted this way. */
  sort?: { key: AdrSortKey; dir: "asc" | "desc" };
  mobile?: boolean;
  onSort?: (key: AdrSortKey) => void;
  onView?: (v: AdrView) => void;
  onQuery?: (q: string) => void;
  onStatus?: (s: string) => void;
  onPage?: (p: number) => void;
  onPageSize?: (n: number) => void;
  /** The number, and the file: two decisions may share a number, never a file. */
  onOpen?: (n: number, file: string) => void;
  onCreate?: () => void;
  onSettings?: () => void;
  onReset?: () => void;
};

const pad = (n: number) => String(n).padStart(4, "0");

function AdrCard({
  a,
  onOpen,
}: {
  a: AdrItem;
  onOpen: (n: number, file: string) => void;
}) {
  const { plural } = useText();
  return (
    <button
      type="button"
      className="t-d-adrcard t-interactive"
      onClick={() => onOpen(a.number, a.file)}
    >
      <span className="t-row t-row--between">
        <span className="t-mono t-meta">ADR {pad(a.number)}</span>
        <span className="t-mono t-meta">{a.date}</span>
      </span>
      <span className="t-d-adrcard__title t-clamp-2">{a.title}</span>
      <span className="t-row t-row--wrap t-meta" style={{ gap: 8 }}>
        <span className="t-mono t-wrap">{a.area}</span>
        <span>{plural("ui.adr-src-views.adr-count-records", a.refs)}</span>
        {a.supersededBy ? <span>· → {pad(a.supersededBy)}</span> : null}
      </span>
    </button>
  );
}

/** ADRs on a time axis, grouped by year. The axis is time, so the rows are ordered by date
 * whatever column the table is sorted by; only the direction follows the chosen sort. Grouping
 * in arrival order put a year's dates out of order and repeated years when the rows came
 * sorted by number or title. */

function Timeline({
  items,
  dir,
  onOpen,
}: {
  items: AdrItem[];
  dir: "asc" | "desc";
  onOpen: (n: number, file: string) => void;
}) {
  const sign = dir === "asc" ? 1 : -1;
  const chronological = [...items].sort(
    (a, b) => (a.date.localeCompare(b.date) || a.number - b.number) * sign,
  );
  const years = new Map<string, AdrItem[]>();
  for (const a of chronological) {
    const y = a.date.slice(0, 4);
    years.set(y, [...(years.get(y) ?? []), a]);
  }
  const { t } = useText();
  return (
    <div
      className="t-d-adrtime"
      aria-label={t("ui.adr-src-views.adr-timeline")}
    >
      {[...years.entries()].map(([year, list]) => (
        <section key={year} className="t-d-adrtime__year">
          <h3 className="t-d-adrtime__label">
            {year} <span className="t-meta">{list.length}</span>
          </h3>
          <ol className="t-d-adrtime__list t-stagger">
            {list.map((a) => (
              <li
                key={a.file}
                className="t-d-adrtime__item"
                data-status={a.status}
                data-testid="adr-time-item"
              >
                <span
                  className="t-d-adrtime__node"
                  style={{ background: COLOR[a.status] }}
                  aria-hidden="true"
                />
                <span className="t-mono t-meta t-d-adrtime__date">
                  {a.date.slice(5)}
                </span>
                <button
                  type="button"
                  className="t-d-adrtime__body"
                  onClick={() => onOpen(a.number, a.file)}
                >
                  <span className="t-row" style={{ gap: 8 }}>
                    <span className="t-mono t-meta">{pad(a.number)}</span>
                    <span className="t-wrap">{a.title}</span>
                  </span>
                  <span className="t-row t-meta" style={{ gap: 8 }}>
                    <AdrStatusBadge status={a.status} />
                    <AdrAuthors authors={a.authors} />
                    <span className="t-mono t-wrap">{a.area}</span>
                    {a.supersededBy ? (
                      <span>
                        {t("ui.adr-src-views.adr-superseded-number", {
                          number: pad(a.supersededBy),
                        })}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Board({
  items,
  counts,
  onOpen,
  onMore,
}: {
  items: AdrItem[];
  counts: Record<AdrStatus, number>;
  onOpen: (n: number, file: string) => void;
  onMore: (s: AdrStatus) => void;
}) {
  const { t, number } = useText();
  const label = useAdrStatusLabel();
  return (
    <div className="t-d-board" aria-label="Board">
      {ADR_STATUSES.map((s) => {
        const col = items
          .filter((a) => a.status === s)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, BOARD_CAP);
        const rest = counts[s] - col.length;
        return (
          <section key={s} className="t-d-board__col" aria-label={label(s)}>
            <header className="t-row t-row--between">
              <span className="t-row" style={{ gap: 6 }}>
                <span className="t-dot" style={{ background: COLOR[s] }} />
                <span className="t-label">{label(s)}</span>
              </span>
              <span className="t-mono t-meta">{number(counts[s])}</span>
            </header>
            <div className="t-stack t-stagger" style={{ gap: 8 }}>
              {col.map((a) => (
                <AdrCard key={a.file} a={a} onOpen={onOpen} />
              ))}
            </div>
            {rest > 0 ? (
              <Button
                size="small"
                variant="quiet"
                icon="forward"
                onClick={() => onMore(s)}
              >
                {t("ui.adr-src-views.adr-count-more", { count: rest })}
              </Button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** Sort labels; `null` means a technical term that reads the same in every language. */
const SORT_KEY: Record<AdrSortKey, TextKey | null> = {
  number: "ui.adr-src-views.adr-no",
  title: "ui.adr-src-views.adr-title",
  status: null,
  date: "ui.adr-src-views.adr-date",
  area: "ui.adr-src-views.adr-area",
  authors: "ui.adr-src-views.adr-authors",
  refs: null,
  sup: "ui.adr-src-views.adr-superseded-by",
};
const SORT_FIXED: Partial<Record<AdrSortKey, string>> = {
  status: "Status",
  refs: "Records",
};

export function AdrCollection({
  state,
  view,
  items,
  total,
  counts,
  page,
  pageSize,
  query,
  activeStatus,
  directory,
  sort = { key: "number", dir: "desc" },
  mobile,
  onSort = noop,
  onView = noop,
  onQuery = noop,
  onStatus = noop,
  onPage = noop,
  onPageSize = noop,
  onOpen = noop,
  onCreate,
  onSettings = noop,
  onReset = noop,
}: AdrCollectionProps) {
  const { t, plural, number } = useText();
  const statusLabel = useAdrStatusLabel();
  const sortKey = SORT_KEY[sort.key];
  const sortLabel = sortKey ? t(sortKey) : (SORT_FIXED[sort.key] ?? sort.key);
  const shown = activeStatus ? counts[activeStatus] : total;
  const accepted = total
    ? t("ui.adr-src-views.adr-value", {
        value: sharePercent(counts.accepted, total) ?? 0,
      })
    : "—";
  return (
    <div className="t-page t-stack" style={{ gap: 20 }}>
      <PluginHead
        icon="scales"
        title={t("ui.adr-src-views.adr-decisions")}
        count={state === "loading" ? "—" : number(total)}
        meta={<span className="t-mono">{directory}</span>}
        sentence={
          state === "loading"
            ? t("ui.adr-src-views.adr-reading-decisions")
            : total
              ? plural(
                  "ui.adr-src-views.adr-share-accepted-count-waiting-decision",
                  counts.proposed,
                  {
                    share: accepted,
                  },
                )
              : t("ui.adr-src-views.adr-accepted-nothing-measured-yet")
        }
        actions={
          <>
            {mobile ? (
              <IconButton
                icon="settings"
                label={t("ui.adr-src-views.adr-directory")}
                onClick={onSettings}
              />
            ) : (
              <Button variant="quiet" icon="settings" onClick={onSettings}>
                {t("ui.adr-src-views.adr-directory")}
              </Button>
            )}
            {onCreate ? (
              <Button variant="primary" icon="plus" onClick={onCreate}>
                {t("ui.adr-src-views.adr-new-decision")}
              </Button>
            ) : null}
          </>
        }
      />
      <Collection
        state={state}
        toolbar={
          <CollectionToolbar<AdrView>
            query={query}
            queryLabel={t("ui.adr-src-views.adr-search-decisions")}
            placeholder={t("ui.adr-src-views.adr-title-number-author")}
            facets={ADR_STATUSES.map((s) => ({
              key: s,
              label: statusLabel(s),
              count: counts[s],
              active: activeStatus === s,
            }))}
            views={[
              {
                value: "timeline",
                label: t("ui.adr-src-views.adr-timeline"),
                icon: "timeline",
              },
              { value: "board", label: "Board", icon: "board" },
              {
                value: "table",
                label: t("ui.adr-src-views.adr-table"),
                icon: "table",
              },
            ]}
            view={view}
            sortLabel={
              view === "table"
                ? `${sortLabel} ${sort.dir === "asc" ? "▲" : "▼"}`
                : t("ui.adr-src-views.adr-newest-first")
            }
            onQuery={onQuery}
            onFacet={onStatus}
            onView={onView}
            onReset={onReset}
          />
        }
        distribution={
          state === "ready" ? (
            <Distribution
              label={t("ui.adr-src-views.adr-decisions-status")}
              parts={ADR_STATUSES.map((s) => ({
                key: s,
                label: statusLabel(s),
                value: counts[s],
                tone: COLOR[s],
                active: activeStatus === s,
              }))}
              onPick={onStatus}
            />
          ) : null
        }
        empty={{
          icon: "scales",
          title: t("ui.adr-src-views.adr-no-decision-yet"),
          body: (
            <>
              {t("ui.adr-src-views.adr-there-no-markdown-file-adr-header")}
              <span className="t-mono">{directory}</span>
              {t("ui.adr-src-views.adr-label")}
            </>
          ),
          action: onCreate ? (
            <>
              <Button variant="primary" icon="plus" onClick={onCreate}>
                {t("ui.adr-src-views.adr-create-first-decision")}
              </Button>
              <Button icon="folder" onClick={onSettings}>
                {t("ui.adr-src-views.adr-another-directory")}
              </Button>
            </>
          ) : undefined,
        }}
        filteredEmpty={{ query, onReset }}
        error={{
          title: t("ui.adr-src-views.adr-directory-not-readable"),
          reason: directory,
          onRetry: onReset,
        }}
        pagination={
          view === "board" ? null : (
            <Pagination
              page={page}
              pageSize={pageSize}
              pageSizes={[30, 60, 120]}
              total={shown}
              compact={mobile}
              onPage={onPage}
              onPageSize={onPageSize}
            />
          )
        }
      >
        {view === "timeline" ? (
          <Timeline items={items} dir={sort.dir} onOpen={onOpen} />
        ) : null}
        {view === "board" ? (
          <Board
            items={items}
            counts={counts}
            onOpen={onOpen}
            onMore={onStatus}
          />
        ) : null}
        {view === "table" && mobile ? (
          <ul className="t-d-cardlist">
            {items.map((a) => (
              <li key={a.file}>
                <AdrCard a={a} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        ) : null}
        {view === "table" && !mobile ? (
          <DataTable<AdrItem>
            label={t("ui.adr-src-views.adr-decisions")}
            rows={items}
            rowKey={(a) => a.file}
            sort={sort}
            onSort={(k) => onSort(k as AdrSortKey)}
            onRowClick={(a) => onOpen(a.number, a.file)}
            columns={[
              {
                key: "number",
                label: t("ui.adr-src-views.adr-no"),
                sortable: true,
                width: 72,
                render: (a) => <span className="t-mono">{pad(a.number)}</span>,
              },
              {
                key: "title",
                label: t("ui.adr-src-views.adr-title"),
                sortable: true,
                render: (a) => a.title,
              },
              {
                key: "status",
                label: "Status",
                sortable: true,
                render: (a) => <AdrStatusBadge status={a.status} />,
              },
              {
                key: "date",
                label: t("ui.adr-src-views.adr-date"),
                sortable: true,
                render: (a) => <span className="t-mono">{a.date}</span>,
              },
              {
                key: "area",
                label: t("ui.adr-src-views.adr-area"),
                sortable: true,
                render: (a) => <span className="t-mono t-wrap">{a.area}</span>,
              },
              {
                key: "authors",
                label: t("ui.adr-src-views.adr-authors"),
                sortable: true,
                render: (a) => <AdrAuthors authors={a.authors} />,
              },
              {
                key: "refs",
                label: "Records",
                numeric: true,
                sortable: true,
                render: (a) => a.refs,
              },
              {
                key: "sup",
                label: t("ui.adr-src-views.adr-superseded-by"),
                sortable: true,
                render: (a) =>
                  a.supersededBy ? (
                    <span className="t-mono">{pad(a.supersededBy)}</span>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        ) : null}
      </Collection>
    </div>
  );
}

/** Reader ------------------------------------------------------------------- */

export type AdrDetail = {
  number: number;
  title: string;
  status: AdrStatus;
  rawStatus: string;
  date: string;
  file: string;
  /** `null` = unknown; `[]` = the ADR names no author. */
  authors: string[] | null;
  supersedes?: { number: number; title: string };
  supersededBy?: { number: number; title: string };
};

export type AdrReaderProps = {
  adr: AdrDetail;
  /** The text below the header lines; what `facts` holds is not repeated in it. */
  markdown: string;
  /** The ADR's own header lines (`**Concerns:** …`) beyond status and date, as written. */
  facts?: [string, string][];
  /** The heading id the address names (`#…`); its section opens. */
  anchor?: string | null;
  toc: { id: string; label: string }[];
  records: { id: string; summary: string; lifecycle: string }[];
  /** The supersession chain this ADR belongs to, oldest first; shown from two links on. */
  chain?: { number: number; title: string; status: AdrStatus; date: string }[];
  /** Readable? `false` shows the file error instead of the text. */
  readable?: boolean;
  mobile?: boolean;
  onBack?: () => void;
  onOpenRecord?: (id: string) => void;
  onLink?: (href: string) => void;
  onCopyCode?: (code: string) => void;
};

export function AdrReader({
  adr,
  markdown,
  facts = [],
  anchor = null,
  toc,
  records,
  readable = true,
  chain = [],
  mobile,
  onBack = noop,
  onOpenRecord = noop,
  onLink = noop,
  onCopyCode = noop,
}: AdrReaderProps) {
  const { t, plural } = useText();
  const lifecycleLabel = useLifecycleLabel();
  const fold = markdown.split(/\s+/).filter(Boolean).length > ADR_FOLD_WORDS;
  return (
    <article className="t-page t-d-adr t-anim-focus" aria-label={adr.title}>
      <Button variant="quiet" size="small" icon="back" onClick={onBack}>
        {t("ui.adr-src-views.adr-decisions")}
      </Button>
      <header className="t-d-adr__head">
        <span className="t-d-adr__num t-mono">{pad(adr.number)}</span>
        <div className="t-stack" style={{ gap: 6, minWidth: 0 }}>
          <h1 className="t-d-article__title">{adr.title}</h1>
          <div className="t-row t-row--wrap" style={{ gap: 8 }}>
            {adr.status === "unknown" ? (
              <span className="t-meta">
                {t("ui.adr-src-views.adr-header-says")}
                <span className="t-mono">{adr.rawStatus}</span>
                {t("ui.adr-src-views.adr-label-adrreader")}
              </span>
            ) : null}
            <span className="t-meta t-d-adr__meta">
              {adr.date} · <AdrAuthors authors={adr.authors} /> ·{" "}
              <span className="t-mono">{adr.file}</span>
            </span>
          </div>
          {facts.length ? (
            <dl className="t-d-adr__front" data-testid="adr-front">
              {facts.map(([k, v], i) => (
                <div key={i} className="t-d-adr__fact">
                  <dt>{k}</dt>
                  <dd>
                    <Inline text={v} onLink={onLink} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="t-row t-row--wrap" style={{ gap: 8 }}>
            {adr.supersedes ? (
              <Chip
                icon="back"
                onClick={() => onLink(`adr:${adr.supersedes?.number}`)}
              >
                {t("ui.adr-src-views.adr-supersedes-number-title", {
                  number: pad(adr.supersedes.number),
                  title: adr.supersedes.title,
                })}
              </Chip>
            ) : null}
            {adr.supersededBy ? (
              <Chip
                icon="forward"
                onClick={() => onLink(`adr:${adr.supersededBy?.number}`)}
              >
                {t("ui.adr-src-views.adr-superseded-number", {
                  number: pad(adr.supersededBy.number),
                })}
              </Chip>
            ) : null}
          </div>
        </div>
        <dl className="t-d-adr__status" data-testid="adr-status">
          <dt>Status:</dt>
          <dd>
            <AdrStatusBadge status={adr.status} />
          </dd>
        </dl>
      </header>
      {mobile ? (
        <nav
          className="t-d-chipbar"
          aria-label={t("ui.adr-src-views.adr-contents")}
        >
          {toc.map((entry) => (
            <Chip key={entry.id} onClick={() => onLink(`#${entry.id}`)}>
              {entry.label}
            </Chip>
          ))}
        </nav>
      ) : null}
      {chain.length > 1 ? (
        <nav
          className="t-d-chain"
          aria-label={t("ui.adr-src-views.adr-supersession-chain")}
        >
          <span className="t-label">
            {t("ui.adr-src-views.adr-supersession-chain-count", {
              count: chain.length,
            })}
          </span>
          <ol className="t-d-chain__list">
            {chain.map((c) => (
              <li
                key={c.number}
                aria-current={c.number === adr.number ? "step" : undefined}
              >
                <button
                  type="button"
                  className="t-d-chain__item"
                  onClick={() => onLink(`adr:${c.number}`)}
                >
                  <span className="t-row" style={{ gap: 8 }}>
                    <span className="t-mono t-meta">{pad(c.number)}</span>
                    <AdrStatusBadge status={c.status} />
                  </span>
                  <span className="t-clamp-2">{c.title}</span>
                  <span className="t-mono t-meta">{c.date}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="t-d-adr__grid">
        {!mobile ? (
          <nav
            className="t-d-toc"
            aria-label={t("ui.adr-src-views.adr-contents")}
          >
            <span className="t-label">
              {t("ui.adr-src-views.adr-contents")}
            </span>
            {toc.map((entry) => (
              <a
                key={entry.id}
                href={`#${entry.id}`}
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
        <div className="t-d-article__body">
          {readable ? (
            <Markdown
              source={markdown}
              onLink={onLink}
              onCopyCode={onCopyCode}
              anchors
              fold={fold}
              openAnchor={anchor}
            />
          ) : (
            <EmptyState
              tone="error"
              icon="error"
              title={t("ui.adr-src-views.adr-file-not-readable")}
              body={
                <>
                  <span className="t-mono">{adr.file}</span>
                  {t("ui.adr-src-views.adr-not-utf-8-has-no-adr")}
                </>
              }
            />
          )}
        </div>
        <aside className="t-stack" style={{ gap: 12 }}>
          <section
            className="t-d-card"
            aria-label={t("ui.adr-src-views.adr-linked-records")}
          >
            <span className="t-label">
              {plural(
                "ui.adr-src-views.adr-names-count-records",
                records.length,
              )}
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
                  {r.summary || t("ui.adr-src-views.adr-no-summary")}
                </span>
                <Badge plain>{lifecycleLabel(r.lifecycle)}</Badge>
              </button>
            ))}
          </section>
          <section
            className="t-d-card"
            aria-label={t("ui.adr-src-views.adr-header")}
          >
            <span className="t-label">{t("ui.adr-src-views.adr-header")}</span>
            <Facts
              rows={[
                [
                  t("ui.adr-src-views.adr-number"),
                  <span key="n" className="t-mono">
                    {pad(adr.number)}
                  </span>,
                ],
                ["Status", adr.rawStatus],
                [t("ui.adr-src-views.adr-date"), adr.date],
                [
                  t("ui.adr-src-views.adr-file"),
                  <span key="f" className="t-mono t-wrap">
                    {adr.file}
                  </span>,
                ],
              ]}
            />
          </section>
        </aside>
      </div>
    </article>
  );
}

/** Status proposal ------------------------------------------------------------ */

export type AdrStatusFormProps = {
  adr: AdrDetail;
  next: AdrStatus;
  reason: string;
  reasonError?: string;
  successor?: number | null;
  successors: { number: number; title: string }[];
  branch: string;
  diff: string;
  mobile?: boolean;
  onNext?: (s: AdrStatus) => void;
  onChange?: (field: string, value: string) => void;
  onSubmit?: () => void;
  onClose?: () => void;
};

export function AdrStatusForm({
  adr,
  next,
  reason,
  reasonError,
  successor,
  successors,
  branch,
  diff,
  mobile,
  onNext = noop,
  onChange = noop,
  onSubmit = noop,
  onClose = noop,
}: AdrStatusFormProps) {
  const { t } = useText();
  const statusLabel = useAdrStatusLabel();
  return (
    <Sheet
      open
      side={mobile ? "bottom" : "right"}
      title={t("ui.adr-src-views.adr-propose-status")}
      meta={`ADR ${pad(adr.number)} · ${adr.title}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t("ui.adr-src-views.adr-cancel")}
          </Button>
          <Button
            variant="primary"
            icon="pr"
            disabled={!!reasonError || next === adr.status}
            onClick={onSubmit}
          >
            {t("ui.adr-src-views.adr-propose-pr")}
          </Button>
        </>
      }
    >
      <div className="t-stack" style={{ gap: 16 }}>
        <div className="t-d-statusflow">
          <AdrStatusBadge status={adr.status} />
          <Icon name="forward" size={14} />
          <AdrStatusBadge status={next} />
        </div>
        <div
          className="t-d-radios"
          role="radiogroup"
          aria-label={t("ui.adr-src-views.adr-new-status")}
        >
          {ADR_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={next === s}
              className="t-d-radio"
              disabled={s === adr.status}
              onClick={() => onNext(s)}
            >
              <span className="t-dot" style={{ background: COLOR[s] }} />
              {statusLabel(s)}
              {s === adr.status ? (
                <span className="t-meta">{t("ui.adr-src-views.adr-now")}</span>
              ) : null}
            </button>
          ))}
        </div>
        {next === "superseded" ? (
          <Field label={t("ui.adr-src-views.adr-superseded-by")}>
            {(id) => (
              <select
                id={id}
                className="t-select"
                value={successor ?? ""}
                onChange={(e) => onChange("successor", e.target.value)}
              >
                <option value="">{t("ui.adr-src-views.adr-choose")}</option>
                {successors.map((s) => (
                  <option key={s.number} value={s.number}>
                    {pad(s.number)} · {s.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <Field
          label={t("ui.adr-src-views.adr-reason")}
          error={reasonError}
          hint={t("ui.adr-src-views.adr-goes-into-pr-text-into-decision")}
        >
          {(id) => (
            <textarea
              id={id}
              className="t-textarea"
              rows={4}
              value={reason}
              aria-invalid={!!reasonError}
              onChange={(e) => onChange("reason", e.target.value)}
            />
          )}
        </Field>
        <Facts
          rows={[
            [
              t("ui.adr-src-views.adr-branch"),
              <span key="b" className="t-mono">
                {branch}
              </span>,
            ],
            [
              t("ui.adr-src-views.adr-file"),
              <span key="f" className="t-mono">
                {adr.file}
              </span>,
            ],
          ]}
        />
        <pre
          className="t-d-codeblock"
          aria-label={t("ui.adr-src-views.adr-change-header")}
        >
          {diff}
        </pre>
      </div>
    </Sheet>
  );
}

/** New ADR -------------------------------------------------------------------- */

export type AdrNewFormProps = {
  number: number;
  title: string;
  titleError?: string;
  context: string;
  decision: string;
  consequences: string;
  records: string[];
  file: string;
  mobile?: boolean;
  onChange?: (field: string, value: string) => void;
  onRemoveRecord?: (id: string) => void;
  onAddRecord?: () => void;
  onSubmit?: () => void;
  onCancel?: () => void;
};

export function AdrNewForm({
  number,
  title,
  titleError,
  context,
  decision,
  consequences,
  records,
  file,
  onChange = noop,
  onRemoveRecord = noop,
  onAddRecord = noop,
  onSubmit = noop,
  onCancel = noop,
}: AdrNewFormProps) {
  const { t } = useText();
  const statusLabel = useAdrStatusLabel();
  const sections: [string, string, string, string][] = [
    [
      "context",
      t("ui.adr-src-views.adr-context"),
      context,
      t("ui.adr-src-views.adr-what-situation-forces-decision"),
    ],
    [
      "decision",
      t("ui.adr-src-views.adr-decision"),
      decision,
      t("ui.adr-src-views.adr-what-holds-now-one-sentence-first"),
    ],
    [
      "consequences",
      t("ui.adr-src-views.adr-consequences"),
      consequences,
      t("ui.adr-src-views.adr-what-gets-easier-what-gets-harder"),
    ],
  ];
  return (
    <form
      className="t-page t-d-form t-anim-rise"
      aria-label={t("ui.adr-src-views.adr-new-decision")}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <PluginHead
        icon="scales"
        title={t("ui.adr-src-views.adr-new-decision")}
        count={`ADR ${pad(number)}`}
        sentence={<span className="t-mono">{file}</span>}
      />
      <Field label={t("ui.adr-src-views.adr-title")} error={titleError}>
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
      <div className="t-d-form__grid">
        <Field label="Status">
          {(id) => (
            <input
              id={id}
              className="t-input"
              value={statusLabel("proposed")}
              readOnly
            />
          )}
        </Field>
        <Field label={t("ui.adr-src-views.adr-date")}>
          {(id) => (
            <input
              id={id}
              className="t-input t-mono"
              value="2026-11-13"
              readOnly
            />
          )}
        </Field>
      </div>
      {sections.map(([key, label, value, hint]) => (
        <Field key={key} label={label} hint={hint}>
          {(id) => (
            <textarea
              id={id}
              className="t-textarea"
              rows={key === "decision" ? 3 : 4}
              value={value}
              onChange={(e) => onChange(key, e.target.value)}
            />
          )}
        </Field>
      ))}
      <div className="t-field">
        <span className="t-field__label">
          {t("ui.adr-src-views.adr-affects-records")}
        </span>
        <div className="t-row t-row--wrap" style={{ gap: 6 }}>
          {records.map((r) => (
            <Chip
              key={r}
              mono
              icon="document"
              onRemove={() => onRemoveRecord(r)}
            >
              {r}
            </Chip>
          ))}
          <Button
            size="small"
            variant="quiet"
            icon="plus"
            onClick={onAddRecord}
          >
            {t("ui.adr-src-views.adr-link-record")}
          </Button>
        </div>
      </div>
      <footer className="t-d-form__foot">
        <span className="t-meta">
          {t(
            "ui.adr-src-views.adr-proposed-branch-pull-request-never-directly",
          )}
        </span>
        <span className="t-spacer" />
        <Button variant="quiet" onClick={onCancel}>
          {t("ui.adr-src-views.adr-cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          icon="pr"
          disabled={!!titleError}
        >
          {t("ui.adr-src-views.adr-propose-draft")}
        </Button>
      </footer>
    </form>
  );
}

/** Directory setting ------------------------------------------------------------ */

export type AdrDirectoryProps = {
  directory: string;
  error?: string;
  found: number | null;
  sample: string[];
  ignored: { file: string; reason: string }[];
  onChange?: (v: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
};

export function AdrDirectorySetting({
  directory,
  error,
  found,
  sample,
  ignored,
  onChange = noop,
  onSave = noop,
  onCancel = noop,
}: AdrDirectoryProps) {
  const { t, plural } = useText();
  return (
    <section
      className="t-page t-d-form t-anim-rise"
      aria-label={t("ui.adr-src-views.adr-set-directory")}
    >
      <PluginHead
        icon="folder"
        title={t("ui.adr-src-views.adr-directory-decisions")}
        sentence={t("ui.adr-src-views.adr-atlas-reads-every-markdown-file-adr")}
      />
      <Field
        label="adr.directory"
        error={error}
        hint={t("ui.adr-src-views.adr-relative-repository-root")}
      >
        {(id) => (
          <input
            id={id}
            className="t-input t-mono"
            value={directory}
            aria-invalid={!!error}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </Field>
      <div className="t-d-card">
        <span className="t-label">{t("ui.adr-src-views.adr-preview")}</span>
        <span className="t-h3" data-testid="adr-found">
          {found == null
            ? "—"
            : plural("ui.adr-src-views.adr-count-decisions-found", found)}
        </span>
        <ul className="t-d-filelist">
          {sample.map((f) => (
            <li key={f} className="t-row">
              <Icon name="file" size={14} />{" "}
              <span className="t-mono t-wrap">{f}</span>
            </li>
          ))}
        </ul>
        {ignored.length ? (
          <>
            <span className="t-label">
              {t("ui.adr-src-views.adr-skipped-count", {
                count: ignored.length,
              })}
            </span>
            <ul className="t-d-filelist">
              {ignored.map((f) => (
                <li key={f.file} className="t-row">
                  <Dot tone="warn" />{" "}
                  <span className="t-mono t-wrap">{f.file}</span>
                  <span className="t-meta">{f.reason}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <pre
        className="t-d-codeblock"
        aria-label=".facetrc.yaml"
      >{`# .facetrc.yaml\nadr:\n  directory: ${directory}`}</pre>
      <footer className="t-d-form__foot">
        <span className="t-spacer" />
        <Button variant="quiet" onClick={onCancel}>
          {t("ui.adr-src-views.adr-cancel")}
        </Button>
        <Button
          variant="primary"
          icon="check"
          disabled={!!error}
          onClick={onSave}
        >
          {t("ui.adr-src-views.adr-apply")}
        </Button>
      </footer>
    </section>
  );
}

/** Empty registry of decisions as its own page, used when the directory itself is missing. */
export function AdrEmpty({
  directory,
  onCreate,
  onSettings = noop,
}: {
  directory: string;
  onCreate?: () => void;
  onSettings?: () => void;
}) {
  return (
    <AdrCollection
      state="empty"
      view="timeline"
      items={[]}
      total={0}
      counts={{
        proposed: 0,
        accepted: 0,
        superseded: 0,
        rejected: 0,
        unknown: 0,
      }}
      page={1}
      pageSize={25}
      query=""
      directory={directory}
      onCreate={onCreate}
      onSettings={onSettings}
    />
  );
}
