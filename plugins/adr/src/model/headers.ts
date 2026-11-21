import german from "../locales/de.json";
/** Read header fields before the first markdown separator. Missing values stay
 * absent; status parsing accepts the leading status word before a trailing date. */

/** The four states an ADR's own `**Status:**` line may name — nothing else. */
export type AdrStatus = "proposed" | "accepted" | "superseded" | "rejected";

const STATUS_WORDS: readonly AdrStatus[] = [
  "proposed",
  "accepted",
  "superseded",
  "rejected",
];

/** German terms accepted in external ADR documents. */

export const GERMAN_STATUS_WORDS: Readonly<Record<string, AdrStatus>> = {
  [german.proposed]: "proposed",
  [german.accepted]: "accepted",
  [german.superseded]: "superseded",
  [german.rejected]: "rejected",
};

/** One ADR's header lines, read. Every field absent from the file stays absent here. */
export type AdrHead = {
  title?: string;
  status?: AdrStatus;
  /** The status line's own text, verbatim — shown when the word is not one of the four known ones. */
  statusRaw?: string;
  date?: string;
  concerns?: string;
  measuredAgainst?: string;
  sources?: string;
};

const TITLE = /^#\s+(.+)$/m;
const FIELD = (name: string) =>
  new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`, "m");

const STATUS_LINE = FIELD("Status");
const DATE_LINE = FIELD("Date");
const CONCERNS_LINE = FIELD("Concerns");
const MEASURED_LINE = FIELD("Measured against");
const SOURCES_LINE = FIELD("Sources");

/** Pulls the leading word off a status line, case-insensitively, and matches
 * it against the four known ones or their German aliases. `"accepted
 * (2026-09-26)"` and `"accepted, 2026-09-20"` both read as `"accepted"`;
 * anything that does not start with one of the known words is not guessed at
 * all. */

export function knownStatus(raw: string): AdrStatus | undefined {
  const leading = /^([^\s,(]+)/.exec(raw.trim());
  if (!leading) return undefined;
  const word = leading[1].toLowerCase();
  const known = STATUS_WORDS.find((status) => status === word);
  if (known) return known;
  // Own keys only: "constructor" is not a German status word.
  return Object.hasOwn(GERMAN_STATUS_WORDS, word)
    ? GERMAN_STATUS_WORDS[word]
    : undefined;
}

/** Reads one ADR file's header lines out of its raw markdown body. */
export function parseHead(body: string): AdrHead {
  const text = String(body ?? "");
  const head: AdrHead = {};

  const title = TITLE.exec(text);
  if (title) head.title = title[1].trim();

  const status = STATUS_LINE.exec(text);
  if (status) {
    head.statusRaw = status[1].trim();
    const word = knownStatus(status[1]);
    if (word) head.status = word;
    const inlineDate = /(?:,\s*|\()([0-9]{4}-[0-9]{2}-[0-9]{2})\)?\s*$/.exec(
      status[1],
    );
    if (inlineDate) head.date = inlineDate[1];
  }

  const date = DATE_LINE.exec(text) ?? FIELD(german.date).exec(text);
  if (date) head.date = date[1].trim();

  const concerns =
    CONCERNS_LINE.exec(text) ?? FIELD(german.concerns).exec(text);
  if (concerns) head.concerns = concerns[1].trim();

  const measuredAgainst =
    MEASURED_LINE.exec(text) ?? FIELD(german.measuredAgainst).exec(text);
  if (measuredAgainst) head.measuredAgainst = measuredAgainst[1].trim();

  const sources = SOURCES_LINE.exec(text) ?? FIELD(german.sources).exec(text);
  if (sources) head.sources = sources[1].trim();

  return head;
}
