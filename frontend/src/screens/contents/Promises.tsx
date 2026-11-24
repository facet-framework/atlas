import {
  Button,
  Chip,
  Collection,
  CollectionToolbar,
  Pagination,
  type Facet,
  Sheet,
  Icon,
  ShareBar,
} from "@facet-tools/ui";

import { useText } from "../text";
import type { TextKey } from "../text";
import { Gwt, KindFrame, MiniStat, RecordRef, capOf, short, splitGwt, stripMd } from "./frame";
import type { PromiseItem, PromiseRecord, PromiseState, ViewDef } from "./model";
import { ratioPercent } from "../../share";

export type PromisesView = "list" | "mosaic" | "open";

export type PromisesPageProps = {
  view: PromisesView;
  state?: "ready" | "filtered-empty";
  totals: {
    total: number;
    proven: number;
    open: number;
    deviating: number;
    records: number;
    /** Promises the list can show (those with text); fewer than `total` is said aloud. */
    listed?: number;
  };
  items: PromiseItem[];
  records: PromiseRecord[];
  page: number;
  pageSize: number;
  total: number;
  query: string;
  facets: Facet[];
  selected?: PromiseItem | null;
  suggestions?: string[];
  mobile?: boolean;
  onView?: (v: PromisesView) => void;
  onQuery?: (q: string) => void;
  onFacet?: (key: string) => void;
  onReset?: () => void;
  onPage?: (p: number) => void;
  onSelect?: (key: string | null) => void;
  onOpenRecord?: (id: string) => void;
};

const VIEWS: (ViewDef<PromisesView> & { label: TextKey })[] = [
  { value: "list", label: "ui.screens-contents.promises-list", icon: "list" },
  { value: "mosaic", label: "ui.screens-contents.promises-mosaic", icon: "grid" },
  { value: "open", label: "ui.screens-contents.promises-open-first", icon: "shield" },
];

/** Dictionary key of each promise state's visible word. */
export const STATE_WORD: Record<PromiseState, TextKey> = {
  proven: "ui.screens-contents.promises-test-named",
  open: "ui.screens-contents.promises-open",
  deviation: "ui.screens-contents.promises-deviation",
};
const STATE_TONE: Record<PromiseState, "ok" | "warn" | "bad"> = {
  proven: "ok",
  open: "warn",
  deviation: "bad",
};

function StateMark({ state }: { state: PromiseState }) {
  const { t } = useText();
  return (
    <span className={`t-c-state t-c-state--${state}`}>
      <span aria-hidden="true" className={`t-dot t-dot--${STATE_TONE[state]}`} />
      {t(STATE_WORD[state])}
    </span>
  );
}

