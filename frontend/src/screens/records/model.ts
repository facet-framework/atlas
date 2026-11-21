/** View models of group B (Records and the record record) and the pure helpers
 * the pages share. Nothing here reads fixtures; stories map data onto these.
 * Labels are dictionary keys; components read them through `useText()`. */

import { type Tone } from "@facet-tools/ui";

import type { TextKey } from "../text";
import type { FacetText } from "../text";

export type Lifecycle = "active" | "planned" | "deprecated";
export type RecordKind = "feature" | "assumption";

/** One record as a row of the collection. */
export type RecordRow = {
  id: string;
  slug: string;
  domain: string;
  capability: string;
  kind: RecordKind;
  lifecycle: Lifecycle;
  owner: string | null;
  summary: string;
  scenarios: number;
  proven: number;
  anchors: number;
  drift: number;
  knowledgeOpen: number | null;
  changedAt: string | null;
};

/** The text function of `useText()`, which the label helpers below read through. */
export type Text = FacetText["t"];

/** A share as whole percent, or `null` when there is nothing to divide. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? (part === whole ? 100 : Math.floor((part / whole) * 100)) : null;
}

/** Percent for display: a missing value is a dash, never zero. */
export const pctText = (p: number | null, t: Text) =>
  p == null ? "—" : t("ui.screens-records.model-value", { value: p });

export const LIFECYCLE: Record<Lifecycle, { label: TextKey; tone: Tone }> = {
  active: { label: "ui.screens-records.model-active", tone: "ok" },
  planned: { label: "ui.screens-records.model-planned", tone: "plan" },
  deprecated: { label: "ui.screens-records.model-deprecated", tone: "warn" },
};

export const KIND_LABEL: Record<RecordKind, TextKey> = {
  feature: "ui.screens-records.model-feature",
  assumption: "ui.screens-records.model-assumption",
};

export const ROLE_LABEL: Record<string, TextKey> = {
  primary: "ui.screens-records.model-carries",
  related: "ui.screens-records.model-related",
  config: "ui.screens-records.model-configuration",
  data: "ui.screens-records.model-data",
  "": "ui.screens-records.model-no-role",
};

/** The visible name of an anchor role; a role without a label shows as written. */
export const roleLabel = (role: string, t: Text) => {
  const key = ROLE_LABEL[role];
  return key ? t(key) : role;
};

/** Knowledge ---------------------------------------------------------------- */

export type KnowledgeKey =
  "prerequisite_knowledge" | "discoverability" | "success_signal" | "not_for" | "common_pitfalls";

export const KNOWLEDGE_TEXT: Record<KnowledgeKey, { label: TextKey; question: TextKey }> = {
  prerequisite_knowledge: {
    label: "ui.screens-records.model-prerequisite",
    question: "ui.screens-records.model-what-do-you-need-know-have",
  },
  not_for: {
    label: "ui.screens-records.model-not",
    question: "ui.screens-records.model-when-wrong-tool",
  },
  discoverability: {
    label: "ui.screens-records.model-where-find",
    question: "ui.screens-records.model-where-product-do-you-start",
  },
  common_pitfalls: {
    label: "ui.screens-records.model-pitfalls",
    question: "ui.screens-records.model-which-mistakes-typically-happen",
  },
  success_signal: {
    label: "ui.screens-records.model-how-you-notice",
    question: "ui.screens-records.model-how-do-you-tell-worked",
  },
};

/** The five slots in the order the record shows them, with their questions. */
export const KNOWLEDGE_SLOTS: { key: KnowledgeKey; label: TextKey; question: TextKey }[] = (
  [
    "prerequisite_knowledge",
    "discoverability",
    "success_signal",
    "not_for",
    "common_pitfalls",
  ] as const
).map((key) => ({ key, ...KNOWLEDGE_TEXT[key] }));

/** Given / When / Then -------------------------------------------------------- */

export type StepKeyword = "given" | "when" | "then" | "and";
export type GwtStep = { kw: StepKeyword; text: string };

export const STEP_LABEL: Record<StepKeyword, TextKey> = {
  given: "ui.screens-records.model-given",
  when: "ui.screens-records.model-when",
  then: "ui.screens-records.model-then",
  and: "ui.screens-records.model-and",
};

const KW = /^(given|when|then|and|but)\b\s*/i;

/** Splits a scenario statement into steps. Records write them one per line or
 * as one sentence ("Given …, when …, then …"); both read the same afterwards.
 * Lines without a keyword continue the step before them. */

export function parseSteps(text: string): GwtStep[] {
  const flat = text
    .replace(/\s*\n\s*(?=(given|when|then|and|but)\b)/gi, "\u0000")
    .replace(/\s*\n\s*/g, " ")
    .replace(/,\s+(?=(when|then)\b)/gi, "\u0000");
  const steps: GwtStep[] = [];
  for (const part of flat.split("\u0000")) {
    const m = KW.exec(part);
    const body = part.replace(KW, "").trim();
    if (!body) continue;
    if (m) {
      const k = m[1].toLowerCase();
      steps.push({ kw: k === "but" ? "and" : (k as StepKeyword), text: body });
    } else if (steps.length) {
      steps[steps.length - 1].text += ` ${body}`;
    } else {
      steps.push({ kw: "given", text: body });
    }
  }
  return steps;
}

/** `navigation/atlas/adr-plugin` → `adr plugin`, for headings that read as words. */
export const words = (slug: string) => slug.replace(/[-_]+/g, " ");

/** ISO date to the short form of the active language; `null` stays a dash. */
export function dateText(iso: string | null, t: Text): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return t("ui.screens-records.model-y-m-d", { y, m, d });
}

/** The anchor marker, assembled so that this source file is never read as an
 * anchor by the FACET scanner. */

export const TAG = ["@", "facet"].join("");
