/**
 * What a page cites, held against the corpus of this run.
 *
 * Cut A drew every `atlas:` reference as **unresolved** and named the
 * difference while doing so: "dead" means somebody looked in the corpus and
 * found nothing; "unresolved" means nobody looked. This file is the
 * looking. Each reference is
 * either a jump or a finding.
 *
 * It computes and does not draw. That is not tidiness for its own sake: the
 * question "does this reference resolve" is asked in two places — in running
 * text, where an answer is drawn, and in the maintenance report, where the
 * same answer is counted. Two implementations of it would be two answers, and
 * the number in the report would contradict what stands in the text.
 *
 * **The hard rule that binds everything here** (the specification): an embed names
 * a **selector** over the corpus, never a **value**. Allowed are `record:`,
 * `promise:`, `domain:`, `team:`, `tag:`, `assumption:` and the display
 * switches; forbidden is anything carrying a number. A Markdown file is the
 * easiest place in the whole system to type a number, and a typed number in a
 * measured component cannot be told apart from a measured one.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */

import { tx } from "@/i18n";
import aliases from "../../internal/wiki/locales/de.json";
import { reverseAliases } from "../model/aliases";
import {
  parseYaml,
  type YamlValue,
} from "../../../../frontend/src/plugin/components";
import {
  STATE_LABEL,
  type DerivedFeature,
  type DerivedModel,
  type DerivedScenario,
} from "../../../../frontend/src/plugin/components";
import { WikiAddress } from "../model/address";
import type { WikiModel } from "../model/model";

/** "a: or b:" — the selector names an embed takes, joined by the active language's "or". */
function orList(names: readonly string[]): string {
  return names
    .map((x) => `${x}:`)
    .join(` ${tx("ui.wiki-src-wiki.citations-or")} `);
}

/* ──────────────────────────────────────────────────────────────────────────
 * References
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The closed list of targets.
 *
 * Closed, because every target has to be resolvable and drawable — an open
 * scheme would mean references the reader cannot check. What is not here is
 * therefore not an unknown target but no target at all.
 */
/** Read-only address aliases; generated addresses always use English. */
export const LEGACY_REF_KINDS = reverseAliases(aliases.references);

/** Existing embedding selectors normalize before validation and resolution. */
export const LEGACY_EMBED_KEYS = reverseAliases(aliases.selectors);

export const REF_KINDS = [
  "record",
  "promise",
  "anchor",
  "file",
  "term",
  "contents",
  "role",
  "wiki",
] as const;
export type RefKind = (typeof REF_KINDS)[number];

/** Where a resolved reference jumps — the surface decides how. */
export type RefTarget =
  | { to: "record"; id: string }
  | { to: "promise"; id: string; sid: string }
  | { to: "catalogue"; kind: string; id: string | null }
  | { to: "term"; term: string }
  | { to: "role"; key: string }
  | { to: "wiki"; address: string };

export type WikiRef =
  | {
      dead: false;
      kind: RefKind;
      /** The part after `atlas:` — the address as it stands in the page. */
      target: string;
      jump: RefTarget;
      /**
       * What the reference resolved to — and in what shape it is drawn.
       *
       * Two shapes, because the draft draws two: a record carries its
       * **lifecycle mark** as a word (`.wtag`), a promise its **state of
       * proof** as a dot (`.wdot`) in the colour the ledger gives it
       * everywhere else. Pulling both into one mark would mean showing an
       * unproven promise in the colour of a redeemed one — the proof colours
       * are not the lifecycle colours.
       *
       * It comes from the corpus and never from the text: the specification expressly
       * allows a reference to carry a **measured** number, and forbids it any
       * that stood in the page.
       */
      mark:
        | { as: "tag"; label: string; kind: string }
        | { as: "dot"; label: string; kind: string }
        | null;
      /** The answer for the tooltip — measured, not written. */
      note: string | null;
    }
  | {
      dead: true;
      kind: RefKind | null;
      target: string;
      /** Why nothing was found — the quiet mono aside in the sentence. */
      why: string;
    };

