/** Which parts of a marked-up sentence are searched for terms. */

import { parseInline, type MdInline } from "@/model";

export function isSearchable(part: MdInline): boolean {
  return part.kind !== "code" && part.kind !== "link";
}

/** The text parts of a sentence in which the reader gets terms linked. */
export function searchableParts(text: string): string[] {
  return parseInline(text)
    .filter(isSearchable)
    .map((part) => part.text);
}
