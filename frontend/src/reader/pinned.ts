/** Content kinds the reader pinned to the menu, in the order they were pinned. */

import { useCallback, useState } from "react";
import type { IconName } from "@facet-tools/ui";
import type { NavItem } from "@/chrome";
import type { FacetText, TextKey } from "@/screens/text";

export const PINNED_KEY = "facet.atlas.pinned";

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored pins that name a kind in `known`, in their stored order, without duplicates. */
export function loadPinned(
  s: Pick<Storage, "getItem"> | undefined,
  known: ReadonlySet<string>,
): string[] {
  try {
    const raw = s?.getItem(PINNED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return [
      ...new Set(
        list.filter((k): k is string => typeof k === "string").filter((k) => known.has(k)),
      ),
    ];
  } catch {
    return [];
  }
}

/** `list` with `key` pinned at the end, or unpinned; the others keep their order. */
export function withPin(list: readonly string[], key: string, pin: boolean): string[] {
  const rest = list.filter((k) => k !== key);
  return pin ? [...rest, key] : rest;
}

/** The pinned kinds and a setter that stores every change. */
export function usePinned(known: ReadonlySet<string>) {
  const [pinned, setPinned] = useState<string[]>(() => loadPinned(storage(), known));
  const pin = useCallback((key: string, on: boolean) => {
    setPinned((prev) => {
      const next = withPin(prev, key, on);
      try {
        storage()?.setItem(PINNED_KEY, JSON.stringify(next));
      } catch {
        /** the pin holds for this visit only */
      }
      return next;
    });
  }, []);
  return { pinned, pin };
}

/** Menu name and icon of every kind a reader can pin; the same as on its hub tile. */
const KIND_NAV: Record<string, [TextKey, IconName]> = {
  promises: ["ui.reader.pinned-promises", "shield"],
  knowledge: ["ui.reader.pinned-knowledge", "bulb"],
  operations: ["ui.reader.pinned-operations", "pulse"],
  provenance: ["ui.reader.pinned-origin", "team"],
  taxonomy: ["ui.reader.pinned-taxonomy", "hierarchy"],
  calibration: ["ui.reader.pinned-calibration", "barChart"],
  tests: ["ui.reader.pinned-tests", "flask"],
  deviations: ["ui.reader.pinned-deviations", "error"],
  drift: ["ui.reader.pinned-drift", "offsetBlocks"],
  fixed: ["ui.reader.pinned-fixed", "checkUnderline"],
  anchor: ["ui.reader.pinned-anchors", "anchor"],
  files: ["ui.reader.pinned-files", "file"],
  rules: ["ui.reader.pinned-rules", "checklist"],
};

/** The kinds a reader can pin. */
export const PINNABLE: ReadonlySet<string> = new Set(Object.keys(KIND_NAV));

/** The menu key of a pinned kind; `kindOfNavKey` reads it back. */
export const navKeyOfKind = (kind: string) => `contents:${kind}`;
export const kindOfNavKey = (key: string) =>
  key.startsWith("contents:") ? key.slice("contents:".length) : null;

/** Menu entries for the pinned kinds, in pin order, named in the language of `tt`. */
export function pinnedNav(pinned: readonly string[], tt: FacetText["t"]): NavItem[] {
  return pinned
    .filter((k) => KIND_NAV[k])
    .map((k) => ({ key: navKeyOfKind(k), label: tt(KIND_NAV[k][0]), icon: KIND_NAV[k][1] }));
}