/** What a reference has to ask of this run's corpus. */
export type Corpus = { v: DerivedModel; wiki: WikiModel | null };

const SHORT = (id: string): string => id.split("/").pop() ?? id;

/**
 * Resolves an `atlas:` reference.
 *
 * `target` is the part **after** `atlas:` — the way `markdown.ts` cuts it out
 * of the line. The split is deliberate: the markdown reader recognises the
 * scheme, only the corpus knows the content.
 */
export function resolveRef(target: string, k: Corpus): WikiRef {
  const raw = String(target ?? "");
  const cut = raw.indexOf("/");
  const rawKind = cut > 0 ? raw.slice(0, cut) : "";
  const kind = (
    Object.hasOwn(LEGACY_REF_KINDS, rawKind)
      ? LEGACY_REF_KINDS[rawKind]
      : rawKind
  ) as RefKind;
  const input = cut > 0 ? raw.slice(cut + 1) : "";
  const rest = kind === "contents" ? input : kind === "role" ? input : input;
  if (!REF_KINDS.includes(kind) || !rest) {
    // No target from this list. Not "not found": nothing lookupable was
    // named, and that is a different answer from a target that does not
    // exist.
    return {
      dead: true,
      kind: null,
      target: raw,
      why: tx("ui.wiki-src-wiki.citations-not-atlas-target"),
    };
  }

  switch (kind) {
    case "record": {
      const f = k.v.byId[rest];
      if (!f)
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-record-does-not-exist-registry"),
        );
      return {
        dead: false,
        kind,
        target: raw,
        jump: { to: "record", id: f.id },
        mark: { as: "tag", label: f.life, kind: f.life },
        // The ratio stands only where there is one: a record with no promise
        // at all has no share, and "0/0 named by a test" would be an answer about a
        // measurement that does not exist.
        // The fraction form (`4/6 named by a test`) avoids singular/plural
        // agreement errors at one promise and matches ratios elsewhere in Atlas.
        note: f.claims
          ? `Record · ${tx("ui.wiki-src-wiki.citations-proven-claims-named-test", { proven: f.proven, claims: f.claims })}`
          : tx("ui.wiki-src-wiki.citations-record-no-promise"),
      };
    }
    case "promise": {
      const hash = rest.indexOf("#");
      const fid = hash < 0 ? rest : rest.slice(0, hash);
      const sid = hash < 0 ? "" : rest.slice(hash + 1);
      const f = k.v.byId[fid];
      // Three different answers, because they send the reader to three
      // different places: no record, no promise named, promise not in the
      // record. One shared wording would be more convenient and less true.
      if (!f)
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-record-does-not-exist-registry"),
        );
      if (!sid)
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-reference-names-no-promise"),
        );
      const s = f.scen.find((x) => x.id === sid);
      if (!s)
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-record-does-not-name-promise"),
        );
      return {
        dead: false,
        kind,
        target: raw,
        jump: { to: "promise", id: f.id, sid },
        // The dot carries the ledger's proof colour; the word stands in the
        // title so it is readable without colour too.
        mark: { as: "dot", label: scenarioWord(s), kind: s.state },
        note: tx("ui.wiki-src-wiki.citations-promise-state", {
          state: scenarioWord(s),
        }),
      };
    }
    case "wiki": {
      const address = WikiAddress(rest);
      // Without a loaded wiki nobody looked. "This page does not exist"
      // would then be a finding about a body of pages this surface does not
      // know at all — exactly the confusion of unmeasured and absent that
      // this cut keeps apart everywhere else.
      if (!k.wiki)
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-no-wiki-loaded-here"),
        );
      const p = k.wiki.byAddress(address);
      if (!p)
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-page-does-not-exist"),
        );
      return {
        dead: false,
        kind,
        target: raw,
        jump: { to: "wiki", address },
        mark: null,
        note: p.summary || p.title,
      };
    }
    case "term": {
      const term = safeDecode(rest);
      const hit = k.v.glossary?.terms.find((g) => g.term === term);
      // Without a glossary this is not "no such term": the project declared
      // none, so nobody looked, and the sentence says so.
      if (!k.v.glossary)
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-project-has-no-glossary"),
        );
      if (!hit)
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-glossary-does-not-declare-term"),
        );
      return {
        dead: false,
        kind,
        target: raw,
        jump: { to: "term", term },
        mark: null,
        note: hit.definition.split("\n")[0],
      };
    }
    case "contents": {
      if (!CATALOGUE_KINDS.has(rest))
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-kind-content-does-not-exist"),
        );
      return {
        dead: false,
        kind,
        target: raw,
        jump: { to: "catalogue", kind: rest, id: null },
        mark: null,
        note: null,
      };
    }
    case "anchor": {
      // An anchor is named at its place — `path:line`. The search runs
      // against the run's anchors and not against the file list: the
      // reference points at an entry, and an entry that does not exist is
      // dead.
      const hit = k.v.M.some((f) =>
        f.anchors.some((a) => `${a.path}:${a.line}` === rest),
      );
      if (!hit)
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-run-did-not-read-anchor"),
        );
      return {
        dead: false,
        kind,
        target: raw,
        jump: { to: "catalogue", kind: "anchor", id: rest },
        mark: null,
        note: null,
      };
    }
    case "file": {
      const scan = k.v.model.scan;
      const seen = [
        ...(scan.anchoredFiles ?? []),
        ...(scan.unanchoredFiles ?? []),
      ];
      // A host without file lists sent none — then "this file does not
      // exist" is a claim about a scan that did not count.
      if (!scan.anchoredFiles && !scan.unanchoredFiles) {
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-run-sent-no-file-list"),
        );
      }
      if (!seen.some((file) => file.path === rest)) {
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-run-did-not-read-file"),
        );
      }
      return {
        dead: false,
        kind,
        target: raw,
        jump: { to: "catalogue", kind: "files", id: rest },
        mark: null,
        note: null,
      };
    }
    case "role": {
      if (!ROLE_KEYS.has(rest))
        return dead(
          kind,
          raw,
          tx("ui.wiki-src-wiki.citations-role-does-not-exist"),
        );
      return {
        dead: false,
        kind,
        target: raw,
        jump: { to: "role", key: rest },
        mark: null,
        note: null,
      };
    }
  }
}

