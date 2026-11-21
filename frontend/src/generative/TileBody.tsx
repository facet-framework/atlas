/** A tile's body, capped at ten lines with a toggle to read the rest. */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { tx } from "@/i18n";

export function TileBody({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [open, children]);

  return (
    <>
      <div
        ref={ref}
        className="gen-body"
        data-testid={`gen-body-${id}`}
        data-open={open ? "" : undefined}
        data-clamped={overflows && !open ? "" : undefined}
      >
        {children}
      </div>
      {overflows || open ? (
        <button
          type="button"
          className="gen-more"
          data-testid={`gen-more-${id}`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? tx("ui.generative.tilebody-show-less") : tx("ui.generative.tilebody-show-more")}
        </button>
      ) : null}
    </>
  );
}
