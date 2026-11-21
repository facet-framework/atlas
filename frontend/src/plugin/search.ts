/** How a kind's mark looks. Named by appearance, not by kind: the core's own
 * kinds use the same set, and a tone called after a plugin would be the core
 * naming that plugin. */

export const SEARCH_TONES = [
  "filled",
  "green",
  "ink",
  "yellow",
  "quiet",
  "red",
  "surface",
  "tinted",
  "dashed-blue",
  "dashed",
] as const;

export type SearchTone = (typeof SEARCH_TONES)[number];

/** One hit as the palette draws it. */
export type SearchHit = {
  title: string;
  /** The second line below the title. */
  sub: string;
  /** The short tag at the right. */
  tag: string;
  /** What choosing the hit does. The palette closes itself before calling it. */
  open: () => void;
};

/** One kind of hit a plugin contributes. */
export type SearchSource = {
  /** The group heading above this kind's hits, and the chip's text. */
  label: string;
  /** The singular, as the mark's tooltip names one hit ("Notes page"). */
  singular: string;
  /** One character, drawn in the 20-px mark in front of every hit. */
  glyph: string;
  tone: SearchTone;

  hits: () => readonly SearchHit[] | null;
};

export type RegisteredSearchSource = SearchSource & {
  readonly kind: string;
  readonly plugin: string;
};

export class SearchRegistry {
  constructor(private readonly changed: () => void = () => {}) {}

  private sources: RegisteredSearchSource[] = [];

  /** Records that a plugin contributes a kind of hit. */

  register(
    plugin: string,
    reserved: ReadonlySet<string>,
    kind: string,
    source: SearchSource,
  ): (() => void) | null {
    if (reserved.has(kind)) return null;
    if (this.sources.some((s) => s.kind === kind)) return null;
    if (!(SEARCH_TONES as readonly string[]).includes(source.tone)) return null;
    const entry: RegisteredSearchSource = { ...source, kind, plugin };
    this.sources = [...this.sources, entry];
    this.changed();
    return () => {
      const at = this.sources.indexOf(entry);
      if (at >= 0) {
        this.sources = this.sources.filter((item) => item !== entry);
        this.changed();
      }
    };
  }

  /** Every contributed source, in registration order. */
  list(): readonly RegisteredSearchSource[] {
    return this.sources;
  }
}
