/** A named full surface that a plugin owns, and the core does not know. */

import type { ReactNode } from "react";
import type { PlacePublic } from "./context";

/** Which area is open, and whatever that area remembers about itself. */
export type AreaPlace = {
  /** The name the area was registered under. */
  name: string;
  /** The area's own state. The core stores it and never reads it. */
  state: unknown;
};

/** What an area supplies. It returns a node rather than drawing into one,
 * because an area is a surface and not a patch of one — the host decides
 * where it hangs, and the concept says that is inside the stage. */

export type AreaRenderer = (ctx: {
  /** What this area last remembered, or the argument it was opened with. */
  state: unknown;
  /** Store new state for this area. The core keeps it opaque. */
  setState: (next: unknown) => void;
  /** Where the reader stands, narrowed as everywhere else. */
  place: PlacePublic;
}) => ReactNode;

/** One rung of the area's own Esc ladder. */

export type AreaEscape = (state: unknown) => unknown | null;

/** The part of the area's state that says where the reader is in it. */

export type AreaPlaceOf = (state: unknown) => unknown;

type Registration = {
  name: string;
  plugin: string;
  render: AreaRenderer;
  /** What `state` should be when the area is opened with no argument. */
  initial: (arg: string | null) => unknown;
  escape: AreaEscape;
  placeOf: AreaPlaceOf;
};

/** The host's side of `atlas.areas`. */

// @facet: workspace/contracts/plugin-areas
// @facet-role: primary
export class AreaRegistry {
  private readonly areas = new Map<string, Registration>();

  /** Records that a plugin owns an area. */

  register(
    plugin: string,
    name: string,
    render: AreaRenderer,
    opts: {
      initial?: (arg: string | null) => unknown;
      escape?: AreaEscape;
      place?: AreaPlaceOf;
    } = {},
  ): boolean {
    if (this.has(name)) return false;
    this.areas.set(name, {
      name,
      plugin,
      render,
      initial: opts.initial ?? ((arg) => arg),
      escape: opts.escape ?? (() => null),
      placeOf: opts.place ?? (() => null),
    });
    return true;
  }

  /** One press of Esc inside the open area. */

  escape(place: AreaPlace): AreaPlace | null {
    const reg = this.areas.get(place.name);
    if (!reg) return null;
    const next = reg.escape(place.state);
    return next === null || next === undefined ? null : { name: place.name, state: next };
  }

  /** What of an open area counts as a place in the reader's history. */

  placeOf(place: AreaPlace): unknown {
    const reg = this.areas.get(place.name);
    return reg ? (reg.placeOf(place.state) ?? null) : null;
  }

  /** Whether any plugin claimed this name. */
  has(name: string): boolean {
    return this.areas.has(name);
  }

  /** The place an area starts from when it is opened. */

  open(name: string, arg: string | null): AreaPlace | null {
    const reg = this.areas.get(name);
    if (!reg) return null;
    return { name, state: reg.initial(arg) };
  }

  /** Draws the open area, or nothing when its owner is unavailable. */
  render(place: AreaPlace, ctx: { setState: (next: unknown) => void; place: PlacePublic }) {
    const reg = this.areas.get(place.name);
    if (!reg) return null;
    return reg.render({ state: place.state, setState: ctx.setState, place: ctx.place });
  }

  /** The areas one plugin registered, in registration order. For the host's addressing. */
  namesOf(plugin: string): string[] {
    return [...this.areas.values()].filter((a) => a.plugin === plugin).map((a) => a.name);
  }

  /** Which plugin owns an area. For the host's reporting, not for a plugin. */
  ownerOf(name: string): string | null {
    return this.areas.get(name)?.plugin ?? null;
  }

  /** How many areas are claimed. */
  get count(): number {
    return this.areas.size;
  }
}
