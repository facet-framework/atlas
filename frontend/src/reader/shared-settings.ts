/** Preferences shared by reader surfaces. */

import { useSyncExternalStore } from "react";
import { readStored, STORAGE_KEY } from "@/state";

export type SharedSettings = {
  /** Keys of the core roles whose generative section is on; off by default. */
  generativeOn: string[];
  /** Ids of the plugins the reader switched off — off, not on, so a plugin the
   * catalogue gains later arrives switched on. */

  pluginsOff: string[];
};

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// @facet: workspace/settings/shared-settings
// @facet-role: primary
export function readShared(store: Pick<Storage, "getItem"> | null = storage()): SharedSettings {
  const stored = store ? readStored(store) : {};
  const roles = Array.isArray(stored.generativeOn)
    ? stored.generativeOn.filter((x): x is string => typeof x === "string")
    : [];
  const off = Array.isArray(stored.pluginsOff)
    ? stored.pluginsOff.filter((x): x is string => typeof x === "string")
    : [];
  return { generativeOn: roles, pluginsOff: off };
}

/** Who hears a stored change in this tab; another tab is heard through `storage`. */
const changed = new Set<() => void>();

function subscribe(fn: () => void) {
  changed.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    changed.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/** The plugins the reader switched off, kept current: a switch in the settings
 * page (or in another tab) rebuilds the plugin host at once. The
 * snapshot is the ids joined, so an unchanged choice is the same value. */

export function usePluginsOff(): string[] {
  const joined = useSyncExternalStore(
    subscribe,
    () => readShared().pluginsOff.join("\n"),
    () => "",
  );
  return joined ? joined.split("\n") : [];
}

/** Why a shared setting was not stored. */
export type SharedWriteRefusal = "no-storage" | "refused" | "unreadable";

/** Merge `patch` into the reader's stored state and say why when it did not land:
 * `no-storage` when the browser offers none (private window, blocked
 * storage), `refused` when reading or writing throws (quota, policy), `unreadable`
 * when the stored text is not a JSON object — writing then would replace every
 * other stored field, so the text is left as it was. */

export function saveShared(
  patch: Partial<SharedSettings>,
  store: Pick<Storage, "getItem" | "setItem"> | null = storage(),
): SharedWriteRefusal | null {
  if (!store) return "no-storage";
  let text: string | null;
  try {
    text = store.getItem(STORAGE_KEY);
  } catch {
    return "refused";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    return "unreadable";
  }
  // JSON that parses but is not an object (`42`, `null`, a string, an array)
  // is not the reader's state either: merging into it would drop it for the patch
  // alone, or spread an array into `{"0": …}`. It stays as it was.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "unreadable";
  }
  const raw = parsed as Record<string, unknown>;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...raw, ...patch }));
    changed.forEach((fn) => fn());
    return null;
  } catch {
    return "refused";
  }
}

/** Merge `patch` into the reader's stored state; `false` when the browser refuses. */
export function writeShared(
  patch: Partial<SharedSettings>,
  store: Pick<Storage, "getItem" | "setItem"> | null = storage(),
): boolean {
  return saveShared(patch, store) === null;
}

/** The role list with `role` switched to `on`, in a stable order without duplicates. */
export function withRole(roles: string[], role: string, on: boolean): string[] {
  return on ? [...new Set([...roles, role])] : roles.filter((r) => r !== role);
}
