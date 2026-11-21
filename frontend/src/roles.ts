import { tx } from "@/i18n";
/** The reader's roles. */

import type { ReactNode } from "react";
import { frame } from "@/screens";
import type { DerivedFeature } from "./derive";
import type { ScenFilter } from "./state";

/** The blocks a role can arrange. */

export type BlockKey =
  | "ledger"
  | "raw"
  | "drift"
  | "anchors"
  | "fixed"
  | "fan"
  | "obs"
  | "know"
  | "rel"
  | "gaps"
  | "decisions"
  | "rules";

export type CoreRoleKey =
  "leadership" | "dev" | "review" | "author" | "owner" | "newcomer" | "agent";

export type DerivedRole = {
  key: CoreRoleKey;
  label: string;
  purpose: string;
  /** Wide blocks of the detail view, in this order. */
  main: BlockKey[];
  /** Narrow blocks beside them. */
  side: BlockKey[];
  /** What follows below. */
  secs: BlockKey[];
  mfilter: ScenFilter;
  /** The one line this role says about a feature. */
  mnote: (f: DerivedFeature) => ReactNode;
  asks: string[];
};

/** A localized percent or "—", never a share without a denominator. */
function gradeText(f: DerivedFeature): string {
  return f.grade === null ? "—" : tx("ui.root.roles-value", { value: f.grade });
}

// Keep role identities stable while resolving translated metadata at render time.
export const CORE_ROLES: Record<CoreRoleKey, DerivedRole> = {
  leadership: {
    key: "leadership",
    get label() {
      return tx("ui.root.roles-leadership");
    },
    get purpose() {
      return tx("ui.root.roles-product-status-plain-language-without-technical");
    },
    main: ["know", "rules"],
    side: ["fan", "fixed"],
    secs: ["obs"],
    mfilter: "all",
    mnote: (f) =>
      `${f.driftN ? tx("ui.root.roles-rework-pending") + " " : ""}${tx("ui.root.roles-share-test-linkage-team-team", { share: gradeText(f), team: f.team || "—" })}`,
    get asks() {
      return [tx("ui.root.roles-which-feature-has-largest-gap-between")];
    },
  },

  dev: {
    key: "dev",
    get label() {
      return tx("ui.root.roles-developer");
    },
    get purpose() {
      return tx("ui.root.roles-change-code-without-forgetting-its-record");
    },
    main: ["ledger", "raw"],
    side: ["drift", "anchors", "decisions", "rules", "fan"],
    secs: ["obs", "fixed", "rel", "know"],
    mfilter: "open",
    mnote: (f) =>
      f.driftN
        ? tx("ui.root.roles-count-anchored-files-changed-record-unchanged", { count: f.driftN })
        : tx("ui.root.roles-no-drift"),
    get asks() {
      return [
        tx("ui.root.roles-what-still-open"),
        tx("ui.root.roles-which-files-have-changed-without-their"),
      ];
    },
  },

  review: {
    key: "review",
    get label() {
      return tx("ui.root.roles-test-review");
    },
    get purpose() {
      return tx("ui.root.roles-capabilities-features-scenarios-including-missing-tests");
    },
    main: ["ledger", "raw"],
    side: ["fan", "anchors", "drift"],
    secs: ["decisions", "rules", "obs", "know", "rel", "fixed"],
    mfilter: "all",
    mnote: (f) =>
      `${f.proven} / ${f.claims} ${tx("ui.root.roles-commitments-linked-tests")}${f.unbacked ? `, ${f.unbacked} unbacked` : ""}.`,
    get asks() {
      return [
        tx("ui.root.roles-which-feature-has-largest-gap-between"),
        tx("ui.root.roles-which-commitments-have-no-linked-tests"),
      ];
    },
  },

  author: {
    key: "author",
    get label() {
      return tx("ui.root.roles-record-author");
    },
    get purpose() {
      return tx("ui.root.roles-write-records-fill-gaps-their-fields");
    },
    main: ["gaps", "ledger", "raw"],
    side: ["know", "decisions", "rules", "obs", "rel"],
    secs: ["fan", "anchors", "fixed"],
    mfilter: "all",
    mnote: (f) =>
      tx("ui.root.roles-knowledge-observation-fixes", {
        knowledge: tx(
          f.hasKnow ? "ui.root.roles-knowledge-populated" : "ui.root.roles-knowledge-empty",
        ),
        observation: tx(
          f.obs ? "ui.root.roles-observation-populated" : "ui.root.roles-observation-empty",
        ),
        fixes: f.fixes.length
          ? tx("ui.root.roles-count-entries-defects-fixes", { count: f.fixes.length })
          : tx("ui.root.roles-defects-fixes-empty"),
      }),
    get asks() {
      return [
        tx("ui.root.roles-which-features-have-empty-knowledge-sections"),
        tx("ui.root.roles-where-operational-documentation-missing"),
      ];
    },
  },

  owner: {
    key: "owner",
    get label() {
      return tx("ui.root.roles-ownership");
    },
    get purpose() {
      return tx("ui.root.roles-reach-provenance-responsibility");
    },
    main: ["ledger", "raw"],
    side: ["fan", "drift", "anchors"],
    secs: ["fixed", "obs", "rel", "know"],
    mfilter: "all",
    mnote: (f) =>
      tx("ui.root.roles-count-dependent-features-team-team-created", {
        count: f.usedBy.length,
        team: f.team || "—",
        created: f.created ? tx("ui.root.roles-since-date", { date: f.created }) : "",
      }),
    get asks() {
      return [
        tx("ui.root.roles-which-team-owns-most-features"),
        tx("ui.root.roles-what-depends-what"),
      ];
    },
  },

  newcomer: {
    key: "newcomer",
    get label() {
      return tx("ui.root.roles-new-here");
    },
    get purpose() {
      return tx("ui.root.roles-find-your-way-around-repository");
    },
    main: ["know", "ledger", "raw"],
    side: ["decisions", "rules", "fan", "anchors", "obs"],
    secs: ["rel", "drift", "fixed"],
    mfilter: "all",
    mnote: (f) =>
      tx("ui.root.roles-claims-anchors-knowledge", {
        claims: tx("ui.root.roles-count-commitments", { count: f.claims }),
        anchors: tx("ui.root.roles-count-anchors", { count: f.anchorsN }),
        knowledge: tx(
          f.hasKnow ? "ui.root.roles-knowledge-populated" : "ui.root.roles-knowledge-empty",
        ),
      }),
    get asks() {
      return [
        tx("ui.root.roles-where-should-i-start"),
        tx("ui.root.roles-what-knowledge-does-project-assume"),
      ];
    },
  },

  agent: {
    key: "agent",
    get label() {
      return tx("ui.root.roles-agent");
    },
    get purpose() {
      return tx("ui.root.roles-machine-readable-ids-anchors-roles-citations");
    },
    main: ["raw", "ledger"],
    side: ["decisions", "rules", "anchors", "fan", "drift"],
    secs: ["rel", "obs", "know", "fixed"],
    mfilter: "all",
    mnote: (f) =>
      tx("ui.root.roles-anchor-roles-roles", {
        roles: f.anchors.length ? [...new Set(f.anchors.map((a) => a.role))].join(", ") : "—",
      }),
    get asks() {
      return [
        tx("ui.root.roles-which-anchors-have-no-record"),
        tx("ui.root.roles-how-records-connected"),
      ];
    },
  },
};

