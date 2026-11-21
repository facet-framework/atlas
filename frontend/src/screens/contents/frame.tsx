import { useHeightVar } from "@facet-tools/ui";
/** The frame every content kind stands in: path, finding, view switch, body and
 * an optional side panel. Pure — the view is a prop, switching is a callback. */

import { createContext, useContext, useRef, type ReactNode } from "react";
import { Breadcrumbs, Segment, Finding, Icon } from "@facet-tools/ui";

import { useText } from "../text";
import type { ContentGroup, Tone, ViewDef } from "./model";

/** Where a kind page's crumbs lead, for every kind page below it: the container
 * provides it once instead of handing `onCrumb` to each page. It is called with
 * `contents` (the hub) or a group id. */

export const ContentsCrumbContext = createContext<((key: string) => void) | undefined>(undefined);

export const short = (id: string) => id.split("/").pop() ?? id;
export const capOf = (id: string) => id.split("/").slice(0, 2).join("/");

/** Splits a scenario text into its Given/When/Then parts (multi-line, keyword-led). */
export function splitGwt(text: string): { given: string; when: string; then: string } {
  const out = { given: "", when: "", then: "" };
  let cur: keyof typeof out = "given";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = /^(Given|When|Then|And|But)\b\s*(.*)$/i.exec(line);
    if (m) {
      const k = m[1].toLowerCase();
      if (k === "given") cur = "given";
      else if (k === "when") cur = "when";
      else if (k === "then") cur = "then";
      out[cur] += (out[cur] ? " " : "") + (k === "and" || k === "but" ? `${k} ${m[2]}` : m[2]);
    } else if (line) {
      out[cur] += (out[cur] ? " " : "") + line;
    }
  }
  return out;
}

/** Renders the inline Markdown a record text carries: `code` becomes code,
 * *emphasis* and **strong** lose their markers. Never shows raw syntax. */

export function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  // One wrapping span: inside a line-clamped (-webkit-box) parent every child
  // element becomes its own line, so the parts must share one box.
  return (
    <span>
      {parts.map((part, i) =>
        part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="t-c-icode">
            {part.slice(1, -1)}
          </code>
        ) : (
          part.replace(/\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g, "$1$2")
        ),
      )}
    </span>
  );
}

/** Plain text of inline Markdown, for titles and ellipsised one-liners. */
export const stripMd = (text: string) =>
  text.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g, "$1$2");

export function Gwt({ text, compact }: { text: string; compact?: boolean }) {
  const { t } = useText();
  const g = splitGwt(text);
  return (
    <dl className={compact ? "t-c-gwt t-c-gwt--compact" : "t-c-gwt"}>
      <dt>{t("ui.screens-contents.frame-given")}</dt>
      <dd>{g.given ? <InlineMd text={g.given} /> : "—"}</dd>
      <dt>{t("ui.screens-contents.frame-when")}</dt>
      <dd>{g.when ? <InlineMd text={g.when} /> : "—"}</dd>
      <dt>{t("ui.screens-contents.frame-then")}</dt>
      <dd className="t-c-gwt__then">{g.then ? <InlineMd text={g.then} /> : "—"}</dd>
    </dl>
  );
}

export type KindFrameProps<V extends string> = {
  kindLabel: string;
  group: string;
  figure?: ReactNode;
  /** A figure-sized mark beside the number, e.g. the drift mark. */
  mark?: ReactNode;
  of?: ReactNode;
  tone?: Exclude<Tone, "signal" | "neutral">;
  sentence: ReactNode;
  lead?: ReactNode;
  views?: ViewDef<V>[];
  view?: V;
  onView?: (v: V) => void;
  /** The group's id, the place its crumb leads to; `group` is its visible name. */
  groupId?: ContentGroup;
  /** Where a crumb leads: `contents` is the hub, a group id its group on the hub. */
  onCrumb?: (key: string) => void;
  toolbar?: ReactNode;
  aside?: ReactNode;
  stats?: ReactNode;
  children: ReactNode;
  testId?: string;
};

