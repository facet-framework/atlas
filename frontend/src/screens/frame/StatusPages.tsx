import type { CSSProperties, ReactNode } from "react";
import { useText } from "../text";
import { Icon, Button, Kbd, SearchField, ListRow, Sheet, Tooltip } from "@facet-tools/ui";
import { BootScreen, type BootScreenProps, type HistoryEntry, HistoryMenu } from "@/chrome";

const HISTORY_KIND: Record<string, string> = {
  overviewPage: "ui.screens-frame.statuspages-overview",
  area: "ui.screens-frame.statuspages-area",
  record: "ui.screens-frame.statuspages-record",
  plugin: "ui.screens-frame.statuspages-plugin",
  overview: "ui.screens-frame.statuspages-overview-overview",
  content: "ui.screens-frame.statuspages-content",
  settings: "ui.screens-frame.statuspages-settings",
};

/** Start --------------------------------------------------------------------------------------------- */

export type StartPageProps = BootScreenProps & {
  /** Holds the hand-off at a fraction of its flight (0…1) instead of playing it,
   * so one moment of the mark flying into the logo can be looked at. */

  freezeAt?: number;
};

/** Boot over the frame. At "ready" the mark flies into the logo and the page behind shows through. */
export function StartPage({ freezeAt, ...boot }: StartPageProps) {
  return (
    <div
      className="t-a-start"
      data-testid="start"
      data-phase={boot.phase}
      data-freeze={freezeAt == null ? undefined : ""}
      style={freezeAt == null ? undefined : ({ "--t-a-freeze": freezeAt } as CSSProperties)}
    >
      <BootScreen {...boot} />
    </div>
  );
}

/** Connection lost -------------------------------------------------------------------------------------- */

export type ConnectionBannerProps = {
  since: string;
  attempt: number;
  nextRetryIn: number | null;
  lastGood: string;
  endpoint: string;
  onRetry?: () => void;
  onDismiss?: () => void;
};

/** Sits under the frame; the page below stays readable but is marked stale. */
export function ConnectionBanner({
  since,
  attempt,
  nextRetryIn,
  lastGood,
  endpoint,
  onRetry,
  onDismiss,
}: ConnectionBannerProps) {
  const { t } = useText();
  return (
    <div className="t-a-offline" role="alert" data-testid="offline">
      <span className="t-a-offline__pulse" aria-hidden="true" />
      <div className="t-stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
        <span className="t-a-offline__title">
          {t("ui.screens-frame.statuspages-connection-facet-ui-lost")}
        </span>
        <span className="t-meta t-a-offline__meta">
          {t("ui.screens-frame.statuspages-since-since-attempt-attempt-endpoint-lastgood", {
            since,
            attempt,
            endpoint,
            lastGood,
          })}
        </span>
      </div>
      <span className="t-meta t-hide-mobile">
        {nextRetryIn == null
          ? t("ui.screens-frame.statuspages-no-new-attempt-planned")
          : t("ui.screens-frame.statuspages-new-attempt-seconds-s", { seconds: nextRetryIn })}
      </span>
      <Button size="small" variant="primary" icon="refresh" onClick={onRetry}>
        {t("ui.screens-frame.statuspages-connect-now")}
      </Button>
      {onDismiss ? (
        <Button
          size="small"
          variant="quiet"
          icon="close"
          aria-label={t("ui.screens-frame.statuspages-hide-notice")}
          onClick={onDismiss}
        />
      ) : null}
    </div>
  );
}

/** A page behind the banner: present, but visibly from the last good state. */
export function StaleFrame({ children }: { children: ReactNode }) {
  const { t } = useText();
  return (
    <div className="t-a-stale" aria-describedby="t-a-stale-note">
      <span id="t-a-stale-note" className="t-sr">
        {t("ui.screens-frame.statuspages-content-last-state-not-current")}
      </span>
      {children}
    </div>
  );
}

/** Not found ------------------------------------------------------------------------------------------- */

export type NotFoundPageProps = {
  path: string;
  /** What the path looked like it named, e.g. "Record". */
  kind: string;
  suggestions: { id: string; label: string; sub: string; distance: number }[];
  onOpen?: (id: string) => void;
  onHome?: () => void;
  onSearch?: () => void;
  onBack?: () => void;
};

