/**
 * Read connection state from the host. Credentials remain on the host and
 * are never entered or stored by this surface.
 */
/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 * @facet: workspace/settings/settings-navigation
 * @facet-role: related
 */

import { tx } from "../../../../frontend/src/i18n";

/** How the host gets at its secret — the **name**, never the value. */
export type TokenSource = {
  /**
   * The name of the environment variable (`CONFLUENCE_API_TOKEN`), or `null`
   * when none was found.
   *
   * `null` is a real answer and not a gap: it says the host has no
   * credentials, and the surface then says exactly that instead of writing
   * down a default nobody set.
   */
  variable: string | null;
  /**
   * The instance this refers to — without scheme, the way the design draws
   * it. `null` when the host names none.
   */
  instance: string | null;

  instanceSource?: string | null;
};

/** A request that arrived on the far side — with what came back. */
export type Answered = {
  /** When, in the host's notation or as an ISO time. */
  t: string;
  /** What was requested ("space search"), in the host's words. */
  what: string;
  /** The host's code for `what` and its parameters, drawn through `hostText`. */
  whatCode?: string;
  whatParams?: Record<string, string | number>;
  /**
   * The HTTP status of the answer.
   *
   * A number and not "ok/failed": the difference between 401 and 404 is the
   * one between "wrong credentials" and "the page is absent", and a boolean in
   * this field would hide that distinction.
   */
  code: number;
};

/**
 * What is known about a connection.
 *
 * `source: null` and `source: {variable: null}` are **different things**, and
 * keeping them apart is the reason this type looks the way it does:
 *
 * - `source: null` — **nobody asked the host.** The surface knows nothing
 *   about its environment and therefore may say nothing about it.
 * - `source: {variable: null}` — the host was asked and answered that it has
 *   no credentials. That is a measurement.
 *
 * While this was being built, both lay on the same `null`, and the renderer
 * printed the second meaning: a surface that had never asked claimed "no
 * credentials in the environment" — on a host that had set them. Exactly the
 * kind of sentence this whole record is written against.
 *
 * `reach` is the history, newest first — empty means no request was
 * answered.
 */
export type ConnectionState = {
  /** What the host said about its environment — `null` when it was never asked. */
  source: TokenSource | null;
  reach: Answered[];
  /**
   * Why the last request got **no** answer — `null` when one came or none
   * went out.
   *
   * Without this field a request that ran into nothing would lie on the same
   * `reach: []` as one that was never made — and the line would write "not
   * checked yet" over an attempt somebody made. That is the same mistake as
   * the one between `source: null` and `source: {variable: null}`, one level
   * deeper.
   */
  withoutAnswer?: string | null;
};

/**
 * What **one** check brings back.
 *
 * Two things and not one, because the host answers two different questions:
 * what is in its environment it reads locally — that costs nothing and goes
 * nowhere. Whether the far side answers it only knows after a request there,
 * and that is the one that is counted.
 *
 * `answered` and `withoutAnswer` exclude each other: either an answer came, or
 * none came and there is a reason. If both are `null`, no request went out to
 * the far side — the host had no credentials, and the environment report
 * alone is then the whole finding. The line then says what is missing, not
 * that nobody asked: somebody asked, just not over there.
 */
export type Finding = {
  /** What the host says about its environment. The **name** of the variable, never its value. */
  source: TokenSource;
  /** The one request to the far side, when an answer came. */
  answered: Answered | null;
  /** Why none came — in the host's words. */
  withoutAnswer: string | null;
};

/**
 * A connection about which **nothing was asked**.
 *
 * Not "nothing configured": that would be a statement about the host, and
 * there is none here.
 */
export const NOT_REQUESTED: ConnectionState = { source: null, reach: [] };

/**
 * What the status line shows — per field a finding or nothing.
 *
 * Not a string: whoever returned a sentence here would have to take it apart
 * again in the test, and a test that says `toContain("401")` also passes over
 * a sentence that reads "not 401". Separate fields can be checked
 * separately.
 */
