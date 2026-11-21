import { Icon, Button, IconButton, Finding, Meter, Skeleton } from "@facet-tools/ui";

import { useText } from "../text";
import type { TextKey } from "../text";
import { Sparkline } from "./charts";
import type { ContentGroup, ContentKind, ContentKindKey } from "./model";

export type ContentsHubProps = {
  state: "ready" | "loading";
  kinds: ContentKind[];
  /** Figure and sentence of the opening. */
  headline?: { records: number; open: number; sentence: string };
  onOpen?: (key: ContentKindKey, view?: string) => void;
  /** Kinds pinned to the menu, in the order they were pinned. */
  pinned?: readonly ContentKindKey[];
  /** Pin (`true`) or unpin a kind; without it the tiles carry no pin button. */
  onPin?: (key: ContentKindKey, pin: boolean) => void;
  /** Tiles an app adds beside the built-in kinds, e.g. ones plugins contribute. */
  plugins?: readonly PluginKindTile[];
  onOpenPlugin?: (key: string) => void;
  /** When this run read the repository, as the reader words a time of day. */
  readAt?: string;
  /** Read the repository again; without it the hub offers no reread. */
  onReread?: () => void;
};

/** A tile beside the built-in kinds; it opens through `onOpenPlugin`. */
export type PluginKindTile = Pick<
  ContentKind,
  "label" | "icon" | "desc" | "count" | "unit" | "finding" | "tone"
> & { key: string };

/** Visible group names. Registry and Code read the same in both languages, so
 * they show their id; the other two come from the dictionary. */

const GROUP_LABEL: Record<ContentGroup, TextKey | null> = {
  Registry: null,
  Evidence: "ui.screens-contents.hub-tests-findings",
  Code: null,
  Context: "ui.screens-contents.hub-context",
};

/** The visible name of a content group in the active language. */
export function useGroupLabel() {
  const { t } = useText();
  return (g: ContentGroup) => {
    const key = GROUP_LABEL[g];
    return key ? t(key) : g;
  };
}
const GROUPS: ContentGroup[] = ["Registry", "Evidence", "Code", "Context"];

/** The element id of a group's section on the hub; a kind page's group crumb leads there. */
export const hubGroupId = (g: ContentGroup) => `contents-${g.toLowerCase()}`;

