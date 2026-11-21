/** Markdown links whose target no reader should follow, turned into text. */

import { isSafeHref } from "../../frontend/src/model/markdown";

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/** The address a browser would follow for a written target: tabs and line
 * breaks removed, control characters and spaces trimmed from both ends, and
 * the angle form `<target>` unwrapped. */

export function linkTarget(raw: string): string {
  const trim = (s: string) =>
    s.replace(/[\t\n\r]/g, "").replace(/^[\0- ]+|[\0- ]+$/g, "");
  const href = trim(raw);
  return href.startsWith("<") ? trim(href.slice(1).replace(/>$/, "")) : href;
}

/** Whether a link target is kept as a link: a target without a scheme (an
 * anchor, a path in the repository), `mailto:`, what `isSafeHref` allows, and
 * the schemes in `keep` a plugin resolves itself (for example `atlas:`).
 * Schemes compare without regard to case, as the browser compares them. */

export function keepsLink(href: string, keep: readonly string[] = []): boolean {
  const target = linkTarget(href);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(target)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (scheme === "mailto" || keep.some((k) => k.toLowerCase() === scheme))
    return true;
  return isSafeHref(target);
}

function defuseText(text: string, keep: readonly string[]): string {
  // A defused link can close a new one around it (`[[a](javascript:1)](javascript:2)`),
  // so the pass repeats until nothing changes. Every replacement removes one `](`,
  // which bounds the loop.
  let current = text;
  for (;;) {
    const next = current.replace(LINK, (whole, label: string, href: string) =>
      keepsLink(href, keep) ? whole : `${label} \`${href}\``,
    );
    if (next === current) return next;
    current = next;
  }
}

export function defuseLinks(
  markdown: string,
  keep: readonly string[] = [],
): string {
  const out: string[] = [];
  let prose: string[] = [];
  let fenced = false;
  const flush = () => {
    if (prose.length) out.push(defuseText(prose.join("\n"), keep));
    prose = [];
  };
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      if (!fenced) flush();
      fenced = !fenced;
      out.push(line);
    } else if (fenced) out.push(line);
    else prose.push(line);
  }
  flush();
  return out.join("\n");
}
