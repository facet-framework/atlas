import { tx } from "../../../../frontend/src/i18n";
/**
 * The surface over the real host — it asks it once and shows what came.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 *
 * The connection view receives its state as props.
 * `fetch`. That way it can be tested without a network, and this shell is the
 * only piece that knows a route.
 *
 * Three states, and the middle one is the one most surfaces swallow:
 * **being read** is not **nothing there**. An error while reading is
 * something else again and is shown as what it is — with the host's
 * sentence, not with one of our own.
 */
import { useEffect, useState } from "react";
import Confluence from "./Confluence";
import { loadState, type HostState } from "./host";
export default function ConfluenceLive({
  onDismiss,
  fetchState,
}: {
  onDismiss: () => void;
  /** Injectable for the test. Without a default — see `Confluence`. */
  fetchState?: typeof fetch;
}) {
  const [state, setStatusValue] = useState<HostState | null>(null);
  const [errorState, setErrorState] = useState<string | null>(null);
  useEffect(() => {
    let aliveState = true;
    loadState(fetchState ?? fetch)
      .then((z) => {
        if (aliveState) setStatusValue(z);
      })
      .catch((caught: unknown) => {
        if (!aliveState) return;
        // The host's sentence, verbatim. A second version of the same
        // refusal would be the one that goes stale.
        setErrorState(
          caught instanceof Error ? caught.message : String(caught),
        );
      });
    return () => {
      aliveState = false;
    };
  }, [fetchState]);
  if (errorState !== null) {
    return (
      <section className="confl" id="confl">
        <div className="confl-head">
          <nav
            className="crumbk"
            aria-label={tx(
              "ui.wiki-src-confluence.confluencelive-set-up-confluence",
            )}
          >
            <span className="now">
              {tx("ui.wiki-src-confluence.confluencelive-set-up-confluence")}
            </span>
          </nav>
          <button
            type="button"
            className="t-btn t-btn--small closeview"
            onClick={onDismiss}
          >
            {tx("ui.wiki-src-confluence.confluencelive-esc-close")}
          </button>
        </div>
        <div className="cfull">
          <div className="emptybox">
            {tx(
              "ui.wiki-src-confluence.confluencelive-host-did-not-respond-connection",
            )}{" "}
            <span className="t-mono">{errorState}</span>
          </div>
        </div>
      </section>
    );
  }
  if (!state) {
    return (
      <section className="confl" id="confl">
        <div className="confl-head">
          <nav
            className="crumbk"
            aria-label={tx(
              "ui.wiki-src-confluence.confluencelive-set-up-confluence",
            )}
          >
            <span className="now">
              {tx("ui.wiki-src-confluence.confluencelive-set-up-confluence")}
            </span>
          </nav>
          <button
            type="button"
            className="t-btn t-btn--small closeview"
            onClick={onDismiss}
          >
            {tx("ui.wiki-src-confluence.confluencelive-esc-close")}
          </button>
        </div>
        <div className="cfull">
          {/*
           * "being read" and not "no connections": as long as the answer is
           * on its way, nothing is known about the content, and an empty
           * list here would be a statement about it.
           */}
          <div className="emptybox">
            {tx("ui.wiki-src-confluence.confluencelive-asking-host")}
          </div>
        </div>
      </section>
    );
  }
  return (
    <Confluence state={state} onDismiss={onDismiss} fetchState={fetchState} />
  );
}