function dead(kind: RefKind, target: string, why: string): WikiRef {
  return { dead: true, kind, target, why };
}

/** A promise's state of proof in one word — a deviation is not one. */
function scenarioWord(s: DerivedScenario): string {
  return s.state === "dev"
    ? tx("ui.wiki-src-wiki.citations-deviation")
    : STATE_LABEL[s.state];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A broken percent escape is no reason not to draw the whole page —
    // the term then stands there as it was written.
    return value;
  }
}

/**
 * The kinds of content and the roles a reference is resolved against.
 *
 * They stand here as names and not as an import of the catalogue or of the
 * role table: both are modules over surfaces, and a reference resolver that
 * pulled them in would pull their surfaces into every check that reads a line
 * of prose. The lists are small, closed, and held against the real ones by
 * `references.spec.ts` — when one of those grows, the check here fails.
 */
const CATALOGUE_KINDS = new Set([
  "records",
  "promises",
  "knowledge",
  "operations",
  "provenance",
  "taxonomy",
  "calibration",
  "tests",
  "deviations",
  "drift",
  "fixed",
  "anchor",
  "files",
  "rules",
  "assumptions",
  "data-shapes",
  "teams",
  "glossary",
  "wiki",
  "decisions",
  "configuration",
  "validation",
  "cycles",
  "run",
]);

const ROLE_KEYS = new Set([
  "leadership",
  "dev",
  "review",
  "author",
  "owner",
  "newcomer",
  "agent",
]);

