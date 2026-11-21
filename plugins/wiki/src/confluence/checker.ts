/**
 * Check the Confluence connection through the host and show the measured result.
 */
/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

import { loadState } from "./host";
import { tx } from "../../../../frontend/src/i18n";
import { hostText, check, type Reach } from "./state";
import type { Finding, Answered } from "./connection";

/**
 * A measurement by the host in the words of the status line.
 *
 * `null` for a request without an answer: it is not a reach, and carrying it
 * with code `0` would be the invented number both files are written against.
 * The reason is carried along beside it, not discarded.
 */
export function asAnswered(e: Reach): Answered | null {
  if (e.kind !== "answer" || e.status === null) return null;
  return {
    t: timeOfDay(e.when),
    what: e.what,
    ...(e.whatCode ? { whatCode: e.whatCode } : {}),
    ...(e.whatParams ? { whatParams: e.whatParams } : {}),
    code: e.status,
  };
}

/**
 * The host's ISO time as a clock time.
 *
 * As the Confluence surface shows it — the same measurement may not have two
 * notations on two surfaces. A string that is not a time passes through
 * unchanged: it is what the host said, and guessing a date from it would
 * mean replacing its statement.
 */
function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return tx("ui.wiki-src-confluence.checker-time", {
    time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
  });
}

/**
 * A check: ask the host about its environment and make **one** request to
 * the far side.
 *
 * The order is not a convenience. Without instance or token the second
 * request cannot succeed — the host then answers with `no-answer` and
 * names what is missing. Making it anyway would be a request into nothing,
 * and suppressing it would take from the reader the sentence that tells them
 * which variable to set. It therefore goes out when the host names
 * credentials, and not otherwise — the environment report alone is then the
 * complete finding.
 */
export async function hostFinding(
  fetchState: typeof fetch = fetch,
): Promise<Finding> {
  const z = await loadState(fetchState);
  const source = {
    variable: z.tokenSource,
    instance: z.instance,
    instanceSource: z.instanceSource,
  };

  if (!z.tokenSource || !z.instance) {
    // No credentials: the environment has been read and the line says what
    // is missing. Sending out a request that is certain to fail would turn a
    // known gap into a measured one.
    return { source, answered: null, withoutAnswer: null };
  }

  const e = await check(fetchState);
  return {
    source,
    answered: asAnswered(e),
    withoutAnswer:
      e.kind === "no-answer"
        ? e.reason === null
          ? tx("ui.wiki-src-confluence.checker-no-reason-given")
          : hostText(e.reasonCode, e.reasonParams, e.reason)
        : null,
  };
}
