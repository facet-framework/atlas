import english from "./locales/en.json";
import german from "./locales/de.json";
import { en } from "../component-text/en";
import { de } from "../component-text/de";

/** Resolve an expected German label without embedding dictionary text in tests. */
export function germanLabel(value: string): string {
  function find(a: unknown, b: unknown): string | undefined {
    if (typeof a === "string")
      return a === value && typeof b === "string" && b !== value ? b : undefined;
    if (!a || typeof a !== "object" || !b || typeof b !== "object") return undefined;
    for (const key of Object.keys(a)) {
      const result = find((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
      if (result) return result;
    }
    return undefined;
  }
  const result = find(english, german) ?? find(en, de);
  if (!result) throw new Error(`Missing German test label: ${value}`);
  return result;
}
