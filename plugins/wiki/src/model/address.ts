/**
 * A wiki page's address as declared by the wiki specification.
 *
 * In operation the **host** computes it and sends it alongside the page —
 * that is deliberate and grounded in `WikiCorpus.Addresses`: the rule
 * belongs in one place. This file is therefore not the second computation
 * beside it, but what the reader needs to *recognise* an address and split
 * it back into a path — neither of which the host does for it.
 *
 * The leading `wiki:` is load-bearing, not decorative. Atlas recognises a
 * record id by three lowercase segments; `onboarding/first-day/part-two`
 * fits that form exactly and, without the keyword, would be read as a
 * record and silently not found. Declaring a reserved first segment `wiki`
 * would be brittle — a project is allowed to have a domain called `wiki`.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

const PREFIX = "wiki:";
const EXT = ".md";

/**
 * Path under `wiki/` → address.
 *
 * Matches `facet.WikiAddress` in the host. The reader only uses it where
 * none arrives from the other side — in tests, and if a page ever arrived
 * without an address.
 */
export function WikiAddress(rel: string): string {
  let trimmed = String(rel ?? "").replace(/\\/g, "/");
  if (trimmed.endsWith(EXT)) trimmed = trimmed.slice(0, -EXT.length);
  // An index page is the page of its folder, so its address is the folder's:
  // `wiki/onboarding/index.md` reads as `wiki:onboarding`.
  if (trimmed.endsWith("/index")) trimmed = trimmed.slice(0, -"/index".length);
  if (trimmed === "index") trimmed = "";
  return PREFIX + trimmed;
}

/** Whether a string is a wiki address — by its keyword, not by its shape. */
export function isWikiAddress(value: string): boolean {
  return String(value ?? "").startsWith(PREFIX);
}
