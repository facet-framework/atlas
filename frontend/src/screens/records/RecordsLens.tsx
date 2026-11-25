import { reducedMotion } from "@facet-tools/ui";
import type { KeyboardEvent } from "react";
import { Badge, Button, Tabs, Icon } from "@facet-tools/ui";

import { useText } from "../text";
import { KNOWLEDGE_SLOTS, type RecordRow } from "./model";
import { LifecycleBadge, ProofBar, cx } from "./parts";
import { ScenarioSteps } from "./RecordExtras";
import type { RecordDetails } from "./RecordDetailsPage";
import type { FieldGroup, FieldTile } from "./RecordsPage";

export type LensTab = "promises" | "knowledge" | "relations";

/** What the lens shows besides the field: the record in focus and the best hits. */
export type LensState = {
  /** The record in focus; `null` when nothing is left to focus. */
  focus: RecordDetails | null;
  /** Records that match the search, best first; shown only while searching. */
  hits: RecordRow[];
  tab: LensTab;
  /** Index of the unfolded promise; -1 folds all. */
  open: number;
};

export type RecordsLensProps = {
  groups: FieldGroup[];
  query: string;
  lens: LensState;
  mobile?: boolean;
  onFocus?: (id: string) => void;
  onOpen?: (id: string) => void;
  onTab?: (tab: LensTab) => void;
  onUnfold?: (index: number) => void;
};

type DotState = "focus" | "neighbour" | "hit" | "deep" | "plain";

function dotState(tile: FieldTile, focus: string | null, near: Set<string>, searching: boolean) {
  if (tile.id === focus) return "focus" as const;
  if (near.has(tile.id)) return "neighbour" as const;
  if (searching) return tile.match ? ("hit" as const) : ("deep" as const);
  return "plain" as const;
}

/** Which of all dots a key press moves to, or `null` when the key is not ours. */
function nextIndex(key: string, at: number, count: number, groupStarts: number[]): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return Math.min(count - 1, at + 1);
    case "ArrowLeft":
    case "ArrowUp":
      return Math.max(0, at - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return groupStarts.find((s) => s > at) ?? count - 1;
    case "PageUp":
      return [...groupStarts].reverse().find((s) => s < at) ?? 0;
    default:
      return null;
  }
}

function focusDot(root: HTMLElement | null, id: string | null) {
  if (!root || !id) return;
  root.querySelector<HTMLButtonElement>(`[data-lens-id="${CSS.escape(id)}"]`)?.focus();
}

