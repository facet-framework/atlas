/** Resolve a saved choice before matching the browser's ordered preferences. */
export function initialLanguage(
  saved: string | null,
  preferred: readonly string[],
  available: readonly string[],
): string {
  if (saved && available.includes(saved)) return saved;
  for (const preference of preferred) {
    const exact = available.find((code) => code.toLowerCase() === preference.toLowerCase());
    if (exact) return exact;
    const base = preference.toLowerCase().split("-")[0];
    if (available.includes(base)) return base;
  }
  return "en";
}
