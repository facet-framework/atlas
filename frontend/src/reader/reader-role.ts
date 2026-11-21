/** The role the reader reads under, kept per browser. */

import { useCallback, useEffect, useState } from "react";

export const ROLE_STORAGE_KEY = "facet.atlas.role";
export const DEFAULT_ROLE = "dev";

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored role key, or `null` when none is stored or storage is unreadable. */
export function storedRole(): string | null {
  try {
    const v = storage()?.getItem(ROLE_STORAGE_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

// @facet: registry/perspectives/reader-role
// @facet-role: primary
/** The role chosen in this browser and a setter that keeps the choice. */
export function useReaderRole(): [string, (role: string) => void] {
  const [role, setState] = useState<string>(() => storedRole() ?? DEFAULT_ROLE);
  const set = useCallback((next: string) => {
    setState(next);
    try {
      storage()?.setItem(ROLE_STORAGE_KEY, next);
    } catch {
      // A browser that refuses storage still switches for this visit.
    }
  }, []);
  return [role, set];
}

/** Closes the open role menu on a press outside it. A press inside the menu
 * or on the button that opened it (`aria-expanded="true"`) is left alone:
 * the button keeps its own toggle. */

export function useCloseOnOutsidePress(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onPress = (e: PointerEvent) => {
      const at = e.target instanceof Element ? e.target : null;
      if (at?.closest('[role="menu"], [aria-expanded="true"]')) return;
      close();
    };
    document.addEventListener("pointerdown", onPress);
    return () => document.removeEventListener("pointerdown", onPress);
  }, [open, close]);
}

/** The chosen role when somebody offers it, otherwise the default. */
export function offeredRole(chosen: string, offered: readonly { key: string }[]): string {
  return offered.some((r) => r.key === chosen) ? chosen : DEFAULT_ROLE;
}
