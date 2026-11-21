import { tx } from "@/i18n";

import type { GenEntry } from "./storage";

export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  const min = Math.round(diff / 60000);
  const std = Math.round(diff / 3600000);
  const days = Math.round(diff / 86400000);
  if (diff < 45000) return tx("ui.generative.origin-just-now");
  if (min < 60) return tx("ui.generative.origin-count-min-ago", { count: min });
  if (std < 24) return tx("ui.generative.origin-count-h-ago", { count: std });
  if (days === 1) return tx("ui.generative.origin-yesterday");
  if (days === 2) return tx("ui.generative.origin-day-before-yesterday");
  return tx("ui.generative.origin-count-days-ago", { count: days });
}

/** Whether the entry's hash and language still match what a regeneration would use. */
export function stale(entry: GenEntry, currentHash: string, language: string): boolean {
  // The text was written in one language; read in another it answers a different
  // question, and an entry from before the language was stored cannot say.
  return entry.hash !== currentHash || entry.lang !== language;
}