/** Contents: the hub of all content kinds, grouped, each with its figure and finding. */
export function ContentsHub({
  state,
  kinds,
  headline,
  onOpen,
  pinned,
  onPin,
  plugins,
  onOpenPlugin,
  readAt,
  onReread,
}: ContentsHubProps) {
  const { t, plural, number } = useText();
  const groupLabel = useGroupLabel();
  const loading = state === "loading";
  return (
    <div className="t-page t-c-hub" data-testid="contents-hub" aria-busy={loading || undefined}>
      <Finding
        eyebrow={
          loading
            ? t("ui.screens-contents.hub-contents-kinds")
            : plural("ui.screens-contents.hub-contents-count-kinds", kinds.length)
        }
        figure={loading || !headline ? "—" : number(headline.records)}
        sentence={
          loading || !headline ? t("ui.screens-contents.hub-counting-contents") : headline.sentence
        }
        lead={
          loading || !headline
            ? t("ui.screens-contents.hub-records-open")
            : plural("ui.screens-contents.hub-records-count-places-open", headline.open)
        }
      />
      {!loading && (readAt || onReread) ? (
        <div className="t-row" data-testid="hub-run">
          {readAt ? (
            <span className="t-meta">
              {t("ui.screens-contents.hub-read-time", { time: readAt })}
            </span>
          ) : null}
          {onReread ? (
            <Button size="small" icon="refresh" onClick={onReread}>
              {t("ui.screens-contents.hub-read-again")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {GROUPS.map((g) => {
        const list = loading
          ? Array.from({ length: g === "Registry" ? 6 : g === "Evidence" ? 4 : 2 }, () => null)
          : kinds.filter((k) => k.group === g);
        if (!list.length) return null;
        const label = groupLabel(g);
        return (
          <section
            key={g}
            id={hubGroupId(g)}
            className="t-c-hub__group"
            aria-label={label}
            data-testid={`hub-group-${g}`}
          >
            <h2 className="t-c-hub__group-title">
              <span>{label}</span>
              <span className="t-meta">{loading ? "—" : list.length}</span>
            </h2>
            <ul className="t-c-hub__grid t-stagger">
              {list.map((k, i) =>
                k ? (
                  <li key={k.key}>
                    <KindTile
                      kind={k}
                      onOpen={onOpen}
                      pinned={pinned?.includes(k.key) ?? false}
                      onPin={onPin}
                    />
                  </li>
                ) : (
                  <li key={i} className="t-c-tile t-c-tile--skel">
                    <Skeleton width={28} height={28} radius={8} />
                    <Skeleton width="55%" height={14} />
                    <Skeleton width={72} height={34} />
                    <Skeleton width="90%" height={10} />
                    <Skeleton width="70%" height={10} />
                  </li>
                ),
              )}
            </ul>
          </section>
        );
      })}
      {!loading && plugins?.length ? (
        <section
          id="contents-plugins"
          className="t-c-hub__group"
          aria-label={t("ui.screens-contents.hub-plugins")}
          data-testid="hub-group-Plugins"
        >
          <h2 className="t-c-hub__group-title">
            <span>{t("ui.screens-contents.hub-plugins")}</span>
            <span className="t-meta">{plugins.length}</span>
          </h2>
          <ul className="t-c-hub__grid t-stagger">
            {plugins.map((k) => (
              <li key={k.key}>
                <PluginTile kind={k} onOpen={onOpenPlugin} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TileHead({ kind: k }: { kind: PluginKindTile | ContentKind }) {
  const { t, number } = useText();
  return (
    <>
      <span className="t-c-tile__top">
        <span className="t-c-tile__icon">
          <Icon name={k.icon} size={18} />
        </span>
        <span className="t-c-tile__label">{k.label}</span>
        {k.finding ? (
          <span className={`t-badge${k.tone && k.tone !== "neutral" ? ` t-badge--${k.tone}` : ""}`}>
            {k.finding}
          </span>
        ) : null}
      </span>
      <span
        className={k.tone === "bad" ? "t-c-tile__figure t-bad" : "t-c-tile__figure"}
        data-testid="tile-figure"
      >
        {k.count == null ? (
          <span className="t-muted" title={t("ui.screens-contents.hub-not-measured")}>
            —
          </span>
        ) : (
          number(k.count)
        )}
        <small>{k.unit}</small>
      </span>
      <span className="t-c-tile__desc">{k.desc}</span>
    </>
  );
}

function PluginTile({ kind: k, onOpen }: { kind: PluginKindTile; onOpen?: (key: string) => void }) {
  return (
    <article className="t-c-tile t-interactive" data-testid={`kind-${k.key}`}>
      <button type="button" className="t-c-tile__open" onClick={() => onOpen?.(k.key)}>
        <TileHead kind={k} />
      </button>
    </article>
  );
}

function KindTile({
  kind: k,
  onOpen,
  pinned,
  onPin,
}: {
  kind: ContentKind;
  onOpen?: ContentsHubProps["onOpen"];
  pinned: boolean;
  onPin?: ContentsHubProps["onPin"];
}) {
  const { t } = useText();
  return (
    <article className="t-c-tile t-interactive" data-testid={`kind-${k.key}`}>
      <button type="button" className="t-c-tile__open" onClick={() => onOpen?.(k.key)}>
        <TileHead kind={k} />
      </button>
      <div className="t-c-tile__foot">
        {k.share !== undefined ? (
          <Meter
            value={k.share}
            thin
            label={t("ui.screens-contents.hub-kind-share", { kind: k.label })}
            tone={k.tone === "warn" ? "warn" : "ok"}
          />
        ) : k.spark ? (
          <Sparkline
            values={k.spark}
            label={t("ui.screens-contents.hub-kind-trend", { kind: k.label })}
            width={120}
            height={22}
          />
        ) : (
          <span />
        )}
        <span className="t-c-tile__views">
          {k.views.map((v) => (
            <button
              key={v.id}
              type="button"
              className="t-c-tile__view"
              onClick={() => onOpen?.(k.key, v.id)}
            >
              {v.label}
            </button>
          ))}
        </span>
        {/** The glossary has its own menu entry already. */}
        {onPin && k.key !== "glossary" ? (
          <IconButton
            icon="pin"
            size="small"
            className="t-c-tile__pin"
            label={t("ui.screens-contents.hub-pin-kind-menu", { kind: k.label })}
            pressed={pinned}
            data-testid={`pin-${k.key}`}
            onClick={() => onPin(k.key, !pinned)}
          />
        ) : null}
      </div>
    </article>
  );
}