export function KindFrame<V extends string>({
  kindLabel,
  group,
  figure,
  mark,
  of,
  tone,
  sentence,
  lead,
  views,
  view,
  onView,
  groupId,
  onCrumb,
  toolbar,
  aside,
  stats,
  children,
  testId,
}: KindFrameProps<V>) {
  const { t } = useText();
  // The container's crumb handler, unless the page is given its own.
  const fromContainer = useContext(ContentsCrumbContext);
  const crumb = onCrumb ?? fromContainer;
  // The view bar sticks under the shell's bars; what sticks below it, the
  // side panel and a matrix's head row, keeps clear of its measured height.
  const page = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const hasBar = Boolean((views && view) || toolbar);
  useHeightVar("--t-c-bar-h", bar, page, hasBar);
  return (
    <div className="t-page t-c-kind" data-testid={testId} ref={page}>
      <Breadcrumbs
        crumbs={[
          {
            key: "contents",
            label: t("ui.screens-contents.frame-contents"),
            onClick: () => crumb?.("contents"),
          },
          { key: "group", label: group, onClick: () => crumb?.(groupId ?? group) },
          { key: "kind", label: kindLabel },
        ]}
      />
      <div className={stats ? "t-c-kind__head t-c-kind__head--stats" : "t-c-kind__head"}>
        <Finding
          eyebrow={`${group} · ${kindLabel}`}
          figure={figure}
          mark={mark}
          of={of}
          tone={tone}
          sentence={sentence}
          lead={lead}
        />
        {stats ? <div className="t-c-kind__stats t-stagger">{stats}</div> : null}
      </div>
      {views && view ? (
        <div className="t-c-kind__bar" ref={bar}>
          <Segment
            label={t("ui.screens-contents.frame-view")}
            value={view}
            options={views.map((v) => ({ value: v.value, label: v.label, icon: v.icon }))}
            onChange={onView}
          />
          {toolbar ? <div className="t-c-kind__tools">{toolbar}</div> : null}
        </div>
      ) : toolbar ? (
        <div className="t-c-kind__bar" ref={bar}>
          {toolbar}
        </div>
      ) : null}
      <div className={aside ? "t-c-kind__body t-c-kind__body--aside" : "t-c-kind__body"}>
        <div className="t-c-kind__main t-anim-rise">{children}</div>
        {aside ? <aside className="t-c-kind__aside">{aside}</aside> : null}
      </div>
    </div>
  );
}

/** A small key/value list for side panels and cards. */
export function KeyValues({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="t-c-kv">
      {items.map(([k, v], i) => (
        <div key={i} className="t-c-kv__row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A labelled figure in the header stat strip. `null` renders as not measured. */
export function MiniStat({
  label,
  value,
  tone,
}: {
  label: ReactNode;
  value: number | string | null;
  tone?: Tone;
}) {
  const { t, number } = useText();
  return (
    <div className="t-c-ministat">
      <span
        className={
          tone && tone !== "neutral" && tone !== "signal"
            ? `t-c-ministat__v t-${tone}`
            : "t-c-ministat__v"
        }
      >
        {value == null ? (
          <span title={t("ui.screens-contents.frame-not-measured")} className="t-muted">
            —
          </span>
        ) : typeof value === "number" ? (
          number(value)
        ) : (
          value
        )}
      </span>
      <span className="t-c-ministat__l">{label}</span>
    </div>
  );
}

/** A record id as a link-like button; the domain part is quiet, the slug carries. */
export function RecordRef({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  const parts = id.split("/");
  const slug = parts.pop();
  return (
    <button type="button" className="t-c-ref" onClick={() => onOpen?.(id)} title={id}>
      <span className="t-muted">{parts.join("/")}/</span>
      <span>{slug}</span>
    </button>
  );
}

export function PathRef({ path, line }: { path: string; line?: number }) {
  const parts = path.split("/");
  const file = parts.pop();
  return (
    <span className="t-c-path t-mono" title={line ? `${path}:${line}` : path}>
      <Icon name="file" size={12} />
      <span className="t-muted t-wrap">{parts.length ? `${parts.join("/")}/` : ""}</span>
      <span>{file}</span>
      {line ? <span className="t-muted">:{line}</span> : null}
    </span>
  );
}
