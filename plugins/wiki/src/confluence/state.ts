/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */

import { tx } from "../../../../frontend/src/i18n";
import {
  resolveHostMessage,
  type HostMessage,
} from "../../../../frontend/src/i18n/host-message";

/** Where the host answers. One request, one path. */
export const CONFLUENCE_REACH_PATH = "/api/wiki/confluence/reach";

/**
 * A measurement: what was asked, and what came back.
 *
 * `kind` separates the two cases in the type instead of through
 * `status === null`, so a surface does not have to guess. `status` is only
 * set for `answer` — for `no-answer` there is none, and writing a 0 into
 * it would be exactly the invented number this file prevents.
 */
export type Reach = {
  kind: "answer" | "no-answer";
  /** What was asked, in the host's words ("space search, limit 1"). */
  what: string;
  /** The HTTP status — only for an answer, otherwise `null`. */
  status: number | null;
  /** Why no answer came — only for `no-answer`. */
  reason: string | null;
  /** When it was measured, as an ISO string. */
  when: string;
  /** Stable code for `was`, when the host sent one; `wasParams` fill it in. */
  whatCode?: string;
  whatParams?: Record<string, string | number>;
  /** Stable code for `reason`, when the host sent one; `reasonParams` fill it in. */
  reasonCode?: string;
  reasonParams?: Record<string, string | number>;
};

/**
 * The host's message codes this reader knows, each with its dictionary key and
 * the values its sentence needs.
 *
 * A code is wire format and never renamed; a code missing here is not an
 * error but a newer host, and the sentence it sent beside the code is shown.
 * The same happens when a value the key needs did not arrive as a string or
 * number — the sidecar is shipped separately, so its output is not trusted to
 * fill a placeholder.
 */
const HOST_MESSAGES: Readonly<Record<string, HostMessage>> = {
  "confluence.reach.space-search": {
    key: "ui.wiki-src-confluence.state-space-search-limit-limit",
    params: ["limit"],
  },
  "confluence.reach.no-plugin-directory": {
    key: "ui.wiki-src-confluence.state-no-plugin-directory-configured",
  },
  "confluence.reach.no-credentials": {
    key: "ui.wiki-src-confluence.state-confluence-credentials-missing-environment-missing",
    params: ["missing"],
  },
};

/**
 * A host sentence in the reader's language.
 *
 * Resolved when it is drawn, not when it arrived, so a language switch reaches
 * a measurement that is already on screen. Without a known code, or without
 * the values its sentence needs, the host's own text is the answer — that is
 * how a reader and a host of different ages keep understanding each other.
 */
export function hostText(
  code: string | null | undefined,
  params: Record<string, string | number> | null | undefined,
  sent: string,
): string {
  return resolveHostMessage(HOST_MESSAGES, code, params, sent);
}

/** What was asked, in the reader's language. */
export function whatText(
  e: Pick<Reach, "what" | "whatCode" | "whatParams">,
): string {
  return hostText(e.whatCode, e.whatParams, e.what);
}

/**
 * What the host knows about the connection.
 *
 * Every field may be `null`, and `null` here always means the same thing:
 * *nobody measured or set it*. It never means "empty" and never "off".
 */
export type ConnectionState = {
  /** The instance, as the host found it in the environment. */
  instance: string | null;
  /** Where it comes from — `CONFLUENCE_URL`. The origin is given, not just the value. */
  instanceSource: string | null;
  /** The **name** of the variable, never its value. */
  tokenSource: string | null;
  /** The measurements, newest first. */
  reaches: Reach[];
  /** How many spaces an answer named — `null` as long as none did. */
  spaces?: number | null;
};

/** An answer there was — a negative one too. */
export function answered(
  what: string,
  status: number,
  when: Date = new Date(),
): Reach {
  return {
    kind: "answer",
    what,
    status,
    reason: null,
    when: when.toISOString(),
  };
}

/** A request to which no answer came. */
export function failed(
  what: string,
  reason: string,
  when: Date = new Date(),
): Reach {
  return {
    kind: "no-answer",
    what,
    status: null,
    reason,
    when: when.toISOString(),
  };
}

/** The time of a measurement, as the line shows it. */
function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return tx("ui.wiki-src-confluence.state-time", {
    time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
  });
}

/** A measurement as a sentence — the one place where both cases get words. */
function sentence(e: Reach): string {
  if (e.kind === "answer") {
    return tx("ui.wiki-src-confluence.state-last-reached-time-what-status", {
      time: timeLabel(e.when),
      what: whatText(e),
      status: e.status ?? "",
    });
  }
  return tx("ui.wiki-src-confluence.state-not-reached-time-what-reason", {
    time: timeLabel(e.when),
    what: whatText(e),
    reason:
      e.reason === null
        ? tx("ui.wiki-src-confluence.state-no-reason-given")
        : hostText(e.reasonCode, e.reasonParams, e.reason),
  });
}

