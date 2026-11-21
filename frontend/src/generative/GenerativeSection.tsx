/** The "Overview" section — a role's tile set, mounted once, wired to the
 * store and the run driver. */

import { useEffect, useMemo, useState } from "react";
import { tx } from "@/i18n";
import { useTranslation } from "react-i18next";
import { agentState, type AgentStream } from "@/model";
import type { DerivedModel } from "../derive";
import { useNav } from "../nav";
import type { CoreRoleKey } from "../roles";
import { genLabelFor, genTilesFor, type GeneratedGenTile } from "./tiles";
import { useGenRuns } from "./run";
import { relativeTime } from "./origin";
import { useGenStorage } from "./storage";
import { GeneratedTile, MeasuredTile } from "./Tile";
import "./generative.css";
// Side effect: registers every core role's tile set. Imported here rather
// than left to whichever role file happens to mount first, so a set is
// always registered before this component reads it back.
import "./tiles/index";

// @facet: assistance/briefings/generative-surfaces
// @facet-role: primary
export default function GenerativeSection({
  readerRole: role,
  v,
  model,
  openStream,
  storage,
}: {
  readerRole: CoreRoleKey;
  v: DerivedModel;
  model?: string | null;
  openStream?: (url: string) => AgentStream;
  /** Test seam — the same shape `useAtlasState`/`useGenStorage` already take. */
  storage?: Pick<Storage, "getItem" | "setItem">;
}) {
  const { i18n } = useTranslation();
  const nav = useNav();
  const tiles = useMemo(
    () => genTilesFor(role, v, nav),
    // Builders resolve labels through tx(), outside React.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale changes invalidate translated tile metadata
    [role, v, nav, i18n.resolvedLanguage],
  );
  const generated = useMemo(
    () => tiles.filter((t): t is GeneratedGenTile => t.kind === "generated"),
    [tiles],
  );
  const measured = tiles.filter((t) => t.kind === "measured");

  const [storageResult, apply] = useGenStorage(storage);
  const [signin, setSignin] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const { runs, start, running, failedWithoutText } = useGenRuns({
    v,
    model,
    openStream,
    storageResult,
    onWrite: apply,
    onSignIn: (reason) => setSignin(reason),
  });

  useEffect(() => {
    let alive = true;
    void agentState().then((s) => {
      if (!alive) return;
      setSignedIn(s?.auth?.loggedIn ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  // On mount, run only tiles without remembered text or a previous failure.
  // Existing answers regenerate only on explicit request.
  useEffect(() => {
    if (signedIn !== true) return;
    generated.forEach((tile, i) => {
      if (!storageResult[tile.id] && !running(tile.id) && !failedWithoutText[tile.id]) {
        window.setTimeout(() => start(tile), i * 120);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per mount and per role/model change, not per store write
  }, [signedIn, role, model]);

  if (!tiles.length) return null;

  const runningCount = Object.keys(runs).length;
  const remembered = generated
    .map((t) => storageResult[t.id])
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
  const liveText = runningCount
    ? `${runningCount} ${runningCount === 1 ? tx("ui.generative.generativesection-run") : tx("ui.generative.generativesection-runs")}`
    : remembered.length
      ? `${remembered.length} ${remembered.length === 1 ? tx("ui.generative.generativesection-text") : tx("ui.generative.generativesection-texts")} · ${relativeTime(Math.min(...remembered.map((e) => e.at)))}`
      : "";

  return (
    <div className="gen-section" data-genset={role} data-testid={`gen-section-${role}`}>
      <div className="gen-head">
        <p className="t-label">{genLabelFor(role)}</p>
        <span className="gen-live t-mono" aria-live="polite" data-testid={`gen-live-${role}`}>
          {signedIn === false ? tx("ui.generative.generativesection-not-signed") : liveText}
        </span>
        {signedIn === true ? (
          <button
            type="button"
            className="gen-all t-btn t-btn--small"
            data-testid={`gen-all-${role}`}
            disabled={runningCount > 0}
            onClick={() =>
              generated.forEach((tile, i) => window.setTimeout(() => start(tile), i * 260))
            }
          >
            {tx("ui.generative.generativesection-regenerate-all")}
          </button>
        ) : null}
      </div>
      <div
        className="gen-grid"
        data-testid={`gen-grid-${role}`}
        data-running={runningCount > 0 ? "" : undefined}
      >
        {signedIn === false ? (
          <>
            {measured.map((tile) => (
              <MeasuredTile key={tile.id} tile={tile} />
            ))}
            <div className="gen-off" data-testid={`gen-off-${role}`}>
              <span className="gen-kind">
                {tx("ui.generative.generativesection-generated")} <i>⌁</i>
              </span>
              <span className="gen-off-t">
                {tx("ui.generative.generativesection-not-signed-generativesection")}{" "}
                {generated.length}{" "}
                {generated.length === 1
                  ? tx("ui.generative.generativesection-answer")
                  : tx("ui.generative.generativesection-answers")}{" "}
                {tx("ui.generative.generativesection-model-missing")}{" "}
                {measured.length
                  ? tx("ui.generative.generativesection-computed-tiles-stand-without-model")
                  : ""}
              </span>
            </div>
          </>
        ) : (
          tiles.map((tile) =>
            tile.kind === "measured" ? (
              <MeasuredTile key={tile.id} tile={tile} />
            ) : (
              <GeneratedTile
                key={tile.id}
                tile={tile}
                v={v}
                entry={storageResult[tile.id] ?? null}
                run={runs[tile.id] ?? null}
                errorWithoutText={failedWithoutText[tile.id] ?? null}
                onRegen={() => start(tile)}
              />
            ),
          )
        )}
      </div>
      {signin ? (
        <p className="gen-verdict" data-testid={`gen-signin-error-${role}`}>
          {signin}
        </p>
      ) : null}
    </div>
  );
}
