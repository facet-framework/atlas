/**
 * A translated sentence in which some of the interpolated values stand in a
 * face of their own — a path in mono, a file name in code, a term in bold.
 * The sentence stays ONE label to translate (word order differs between
 * languages). The marked values are wrapped in control characters that no
 * label contains, and split out again after translation.
 */

import type { ReactNode } from "react";
import { tx } from "../../../../frontend/src/i18n";

export type Face = "mono" | "code" | "b";

// The control characters are the point: no label contains them (see above).
// eslint-disable-next-line no-control-regex
const MARKED = /\u0001(\w+)\u0002([^\u0003]*)\u0003/g;

/** Translates `key`, rendering every value named in `faces` in its face. */
export function richText(
  key: string,
  values: Record<string, string | number>,
  faces: Record<string, Face>,
): ReactNode {
  const marked: Record<string, string | number> = { ...values };
  for (const name of Object.keys(faces))
    marked[name] = `\u0001${faces[name]}\u0002${values[name]}\u0003`;
  const text = tx(key, marked);
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKED)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const face = m[1] as Face;
    const i = out.length;
    out.push(
      face === "code" ? (
        <code key={i}>{m[2]}</code>
      ) : face === "b" ? (
        <b key={i}>{m[2]}</b>
      ) : (
        <span key={i} className="t-mono">
          {m[2]}
        </span>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The common case: the named values in one face (mono by default). */
export function monoText(
  key: string,
  values: Record<string, string | number>,
  names: readonly string[],
  element: "span" | "code" = "span",
): ReactNode {
  const face: Face = element === "code" ? "code" : "mono";
  return richText(key, values, Object.fromEntries(names.map((n) => [n, face])));
}
