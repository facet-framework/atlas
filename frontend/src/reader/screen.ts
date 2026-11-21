/** What the page shows, as Markdown, for the chat to hand to the agent. */

import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";

/** The most characters one question carries; the host refuses more. */
export const SCREEN_LIMIT = 24_000;

/** Where the host takes the screen before the question is asked. */
export const SCREEN_PATH = "/api/companion/screen";

/** One page's content as the host stores it. */
export type Screen = { markdown: string; page: string };

/** Elements whose content is never what the page shows. */
const SKIPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
  "OBJECT",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "DIALOG",
  "NAV",
]);

/** Roles of the shell's furniture and of layers over the page. */
const SKIPPED_ROLES = new Set([
  "navigation",
  "dialog",
  "alertdialog",
  "menu",
  "menubar",
  "tooltip",
]);

/** ARIA table roles, drawn as the table elements they stand for. */
const TABLE_ROLES: Record<string, string> = {
  table: "TABLE",
  grid: "TABLE",
  rowgroup: "TBODY",
  row: "TR",
  columnheader: "TH",
  rowheader: "TH",
  cell: "TD",
  gridcell: "TD",
};

/** Inside a table cell these would turn the table into HTML; they are flattened. */
const BLOCKS_IN_CELLS = new Set([
  "UL",
  "OL",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "BLOCKQUOTE",
  "PRE",
  "P",
  "DIV",
]);

/** The shell's main region in this document, or null before the shell is drawn. */
export function screenRoot(doc: Document = document): Element | null {
  return doc.querySelector('[data-testid="app-shell"] main') ?? doc.querySelector("main");
}

function hidden(el: Element): boolean {
  if (el.hasAttribute("hidden") || el.hasAttribute("inert")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden";
}

function words(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** The accessible name an element states itself: its label, or what it points to. */
function labelOf(el: Element): string {
  const label = words(el.getAttribute("aria-label"));
  if (label) return label;
  const ids = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  return words(ids.map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" "));
}

/** The words an SVG `<text>` writes; its wrapped lines (`<tspan>`) are words apart. */
function svgWords(text: Element): string {
  const lines = Array.from(text.querySelectorAll("tspan"));
  return lines.length ? words(lines.map((l) => l.textContent).join(" ")) : words(text.textContent);
}

/** A drawing as text: its name, then the names of what it draws — labelled
 * marks and the words it writes. Null when it says nothing (an icon). */

function drawing(el: Element, doc: Document): Element | null {
  const own = labelOf(el) || words(el.querySelector(":scope > title")?.textContent);
  const items: string[] = [];
  const seen = new Set<string>();
  const add = (text: string) => {
    if (text && text !== own && !seen.has(text)) {
      seen.add(text);
      items.push(text);
    }
  };
  for (const mark of Array.from(el.querySelectorAll("[aria-label], [aria-labelledby], text"))) {
    if (mark.closest('[aria-hidden="true"]')) continue;
    add(mark.tagName.toLowerCase() === "text" ? svgWords(mark) : labelOf(mark));
  }
  if (el.tagName === "CANVAS") add(words(el.textContent));
  if (!own && !items.length) return null;
  const box = doc.createElement("div");
  if (own) {
    const p = doc.createElement("p");
    p.textContent = own;
    box.appendChild(p);
  }
  if (items.length) {
    const list = doc.createElement("ul");
    for (const item of items) {
      const li = doc.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    }
    box.appendChild(list);
  }
  return box;
}

/** A copy of what the reader sees under `node`, as plain HTML elements: hidden
 * and furniture elements left out, drawings as text, ARIA tables as tables. */

function copy(node: Node, doc: Document, inCell: boolean): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (SKIPPED_TAGS.has(tag)) return null;
  const role = el.getAttribute("role") ?? "";
  if (SKIPPED_ROLES.has(role)) return null;
  if (hidden(el)) return null;
  if (tag === "SVG" || tag === "CANVAS" || role === "img") {
    if (tag === "SVG" || tag === "CANVAS") return drawing(el, doc);
    const label = labelOf(el);
    return label ? doc.createTextNode(` ${label} `) : null;
  }
  // An unmeasured value: the dash, and what it means.
  const title = words(el.getAttribute("title"));
  if (title && words(el.textContent) === "—") return doc.createTextNode(`— (${title})`);

  let name = TABLE_ROLES[role] ?? tag;
  if (role === "heading")
    name = `H${Math.min(6, Math.max(1, Number(el.getAttribute("aria-level")) || 2))}`;
  if (inCell && BLOCKS_IN_CELLS.has(name)) name = "SPAN";
  const out = doc.createElement(name);
  if (name === "A" && el.getAttribute("href")) out.setAttribute("href", el.getAttribute("href")!);
  // A closed disclosure shows its summary only.
  const closed = tag === "DETAILS" && !(el as HTMLDetailsElement).open;
  copyChildren(el, out, inCell || name === "TD" || name === "TH", closed);
  return out;
}

/** Copies the children of `from` into `out`. Two elements side by side are
 * kept apart by a space: on the page a gap or a line keeps them apart, and
 * without it a value and its label run together ("12Records"). */

function copyChildren(from: Node, out: Element, inCell: boolean, closed = false) {
  const doc = out.ownerDocument;
  for (const child of Array.from(from.childNodes)) {
    if (closed && !(child instanceof Element && child.tagName === "SUMMARY")) continue;
    const copied = copy(child, doc, inCell);
    if (!copied) continue;
    if (copied.nodeType === Node.ELEMENT_NODE && out.lastChild?.nodeType === Node.ELEMENT_NODE) {
      out.appendChild(doc.createTextNode(" "));
    }
    out.appendChild(copied);
  }
}

let service: TurndownService | null = null;

function turndown(): TurndownService {
  if (service) return service;
  service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  service.use(gfm);
  // Images carry no words the reader reads; their alternative text is enough.
  service.addRule("image", {
    filter: "img",
    replacement: (_content, node) => {
      const alt = words((node as Element).getAttribute("alt"));
      return alt ? ` ${alt} ` : "";
    },
  });
  return service;
}

/** Cuts at a line before the limit and says so on the last line. */
function cap(markdown: string, limit: number): string {
  if (markdown.length <= limit) return markdown;
  const note = `\n\n[Cut: the page continues beyond ${limit} characters.]`;
  const room = limit - note.length;
  const at = markdown.lastIndexOf("\n", room);
  return markdown.slice(0, at > room / 2 ? at : room).trimEnd() + note;
}

/** The content under `root` as Markdown, at most `limit` characters. Empty
 * when there is no root or it shows nothing. */

export function exportScreen(root: Element | null, limit: number = SCREEN_LIMIT): string {
  if (!root) return "";
  const doc = root.ownerDocument;
  const body = doc.createElement("div");
  copyChildren(root, body, false);
  const markdown = turndown()
    .turndown(body)
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cap(markdown, limit);
}

/** Posts the screen and returns the id the question carries, or null when the
 * host did not take it. Never throws: a question asks without the screen
 * rather than not at all. */

export async function postScreen(shot: Screen): Promise<string | null> {
  try {
    const res = await fetch(SCREEN_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shot),
    });
    if (!res.ok) return null;
    const answer = (await res.json()) as { id?: unknown };
    return typeof answer.id === "string" ? answer.id : null;
  } catch {
    return null;
  }
}
