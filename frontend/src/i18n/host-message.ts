/** The one rule by which a host message code becomes a sentence in the
 * reader's language. */

import { tx } from "./index";

/** A dictionary key for a host code, with the values its sentence needs. */
export type HostMessage = {
  key: string;
  /** The `{{name}}` placeholders of the key; each must arrive as a string or a finite number. */
  params?: readonly string[];
};

function isParamValue(v: unknown): v is string | number {
  return typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
}

/** The sentence for `code` in the reader's language, or `sent` when the code is
 * unknown or absent, or when any value the key needs is missing or not a
 * string or finite number. */

export function resolveHostMessage(
  table: Readonly<Record<string, HostMessage>>,
  code: string | null | undefined,
  params: unknown,
  sent: string,
): string {
  if (!code || !Object.prototype.hasOwnProperty.call(table, code)) return sent;
  const { key, params: required = [] } = table[code];
  if (required.length === 0) return tx(key);
  if (typeof params !== "object" || params === null || Array.isArray(params)) return sent;
  const given = params as Record<string, unknown>;
  const values: Record<string, string | number> = {};
  for (const name of required) {
    const v = Object.prototype.hasOwnProperty.call(given, name) ? given[name] : undefined;
    if (!isParamValue(v)) return sent;
    values[name] = v;
  }
  return tx(key, values);
}