/** What is in the line. Every field is text or `null`, never a claim. */
export type StateText = {
  instance: string;
  token: string;
  /** The latest measurement, or "not checked yet". */
  answered: string;
  /** The measurement before it — `null` when there is only one. */
  previous: string | null;
  /**
   * Whether the latest measurement was an answer in the success range.
   *
   * Only for colouring. It says nothing about *now* and is therefore not
   * called "connected": for `not checked yet` it is `false`, and that is not
   * an error but the absence of a measurement.
   */
  ok: boolean;
  /** "400 spaces" — or `null` as long as no answer has counted. */
  spaces: string | null;
};

export function stateText(a: ConnectionState): StateText {
  const [latest, previous] = a.reaches;
  return {
    instance: a.instance
      ? `${a.instance}${
          a.instanceSource
            ? ` · ${tx("ui.wiki-src-confluence.state-source", { source: a.instanceSource })}`
            : ""
        }`
      : tx("ui.wiki-src-confluence.state-no-credentials-environment"),
    token: a.tokenSource
      ? tx("ui.wiki-src-confluence.state-token-source", {
          source: a.tokenSource,
        })
      : tx("ui.wiki-src-confluence.state-no-token-environment"),
    answered: latest
      ? sentence(latest)
      : tx("ui.wiki-src-confluence.state-not-checked-yet"),
    previous: previous
      ? tx("ui.wiki-src-confluence.state-before-measurement", {
          measurement: sentence(previous),
        })
      : null,
    ok: Boolean(
      latest &&
      latest.kind === "answer" &&
      latest.status !== null &&
      latest.status < 400,
    ),
    // A measured zero is a number; an uncounted one is not. Hence `== null`
    // and not `!a.spaces` — that would have swallowed the zero and claimed
    // "nothing measured" in its place.
    spaces:
      a.spaces == null
        ? null
        : tx("ui.wiki-src-confluence.state-count-spaces", { count: a.spaces }),
  };
}

/**
 * Exactly **one** request, and nothing else.
 *
 * Not one per tree node, not one on mount: the "Check now" button asks the
 * host once, the host asks Confluence once, and what comes back is a
 * measurement. A network error becomes `no-answer` here and **not** a
 * status — there was none, and writing one would mean inventing a number no
 * server sent.
 */
export async function check(fetcher: typeof fetch = fetch): Promise<Reach> {
  try {
    const answer = await fetcher(CONFLUENCE_REACH_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const body = (await answer.json()) as Partial<Reach>;
    const codes = hostCodes(body);
    if (body && body.kind === "no-answer") {
      return {
        ...failed(
          body.what ?? tx("ui.wiki-src-confluence.state-space-search"),
          body.reason ?? tx("ui.wiki-src-confluence.state-no-reason-given"),
        ),
        ...codes,
      };
    }
    return {
      ...answered(
        body?.what ?? tx("ui.wiki-src-confluence.state-space-search-limit-1"),
        body?.status ?? answer.status,
      ),
      ...codes,
    };
  } catch (caught) {
    return failed(
      tx("ui.wiki-src-confluence.state-space-search-limit-1"),
      caught instanceof Error ? caught.message : String(caught),
    );
  }
}

/**
 * The codes of a host answer, kept only where they have the shape this reader
 * can use. Anything else is dropped and the sent text stands in for it.
 */
function hostCodes(
  body: Partial<Reach> | null | undefined,
): Pick<Reach, "whatCode" | "whatParams" | "reasonCode" | "reasonParams"> {
  const out: Pick<
    Reach,
    "whatCode" | "whatParams" | "reasonCode" | "reasonParams"
  > = {};
  if (!body) return out;
  if (typeof body.whatCode === "string") out.whatCode = body.whatCode;
  const whatParams = paramsOf(body.whatParams);
  if (whatParams) out.whatParams = whatParams;
  if (typeof body.reasonCode === "string") out.reasonCode = body.reasonCode;
  const reasonParams = paramsOf(body.reasonParams);
  if (reasonParams) out.reasonParams = reasonParams;
  return out;
}

/**
 * The string and number values of a params map; any other value is left out,
 * so a key that needs it falls back to the sent text in `hostText`.
 */
function paramsOf(v: unknown): Record<string, string | number> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [name, x] of Object.entries(v)) {
    if (typeof x === "string" || typeof x === "number") out[name] = x;
  }
  return out;
}