/* ──────────────────────────────────────────────────────────────────────────
 * Embeds
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The allowlist (the specification) — as the table the concept writes.
 *
 * Sixteen components, and the rule behind it is a rule and not a convenience:
 * **a component is embeddable exactly when the corpus can fill its inputs.**
 * Whoever may embed `StatValue`, `Counter` or `Bar` may invent numbers;
 * whoever may embed `Palette` or `Sheet` rearranges, from inside a paragraph,
 * the surface surrounding it.
 *
 * **`accepts` is the "selector" column from the specification, in its order**, and it does
 * two things. It says which selectors a component can answer at all —
 * `ProofMatrix` takes `record:` and nothing else, so `ProofMatrix` with
 * `domain:` is not an empty measurement but a question this component does
 * not ask. And it decides precedence where a page names several: the **first
 * of the row** wins, not the first of a global chain. That is why on
 * `EntryCards` a `tag:` beats a `domain:` (the way the draft draws it) and on
 * `CoverageRing` a `record:` beats a `domain:`.
 *
 * `none` says whether the component has a question without any selector at all
 * — for the three that may compute over the whole run. One that has none and
 * computed over everything anyway would show a different measurement from the
 * one meant.
 */
export const EMBEDDABLE = {
  ProofMatrix: { accepts: ["record"], optional: false },
  ScenarioLedger: { accepts: ["record"], optional: false },
  GherkinStatement: { accepts: ["promise"], optional: false },
  KnowledgeSlots: { accepts: ["record"], optional: false },
  AnchorMap: { accepts: ["record"], optional: false },
  Seal: { accepts: ["record"], optional: false },
  CoverageRing: { accepts: ["record", "area", "team"], optional: false },
  LifecycleBadge: { accepts: ["record"], optional: false },
  RecordSource: { accepts: ["record"], optional: false },
  DependencyFan: { accepts: ["record"], optional: false },
  // the specification: `domain:` or *(all)* — the wall of tiles over the whole run is a
  // question that explains itself.
  GroupTiles: { accepts: ["area"], optional: true },
  // The draft lets `tag:` win here (`atlas-app-wiki.js`, EntryCards).
  EntryCards: { accepts: ["tag", "area"], optional: false },
  Timeline: { accepts: ["record"], optional: true },
  TestPyramid: { accepts: ["record"], optional: true },
  EvidenceLedger: { accepts: ["assumption"], optional: false },
  Trail: { accepts: ["record"], optional: false },
} as const;

export type EmbedComponent = keyof typeof EMBEDDABLE;

/** A component's selectors, in the order in which they win. */
export function acceptsSelectors(c: EmbedComponent): readonly string[] {
  return EMBEDDABLE[c].accepts as readonly string[];
}

/**
 * Which keys a fenced block may carry.
 *
 * Two lists, and the split is the specification: **selectors** say what is computed over,
 * **switches** say what the result looks like. What is in neither is unknown —
 * and a key carrying a number is more than unknown, it is the mistake the specification
 * warns about.
 */
/*
 * The selectors the specification allows as selectors.
 *
 * `file:` stands here although **no** row of the allowlist takes it: the specification
 * names it among the allowed selectors, the specification gives it to no component. This
 * list is the answer to "is that a selector at all", the component's row the
 * answer to "can this component answer it". Taking `file:` out would give a
 * page that writes it the sentence "neither a selector nor a display switch"
 * — and that would be false: it is one, only none of the sixteen takes it.
 */
const SELECTORS = [
  "record",
  "promise",
  "area",
  "team",
  "tag",
  "file",
  "assumption",
] as const;
const SWITCHES = [
  "component",
  "title",
  "only-gaps",
  "compact",
  "height",
] as const;

/**
 * Keys that carry a **value** instead of a selector.
 *
 * They stand there by name rather than meaning "everything unknown is a
 * value", because the two cases deserve different sentences: a `value:` is the
 * rule violation from the specification. Unrecognized selectors have a separate validation error.
 */
