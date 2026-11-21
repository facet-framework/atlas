import { useState } from "react";
import { Button, Chip, Tabs, EmptyState, Meter, Pagination, Icon } from "@facet-tools/ui";

import { useText } from "../text";
import type { TextKey } from "../text";
import { BarList, CalendarHeatmap } from "./charts";
import { KeyValues, KindFrame, MiniStat, RecordRef, short } from "./frame";
import { DetailCard, originOf, type CardOrigin } from "./detail";
import type { DayCount, KnowledgeRow, OpsEntry, TeamProvenance, ViewDef } from "./model";
import { sharePercent } from "../../share";

/** Knowledge ---------------------------------------------------------------- */

export type KnowledgeView = "matrix" | "open";

export type KnowledgePageProps = {
  view: KnowledgeView;
  slots: string[];
  /** The question each slot asks, in slot order; the answer card shows it above the answer. */
  questions?: string[];
  rows: KnowledgeRow[];
  totals: { records: number; filled: number; open: number };
  /** Open answers per slot, in slot order. */
  openPerSlot: number[];
  page: number;
  pageSize: number;
  total: number;
  slot?: number;
  mobile?: boolean;
  onView?: (v: KnowledgeView) => void;
  onPage?: (p: number) => void;
  onSlot?: (i: number) => void;
  onOpenRecord?: (id: string) => void;
  onAnswer?: (id: string, slot: number) => void;
};

const K_VIEWS: (ViewDef<KnowledgeView> & { label: TextKey })[] = [
  { value: "matrix", label: "ui.screens-contents.registry-slot-matrix", icon: "grid" },
  { value: "open", label: "ui.screens-contents.registry-open-questions", icon: "bulb" },
];

