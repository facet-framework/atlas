/** The record head rows the reader pinned to the top of the page (path,
 * status, name, id). */

import { useCallback, useState } from "react";
import { records } from "@/screens";

export const STUCK_KEY = "facet.atlas.stuck";

type StickKey = records.RecordStickKey;
const KNOWN: ReadonlySet<string> = new Set(records.RECORD_STICK_KEYS);

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored rows that are known, in head order, without duplicates. */
export function loadStuck(s: Pick<Storage, "getItem"> | undefined): StickKey[] {
  try {
    const raw = s?.getItem(STUCK_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return records.RECORD_STICK_KEYS.filter((k) => list.includes(k) && KNOWN.has(k));
  } catch {
    return [];
  }
}

/** The pinned rows and a setter that stores every change. */
export function useStuck(): [StickKey[], (key: StickKey, on: boolean) => void] {
  const [stuck, setStuck] = useState<StickKey[]>(() => loadStuck(storage()));
  const stick = useCallback((key: StickKey, on: boolean) => {
    setStuck((prev) => {
      const next = records.RECORD_STICK_KEYS.filter((k) => (k === key ? on : prev.includes(k)));
      try {
        storage()?.setItem(STUCK_KEY, JSON.stringify(next));
      } catch {
        /** the pin holds for this visit only */
      }
      return next;
    });
  }, []);
  return [stuck, stick];
}
