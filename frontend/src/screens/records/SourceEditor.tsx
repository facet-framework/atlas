import { reducedMotion } from "@facet-tools/ui";
/** The record's source view: one file, read-only, in the manner of an editor —
 * a tab with the path, line numbers, highlighting, the FACET anchor lines
 * marked, and a status bar. Plus the code zoom that the raw view shares. */

import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { Button, Icon } from "@facet-tools/ui";

import { useText } from "../text";
import { cx } from "./parts";
import { isTagLine, languageOf, tokenize } from "./syntax";

const REASON_TEXT: Record<string, string> = {
  invalid: "ui.screens-records.sourceeditor-invalid-path",
  missing: "ui.screens-records.sourceeditor-file-not-found",
  network: "ui.screens-records.sourceeditor-file-not-readable",
  "not-anchored": "ui.screens-records.sourceeditor-no-anchor-file",
  outside: "ui.screens-records.sourceeditor-outside-repository",
  "too-large": "ui.screens-records.sourceeditor-file-larger-than-1-mb",
};

/** Code zoom levels in percent; 100 is the page's own code size. */
export const CODE_ZOOM_LEVELS = [80, 90, 100, 110, 125, 150, 175, 200] as const;
export const CODE_ZOOM_DEFAULT = 100;

/** The nearest level to a stored value, so an odd number never sticks. */
export function codeZoomLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return CODE_ZOOM_DEFAULT;
  return CODE_ZOOM_LEVELS.reduce((best, z) =>
    Math.abs(z - value) < Math.abs(best - value) ? z : best,
  );
}

/** The font size of code at a zoom level, relative to the page's code size. */
export function codeFontSize(zoom: number | undefined): string {
  const z = codeZoomLevel(zoom ?? CODE_ZOOM_DEFAULT);
  return `calc(var(--t-fs-12) * ${z / 100})`;
}

/** Minus, the level as reset, plus. Changes the code only, never the page. */
export function CodeZoom({ value, onChange }: { value?: number; onChange?: (z: number) => void }) {
  const { t } = useText();
  const z = codeZoomLevel(value ?? CODE_ZOOM_DEFAULT);
  const at = CODE_ZOOM_LEVELS.indexOf(z as (typeof CODE_ZOOM_LEVELS)[number]);
  const step = (d: number) => {
    const next = CODE_ZOOM_LEVELS[at + d];
    if (next != null) onChange?.(next);
  };
  return (
    <div
      className="t-b-zoom"
      role="group"
      aria-label={t("ui.screens-records.sourceeditor-code-size")}
    >
      <Button
        size="small"
        variant="quiet"
        icon="zoomOut"
        aria-label={t("ui.screens-records.sourceeditor-smaller-code")}
        disabled={at <= 0}
        onClick={() => step(-1)}
      />
      <Button
        size="small"
        variant="quiet"
        className="t-b-zoom__level"
        aria-label={t("ui.screens-records.sourceeditor-reset-code-size-now-percent", {
          percent: z,
        })}
        disabled={z === CODE_ZOOM_DEFAULT}
        onClick={() => onChange?.(CODE_ZOOM_DEFAULT)}
      >
        {t("ui.screens-records.sourceeditor-value", { value: z })}
      </Button>
      <Button
        size="small"
        variant="quiet"
        icon="zoomIn"
        aria-label={t("ui.screens-records.sourceeditor-larger-code")}
        disabled={at >= CODE_ZOOM_LEVELS.length - 1}
        onClick={() => step(1)}
      />
    </div>
  );
}

export type SourceFileAnchor = { line: number; id: string; role?: string };

export type SourceFile = {
  path: string;
  /** The anchor line the view opened at. */
  line: number;
  state: "loading" | "ready" | "error";
  text?: string;
  /** Anchors the host found in the file. */
  anchors?: SourceFileAnchor[];
  /** Why the file is not shown: a fixed reason code from the host. */
  reason?: string;
};

const REASONS = ["invalid", "missing", "outside", "too-large", "not-anchored", "network"] as const;