/** Knowledge: five slots per record, filled or open — as a matrix, or as the list of open questions. */
export function KnowledgePage(p: KnowledgePageProps) {
  const { t, plural, number } = useText();
  const all = p.totals.filled + p.totals.open;
  const slot = p.slot ?? 0;
  const [card, setCard] = useState<{ id: string; slot: number; origin?: CardOrigin } | null>(null);
  const cardRow = card ? p.rows.find((r) => r.id === card.id) : undefined;
  const cardAnswer =
    card && cardRow ? (cardRow.answers?.[card.slot] ?? cardRow.slots[card.slot]) : null;
  return (
    <KindFrame
      groupId="Registry"
      testId="knowledge-page"
      kindLabel={t("ui.screens-contents.registry-knowledge")}
      group="Registry"
      figure={number(p.totals.open)}
      of={number(all)}
      tone={p.totals.open ? "warn" : "ok"}
      sentence={plural("ui.screens-contents.registry-count-knowledge-slots-empty", p.totals.open)}
      // No slot to answer, no denominator: the share is left out, never 0 %.
      lead={
        all
          ? t("ui.screens-contents.registry-share-answered-records-records", {
              share: sharePercent(p.totals.filled, all) ?? 0,
              records: p.totals.records,
            })
          : undefined
      }
      stats={p.slots.map((s, i) => (
        <MiniStat
          key={s}
          label={s}
          value={p.openPerSlot[i]}
          tone={p.openPerSlot[i] ? "warn" : "ok"}
        />
      ))}
      views={K_VIEWS.map((v) => ({ ...v, label: t(v.label) }))}
      view={p.view}
      onView={p.onView}
    >
      {p.view === "matrix" ? (
        <div
          className="t-c-kmatrix"
          role="table"
          aria-label={t("ui.screens-contents.registry-slot-matrix")}
          data-testid="knowledge-matrix"
        >
          <div role="row" className="t-c-kmatrix__row t-c-kmatrix__row--head">
            <span role="columnheader">{t("ui.screens-contents.registry-record")}</span>
            {p.slots.map((s, i) => (
              <span role="columnheader" key={s} className="t-c-kmatrix__colhead">
                <span className="t-wrap">{s}</span>
                <Meter
                  value={1 - p.openPerSlot[i] / (p.totals.records || 1)}
                  thin
                  label={t("ui.screens-contents.registry-slot-answered", { slot: s })}
                />
              </span>
            ))}
          </div>
          {p.rows.map((r) => (
            <div role="row" key={r.id} className="t-c-kmatrix__row">
              <span role="rowheader">
                <RecordRef id={r.id} onOpen={p.onOpenRecord} />
              </span>
              {r.slots.map((v, i) => (
                <span role="cell" key={i}>
                  {v ? (
                    <button
                      type="button"
                      className="t-c-kcell t-c-kcell--filled"
                      aria-label={t("ui.screens-contents.registry-id-slot-show-answer", {
                        id: short(r.id),
                        slot: p.slots[i],
                      })}
                      aria-haspopup="dialog"
                      aria-expanded={(card?.id === r.id && card.slot === i) || undefined}
                      onClick={(e) =>
                        setCard({ id: r.id, slot: i, origin: originOf(e.currentTarget) })
                      }
                    >
                      <Icon name="check" size={12} />
                      <span className="t-wrap t-hide-mobile">{v}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="t-c-kcell t-c-kcell--open"
                      aria-label={t("ui.screens-contents.registry-id-answer-slot", {
                        id: short(r.id),
                        slot: p.slots[i],
                      })}
                      onClick={() => p.onAnswer?.(r.id, i)}
                    >
                      <span className="t-hide-mobile">
                        {t("ui.screens-contents.registry-open")}
                      </span>
                    </button>
                  )}
                </span>
              ))}
            </div>
          ))}
          <Pagination
            page={p.page}
            pageSize={p.pageSize}
            total={p.total}
            onPage={p.onPage}
            compact={p.mobile}
          />
        </div>
      ) : (
        <div className="t-stack" data-testid="knowledge-open">
          <div className="t-c-tabscroll">
            <Tabs
              label={t("ui.screens-contents.registry-slot")}
              value={String(slot)}
              items={p.slots.map((s, i) => ({
                value: String(i),
                label: s,
                count: p.openPerSlot[i],
              }))}
              onChange={(v) => p.onSlot?.(Number(v))}
            />
          </div>
          <ul
            className="t-c-rows"
            aria-label={t("ui.screens-contents.registry-open-slot", { slot: p.slots[slot] })}
          >
            {p.rows
              .filter((r) => r.slots[slot] == null)
              .map((r) => {
                // What the record answered of what its block declares; a row
                // without these counts falls back to the five slots it draws.
                const filled = r.answered ?? r.slots.filter(Boolean).length;
                const total = r.declared ?? 5;
                return (
                  <li key={r.id} className="t-c-qrow">
                    <span className="t-c-qrow__q">
                      <span className="t-c-small t-muted">{p.slots[slot]}?</span>
                      <RecordRef id={r.id} onOpen={p.onOpenRecord} />
                    </span>
                    <span
                      className="t-c-dots"
                      aria-label={t("ui.screens-contents.registry-count-total-answered", {
                        count: filled,
                        total,
                      })}
                    >
                      {r.slots.map((v, i) => (
                        <span key={i} className={v ? "t-dot t-dot--ok" : "t-dot t-dot--open"} />
                      ))}
                    </span>
                    <Button size="small" icon="edit" onClick={() => p.onAnswer?.(r.id, slot)}>
                      {t("ui.screens-contents.registry-answer")}
                    </Button>
                  </li>
                );
              })}
          </ul>
          <Pagination
            page={p.page}
            pageSize={p.pageSize}
            total={p.openPerSlot[slot]}
            onPage={p.onPage}
            compact={p.mobile}
          />
        </div>
      )}
      {card && cardAnswer != null ? (
        <DetailCard
          testId="knowledge-card"
          label={`${p.slots[card.slot]} · ${card.id}`}
          eyebrow={p.slots[card.slot]}
          title={p.questions?.[card.slot] ?? p.slots[card.slot]}
          meta={<span className="t-mono">{card.id}</span>}
          origin={card.origin}
          mobile={p.mobile}
          onClose={() => setCard(null)}
          footer={
            p.onOpenRecord ? (
              <Button
                size="small"
                icon="document"
                onClick={() => {
                  setCard(null);
                  p.onOpenRecord?.(card.id);
                }}
              >
                {t("ui.screens-contents.registry-open-record")}
              </Button>
            ) : undefined
          }
        >
          <p className="t-c-dcard__answer">{cardAnswer}</p>
        </DetailCard>
      ) : null}
    </KindFrame>
  );
}

