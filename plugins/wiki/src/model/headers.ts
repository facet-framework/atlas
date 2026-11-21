/**
 * A wiki page's front matter (the specification).
 *
 * Eleven possible keys, one of them required — that is the whole list, and
 * it is small enough that its own small reader weighs less than a
 * dependency. It handles what front matter contains: scalars, bracketed
 * lists, block lists, and **one** object deep. Nothing more stands there,
 * and handling more would mean allowing shapes the concept excludes.
 *
 * The one rule every line here carries: **a missing value stays missing.**
 * No `status` does not mean "maintained", no `reviewed` does not mean
 * "confirmed today", no `owner` does not mean "nobody responsible" — it
 * means the page does not declare the value.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

import aliases from "../../internal/wiki/locales/de.json";
import { reverseAliases } from "./aliases";

/** What a page may say about its state (the specification) — nothing else. */
export type WikiStatus = "draft" | "maintained" | "reviewed" | "outdated";

/** Read-only aliases for existing page status values. */
export const LEGACY_WIKI_STATUS = reverseAliases<WikiStatus>(aliases.status);

const STATUS: readonly WikiStatus[] = [
  "draft",
  "maintained",
  "reviewed",
  "outdated",
];

/**
 * The front matter, read.
 *
 * Every field is optional, but the intent behind that is not: what the page
 * does not say is not here — and not as a default that looks as if somebody
 * chose it.
 */
export type WikiFront = {
  title?: string;
  category?: string;
  tags?: string[];
  records?: string[];
  status?: WikiStatus;
  owner?: { team?: string };
  reviewed?: string;
  order?: number;
  summary?: string;
  aliases?: string[];
  mirror?: Record<string, string>;
};

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/**
 * Splits front matter and body.
 *
 * A file without front matter is not an error, but a page without a head —
 * it is shown, and its missing title is reported as missing. The body stays
 * byte-for-byte as it was written: an HTML comment in one of the example
 * pages explains why it deliberately carries no state, and discarding it on
 * read would mean showing a file that does not sit in the repository that way.
 */
export function splitFront(raw: string): { front: string; body: string } {
  const text = String(raw ?? "");
  const match = FENCE.exec(text);
  if (!match) return { front: "", body: text };
  return { front: match[1].trim(), body: text.slice(match[0].length) };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 1 && /^"[\s\S]*"$/.test(trimmed))
    return trimmed.slice(1, -1);
  if (trimmed.length > 1 && /^'[\s\S]*'$/.test(trimmed))
    return trimmed.slice(1, -1);
  return trimmed;
}

/**
 * Reads the front matter.
 *
 * What cannot be interpreted falls away rather than being guessed: a
 * `status` the concept does not know is not a fourth colour, but a value no
 * reader can place — it stands more honestly as "nobody explained the
 * state" than as its own label pretending to mean something.
 */
export function parseFront(front: string): WikiFront {
  const out: Record<string, unknown> = {};
  let key: string | null = null;

  for (const line of String(front ?? "").split("\n")) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const top = /^([a-z_]+):[ \t]*(.*)$/.exec(line);
    if (top) {
      key = top[1];
      const value = top[2].trim();
      if (value === "") {
        // A key without a value opens a block list or an object — which of
        // the two, only the next line says.
        out[key] = null;
        continue;
      }
      if (/^\[.*\]$/.test(value)) {
        out[key] = value
          .slice(1, -1)
          .split(",")
          .map((part) => unquote(part))
          .filter(Boolean);
        continue;
      }
      out[key] = /^\d+$/.test(value) ? Number(value) : unquote(value);
      continue;
    }

    if (!key) continue;

    const item = /^\s+-[ \t]+(.*)$/.exec(line);
    if (item) {
      if (!Array.isArray(out[key])) out[key] = [];
      (out[key] as string[]).push(unquote(item[1]));
      continue;
    }

    const sub = /^\s+([a-z_][a-z_-]*):[ \t]*(.*)$/.exec(line);
    if (sub) {
      const current = out[key];
      if (!current || typeof current !== "object" || Array.isArray(current))
        out[key] = {};
      (out[key] as Record<string, string>)[sub[1]] = unquote(sub[2]);
    }
  }

  if (!Object.hasOwn(out, "category"))
    out.category = out[aliases.fields.category];
  if (
    typeof out.status === "string" &&
    Object.hasOwn(LEGACY_WIKI_STATUS, out.status)
  ) {
    out.status = LEGACY_WIKI_STATUS[out.status];
  }
  const front_: WikiFront = {};
  if (typeof out.title === "string" && out.title) front_.title = out.title;
  if (typeof out.category === "string" && out.category)
    front_.category = out.category;
  if (Array.isArray(out.tags)) front_.tags = out.tags.map(String);
  if (Array.isArray(out.records)) front_.records = out.records.map(String);
  if (
    typeof out.status === "string" &&
    STATUS.includes(out.status as WikiStatus)
  ) {
    front_.status = out.status as WikiStatus;
  }
  if (out.owner && typeof out.owner === "object" && !Array.isArray(out.owner)) {
    front_.owner = out.owner as { team?: string };
  }
  if (typeof out.reviewed === "string" && out.reviewed)
    front_.reviewed = out.reviewed;
  if (typeof out.order === "number") front_.order = out.order;
  if (typeof out.summary === "string" && out.summary)
    front_.summary = out.summary;
  if (Array.isArray(out.aliases)) front_.aliases = out.aliases.map(String);
  if (
    out.mirror &&
    typeof out.mirror === "object" &&
    !Array.isArray(out.mirror)
  ) {
    front_.mirror = mirrorSettings(out.mirror as Record<string, string>);
  }
  return front_;
}

/** The mirror key that keeps a page out of a mirror run. */
export const NO_MIRROR = "no-mirror";

/** The German spelling of `no-mirror` older pages were written with. */
export const LEGACY_NO_MIRROR = aliases.fields["no-mirror"];

/**
 * The `mirror:` object with its keys in their current spelling.
 *
 * The localized key is normalized to `no-mirror`. When a page names both, the English
 * key wins: it is the one written today, and the old one is a leftover.
 */
function mirrorSettings(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      ![LEGACY_NO_MIRROR, aliases.fields.target, aliases.fields.space].includes(
        key,
      )
    )
      out[key] = value;
  }
  if (Object.hasOwn(raw, LEGACY_NO_MIRROR) && !Object.hasOwn(raw, NO_MIRROR)) {
    out[NO_MIRROR] = raw[LEGACY_NO_MIRROR];
  }
  for (const [old, english] of [
    [aliases.fields.target, "target"],
    [aliases.fields.space, "space"],
  ]) {
    if (Object.hasOwn(raw, old) && !Object.hasOwn(raw, english))
      out[english] = raw[old];
  }
  return out;
}
