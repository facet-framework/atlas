/**
 * The markdown reader for a wiki page.
 *
 * **Why not the library's.** `core/markdown.ts` reads the answers Atlas gives
 * and deliberately cannot do tables — the reasoning stands there and holds
 * there: a model writing an answer does not write tables. A wiki page is the
 * opposite: all three example pages of the concept use tables, one of them
 * nine times, and two need a code block *inside* a list item. The library's
 * reader can do neither, and neither is decoration — both are the text
 * itself.
 *
 * What the library's reader can do, and what is reused here, is `parseInline`:
 * bold, italic, code and links within one line. There is no reason to write
 * that a second time and a good reason not to — two inline readers are two
 * answers to what `**x**` is.
 *
 * **What this cut does not do yet.** `atlas:` links and embeds belong to the
 * next cut. They are **recognised and shown as unresolved** —
 * neither left out nor drawn as dead. The difference is the house rule: "dead"
 * means somebody looked in the corpus and found nothing; here nobody looked.
 * Making the two look alike would put a claim about the corpus on the surface
 * that no measurement backs.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */

import aliases from "../../internal/wiki/locales/de.json";
import {
  isSafeHref,
  parseInline,
  type MdInline,
} from "../../../../frontend/src/plugin/components";

/**
 * A piece of a line.
 *
 * Two of its own beyond the library's four: `atlas` for a link into the corpus
 * that this cut does not resolve yet, and `unsafe` for a scheme nobody
 * allowed. Both are visible and neither is a click.
 */
export type WikiInline =
  | MdInline
  | { kind: "atlas"; text: string; target: string }
  | { kind: "unsafe"; text: string; href: string };

export type WikiListItem = { inline: WikiInline[]; blocks: WikiBlock[] };

export type WikiBlock =
  | { kind: "paragraph"; inline: WikiInline[] }
  /** `step` is the running number inside a guide, otherwise `null`. */
  | {
      kind: "heading";
      level: number;
      inline: WikiInline[];
      step: number | null;
    }
  | { kind: "list"; ordered: boolean; items: WikiListItem[] }
  | { kind: "code"; language: string; text: string }
  | { kind: "quote"; inline: WikiInline[] }
  | { kind: "table"; head: WikiInline[][]; rows: WikiInline[][][] }
  /** An `atlas` fence — in this cut its own YAML, visible. */
  | { kind: "embed"; yaml: string }
  | { kind: "rule" };

const FENCE = /^\s*```(\w*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const LIST = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE = /^\s*\|/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const STEP = /^(\d+)\.\s+(.*)$/;

/**
 * Translates the library's pieces into the wiki's.
 *
 * A link becomes exactly one of three things: an ordinary link (`http`/`https`,
 * as `isSafeHref` allows), an Atlas link this cut does not resolve yet, or a
 * refused scheme. Nothing falls away in the process — the text stays readable
 * in every case.
 */
function widen(parts: MdInline[]): WikiInline[] {
  return parts.map((part) => {
    if (part.kind !== "link") return part;
    if (/^atlas:/i.test(part.href)) {
      return {
        kind: "atlas" as const,
        text: part.text,
        target: part.href.replace(/^atlas:/i, ""),
      };
    }
    if (isSafeHref(part.href)) return part;
    return { kind: "unsafe" as const, text: part.text, href: part.href };
  });
}

const inline = (text: string): WikiInline[] => widen(parseInline(text));

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Breaks a page's body into blocks.
 *
 * `category` steers exactly one thing: whether a guide's `## n.` headings
 * carry their running number. That is why the category is a
 * closed set — a presentation rule over an open set of strings quietly stops
 * applying at some point.
 */