/** Operations --------------------------------------------------------------- */

export type OperationsPageProps = {
  state: "ready" | "empty";
  entries: OpsEntry[];
  records: number;
  onOpenRecord?: (id: string) => void;
  onLearn?: () => void;
};

/** Visible names of the entry kinds; an SLO is called the same in both languages. */
const OPS_KIND: Record<OpsEntry["kind"], TextKey | null> = {
  SLO: null,
  Alert: "ui.screens-contents.registry-alert",
  ContinuousCheck: "ui.screens-contents.registry-continuous-check",
};

/** Operations: SLOs, alarms and standing checks from the records' observation blocks. */
export function OperationsPage({
  state,
  entries,
  records,
  onOpenRecord,
  onLearn,
}: OperationsPageProps) {
  const { t, number } = useText();
  const opsKind = (k: OpsEntry["kind"]) => {
    const key = OPS_KIND[k];
    return key ? t(key) : k;
  };
  const observed = [...new Set(entries.map((e) => e.recordId))];
  const count = (k: OpsEntry["kind"]) => entries.filter((e) => e.kind === k).length;
  return (
    <KindFrame
      groupId="Registry"
      testId="operations-page"
      kindLabel={t("ui.screens-contents.registry-operations")}
      group="Registry"
      figure={state === "empty" ? number(0) : number(observed.length)}
      of={number(records)}
      sentence={
        state === "empty"
          ? t("ui.screens-contents.registry-no-record-describes-how-observed-operation")
          : observed.length === 1
            ? t("ui.screens-contents.registry-one-record-carries-observation-block")
            : t("ui.screens-contents.registry-count-records-carry-observation-block", {
                count: observed.length,
              })
      }
      stats={
        <>
          <MiniStat label="SLOs" value={state === "empty" ? 0 : count("SLO")} />
          <MiniStat
            label={t("ui.screens-contents.registry-alerts")}
            value={state === "empty" ? 0 : count("Alert")}
          />
          <MiniStat
            label={t("ui.screens-contents.registry-continuous-checks")}
            value={state === "empty" ? 0 : count("ContinuousCheck")}
          />
        </>
      }
    >
      {state === "empty" ? (
        <EmptyState
          icon="pulse"
          title={t("ui.screens-contents.registry-no-operations-described-yet")}
          body={
            <>
              {t("ui.screens-contents.registry-an")}
              <code className="t-mono">{t("ui.screens-contents.registry-observation")}</code>
              {t("ui.screens-contents.registry-block-record-names-slos-alerts-continuous")}
            </>
          }
          action={
            <Button variant="primary" icon="plus" onClick={onLearn}>
              {t("ui.screens-contents.registry-add-block")}
            </Button>
          }
        />
      ) : (
        <div className="t-stack" style={{ gap: 16 }}>
          {observed.map((rid) => (
            <section key={rid} className="t-surface t-c-group" aria-label={rid}>
              <header className="t-c-group__head">
                <Icon name="pulse" size={16} />
                <RecordRef id={rid} onOpen={onOpenRecord} />
                <span className="t-spacer" />
                <span className="t-meta">
                  {t("ui.screens-contents.registry-count-entries", {
                    count: entries.filter((e) => e.recordId === rid).length,
                  })}
                </span>
              </header>
              <ul className="t-c-plain t-c-ops">
                {entries
                  .filter((e) => e.recordId === rid)
                  .map((e) => (
                    <li key={e.key} className="t-c-ops__row">
                      <span
                        className={`t-badge ${e.kind === "Alert" ? "t-badge--warn" : e.kind === "SLO" ? "t-badge--signal" : ""}`}
                      >
                        {opsKind(e.kind)}
                      </span>
                      <span className="t-c-ops__name">{e.name}</span>
                      <span className="t-c-ops__target t-mono">{e.target}</span>
                      <span className="t-meta">{e.window ?? "—"}</span>
                      <span className="t-meta t-wrap t-hide-mobile">{e.source}</span>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          <p className="t-meta t-c-center">
            {t("ui.screens-contents.registry-count-records-without-observation-block", {
              count: records - observed.length,
            })}
          </p>
        </div>
      )}
    </KindFrame>
  );
}

/** Provenance --------------------------------------------------------------- */

export type ProvenanceView = "team" | "calendar";

export type ProvenancePageProps = {
  view: ProvenanceView;
  teams: TeamProvenance[];
  unowned: number;
  days: DayCount[];
  range: { from: string; to: string };
  selectedDay?: DayCount | null;
  months: { key: string; label: string; count: number }[];
  undated: number;
  mobile?: boolean;
  onView?: (v: ProvenanceView) => void;
  onPickDay?: (date: string) => void;
  onOpenRecord?: (id: string) => void;
  onTeam?: (id: string) => void;
};

const P_VIEWS: (ViewDef<ProvenanceView> & { label: TextKey })[] = [
  { value: "team", label: "ui.screens-contents.registry-team", icon: "team" },
  { value: "calendar", label: "ui.screens-contents.registry-calendar", icon: "calendar" },
];

/** Provenance: who owns which records, and when they were created. */
export function ProvenancePage(p: ProvenancePageProps) {
  const { t, plural, number } = useText();
  const owned = p.teams.reduce((a, team) => a + team.records, 0);
  const dated = p.days.reduce((a, d) => a + d.count, 0);
  const busiest = [...p.days].sort((a, b) => b.count - a.count)[0];
  return (
    <KindFrame
      groupId="Registry"
      testId="provenance-page"
      kindLabel={t("ui.screens-contents.registry-origin")}
      group="Registry"
      figure={number(owned)}
      of={number(owned + p.unowned)}
      sentence={
        p.unowned
          ? plural("ui.screens-contents.registry-count-records-have-no-team", p.unowned)
          : t("ui.screens-contents.registry-every-record-has-team")
      }
      lead={t("ui.screens-contents.registry-teams-teams-created-between", {
        teams: p.teams.length,
        from: p.range.from,
        to: p.range.to,
      })}
      stats={
        <>
          <MiniStat label="Teams" value={p.teams.length} />
          <MiniStat
            label={t("ui.screens-contents.registry-without-team")}
            value={p.unowned}
            tone={p.unowned ? "warn" : undefined}
          />
          <MiniStat label={t("ui.screens-contents.registry-without-date")} value={p.undated} />
        </>
      }
      views={P_VIEWS.map((v) => ({ ...v, label: t(v.label) }))}
      view={p.view}
      onView={p.onView}
    >
      {p.view === "team" ? (
        <div className="t-c-teams t-stagger" data-testid="provenance-teams">
          {p.teams.map((team) => (
            <article key={team.id} className="t-raised t-c-team">
              <header className="t-row">
                <span className="t-c-tile__icon">
                  <Icon name="team" size={16} />
                </span>
                <div className="t-stack" style={{ gap: 0, flex: 1 }}>
                  <button
                    type="button"
                    className="t-c-linkish t-h3"
                    onClick={() => p.onTeam?.(team.id)}
                  >
                    {team.name}
                  </button>
                  {team.purpose ? <span className="t-c-small t-muted">{team.purpose}</span> : null}
                </div>
                <span className="t-c-team__n">{number(team.records)}</span>
              </header>
              <Meter
                value={team.records ? team.proven / team.records : null}
                label={t("ui.screens-contents.registry-team-test-named", { team: team.name })}
                thin
              />
              <BarList
                label={t("ui.screens-contents.registry-team-areas", { team: team.name })}
                items={team.domains.map((d) => ({
                  key: d.id,
                  label: <span className="t-mono">{d.id}</span>,
                  value: d.records,
                }))}
              />
              <div className="t-stack" style={{ gap: 4 }}>
                <span className="t-label">
                  {t("ui.screens-contents.registry-recently-created")}
                </span>
                {team.recent.map((r) => (
                  <div key={r.id} className="t-row t-c-small">
                    <span className="t-meta" style={{ whiteSpace: "nowrap" }}>
                      {r.date}
                    </span>
                    <RecordRef id={r.id} onOpen={p.onOpenRecord} />
                  </div>
                ))}
              </div>
            </article>
          ))}
          {p.unowned ? (
            <article className="t-surface t-c-team t-c-team--none">
              <header className="t-row">
                <Icon name="warning" size={16} className="t-warn" />
                <span className="t-h3" style={{ flex: 1 }}>
                  {t("ui.screens-contents.registry-without-team-provenancepage")}
                </span>
                <span className="t-c-team__n t-warn">{number(p.unowned)}</span>
              </header>
              <span className="t-c-small t-muted">
                <code className="t-mono">{t("ui.screens-contents.registry-owner")}</code>{" "}
                {t("ui.screens-contents.registry-missing-record")}
              </span>
            </article>
          ) : null}
        </div>
      ) : (
        <div className="t-c-cal-layout" data-testid="provenance-calendar">
          <div className="t-surface t-pad t-stack">
            <div className="t-row t-row--wrap">
              <span className="t-h3">{t("ui.screens-contents.registry-new-records-per-day")}</span>
              <span className="t-meta">
                {t("ui.screens-contents.registry-count-dated", { count: dated })}
                {busiest
                  ? ` · ${t("ui.screens-contents.registry-busiest-day-date-count", { date: busiest.date, count: busiest.count })}`
                  : ""}
              </span>
            </div>
            <div className="t-c-scrollx">
              <CalendarHeatmap
                label={t("ui.screens-contents.registry-new-records-per-day")}
                days={p.days}
                cell={p.mobile ? 14 : 44}
                from={p.range.from}
                to={p.range.to}
                selected={p.selectedDay?.date}
                onPick={p.onPickDay}
              />
            </div>
            <BarList
              label={t("ui.screens-contents.registry-new-records-per-month")}
              items={p.months.map((m) => ({ key: m.key, label: m.label, value: m.count }))}
            />
          </div>
          <div className="t-raised t-pad t-stack" data-testid="provenance-day">
            {p.selectedDay ? (
              <>
                <span className="t-eyebrow">{p.selectedDay.date}</span>
                <span className="t-h2">
                  {t("ui.screens-contents.registry-count-records-created", {
                    count: p.selectedDay.count,
                  })}
                </span>
                <ul className="t-c-plain t-stack" style={{ gap: 4 }}>
                  {(p.selectedDay.ids ?? []).slice(0, 14).map((id) => (
                    <li key={id}>
                      <RecordRef id={id} onOpen={p.onOpenRecord} />
                    </li>
                  ))}
                </ul>
                {(p.selectedDay.ids?.length ?? 0) > 14 ? (
                  <Chip>
                    {t("ui.screens-contents.registry-count-more", {
                      count: (p.selectedDay.ids?.length ?? 0) - 14,
                    })}
                  </Chip>
                ) : null}
              </>
            ) : (
              <KeyValues
                items={[
                  [t("ui.screens-contents.registry-first-record"), p.range.from],
                  [t("ui.screens-contents.registry-last-record"), p.range.to],
                  [
                    t("ui.screens-contents.registry-days-new-records"),
                    p.days.filter((d) => d.count).length,
                  ],
                ]}
              />
            )}
          </div>
        </div>
      )}
    </KindFrame>
  );
}
