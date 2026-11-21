import { tx } from "@/i18n";
import type { SearchTone } from "../plugin/search";

export type CoreKind = {
  id: string;
  /** Group heading above the hits. */
  label: () => string;
  /** One hit, as the mark's tooltip names it. */
  singular: () => string;
  glyph: string;
  tone: SearchTone;
  /** The chip's text, or null for a kind that has no chip. */
  chip: (() => string) | null;
};

export const CORE_KINDS = {
  features: {
    id: "features",
    label: () => tx("ui.chrome.search-kinds-features"),
    singular: () => tx("ui.chrome.search-kinds-record"),
    glyph: "▣",
    tone: "filled",
    chip: () => tx("ui.chrome.search-kinds-records"),
  },
  promises: {
    id: "promises",
    label: () => tx("ui.chrome.search-kinds-promises"),
    singular: () => tx("ui.chrome.search-kinds-promise"),
    glyph: "●",
    tone: "green",
    chip: () => tx("ui.chrome.search-kinds-promises"),
  },
  glossary: {
    id: "glossary",
    label: () => tx("ui.chrome.search-kinds-glossary"),
    singular: () => tx("ui.chrome.search-kinds-term"),
    glyph: "≡",
    tone: "tinted",
    chip: () => tx("ui.chrome.search-kinds-glossary"),
  },
  anchor: {
    id: "anchor",
    label: () => tx("ui.chrome.search-kinds-anchors"),
    singular: () => tx("ui.chrome.search-kinds-anchors"),
    glyph: "⌗",
    tone: "ink",
    chip: () => tx("ui.chrome.search-kinds-anchors"),
  },
  rules: {
    id: "rules",
    label: () => tx("ui.chrome.search-kinds-rules-assumptions-data"),
    singular: () => tx("ui.chrome.search-kinds-rule"),
    glyph: "§",
    tone: "yellow",
    chip: () => tx("ui.chrome.search-kinds-rules"),
  },
  contents: {
    id: "contents",
    label: () => tx("ui.chrome.search-kinds-contents"),
    singular: () => tx("ui.chrome.search-kinds-content-kind"),
    glyph: "⌗",
    tone: "dashed",
    chip: () => tx("ui.chrome.search-kinds-contents"),
  },
  files: {
    id: "files",
    label: () => tx("ui.chrome.search-kinds-files-without-record"),
    singular: () => tx("ui.chrome.search-kinds-file"),
    glyph: "▤",
    tone: "quiet",
    chip: null,
  },
  orphans: {
    id: "orphans",
    label: () => tx("ui.chrome.search-kinds-orphan-anchors"),
    singular: () => tx("ui.chrome.search-kinds-orphan"),
    glyph: "⌗",
    tone: "red",
    chip: null,
  },
  settings: {
    id: "settings",
    label: () => tx("ui.chrome.search-kinds-settings"),
    singular: () => tx("ui.chrome.search-kinds-setting"),
    glyph: "⚙",
    tone: "quiet",
    chip: null,
  },
} satisfies Record<string, CoreKind>;

export type CoreKindId = keyof typeof CORE_KINDS;

/** The ids a plugin's search source may not take. */
export const CORE_SEARCH_KIND_IDS: ReadonlySet<string> = new Set(Object.keys(CORE_KINDS));
