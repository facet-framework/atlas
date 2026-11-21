/** Display a measured share without turning an incomplete value into 100%. */
export function sharePercent(part: number, total: number): number | null {
  if (total <= 0) return null;
  if (part >= total) return 100;
  return Math.floor((part / total) * 100);
}

/** Display a measured 0–1 ratio without turning an incomplete value into 100%. */
export function ratioPercent(ratio: number, decimals = 0): number {
  if (ratio >= 1) return 100;
  const scale = 10 ** decimals;
  return Math.floor(Math.max(0, ratio) * 100 * scale) / scale;
}
