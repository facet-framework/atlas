import { tx } from "@/i18n";
/** The tile-set registry — one set per core role, three model-generated tiles
 * and three measured tiles each. */

import type { ReactNode } from "react";
import type { DerivedModel } from "../derive";
import type { Nav } from "../nav";
import type { CoreRoleKey } from "../roles";

/** A tile the model answers — synthesis over a handful of records, no numbers. */
export type GeneratedGenTile = {
  id: string;
  kind: "generated";
  title: string;
  /** The records this tile's question is about. Sent to the agent as part of
   * the question (there is no separate context channel — `streamCompanion`
   * takes only a question and an optional session), and matched against the
   * `read` steps the stream reports to drive the loading choreography and to
   * say honestly how many of them the run actually opened. */

  ctx: string[];
  /** The instruction, as sent — kept to two sentences, no numbers, no mention of the tool. */
  request: string;
};

/** A tile Atlas computes itself — no model call, a number or a short list. */
export type MeasuredGenTile = {
  id: string;
  kind: "measured";
  title: string;
  /** `computed · <field> · run <hh:mm>` — what was computed and when the scan ran. */
  basis: string;
  body: ReactNode;
};

export type GenTile = GeneratedGenTile | MeasuredGenTile;

/** `nav` is only ever used for `nav.open(fid)` — the same one method a
 * measured tile's row button needs to jump to a record, mirroring the
 * design's `data-open` buttons. A set takes the whole `Nav` rather than a
 * narrower callback because that is what every role body already receives
 * from `useNav()`, and a narrower type here would just be unwrapped again at
 * every call site. */

type SetFn = (v: DerivedModel, nav: Pick<Nav, "open">) => GenTile[];

const SETS: Partial<Record<CoreRoleKey, { fn: SetFn; label?: string }>> = {};

/** Registers a role's tile set. A second registration for the same role replaces the first. */
export function registerGenSet(role: CoreRoleKey, fn: SetFn, label?: string): void {
  SETS[role] = { fn, label };
}

/** The tiles a role's set computes against this model — `[]` for an unregistered role. */
export function genTilesFor(role: CoreRoleKey, v: DerivedModel, nav: Pick<Nav, "open">): GenTile[] {
  // Without records there is no measured context to synthesize.
  if (v.M.length === 0) return [];
  return SETS[role]?.fn(v, nav) ?? [];
}

/** The section label a role's set carries — the fallback matches `generative.js`'s own default. */
export function genLabelFor(role: CoreRoleKey): string {
  return SETS[role]?.label ?? tx("ui.generative.tiles-context");
}

/** Which roles currently carry a registered set — for the settings page and for tests. */
export function genRegisteredRoles(): CoreRoleKey[] {
  return Object.keys(SETS) as CoreRoleKey[];
}

/** Test-only: clears every registration, so a suite can register its own sets without collision. */
export function _resetGenSetsForTests(): void {
  for (const key of Object.keys(SETS)) delete SETS[key as CoreRoleKey];
}