export type StatusLine = {
  /**
   * What there is to say about the credentials — in three versions, because
   * there are three states and not two.
   */
  token: string;
  /** Whether the host names a source. Also false when it was never asked. */
  tokenKnown: boolean;
  /**
   * Whether the host was ever asked.
   *
   * Sits beside `tokenBekannt` because the surface has to draw the two
   * differently: a connection about which nothing was asked is not a finding
   * about the host — it is the absence of a finding.
   */
  requested: boolean;
  /** The instance, or `null`. */
  instance: string | null;
  /** The note on where the instance came from, or `null`. */
  instanceSource: string | null;
  /**
   * The last request that arrived — `null` when none ever arrived.
   *
   * `null` means **not checked** and never "failed". The surface writes its
   * own sentence for it and no time, because there is none.
   */
  latest: Answered | null;
  /** The request before it, if there is one — the failure before the success. */
  previous: Answered | null;
  /**
   * Why the last request got no answer — `null` when one came.
   *
   * Sits beside `last answer` and not inside it: a request without an answer is
   * not a reach, and carrying it as one with code `0` would be the invented
   * number this file is written against.
   */
  withoutAnswer: string | null;
};

/**
 * The line for a connection.
 *
 * Nothing is invented here. Where the host is silent, the line stays silent
 * too — `instanz: null` stays `null` and does not become "unknown", because
 * "unknown" printed is a statement and the missing line is none.
 */
export function statusLine(a: ConnectionState): StatusLine {
  const v = a.source?.variable ?? null;
  return {
    token: !a.source
      ? // Not asked. The sentence talks about Atlas and not about the host —
        // anything else would be a statement about an environment this
        // surface never looked into.
        tx("ui.wiki-src-confluence.connection-host-s-environment-was-not-asked")
      : v
        ? tx("ui.wiki-src-confluence.connection-token-source", { source: v })
        : tx("ui.wiki-src-confluence.connection-no-credentials-environment"),
    tokenKnown: v !== null,
    requested: a.source !== null,
    instance: a.source?.instance ?? null,
    instanceSource: a.source?.instanceSource ?? null,
    latest: a.reach[0] ?? null,
    previous: a.reach[1] ?? null,
    withoutAnswer: a.withoutAnswer ?? null,
  };
}

/**
 * What a check brought back, entered into the connection.
 *
 * The environment report **always** replaces the previous one: it is a fresh
 * reading of the same environment, and laying an old one beside it would mean
 * carrying two findings about the same thing. The reach is appended, because
 * it is a measurement at a point in time and the one before explains what the
 * reader saw a moment ago.
 *
 * `withoutAnswer` is set anew on every check — also to `null`: a request that
 * arrived this time cancels last time's reason, and leaving it standing would
 * mean reporting a cleared failure.
 */
export function adopt(a: ConnectionState, b: Finding): ConnectionState {
  const withState: ConnectionState = {
    ...a,
    source: b.source,
    withoutAnswer: b.withoutAnswer,
  };
  return b.answered ? prepend(withState, b.answered) : withState;
}

/** Whether an answer was the good kind. 2xx and 3xx arrived and were right. */
export const succeeded = (e: Answered): boolean => e.code < 400;

/**
 * How the last request is named — and the sentence for "none at all".
 *
 * Separate from `zustandszeile`, because it is the one point where the rule
 * breaks when somebody later finds it convenient: "last reached —" with an
 * empty slot after it reads like a value that is still loading. The sentence
 * has to say that **nobody asked**.
 */
export function answeredText(e: Answered | null): string {
  if (!e) return tx("ui.wiki-src-confluence.connection-not-checked-yet");
  return tx("ui.wiki-src-confluence.connection-last-reached-time", {
    time: e.t,
  });
}

export function prepend(a: ConnectionState, e: Answered): ConnectionState {
  return { ...a, reach: [e, ...a.reach].slice(0, 12) };
}
