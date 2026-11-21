import type { Depth } from "../state";

export type PlacePublic = {
  /** Which depth of the register the reader is in. */
  depth: Depth;
  /** The feature in focus, or null on a surface that has none. */
  fid: string | null;
  /** The scenario in focus, or null. */
  sid: string | null;
  /** The reader's chosen role, which a slot may be bound to. */
  role: string;
  /** The NAME of the area that is open, or null when none is. */

  area: string | null;
};

/** The fields of AtlasState a plugin may see, as data rather than as a type. */

export const PLACE_FIELDS = ["depth", "fid", "sid", "role", "area"] as const;

/** Narrows the core's state to what a plugin may read. */

export function narrowPlace(state: {
  depth: Depth;
  fid: string | null;
  sid: string | null;
  role: string;
  area?: { name: string; state?: unknown } | null;
}): PlacePublic {
  return {
    depth: state.depth,
    fid: state.fid,
    sid: state.sid,
    role: state.role,
    area: state.area?.name ?? null,
  };
}