function Sheet({
  r,
  lens,
  onFocus,
  onOpen,
  onTab,
  onUnfold,
}: {
  r: RecordDetails;
  lens: LensState;
  onFocus?: (id: string) => void;
  onOpen?: (id: string) => void;
  onTab?: (tab: LensTab) => void;
  onUnfold?: (index: number) => void;
}) {
  const { t } = useText();
  const answered = r.knowledge.filter((k) => k.answer).length;
  const tabs: { value: LensTab; label: string; count: number }[] = [
    {
      value: "promises",
      label: t("ui.screens-records.recordslens-promises"),
      count: r.scenarios.length,
    },
    { value: "knowledge", label: t("ui.screens-records.recordslens-knowledge"), count: answered },
    {
      value: "relations",
      label: t("ui.screens-records.recordslens-relations"),
      count: r.dependsOn.length + r.dependents.length,
    },
  ];
  const panelId = `t-lens-panel-${lens.tab}`;
  // Arrow keys walk the tabs, as a tab list does everywhere else.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((x) => x.value === lens.tab);
    const to =
      e.key === "ArrowRight"
        ? (at + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (at + tabs.length - 1) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : null;
    if (to == null) return;
    e.preventDefault();
    onTab?.(tabs[to].value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  };
  const links = (label: string, items: RecordDetails["dependsOn"], none: string) => (
    <div className="t-b-lens__rel">
      <span className="t-label">{label}</span>
      {items.length ? (
        <span className="t-row t-row--wrap" style={{ gap: 6 }}>
          {items.map((d) => (
            <Button
              key={d.id}
              size="small"
              variant="quiet"
              icon="document"
              onClick={() => onFocus?.(d.id)}
            >
              <span className="t-mono t-wrap">{d.id}</span>
            </Button>
          ))}
        </span>
      ) : (
        <span className="t-muted">{none}</span>
      )}
    </div>
  );
  return (
    <>
      <header className="t-b-lens__head">
        <span className="t-meta t-mono t-wrap">
          {r.kind === "assumption" ? t("ui.screens-records.recordslens-assumption") : r.domain} /{" "}
          {r.capability}
        </span>
        <h2 className="t-b-lens__name t-mono t-wrap" data-testid="lens-focus-name">
          {r.slug}
        </h2>
        <span className="t-row t-row--wrap" style={{ gap: 10 }}>
          <LifecycleBadge lifecycle={r.lifecycle} />
          {r.kind === "assumption" ? (
            <Badge tone="signal">{t("ui.screens-records.recordslens-assumption")}</Badge>
          ) : null}
          <ProofBar proven={r.provenCount} total={r.scenarioCount} />
          {r.drift.length ? (
            <Badge tone="warn" plain>
              <Icon name="offsetBlocks" size={12} /> {r.drift.length}
            </Badge>
          ) : null}
          <span className="t-spacer" />
          <Button size="small" icon="forward" onClick={() => onOpen?.(r.id)}>
            {t("ui.screens-records.recordslens-view-record")}
          </Button>
        </span>
        <p className="t-b-lens__summary">
          {r.summary || t("ui.screens-records.recordslens-no-summary-record")}
        </p>
        {/** Keys bubble up from the tab buttons; the wrapper only listens. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div onKeyDown={onTabKey}>
          <Tabs
            label={t("ui.screens-records.recordslens-record-focus")}
            value={lens.tab}
            items={tabs.map((x) => ({ value: x.value, label: x.label, count: x.count }))}
            onChange={onTab}
          />
        </div>
      </header>
      <div
        className="t-b-lens__panel"
        role="tabpanel"
        id={panelId}
        aria-label={tabs.find((x) => x.value === lens.tab)?.label}
      >
        {lens.tab === "promises" ? (
          r.scenarios.length ? (
            <ol className="t-b-lens__promises">
              {r.scenarios.map((s, i) => {
                const unfolded = i === lens.open;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="t-b-lens__promise"
                      aria-expanded={unfolded}
                      onClick={() => onUnfold?.(unfolded ? -1 : i)}
                    >
                      <span
                        className={cx("t-b-lens__mark", !s.proven && "t-b-lens__mark--open")}
                        aria-hidden="true"
                      />
                      <span className="t-mono t-wrap">{s.id}</span>
                      <span className={s.proven ? "t-ok t-meta" : "t-warn t-meta"}>
                        {s.proven
                          ? t("ui.screens-records.recordslens-test-named")
                          : t("ui.screens-records.recordslens-open")}
                      </span>
                    </button>
                    {unfolded ? (
                      <div className="t-b-lens__steps">
                        <ScenarioSteps id={s.id} steps={s.steps} examples={s.examples} />
                        <span className="t-label">
                          {t("ui.screens-records.recordslens-tests-naming-promise")}
                        </span>
                        {s.tests.length ? (
                          <ul className="t-b-lens__tests">
                            {s.tests.map((x) => (
                              <li key={`${x.file}::${x.name ?? ""}`} className="t-mono t-wrap">
                                {x.file}
                                {x.name ? ` · ${x.name}` : ""}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="t-muted">
                            {t("ui.screens-records.recordslens-no-test-names-promise")}
                          </span>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="t-muted">
              {r.kind === "assumption"
                ? t("ui.screens-records.recordslens-assumption-makes-no-promises")
                : t("ui.screens-records.recordslens-record-names-no-scenario-yet")}
            </p>
          )
        ) : lens.tab === "knowledge" ? (
          <dl className="t-b-lens__knowledge">
            {KNOWLEDGE_SLOTS.map((slot) => {
              const answer = r.knowledge.find((k) => k.key === slot.key)?.answer;
              return (
                <div key={slot.key}>
                  <dt className="t-label">{t(slot.label)}</dt>
                  <dd className={answer ? undefined : "t-muted"}>
                    {answer || t("ui.screens-records.recordslens-open")}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <div className="t-stack" style={{ gap: 14 }}>
            {links(
              t("ui.screens-records.recordslens-needs"),
              r.dependsOn,
              t("ui.screens-records.recordslens-nothing"),
            )}
            {links(
              t("ui.screens-records.recordslens-needed"),
              r.dependents,
              t("ui.screens-records.recordslens-nobody"),
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** The lens: every record is a dot in its capability; one record stands sharp
 * beside them, its neighbours marked in the field. A search brings its hits into
 * focus and pushes the rest into the depth. */

export function RecordsLens({
  groups,
  query,
  lens,
  mobile,
  onFocus,
  onOpen,
  onTab,
  onUnfold,
}: RecordsLensProps) {
  const { t, number } = useText();
  const searching = query.trim().length > 0;
  const r = lens.focus;
  const focusId = r?.id ?? null;
  const near = new Set([...(r?.dependsOn ?? []), ...(r?.dependents ?? [])].map((d) => d.id));
  const all = groups.flatMap((g) => g.tiles);
  const order = all.map((x) => x.id);
  const groupStarts: number[] = [];
  groups.reduce((at, g) => {
    groupStarts.push(at);
    return at + g.tiles.length;
  }, 0);
  // One tab stop for the whole field: the record in focus, else the first dot.
  const tabStop = focusId && order.includes(focusId) ? focusId : (order[0] ?? null);
  const sharp = searching ? all.filter((x) => x.match).length : all.length;

  const pick = (id: string) => {
    onFocus?.(id);
    if (mobile) {
      const reduce = reducedMotion();
      document
        .querySelector('[data-testid="lens-sheet"]')
        ?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  };

  const onDotKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const to = nextIndex(e.key, order.indexOf(id), order.length, groupStarts);
    if (to == null) return;
    e.preventDefault();
    onFocus?.(order[to]);
    focusDot(e.currentTarget.closest(".t-b-lens__field"), order[to]);
  };

  const label = (tile: FieldTile, state: DotState) => {
    const proof = tile.scenarios
      ? t("ui.screens-records.recordslens-id-proven-total-test-named", {
          id: tile.id,
          proven: tile.proven,
          total: tile.scenarios,
        })
      : `${tile.id} · ${t("ui.screens-records.recordslens-no-promises")}`;
    return state === "neighbour"
      ? `${proof} · ${t("ui.screens-records.recordslens-neighbour")}`
      : proof;
  };

  const field = (
    <section
      className="t-b-lens__fieldwrap"
      aria-label={t("ui.screens-records.recordslens-all-records")}
    >
      <p className="t-b-lens__status t-meta" role="status" data-testid="lens-status">
        {searching
          ? t("ui.screens-records.recordslens-sharp-sharp-deep-depth", {
              sharp: number(sharp),
              deep: number(all.length - sharp),
            })
          : null}
      </p>
      <div className="t-b-lens__field t-surface">
        {groups.map((g) => {
          const name =
            g.kind === "assumption"
              ? `${t("ui.screens-records.recordslens-assumptions")} / ${g.capability}`
              : `${g.domain} / ${g.capability}`;
          const inFocus = g.tiles.some(
            (x) => x.id === focusId || near.has(x.id) || (searching && x.match),
          );
          return (
            <div
              key={`${g.domain}/${g.capability}`}
              className="t-b-lens__group"
              role="group"
              aria-label={name}
              data-depth={searching && !inFocus ? "1" : undefined}
            >
              <span className="t-b-lens__gname t-mono t-wrap" aria-hidden="true">
                {name}
              </span>
              <span className="t-b-lens__dots">
                {g.tiles.map((tile) => {
                  const state = dotState(tile, focusId, near, searching);
                  const full = tile.scenarios > 0 && tile.proven >= tile.scenarios;
                  return (
                    <button
                      key={tile.id}
                      type="button"
                      className={cx(
                        "t-b-dot",
                        `t-b-dot--${tile.lifecycle}`,
                        tile.scenarios === 0
                          ? "t-b-dot--none"
                          : full
                            ? "t-b-dot--proven"
                            : "t-b-dot--open",
                      )}
                      data-lens-id={tile.id}
                      data-state={state}
                      data-testid="lens-dot"
                      tabIndex={tile.id === tabStop ? 0 : -1}
                      aria-pressed={state === "focus"}
                      aria-label={label(tile, state)}
                      title={label(tile, state)}
                      onClick={() => pick(tile.id)}
                      onKeyDown={(e) => onDotKey(e, tile.id)}
                    />
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
      <ul
        className="t-b-lens__legend t-meta"
        aria-label={t("ui.screens-records.recordslens-legend")}
      >
        <li>
          <span className="t-b-dot t-b-dot--proven" aria-hidden="true" />{" "}
          {t("ui.screens-records.recordslens-all-named-test")}
        </li>
        <li>
          <span className="t-b-dot t-b-dot--open" aria-hidden="true" />{" "}
          {t("ui.screens-records.recordslens-promises-open")}
        </li>
        <li>
          <span className="t-b-dot t-b-dot--none" aria-hidden="true" />{" "}
          {t("ui.screens-records.recordslens-no-promises")}
        </li>
        <li>
          <span className="t-b-dot t-b-dot--planned t-b-dot--none" aria-hidden="true" />{" "}
          {t("ui.screens-records.recordslens-planned")}
        </li>
        <li>
          <span className="t-b-dot" data-state="focus" aria-hidden="true" />{" "}
          {t("ui.screens-records.recordslens-focus")}
        </li>
        <li>
          <span className="t-b-dot t-b-dot--proven" data-state="neighbour" aria-hidden="true" />{" "}
          {t("ui.screens-records.recordslens-neighbour")}
        </li>
      </ul>
    </section>
  );

  const hits =
    searching && lens.hits.length ? (
      <section className="t-b-lens__hits" aria-label={t("ui.screens-records.recordslens-hits")}>
        <span className="t-label">{t("ui.screens-records.recordslens-hits")}</span>
        {lens.hits.map((h) => (
          <button
            key={h.id}
            type="button"
            className="t-b-lens__hit"
            aria-current={h.id === focusId ? "true" : undefined}
            onClick={() => pick(h.id)}
          >
            <span className="t-mono t-wrap">{h.slug}</span>
            <span className="t-meta t-mono t-wrap">
              {h.domain} / {h.capability}
            </span>
            <ProofBar proven={h.proven} total={h.scenarios} />
          </button>
        ))}
      </section>
    ) : null;

  const sheet = (
    // Escape bubbles up from the controls inside; the sheet itself takes no input.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article
      className="t-b-lens__sheet t-surface"
      aria-label={r ? r.id : t("ui.screens-records.recordslens-no-record-focus")}
      data-testid="lens-sheet"
      onKeyDown={(e) => {
        // Esc leaves the sheet for the dot of the record in focus.
        if (e.key !== "Escape" || !focusId) return;
        e.stopPropagation();
        focusDot(e.currentTarget.parentElement, focusId);
      }}
    >
      {r ? (
        <Sheet r={r} lens={lens} onFocus={pick} onOpen={onOpen} onTab={onTab} onUnfold={onUnfold} />
      ) : (
        <p className="t-muted">{t("ui.screens-records.recordslens-no-record-focus")}</p>
      )}
    </article>
  );

  return (
    <div className={cx("t-b-lens", mobile && "t-b-lens--mobile")} data-testid="records-lens">
      {mobile ? (
        <>
          {hits}
          {/** i18n-spacing: joined */}
          {sheet}
          {/** i18n-spacing: joined */}
          {field}
        </>
      ) : (
        <>
          <div className="t-b-lens__main">
            {field}
            {/** i18n-spacing: joined */}
            {hits}
          </div>
          {sheet}
        </>
      )}
    </div>
  );
}