const VALUE_KEYS = [
  "value",
  "number",
  "percent",
  "share",
  "ratio",
  "count",
  "scenarios",
  "data",
];

export type WikiEmbed =
  | {
      dead: false;
      component: EmbedComponent;
      /** The title above the figure — `null` where none stands. */
      title: string | null;
      /** The provenance line: what was selected, in words (the specification). */
      selector: string;
      /** Show only gaps (`gaps-only: true`). */
      onlyGaps: boolean;
      /** What is computed over — already resolved, so the surface searches nothing. */
      pick: EmbedPick;
    }
  | {
      dead: true;
      /** The fenced block, verbatim — it stays visible (the specification). */
      yaml: string;
      why: string;
      /** The key at fault — for the place that highlights it. */
      key: string | null;
      /**
       * Whether the block is **not at all** a fenced block of this kind: an
       * unknown component keeps its fence and gets a line below it (the specification case
       * 3), while a selector that does not resolve stands as a dead block with
       * a red border (case 2). Two states, two drawings.
       */
      fence: boolean;
    };

/** What an embed computes over — resolved, never as a search order. */
export type EmbedPick =
  | { over: "record"; f: DerivedFeature }
  | { over: "promise"; f: DerivedFeature; s: DerivedScenario }
  | { over: "list"; list: DerivedFeature[] }
  | { over: "assumption"; id: string; rule: string; features: string[] };

/**
 * Reads an ```atlas fence and resolves it against the corpus.
 *
 * The order of the checks is itself a statement. The value first:
 * `component: ProofMatrix` with `value: 87` must not pass as "ProofMatrix"
 * and carry the number along on the side. Then the component, then the
 * selector — an unknown record under an unknown component is first an unknown
 * component, because that is the mistake the author made.
 */
