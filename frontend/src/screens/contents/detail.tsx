import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "@facet-tools/ui";

import { useText } from "../text";

/** Where a card grows from: the centre of the element that opened it, in viewport pixels. */
export type CardOrigin = { x: number; y: number };

/** The centre of `el` as a card origin. */
export function originOf(el: Element | null): CardOrigin | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export type DetailCardProps = {
  title: ReactNode;
  /** Plain text naming the card for assistive technology. */
  label: string;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  origin?: CardOrigin;
  mobile?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
  onClose: () => void;
};

/** A card over the page that grows out of the element that opened it. */

export function DetailCard(p: DetailCardProps) {
  // Rendered into the themed shell, not in place: an animated ancestor keeps a
  // transform, and a fixed element inside it would be pinned to that ancestor
  // instead of the viewport.
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    setHost(a?.closest("[data-t-theme], .t-app") ?? document.body);
  }, []);
  return (
    <>
      <span ref={anchor} hidden />
      {host ? createPortal(<CardBody {...p} />, host) : null}
    </>
  );
}

function CardBody(p: DetailCardProps) {
  const { t } = useText();
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const { onClose, origin, mobile } = p;

  // The offset from the card's own centre to the opener, measured before the
  // first paint, so the first animation frame already starts at the opener.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !origin || mobile) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--t-from-x", `${Math.round(origin.x - (r.left + r.width / 2))}px`);
    el.style.setProperty("--t-from-y", `${Math.round(origin.y - (r.top + r.height / 2))}px`);
  }, [origin, mobile]);

  // The handler is read through a ref: a caller's fresh closure on every
  // render must not move focus back and forth.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <>
      <div className="t-scrim t-c-dcard-scrim" aria-hidden="true" onClick={onClose} />
      <section
        ref={ref}
        className="t-c-dcard"
        data-mobile={mobile || undefined}
        role="dialog"
        aria-modal="true"
        aria-label={p.label}
        aria-describedby={titleId}
        tabIndex={-1}
        data-testid={p.testId}
      >
        <header className="t-c-dcard__head">
          <div className="t-stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
            {p.eyebrow ? <span className="t-eyebrow t-wrap">{p.eyebrow}</span> : null}
            <h2 id={titleId} className="t-h3 t-wrap">
              {p.title}
            </h2>
            {p.meta ? <span className="t-meta t-wrap">{p.meta}</span> : null}
          </div>
          <IconButton
            icon="close"
            label={t("ui.screens-contents.detail-close")}
            onClick={onClose}
          />
        </header>
        <div className="t-c-dcard__body">{p.children}</div>
        {p.footer ? <footer className="t-c-dcard__foot">{p.footer}</footer> : null}
      </section>
    </>
  );
}
