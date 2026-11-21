import { Fragment, useId } from "react";
import { Icon, type IconName, Button, IconButton, Kbd } from "@facet-tools/ui";

import type { TextKey } from "../text";
import { useText } from "../text";
import { KeyHints, noop } from "./shared";

export type PaletteItem = {
  key: string;
  icon: IconName;
  title: string;
  sub?: string;
  mono?: boolean;
  hint?: string;
  badge?: string;
  /** One character drawn in the mark instead of the icon: the mark a plugin chose for its kind. */
  glyph?: string;
};
export type PaletteGroup = {
  key: string;
  label: string;
  total?: number;
  /** What one hit of this group is, named in its mark's tooltip ("Anchor", "Notes page"). */
  kind?: string;
  /** Size of the whole collection the hits come from, e.g. all 1.200 notes pages. */
  of?: number;
  items: PaletteItem[];
};

export type PaletteProps = {
  query: string;
  groups: PaletteGroup[];
  activeKey?: string | null;
  /** All hits across groups; shown when more exist than are listed. */
  total?: number;
  /** Close words when nothing matched. */
  nearest?: string[];
  mobile?: boolean;
  onQuery?: (q: string) => void;
  onSelect?: (key: string) => void;
  onShowAll?: (group: string) => void;
  onAsk?: (q: string) => void;
  onClose?: () => void;
};

/** Prefix label (a key, or a fixed technical term) and icon. */
const PREFIX: Record<string, [TextKey | { fixed: string }, IconName]> = {
  "/": ["ui.screens-plugins.palette-commands", "keyboard"],
  "?": ["ui.screens-plugins.palette-ask-atlas", "spark"],
  "#": [{ fixed: "Ids" }, "document"],
};

/** Marks the query inside a title, case-insensitive. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.replace(/^[/?#]/, "").trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="t-d-mark">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

export function CommandPalette({
  query,
  groups,
  activeKey,
  total,
  nearest = [],
  mobile,
  onQuery = noop,
  onSelect = noop,
  onShowAll = noop,
  onAsk = noop,
  onClose = noop,
}: PaletteProps) {
  const { t, plural, number } = useText();
  const prefix = PREFIX[query.charAt(0)];
  const prefixLabel = prefix
    ? typeof prefix[0] === "string"
      ? t(prefix[0])
      : prefix[0].fixed
    : null;
  const listed = groups.reduce((a, g) => a + g.items.length, 0);
  const term = query.replace(/^[/?#]/, "").trim();
  const kindIds = `t-d-palette-kind${useId().replace(/:/g, "")}`;
  return (
    <>
      <div className="t-scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="t-d-palette t-float"
        data-mobile={mobile || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={t("ui.screens-plugins.palette-go")}
      >
        <div className="t-d-palette__field">
          <Icon name={prefix ? prefix[1] : "search"} size={18} />
          {prefix ? <span className="t-d-palette__prefix">{prefixLabel}</span> : null}
          <input
            className="t-d-palette__input"
            aria-label={t("ui.screens-plugins.palette-search-command")}
            placeholder={t("ui.screens-plugins.palette-record-area-page-command")}
            value={query}
            role="combobox"
            aria-expanded={listed > 0}
            aria-controls="t-d-palette-list"
            onChange={(e) => onQuery(e.target.value)}
          />
          {total != null && total > listed ? (
            <span className="t-meta t-mono">
              {plural("ui.screens-plugins.palette-count-matches", total)}
            </span>
          ) : null}
          {mobile ? (
            <IconButton
              icon="close"
              label={t("ui.screens-plugins.palette-close")}
              onClick={onClose}
            />
          ) : (
            // A way out for the mouse beside the keyboard's Esc, named for both.
            <button
              type="button"
              className="t-d-palette__esc"
              aria-label={t("ui.screens-plugins.palette-close")}
              title={t("ui.screens-plugins.palette-close")}
              onClick={onClose}
            >
              <Kbd>{t("ui.screens-plugins.palette-esc")}</Kbd>
            </button>
          )}
        </div>
        <div
          className="t-d-palette__list"
          id="t-d-palette-list"
          role="listbox"
          aria-label={t("ui.screens-plugins.palette-results")}
        >
          {groups.map((g, gi) => (
            <Fragment key={g.key}>
              <div className="t-d-palette__group" role="presentation">
                <span>{g.label}</span>
                {/** The kind, read as each of the group's rows' description. */}
                {g.kind ? (
                  <span id={`${kindIds}-${gi}`} hidden>
                    {g.kind}
                  </span>
                ) : null}
                {g.total != null ? (
                  <span className="t-mono">
                    {number(g.total)}
                    {g.of != null ? t("ui.screens-plugins.palette-total", { total: g.of }) : ""}
                  </span>
                ) : null}
                <span className="t-spacer" />
                {g.total != null && g.total > g.items.length ? (
                  <button type="button" className="t-d-linkbtn" onClick={() => onShowAll(g.key)}>
                    {t("ui.screens-plugins.palette-show-all-count", { count: g.total })}
                  </button>
                ) : null}
              </div>
              {g.items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  role="option"
                  aria-selected={activeKey === it.key}
                  aria-describedby={g.kind ? `${kindIds}-${gi}` : undefined}
                  className="t-d-palette__item"
                  onClick={() => onSelect(it.key)}
                >
                  <span
                    className="t-d-palette__icon"
                    data-testid="palette-kind-mark"
                    title={g.kind}
                  >
                    {it.glyph ? (
                      <span className="t-d-palette__glyph" aria-hidden="true">
                        {it.glyph}
                      </span>
                    ) : (
                      <Icon name={it.icon} size={16} />
                    )}
                  </span>
                  <span className="t-stack" style={{ gap: 0, minWidth: 0, flex: 1 }}>
                    <span className={it.mono ? "t-mono t-wrap" : "t-wrap"}>
                      <Highlight text={it.title} query={query} />
                    </span>
                    {it.sub ? <span className="t-meta t-wrap">{it.sub}</span> : null}
                  </span>
                  {it.badge ? <span className="t-badge t-badge--plain">{it.badge}</span> : null}
                  {it.hint ? <Kbd>{it.hint}</Kbd> : null}
                  {activeKey === it.key ? <Icon name="forward" size={14} /> : null}
                </button>
              ))}
            </Fragment>
          ))}
          {!groups.length ? (
            <div className="t-d-palette__none">
              <span className="t-d-palette__noneart" aria-hidden="true">
                <Icon name="search" size={22} />
              </span>
              <strong>{t("ui.screens-plugins.palette-no-matches-term", { term })}</strong>
              {nearest.length ? (
                <span className="t-row t-row--wrap" style={{ gap: 6, justifyContent: "center" }}>
                  <span className="t-meta">{t("ui.screens-plugins.palette-did-you-mean")}</span>
                  {nearest.map((n) => (
                    <button key={n} type="button" className="t-chip" onClick={() => onQuery(n)}>
                      {n}
                    </button>
                  ))}
                </span>
              ) : null}
              <Button variant="primary" icon="spark" onClick={() => onAsk(term)}>
                {t("ui.screens-plugins.palette-ask-atlas-term", { term })}
              </Button>
            </div>
          ) : null}
        </div>
        {mobile ? null : (
          <KeyHints
            hints={[
              ["↑↓", t("ui.screens-plugins.palette-choose")],
              ["↵", t("ui.screens-plugins.palette-open")],
              ["/", t("ui.screens-plugins.palette-commands-commandpalette")],
              ["?", t("ui.screens-plugins.palette-ask")],
              ["#", "Ids"],
            ]}
          />
        )}
      </div>
    </>
  );
}