export const ROLE_LIST: DerivedRole[] = [
  CORE_ROLES.leadership,
  CORE_ROLES.dev,
  CORE_ROLES.review,
  CORE_ROLES.author,
  CORE_ROLES.owner,
  CORE_ROLES.newcomer,
  CORE_ROLES.agent,
];

/** What a core role leaves out of the record depth, and which other role shows it. */

export function leavesOut(key: CoreRoleKey): { block: BlockKey; shownBy: DerivedRole }[] {
  const role = CORE_ROLES[key];
  const shown = new Set<BlockKey>([...role.main, ...role.side, ...role.secs]);
  const every = new Set<BlockKey>(ROLE_LIST.flatMap((r) => [...r.main, ...r.side, ...r.secs]));
  const out: { block: BlockKey; shownBy: DerivedRole }[] = [];
  for (const block of every) {
    if (shown.has(block)) continue;
    const other = ROLE_LIST.find(
      (r) => r.key !== key && [...r.main, ...r.side, ...r.secs].includes(block),
    );
    if (other) out.push({ block, shownBy: other });
  }
  return out;
}

export function roleOf(key: string): DerivedRole {
  return CORE_ROLES[key as CoreRoleKey] ?? CORE_ROLES.dev;
}

/** The role ids a plugin may not take: the reader's own, both the keys this
 * file lists and the keys the overview's role menu offers (`OVERVIEW_ROLE_KEYS`).
 * A plugin role under one of them would stand twice in the menu, and the menu
 * resolves a key to its first entry, so one of the two would be unreachable. */

export const CORE_ROLE_IDS: ReadonlySet<string> = new Set([
  ...ROLE_LIST.map((r) => r.key),
  ...frame.OVERVIEW_ROLE_KEYS,
]);