export function resolveEmbed(yaml: string, k: Corpus): WikiEmbed {
  const text = String(yaml ?? "");

  let doc: YamlValue;
  try {
    doc = parseYaml(text);
  } catch (caught) {
    // What does not parse stays where it is. An empty patch in this place
    // would suppress the fact that the author wrote something here, and the
    // reader could not tell an empty block from a broken one.
    const why = caught instanceof Error ? caught.message : String(caught);
    return {
      dead: true,
      yaml: text,
      why: tx("ui.wiki-src-wiki.citations-block-not-yaml-why", { why }),
      key: null,
      fence: false,
    };
  }

  const cfg =
    doc && typeof doc === "object" && !Array.isArray(doc)
      ? (doc as Record<string, YamlValue>)
      : {};
  for (const [old, english] of Object.entries(LEGACY_EMBED_KEYS)) {
    if (!Object.hasOwn(cfg, old)) continue;
    if (!Object.hasOwn(cfg, english)) cfg[english] = cfg[old];
    delete cfg[old];
  }
  const keys = Object.keys(cfg);

  if (!keys.length) {
    return {
      dead: true,
      yaml: text,
      why: tx(
        "ui.wiki-src-wiki.citations-block-names-no-component-no-selector",
      ),
      key: null,
      fence: false,
    };
  }

  // the specification: a value instead of a selector — this feature's most expensive
  // mistake, and so the first one looked for.
  const valueKey = keys.find((key) => VALUE_KEYS.includes(key));
  if (valueKey) {
    return {
      dead: true,
      yaml: text,
      why: tx(
        "ui.wiki-src-wiki.citations-valuekey-value-not-selector-embed-names",
        {
          valueKey,
        },
      ),
      key: valueKey,
      fence: false,
    };
  }

  const name = typeof cfg.component === "string" ? cfg.component.trim() : "";
  if (!name) {
    return {
      dead: true,
      yaml: text,
      why: tx("ui.wiki-src-wiki.citations-block-names-no-component"),
      key: null,
      fence: false,
    };
  }
  // `Object.hasOwn` and not `in`: `in` also finds what every object
  // inherits. `component: constructor` would otherwise pass and draw an
  // empty figure with the provenance line `CONSTRUCTOR · all records · from
  // the run of …` — a measurement over a name nobody declared.
  if (!Object.hasOwn(EMBEDDABLE, name)) {
    // the specification case 3: the fence stays a fence. The component has not "failed"
    // — it is not embeddable, and that is a rule and not the failure a red
    // border would claim.
    return {
      dead: true,
      yaml: text,
      why: tx("ui.wiki-src-wiki.citations-name-not-embeddable-component", {
        name,
      }),
      key: "component",
      fence: true,
    };
  }
  const component = name as EmbedComponent;

  const unknown = keys.find(
    (key) =>
      !(SELECTORS as readonly string[]).includes(key) &&
      !(SWITCHES as readonly string[]).includes(key),
  );
  if (unknown) {
    return {
      dead: true,
      yaml: text,
      why: tx(
        "ui.wiki-src-wiki.citations-unknown-neither-selector-nor-display-switch",
        {
          unknown,
        },
      ),
      key: unknown,
      fence: false,
    };
  }

  const title =
    typeof cfg.title === "string" && cfg.title.trim() ? cfg.title.trim() : null;
  const onlyGaps = cfg["only-gaps"] === true || cfg["only-gaps"] === "true";
  const fail = (why: string, key: string): WikiEmbed => ({
    dead: true,
    yaml: text,
    why,
    key,
    fence: false,
  });
  const text_ = (key: string): string =>
    typeof cfg[key] === "string" ? (cfg[key] as string).trim() : "";

  /*
   * Which selector holds — the **component's**, not one from a global
   * chain.
   *
   * the specification gives every component its column, and the row decides two things:
   * what it can answer and what wins where several stand. A fixed chain
   * across all components was the first attempt's mistake: it let
   * `ProofMatrix` with `domain:` pass as an **empty measurement** — a living
   * figure with a provenance line under a computation that never happened —
   * and it reversed the draft's precedence on `EntryCards`.
   *
   * A named selector this component does not take is therefore not a detail
   * that disappears without a word, but a dead block: the page asks a
   * question this component does not ask.
   */
  const named = (SELECTORS as readonly string[]).filter((key) => text_(key));
  const accepts = acceptsSelectors(component);
  const foreign = named.find((key) => !accepts.includes(key));
  if (foreign) {
    return fail(
      tx("ui.wiki-src-wiki.citations-component-takes-takes-not-other", {
        component,
        takes: orList(accepts),
        other: foreign,
      }),
      foreign,
    );
  }
  // The first of the row wins. What still stands after it is not passed
  // over in silence: two selectors are two questions, and the surface would
  // answer one of them without saying which.
  const chosen = accepts.filter((key) => named.includes(key));
  if (chosen.length > 1) {
    return fail(
      tx("ui.wiki-src-wiki.citations-block-names-two-selectors-first-second", {
        first: chosen[0],
        second: chosen[1],
      }),
      chosen[1],
    );
  }
  const sel = chosen[0] ?? null;

  if (sel === "promise") {
    const promise = text_("promise");
    const hash = promise.indexOf("#");
    const fid = hash < 0 ? promise : promise.slice(0, hash);
    const sid = hash < 0 ? "" : promise.slice(hash + 1);
    const f = k.v.byId[fid];
    if (!f)
      return fail(
        tx("ui.wiki-src-wiki.citations-record-does-not-exist-registry-id", {
          id: fid,
        }),
        "promise",
      );
    if (!sid)
      return fail(
        tx("ui.wiki-src-wiki.citations-selector-names-no-promise-selector", {
          selector: promise,
        }),
        "promise",
      );
    const s = f.scen.find((x) => x.id === sid);
    if (!s)
      return fail(
        tx("ui.wiki-src-wiki.citations-record-does-not-name-promise-id", {
          id: sid,
        }),
        "promise",
      );
    return ok({ over: "promise", f, s }, `${SHORT(f.id)}#${sid}`);
  }

  if (sel === "record") {
    const record = text_("record");
    const f = k.v.byId[record];
    if (!f)
      return fail(
        tx("ui.wiki-src-wiki.citations-record-does-not-exist-registry-id", {
          id: record,
        }),
        "record",
      );
    return ok({ over: "record", f }, record);
  }

  if (sel === "assumption") {
    const assumption = text_("assumption");
    const a = k.v.assumptions.find((x) => x.id === assumption);
    if (!a)
      return fail(
        tx("ui.wiki-src-wiki.citations-assumption-does-not-exist-registry-id", {
          id: assumption,
        }),
        "assumption",
      );
    return ok(
      {
        over: "assumption",
        id: a.id,
        rule: a.summary,
        features: usedBy(k.v, a.id),
      },
      assumption,
    );
  }

  if (sel === "area") {
    const area = text_("area");
    // A domain the taxonomy does not know is not the same as one without
    // records: nobody declared the first, the second is empty.
    const declared =
      k.v.model.taxonomy?.domains.some((d) => d.name === area) ?? null;
    const list = k.v.M.filter((f) => f.id.split("/")[0] === area);
    if (declared === false && !list.length) {
      return fail(
        tx("ui.wiki-src-wiki.citations-taxonomy-does-not-know-domain-domain", {
          domain: area,
        }),
        "area",
      );
    }
    return ok({ over: "list", list }, `area ${area}`);
  }

  if (sel === "team") {
    const team = text_("team");
    const list = k.v.M.filter((f) => f.team === team);
    // No record for this team is a **measurement** and not a failure: the
    // question was admissible, the answer is empty, and the empty state says
    // so.
    return ok({ over: "list", list }, `team ${team}`);
  }

  if (sel === "tag") {
    const tag = text_("tag");
    const list = k.v.M.filter((f) => f.id.includes(tag));
    return ok({ over: "list", list }, `tag ${tag}`);
  }

  if (!EMBEDDABLE[component].optional) {
    // Computing over everything without a selector would be a different
    // measurement from the one the page meant — and it would look exactly
    // like the one meant.
    return fail(
      tx("ui.wiki-src-wiki.citations-component-needs-selector-takes", {
        component,
        takes: orList(accepts),
      }),
      "component",
    );
  }

  return ok(
    { over: "list", list: k.v.M },
    tx("ui.wiki-src-wiki.citations-all-records"),
  );

  function ok(pick: EmbedPick, selector: string): WikiEmbed {
    return { dead: false, component, title, selector, onlyGaps, pick };
  }
}