export function parsePage(body: string, category?: string | null): WikiBlock[] {
  const lines = String(body ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const out: WikiBlock[] = [];
  let i = 0;
  let step = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const language = fence[1] ?? "";
      const buffer: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) buffer.push(lines[i++]);
      i++;
      const text = buffer.join("\n");
      // An `atlas` fence is not code, even though it does not compute
      // anything in this cut: it keeps its own shape so the surface can show
      // it as what it is.
      out.push(
        language === "atlas"
          ? { kind: "embed", yaml: text }
          : { kind: "code", language, text },
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length + 1;
      const text = heading[2];
      const numbered =
        [aliases.categories.guide, "guide"].includes(category ?? "") &&
        level === 3
          ? STEP.exec(text)
          : null;
      out.push(
        numbered
          ? {
              kind: "heading",
              level,
              inline: inline(numbered[2]),
              step: ++step,
            }
          : { kind: "heading", level, inline: inline(text), step: null },
      );
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const buffer: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]))
        buffer.push(QUOTE.exec(lines[i++])![1]);
      out.push({ kind: "quote", inline: inline(buffer.join(" ").trim()) });
      continue;
    }

    if (TABLE.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && TABLE.test(lines[i])) rows.push(lines[i++]);
      const head = cells(rows[0]).map(inline);
      const body_ = rows
        .slice(1)
        // The separator row describes the table, it does not revision in it.
        .filter((row) => !/^\s*\|[\s:|-]*\|?\s*$/.test(row))
        .map((row) => cells(row).map(inline));
      out.push({ kind: "table", head, rows: body_ });
      continue;
    }

    if (RULE.test(line)) {
      out.push({ kind: "rule" });
      i++;
      continue;
    }

    const bullet = LIST.exec(line);
    if (bullet) {
      out.push(
        readList(
          lines,
          bullet[1].length,
          () => i,
          (next) => (i = next),
          category,
        ),
      );
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      paragraph.push(lines[i++].trim());
    }
    if (paragraph.length)
      out.push({ kind: "paragraph", inline: inline(paragraph.join(" ")) });
    else i++;
  }

  return out;
}

/**
 * A list, together with whatever hangs indented underneath it.
 *
 * The indented code block is why this stands here and not in three lines of
 * the main pass: the onboarding page writes "Run the linter" and,
 * indented underneath it, `facet lint`. A reader that gives the block to the
 * next item files the command under the wrong step — and a guide whose command
 * stands under the wrong step is worse than one with no command at all.
 */
function readList(
  lines: string[],
  indent: number,
  get: () => number,
  set: (next: number) => void,
  category?: string | null,
): WikiBlock {
  let i = get();
  const ordered = /\d/.test(LIST.exec(lines[i])![2]);
  const items: WikiListItem[] = [];
  let current: WikiListItem | null = null;
  let pending: string[] = [];

  const flush = () => {
    if (!current || !pending.length) return;
    // What stands indented under an item is read with the same reader as the
    // rest of the page — otherwise less could stand there than beside it,
    // without anybody having decided that.
    current.blocks.push(...parsePage(pending.join("\n"), category));
    pending = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const bullet = LIST.exec(line);
    if (bullet && bullet[1].length === indent) {
      flush();
      current = { inline: inline(bullet[3]), blocks: [] };
      items.push(current);
      i++;
      continue;
    }
    if (!line.trim()) {
      // A blank line ends the list only if nothing after it belongs to the
      // list any more. A paragraph of space before an indented block is the
      // shape markdown is written in.
      const next = lines[i + 1];
      if (next && (/^\s{2,}\S/.test(next) || LIST.test(next))) {
        if (/^\s{2,}\S/.test(next) && pending.length) pending.push("");
        i++;
        continue;
      }
      break;
    }
    if (/^\s{2,}/.test(line) && current) {
      pending.push(line.replace(/^\s{2,}/, ""));
      i++;
      continue;
    }
    break;
  }

  flush();
  set(i);
  return { kind: "list", ordered, items };
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    LIST.test(line) ||
    QUOTE.test(line) ||
    TABLE.test(line) ||
    RULE.test(line)
  );
}
