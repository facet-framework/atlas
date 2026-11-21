import { Icon } from "@facet-tools/ui";

import { useText } from "../text";
import { useGroupLabel } from "./Hub";
import { KindFrame, PathRef, RecordRef } from "./frame";
import type { CycleNode, DecisionTarget, UnreadRecord } from "./model";

/** Cycles --------------------------------------------------------------------------- */

export type CyclesPageProps = {
  /** The host's remainder: nodes on a cycle or downstream of one, as it sent them. */
  nodes: CycleNode[];
  onOpenRecord?: (id: string) => void;
};

/** Cycles: the nodes the host reports on a dependency cycle or behind one. The
 * figure counts nodes, not cycles; a zero is the host's measurement. */

export function CyclesPage({ nodes, onOpenRecord }: CyclesPageProps) {
  const { t, plural, number } = useText();
  const group = useGroupLabel();
  const ghosts = nodes.filter((n) => n.summary == null).length;
  return (
    <KindFrame
      groupId="Registry"
      testId="cycles-page"
      kindLabel={t("ui.screens-contents.findings-cycles")}
      group={group("Registry")}
      figure={number(nodes.length)}
      tone={nodes.length ? "bad" : "ok"}
      sentence={
        nodes.length
          ? plural(
              "ui.screens-contents.findings-count-nodes-lie-dependency-cycle-behind",
              nodes.length,
            )
          : t("ui.screens-contents.findings-no-node-lies-dependency-cycle")
      }
      lead={
        ghosts
          ? plural("ui.screens-contents.findings-count-ids-without-read-record", ghosts)
          : undefined
      }
    >
      {nodes.length ? (
        <ul className="t-c-plain t-stack t-stagger" style={{ gap: 8 }} data-testid="cycle-nodes">
          {nodes.map((n) => (
            <li key={n.id} className="t-surface t-c-finding" data-testid="cycle-node">
              <Icon name="network" size={16} />
              <div className="t-stack" style={{ gap: 4, minWidth: 0 }}>
                {n.summary == null ? (
                  <span className="t-mono t-bad" data-testid="cycle-ghost">
                    {n.id}
                  </span>
                ) : (
                  <RecordRef id={n.id} onOpen={onOpenRecord} />
                )}
                <span className="t-c-small t-ink2">
                  {n.summary ?? t("ui.screens-contents.findings-no-record-read-id")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </KindFrame>
  );
}

/** Unread records ---------------------------------------------------------------------- */

export type UnreadPageProps = {
  items: UnreadRecord[];
};

/** Unread records: files the run could not read as records, each with the reader's message. */
export function UnreadPage({ items }: UnreadPageProps) {
  const { t, plural, number } = useText();
  const group = useGroupLabel();
  return (
    <KindFrame
      groupId="Registry"
      testId="unread-page"
      kindLabel={t("ui.screens-contents.findings-not-read")}
      group={group("Registry")}
      figure={number(items.length)}
      tone={items.length ? "bad" : "ok"}
      sentence={
        items.length
          ? plural("ui.screens-contents.findings-count-files-could-not-read-records", items.length)
          : t("ui.screens-contents.findings-every-record-file-was-read")
      }
    >
      {items.length ? (
        <ul className="t-c-plain t-stack t-stagger" style={{ gap: 8 }} data-testid="unread-files">
          {items.map((e) => (
            <li key={e.path} className="t-surface t-c-finding" data-testid="unread-file">
              <Icon name="error" size={16} />
              <div className="t-stack" style={{ gap: 4, minWidth: 0 }}>
                <PathRef path={e.path} line={e.line} />
                <span className="t-c-small t-bad">{e.message}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </KindFrame>
  );
}

/** Decisions ----------------------------------------------------------------------------- */

export type DecisionsPageProps = {
  /** The documents records name, in the order given (most often named first). */
  items: DecisionTarget[];
  onOpenDecision?: (target: string) => void;
  onOpenRecord?: (id: string) => void;
};

/** Decisions: the decision documents records lean on, across the whole registry. */
export function DecisionsPage({ items, onOpenDecision, onOpenRecord }: DecisionsPageProps) {
  const { t, plural, number } = useText();
  const group = useGroupLabel();
  const records = new Set(items.flatMap((d) => d.recordIds)).size;
  return (
    <KindFrame
      groupId="Context"
      testId="decisions-page"
      kindLabel={t("ui.screens-contents.findings-decisions")}
      group={group("Context")}
      figure={number(items.length)}
      sentence={
        items.length
          ? plural(
              "ui.screens-contents.findings-count-documents-named-records-records",
              items.length,
              {
                records,
              },
            )
          : t("ui.screens-contents.findings-no-record-names-decision")
      }
    >
      {items.length ? (
        <ul className="t-c-plain t-stack t-stagger" style={{ gap: 8 }} data-testid="decision-list">
          {items.map((d) => (
            <li key={d.target} className="t-surface t-c-finding" data-testid="decision-target">
              <Icon name="scales" size={16} />
              <div className="t-stack" style={{ gap: 6, minWidth: 0 }}>
                <button
                  type="button"
                  className="t-c-ref t-mono t-wrap"
                  onClick={() => onOpenDecision?.(d.target)}
                >
                  {d.target}
                </button>
                <span className="t-c-small t-ink2" data-testid="decision-count">
                  {plural("ui.screens-contents.findings-count-records-name", d.count)}
                </span>
                <ul className="t-c-plain t-row t-row--wrap" style={{ gap: 8 }}>
                  {d.recordIds.map((id) => (
                    <li key={id}>
                      <RecordRef id={id} onOpen={onOpenRecord} />
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </KindFrame>
  );
}