/** Which features invoke this assumption — computed, never stored. */
function usedBy(v: DerivedModel, id: string): string[] {
  return v.M.filter((f) => f.related.asm.includes(id)).map((f) => f.id);
}

/* ──────────────────────────────────────────────────────────────────────────
 * The report: every reference of a page
 * ────────────────────────────────────────────────────────────────────────── */

/** One reference of a page, with the place it stands in. */
export type PageRef = {
  /** The text the author wrote. */
  text: string;
  ref: WikiRef;
};

/** What references a page contains — and which of them are dead. */
export type PageRefs = {
  /** Every `atlas:` reference in the prose, in reading order. */
  all: PageRef[];
  dead: PageRef[];
  /**
   * `records:` ids from the front matter that no record of this run carries.
   *
   * They stand beside the references and not among them: the specification treats an
   * unresolvable record id as an **error** and a dead reference as a warning.
   * Throwing the two together would lose exactly that difference.
   */
  unknownRecords: string[];
  /**
   * `atlas:` addresses this reader **cannot read as a reference**.
   *
   * The library's inline parser does not nest: in `**[x](atlas:y)**` the `**`
   * wins and the reference becomes bold *text*; in `` `[x](atlas:y)` `` the
   * code span swallows it. Both are allowed in a Markdown file, and the host
   * (`facet wiki check`) counts both — it sees the raw text.
   *
   * Leaving them out here would be the silent case this project forbids: a
   * reference that neither lives nor is dead nor stands in the denominator.
   * So it is named, and the report says that the reader sees less here than
   * the command line does.
   */
  unread: { text: string; target: string; why: string }[];
};