export function NotFoundPage({
  path,
  kind,
  suggestions,
  onOpen,
  onHome,
  onSearch,
  onBack,
}: NotFoundPageProps) {
  const { t, plural } = useText();
  return (
    <div className="t-page t-a-404" data-testid="not-found">
      <div className="t-a-404__in t-anim-rise">
        <svg className="t-a-404__art" viewBox="0 0 220 120" aria-hidden="true">
          <path
            d="M20 96 L110 44 L200 96 L110 148 Z"
            className="t-a-404__plate"
            transform="translate(0 -30)"
          />
          <rect x="70" y="38" width="22" height="40" rx="2" className="t-a-404__tower" />
          <rect x="128" y="28" width="22" height="50" rx="2" className="t-a-404__tower" />
          <rect x="99" y="52" width="22" height="26" rx="2" className="t-a-404__gap" />
        </svg>
        <span className="t-eyebrow">
          {t("ui.screens-frame.statuspages-404-kind-not-found", { kind })}
        </span>
        <h1 className="t-h1">{t("ui.screens-frame.statuspages-place-does-not-exist-here")}</h1>
        <p className="t-lead">
          <code className="t-mono t-a-404__path">{path}</code>{" "}
          {t("ui.screens-frame.statuspages-not-any-record-state-may-have")}
        </p>
        <div className="t-row t-row--wrap" style={{ gap: 8 }}>
          <Button variant="primary" icon="search" onClick={onSearch}>
            {t("ui.screens-frame.statuspages-search")}{" "}
            <Kbd>{t("ui.screens-frame.statuspages-ctrl")}</Kbd>
            <Kbd>{t("ui.screens-frame.statuspages-k")}</Kbd>
          </Button>
          <Button icon="back" onClick={onBack}>
            {t("ui.screens-frame.statuspages-back")}
          </Button>
          <Button variant="quiet" icon="home" onClick={onHome}>
            {t("ui.screens-frame.statuspages-overview-notfoundpage")}
          </Button>
        </div>
        {suggestions.length ? (
          <section
            className="t-surface t-a-404__near"
            aria-label={t("ui.screens-frame.statuspages-similar-places")}
          >
            <div className="t-a-panel-head">
              <span className="t-h3">{t("ui.screens-frame.statuspages-did-you-mean")}</span>
              <span className="t-meta">{t("ui.screens-frame.statuspages-similarity-id")}</span>
            </div>
            {suggestions.map((s) => (
              <ListRow
                key={s.id}
                lead={<Icon name="document" size={14} />}
                title={<span className="t-mono">{s.label}</span>}
                sub={s.sub}
                trail={
                  <span className="t-meta">
                    {plural("ui.screens-frame.statuspages-count-characters", s.distance)}
                  </span>
                }
                onClick={() => onOpen?.(s.id)}
              />
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Frame overlays that need state the shared Screen cannot carry ------------------------------------------- */

/** The history list with a live filter, anchored under the chevrons. */
export function PlacesOverlay({
  entries,
  filter,
  onFilter,
  onPick,
  onClear,
}: {
  entries: HistoryEntry[];
  filter: string;
  onFilter?: (q: string) => void;
  onPick?: (key: string) => void;
  onClear?: () => void;
}) {
  return (
    <div className="t-a-anchor t-a-anchor--history" data-testid="places">
      <HistoryMenu
        entries={entries}
        filter={filter}
        onFilter={onFilter}
        onPick={onPick}
        onClear={onClear}
      />
    </div>
  );
}

/** Explains why the chevrons are off; shown on hover or focus in the app. */
export function EmptyHistoryHint() {
  const { t } = useText();
  return (
    <div className="t-a-anchor t-a-anchor--history" data-testid="history-empty">
      <Tooltip style={{ top: "calc(100% + 6px)", left: 0, whiteSpace: "nowrap" }}>
        {t("ui.screens-frame.statuspages-no-earlier-place-yet")}
      </Tooltip>
    </div>
  );
}

/** The role menu with the seven reader roles of the overview page. */
/** Mobile form: the same list as a sheet from below --------------------------------------------------------- */

export function PlacesSheet({
  entries,
  filter,
  onFilter,
  onPick,
  onClear,
  onClose,
}: {
  entries: HistoryEntry[];
  filter: string;
  onFilter?: (q: string) => void;
  onPick?: (key: string) => void;
  onClear?: () => void;
  onClose?: () => void;
}) {
  const { t, plural } = useText();
  const q = filter.trim().toLowerCase();
  const shown = q
    ? entries.filter((e) => (e.label + " " + (e.sub ?? "")).toLowerCase().includes(q))
    : entries;
  return (
    <Sheet
      open
      side="bottom"
      title={t("ui.screens-frame.statuspages-visited-places")}
      meta={t("ui.screens-frame.statuspages-count-up-200-browser-only", {
        count: entries.length,
      })}
      onClose={onClose}
      footer={
        <Button size="small" variant="quiet" icon="trash" onClick={onClear}>
          {t("ui.screens-frame.statuspages-clear-history")}
        </Button>
      }
    >
      <div className="t-stack" style={{ gap: 8 }} data-testid="places-sheet">
        {entries.length >= 20 ? (
          <SearchField
            label={t("ui.screens-frame.statuspages-filter-places")}
            value={filter}
            placeholder={t("ui.screens-frame.statuspages-filter-places")}
            onChange={onFilter}
          />
        ) : null}
        {q ? (
          <span className="t-meta">
            {plural("ui.screens-frame.statuspages-count-matches", shown.length)}
          </span>
        ) : null}
        <div role="list" aria-label={t("ui.screens-frame.statuspages-places")}>
          {shown.slice(0, 30).map((e) => (
            <div role="listitem" key={e.key}>
              <ListRow
                title={e.current ? <b>{e.label}</b> : e.label}
                sub={`${t(HISTORY_KIND[e.kind])}${e.sub ? " · " + e.sub : ""}`}
                trail={<span className="t-meta">{e.time}</span>}
                onClick={() => onPick?.(e.key)}
              />
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