function PromiseDetail({
  item,
  onOpenRecord,
}: {
  item: PromiseItem;
  onOpenRecord?: (id: string) => void;
}) {
  const { t } = useText();
  return (
    <div className="t-stack" data-testid="promise-detail">
      <div className="t-row t-row--wrap">
        <StateMark state={item.state} />
        <span className="t-meta">{item.scenarioId}</span>
      </div>
      <Gwt text={item.text} />
      <div className="t-c-sub">
        <span className="t-label">{t("ui.screens-contents.promises-tests-name")}</span>
        {item.tests.length ? (
          <ul className="t-c-plain">
            {item.tests.map((test) => (
              <li key={test.name} className="t-row">
                <span className="t-badge t-badge--plain">{test.kind}</span>
                <span className="t-mono t-wrap t-c-small" title={test.name}>
                  {test.name.split("::").pop()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={item.state === "proven" ? "t-c-small t-muted" : "t-c-small t-warn"}>
            {item.state === "proven"
              ? t("ui.screens-contents.promises-named-test-according-record-test-not")
              : t("ui.screens-contents.promises-no-test-names-promise")}
          </p>
        )}
      </div>
      <div className="t-row t-row--wrap">
        <Button size="small" icon="document" onClick={() => onOpenRecord?.(item.recordId)}>
          {t("ui.screens-contents.promises-record-id", { id: short(item.recordId) })}
        </Button>
        <Button size="small" variant="quiet" icon="copy">
          {t("ui.screens-contents.promises-copy-id")}
        </Button>
      </div>
    </div>
  );
}

/** Promises: every scenario with its proof — as a list, a mosaic per record, or open ones first. */
export function PromisesPage(p: PromisesPageProps) {
  const { t, plural, number } = useText();
  const { totals, view, mobile } = p;
  const provenShare = totals.total ? totals.proven / totals.total : 0;
  const detail = p.selected ? (
    <PromiseDetail item={p.selected} onOpenRecord={p.onOpenRecord} />
  ) : null;
  return (
    <KindFrame
      groupId="Registry"
      testId="promises-page"
      kindLabel={t("ui.screens-contents.promises-promises")}
      group="Registry"
      figure={number(totals.open)}
      of={number(totals.total)}
      tone={totals.open ? "warn" : "ok"}
      sentence={
        totals.open
          ? plural("ui.screens-contents.promises-count-promises-lack-carrying-test", totals.open)
          : t("ui.screens-contents.promises-every-promise-carried-test")
      }
      lead={
        <>
          {t("ui.screens-contents.promises-share-test-named-records-records", {
            share: ratioPercent(provenShare),
            records: totals.records,
          })}
          {totals.listed != null && totals.listed < totals.total ? (
            <span className="t-c-subset" data-testid="promise-subset">
              {" "}
              {t("ui.screens-contents.promises-count-promises-text-snapshot", {
                count: totals.listed,
              })}
            </span>
          ) : null}
        </>
      }
      stats={
        <>
          <MiniStat
            label={t("ui.screens-contents.promises-test-named")}
            value={totals.proven}
            tone="ok"
          />
          <MiniStat
            label={t("ui.screens-contents.promises-open")}
            value={totals.open}
            tone="warn"
          />
          <MiniStat
            label={t("ui.screens-contents.promises-deviations")}
            value={totals.deviating}
            tone={totals.deviating ? "bad" : undefined}
          />
        </>
      }
      views={VIEWS.map((v) => ({ ...v, label: t(v.label) }))}
      view={view}
      onView={p.onView}
      aside={
        !mobile && view !== "mosaic" && detail ? (
          <div className="t-raised t-pad t-c-aside">{detail}</div>
        ) : undefined
      }
    >
      <Collection
        state={p.state ?? "ready"}
        toolbar={
          <CollectionToolbar
            query={p.query}
            queryLabel={t("ui.screens-contents.promises-search-promises")}
            placeholder={t("ui.screens-contents.promises-scenario-record-then")}
            facets={p.facets}
            onQuery={p.onQuery}
            onFacet={p.onFacet}
            onReset={p.onReset}
            sortLabel={view === "open" ? t("ui.screens-contents.promises-open-first") : "Record"}
          />
        }
        filteredEmpty={{
          query: p.query,
          onReset: p.onReset,
          suggestions: p.suggestions?.length ? (
            <span className="t-row t-row--wrap" data-testid="promise-suggestions">
              <span className="t-meta">{t("ui.screens-contents.promises-closest")}</span>
              {p.suggestions.map((s) => (
                <Chip key={s} mono onClick={() => p.onOpenRecord?.(s)}>
                  {short(s)}
                </Chip>
              ))}
            </span>
          ) : undefined,
        }}
        pagination={
          view === "mosaic" ? undefined : (
            <Pagination
              page={p.page}
              pageSize={p.pageSize}
              total={p.total}
              onPage={p.onPage}
              compact={mobile}
            />
          )
        }
      >
        {view === "mosaic" ? (
          <Mosaic records={p.records} onOpenRecord={p.onOpenRecord} />
        ) : view === "open" ? (
          <OpenFirst
            items={p.items}
            selected={p.selected?.key}
            hidden={totals.proven}
            onSelect={p.onSelect}
          />
        ) : (
          <ul
            className="t-c-rows t-stagger"
            aria-label={t("ui.screens-contents.promises-promises")}
          >
            {p.items.map((it) => (
              <li key={it.key}>
                <button
                  type="button"
                  className="t-c-prow"
                  aria-current={p.selected?.key === it.key || undefined}
                  onClick={() => p.onSelect?.(it.key)}
                >
                  <StateMark state={it.state} />
                  <span className="t-c-prow__main">
                    <span className="t-c-prow__then t-clamp-2">
                      {stripMd(splitGwt(it.text).then)}
                    </span>
                    <span className="t-meta t-wrap">
                      {capOf(it.recordId)} · {short(it.recordId)} · {it.scenarioId}
                    </span>
                  </span>
                  <span className="t-c-prow__tests t-meta">
                    <Icon name="flask" size={12} /> {it.tests.length}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Collection>
      {mobile && detail ? (
        <Sheet
          open
          side="bottom"
          title={t("ui.screens-contents.promises-promise")}
          meta={p.selected?.recordId}
          onClose={() => p.onSelect?.(null)}
        >
          {detail}
        </Sheet>
      ) : null}
    </KindFrame>
  );
}

function Mosaic({
  records,
  onOpenRecord,
}: {
  records: PromiseRecord[];
  onOpenRecord?: (id: string) => void;
}) {
  const { t } = useText();
  const domains = [...new Set(records.map((r) => r.domain))];
  return (
    <div className="t-stack" style={{ gap: 20 }} data-testid="promise-mosaic">
      <div className="t-c-explanation">
        <span className="t-c-explanation__sw" style={{ background: "var(--t-ok)" }} />{" "}
        {t("ui.screens-contents.promises-test-named")}
        <span className="t-c-explanation__sw" style={{ background: "var(--t-warn)" }} />{" "}
        {t("ui.screens-contents.promises-open")}
        <span className="t-c-explanation__sw" style={{ background: "var(--t-bad)" }} />{" "}
        {t("ui.screens-contents.promises-deviation-mosaic")}
        <span className="t-meta">{t("ui.screens-contents.promises-one-cell-per-promise")}</span>
      </div>
      {domains.map((d) => {
        const list = records.filter((r) => r.domain === d);
        const cells = list.flatMap((r) => r.cells);
        const open = cells.filter((c) => c.state !== "proven").length;
        return (
          <section key={d} aria-label={d} className="t-stack" style={{ gap: 8 }}>
            <div className="t-row">
              <h2 className="t-h3 t-mono">{d}</h2>
              <span className="t-meta">
                {t("ui.screens-contents.promises-records-records-promises-promises-open-open", {
                  records: list.length,
                  promises: cells.length,
                  open,
                })}
              </span>
            </div>
            <div className="t-c-mosaic">
              {list.map((r) => {
                const ro = r.cells.filter((c) => c.state !== "proven").length;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className="t-c-mosaic__rec"
                    data-open={ro ? "true" : undefined}
                    title={`${r.id}: ${t("ui.screens-contents.promises-count-promises-open-open", { count: r.cells.length, open: ro })}`}
                    onClick={() => onOpenRecord?.(r.id)}
                  >
                    <span className="t-c-mosaic__name t-mono t-wrap">{short(r.id)}</span>
                    <span className="t-c-mosaic__cells" aria-hidden="true">
                      {r.cells.map((c) => (
                        <span
                          key={c.scenarioId}
                          className={`t-c-mosaic__cell t-c-mosaic__cell--${c.state}`}
                        />
                      ))}
                    </span>
                    <span className="t-sr">
                      {t("ui.screens-contents.promises-count-promises-open-open", {
                        count: r.cells.length,
                        open: ro,
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function OpenFirst({
  items,
  selected,
  hidden,
  onSelect,
}: {
  items: PromiseItem[];
  selected?: string;
  hidden: number;
  onSelect?: (key: string) => void;
}) {
  const { t, plural } = useText();
  const byRecord = new Map<string, PromiseItem[]>();
  items.forEach((i) => byRecord.set(i.recordId, [...(byRecord.get(i.recordId) ?? []), i]));
  return (
    <div className="t-stack" style={{ gap: 16 }} data-testid="promise-open-first">
      {[...byRecord.entries()].map(([rid, list]) => (
        <section key={rid} className="t-surface t-c-group" aria-label={rid}>
          <header className="t-c-group__head">
            <RecordRef id={rid} />
            <span className="t-spacer" />
            <ShareBar
              label={t("ui.screens-contents.promises-count-open", { count: list.length })}
              parts={[
                { key: "o", value: list.filter((i) => i.state === "open").length, tone: "warn" },
                {
                  key: "a",
                  value: list.filter((i) => i.state === "deviation").length,
                  tone: "bad",
                },
              ]}
            />
            <span className="t-meta">
              {t("ui.screens-contents.promises-count-open", { count: list.length })}
            </span>
          </header>
          <ol className="t-c-plain">
            {list.map((it) => (
              <li key={it.key}>
                <button
                  type="button"
                  className="t-c-openrow"
                  aria-current={selected === it.key || undefined}
                  onClick={() => onSelect?.(it.key)}
                >
                  <StateMark state={it.state} />
                  <span className="t-mono t-c-small t-wrap">{it.scenarioId}</span>
                  <span className="t-c-openrow__then t-ellipsis">
                    {stripMd(splitGwt(it.text).then)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="t-meta t-c-center">
        {t("ui.screens-contents.promises-promises-named-test-follow-after-open", {
          promises: plural("ui.screens-contents.promises-count-promises", hidden),
        })}
      </p>
    </div>
  );
}
