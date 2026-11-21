/** A repository-read time in the active locale. Atlas compares scans in UTC
 * on every surface so the same run never appears to have two times. */
export function runTime(value: unknown, language: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const time = new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
  const today = new Date();
  const sameDay = date.toISOString().slice(0, 10) === today.toISOString().slice(0, 10);
  if (sameDay) return `${time} UTC`;
  const day = new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  return `${day}, ${time} UTC`;
}