/**
 * `atlas:` addresses inside a piece of inline text outside a
 * reference.
 *
 * The search runs over what `parseInline` returns as `strong`, `em` or `code`
 * — that is where the raw text it did not break down any further stands.
 */
const ATLAS_IN_TEXT = /\[([^\]]+)\]\((atlas:[^)\s]+)\)/g;

/**
 * Counts and checks the references of **one** page text.
 *
 * The count runs over the parsed blocks and not over the raw text, and that is
 * the whole reason it lives here instead of being three lines with a regular
 * expression: a `[…](atlas:…)` **inside a fenced block** is code and not a
 * reference. The page that explains this syntax writes it inside a fence — a
 * counter that takes it along makes this feature's documentation unwritable.
 * `facet wiki check` draws the same distinction.
 */
export function pageRefs(
  blocks: readonly WikiBlockLike[],
  records: string[],
  k: Corpus,
): PageRefs {
  const all: PageRef[] = [];
  const unread: PageRefs["unread"] = [];
  walk(blocks);
  return {
    all,
    dead: all.filter((entry) => entry.ref.dead),
    unknownRecords: records.filter((id) => !k.v.byId[id]),
    unread,
  };

  function walk(list: readonly WikiBlockLike[]): void {
    for (const block of list) {
      if (block.kind === "code" || block.kind === "embed") continue;
      if (block.inline) take(block.inline);
      if (block.head) block.head.forEach(take);
      if (block.rows) block.rows.forEach((row) => row.forEach(take));
      if (block.items) {
        for (const item of block.items) {
          take(item.inline);
          walk(item.blocks);
        }
      }
    }
  }

  function take(
    parts: readonly { kind: string; text?: string; target?: string }[],
  ): void {
    for (const part of parts) {
      if (part.kind === "atlas" && typeof part.target === "string") {
        all.push({ text: part.text ?? "", ref: resolveRef(part.target, k) });
        continue;
      }
      // A markup span in which an `atlas:` address got stuck:
      // `**[x](atlas:y)**` and `` `[x](atlas:y)` ``. The reader shows it as
      // text, the host counts it as a reference — and that difference belongs
      // named rather than sitting as a silent gap in the denominator.
      if (part.kind !== "strong" && part.kind !== "em" && part.kind !== "code")
        continue;
      const text = part.text ?? "";
      if (!text.includes("](atlas:")) continue;
      for (const hit of text.matchAll(ATLAS_IN_TEXT)) {
        unread.push({
          text: hit[1],
          target: hit[2].replace(/^atlas:/, ""),
          why:
            part.kind === "code"
              ? tx(
                  "ui.wiki-src-wiki.citations-sits-code-span-reader-reads-text",
                )
              : tx(
                  "ui.wiki-src-wiki.citations-sits-markup-span-reader-does-not",
                ),
        });
      }
    }
  }
}

/**
 * What `pageRefs` needs from a block.
 *
 * Structural on purpose and not `WikiBlock`: the counter cares about pieces
 * with references and about what has children, and about nothing else. A block
 * `markdown.ts` adds later is counted without anybody having to remember to —
 * and that is exactly the kind of mistake a counter otherwise makes in
 * silence.
 */
export type WikiBlockLike = {
  kind: string;
  inline?: readonly { kind: string; text?: string; target?: string }[];
  head?: readonly (readonly {
    kind: string;
    text?: string;
    target?: string;
  }[])[];
  rows?: readonly (readonly (readonly {
    kind: string;
    text?: string;
    target?: string;
  }[])[])[];
  items?: readonly {
    inline: readonly { kind: string; text?: string; target?: string }[];
    blocks: readonly WikiBlockLike[];
  }[];
};
