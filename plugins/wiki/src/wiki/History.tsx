/**
 * The git history of one wiki page, in the page head.
 *
 * Asks the host's `repo.log` and says one of four things, never an empty
 * stand-in: nothing yet (the question is still out), the host's own refusal,
 * "not versioned" (no repository holds the wiki), or the commits — with a
 * sentence when the clone is shallow and the list may be incomplete.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */

import { useEffect, useState } from "react";
import { tx } from "../../../../frontend/src/i18n";
import { useOptionalCall } from "../bus";

type Commit = { hash: string; author: string; date: string; subject: string };
type Log = { unversioned: boolean; shallow: boolean; commits: Commit[] };

type State =
  | { kind: "pending" }
  | { kind: "failed"; message: string }
  | { kind: "answer"; log: Log };

/** The date part of an ISO timestamp — the host's own day, not the browser's. */
function day(iso: string): string {
  return iso.slice(0, 10);
}

export default function History({ path }: { path: string }) {
  const call = useOptionalCall();
  const [state, setState] = useState<State>({ kind: "pending" });

  useEffect(() => {
    if (!call) return;
    let alive = true;
    // A new path starts over: the answer for the previous one must not stay
    // on screen while this one loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: "pending" });
    call("repo.log", { path }).then(
      (result) => {
        if (!alive) return;
        if (!result.ok) {
          setState({
            kind: "failed",
            message: "denied" in result ? result.denied : result.error,
          });
          return;
        }
        const log = result.result as Partial<Log> | undefined;
        // An answer that is not a history is not "no history": it is said as
        // unreadable rather than drawn as an empty list.
        if (!log || !Array.isArray(log.commits)) {
          setState({ kind: "failed", message: "repo.log" });
          return;
        }
        setState({ kind: "answer", log: log as Log });
      },
      (caught: unknown) => {
        if (alive)
          setState({
            kind: "failed",
            message: caught instanceof Error ? caught.message : String(caught),
          });
      },
    );
    return () => {
      alive = false;
    };
  }, [call, path]);

  if (!call || state.kind === "pending") return null;
  if (state.kind === "failed") {
    return (
      <p className="t-meta t-bad" data-testid="wiki-history-failed">
        {tx("ui.wiki-src-wiki.history-history-could-not-read")} {state.message}
      </p>
    );
  }
  const { log } = state;
  if (log.unversioned) {
    return (
      <p className="t-meta" data-testid="wiki-history-unversioned">
        {tx("ui.wiki-src-wiki.history-not-versioned")}
      </p>
    );
  }
  return (
    <div className="wiki-hist" data-testid="wiki-history">
      {log.commits.length === 0 ? (
        <p className="t-meta" data-testid="wiki-history-empty">
          {tx("ui.wiki-src-wiki.history-no-commit-yet-page")}
        </p>
      ) : (
        <ol>
          {log.commits.map((c) => (
            <li key={c.hash} data-testid="wiki-history-commit">
              <span className="t-mono">{c.hash.slice(0, 7)}</span> · {c.author}{" "}
              · {day(c.date)} · {c.subject}
            </li>
          ))}
        </ol>
      )}
      {log.shallow ? (
        <p className="t-meta" data-testid="wiki-history-shallow">
          {tx("ui.wiki-src-wiki.history-history-incomplete-shallow-clone")}
        </p>
      ) : null}
    </div>
  );
}