/** One file, read-only, scrolled to the anchor line. Esc closes it. */
export function SourceEditor({
  file,
  recordId,
  zoom,
  onZoom,
  onClose,
}: {
  file: SourceFile;
  /** The record whose anchors are marked as its own. */
  recordId?: string;
  zoom?: number;
  onZoom?: (z: number) => void;
  onClose?: () => void;
}) {
  const { t, plural } = useText();
  const lang = languageOf(file.path);
  const lines = useMemo(
    () => (file.state === "ready" && file.text != null ? tokenize(file.text, lang) : []),
    [file.state, file.text, lang],
  );
  const anchorAt = useMemo(() => {
    const m = new Map<number, SourceFileAnchor>();
    for (const a of file.anchors ?? []) m.set(a.line, a);
    return m;
  }, [file.anchors]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);

  // Open at the anchor line: the line sits a third down the editor, and the
  // editor itself comes into view on the page.
  useEffect(() => {
    if (file.state !== "ready") return;
    const body = bodyRef.current;
    const target = body?.querySelector<HTMLElement>(`[data-line="${file.line}"]`);
    if (body && target) body.scrollTop = Math.max(0, target.offsetTop - body.clientHeight / 3);
    rootRef.current?.scrollIntoView?.({
      block: "nearest",
      behavior: reducedMotion() ? "auto" : "smooth",
    });
    body?.focus({ preventScroll: true });
  }, [file.state, file.path, file.line]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose?.();
    }
  };
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  const dir = file.path.slice(0, file.path.lastIndexOf("/") + 1);
  const reason = REASONS.includes(file.reason as (typeof REASONS)[number])
    ? (file.reason as (typeof REASONS)[number])
    : "network";

  return (
    // Escape closes the file from anywhere inside it: the code, the zoom or the
    // close button. The section is the one place that sees all three.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={rootRef}
      className="t-b-editor"
      aria-label={t("ui.screens-records.sourceeditor-source-file-path", { path: file.path })}
      data-testid="source-editor"
      onKeyDown={onKeyDown}
    >
      <div className="t-b-editor__bar">
        <div className="t-b-editor__tab">
          <Icon name="code" size={14} />
          <span className="t-mono t-wrap" title={file.path}>
            <span className="t-muted">{dir}</span>
            {name}
          </span>
        </div>
        <span className="t-spacer" />
        <CodeZoom value={zoom} onChange={onZoom} />
        <Button
          size="small"
          variant="quiet"
          icon="close"
          aria-label={t("ui.screens-records.sourceeditor-close-file")}
          onClick={onClose}
        />
      </div>
      {file.state === "loading" ? (
        <p className="t-b-editor__state t-muted" role="status">
          {t("ui.screens-records.sourceeditor-reading-file")}
        </p>
      ) : file.state === "error" ? (
        <p className="t-b-editor__state" role="alert" data-testid="source-editor-error">
          <Icon name="warning" size={14} /> {t(REASON_TEXT[reason])}
        </p>
      ) : (
        <div
          ref={bodyRef}
          className="t-b-editor__body"
          role="region"
          aria-label={t("ui.screens-records.sourceeditor-contents-path", { path: file.path })}
          // A scrolling region must be reachable by keyboard, so arrows scroll it
          // (axe: scrollable-region-focusable).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          style={{ fontSize: codeFontSize(zoom) }}
          data-testid="source-editor-body"
        >
          <pre>
            <code>
              {lines.map((tokens, i) => {
                const n = i + 1;
                const anchor = anchorAt.get(n);
                const tagged = !!anchor || isTagLine(tokens);
                const current = n === file.line;
                return (
                  <span
                    key={i}
                    className={cx(
                      "t-b-editor__line",
                      tagged && "t-b-editor__line--anchor",
                      anchor && recordId && anchor.id === recordId && "t-b-editor__line--own",
                      current && "t-b-editor__line--current",
                    )}
                    data-line={n}
                    data-anchor={tagged ? "true" : undefined}
                    aria-current={current ? "true" : undefined}
                  >
                    <span className="t-b-editor__n" aria-hidden="true">
                      {n}
                    </span>
                    <span className="t-b-editor__text">
                      {tokens.length === 0
                        ? "​"
                        : tokens.map((tok, j) =>
                            tok.kind === "plain" ? (
                              tok.text
                            ) : (
                              <span key={j} className={`t-syn-${tok.kind}`} data-token={tok.kind}>
                                {tok.text}
                              </span>
                            ),
                          )}
                    </span>
                  </span>
                );
              })}
            </code>
          </pre>
        </div>
      )}
      <div className="t-b-editor__status t-meta">
        <span>{lang.name}</span>
        {file.state === "ready" ? (
          <>
            <span>
              {t("ui.screens-records.sourceeditor-ln-line-total", {
                line: file.line,
                total: lines.length,
              })}
            </span>
            <span>
              {plural("ui.screens-records.sourceeditor-count-anchors", (file.anchors ?? []).length)}
            </span>
          </>
        ) : null}
      </div>
    </section>
  );
}
